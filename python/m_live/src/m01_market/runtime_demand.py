"""Read product demand without writes to products; atomically publish ongoing markets."""

import json
import os

import psycopg

from h_shared.h_db import h_connect
from h_shared.h_ip_pool import IPPool
from h_shared.h_log import h_log
from h_shared.h_process import Result


def runtime_demand(
    ips: IPPool,
    *,
    products: list[str],
    refresh_seconds: dict[str, int],
    read_batch: int,
) -> Result:
    """Use product public tables and current market metadata; no external HTTP.

    refresh_seconds maps event tag slugs to intervals, with "default" for markets with none of them.
    """
    demands, errors = c01_products(products, read_batch)
    count = c02_publish(demands, refresh_seconds)
    c03_report(ips, count, errors, len(demands))
    return Result.COMPLETE


def c01_products(products: list[str], batch: int) -> tuple[dict, int]:
    merged, errors = {}, 0
    for product in products:
        try:
            rows = s01_read(product, batch)
        except (KeyError, ValueError, psycopg.Error) as error:
            # A failed product contributes no partial snapshot; others still publish.
            errors += 1
            h_log(
                "runtime_demand",
                "product_unavailable",
                product=product,
                reason=type(error).__name__,
            )
            continue
        for condition, seconds, levels in rows:
            previous = merged.get(condition)
            if previous is None:
                merged[condition] = (seconds, levels)
            else:
                merged[condition] = (
                    min(previous[0], seconds),
                    None if previous[1] is None or levels is None else max(previous[1], levels),
                )
    return merged, errors


def s01_read(product: str, batch: int) -> list[tuple]:
    if product not in {"crypto", "forex", "future", "weather", "sport", "stock"}:
        raise ValueError("Undeclared product")
    prefix = product.upper() + "_DB_"
    with psycopg.connect(
        host=os.environ[prefix + "HOST"],
        port=os.environ[prefix + "PORT"],
        dbname=os.environ[prefix + "NAME"],
        user=os.environ[prefix + "USER"],
        password=os.environ[prefix + "PASSWORD"],
        connect_timeout=10,
        options="-c statement_timeout=30000 -c default_transaction_read_only=on",
    ) as connection:
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        with connection.cursor(name="product_demand") as cursor:
            cursor.execute("""SELECT condition_id, refresh_seconds, book_levels
                FROM m_live.m01_polymarket_demand ORDER BY condition_id""")
            rows = []
            while batch_rows := cursor.fetchmany(batch):
                rows.extend(batch_rows)
    return rows


def c02_publish(demands: dict[str, tuple[int, int | None]], refresh: dict[str, int]) -> int:
    conditions = sorted(demands)
    with h_connect() as connection:
        connection.execute("DELETE FROM m_live.m01_demand_market")
        # Without a product request: the fastest interval among the event's tag slugs, else "default".
        result = connection.execute(
            """WITH config AS (SELECT %s::jsonb AS seconds)
            INSERT INTO m_live.m01_demand_market (market_id, refresh_seconds, book_levels)
            SELECT m.market_id,
                CASE WHEN d.condition_id IS NOT NULL THEN d.refresh_seconds
                     ELSE coalesce(
                        (SELECT min((c.seconds ->> (t ->> 'slug'))::integer)
                         FROM jsonb_array_elements(e.tags) AS t
                         WHERE t ->> 'slug' <> 'default' AND c.seconds ? (t ->> 'slug')),
                        (c.seconds ->> 'default')::integer) END,
                CASE WHEN d.condition_id IS NOT NULL THEN d.book_levels ELSE 0 END
            FROM m_live.m01_market AS m
            JOIN m_live.m01_event AS e ON e.event_id=m.event_id
            CROSS JOIN config AS c
            LEFT JOIN unnest(%s::text[], %s::integer[], %s::integer[])
                AS d(condition_id,refresh_seconds,book_levels) ON d.condition_id=m.condition_id
            WHERE m.in_current_scan AND m.active AND NOT m.closed AND NOT m.archived
              AND e.in_current_scan AND e.active AND NOT e.closed AND NOT e.archived""",
            (
                json.dumps(refresh),
                conditions,
                [demands[c][0] for c in conditions],
                [demands[c][1] for c in conditions],
            ),
        )
        return result.rowcount


def c03_report(ips: IPPool, markets: int, errors: int, requested: int) -> None:
    ips.report(success=markets, no_data=int(markets == 0), error=errors)
    h_log(
        "runtime_demand",
        "published",
        markets=markets,
        product_conditions=requested,
        unavailable_products=errors,
    )
