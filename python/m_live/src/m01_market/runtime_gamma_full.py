"""Gamma owns event/market/outcome metadata; publish only a complete cursor sweep."""

import json
import time
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation

from psycopg.types.json import Jsonb

from h_shared.h_db import h_connect, h_upsert
from h_shared.h_ip_pool import ContractError, IPPool
from h_shared.h_log import h_log
from h_shared.h_process import Result


def runtime_gamma_full(ips: IPPool, *, page_size: int, max_pages: int, write_batch: int) -> Result:
    started = time.monotonic()
    scan_started = datetime.now(UTC)
    events, markets, outcomes, pages = c01_scan(ips, page_size, max_pages)
    c02_publish(events, markets, outcomes, write_batch, scan_started)
    ips.report(success=len(events) + len(markets) + len(outcomes), no_data=int(not events))
    c03_report(events, markets, outcomes, pages, ips.requests, started)
    return Result.COMPLETE


def c01_scan(ips: IPPool, page_size: int, max_pages: int) -> tuple[list, list, list, int]:
    events, markets, outcomes = {}, {}, {}
    cursor, cursors = None, set()
    for page in range(max_pages):
        params = {
            "limit": page_size,
            "closed": "false",
            "version": ["v1", "v2"],
            "_lac_ts": str(time.time_ns()),
        }
        if cursor:
            params["after_cursor"] = cursor
        response = ips.request(
            "GET",
            "https://gamma-api.polymarket.com/events/keyset",
            params=params,
            target=f"events page {page + 1}",
        )
        if not isinstance(response, dict) or not isinstance(response.get("events"), list):
            raise ContractError("Gamma keyset response lacks events array")
        observed = datetime.now(UTC)
        for event in response["events"]:
            event_row = s01_event(event, observed)
            events[event_row[0]] = event_row
            if not isinstance(event.get("markets"), list):
                raise ContractError("Gamma event lacks markets array")
            for ordinal, market in enumerate(event["markets"]):
                market_row, result_rows = s02_market(market, event_row[0], ordinal, observed)
                previous = markets.get(market_row[0])
                if previous and previous[1] != market_row[1]:
                    raise ContractError(
                        "Market has different event parents; design review required"
                    )
                markets[market_row[0]] = market_row
                for outcome in result_rows:
                    outcomes[(outcome[0], outcome[1])] = outcome
        cursor = response.get("next_cursor")
        h_log("runtime_gamma_full", "page", page=page + 1, events=len(events), markets=len(markets))
        if cursor is None:
            return list(events.values()), list(markets.values()), list(outcomes.values()), page + 1
        if not isinstance(cursor, str) or not cursor or cursor in cursors:
            raise ContractError("Invalid/repeated Gamma cursor")
        cursors.add(cursor)
    raise ContractError("Gamma cursor did not finish within declared max_pages")


def s01_event(event: dict, observed: datetime) -> tuple:
    tags = event.get("tags")
    if not isinstance(tags, list):
        raise ContractError("Gamma tags must be an array")
    tags = [
        {
            "id": s03_text(t.get("id"), True),
            "label": s03_text(t.get("label"), True),
            "slug": s03_text(t.get("slug"), True),
        }
        for t in tags
    ]
    return (
        s03_text(event.get("id"), True),
        s03_text(event.get("slug"), True),
        s03_text(event.get("title"), True),
        s03_text(event.get("description")),
        s03_text(event.get("resolutionSource")),
        s03_text(event.get("image")),
        s03_text(event.get("icon")),
        s06_date(event.get("startDate")),
        s06_date(event.get("endDate")),
        s04_bool(event.get("active")),
        s04_bool(event.get("closed")),
        s04_bool(event.get("archived")),
        s05_number(event.get("volume")),
        s05_number(event.get("volume24hr")),
        s05_number(event.get("liquidity")),
        Jsonb(tags),
        s06_date(event.get("updatedAt")),
        True,
        observed,
    )


def s02_market(market: dict, event_id: str, ordinal: int, observed: datetime) -> tuple:
    market_id = s03_text(market.get("id"), True)
    version = market.get("version")
    if version not in ("v1", "v2"):
        raise ContractError(f"Unsupported market version: {version}")
    labels = s07_array(market.get("outcomes"), False)
    assets = s07_array(market.get("clobTokenIds" if version == "v1" else "positionIds"), True)
    if assets and len(assets) != len(labels):
        raise ContractError(f"Outcome/asset length mismatch: {market_id}")
    status = s03_text(market.get("umaResolutionStatus" if version == "v1" else "resolutionStatus"))
    prices = s07_array(market.get("outcomePrices"), False) if status == "resolved" else []
    if status == "resolved" and len(prices) != len(labels):
        raise ContractError(f"Resolved outcome/price length mismatch: {market_id}")
    results = []
    for i, label in enumerate(labels):
        asset = s03_text(assets[i], True) if assets else None
        price = s05_number(prices[i]) if status == "resolved" else None
        if status == "resolved" and (price is None or price > 1):
            raise ContractError("Resolved price must be in [0,1]")
        results.append(
            (
                market_id,
                i,
                s03_text(label, True),
                asset if version == "v1" else None,
                asset if version == "v2" else None,
                asset,
                price,
            )
        )
    row = (
        market_id,
        event_id,
        ordinal,
        s03_text(market.get("conditionId")),
        version,
        s03_text(market.get("slug"), True),
        s03_text(market.get("question"), True),
        s03_text(market.get("groupItemTitle")),
        s03_text(market.get("description")),
        s03_text(market.get("resolutionSource")),
        s03_text(market.get("image")),
        s03_text(market.get("icon")),
        s06_date(market.get("startDate")),
        s06_date(market.get("endDate")),
        s04_bool(market.get("active")),
        s04_bool(market.get("closed")),
        s04_bool(market.get("archived")),
        s04_bool(market.get("acceptingOrders"), True),
        s04_bool(market.get("enableOrderBook"), True),
        s05_number(market.get("volumeNum")),
        s05_number(market.get("volume24hr")),
        s05_number(market.get("liquidityNum")),
        s06_date(market.get("updatedAt")),
        True,
        observed,
        s06_date(market.get("createdAt")),
        s06_date(market.get("closedTime")),
        status,
        observed if status == "resolved" else None,
    )
    return row, results


def s03_text(value, required: bool = False) -> str | None:
    if value is None or value == "":
        if required:
            raise ContractError("Required Gamma text is missing")
        return None
    if not isinstance(value, (str, int)) or isinstance(value, bool):
        raise ContractError("Gamma text/ID has invalid type")
    return str(value)


def s04_bool(value, optional: bool = False) -> bool | None:
    if value is None and optional:
        return None
    if type(value) is not bool:
        raise ContractError("Gamma flag is missing or not boolean")
    return value


def s05_number(value) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        raise ContractError("Invalid Gamma number") from None
    if not number.is_finite() or number < 0:
        raise ContractError("Gamma amount must be finite and nonnegative")
    return number


def s06_date(value) -> datetime | None:
    if value is None or value == "":
        return None
    try:
        result = datetime.fromisoformat(value)
    except (ValueError, AttributeError):
        raise ContractError("Invalid Gamma timestamp") from None
    if result.tzinfo is None:
        raise ContractError("Gamma timestamp has no timezone")
    return result.astimezone(UTC)


def s07_array(value, optional: bool) -> list:
    if value is None and optional:
        return []
    try:
        array = json.loads(value) if isinstance(value, str) else value
    except ValueError:
        raise ContractError("Invalid Gamma JSON array") from None
    if not isinstance(array, list):
        raise ContractError("Gamma value is not an array")
    return array


def c02_publish(
    events: list[tuple],
    markets: list[tuple],
    outcomes: list[tuple],
    batch: int,
    scan_started: datetime | None = None,
) -> int:
    """Publish metadata and outcomes atomically; source time guards both writers."""
    events = sorted(events, key=lambda r: r[0])
    markets = sorted(markets, key=lambda r: r[0])
    event_ids, market_ids = [r[0] for r in events], [r[0] for r in markets]
    published = datetime.now(UTC)
    events = [r[:18] + (published,) for r in events]
    markets = [r[:24] + (published,) + r[25:] for r in markets]
    with h_connect() as connection:
        # Both writers acquire existing rows in the same event -> market order.
        # The full sweep also locks rows whose membership may be withdrawn.
        connection.execute(
            """SELECT event_id FROM m_live.m01_event
            WHERE event_id = ANY(%s) OR (%s AND in_current_scan)
            ORDER BY event_id FOR UPDATE""",
            (event_ids, scan_started is not None),
        ).close()
        h_upsert(
            connection,
            """INSERT INTO m_live.m01_event
            (event_id, slug, title, description, resolution_source, image_url, icon_url, start_at,
             end_at, active, closed, archived, volume_total, volume_24h, liquidity, tags,
             source_updated_at, in_current_scan, m_live_updated_at) VALUES """,
            """
            ON CONFLICT (event_id) DO UPDATE SET slug=EXCLUDED.slug, title=EXCLUDED.title,
            description=EXCLUDED.description, resolution_source=EXCLUDED.resolution_source,
            image_url=EXCLUDED.image_url, icon_url=EXCLUDED.icon_url, start_at=EXCLUDED.start_at,
            end_at=EXCLUDED.end_at, active=EXCLUDED.active, closed=EXCLUDED.closed,
            archived=EXCLUDED.archived, volume_total=EXCLUDED.volume_total, volume_24h=EXCLUDED.volume_24h,
            liquidity=EXCLUDED.liquidity, tags=EXCLUDED.tags, source_updated_at=EXCLUDED.source_updated_at,
            in_current_scan=EXCLUDED.in_current_scan, m_live_updated_at=EXCLUDED.m_live_updated_at
            WHERE m01_event.source_updated_at IS NULL
               OR EXCLUDED.source_updated_at >= m01_event.source_updated_at""",
            events,
            batch,
        )
        if scan_started is not None:
            connection.execute(
                """UPDATE m_live.m01_event SET in_current_scan=false, m_live_updated_at=%s
                WHERE in_current_scan AND NOT (event_id=ANY(%s)) AND m_live_updated_at < %s""",
                (published, event_ids, scan_started),
            )
        connection.execute(
            """SELECT market_id FROM m_live.m01_market
            WHERE market_id=ANY(%s) OR (%s AND in_current_scan)
            ORDER BY market_id FOR UPDATE""",
            (market_ids, scan_started is not None),
        ).close()
        accepted = set()
        for start in range(0, len(markets), batch):
            rows = markets[start : start + batch]
            values = ",".join(["(" + ",".join(["%s"] * 29) + ")"] * len(rows))
            accepted.update(
                r[0]
                for r in connection.execute(
                    """INSERT INTO m_live.m01_market
                (market_id,event_id,sort_order,condition_id,protocol_version,slug,question,group_title,
                 description,resolution_source,image_url,icon_url,start_at,end_at,active,closed,archived,
                 accepting_orders,enable_order_book,volume_total,volume_24h,liquidity,source_updated_at,
                 in_current_scan,m_live_updated_at,created_at,closed_time,resolution_status,resolved_seen_at)
                VALUES """
                    + values
                    + """ ON CONFLICT (market_id) DO UPDATE SET
                event_id=EXCLUDED.event_id,sort_order=EXCLUDED.sort_order,condition_id=EXCLUDED.condition_id,
                protocol_version=EXCLUDED.protocol_version,slug=EXCLUDED.slug,question=EXCLUDED.question,
                group_title=EXCLUDED.group_title,description=EXCLUDED.description,
                resolution_source=EXCLUDED.resolution_source,image_url=EXCLUDED.image_url,
                icon_url=EXCLUDED.icon_url,start_at=EXCLUDED.start_at,end_at=EXCLUDED.end_at,
                active=EXCLUDED.active,closed=EXCLUDED.closed,archived=EXCLUDED.archived,
                accepting_orders=EXCLUDED.accepting_orders,enable_order_book=EXCLUDED.enable_order_book,
                volume_total=EXCLUDED.volume_total,volume_24h=EXCLUDED.volume_24h,liquidity=EXCLUDED.liquidity,
                source_updated_at=EXCLUDED.source_updated_at,in_current_scan=EXCLUDED.in_current_scan,
                m_live_updated_at=EXCLUDED.m_live_updated_at,created_at=EXCLUDED.created_at,
                closed_time=EXCLUDED.closed_time,resolution_status=EXCLUDED.resolution_status,
                resolved_seen_at=COALESCE(m01_market.resolved_seen_at,EXCLUDED.resolved_seen_at)
                WHERE m01_market.source_updated_at IS NULL
                   OR EXCLUDED.source_updated_at >= m01_market.source_updated_at
                RETURNING market_id""",
                    [v for row in rows for v in row],
                )
            )
        if scan_started is not None:
            connection.execute(
                """UPDATE m_live.m01_market SET in_current_scan=false, m_live_updated_at=%s
                WHERE in_current_scan AND NOT (market_id=ANY(%s)) AND m_live_updated_at < %s""",
                (published, market_ids, scan_started),
            )
        # Market locks and RETURNING prevent a stale response from changing outcomes.
        h_upsert(
            connection,
            """INSERT INTO m_live.m01_outcome
            (market_id,outcome_index,label,token_id,position_id,asset_id,resolved_price) VALUES """,
            """ ON CONFLICT (market_id,outcome_index) DO UPDATE SET label=EXCLUDED.label,
            token_id=EXCLUDED.token_id,position_id=EXCLUDED.position_id,asset_id=EXCLUDED.asset_id,
            resolved_price=EXCLUDED.resolved_price""",
            sorted((r for r in outcomes if r[0] in accepted), key=lambda r: (r[0], r[1])),
            batch,
        )
    return len(accepted)


def c03_report(
    events: list, markets: list, outcomes: list, pages: int, requests: int, started: float
) -> None:
    h_log(
        "runtime_gamma_full",
        "published",
        events=len(events),
        markets=len(markets),
        outcomes=len(outcomes),
        assets=sum(r[5] is not None for r in outcomes),
        pages=pages,
        requests=requests,
        seconds=time.monotonic() - started,
    )
