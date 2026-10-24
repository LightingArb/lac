"""Discover recent markets and follow unresolved or missing markets in bounded rounds."""

import json
import time
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from psycopg.types.json import Jsonb

from h_shared.h_db import h_connect, h_upsert
from h_shared.h_ip_pool import ContractError, IPPool
from h_shared.h_log import h_log
from h_shared.h_process import Result

_after_market = ""
_after_event = ""


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
    game_follow_hours: int,
    game_follow_max: int,
) -> Result:
    """Publish ordinary metadata, then bounded event scores, with I/O outside transactions."""
    global _after_market, _after_event
    started = datetime.now(UTC)
    created, closed, follow = c01_bounds(started, lookback_hours, overlap_seconds, follow_limit)
    raw = c02_fetch(ips, created, closed, follow, page_size, max_pages)
    events, markets, outcomes = c03_parse(ips, raw, event_batch)
    accepted = c04_publish(events, markets, outcomes, write_batch)
    c05_report(ips, events, markets, outcomes, accepted, follow, created, closed)
    if follow:
        _after_market = follow[-1][0]
    games = c06_game_bounds(datetime.now(UTC), game_follow_hours, game_follow_max)
    scores = c07_fetch_games(ips, games, page_size)
    updated = c08_publish_games(scores, game_follow_hours, write_batch)
    ips.report(success=updated)
    if games:
        _after_event = games[-1][0]
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
    parents, event_ids, sports_only = {}, set(), set()
    market_parents = {}
    for market_id, market in raw.items():
        embedded = market.get("events")
        if not isinstance(embedded, list) or len(embedded) != 1:
            raise ContractError("Market must have exactly one event parent")
        event = embedded[0]
        event_id = s05_text(event.get("id"), True)
        event_ids.add(event_id)
        market_parents[market_id] = event_id
        complete = isinstance(event.get("tags"), list) and isinstance(event.get("markets"), list)
        sports = complete and any(t.get("slug") == "sports" for t in event["tags"])
        sports_fields = (
            "gameId",
            "startTime",
            "eventDate",
            "score",
            "period",
            "elapsed",
            "live",
            "ended",
            "finishedTimestamp",
            "teams",
            "sport",
        )
        if complete and sports and not all(field in event for field in sports_fields):
            sports_only.add(event_id)
        if complete and (not sports or all(field in event for field in sports_fields)):
            parents[event_id] = event
    missing = sorted(event_ids - parents.keys())
    additional_parents = sports_only
    requests_before, bytes_before = ips.requests, ips.response_bytes
    additional_requests = additional_bytes = 0
    # Keep sports-only supplements separate so their actual HTTP cost is measurable.
    for additional, group in (
        (False, sorted(set(missing) - additional_parents)),
        (True, sorted(set(missing) & additional_parents)),
    ):
        group_requests, group_bytes = ips.requests, ips.response_bytes
        for start in range(0, len(group), batch_size):
            batch = group[start : start + batch_size]
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
                h_log(
                    "runtime_gamma_recent", "parents_unavailable", level="warning", event_ids=absent
                )
            for event in response:
                if event.get("tags") is not None and not isinstance(event["tags"], list):
                    raise ContractError("Gamma parent lookup lacks tags; design review required")
                parents[str(event["id"])] = event
        if additional:
            additional_requests += ips.requests - group_requests
            additional_bytes += ips.response_bytes - group_bytes
    h_log(
        "runtime_gamma_recent",
        "parent_enrichment",
        parents=len(missing),
        sports_only_parents=len(set(missing) & sports_only),
        additional_requests=additional_requests,
        additional_response_bytes=additional_bytes,
        requests=ips.requests - requests_before,
        response_bytes=ips.response_bytes - bytes_before,
    )
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
            raw[market_id],
            event_id,
            ordinals[event_id][market_id],
            raw[market_id]["_web_seen_at"],
            sports=any(t.get("slug") == "sports" for t in (parents[event_id].get("tags") or [])),
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
    row = (
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
    if not any(t["slug"] == "sports" for t in tags):
        return row + (None,) * 11
    return row + (
        s10_raw_text(event.get("gameId"), identifier=True),
        s08_date(event.get("startTime")),
        s11_day(event.get("eventDate")),
        s10_raw_text(event.get("score")),
        s10_raw_text(event.get("period")),
        s10_raw_text(event.get("elapsed")),
        s06_bool(event.get("live"), True),
        s06_bool(event.get("ended"), True),
        s08_date(event.get("finishedTimestamp")),
        s12_object(event.get("teams"), list),
        s12_object(event.get("sport"), dict),
    )


def s04_market(
    market: dict, event_id: str, ordinal: int, observed: datetime, *, sports: bool = False
) -> tuple:
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
    if sports:
        row += (
            s10_raw_text(market.get("sportsMarketType")),
            s13_line(market.get("line")),
            s14_statuses(market.get("umaResolutionStatuses")),
        )
    else:
        row += (None, None, None)
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
    except (ValueError, AttributeError, TypeError):
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


def s10_raw_text(value, *, identifier: bool = False) -> str | None:
    """Preserve empty sports text; only gameId may arrive as an integer."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if identifier and type(value) is int:
        return str(value)
    raise ContractError("Invalid Gamma sports text/ID type")


def s11_day(value) -> date | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ContractError("Invalid Gamma game date")
    try:
        result = date.fromisoformat(value)
    except ValueError:
        raise ContractError("Invalid Gamma game date") from None
    if result.isoformat() != value:
        raise ContractError("Gamma game date must be YYYY-MM-DD")
    return result


def s12_object(value, kind: type) -> Jsonb | None:
    if value is None:
        return None
    if not isinstance(value, kind) or (
        kind is list and any(not isinstance(team, dict) for team in value)
    ):
        raise ContractError("Invalid Gamma teams/sport type")
    return Jsonb(value)


def s13_line(value) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise ContractError("Invalid Gamma sports line type")
    result = Decimal(str(value))
    if not result.is_finite():
        raise ContractError("Gamma sports line must be finite")
    return result


def s14_statuses(value) -> Jsonb | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ContractError("Gamma UMA statuses must be a JSON encoded string")
    try:
        result = json.loads(value)
    except ValueError:
        raise ContractError("Invalid Gamma UMA statuses JSON") from None
    if not isinstance(result, list) or any(not isinstance(v, str) for v in result):
        raise ContractError("Gamma UMA statuses must encode a text array")
    return Jsonb(result)


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
    events = [r[:18] + (published,) + r[19:] for r in events]
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
             source_updated_at, in_current_scan, m_live_updated_at,
             game_id, game_start_at, game_date, score, period, elapsed, live, ended, game_finished_at, teams, sport) VALUES """,
            """
            ON CONFLICT (event_id) DO UPDATE SET slug=EXCLUDED.slug, title=EXCLUDED.title,
            description=EXCLUDED.description, resolution_source=EXCLUDED.resolution_source,
            image_url=EXCLUDED.image_url, icon_url=EXCLUDED.icon_url, start_at=EXCLUDED.start_at,
            end_at=EXCLUDED.end_at, active=EXCLUDED.active, closed=EXCLUDED.closed,
            archived=EXCLUDED.archived, volume_total=EXCLUDED.volume_total, volume_24h=EXCLUDED.volume_24h,
            liquidity=EXCLUDED.liquidity, tags=EXCLUDED.tags, source_updated_at=EXCLUDED.source_updated_at,
            in_current_scan=m01_event.in_current_scan, m_live_updated_at=EXCLUDED.m_live_updated_at,
            game_id=EXCLUDED.game_id,
            game_start_at=EXCLUDED.game_start_at,
            game_date=EXCLUDED.game_date,
            score=EXCLUDED.score,
            period=EXCLUDED.period,
            elapsed=EXCLUDED.elapsed,
            live=EXCLUDED.live,
            ended=EXCLUDED.ended,
            game_finished_at=EXCLUDED.game_finished_at,
            teams=EXCLUDED.teams,
            sport=EXCLUDED.sport
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
            values = ",".join(["(" + ",".join(["%s"] * 32) + ")"] * len(rows))
            accepted.update(
                r[0]
                for r in connection.execute(
                    """INSERT INTO m_live.m01_market
                (market_id,event_id,sort_order,condition_id,protocol_version,slug,question,group_title,
                 description,resolution_source,image_url,icon_url,start_at,end_at,active,closed,archived,
                 accepting_orders,enable_order_book,volume_total,volume_24h,liquidity,source_updated_at,
                 in_current_scan,m_live_updated_at,created_at,closed_time,resolution_status,resolved_seen_at,
                 sports_market_type,line,uma_resolution_statuses)
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
                resolved_seen_at=COALESCE(m01_market.resolved_seen_at,EXCLUDED.resolved_seen_at),
                sports_market_type=EXCLUDED.sports_market_type,line=EXCLUDED.line,
                uma_resolution_statuses=EXCLUDED.uma_resolution_statuses
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
        follow_cursor=_after_market,
        follow_first=follow[0][0] if follow else None,
        follow_last=follow[-1][0] if follow else None,
        follow_wrapped=bool(_after_market and any(r[0] <= _after_market for r in follow)),
        created_lower=created.isoformat(),
        closed_lower=closed.isoformat(),
        absent_then_closed=transitions[:10],
    )


def c06_game_bounds(started: datetime, hours: int, maximum: int) -> list[tuple]:
    """Rotate event IDs independently; unknown oldest close time cannot qualify."""
    cutoff = started - timedelta(hours=hours)
    sql = """SELECT e.event_id, min(m.market_id), min(m.closed_time)
        FROM m_live.m01_event e JOIN m_live.m01_market m USING(event_id)
        WHERE e.ended IS DISTINCT FROM TRUE AND e.tags @> '[{{"slug":"sports"}}]'::jsonb
            AND m.closed AND e.event_id {comparison} %s
        GROUP BY e.event_id HAVING min(m.closed_time) >= %s
        ORDER BY e.event_id LIMIT %s"""
    with h_connect() as connection:
        games = connection.execute(
            sql.format(comparison=">"), (_after_event, cutoff, maximum)
        ).fetchall()
        if len(games) < maximum and _after_event:
            games += connection.execute(
                sql.format(comparison="<="), (_after_event, cutoff, maximum - len(games))
            ).fetchall()
    return games


def c07_fetch_games(ips: IPPool, games: list[tuple], size: int) -> list[tuple]:
    """One market per event; embedded scores never enter parent enrichment."""
    parents = {r[1]: r[0] for r in games}
    requests_before, bytes_before = ips.requests, ips.response_bytes
    requested = datetime.now(UTC)
    rows = []
    for market in s02_follow(ips, list(parents), size):
        embedded = market.get("events")
        if (
            not isinstance(embedded, list)
            or len(embedded) != 1
            or not isinstance(embedded[0], dict)
        ):
            raise ContractError("Game follow requires one embedded parent")
        event = embedded[0]
        event_id = s05_text(event.get("id"), True)
        if event_id != parents[str(market["id"])]:
            raise ContractError("Game follow returned unexpected parent")
        rows.append(
            (
                event_id,
                s10_raw_text(event.get("gameId"), identifier=True),
                s08_date(event.get("startTime")),
                s11_day(event.get("eventDate")),
                s10_raw_text(event.get("score")),
                s10_raw_text(event.get("period")),
                s10_raw_text(event.get("elapsed")),
                s06_bool(event.get("live"), True),
                s06_bool(event.get("ended"), True),
                s08_date(event.get("finishedTimestamp")),
                s08_date(event.get("updatedAt")),
                requested,
            )
        )
    h_log(
        "runtime_gamma_recent",
        "game_follow",
        events=len(games),
        returned=len(rows),
        cursor=_after_event,
        first=games[0][0] if games else None,
        last=games[-1][0] if games else None,
        requests=ips.requests - requests_before,
        response_bytes=ips.response_bytes - bytes_before,
    )
    return rows


def c08_publish_games(rows: list[tuple], hours: int, batch: int) -> int:
    """Only scores and publication/version clocks change; recheck lifetime after I/O."""
    rows = sorted(rows, key=lambda r: r[0])
    if not rows:
        return 0
    updated, ended = 0, []
    with h_connect() as connection:
        connection.execute(
            """SELECT event_id FROM m_live.m01_event WHERE event_id=ANY(%s)
            ORDER BY event_id FOR NO KEY UPDATE""",
            ([r[0] for r in rows],),
        ).close()
        published = datetime.now(UTC)
        for start in range(0, len(rows), batch):
            group = rows[start : start + batch]
            placeholders = ",".join(
                [
                    (
                        "(%s::text,%s::text,%s::timestamptz,%s::date,%s::text,%s::text,%s::text,"
                        "%s::boolean,%s::boolean,%s::timestamptz,%s::timestamptz,%s::timestamptz)"
                    )
                ]
                * len(group)
            )
            accepted = connection.execute(
                """WITH incoming(event_id,game_id,game_start_at,game_date,score,period,elapsed,
                    live,ended,game_finished_at,source_updated_at,requested_at) AS (VALUES """
                + placeholders
                + """),
                eligible AS (
                    SELECT event_id FROM m_live.m01_market
                    WHERE closed AND event_id=ANY(%s)
                    GROUP BY event_id HAVING min(closed_time)>=%s
                )
                UPDATE m_live.m01_event e SET game_id=i.game_id,game_start_at=i.game_start_at,
                    game_date=i.game_date,score=i.score,period=i.period,elapsed=i.elapsed,
                    live=i.live,ended=i.ended,game_finished_at=i.game_finished_at,
                    source_updated_at=i.source_updated_at,m_live_updated_at=%s
                FROM incoming i JOIN eligible g USING(event_id)
                WHERE e.event_id=i.event_id AND e.ended IS DISTINCT FROM TRUE
                    AND e.tags @> '[{"slug":"sports"}]'::jsonb
                    AND e.m_live_updated_at<=i.requested_at
                    AND (e.source_updated_at IS NULL OR i.source_updated_at>=e.source_updated_at)
                RETURNING e.event_id,e.ended""",
                [v for row in group for v in row]
                + [[r[0] for r in group], published - timedelta(hours=hours), published],
            ).fetchall()
            updated += len(accepted)
            ended.extend(r[0] for r in accepted if r[1] is True)
    h_log(
        "runtime_gamma_recent",
        "game_scores_published",
        updated=updated,
        ended=len(ended),
        ended_event_ids=ended[:10],
    )
    return updated
