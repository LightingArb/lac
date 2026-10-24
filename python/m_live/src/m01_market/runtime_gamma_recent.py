"""Discover recent markets and follow unresolved or missing markets in bounded rounds."""

import json
import time
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation

from psycopg.types.json import Jsonb

from h_shared.h_db import h_connect, h_upsert
from h_shared.h_ip_pool import ContractError, IPPool
from h_shared.h_log import h_log
from h_shared.h_process import Result

_after_market = ""


def runtime_gamma_recent(
    ips: IPPool,
    *,
    page_size: int,
    max_pages: int,
    overlap_seconds: int,
    lookback_hours: int,
    follow_limit: int,
    event_batch: int,
    write_batch: int,
) -> Result:
    """Read current DB bounds, request Gamma, then publish one atomic metadata batch."""
    global _after_market
    started = datetime.now(UTC)
    created, closed, follow = c01_bounds(started, lookback_hours, overlap_seconds, follow_limit)
    raw = c02_fetch(ips, created, closed, follow, page_size, max_pages)
    events, markets, outcomes = c03_parse(ips, raw, event_batch)
    accepted = c04_publish(events, markets, outcomes, write_batch)
    c05_report(ips, events, markets, outcomes, accepted, follow, created, closed)
    if follow:
        _after_market = follow[-1][0]
    return Result.COMPLETE


def c01_bounds(started: datetime, lookback: int, overlap: int, maximum: int) -> tuple:
    with h_connect() as connection:
        created, closed = connection.execute(
            "SELECT max(created_at), max(closed_time) FROM m_live.m01_market"
        ).fetchone()
        follow = connection.execute(
            """SELECT market_id, closed, in_current_scan FROM m_live.m01_market
            WHERE ((closed AND resolution_status IS DISTINCT FROM 'resolved')
                OR (NOT closed AND NOT in_current_scan)) AND market_id > %s
            ORDER BY market_id LIMIT %s""",
            (_after_market, maximum),
        ).fetchall()
        if len(follow) < maximum and _after_market:
            follow += connection.execute(
                """SELECT market_id, closed, in_current_scan FROM m_live.m01_market
                WHERE ((closed AND resolution_status IS DISTINCT FROM 'resolved')
                    OR (NOT closed AND NOT in_current_scan)) AND market_id <= %s
                ORDER BY market_id LIMIT %s""",
                (_after_market, maximum - len(follow)),
            ).fetchall()
    return (
        created - timedelta(seconds=overlap) if created else started - timedelta(hours=lookback),
        closed - timedelta(seconds=overlap) if closed else started - timedelta(hours=lookback),
        follow,
    )


def c02_fetch(
    ips: IPPool, created: datetime, closed: datetime, follow: list, page_size: int, max_pages: int
) -> dict:
    records = []
    for order, state, lower in (
        ("createdAt", "false", created),
        ("createdAt", "true", created),
        ("closedTime", "true", closed),
    ):
        records.extend(s01_scan(ips, order, state, lower, page_size, max_pages))
    records.extend(s02_follow(ips, [r[0] for r in follow], page_size))
    markets, first_resolved = {}, {}
    for market in records:
        status = market.get(
            "umaResolutionStatus" if market.get("version") == "v1" else "resolutionStatus"
        )
        if status == "resolved":
            key = str(market["id"])
            first_resolved[key] = min(
                first_resolved.get(key, market["_web_seen_at"]), market["_web_seen_at"]
            )
        previous = markets.get(str(market["id"]))
        if previous is None or (
            s08_date(market.get("updatedAt")) or datetime.min.replace(tzinfo=UTC)
        ) >= (s08_date(previous.get("updatedAt")) or datetime.min.replace(tzinfo=UTC)):
            markets[str(market["id"])] = market
    for key, seen in first_resolved.items():
        markets[key]["_web_seen_at"] = seen
    return markets


def s01_scan(
    ips: IPPool, order: str, state: str, lower: datetime, size: int, maximum: int
) -> list[dict]:
    records, cursors = [], set()
    cursor = None
    for page in range(maximum):
        params = {
            "closed": state,
            "order": order,
            "ascending": "false",
            "limit": size,
            "version": ["v1", "v2"],
            "_lac_ts": str(time.time_ns()),
        }
        if cursor:
            params["after_cursor"] = cursor
        response = ips.request(
            "GET",
            "https://gamma-api.polymarket.com/markets/keyset",
            params=params,
            target=f"{order}:{state}:{page + 1}",
        )
        if not isinstance(response, dict) or not isinstance(response.get("markets"), list):
            raise ContractError("Gamma keyset response lacks markets array")
        crossed = False
        observed = datetime.now(UTC)
        for market in response["markets"]:
            stamp = s08_date(market.get(order))
            if stamp is None:
                raise ContractError(f"Gamma ordered market lacks {order}")
            if stamp < lower:
                crossed = True
            else:
                records.append(market | {"_web_seen_at": observed})
        cursor = response.get("next_cursor")
        if crossed or cursor is None:
            return records
        if not isinstance(cursor, str) or not cursor or cursor in cursors:
            raise ContractError("Invalid/repeated Gamma cursor")
        cursors.add(cursor)
    h_log(
        "runtime_gamma_recent",
        "scan_capped",
        level="warning",
        order=order,
        closed=state,
        pages=maximum,
        lower=lower.isoformat(),
        collected=len(records),
    )
    return records


def s02_follow(ips: IPPool, ids: list[str], size: int) -> list[dict]:
    records = []
    for start in range(0, len(ids), size):
        batch = ids[start : start + size]
        response = ips.request(
            "GET",
            "https://gamma-api.polymarket.com/markets",
            params={
                "id": batch,
                "closed": "any",
                "limit": size,
                "version": ["v1", "v2"],
                "_lac_ts": str(time.time_ns()),
            },
            target=batch,
        )
        if not isinstance(response, list):
            raise ContractError("Gamma market batch must be an array")
        found = {str(m["id"]) for m in response}
        if not found.issubset(batch) or len(found) != len(response):
            raise ContractError("Gamma market batch returned unexpected/duplicate IDs")
        missing = sorted(set(batch) - found)
        if missing:
            h_log("runtime_gamma_recent", "follow_unavailable", market_ids=missing)
            ips.report(no_data=len(missing))
        observed = datetime.now(UTC)
        records.extend(market | {"_web_seen_at": observed} for market in response)
    return records


def c03_parse(ips: IPPool, raw: dict, batch_size: int) -> tuple[list, list, list]:
    parents, event_ids = {}, set()
    market_parents = {}
    for market_id, market in raw.items():
        embedded = market.get("events")
        if not isinstance(embedded, list) or len(embedded) != 1:
            raise ContractError("Market must have exactly one event parent")
        event = embedded[0]
        event_id = s05_text(event.get("id"), True)
        event_ids.add(event_id)
        market_parents[market_id] = event_id
        if isinstance(event.get("tags"), list) and isinstance(event.get("markets"), list):
            parents[event_id] = event
    missing = sorted(event_ids - parents.keys())
    for start in range(0, len(missing), batch_size):
        batch = missing[start : start + batch_size]
        response = ips.request(
            "GET",
            "https://gamma-api.polymarket.com/events",
            params={
                "id": batch,
                "closed": "any",
                "limit": batch_size,
                "version": ["v1", "v2"],
                "_lac_ts": str(time.time_ns()),
            },
            target=batch,
        )
        if not isinstance(response, list) or any(
            not isinstance(event, dict) or "id" not in event for event in response
        ):
            raise ContractError("Invalid Gamma event batch")
        returned = {str(event["id"]) for event in response}
        if not returned.issubset(batch) or len(returned) != len(response):
            raise ContractError("Gamma event batch returned unexpected/duplicate parents")
        absent = sorted(set(batch) - returned)
        if absent:
            h_log("runtime_gamma_recent", "parents_unavailable", level="warning", event_ids=absent)
        for event in response:
            if event.get("tags") is not None and not isinstance(event["tags"], list):
                raise ContractError("Gamma parent lookup lacks tags; design review required")
            parents[str(event["id"])] = event
    observed = datetime.now(UTC)
    events, markets, outcomes, ordinals = [], [], [], {}
    for event_id in sorted(parents):
        event = parents[event_id]
        if not isinstance(event.get("markets"), list):
            raise ContractError("Gamma parent lacks markets array")
        ordinals[event_id] = {str(m["id"]): i for i, m in enumerate(event["markets"])}
        events.append(s03_event(event, observed))
    for market_id in sorted(raw):
        event_id = market_parents[market_id]
        if event_id not in parents:
            continue
        if market_id not in ordinals[event_id]:
            raise ContractError("Gamma market missing from its parent lookup")
        row, results = s04_market(
            raw[market_id], event_id, ordinals[event_id][market_id], raw[market_id]["_web_seen_at"]
        )
        markets.append(row)
        outcomes.extend(results)
    return events, markets, outcomes


def s03_event(event: dict, observed: datetime) -> tuple:
    tags = event.get("tags")
    # This row is from the full event endpoint, including a completed parent lookup.
    if tags is None:
        tags = []
    if not isinstance(tags, list):
        raise ContractError("Gamma tags must be an array")
    tags = [
        {
            "id": s05_text(t.get("id"), True),
            "label": s05_text(t.get("label"), True),
            "slug": s05_text(t.get("slug"), True),
        }
        for t in tags
    ]
    return (
        s05_text(event.get("id"), True),
        s05_text(event.get("slug"), True),
        s05_text(event.get("title"), True),
        s05_text(event.get("description")),
        s05_text(event.get("resolutionSource")),
        s05_text(event.get("image")),
        s05_text(event.get("icon")),
        s08_date(event.get("startDate")),
        s08_date(event.get("endDate")),
        s06_bool(event.get("active")),
        s06_bool(event.get("closed")),
        s06_bool(event.get("archived")),
        s07_number(event.get("volume")),
        s07_number(event.get("volume24hr")),
        s07_number(event.get("liquidity")),
        Jsonb(tags),
        s08_date(event.get("updatedAt")),
        True,
        observed,
    )


def s04_market(market: dict, event_id: str, ordinal: int, observed: datetime) -> tuple:
    market_id = s05_text(market.get("id"), True)
    version = market.get("version")
    if version not in ("v1", "v2"):
        raise ContractError(f"Unsupported market version: {version}")
    labels = s09_array(market.get("outcomes"), False)
    assets = s09_array(market.get("clobTokenIds" if version == "v1" else "positionIds"), True)
    if assets and len(assets) != len(labels):
        raise ContractError(f"Outcome/asset length mismatch: {market_id}")
    status = s05_text(market.get("umaResolutionStatus" if version == "v1" else "resolutionStatus"))
    prices = s09_array(market.get("outcomePrices"), False) if status == "resolved" else []
    if status == "resolved" and len(prices) != len(labels):
        raise ContractError(f"Resolved outcome/price length mismatch: {market_id}")
    results = []
    for i, label in enumerate(labels):
        asset = s05_text(assets[i], True) if assets else None
        price = s07_number(prices[i]) if status == "resolved" else None
        if status == "resolved" and (price is None or price > 1):
            raise ContractError("Resolved price must be in [0,1]")
        results.append(
            (
                market_id,
                i,
                s05_text(label, True),
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
        s05_text(market.get("conditionId")),
        version,
        s05_text(market.get("slug"), True),
        s05_text(market.get("question"), True),
        s05_text(market.get("groupItemTitle")),
        s05_text(market.get("description")),
        s05_text(market.get("resolutionSource")),
        s05_text(market.get("image")),
        s05_text(market.get("icon")),
        s08_date(market.get("startDate")),
        s08_date(market.get("endDate")),
        s06_bool(market.get("active")),
        s06_bool(market.get("closed")),
        s06_bool(market.get("archived")),
        s06_bool(market.get("acceptingOrders"), True),
        s06_bool(market.get("enableOrderBook"), True),
        s07_number(market.get("volumeNum")),
        s07_number(market.get("volume24hr")),
        s07_number(market.get("liquidityNum")),
        s08_date(market.get("updatedAt")),
        True,
        observed,
        s08_date(market.get("createdAt")),
        s08_date(market.get("closedTime")),
        status,
        observed if status == "resolved" else None,
    )
    return row, results


def s05_text(value, required: bool = False) -> str | None:
    if value is None or value == "":
        if required:
            raise ContractError("Required Gamma text is missing")
        return None
    if not isinstance(value, (str, int)) or isinstance(value, bool):
        raise ContractError("Gamma text/ID has invalid type")
    return str(value)


def s06_bool(value, optional: bool = False) -> bool | None:
    if value is None and optional:
        return None
    if type(value) is not bool:
        raise ContractError("Gamma flag is missing or not boolean")
    return value


def s07_number(value) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        raise ContractError("Invalid Gamma number") from None
    if not number.is_finite() or number < 0:
        raise ContractError("Gamma amount must be finite and nonnegative")
    return number


def s08_date(value) -> datetime | None:
    if value is None or value == "":
        return None
    try:
        result = datetime.fromisoformat(value)
    except (ValueError, AttributeError):
        raise ContractError("Invalid Gamma timestamp") from None
    if result.tzinfo is None:
        raise ContractError("Gamma timestamp has no timezone")
    return result.astimezone(UTC)


def s09_array(value, optional: bool) -> list:
    if value is None and optional:
        return []
    try:
        array = json.loads(value) if isinstance(value, str) else value
    except ValueError:
        raise ContractError("Invalid Gamma JSON array") from None
    if not isinstance(array, list):
        raise ContractError("Gamma value is not an array")
    return array


def c04_publish(
    events: list[tuple],
    markets: list[tuple],
    outcomes: list[tuple],
    batch: int,
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
        connection.execute(
            """SELECT event_id FROM m_live.m01_event
            WHERE event_id = ANY(%s)
            ORDER BY event_id FOR NO KEY UPDATE""",
            (event_ids,),
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
            in_current_scan=m01_event.in_current_scan, m_live_updated_at=EXCLUDED.m_live_updated_at
            WHERE m01_event.source_updated_at IS NULL
               OR EXCLUDED.source_updated_at >= m01_event.source_updated_at""",
            events,
            batch,
        )
        connection.execute(
            """SELECT market_id FROM m_live.m01_market
            WHERE market_id=ANY(%s)
            ORDER BY market_id FOR NO KEY UPDATE""",
            (market_ids,),
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
                source_updated_at=EXCLUDED.source_updated_at,in_current_scan=m01_market.in_current_scan,
                m_live_updated_at=EXCLUDED.m_live_updated_at,created_at=EXCLUDED.created_at,
                closed_time=EXCLUDED.closed_time,resolution_status=EXCLUDED.resolution_status,
                resolved_seen_at=COALESCE(m01_market.resolved_seen_at,EXCLUDED.resolved_seen_at)
                WHERE m01_market.source_updated_at IS NULL
                   OR EXCLUDED.source_updated_at >= m01_market.source_updated_at
                RETURNING market_id""",
                    [v for row in rows for v in row],
                )
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


def c05_report(
    ips: IPPool,
    events: list,
    markets: list,
    outcomes: list,
    accepted: int,
    follow: list,
    created: datetime,
    closed: datetime,
) -> None:
    previous = {r[0]: r for r in follow}
    # This is a bounded source observation, not a separate history table.
    transitions = [
        r[0]
        for r in markets
        if r[0] in previous and not previous[r[0]][1] and not previous[r[0]][2] and r[15]
    ]
    ips.report(success=len(events) + accepted + len(outcomes))
    h_log(
        "runtime_gamma_recent",
        "published",
        events=len(events),
        markets=len(markets),
        accepted_markets=accepted,
        outcomes=len(outcomes),
        followed=len(follow),
        created_lower=created.isoformat(),
        closed_lower=closed.isoformat(),
        absent_then_closed=transitions[:10],
    )
