"""Fixed-window history for the top-volume events; no fabricated minutes."""

import time
from contextlib import closing
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from itertools import islice

from h_shared.h_db import h_connect, h_upsert
from h_shared.h_ip_pool import ContractError, IPPool, ProviderError
from h_shared.h_log import h_log
from h_shared.h_process import Result


def runtime_polymarket(
    ips: IPPool,
    *,
    days: int,
    top_events: int,
    end: int,
    max_assets: int,
    publish_assets: int,
    page_limit: int,
    max_pages: int,
    bucket_seconds: int,
    write_batch: int,
) -> Result:
    started = time.monotonic()
    start = end - days * 86400
    assets, pending = c01_pending(top_events, start, end, max_assets)
    if not assets:
        c03_report(start, end, top_events, started, ips.requests)
        return Result.COMPLETE

    def fetch(asset):
        return c02_fetch(ips, asset, start, end, page_limit, max_pages, bucket_seconds)

    with closing(ips.map(fetch, assets)) as responses:
        while results := list(islice(responses, publish_assets)):
            s02_publish(results, start, end, write_batch)
            ips.report(
                success=sum(r[2] is None and bool(r[1]) for r in results),
                no_data=sum(r[2] is None and not r[1] for r in results),
                error=sum(r[2] is not None for r in results),
            )
            h_log(
                "runtime_polymarket",
                "batch",
                assets=len(results),
                points=sum(len(r[1]) for r in results),
                errors=sum(r[2] is not None for r in results),
            )
            errors = [r[2] for r in results if r[2] is not None]
            if errors:
                # Completed assets remain durable. Retry policy belongs to the outer caller.
                raise errors[0]
    h_log(
        "runtime_polymarket",
        "chunk",
        assets=len(assets),
        pending=pending,
        seconds=time.monotonic() - started,
        requests=ips.requests,
    )
    if pending:
        return Result.PENDING
    c03_report(start, end, top_events, started, ips.requests)
    return Result.COMPLETE


def c01_pending(top_events: int, start: int, end: int, maximum: int) -> tuple[list[str], bool]:
    with h_connect() as connection:
        rows = connection.execute(
            """
            WITH chosen AS MATERIALIZED (
                SELECT event_id FROM m_live.m01_event
                WHERE in_current_scan AND active AND NOT closed AND NOT archived
                ORDER BY volume_24h DESC NULLS LAST,event_id LIMIT %s
            ), assets AS MATERIALIZED (
                SELECT o.asset_id FROM chosen AS e
                JOIN m_live.m01_market AS m ON m.event_id=e.event_id
                JOIN m_live.m01_outcome AS o ON o.market_id=m.market_id
                WHERE m.in_current_scan AND o.asset_id IS NOT NULL
            )
            SELECT a.asset_id FROM assets AS a
            WHERE NOT EXISTS (
                SELECT 1 FROM m_historical.m01_polymarket_coverage AS c
                WHERE c.asset_id=a.asset_id AND c.status='success'
                  AND c.requested_start=to_timestamp(%s) AND c.requested_end=to_timestamp(%s)
            )
            ORDER BY a.asset_id LIMIT %s
        """,
            (top_events, start, end, maximum + 1),
        ).fetchall()
    # The approved top-event scope includes every nested outcome with an asset ID,
    # including closed nested markets. Coverage supplies the durable continuation state.
    return [r[0] for r in rows[:maximum]], len(rows) > maximum


def c02_fetch(
    ips: IPPool, asset: str, start: int, end: int, limit: int, max_pages: int, bucket_seconds: int
) -> tuple[str, list[tuple], Exception | None]:
    points, cursors = {}, set()
    params = {
        "token_id": asset,
        "start": start,
        "end": end,
        "bucket_seconds": bucket_seconds,
        "limit": limit,
    }
    try:
        for _ in range(max_pages):
            response = ips.request(
                "GET",
                "https://data-api.polymarket.com/v2/prices-history",
                params=params,
                target=asset,
            )
            parsed, cursor = s01_points(response, start, end)
            for minute, point in parsed.items():
                if minute not in points or point[0] > points[minute][0]:
                    points[minute] = point
            if cursor is None:
                rows = [
                    (
                        asset,
                        datetime.fromtimestamp(minute, UTC),
                        datetime.fromtimestamp(p[0], UTC),
                        p[1],
                        p[2],
                    )
                    for minute, p in sorted(points.items())
                ]
                return asset, rows, None
            if cursor in cursors:
                raise ContractError("Repeated history cursor")
            cursors.add(cursor)
            params["cursor"] = cursor
        raise ContractError("History pagination exceeded declared bound")
    except (ProviderError, ContractError) as error:
        ips.log_error(error, target=asset)
        return asset, [], error


def s01_points(response: dict, start: int, end: int) -> tuple[dict, str | None]:
    if not isinstance(response, dict) or not isinstance(response.get("data"), list):
        raise ContractError("History response lacks data array")
    pagination = response.get("pagination")
    if not isinstance(pagination, dict) or "next_cursor" not in pagination:
        raise ContractError("History response lacks pagination")
    cursor = pagination["next_cursor"]
    if cursor is not None and (not isinstance(cursor, str) or not cursor):
        raise ContractError("Invalid history cursor")
    if pagination.get("has_more") is not bool(cursor):
        raise ContractError("Inconsistent history pagination")
    points = {}
    for row in response["data"]:
        timestamp, resolution = row.get("timestamp"), row.get("resolution_seconds")
        if type(timestamp) is not int or type(resolution) is not int or resolution not in (0, 60):
            raise ContractError("Invalid history timestamp/resolution")
        try:
            price = Decimal(str(row["price"]))
        except (KeyError, InvalidOperation):
            raise ContractError("Invalid history price") from None
        if not price.is_finite() or not 0 <= price <= 1:
            raise ContractError("History price outside [0,1]")
        if not start <= timestamp < end:
            continue
        minute = timestamp // 60 * 60
        if minute not in points or timestamp > points[minute][0]:
            points[minute] = (timestamp, price, resolution)
    return points, cursor


def s02_publish(results: list[tuple], start: int, end: int, batch: int) -> None:
    observed = datetime.now(UTC)
    coverage = []
    with h_connect() as connection:
        assets = [r[0] for r in results]
        existing = {
            r[0]
            for r in connection.execute(
                """SELECT DISTINCT asset_id
            FROM m_historical.m01_polymarket_price WHERE asset_id=ANY(%s)""",
                (assets,),
            )
        }
        fresh, updates = [], []
        for asset, rows, error in results:
            if error is None:
                (updates if asset in existing else fresh).extend(rows)
            coverage.append(
                (
                    asset,
                    datetime.fromtimestamp(start, UTC),
                    datetime.fromtimestamp(end, UTC),
                    observed,
                    "error" if error else "success",
                    None if error else len(rows),
                    str(error) if error else None,
                )
            )
        if fresh:
            with connection.cursor().copy("""COPY m_historical.m01_polymarket_price
                (asset_id,minute_at,source_at,price,resolution_seconds) FROM STDIN""") as copy:
                for row in fresh:
                    copy.write_row(row)
        h_upsert(
            connection,
            """INSERT INTO m_historical.m01_polymarket_price
            (asset_id,minute_at,source_at,price,resolution_seconds) VALUES """,
            """
            ON CONFLICT (asset_id,minute_at) DO UPDATE SET source_at=EXCLUDED.source_at,
            price=EXCLUDED.price,resolution_seconds=EXCLUDED.resolution_seconds
            WHERE EXCLUDED.source_at>=m_historical.m01_polymarket_price.source_at""",
            updates,
            batch,
        )
        h_upsert(
            connection,
            """INSERT INTO m_historical.m01_polymarket_coverage
            (asset_id,requested_start,requested_end,checked_at,status,point_count,error_reason) VALUES """,
            """
            ON CONFLICT (asset_id) DO UPDATE SET requested_start=EXCLUDED.requested_start,
            requested_end=EXCLUDED.requested_end,checked_at=EXCLUDED.checked_at,status=EXCLUDED.status,
            point_count=EXCLUDED.point_count,error_reason=EXCLUDED.error_reason""",
            coverage,
            batch,
        )


def c03_report(start: int, end: int, top_events: int, started: float, requests: int) -> None:
    with h_connect() as connection:
        row = connection.execute(
            """SELECT count(*),sum(point_count),
            count(*) FILTER (WHERE status='success' AND point_count>0),
            count(*) FILTER (WHERE status='success' AND point_count=0),
            count(*) FILTER (WHERE status='error')
            FROM m_historical.m01_polymarket_coverage
            WHERE requested_start=to_timestamp(%s) AND requested_end=to_timestamp(%s)""",
            (start, end),
        ).fetchone()
    h_log(
        "runtime_polymarket",
        "coverage",
        top_events=top_events,
        start=start,
        end=end,
        assets=row[0],
        points=row[1],
        success=row[2],
        no_data=row[3],
        error=row[4],
        chunk_seconds=time.monotonic() - started,
        chunk_requests=requests,
    )
