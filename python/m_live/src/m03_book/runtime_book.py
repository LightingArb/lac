"""Refresh whole first-outcome order books; null means missing and [] means empty."""

import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from functools import partial

from h_shared.h_db import h_connect
from h_shared.h_ip_pool import ContractError, IPPool
from h_shared.h_log import h_log
from h_shared.h_process import Result


def runtime_book(
    ips: IPPool, *, request_items: int, max_markets: int, max_pending_writes: int, book_seconds: int
) -> Result:
    """Read demand, request public CLOB books and publish current depth; invalid data raises ContractError."""
    started = time.monotonic()
    markets, deleted = c01_markets(max_markets, book_seconds)
    published, available, empty = c02_refresh(ips, markets, request_items, max_pending_writes)
    return c03_report(
        ips, len(markets), published, available, empty, deleted, started, book_seconds
    )


def c01_markets(maximum: int, book_seconds: int) -> tuple[list[tuple[str, str]], int]:
    with h_connect() as connection:
        deleted = connection.execute("""
            DELETE FROM m_live.m03_clob_book AS p
            WHERE NOT EXISTS (
                SELECT 1 FROM m_live.m01_demand_market AS d WHERE d.market_id=p.market_id
            )
        """).rowcount
        markets = s01_due(connection, maximum, datetime.now(UTC), book_seconds)
    return markets, deleted


def s01_due(connection, maximum: int, now: datetime, book_seconds: int) -> list[tuple[str, str]]:
    return connection.execute(
        """WITH eligible AS (
            SELECT d.market_id,
                CASE WHEN d.book_levels=0 THEN %s ELSE d.refresh_seconds END AS refresh_seconds,
                min(o.asset_id) FILTER (WHERE o.outcome_index=0) AS asset_id
            FROM m_live.m01_demand_market AS d
            JOIN m_live.m01_outcome AS o ON o.market_id=d.market_id
            GROUP BY d.market_id, d.refresh_seconds, d.book_levels
            HAVING count(*)=2 AND count(o.asset_id)=2
                AND count(*) FILTER (WHERE o.outcome_index=0)=1
        )
        SELECT e.market_id,e.asset_id FROM eligible AS e
        LEFT JOIN m_live.m03_clob_book AS p ON p.market_id=e.market_id
        WHERE p.market_id IS NULL
           OR p.requested_at + e.refresh_seconds * interval '1 second' <= %s
        ORDER BY (p.market_id IS NOT NULL),
            p.requested_at + e.refresh_seconds * interval '1 second' NULLS FIRST,
            e.market_id
        LIMIT %s""",
        (book_seconds, now, maximum),
    ).fetchall()


def c02_refresh(
    ips: IPPool, markets: list[tuple[str, str]], size: int, max_pending_writes: int
) -> tuple[int, int, int]:
    if max_pending_writes < 1:
        raise ValueError("Declare a positive pending-write bound")
    if not markets:
        return 0, 0, 0
    batches = (markets[i : i + size] for i in range(0, len(markets), size))
    published = available = empty = 0
    # One connection per round, one committed statement per response. The writer
    # runs independently of HTTP; autocommit leaves no idle transaction during I/O.
    # At most max_pending_writes write batches (including the active write), plus
    # the IP pool's bounded fetch futures, are retained. Backpressure stops intake.
    with (
        h_connect(autocommit=True) as connection,
        ThreadPoolExecutor(max_workers=1) as writer,
        closing(ips.map(partial(s02_refresh, ips), batches)) as responses,
    ):
        pending = deque()
        try:
            for rows in responses:
                pending.append(writer.submit(s07_write, ips, connection, rows))
                while pending and (pending[0].done() or len(pending) >= max_pending_writes):
                    counts = pending.popleft().result()
                    published += counts[0]
                    available += counts[1]
                    empty += counts[2]
            for future in pending:
                counts = future.result()
                published += counts[0]
                available += counts[1]
                empty += counts[2]
        finally:
            for future in pending:
                future.cancel()
    return published, available, empty


def s02_refresh(ips: IPPool, markets: list[tuple[str, str]]) -> list[tuple]:
    body = [{"token_id": asset} for _, asset in markets]
    requested = datetime.now(UTC)
    response = ips.request(
        "POST", "https://clob.polymarket.com/books", body=body, target=[m[0] for m in markets]
    )
    return s03_parse(response, markets, requested)


def s03_parse(response: list, markets: list[tuple[str, str]], requested: datetime) -> list[tuple]:
    if not isinstance(response, list):
        raise ContractError("CLOB books must be an array")
    wanted = {asset for _, asset in markets}
    books = {}
    for book in response:
        if not isinstance(book, dict) or not isinstance(book.get("asset_id"), str):
            raise ContractError("CLOB book requires an asset_id")
        asset = book["asset_id"]
        if asset not in wanted:
            continue
        if asset in books:
            raise ContractError("Duplicate CLOB book for requested token")
        bids = s04_levels(book.get("bids"), descending=True)
        asks = s04_levels(book.get("asks"), descending=False)
        source_at = s06_timestamp(book.get("timestamp"))
        source_hash = book.get("hash")
        if not isinstance(source_hash, str) or not source_hash:
            raise ContractError("CLOB book requires a hash")
        tick = s05_number(book.get("tick_size"))
        minimum = s05_number(book.get("min_order_size"))
        if not 0 < tick <= 1 or minimum <= 0:
            raise ContractError("Invalid CLOB tick/minimum size")
        books[asset] = (bids, asks, source_at, source_hash, tick, minimum)
    return [(market, asset, *books.get(asset, (None,) * 6), requested) for market, asset in markets]


def s04_levels(value, *, descending: bool) -> str:
    if not isinstance(value, list):
        raise ContractError("CLOB levels must be an array")
    levels = []
    for level in value:
        if not isinstance(level, dict):
            raise ContractError("Invalid CLOB level")
        price = s05_number(level.get("price"))
        size = s05_number(level.get("size"))
        if not 0 <= price <= 1 or size <= 0:
            raise ContractError("CLOB level price/size outside range")
        levels.append((price, size))
    levels.sort(key=lambda row: row[0], reverse=descending)
    # Validated Decimal literals go directly to JSON numbers, without float loss.
    return "[" + ",".join(f"[{price},{size}]" for price, size in levels) + "]"


def s05_number(value) -> Decimal:
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        raise ContractError("Invalid CLOB numeric value") from None
    if not number.is_finite():
        raise ContractError("Non-finite CLOB numeric value")
    return number


def s06_timestamp(value) -> datetime:
    if isinstance(value, bool) or not isinstance(value, (str, int)) or not str(value).isdigit():
        raise ContractError("CLOB timestamp must be integer epoch milliseconds")
    try:
        return datetime(1970, 1, 1, tzinfo=UTC) + timedelta(milliseconds=int(value))
    except (OverflowError, ValueError):
        raise ContractError("CLOB timestamp outside supported range") from None


def s07_write(ips: IPPool, connection, rows: list[tuple]) -> tuple[int, int, int]:
    counts = s08_publish(connection, rows)
    ips.report(success=counts[0], no_data=counts[0] - counts[1] + counts[2])
    return counts


def s08_publish(connection, rows: list[tuple]) -> tuple[int, int, int]:
    if not rows:
        return 0, 0, 0
    # Re-read current demand and first-outcome identity after HTTP. A late
    # response cannot reintroduce a withdrawn market or overwrite a newer book.
    published = connection.execute(
        """WITH incoming AS (
            SELECT market_id,asset_id,bids::jsonb,asks::jsonb,
                source_timestamp,source_hash,tick_size,min_order_size,requested_at
            FROM unnest(%s::text[],%s::text[],%s::text[],%s::text[],%s::timestamptz[],
                %s::text[],%s::numeric[],%s::numeric[],%s::timestamptz[])
                AS r(market_id,asset_id,bids,asks,source_timestamp,source_hash,
                    tick_size,min_order_size,requested_at)
        ), eligible AS (
            SELECT o.market_id,min(o.asset_id) FILTER (WHERE o.outcome_index=0) AS asset_id
            FROM m_live.m01_outcome AS o
            JOIN incoming AS r ON r.market_id=o.market_id
            JOIN m_live.m01_demand_market AS d ON d.market_id=o.market_id
            GROUP BY o.market_id
            HAVING count(*)=2 AND count(o.asset_id)=2
                AND count(*) FILTER (WHERE o.outcome_index=0)=1
        )
        INSERT INTO m_live.m03_clob_book
            (market_id,asset_id,bids,asks,source_timestamp,source_hash,tick_size,
                min_order_size,requested_at,m_live_updated_at)
        SELECT r.market_id,r.asset_id,r.bids,r.asks,r.source_timestamp,r.source_hash,
            r.tick_size,r.min_order_size,r.requested_at,clock_timestamp()
        FROM incoming AS r JOIN eligible AS e
            ON e.market_id=r.market_id AND e.asset_id=r.asset_id
        ORDER BY r.market_id
        ON CONFLICT (market_id) DO UPDATE SET
            asset_id=EXCLUDED.asset_id,bids=EXCLUDED.bids,asks=EXCLUDED.asks,
            source_timestamp=EXCLUDED.source_timestamp,source_hash=EXCLUDED.source_hash,
            tick_size=EXCLUDED.tick_size,min_order_size=EXCLUDED.min_order_size,
            requested_at=EXCLUDED.requested_at,m_live_updated_at=EXCLUDED.m_live_updated_at
        WHERE EXCLUDED.requested_at >= m03_clob_book.requested_at
        RETURNING bids IS NOT NULL, bids='[]'::jsonb AND asks='[]'::jsonb""",
        tuple([r[i] for r in rows] for i in range(9)),
    ).fetchall()
    return (
        len(published),
        sum(r[0] for r in published),
        sum(r[1] is True for r in published),
    )


def c03_report(
    ips: IPPool,
    selected: int,
    published: int,
    available: int,
    empty: int,
    deleted: int,
    started: float,
    book_seconds: int,
) -> Result:
    with h_connect() as connection:
        pending = bool(s01_due(connection, 1, datetime.now(UTC), book_seconds))
    h_log(
        "runtime_book",
        "published",
        selected_markets=selected,
        published_markets=published,
        available_books=available,
        empty_books=empty,
        missing_books=published - available,
        deleted=deleted,
        pending=pending,
        requests=ips.requests,
        seconds=time.monotonic() - started,
    )
    return Result.PENDING if pending else Result.COMPLETE
