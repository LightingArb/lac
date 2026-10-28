"""Keep every exit busy with CLOB /prices batches, earliest next refresh first (the shared dispatch
in h_dispatch); write a market's price only when it changed or the stored one is an interval old."""

from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from functools import partial

from h_shared.h_db import h_connect
from h_shared.h_ip_pool import ContractError, IPPool
from h_shared.h_process import Result
from m_live.src.h_dispatch import Picker, h_dispatch, h_merge


def runtime_clob(
    ips: IPPool,
    *,
    stop,
    once: bool,
    request_items: int,
    writers: int,
    max_pending_writes: int,
    summary_seconds: float,
) -> Result:
    """Resident: until stop is set, keep every exit's slots busy with batches of request_items
    markets, earliest due first (due or not; never fetched first), and write the responses on
    writers connections. once: never-fetched and due markets only, then return.

    Failed batches, the end of a call and the summary as in h_dispatch. Every summary_seconds:
    delete prices no longer demanded, reload the demand table into the schedule, log
    dispatch_summary.
    """
    return h_dispatch(
        ips,
        Picker("runtime_clob", request_items, once),
        stop=stop,
        maintain=c01_maintain,
        fetch=partial(s10_fetch, ips),
        write=partial(s15_write, ips),
        writers=writers,
        max_pending_writes=max_pending_writes,
        summary_seconds=summary_seconds,
    )


def c01_maintain(picker: Picker) -> dict[str, int]:
    with h_connect(autocommit=True) as connection:
        deleted = s01_delete_retired(connection)
        demand = s02_demand(connection)
    return {"deleted": deleted} | h_merge(picker, demand)


def s01_delete_retired(connection) -> int:
    # Rows are locked in market_id order, as writers lock them, so the two never deadlock.
    return connection.execute("""
        DELETE FROM m_live.m02_clob_price
        WHERE market_id IN (
            SELECT p.market_id FROM m_live.m02_clob_price AS p
            WHERE NOT EXISTS (
                SELECT 1 FROM m_live.m01_demand_market AS d WHERE d.market_id=p.market_id
            )
            ORDER BY p.market_id FOR UPDATE
        )
    """).rowcount


def s02_demand(connection) -> list[tuple]:
    """Demanded binary markets (both outcomes with an asset): first-outcome asset, interval and the
    stored price's requested_at in epoch seconds (None without a price row)."""
    return connection.execute("""
        SELECT d.market_id, min(o.asset_id) FILTER (WHERE o.outcome_index=0), d.refresh_seconds,
            extract(epoch FROM p.requested_at)::float8
        FROM m_live.m01_demand_market AS d
        JOIN m_live.m01_outcome AS o ON o.market_id=d.market_id
        LEFT JOIN m_live.m02_clob_price AS p ON p.market_id=d.market_id
        GROUP BY d.market_id, d.refresh_seconds, p.requested_at
        HAVING count(*)=2 AND count(o.asset_id)=2 AND count(*) FILTER (WHERE o.outcome_index=0)=1
    """).fetchall()


def s10_fetch(ips: IPPool, markets: list[tuple[str, str]]) -> list[tuple]:
    body = [{"token_id": asset, "side": side} for _, asset in markets for side in ("BUY", "SELL")]
    requested = datetime.now(UTC)
    response = ips.request(
        "POST", "https://clob.polymarket.com/prices", body=body, target=[m[0] for m in markets]
    )
    return s11_parse(response, markets, requested)


def s11_parse(response: dict, markets: list[tuple[str, str]], requested: datetime) -> list[tuple]:
    assets = {asset for _, asset in markets}
    if not isinstance(response, dict) or not set(response).issubset(assets):
        raise ContractError("Unexpected CLOB response keys")
    rows = []
    for market, asset in markets:
        value = response.get(asset)
        if value is not None and not isinstance(value, dict):
            raise ContractError("CLOB prices must contain side maps")
        bid = s12_price(value.get("BUY")) if value is not None else None
        ask = s12_price(value.get("SELL")) if value is not None else None
        # REST BUY/SELL are bid/ask; 0 bid and 1 ask denote absent book sides.
        rows.append(
            (market, asset, None if bid == 0 else bid, None if ask == 1 else ask, requested)
        )
    return rows


def s12_price(value) -> Decimal | None:
    if value is None:
        return None
    try:
        price = Decimal(str(value))
    except InvalidOperation:
        raise ContractError("Invalid CLOB price") from None
    if not price.is_finite() or not 0 <= price <= 1:
        raise ContractError("CLOB price outside [0,1]")
    return price


def s15_write(ips: IPPool, connection, rows: list[tuple]) -> int:
    counts = s16_publish(connection, rows)
    ips.report(success=len(rows), no_data=sum(r[2] is None and r[3] is None for r in rows))
    return counts[0]


def s16_publish(connection, rows: list[tuple]) -> tuple[int, int, int]:
    """Write a market only when its bid or ask differs from the stored row, or the stored row is
    at least one interval older than this request (or there is none yet)."""
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
            SELECT o.market_id,min(o.asset_id) FILTER (WHERE o.outcome_index=0) AS asset_id,
                min(d.refresh_seconds) AS refresh_seconds
            FROM m_live.m01_outcome AS o
            JOIN incoming AS r ON r.market_id=o.market_id
            JOIN m_live.m01_demand_market AS d ON d.market_id=o.market_id
            GROUP BY o.market_id
            HAVING count(*)=2 AND count(o.asset_id)=2
                AND count(*) FILTER (WHERE o.outcome_index=0)=1
        ), changed AS (
            SELECT r.* FROM incoming AS r
            JOIN eligible AS e ON e.market_id=r.market_id AND e.asset_id=r.asset_id
            LEFT JOIN m_live.m02_clob_price AS p ON p.market_id=r.market_id
            WHERE p.market_id IS NULL OR p.asset_id<>r.asset_id
                OR p.best_bid IS DISTINCT FROM r.best_bid
                OR p.best_ask IS DISTINCT FROM r.best_ask
                OR p.requested_at + e.refresh_seconds * interval '1 second' <= r.requested_at
        )
        INSERT INTO m_live.m02_clob_price
            (market_id,asset_id,best_bid,best_ask,requested_at,m_live_updated_at)
        SELECT market_id,asset_id,best_bid,best_ask,requested_at,clock_timestamp()
        FROM changed
        ORDER BY market_id
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
