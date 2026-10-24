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
    monkeypatch.setattr(recent, "_after_event", "")
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


@pytest.mark.parametrize("route", ["new", "closed", "follow"])
def test_recent_market_fetch_routes_feed_enrichment(monkeypatch, client, route):
    market = SPORT["markets"][0] | {"events": [{"id": SPORT["id"]}], "_web_seen_at": NOW}

    def scan(ips, order, state, *args):
        selected = (route == "new" and order == "createdAt" and state == "false") or (
            route == "closed" and order == "closedTime"
        )
        return [market] if selected else []

    monkeypatch.setattr(recent, "s01_scan", scan)
    monkeypatch.setattr(recent, "s02_follow", lambda ips, ids, size: [market] if ids else [])
    monkeypatch.setattr(client, "request", lambda *a, **k: [SPORT])
    follow = [(market["id"], False, False)] if route == "follow" else []
    raw = recent.c02_fetch(client, NOW, NOW, follow, 100, 20)
    events, markets, _ = recent.c03_parse(client, raw, 100)
    assert events[0][22] == SPORT["score"] and markets[0][29] == market["sportsMarketType"]


def seed_game(
    database, event_id, market_ids, *, ended=False, close_age=1, sports=True, unresolved=False
):
    event = copy.deepcopy(SPORT)
    event.update(
        id=event_id,
        ended=ended,
        score="1-2",
        live=True,
        updatedAt=(NOW - timedelta(hours=2)).isoformat(),
    )
    if not sports:
        event["tags"] = []
    markets, outcomes = [], []
    for market_id in market_ids:
        source = copy.deepcopy(SPORT["markets"][0])
        source.update(
            id=market_id,
            clobTokenIds=json.dumps([market_id + "-yes", market_id + "-no"]),
            closed=True,
            closedTime=(NOW - timedelta(hours=close_age)).isoformat(),
            umaResolutionStatus="proposed" if unresolved else "resolved",
            outcomePrices='["0","1"]',
        )
        row, results = full.s02_market(source, event_id, 0, NOW, sports=sports)
        markets.append(row)
        outcomes.extend(results)
    full.c02_publish([full.s01_event(event, NOW)], markets, outcomes, 100)
    return event


def test_game_selection_one_market_oldest_close_and_expiry(database, monkeypatch):
    seed_game(database, "game-a", ["ma-z", "ma-a"])
    seed_game(database, "game-b", ["mb"], ended=None, close_age=24)
    seed_game(database, "game-c", ["mc"], close_age=25)
    seed_game(database, "game-d", ["md"], ended=True)
    seed_game(database, "game-e", ["me"], sports=False)
    seed_game(database, "game-f", ["mf"])
    database.execute("UPDATE m_live.m01_market SET closed_time=NULL WHERE market_id='mf'")
    # One recent market must not revive an event whose first market closed too long ago.
    database.execute(
        "UPDATE m_live.m01_market SET closed_time=%s WHERE market_id='ma-z'",
        (NOW - timedelta(hours=25),),
    )
    assert [r[0] for r in recent.c06_game_bounds(NOW, 24, 500)] == ["game-b"]
    database.execute(
        "UPDATE m_live.m01_market SET closed_time=%s WHERE market_id='ma-z'",
        (NOW - timedelta(hours=1),),
    )
    # Neither game ID nor start time is required by the event follow contract.
    database.execute(
        "UPDATE m_live.m01_event SET game_id=NULL,game_start_at=NULL WHERE event_id='game-a'"
    )
    rows = recent.c06_game_bounds(NOW, 24, 500)
    assert [(r[0], r[1]) for r in rows] == [("game-a", "ma-a"), ("game-b", "mb")]
    assert recent.c06_game_bounds(NOW + timedelta(microseconds=1), 24, 500)[0][0] == "game-a"
    assert len(recent.c06_game_bounds(NOW + timedelta(microseconds=1), 24, 500)) == 1
    monkeypatch.setattr(recent, "_after_event", "game-a")
    assert [r[0] for r in recent.c06_game_bounds(NOW, 24, 2)] == ["game-b", "game-a"]


def test_game_and_ordinary_quotas_are_independent(database, monkeypatch):
    seed_game(database, "game-ordinary", [f"o-{i:04}" for i in range(1002)], unresolved=True)
    seed_game(database, "game-resolved", ["r-a", "r-b"])
    follow = recent.c01_bounds(NOW, 1, 120, 1000)[2]
    assert len(follow) == 1000 and all(r[0].startswith("o-") for r in follow)
    assert [(r[0], r[1]) for r in recent.c06_game_bounds(NOW, 24, 1)] == [
        ("game-ordinary", "o-0000")
    ]
    monkeypatch.setattr(recent, "_after_market", follow[-1][0])
    monkeypatch.setattr(recent, "_after_event", "game-ordinary")
    assert len(recent.c01_bounds(NOW, 1, 120, 1000)[2]) == 1000
    assert [r[0] for r in recent.c06_game_bounds(NOW, 24, 1)] == ["game-resolved"]


@pytest.mark.parametrize("initial_ended", [False, None])
def test_game_follow_final_score_only_without_events(
    database, monkeypatch, client, capsys, initial_ended
):
    seed_game(database, "game-final", ["ma-z", "ma-a"], ended=initial_ended)
    full.c02_publish([], [], [], 100, datetime.now(UTC) + timedelta(days=1))
    before = database.execute(
        "SELECT slug,teams,sport,in_current_scan,closed FROM m_live.m01_event WHERE event_id='game-final'"
    ).fetchone()
    final = copy.deepcopy(SPORT)
    final.update(id="game-final", updatedAt=(NOW + timedelta(hours=1)).isoformat(), ended=True)
    # The score-only embedded object needs no tags, market list, teams or sport.
    embedded = {k: v for k, v in final.items() if k in FIELDS[:9] or k in ("id", "updatedAt")}
    calls = []

    def request(method, url, **kwargs):
        assert url.endswith("/markets")
        calls.append(kwargs["params"]["id"])
        result = [{"id": "ma-a", "events": [embedded]}]
        client.requests += 1
        client.response_bytes += len(json.dumps(result).encode())
        return result

    monkeypatch.setattr(client, "request", request)
    monkeypatch.setattr(recent, "s01_scan", lambda *a: [])
    assert (
        recent.runtime_gamma_recent(
            client,
            page_size=100,
            max_pages=20,
            overlap_seconds=120,
            lookback_hours=1,
            follow_limit=1000,
            event_batch=100,
            write_batch=1000,
            game_follow_hours=24,
            game_follow_max=500,
        )
        == Result.COMPLETE
    )
    assert calls == [["ma-a"]]
    assert database.execute(
        "SELECT score,ended FROM m_live.m01_event WHERE event_id='game-final'"
    ).fetchone() == (final["score"], True)
    assert (
        database.execute(
            "SELECT slug,teams,sport,in_current_scan,closed FROM m_live.m01_event WHERE event_id='game-final'"
        ).fetchone()
        == before
    )
    assert recent.c06_game_bounds(datetime.now(UTC), 24, 500) == []
    log = next(
        json.loads(line)
        for line in capsys.readouterr().out.splitlines()
        if json.loads(line)["event"] == "game_follow"
    )
    assert log["events"] == log["returned"] == log["requests"] == 1 and log["response_bytes"] > 0


@pytest.mark.parametrize("race", ["source", "publication", "ended", "expiry"])
def test_game_publish_rechecks_newer_rows_and_lifetime(database, monkeypatch, client, race):
    seed_game(database, "game-race", ["mr"])
    final = {k: v for k, v in SPORT.items() if k in FIELDS[:9]}
    final.update(id="game-race", updatedAt=(NOW + timedelta(hours=1)).isoformat())
    monkeypatch.setattr(client, "request", lambda *a, **k: [{"id": "mr", "events": [final]}])
    rows = recent.c07_fetch_games(client, recent.c06_game_bounds(NOW, 24, 500), 100)
    if race == "source":
        database.execute(
            "UPDATE m_live.m01_event SET source_updated_at=%s WHERE event_id='game-race'",
            (NOW + timedelta(hours=2),),
        )
    elif race == "publication":
        database.execute(
            "UPDATE m_live.m01_event SET m_live_updated_at=%s WHERE event_id='game-race'",
            (datetime.now(UTC) + timedelta(seconds=1),),
        )
    elif race == "ended":
        database.execute("UPDATE m_live.m01_event SET ended=true WHERE event_id='game-race'")
    else:
        database.execute(
            "UPDATE m_live.m01_market SET closed_time=%s WHERE market_id='mr'",
            (NOW - timedelta(hours=25),),
        )
    assert recent.c08_publish_games(rows, 24, 1000) == 0
    assert database.execute(
        "SELECT score FROM m_live.m01_event WHERE event_id='game-race'"
    ).fetchone() == ("1-2",)


def test_game_follow_batches_nullable_fields_and_identity(monkeypatch, client):
    games = [(f"e{i}", f"m{i}", NOW) for i in range(201)]
    calls = []

    def request(method, url, **kwargs):
        assert url.endswith("/markets")
        ids = kwargs["params"]["id"]
        calls.append(ids)
        return [{"id": m, "events": [{"id": "e" + m[1:], "score": ""}]} for m in ids]

    monkeypatch.setattr(client, "request", request)
    rows = recent.c07_fetch_games(client, games, 100)
    assert [len(x) for x in calls] == [100, 100, 1]
    assert rows[0][1:10] == (None, None, None, "", None, None, None, None, None)
    monkeypatch.setattr(
        client, "request", lambda *a, **k: [{"id": "m0", "events": [{"id": "wrong"}]}]
    )
    with pytest.raises(ContractError, match="unexpected parent"):
        recent.c07_fetch_games(client, games[:1], 100)
