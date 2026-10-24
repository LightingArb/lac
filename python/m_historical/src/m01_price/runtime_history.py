"""Persist missing UTC market-days; only provider minute buckets become history."""

import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, nullcontext
from datetime import UTC, date, datetime, timedelta
from datetime import time as day_time
from decimal import Decimal, InvalidOperation
from functools import partial

from h_shared.h_db import h_connect
from h_shared.h_ip_pool import ContractError, IPPool, ProviderError
from h_shared.h_log import h_log
from h_shared.h_process import Result


def runtime_history(
    ips: IPPool,
    *,
    max_items: int,
    first_day: date,
    lookback_days: int,
    settle_minutes: int,
    max_pending_writes: int,
    errors_only: bool = False,
) -> Result:
    """Publish pending days, or retry one frozen error cohort exactly once.

    The entry point holds the module lock. HTTP uses the supplied pool; writes
    use one autocommit connection, never a transaction spanning external I/O.
    """
    started = time.monotonic()
    # One autocommit connection for this round. Only the writer uses it during HTTP;
    # selection and the final pending check happen outside the writer's lifetime.
    with h_connect(autocommit=True) as connection:
        selected = published = empty = errors = 0
        # WITH HOLD freezes only identities in PostgreSQL's private cursor
        # storage at statement commit. Fetch bounded pages without holding a
        # transaction during HTTP, even when the error cohort is large.
        with (
            connection.cursor(name="history_errors", withhold=True, scrollable=False)
            if errors_only
            else nullcontext(None)
        ) as frozen:
            items = c01_select(
                connection,
                max_items,
                lookback_days,
                settle_minutes,
                datetime.now(UTC),
                first_day,
                errors_cursor=frozen,
            )
            while items:
                written, no_data, failed = c02_collect(
                    ips, connection, items, max_pending_writes, errors_only=errors_only
                )
                selected += len(items)
                published += written
                empty += no_data
                errors += failed
                items = frozen.fetchmany(max_items) if frozen is not None else []
        pending = not errors_only and bool(
            c01_select(connection, 1, lookback_days, settle_minutes, datetime.now(UTC), first_day)
        )
    return c03_report(ips, selected, published, empty, errors, pending, started)


def c01_select(
    connection,
    maximum: int,
    lookback_days: int,
    settle_minutes: int,
    now: datetime,
    first_day: date,
    *,
    errors_cursor=None,
) -> list[tuple[str, str, date]]:
    today = now.astimezone(UTC).date()
    last_day = today - timedelta(days=1)
    if now.astimezone(UTC) < datetime.combine(today, day_time(), UTC) + timedelta(
        minutes=settle_minutes
    ):
        last_day -= timedelta(days=1)
    # Waiting for yesterday does not move the oldest boundary back to an eighth day.
    oldest = max(first_day, today - timedelta(days=lookback_days))
    selection = (
        "EXISTS (SELECT 1 FROM m_historical.m01_price_day AS p "
        "WHERE p.market_id=e.market_id AND p.day=d.day AND p.status='error')"
        if errors_cursor is not None
        else "NOT EXISTS (SELECT 1 FROM m_historical.m01_price_day AS p "
        "WHERE p.market_id=e.market_id AND p.day=d.day)"
    )
    statement = (
        """WITH eligible AS MATERIALIZED (
            SELECT m.market_id,m.created_at,m.closed,m.closed_time,
                min(o.asset_id) FILTER (WHERE o.outcome_index=0) AS asset_id
            FROM m_live.m01_market AS m
            JOIN m_live.m01_outcome AS o ON o.market_id=m.market_id
            WHERE m.created_at IS NOT NULL AND (NOT m.closed OR m.closed_time IS NOT NULL)
            GROUP BY m.market_id
            HAVING count(*)=2 AND count(o.asset_id)=2
                AND count(*) FILTER (WHERE o.outcome_index=0)=1
        ), days AS (
            SELECT %s::date + offset_day AS day
            FROM generate_series(0, %s::date - %s::date) AS offset_day
        )
        SELECT e.market_id,e.asset_id,d.day
        FROM days AS d CROSS JOIN eligible AS e
        WHERE e.created_at < (d.day + 1)::timestamp AT TIME ZONE 'UTC'
            AND (NOT e.closed OR e.closed_time > d.day::timestamp AT TIME ZONE 'UTC')
            AND """
        + selection
        + " ORDER BY d.day,e.market_id"
    )
    parameters = (oldest, last_day, oldest)
    if errors_cursor is not None:
        errors_cursor.execute(statement, parameters)
        return errors_cursor.fetchmany(maximum)
    return connection.execute(statement + " LIMIT %s", (*parameters, maximum)).fetchall()


def c02_collect(
    ips: IPPool,
    connection,
    items: list[tuple[str, str, date]],
    max_pending_writes: int,
    *,
    errors_only: bool = False,
) -> tuple[int, int, int]:
    if max_pending_writes < 1:
        raise ValueError("Declare a positive pending-write bound")
    published = empty = errors = 0
    # Each response is one write batch. The bound includes the active write;
    # the IP pool retains at most its declared number of fetch futures.
    with (
        ThreadPoolExecutor(max_workers=1) as writer,
        closing(ips.map(partial(s01_fetch, ips), items)) as responses,
    ):
        pending = deque()
        try:
            for row in responses:
                pending.append(
                    writer.submit(s03_publish, ips, connection, row, errors_only=errors_only)
                )
                while pending and (pending[0].done() or len(pending) >= max_pending_writes):
                    written, no_data, failed = pending.popleft().result()
                    published += written
                    empty += no_data
                    errors += failed
            for future in pending:
                written, no_data, failed = future.result()
                published += written
                empty += no_data
                errors += failed
        finally:
            for future in pending:
                future.cancel()
    return published, empty, errors


def s01_fetch(ips: IPPool, item: tuple[str, str, date]) -> tuple:
    market, asset, day = item
    start = int(datetime.combine(day, day_time(), UTC).timestamp())
    end = start + 86400
    requested = datetime.now(UTC)
    http_status = None
    try:
        response = ips.request(
            "GET",
            "https://data-api.polymarket.com/v2/prices-history",
            params={
                "token_id": asset,
                "start": start,
                "end": end,
                "bucket_seconds": 60,
                "limit": 10000,
            },
            target={"market_id": market, "day": day.isoformat()},
        )
        http_status = 200
        prices = s02_prices(response, start, end)
        return (
            market,
            asset,
            day,
            prices,
            requested,
            "success" if prices is not None else "no_data",
            None,
            None,
        )
    except (ContractError, ProviderError) as error:
        # Authentication and an exhausted IP pool keep their shared scheduling
        # semantics. No terminal error row is written for these blocking cases.
        if isinstance(error, ProviderError) and error.status in (401, 403, 429):
            raise
        ips.log_error(error, target={"market_id": market, "day": day.isoformat()})
        context = getattr(error, "context", getattr(ips.local, "context", {}))
        http_status = http_status or context.get("status") or getattr(error, "status", None) or None
        # The shared pool turns exhausted network exceptions into HTTP 0.
        # Preserve the underlying exception type without credential-bearing URLs.
        reason = str(error)
        if isinstance(error, ProviderError) and error.status == 0:
            reason = (
                type(error.__context__).__name__ if error.__context__ else "Network request failed"
            )
        return market, asset, day, None, requested, "error", reason, http_status


def s02_prices(response: dict, start: int, end: int) -> list[Decimal | None] | None:
    if not isinstance(response, dict) or not isinstance(response.get("data"), list):
        raise ContractError("History response lacks data array")
    pagination = response.get("pagination")
    if (
        not isinstance(pagination, dict)
        or pagination.get("has_more") is not False
        or "next_cursor" not in pagination
        or pagination["next_cursor"] is not None
    ):
        raise ContractError("History day must fit one complete page")
    prices, timestamps = [None] * 1440, [None] * 1440
    for point in response["data"]:
        if not isinstance(point, dict):
            raise ContractError("History point must be an object")
        timestamp, resolution = point.get("timestamp"), point.get("resolution_seconds")
        if type(timestamp) is not int or type(resolution) is not int or resolution not in (0, 60):
            raise ContractError("Invalid history timestamp/resolution")
        try:
            price = Decimal(str(point["price"]))
        except (KeyError, InvalidOperation):
            raise ContractError("Invalid history price") from None
        if not price.is_finite() or not 0 <= price <= 1:
            raise ContractError("History price outside [0,1]")
        if resolution != 60 or not start <= timestamp < end:
            continue
        minute = (timestamp - start) // 60
        if timestamps[minute] is None or timestamp > timestamps[minute]:
            timestamps[minute], prices[minute] = timestamp, price
    return prices if any(p is not None for p in prices) else None


def s03_publish(
    ips: IPPool, connection, row: tuple, *, errors_only: bool = False
) -> tuple[int, int, int]:
    conflict = (
        "DO UPDATE SET asset_id=EXCLUDED.asset_id, prices=EXCLUDED.prices, "
        "requested_at=EXCLUDED.requested_at, status=EXCLUDED.status, "
        "error_reason=EXCLUDED.error_reason, error_http_status=EXCLUDED.error_http_status, "
        "error_count=m01_price_day.error_count+EXCLUDED.error_count, "
        "m_historical_updated_at=EXCLUDED.m_historical_updated_at "
        "WHERE m01_price_day.status='error'"
        if errors_only
        else "DO NOTHING"
    )
    written = connection.execute(
        """INSERT INTO m_historical.m01_price_day
            (market_id,asset_id,day,prices,requested_at,status,error_reason,error_http_status,
             error_count,m_historical_updated_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,clock_timestamp())
        ON CONFLICT (market_id,day) """
        + conflict,
        (*row, int(row[5] == "error")),
    ).rowcount
    empty = int(written and row[5] == "no_data")
    errors = int(written and row[5] == "error")
    ips.report(success=written - empty - errors, no_data=empty, error=errors)
    h_log(
        "runtime_history",
        "batch",
        published=written,
        no_data=empty,
        error=errors,
        points=sum(p is not None for p in row[3]) if row[3] is not None else 0,
    )
    return written, empty, errors


def c03_report(
    ips: IPPool,
    selected: int,
    published: int,
    empty: int,
    errors: int,
    pending: bool,
    started: float,
) -> Result:
    h_log(
        "runtime_history",
        "published",
        selected=selected,
        published=published,
        no_data=empty,
        error=errors,
        pending=pending,
        requests=ips.requests,
        seconds=time.monotonic() - started,
    )
    return Result.PENDING if pending else Result.COMPLETE
