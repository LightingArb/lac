"""Real /prices fixtures and local-table dispatch checks, always rolled back."""

import json
import threading
import time
from contextlib import nullcontext
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from h_shared.h_ip_pool import ContractError, HttpPolicy, IPPool
from h_shared.h_process import Result
from m_live.src.m02_price import runtime_clob as clob

FIXTURES = json.loads((Path(__file__).parent / "prices.json").read_text())
NOW = datetime.now(UTC)


@pytest.mark.parametrize("record", FIXTURES[:3])
def test_real_buy_is_bid_sell_is_ask(record):
    asset = next(iter(record["response"]))
    row = clob.s10_parse(record["response"], [("market", asset)], NOW)[0]
    source = record["response"][asset]
    assert row == ("market", asset, Decimal(source["BUY"]), Decimal(source["SELL"]), NOW)
    assert row[2] < row[3]


def test_real_empty_book_and_absent_token():
    record = FIXTURES[3]
    asset = next(iter(record["response"]))
    assert record["response"][asset] == {"BUY": "0", "SELL": "1"}
    rows = clob.s10_parse(record["response"], [("empty", asset), ("missing", "absent")], NOW)
    assert [r[2:4] for r in rows] == [(None, None), (None, None)]


@pytest.mark.parametrize("value", ["1.5", "-0.1", "NaN", "Infinity", "bad", True])
def test_invalid_price_is_error(value):
    record = FIXTURES[0]
    asset = next(iter(record["response"]))
    response = {asset: record["response"][asset] | {"BUY": value}}
    with pytest.raises(ContractError):
        clob.s10_parse(response, [("market", asset)], NOW)


@pytest.mark.parametrize("response", [[], {"unexpected": {}}, {"a": "0.5"}])
def test_invalid_response_is_error(response):
    with pytest.raises(ContractError):
        clob.s10_parse(response, [("market", "a")], NOW)


def test_requested_at_precedes_request_and_is_not_receipt_time(monkeypatch):
    record = FIXTURES[0]
    asset = next(iter(record["response"]))
    calls = []

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

    monkeypatch.setattr(clob, "datetime", Clock)
    monkeypatch.setattr(pool, "request", request)
    rows = clob.s09_fetch(pool, [("market", asset)])
    assert rows[0][4] == NOW < Clock.current
    assert calls[0][:2] == ("POST", "https://clob.polymarket.com/prices")
    assert calls[0][2]["body"] == [
        {"token_id": asset, "side": "BUY"},
        {"token_id": asset, "side": "SELL"},
    ]


# Priced markets: seconds since the last request and the demanded interval (None: not demanded).
PRICED = {"early": (50, 10), "late": (80, 60), "fresh": (-3600, 10), "retired": (100, None)}


@pytest.fixture
def database(monkeypatch, empty_database):
    connection = empty_database
    monkeypatch.setattr(clob, "h_connect", lambda **kwargs: nullcontext(connection))
    event = "r5-test-event"
    connection.execute(
        """INSERT INTO m_live.m01_event
        (event_id,slug,title,active,closed,archived,tags,in_current_scan,m_live_updated_at)
        VALUES (%s,%s,%s,true,false,false,'[]',true,%s)""",
        (event, event, event, NOW),
    )
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
        age, seconds = PRICED.get(name, (None, 10))
        if seconds is not None:
            connection.execute(
                """INSERT INTO m_live.m01_demand_market
                (market_id,refresh_seconds,book_levels) VALUES (%s,%s,0)""",
                (market, seconds),
            )
        if age is not None:
            requested = NOW - timedelta(seconds=age)
            connection.execute(
                """INSERT INTO m_live.m02_clob_price
                (market_id,asset_id,best_bid,best_ask,requested_at,m_live_updated_at,next_due)
                VALUES (%s,%s,0.4,0.6,%s,%s,%s)""",
                (
                    market,
                    market + "-0",
                    requested,
                    NOW,
                    requested + timedelta(seconds=seconds or 10),
                ),
            )
    yield connection


def names(markets):
    """Short names of market ids or (market, asset) pairs."""
    return [(m if isinstance(m, str) else m[0]).removeprefix("r4-test-") for m in markets]


def next_due(connection, name):
    return connection.execute(
        "SELECT requested_at,next_due FROM m_live.m02_clob_price WHERE market_id=%s",
        ("r4-test-" + name,),
    ).fetchone()


def test_unseen_binary_markets_then_priced_by_next_due(database):
    unseen = clob.s03_unseen(database)
    assert names(unseen) == ["a", "b"]
    assert all(asset == market + "-0" for market, asset in unseen)
    # Due or not, earliest next_due first; retired is no longer demanded.
    assert names(clob.s08_next_due(database, 100, False)) == ["early", "late", "fresh"]
    assert names(clob.s08_next_due(database, 100, True)) == ["early", "late"]
    assert names(clob.s08_next_due(database, 1, False)) == ["early"]


def test_take_fills_free_slots_never_twice_in_flight_unseen_first(database):
    picker = clob.Picker(2, 10, once=False)
    clob.c01_maintain(picker)
    batches = [clob.s07_take(picker, database) for _ in range(3)]
    assert [names(b) for b in batches] == [["a", "b"], ["early", "late"], ["fresh"]]
    # Everything demanded is in flight: nothing is sent twice, and the runtime keeps waiting.
    assert clob.s07_take(picker, database) is None and not picker.finished
    picker.inflight.difference_update(m for m, _ in batches[1])
    assert names(clob.s07_take(picker, database)) == ["early", "late"]
    # A reload of never-fetched markets leaves out those still in flight.
    clob.c01_maintain(picker)
    assert not picker.unseen


def test_once_takes_due_markets_once_then_finishes(database):
    picker = clob.Picker(3, 10, once=True)
    clob.c01_maintain(picker)
    assert names(clob.s07_take(picker, database)) == ["a", "b", "early"]
    assert names(clob.s07_take(picker, database)) == ["late"]
    picker.inflight.clear()
    assert clob.s07_take(picker, database) is None and picker.finished


def test_maintenance_deletes_retired_and_recomputes_changed_intervals(database):
    assert clob.s01_delete_retired(database) == 1
    assert clob.s02_recompute_next_due(database) == 0
    database.execute(
        "UPDATE m_live.m01_demand_market SET refresh_seconds=5 WHERE market_id='r4-test-late'"
    )
    assert clob.s02_recompute_next_due(database) == 1
    requested, due = next_due(database, "late")
    assert due == requested + timedelta(seconds=5)
    assert clob.s02_recompute_next_due(database) == 0


def test_publication_sets_next_due_and_rechecks_demand_identity_and_source_time(database):
    row = ("r4-test-a", "r4-test-a-0", Decimal("0.3"), Decimal("0.7"), NOW)
    before = database.execute("SELECT clock_timestamp()").fetchone()[0]
    assert clob.s13_publish(database, [row]) == (1, 1, 1)
    assert next_due(database, "a") == (NOW, NOW + timedelta(seconds=10))
    older = row[:2] + (Decimal("0.2"), Decimal("0.8"), NOW - timedelta(seconds=1))
    assert clob.s13_publish(database, [older]) == (0, 0, 0)
    stored = database.execute(
        """SELECT best_bid,requested_at,m_live_updated_at FROM m_live.m02_clob_price
        WHERE market_id='r4-test-a'"""
    ).fetchone()
    assert stored[0:2] == (Decimal("0.3"), NOW)
    after = database.execute("SELECT clock_timestamp()").fetchone()[0]
    # Bound publication by DB clock readings, including an observed backward step.
    assert min(before, after) <= stored[2] <= max(before, after)
    # An unchanged price is written again: requested_at and next_due move.
    later = row[:4] + (NOW + timedelta(seconds=4),)
    assert clob.s13_publish(database, [later]) == (1, 1, 1)
    assert next_due(database, "a") == (later[4], later[4] + timedelta(seconds=10))
    assert clob.s13_publish(database, [(row[0], "wrong-asset", *later[2:])]) == (0, 0, 0)
    database.execute("DELETE FROM m_live.m01_demand_market WHERE market_id='r4-test-a'")
    assert clob.s13_publish(database, [later]) == (0, 0, 0)


class Response:
    status_code, headers = 200, {}

    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def iter_content(self, **_):
        yield self.body


def fake_prices(pool, monkeypatch, delay=0.0):
    """Answer /prices below IPPool.request, so slots, quotas and counters stay real; record each
    request's markets and catch a market sent while a request with it is still open."""
    requests, active, overlaps = [], set(), []
    lock = threading.Lock()

    class Session:
        def request(self, method, url, **kwargs):
            body = kwargs["json"]
            markets = {r["token_id"].rsplit("-", 1)[0] for r in body}
            with lock:
                if markets & active:
                    overlaps.append(markets & active)
                active.update(markets)
                requests.append(sorted(markets))
            time.sleep(delay)
            with lock:
                active.difference_update(markets)
            prices = {r["token_id"]: {"BUY": "0.4", "SELL": "0.6"} for r in body}
            return Response(json.dumps(prices).encode())

    monkeypatch.setattr(pool, "session", lambda index: Session())
    return requests, overlaps


def settings(**overrides):
    return {
        "request_items": 1,
        "refill_batches": 2,
        "writers": 2,
        "max_pending_writes": 2,
        "summary_seconds": 60,
    } | overrides


def test_once_publishes_unseen_and_due_then_logs_summary(database, monkeypatch, capsys):
    pool = IPPool("test", [], 4, {"/prices": (500, 10)}, HttpPolicy(30, 2, 60, 10000))
    requests, overlaps = fake_prices(pool, monkeypatch)
    result = clob.runtime_clob(pool, stop=threading.Event(), once=True, **settings())
    assert result == Result.COMPLETE
    assert sorted(m for r in requests for m in names(r)) == ["a", "b", "early", "late"]
    assert not overlaps
    assert next_due(database, "retired") is None
    for name, seconds in (("a", 10), ("early", 10), ("late", 60)):
        requested, due = next_due(database, name)
        assert requested > NOW and due == requested + timedelta(seconds=seconds)
    assert next_due(database, "fresh")[0] == NOW + timedelta(seconds=3600)
    logs = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    summary = next(log for log in logs if log["event"] == "dispatch_summary")
    assert summary["exits"] == {
        "default": {"requests": 4, "markets": 4, "errors": 0, "http_429": 0}
    }
    assert summary["all_exits_429"] == 0 and summary["deleted"] == 1
    assert summary["recomputed"] == 0 and summary["unseen"] == summary["inflight"] == 0
    assert set(summary["groups"]) == {"10", "60"}
    assert summary["groups"]["10"]["markets"] == 7 and summary["groups"]["10"]["priced"] == 4
    assert {"age_p50", "age_p95", "overdue"} <= set(summary["groups"]["60"])
    assert pool.success == 4


def test_resident_keeps_refilling_without_duplicates_until_stopped(database, monkeypatch):
    pool = IPPool("test", [], 4, {"/prices": (500, 10)}, HttpPolicy(30, 2, 60, 10000))
    requests, overlaps = fake_prices(pool, monkeypatch, delay=0.01)
    stop = threading.Event()
    timer = threading.Timer(1, stop.set)
    timer.start()
    try:
        result = clob.runtime_clob(pool, stop=stop, once=False, **settings())
    finally:
        timer.cancel()
    assert result == Result.COMPLETE
    # Not waiting for next_due: a market written seconds ago goes again as soon as a slot is
    # free, and the one due in an hour goes too once the earlier ones are all in flight.
    fetched = [m for r in requests for m in names(r)]
    assert set(fetched[:2]) == {"a", "b"}
    assert fetched.count("a") > 2 and "fresh" in fetched and len(requests) > 15
    assert not overlaps
    assert "retired" not in fetched and "one" not in fetched


def test_summary_every_period_and_maintenance_failure_stops_the_runtime(
    database, monkeypatch, capsys
):
    pool = IPPool("test", [], 4, {"/prices": (500, 10)}, HttpPolicy(30, 2, 60, 10000))
    fake_prices(pool, monkeypatch, delay=0.01)
    maintain, calls = clob.c01_maintain, []

    def fail_third(picker):
        calls.append(1)
        if len(calls) == 3:
            raise RuntimeError("test maintenance failure")
        return maintain(picker)

    monkeypatch.setattr(clob, "c01_maintain", fail_third)
    with pytest.raises(RuntimeError, match="maintenance"):
        clob.runtime_clob(pool, stop=threading.Event(), once=False, **settings(summary_seconds=0.2))
    logs = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    summary = next(log for log in logs if log["event"] == "dispatch_summary")
    assert 0.1 < summary["seconds"] < 1 and summary["exits"]["default"]["markets"] > 0


def test_fetch_failure_finishes_in_flight_writes_then_raises(database, monkeypatch):
    pool = IPPool("test", [], 4, {"/prices": (500, 10)}, HttpPolicy(30, 2, 60, 10000))
    written = []

    def request(method, url, **kwargs):
        if kwargs["target"] == ["r4-test-b"]:
            raise ContractError("test contract failure")
        return {r["token_id"]: {"BUY": "0.4", "SELL": "0.6"} for r in kwargs["body"]}

    publish = clob.s13_publish

    def record(connection, rows):
        written.extend(r[0] for r in rows)
        return publish(connection, rows)

    monkeypatch.setattr(pool, "request", request)
    monkeypatch.setattr(clob, "s13_publish", record)
    with pytest.raises(ContractError):
        clob.runtime_clob(pool, stop=threading.Event(), once=False, **settings())
    assert "r4-test-a" in written and "r4-test-b" not in written
