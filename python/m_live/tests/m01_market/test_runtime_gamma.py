"""Parser fixtures are exact subsets of saved Gamma research responses.

Database checks use lac_data's declared tables in a rolled-back transaction.
Load the root environment and run all_setup before the database checks.
"""

import copy
import json
from contextlib import nullcontext
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from h_shared.h_db import h_connect
from h_shared.h_ip_pool import ContractError, HttpPolicy, IPPool
from m_live.src.m01_market import runtime_gamma_full as full
from m_live.src.m01_market import runtime_gamma_recent as recent

FIXTURES = json.loads((Path(__file__).parent / "gamma_markets.json").read_text())
EVENT = json.loads((Path(__file__).parent / "gamma_event.json").read_text())
NOW = datetime.now(UTC)


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
def database(monkeypatch):
    with h_connect() as connection, connection.transaction(force_rollback=True):
        monkeypatch.setattr(full, "h_connect", lambda: nullcontext(connection))
        monkeypatch.setattr(recent, "h_connect", lambda: nullcontext(connection))
        yield connection


@pytest.mark.parametrize("writer", [full.c02_publish, recent.c04_publish])
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
    writer([event_row], [market[:28] + (NOW + timedelta(seconds=20),)], outcomes, 100)
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
    full.c02_publish([], [], [], 100, boundary)
    assert database.execute(
        "SELECT in_current_scan FROM m_live.m01_market WHERE market_id=%s", (market[0],)
    ).fetchone()[0]
    database.execute(
        "UPDATE m_live.m01_market SET m_live_updated_at=%s WHERE market_id=%s",
        (boundary - timedelta(seconds=1), market[0]),
    )
    full.c02_publish([], [], [], 100, boundary)
    assert not database.execute(
        "SELECT in_current_scan FROM m_live.m01_market WHERE market_id=%s", (market[0],)
    ).fetchone()[0]


def test_full_publish_allows_downstream_foreign_key_reads(database):
    # A real downstream FK check takes KEY SHARE; metadata updates must coexist.
    with h_connect() as reader:
        row = reader.execute(
            "SELECT market_id FROM m_live.m01_market WHERE in_current_scan ORDER BY market_id LIMIT 1 FOR KEY SHARE"
        ).fetchone()
        if row is None:
            pytest.skip("Run the local crawler once to exercise existing FK readers")
        database.execute("SET LOCAL lock_timeout='200ms'")
        full.c02_publish([], [], [], 100, datetime(1900, 1, 1, tzinfo=UTC))


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
        [("z", False, False)],
        [("a", True, False)],
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
