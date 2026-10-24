"""Real /prices fixtures and local-table scheduling checks, always rolled back."""

import json
from contextlib import nullcontext
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from h_shared.h_db import h_connect
from h_shared.h_ip_pool import ContractError, HttpPolicy, IPPool
from h_shared.h_process import Result
from m_live.src.m02_price import runtime_clob as clob

FIXTURES = json.loads((Path(__file__).parent / "prices.json").read_text())
NOW = datetime.now(UTC)


@pytest.mark.parametrize("record", FIXTURES[:3])
def test_real_buy_is_bid_sell_is_ask(record):
    asset = next(iter(record["response"]))
    row = clob.s03_parse(record["response"], [("market", asset)], NOW)[0]
    source = record["response"][asset]
    assert row == ("market", asset, Decimal(source["BUY"]), Decimal(source["SELL"]), NOW)
    assert row[2] < row[3]


def test_real_empty_book_and_absent_token():
    record = FIXTURES[3]
    asset = next(iter(record["response"]))
    assert record["response"][asset] == {"BUY": "0", "SELL": "1"}
    rows = clob.s03_parse(record["response"], [("empty", asset), ("missing", "absent")], NOW)
    assert [r[2:4] for r in rows] == [(None, None), (None, None)]


@pytest.mark.parametrize("value", ["1.5", "-0.1", "NaN", "Infinity", "bad", True])
def test_invalid_price_is_error(value):
    record = FIXTURES[0]
    asset = next(iter(record["response"]))
    response = {asset: record["response"][asset] | {"BUY": value}}
    with pytest.raises(ContractError):
        clob.s03_parse(response, [("market", asset)], NOW)


@pytest.mark.parametrize("response", [[], {"unexpected": {}}, {"a": "0.5"}])
def test_invalid_response_is_error(response):
    with pytest.raises(ContractError):
        clob.s03_parse(response, [("market", "a")], NOW)


def test_requested_at_precedes_request_and_is_not_receipt_time(monkeypatch):
    record = FIXTURES[0]
    asset = next(iter(record["response"]))
    calls, writes = [], []

    class Clock:
        current = NOW

        @classmethod
        def now(cls, zone):
            return cls.current

    pool = IPPool("test", [], 4, {"/prices": (500, 10)}, HttpPolicy(30, 2, 60, 10000))

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        Clock.current += timedelta(seconds=7)
        return record["response"]

    def publish(rows):
        writes.extend(rows)
        return len(rows), 1, 1

    monkeypatch.setattr(clob, "datetime", Clock)
    monkeypatch.setattr(pool, "request", request)
    monkeypatch.setattr(clob, "s05_publish", publish)
    assert clob.s02_refresh(pool, [("market", asset)]) == (1, 1, 1)
    assert writes[0][4] == NOW < Clock.current
    assert calls[0][:2] == ("POST", "https://clob.polymarket.com/prices")
    assert calls[0][2]["body"] == [
        {"token_id": asset, "side": "BUY"},
        {"token_id": asset, "side": "SELL"},
    ]


@pytest.fixture
def database(monkeypatch):
    with h_connect() as connection, connection.transaction(force_rollback=True):
        monkeypatch.setattr(clob, "h_connect", lambda: nullcontext(connection))
        # Isolate this transaction's demand, then roll it all back. No extra tables.
        connection.execute("DELETE FROM m_live.m01_demand_market")
        event = connection.execute(
            "SELECT event_id FROM m_live.m01_event ORDER BY event_id LIMIT 1"
        ).fetchone()[0]
        for name in ("a", "b", "early", "late", "fresh", "one", "three", "missing", "retired"):
            market = "r4-test-" + name
            connection.execute(
                """INSERT INTO m_live.m01_market
                (market_id,event_id,sort_order,protocol_version,slug,question,active,closed,
                 archived,in_current_scan,m_live_updated_at)
                VALUES (%s,%s,0,'v1',%s,%s,true,false,false,true,%s)""",
                (market, event, market, market, NOW),
            )
            count = 1 if name == "one" else 3 if name == "three" else 2
            for index in range(count):
                connection.execute(
                    """INSERT INTO m_live.m01_outcome (market_id,outcome_index,label,asset_id)
                    VALUES (%s,%s,%s,%s)""",
                    (
                        market,
                        index,
                        str(index),
                        None if name == "missing" and index == 1 else f"{market}-{index}",
                    ),
                )
            if name != "retired":
                connection.execute(
                    """INSERT INTO m_live.m01_demand_market
                    (market_id,refresh_seconds,book_levels) VALUES (%s,%s,0)""",
                    (market, 60 if name == "late" else 10),
                )
            if name in ("early", "late", "fresh", "retired"):
                age = {"early": 50, "late": 80, "fresh": -3600, "retired": 100}[name]
                connection.execute(
                    """INSERT INTO m_live.m02_clob_price
                    (market_id,asset_id,best_bid,best_ask,requested_at,m_live_updated_at)
                    VALUES (%s,%s,0.4,0.6,%s,%s)""",
                    (market, market + "-0", NOW - timedelta(seconds=age), NOW),
                )
        yield connection


def test_unseen_first_then_due_time_and_binary_assets_only(database):
    rows = clob.s01_due(database, 100, NOW)
    assert [r[0] for r in rows] == ["r4-test-a", "r4-test-b", "r4-test-early", "r4-test-late"]
    assert all(asset == market + "-0" for market, asset in rows)
    assert clob.s01_due(database, 2, NOW) == rows[:2]


def test_round_cap_pending_and_retired_price_deletion(database, monkeypatch):
    pool = IPPool("test", [], 4, {"/prices": (500, 10)}, HttpPolicy(30, 2, 60, 10000))
    requests = []

    def request(method, url, **kwargs):
        requests.append(kwargs["body"])
        return {r["token_id"]: {"BUY": "0.4", "SELL": "0.6"} for r in kwargs["body"]}

    monkeypatch.setattr(pool, "request", request)
    monkeypatch.setattr(pool, "map", lambda function, items: map(function, items))
    assert clob.runtime_clob(pool, request_items=1, max_markets=2) == Result.PENDING
    assert len(requests) == 2 and all(len(r) == 2 for r in requests)
    assert (
        database.execute(
            "SELECT count(*) FROM m_live.m02_clob_price WHERE market_id='r4-test-retired'"
        ).fetchone()[0]
        == 0
    )
    for request in requests:
        assert request[0]["token_id"] in ("r4-test-a-0", "r4-test-b-0")
    database.execute("DELETE FROM m_live.m01_demand_market")
    assert clob.runtime_clob(pool, request_items=1, max_markets=2) == Result.COMPLETE
    assert len(requests) == 2


def test_publication_rechecks_demand_identity_and_source_time(database):
    row = ("r4-test-a", "r4-test-a-0", Decimal("0.3"), Decimal("0.7"), NOW)
    assert clob.s05_publish([row]) == (1, 1, 1)
    older = row[:2] + (Decimal("0.2"), Decimal("0.8"), NOW - timedelta(seconds=1))
    assert clob.s05_publish([older]) == (0, 0, 0)
    stored = database.execute(
        """SELECT best_bid,requested_at,m_live_updated_at FROM m_live.m02_clob_price
        WHERE market_id='r4-test-a'"""
    ).fetchone()
    assert stored[0:2] == (Decimal("0.3"), NOW) and stored[2] >= stored[1]
    assert clob.s05_publish([(row[0], "wrong-asset", *row[2:])]) == (0, 0, 0)
    database.execute("DELETE FROM m_live.m01_demand_market WHERE market_id='r4-test-a'")
    assert clob.s05_publish([row]) == (0, 0, 0)
