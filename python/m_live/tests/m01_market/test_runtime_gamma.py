"""Parser fixtures are exact subsets of saved Gamma research responses.

Database checks use lac_data's declared tables in a rolled-back transaction.
Load the root environment and run all_setup before the database checks.
"""

import copy
import json
from contextlib import nullcontext
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from functools import partial
from pathlib import Path
from unittest.mock import MagicMock, call

import pytest

from h_shared.h_ip_pool import ContractError, HttpPolicy, IPPool
from m_live.src.m01_market import runtime_gamma_full as full
from m_live.src.m01_market import runtime_gamma_recent as recent

FIXTURES = json.loads((Path(__file__).parent / "gamma_markets.json").read_text())
EVENT = json.loads((Path(__file__).parent / "gamma_event.json").read_text())
NOW = datetime.now(UTC)


def test_recent_missing_parent_skips_only_its_markets_and_warns(monkeypatch, capsys):
    client = IPPool("test", [], 1, {"/events": (100, 10)}, HttpPolicy(30, 0, 60, 1000000))
    available = copy.deepcopy(EVENT["markets"][2])
    unavailable = copy.deepcopy(available)
    available["events"] = [{"id": EVENT["id"]}]
    unavailable["id"] = "missing-market"
    unavailable["events"] = [{"id": "missing-parent"}]
    raw = {
        available["id"]: available | {"_web_seen_at": NOW},
        unavailable["id"]: unavailable | {"_web_seen_at": NOW},
    }
    monkeypatch.setattr(client, "request", lambda *args, **kwargs: [EVENT])
    events, markets, outcomes = recent.c03_parse(client, raw, 100)
    assert [event[0] for event in events] == [EVENT["id"]]
    assert [market[0] for market in markets] == [available["id"]]
    assert {outcome[0] for outcome in outcomes} == {available["id"]}
    warning = next(
        json.loads(line)
        for line in capsys.readouterr().out.splitlines()
        if json.loads(line)["event"] == "parents_unavailable"
    )
    assert warning["event"] == "parents_unavailable"
    assert warning["level"] == "warning" and warning["event_ids"] == ["missing-parent"]
    client.close()


@pytest.mark.parametrize("parse", [full.s01_event, recent.s03_event])
def test_real_event_without_tag_relation(parse):
    record = json.loads((Path(__file__).parent / "gamma_untagged_event.json").read_text())
    event = record["event"]
    assert event["id"] == "578465" and "tags" not in event
    assert parse(event, NOW)[15].obj == []
    malformed = event | {"tags": "not-an-array"}
    with pytest.raises(ContractError, match="tags must be an array"):
        parse(malformed, NOW)


@pytest.mark.parametrize("parse", [full.s02_market, recent.s04_market])
def test_real_settlements(parse):
    # The single-market research endpoint omits parents; this parser receives the
    # parent identity from its caller, independently of settlement extraction.
    rows = [parse(f["market"], EVENT["id"], 0, NOW) for f in FIXTURES]
    assert rows[0][0][27] == "proposed"
    assert json.loads(FIXTURES[0]["market"]["outcomePrices"]) == ["1", "0"]
    assert [r[6] for r in rows[0][1]] == [None, None]
    assert rows[0][0][28] is None
    assert rows[1][0][27] == "resolved"
    assert [r[6] for r in rows[1][1]] == [Decimal("0.5"), Decimal("0.5")]
    assert rows[2][0][4] == "v2" and rows[2][0][27] == "resolved"
    assert rows[2][0][28] == NOW
    assert [r[6] for r in rows[2][1]] == [Decimal(0), Decimal(1)]


@pytest.mark.parametrize("parse", [full.s02_market, recent.s04_market])
def test_real_identity_and_invalid_array(parse):
    market, outcomes = parse(EVENT["markets"][2], EVENT["id"], 2, NOW)
    assert market[0] == "3886788"
    assert [o[2] for o in outcomes] == ["Yes", "No"]
    malformed = copy.deepcopy(EVENT["markets"][2])
    malformed["clobTokenIds"] = '["one"]'
    with pytest.raises(ContractError, match="length mismatch"):
        parse(malformed, EVENT["id"], 0, NOW)


@pytest.fixture
def database(monkeypatch, empty_database):
    monkeypatch.setattr(full, "h_connect", lambda **kwargs: nullcontext(empty_database))
    monkeypatch.setattr(recent, "h_connect", lambda: nullcontext(empty_database))
    yield empty_database


# One event per transaction in the tests, so every full publication spans several.
publish = partial(full.c02_publish, transaction_events=1)


@pytest.mark.parametrize("writer", [publish, recent.c04_publish])
def test_source_guard_outcomes_and_first_resolved_seen(database, writer):
    # Synthetic timestamps exercise concurrent-write policy on a real Gamma object.
    event = copy.deepcopy(EVENT)
    event["updatedAt"] = (NOW + timedelta(days=1)).isoformat()
    source = copy.deepcopy(FIXTURES[1]["market"])
    source["updatedAt"] = event["updatedAt"]
    event_row = full.s01_event(event, NOW)
    market, outcomes = full.s02_market(source, event["id"], 0, NOW)
    # Parent replacement is a test-only internal branch; fixture remains untouched.
    writer([event_row], [market], outcomes, 100)
    first = database.execute(
        "SELECT resolved_seen_at FROM m_live.m01_market WHERE market_id=%s", (market[0],)
    ).fetchone()[0]
    writer([event_row], [market[:28] + (NOW + timedelta(seconds=20),) + market[29:]], outcomes, 100)
    assert (
        database.execute(
            "SELECT resolved_seen_at FROM m_live.m01_market WHERE market_id=%s", (market[0],)
        ).fetchone()[0]
        == first
    )
    older = list(market)
    older[22], older[27], older[28] = NOW, "proposed", None
    old_event = list(event_row)
    old_event[16], old_event[2] = NOW, "Older title must not win"
    writer([tuple(old_event)], [tuple(older)], [r[:6] + (None,) for r in outcomes], 100)
    assert database.execute(
        "SELECT resolution_status,resolved_seen_at FROM m_live.m01_market WHERE market_id=%s",
        (market[0],),
    ).fetchone() == ("resolved", first)
    assert database.execute(
        "SELECT resolved_price FROM m_live.m01_outcome WHERE market_id=%s ORDER BY outcome_index",
        (market[0],),
    ).fetchall() == [(Decimal("0.5"),), (Decimal("0.5"),)]
    assert (
        database.execute(
            "SELECT title FROM m_live.m01_event WHERE event_id=%s", (event["id"],)
        ).fetchone()[0]
        == event["title"]
    )
    corrected = list(older)
    corrected[22] = NOW + timedelta(days=2)
    writer([event_row], [tuple(corrected)], [r[:6] + (None,) for r in outcomes], 100)
    assert database.execute(
        "SELECT resolved_price FROM m_live.m01_outcome WHERE market_id=%s ORDER BY outcome_index",
        (market[0],),
    ).fetchall() == [(None,), (None,)]
    assert (
        database.execute(
            "SELECT resolved_seen_at FROM m_live.m01_market WHERE market_id=%s", (market[0],)
        ).fetchone()[0]
        == first
    )


def test_full_sweep_preserves_new_recent_rows_and_retires_missing(database):
    event = full.s01_event(EVENT, NOW)
    market, outcomes = full.s02_market(EVENT["markets"][2], EVENT["id"], 2, NOW)
    recent.c04_publish([event], [market], outcomes, 100)
    boundary = datetime(1900, 1, 1, tzinfo=UTC)
    publish([], [], [], 100, boundary)
    assert database.execute(
        "SELECT in_current_scan FROM m_live.m01_market WHERE market_id=%s", (market[0],)
    ).fetchone()[0]
    database.execute(
        "UPDATE m_live.m01_market SET m_live_updated_at=%s WHERE market_id=%s",
        (boundary - timedelta(seconds=1), market[0]),
    )
    publish([], [], [], 100, boundary)
    assert not database.execute(
        "SELECT in_current_scan FROM m_live.m01_market WHERE market_id=%s", (market[0],)
    ).fetchone()[0]


def sweep():
    """Two real events (one without markets) and the real market of the first."""
    second = copy.deepcopy(EVENT) | {"id": "r5-second-event", "slug": "r5-second-event"}
    events = [full.s01_event(EVENT, NOW), full.s01_event(second, NOW)]
    market, outcomes = full.s02_market(EVENT["markets"][2], EVENT["id"], 2, NOW)
    return events, [market], outcomes


def scan_flags(connection, table, key, ids):
    return dict(
        connection.execute(
            f"SELECT {key},in_current_scan FROM m_live.{table} WHERE {key}=ANY(%s)", (ids,)
        ).fetchall()
    )


def test_full_sweep_writes_small_transactions_then_retires_what_it_did_not_see(database):
    events, markets, outcomes = sweep()
    stale = copy.deepcopy(EVENT) | {"id": "r5-stale-event", "slug": "r5-stale-event"}
    stale_market = copy.deepcopy(EVENT["markets"][2]) | {"id": "r5-stale-market"}
    stale_row = full.s02_market(stale_market, stale["id"], 0, NOW)[0]
    publish([full.s01_event(stale, NOW)], [stale_row], [], 100)
    boundary = datetime.now(UTC)  # this sweep starts after the stale rows were written
    writes = full.c02_publish(events, markets, outcomes, 100, boundary, transaction_events=1)
    # Two events, one per transaction, then one transaction retiring what the sweep missed.
    assert writes["transactions"] == 3
    assert 0 <= writes["longest_transaction_seconds"] <= writes["write_seconds"]
    ids = [r[0] for r in events] + [stale["id"]]
    assert scan_flags(database, "m01_event", "event_id", ids) == {
        EVENT["id"]: True,
        "r5-second-event": True,
        "r5-stale-event": False,
    }
    assert scan_flags(database, "m01_market", "market_id", [markets[0][0], "r5-stale-market"]) == {
        markets[0][0]: True,
        "r5-stale-market": False,
    }
    assert len(
        database.execute(
            "SELECT 1 FROM m_live.m01_outcome WHERE market_id=%s", (markets[0][0],)
        ).fetchall()
    ) == len(outcomes)


def test_full_sweep_failing_halfway_keeps_written_transactions_and_retires_nothing(
    database, monkeypatch
):
    events, markets, outcomes = sweep()
    stale = copy.deepcopy(EVENT) | {"id": "r5-stale-event", "slug": "r5-stale-event"}
    publish([full.s01_event(stale, NOW)], [], [], 100)
    write, calls = full.s13_publish_events, []

    def fail_second(connection, *args):
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("test write failure")
        return write(connection, *args)

    monkeypatch.setattr(full, "s13_publish_events", fail_second)
    boundary = datetime.now(UTC)
    with pytest.raises(RuntimeError, match="write failure"):
        full.c02_publish(events, markets, outcomes, 100, boundary, transaction_events=1)
    # The first event's transaction stays; the second is not there; nothing left the scan.
    assert scan_flags(
        database, "m01_event", "event_id", [r[0] for r in events] + [stale["id"]]
    ) == {
        EVENT["id"]: True,
        "r5-stale-event": True,
    }
    assert scan_flags(database, "m01_market", "market_id", [markets[0][0]]) == {markets[0][0]: True}


def test_full_sweep_locks_event_then_market_per_transaction(monkeypatch):
    events, markets, outcomes = sweep()
    connection = MagicMock()
    # The market statement accepts the market, so its outcomes are written too.
    connection.execute.return_value.__iter__.return_value = [(markets[0][0],)]
    monkeypatch.setattr(full, "h_connect", lambda **kwargs: nullcontext(connection))
    full.c02_publish(list(reversed(events)), markets, outcomes, 100, NOW, transaction_events=1)
    steps = []
    for name, args, _ in connection.mock_calls:
        if name == "transaction":
            steps.append("begin")
        elif name == "execute":
            sql = " ".join(args[0].split())
            table = sql.split("m_live.")[1].split()[0]
            kind = "lock" if "FOR NO KEY UPDATE" in sql else sql.split()[0].lower()
            steps.append(f"{kind} {table}" + (f" {args[1][0]}" if kind == "lock" else ""))
    first, second = (r[0] for r in events)
    assert steps == [
        # One transaction per event, in event order: lock the event, write it, lock its markets.
        "begin",
        f"lock m01_event {[first]}",
        "insert m01_event",
        f"lock m01_market {[markets[0][0]]}",
        "insert m01_market",
        "insert m01_outcome",
        "begin",
        f"lock m01_event {[second]}",
        "insert m01_event",
        "lock m01_market []",
        # Then retire: events before markets, each locked in id order before the update.
        "begin",
        f"lock m01_event {[first, second]}",
        "update m01_event",
        f"lock m01_market {[markets[0][0]]}",
        "update m01_market",
    ]
    assert connection.transaction.call_args_list == [call()] * 3


def test_full_publish_allows_downstream_foreign_key_reads(database):
    # Own fixture rows and the downstream FK live entirely in this rollback.
    event = full.s01_event(EVENT, NOW)
    market, outcomes = full.s02_market(EVENT["markets"][2], EVENT["id"], 2, NOW)
    publish([event], [market], outcomes, 100)
    database.execute(
        """INSERT INTO m_live.m01_demand_market (market_id,refresh_seconds,book_levels)
        VALUES (%s,10,0) ON CONFLICT (market_id) DO UPDATE SET refresh_seconds=10""",
        (market[0],),
    )
    publish([event], [market], outcomes, 100, datetime(1900, 1, 1, tzinfo=UTC))
    assert database.execute(
        """SELECT m.market_id FROM m_live.m01_demand_market d
        JOIN m_live.m01_market m USING(market_id) WHERE m.market_id=%s""",
        (market[0],),
    ).fetchone() == (market[0],)


def test_cold_bounds_and_follow_rotation(monkeypatch):
    connection = MagicMock()
    connection.execute.return_value.fetchone.return_value = (None, None)
    connection.execute.return_value.fetchall.return_value = []
    monkeypatch.setattr(recent, "h_connect", lambda: nullcontext(connection))
    monkeypatch.setattr(recent, "_after_market", "")
    created, closed, follow = recent.c01_bounds(NOW, 1, 120, 1000)
    assert created == closed == NOW - timedelta(hours=1) and not follow
    connection.execute.return_value.fetchone.return_value = (NOW, NOW)
    connection.execute.return_value.fetchall.side_effect = [
        [("z", False, False, False)],
        [("a", True, False, False)],
    ]
    monkeypatch.setattr(recent, "_after_market", "m")
    created, closed, follow = recent.c01_bounds(NOW, 1, 120, 2)
    assert created == closed == NOW - timedelta(seconds=120)
    assert [r[0] for r in follow] == ["z", "a"]


def test_scan_cap_publishes_available_records_and_warns(monkeypatch, capsys):
    client = IPPool("test", [], 1, {"/markets": (300, 10)}, HttpPolicy(30, 0, 60, 10000))
    market = FIXTURES[0]["market"]
    calls = []

    def request(*args, **kwargs):
        calls.append(kwargs["params"])
        return {"markets": [market], "next_cursor": str(len(calls))}

    monkeypatch.setattr(client, "request", request)
    records = recent.s01_scan(client, "createdAt", "true", datetime(2020, 1, 1, tzinfo=UTC), 100, 2)
    assert len(records) == 2 and len(calls) == 2
    assert calls[0]["_lac_ts"] != calls[1]["_lac_ts"]
    assert calls[0]["version"] == ["v1", "v2"]
    assert '"event": "scan_capped"' in capsys.readouterr().out
    client.close()


@pytest.mark.parametrize("writer,module", [(publish, full), (recent.c04_publish, recent)])
def test_market_publication_uses_no_key_update_lock(monkeypatch, writer, module):
    connection = MagicMock()
    connection.execute.return_value.fetchall.return_value = []
    monkeypatch.setattr(module, "h_connect", lambda **kwargs: nullcontext(connection))
    event = full.s01_event(EVENT, NOW)
    market, outcomes = full.s02_market(EVENT["markets"][2], EVENT["id"], 2, NOW)
    writer([event], [market], outcomes, 100)
    statements = [
        " ".join(call.args[0].split()).upper() for call in connection.execute.call_args_list
    ]
    locks = [sql for sql in statements if "FROM M_LIVE.M01_MARKET" in sql and "FOR " in sql]
    assert locks
    assert all("FOR NO KEY UPDATE" in sql and "FOR UPDATE" not in sql for sql in locks)
