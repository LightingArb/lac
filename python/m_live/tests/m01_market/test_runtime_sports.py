"""Sports projections from the recorded Gamma request; mutations test boundary policy."""

import copy
import json
from contextlib import nullcontext
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from h_shared.h_ip_pool import ContractError, HttpPolicy, IPPool
from h_shared.h_process import Result
from m_live.src.m01_market import runtime_gamma_full as full
from m_live.src.m01_market import runtime_gamma_recent as recent

FIXTURE = json.loads((Path(__file__).parent / "gamma_sports.json").read_text())
SPORT = next(e for e in FIXTURE["events"] if e["id"] == "1092360")
OTHER = next(e for e in FIXTURE["events"] if e["id"] == "1248705")
FIELDS = (
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
NOW = datetime.now(UTC)


@pytest.fixture
def database(monkeypatch, empty_database):
    monkeypatch.setattr(full, "h_connect", lambda: nullcontext(empty_database))
    monkeypatch.setattr(recent, "h_connect", lambda: nullcontext(empty_database))
    monkeypatch.setattr(recent, "_after_market", "")
    return empty_database


@pytest.fixture
def client():
    pool = IPPool(
        "sports_test",
        [],
        1,
        {"/events": (100, 10), "/markets": (300, 10)},
        HttpPolicy(30, 0, 60, 10000000),
    )
    yield pool
    pool.close()


@pytest.mark.parametrize("parse", [full.s01_event, recent.s03_event])
def test_event_values_missing_empty_and_non_sport(parse):
    row = parse(SPORT, NOW)
    assert row[19] == str(SPORT["gameId"])
    assert row[20] == datetime.fromisoformat(SPORT["startTime"])
    assert row[21] == date.fromisoformat(SPORT["eventDate"])
    assert row[22:27] == tuple(SPORT[k] for k in ("score", "period", "elapsed", "live", "ended"))
    assert row[27] == datetime.fromisoformat(SPORT["finishedTimestamp"])
    assert row[28].obj == SPORT["teams"] and row[29].obj == SPORT["sport"]
    missing = {k: v for k, v in SPORT.items() if k not in FIELDS}
    assert parse(missing, NOW)[19:] == (None,) * 11
    assert parse(SPORT | dict.fromkeys(FIELDS), NOW)[19:] == (None,) * 11
    empty = SPORT | dict.fromkeys(("gameId", "score", "period", "elapsed"), "")
    assert parse(empty, NOW)[19] == "" and parse(empty, NOW)[22:25] == ("", "", "")
    assert parse(OTHER, NOW)[19:] == (None,) * 11
    changed = SPORT | {"score": "1-0", "live": False, "ended": False}
    assert parse(changed, NOW)[22:27] == ("1-0", SPORT["period"], SPORT["elapsed"], False, False)
    zone = SPORT | {"startTime": "2026-10-25T03:30:00+08:00"}
    assert parse(zone, NOW)[20] == datetime(2026, 10, 24, 19, 30, tzinfo=UTC)


@pytest.mark.parametrize("parse", [full.s01_event, recent.s03_event])
@pytest.mark.parametrize(
    "field,value",
    [
        ("gameId", True),
        ("score", 1),
        ("live", "false"),
        ("ended", 1),
        ("startTime", 42),
        ("startTime", "2026-10-24T12:00:00"),
        ("eventDate", "2026-99-99"),
        ("eventDate", "20261024"),
        ("teams", {}),
        ("teams", ["team"]),
        ("sport", []),
    ],
)
def test_invalid_event_boundary_raises_contract_error(parse, field, value):
    with pytest.raises(ContractError):
        parse(SPORT | {field: value}, NOW)


@pytest.mark.parametrize("parse", [full.s02_market, recent.s04_market])
def test_market_values_nullable_negative_line_and_statuses(parse):
    source = SPORT["markets"][0]
    row, _ = parse(source, SPORT["id"], 0, NOW, sports=True)
    assert row[29] == source.get("sportsMarketType")
    assert row[31].obj == json.loads(source["umaResolutionStatuses"])
    missing = {
        k: v
        for k, v in source.items()
        if k not in ("sportsMarketType", "line", "umaResolutionStatuses")
    }
    assert parse(missing, SPORT["id"], 0, NOW, sports=True)[0][29:] == (None, None, None)
    changed = source | {
        "sportsMarketType": "",
        "line": -1.5,
        "umaResolutionStatuses": '["proposed","disputed","disputed"]',
    }
    row, _ = parse(changed, SPORT["id"], 0, NOW, sports=True)
    assert row[29:31] == ("", Decimal("-1.5"))
    assert row[31].obj == ["proposed", "disputed", "disputed"]
    assert parse(source, SPORT["id"], 0, NOW, sports=False)[0][29:] == (None, None, None)
    assert (
        parse(source | {"umaResolutionStatuses": "[]"}, SPORT["id"], 0, NOW, sports=True)[0][31].obj
        == []
    )


@pytest.mark.parametrize("parse", [full.s02_market, recent.s04_market])
@pytest.mark.parametrize(
    "field,value",
    [
        ("line", "1.5"),
        ("line", True),
        ("line", float("nan")),
        ("sportsMarketType", 5),
        ("umaResolutionStatuses", []),
        ("umaResolutionStatuses", "{}"),
        ("umaResolutionStatuses", "bad-json"),
        ("umaResolutionStatuses", "[1]"),
    ],
)
def test_invalid_market_boundary_raises_contract_error(parse, field, value):
    with pytest.raises(ContractError):
        parse(SPORT["markets"][0] | {field: value}, SPORT["id"], 0, NOW, sports=True)


@pytest.mark.parametrize("route", ["full", "recent"])
def test_both_routes_store_jsonb_and_nullable_values(database, monkeypatch, client, route):
    event = copy.deepcopy(SPORT)
    event["score"], event["elapsed"] = "", ""
    event.pop("live", None)
    event["markets"][0]["line"] = -1.5
    if route == "full":
        monkeypatch.setattr(
            client, "request", lambda *a, **k: {"events": [event, OTHER], "next_cursor": None}
        )
        assert (
            full.runtime_gamma_full(client, page_size=100, max_pages=2, write_batch=100)
            == Result.COMPLETE
        )
    else:
        raw = {
            m["id"]: m | {"events": [{"id": e["id"]}], "_web_seen_at": NOW}
            for e in (event, OTHER)
            for m in e["markets"]
        }
        monkeypatch.setattr(client, "request", lambda *a, **k: [event, OTHER])
        recent.c04_publish(*recent.c03_parse(client, raw, 100), 100)
    assert database.execute(
        "SELECT game_id,game_start_at,game_date,score,elapsed,live,ended,teams,sport FROM m_live.m01_event WHERE event_id=%s",
        (event["id"],),
    ).fetchone() == (
        str(event["gameId"]),
        datetime.fromisoformat(event["startTime"]),
        date.fromisoformat(event["eventDate"]),
        "",
        "",
        None,
        True,
        event["teams"],
        event["sport"],
    )
    assert database.execute(
        "SELECT sports_market_type,line,uma_resolution_statuses FROM m_live.m01_market WHERE market_id=%s",
        (event["markets"][0]["id"],),
    ).fetchone() == (
        event["markets"][0]["sportsMarketType"],
        Decimal("-1.5"),
        json.loads(event["markets"][0]["umaResolutionStatuses"]),
    )
    assert (
        database.execute(
            "SELECT game_id,game_start_at,game_date,score,period,elapsed,live,ended,game_finished_at,teams,sport FROM m_live.m01_event WHERE event_id=%s",
            (OTHER["id"],),
        ).fetchone()
        == (None,) * 11
    )
    assert (
        database.execute(
            "SELECT sports_market_type,line,uma_resolution_statuses FROM m_live.m01_market WHERE event_id=%s",
            (OTHER["id"],),
        ).fetchone()
        == (None,) * 3
    )


@pytest.mark.parametrize("mode", ["complete", "sports_missing", "non_sport", "existing_lookup"])
def test_recent_reuses_or_enriches_only_needed_parents(monkeypatch, client, mode):
    event = copy.deepcopy(OTHER if mode == "non_sport" else SPORT)
    if mode == "sports_missing":
        event.pop("sport")
    elif mode == "existing_lookup":
        event = {"id": SPORT["id"]}
    source = OTHER if mode == "non_sport" else SPORT
    market = source["markets"][0] | {"events": [event], "_web_seen_at": NOW}
    calls = []

    def request(*args, **kwargs):
        calls.append(kwargs["params"])
        return [source]

    monkeypatch.setattr(client, "request", request)
    events, markets, _ = recent.c03_parse(client, {market["id"]: market}, 100)
    assert len(calls) == int(mode in ("sports_missing", "existing_lookup"))
    if calls:
        assert calls[0]["id"] == [SPORT["id"]] and calls[0]["closed"] == "any"
    assert len(events) == len(markets) == 1


@pytest.mark.parametrize("initial_ended", [False, None])
def test_recent_captures_final_score_after_sweep_exit_and_early_resolution(
    database, monkeypatch, client, initial_ended
):
    # Real final response plus synthetic earlier states exercise the closing order.
    initial = copy.deepcopy(SPORT)
    initial.update(
        score="1-2",
        live=True,
        ended=initial_ended,
        closed=False,
        updatedAt=(NOW - timedelta(hours=1)).isoformat(),
    )
    source = initial["markets"][0]
    source.update(closed=True, umaResolutionStatus="resolved", outcomePrices='["0","1"]')
    market, outcomes = full.s02_market(source, initial["id"], 0, NOW, sports=True)
    full.c02_publish([full.s01_event(initial, NOW)], [market], outcomes, 100)
    full.c02_publish([], [], [], 100, NOW + timedelta(days=1))
    assert not database.execute(
        "SELECT in_current_scan FROM m_live.m01_event WHERE event_id=%s", (initial["id"],)
    ).fetchone()[0]
    assert [r[0] for r in recent.c01_bounds(NOW, 1, 120, 1000)[2]] == [source["id"]]
    final = copy.deepcopy(SPORT)
    final["updatedAt"] = (NOW + timedelta(hours=1)).isoformat()
    source["events"] = [{"id": final["id"]}]
    source["updatedAt"] = final["updatedAt"]
    monkeypatch.setattr(client, "request", lambda *a, **k: [final])
    rows = recent.c03_parse(client, {source["id"]: source | {"_web_seen_at": NOW}}, 100)
    recent.c04_publish(*rows, 100)
    assert database.execute(
        "SELECT score,ended,in_current_scan FROM m_live.m01_event WHERE event_id=%s", (final["id"],)
    ).fetchone() == (final["score"], True, False)
    assert recent.c01_bounds(NOW, 1, 120, 1000)[2] == []


@pytest.mark.parametrize("route", ["new", "closed", "follow"])
def test_recent_market_fetch_routes_feed_enrichment(monkeypatch, client, route):
    market = SPORT["markets"][0] | {"events": [{"id": SPORT["id"]}], "_web_seen_at": NOW}

    def scan(ips, order, state, *args):
        selected = (route == "new" and order == "createdAt" and state == "false") or (
            route == "closed" and order == "closedTime"
        )
        return [market] if selected else []

    monkeypatch.setattr(recent, "s01_scan", scan)
    monkeypatch.setattr(recent, "s02_follow", lambda *a: [market] if route == "follow" else [])
    monkeypatch.setattr(client, "request", lambda *a, **k: [SPORT])
    raw = recent.c02_fetch(client, NOW, NOW, [], 100, 20)
    events, markets, _ = recent.c03_parse(client, raw, 100)
    assert events[0][22] == SPORT["score"] and markets[0][29] == market["sportsMarketType"]
