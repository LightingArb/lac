"""Read all open assets and publish endpoint-specific values and observation times."""

import time
from contextlib import closing
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation

from h_shared.h_db import h_connect, h_upsert
from h_shared.h_ip_pool import ContractError, IPPool
from h_shared.h_log import h_log
from h_shared.h_process import Result


def runtime_clob(ips: IPPool, *, request_items: int, write_batch: int, report_every: int) -> Result:
    started = time.monotonic()
    assets = c01_assets()
    if not assets:
        h_log("runtime_clob", "unavailable", reason="No published open assets")
        return Result.NOT_UPDATED
    c02_refresh(ips, assets, request_items, write_batch, report_every)
    c03_report(assets, started, ips.requests)
    return Result.COMPLETE


def c01_assets() -> list[str]:
    with h_connect() as connection:
        return [
            r[0]
            for r in connection.execute("""
            SELECT o.asset_id FROM m_live.m01_outcome AS o
            JOIN m_live.m01_market AS m ON m.market_id=o.market_id
            JOIN m_live.m01_event AS e ON e.event_id=m.event_id
            WHERE e.in_current_scan AND e.active AND NOT e.closed AND NOT e.archived
              AND m.in_current_scan AND m.active AND NOT m.closed AND NOT m.archived
              AND o.asset_id IS NOT NULL ORDER BY o.asset_id
        """)
        ]


def c02_refresh(
    ips: IPPool, assets: list[str], request_items: int, write_batch: int, report_every: int
) -> None:
    for endpoint in ("prices", "midpoints", "last-trades-prices"):
        size = request_items // 2 if endpoint == "prices" else request_items
        tasks = [(endpoint, assets[i : i + size]) for i in range(0, len(assets), size)]
        returned = 0

        def fetch(task):
            return s01_fetch(ips, *task)

        # Workers do network I/O only; one connection publishes each bounded response.
        with h_connect() as connection, closing(ips.map(fetch, tasks)) as responses:
            for index, (rows, count) in enumerate(responses):
                s03_write(connection, endpoint, rows, write_batch)
                connection.commit()
                ips.report(success=count, no_data=len(rows) - count)
                returned += count
                if (index + 1) % report_every == 0:
                    h_log(
                        "runtime_clob",
                        "batches",
                        endpoint=endpoint,
                        completed=index + 1,
                        total=len(tasks),
                    )
        h_log(
            "runtime_clob",
            "endpoint",
            endpoint=endpoint,
            requested=len(assets),
            returned=returned,
            missing=len(assets) - returned,
            batches=len(tasks),
        )


def s01_fetch(ips: IPPool, endpoint: str, assets: list[str]) -> tuple[list[tuple], int]:
    body = (
        [{"token_id": token, "side": side} for token in assets for side in ("BUY", "SELL")]
        if endpoint == "prices"
        else [{"token_id": token} for token in assets]
    )
    response = ips.request(
        "POST", "https://clob.polymarket.com/" + endpoint, body=body, target=assets
    )
    observed = datetime.now(UTC)
    if endpoint == "last-trades-prices":
        if not isinstance(response, list):
            raise ContractError("last-trades-prices response must be a list")
        response = {r["token_id"]: r for r in response}
    if not isinstance(response, dict) or not set(response).issubset(assets):
        raise ContractError("Unexpected CLOB response keys")
    rows = []
    for token in assets:
        value = response.get(token)
        if endpoint == "prices":
            if value is not None and not isinstance(value, dict):
                raise ContractError("CLOB prices must contain side maps")
            bid = s02_price(value.get("BUY")) if value is not None else None
            ask = s02_price(value.get("SELL")) if value is not None else None
            # REST BUY/SELL are book sides (verified against /book), not execution sides.
            rows.append((token, None if bid == 0 else bid, None if ask == 1 else ask, observed))
        elif endpoint == "midpoints":
            rows.append((token, s02_price(value), observed))
        else:
            side = value.get("side") if value is not None else None
            if side not in (None, "", "BUY", "SELL"):
                raise ContractError("Unknown last trade side")
            rows.append(
                (token, s02_price(value.get("price")) if side else None, side or None, observed)
            )
    return rows, len(response)


def s02_price(value) -> Decimal | None:
    if value is None:
        return None
    try:
        price = Decimal(str(value))
    except InvalidOperation:
        raise ContractError("Invalid CLOB price") from None
    if not price.is_finite() or not 0 <= price <= 1:
        raise ContractError("CLOB price outside [0,1]")
    return price


def s03_write(connection, endpoint: str, rows: list[tuple], batch: int) -> None:
    if endpoint == "prices":
        h_upsert(
            connection,
            """INSERT INTO m_live.m02_clob_price
            (asset_id,best_bid,best_ask,quote_observed_at) VALUES """,
            """
            ON CONFLICT (asset_id) DO UPDATE SET best_bid=EXCLUDED.best_bid,
            best_ask=EXCLUDED.best_ask,quote_observed_at=EXCLUDED.quote_observed_at""",
            rows,
            batch,
        )
    elif endpoint == "midpoints":
        h_upsert(
            connection,
            """INSERT INTO m_live.m02_clob_price
            (asset_id,midpoint,mid_observed_at) VALUES """,
            """
            ON CONFLICT (asset_id) DO UPDATE SET midpoint=EXCLUDED.midpoint,
            mid_observed_at=EXCLUDED.mid_observed_at""",
            rows,
            batch,
        )
    else:
        h_upsert(
            connection,
            """INSERT INTO m_live.m02_clob_price
            (asset_id,last_trade_price,last_trade_side,last_observed_at) VALUES """,
            """
            ON CONFLICT (asset_id) DO UPDATE SET last_trade_price=EXCLUDED.last_trade_price,
            last_trade_side=EXCLUDED.last_trade_side,last_observed_at=EXCLUDED.last_observed_at""",
            rows,
            batch,
        )


def c03_report(assets: list[str], started: float, requests: int) -> None:
    with h_connect() as connection:
        counts = connection.execute(
            """SELECT count(*),count(best_bid),count(best_ask),
            count(midpoint),count(last_trade_price) FROM m_live.m02_clob_price
            WHERE asset_id=ANY(%s)""",
            (assets,),
        ).fetchone()
    h_log(
        "runtime_clob",
        "published",
        requested_assets=len(assets),
        rows=counts[0],
        bid=counts[1],
        ask=counts[2],
        midpoint=counts[3],
        last_trade=counts[4],
        missing_bid=len(assets) - counts[1],
        missing_ask=len(assets) - counts[2],
        missing_midpoint=len(assets) - counts[3],
        requests=requests,
        seconds=time.monotonic() - started,
    )
