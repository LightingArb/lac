"""Refresh due binary markets through the IP pool; publish each response immediately."""

import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from functools import partial

from h_shared.h_db import h_connect
from h_shared.h_ip_pool import ContractError, IPPool
from h_shared.h_log import h_log
from h_shared.h_process import Result


def runtime_clob(
    ips: IPPool, *, request_items: int, max_markets: int, max_pending_writes: int
) -> Result:
    """Read demand, request public CLOB prices and replace current market quotes."""
    started = time.monotonic()
    markets, deleted = c01_markets(max_markets)
    published, bid, ask = c02_refresh(ips, markets, request_items, max_pending_writes)
    return c03_report(ips, len(markets), published, bid, ask, deleted, started)


def c01_markets(maximum: int) -> tuple[list[tuple[str, str]], int]:
    with h_connect() as connection:
        deleted = connection.execute("""
            DELETE FROM m_live.m02_clob_price AS p
            WHERE NOT EXISTS (
                SELECT 1 FROM m_live.m01_demand_market AS d WHERE d.market_id=p.market_id
            )
        """).rowcount
        markets = s01_due(connection, maximum, datetime.now(UTC))
    return markets, deleted


def s01_due(connection, maximum: int, now: datetime) -> list[tuple[str, str]]:
    return connection.execute(
        """WITH eligible AS (
            SELECT d.market_id, d.refresh_seconds,
                min(o.asset_id) FILTER (WHERE o.outcome_index=0) AS asset_id
            FROM m_live.m01_demand_market AS d
            JOIN m_live.m01_outcome AS o ON o.market_id=d.market_id
            GROUP BY d.market_id, d.refresh_seconds
            HAVING count(*)=2 AND count(o.asset_id)=2
                AND count(*) FILTER (WHERE o.outcome_index=0)=1
        )
        SELECT e.market_id,e.asset_id FROM eligible AS e
        LEFT JOIN m_live.m02_clob_price AS p ON p.market_id=e.market_id
        WHERE p.market_id IS NULL
           OR p.requested_at + e.refresh_seconds * interval '1 second' <= %s
        ORDER BY (p.market_id IS NOT NULL),
            p.requested_at + e.refresh_seconds * interval '1 second' NULLS FIRST,
            e.market_id
        LIMIT %s""",
        (now, maximum),
    ).fetchall()


def c02_refresh(
    ips: IPPool, markets: list[tuple[str, str]], size: int, max_pending_writes: int
) -> tuple[int, int, int]:
    if max_pending_writes < 1:
        raise ValueError("Declare a positive pending-write bound")
    if not markets:
        return 0, 0, 0
    batches = (markets[i : i + size] for i in range(0, len(markets), size))
    published = bid = ask = 0
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
                pending.append(writer.submit(s05_write, ips, connection, rows))
                while pending and (pending[0].done() or len(pending) >= max_pending_writes):
                    counts = pending.popleft().result()
                    published += counts[0]
                    bid += counts[1]
                    ask += counts[2]
            for future in pending:
                counts = future.result()
                published += counts[0]
                bid += counts[1]
                ask += counts[2]
        finally:
            for future in pending:
                future.cancel()
    return published, bid, ask


def s02_refresh(ips: IPPool, markets: list[tuple[str, str]]) -> list[tuple]:
    body = [{"token_id": asset, "side": side} for _, asset in markets for side in ("BUY", "SELL")]
    requested = datetime.now(UTC)
    response = ips.request(
        "POST", "https://clob.polymarket.com/prices", body=body, target=[m[0] for m in markets]
    )
    return s03_parse(response, markets, requested)


def s03_parse(response: dict, markets: list[tuple[str, str]], requested: datetime) -> list[tuple]:
    assets = {asset for _, asset in markets}
    if not isinstance(response, dict) or not set(response).issubset(assets):
        raise ContractError("Unexpected CLOB response keys")
    rows = []
    for market, asset in markets:
        value = response.get(asset)
        if value is not None and not isinstance(value, dict):
            raise ContractError("CLOB prices must contain side maps")
        bid = s04_price(value.get("BUY")) if value is not None else None
        ask = s04_price(value.get("SELL")) if value is not None else None
        # REST BUY/SELL are bid/ask; 0 bid and 1 ask denote absent book sides.
        rows.append(
            (market, asset, None if bid == 0 else bid, None if ask == 1 else ask, requested)
        )
    return rows


def s04_price(value) -> Decimal | None:
    if value is None:
        return None
    try:
        price = Decimal(str(value))
    except InvalidOperation:
        raise ContractError("Invalid CLOB price") from None
    if not price.is_finite() or not 0 <= price <= 1:
        raise ContractError("CLOB price outside [0,1]")
    return price


def s05_write(ips: IPPool, connection, rows: list[tuple]) -> tuple[int, int, int]:
    counts = s06_publish(connection, rows)
    ips.report(success=counts[0], no_data=sum(r[2] is None and r[3] is None for r in rows))
    return counts


def s06_publish(connection, rows: list[tuple]) -> tuple[int, int, int]:
    if not rows:
        return 0, 0, 0
    # Re-read current demand and first-outcome identity after HTTP. A late
    # response cannot reintroduce a withdrawn market or overwrite a newer quote.
    published = connection.execute(
        """WITH incoming AS (
            SELECT market_id,asset_id,best_bid,best_ask,requested_at
            FROM unnest(%s::text[],%s::text[],%s::numeric[],%s::numeric[],%s::timestamptz[])
                AS r(market_id,asset_id,best_bid,best_ask,requested_at)
        ), eligible AS (
            SELECT o.market_id,min(o.asset_id) FILTER (WHERE o.outcome_index=0) AS asset_id
            FROM m_live.m01_outcome AS o
            JOIN incoming AS r ON r.market_id=o.market_id
            JOIN m_live.m01_demand_market AS d ON d.market_id=o.market_id
            GROUP BY o.market_id
            HAVING count(*)=2 AND count(o.asset_id)=2
                AND count(*) FILTER (WHERE o.outcome_index=0)=1
        )
        INSERT INTO m_live.m02_clob_price
            (market_id,asset_id,best_bid,best_ask,requested_at,m_live_updated_at)
        SELECT r.market_id,r.asset_id,r.best_bid,r.best_ask,r.requested_at,clock_timestamp()
        FROM incoming AS r JOIN eligible AS e
            ON e.market_id=r.market_id AND e.asset_id=r.asset_id
        ORDER BY r.market_id
        ON CONFLICT (market_id) DO UPDATE SET
            asset_id=EXCLUDED.asset_id,best_bid=EXCLUDED.best_bid,best_ask=EXCLUDED.best_ask,
            requested_at=EXCLUDED.requested_at,m_live_updated_at=EXCLUDED.m_live_updated_at
        WHERE EXCLUDED.requested_at >= m02_clob_price.requested_at
        RETURNING best_bid,best_ask""",
        tuple([r[i] for r in rows] for i in range(5)),
    ).fetchall()
    return (
        len(published),
        sum(r[0] is not None for r in published),
        sum(r[1] is not None for r in published),
    )


def c03_report(
    ips: IPPool, selected: int, published: int, bid: int, ask: int, deleted: int, started: float
) -> Result:
    with h_connect() as connection:
        pending = bool(s01_due(connection, 1, datetime.now(UTC)))
    h_log(
        "runtime_clob",
        "published",
        selected_markets=selected,
        published_markets=published,
        bid=bid,
        ask=ask,
        deleted=deleted,
        pending=pending,
        requests=ips.requests,
        seconds=time.monotonic() - started,
    )
    return Result.PENDING if pending else Result.COMPLETE
