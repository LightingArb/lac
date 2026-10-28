"""Real /prices fixtures and local-table dispatch checks, always rolled back."""

import json
import threading
import time
from concurrent.futures import Future
from contextlib import nullcontext
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import psycopg
import pytest
import requests

from h_shared.h_ip_pool import ContractError, HttpPolicy, IPPool, ProviderError
from h_shared.h_process import Result
from m_live.src import h_dispatch as dispatch
from m_live.src.m02_price import runtime_clob as clob

FIXTURES = json.loads((Path(__file__).parent / "prices.json").read_text())
NOW = datetime.now(UTC)


@pytest.mark.parametrize("record", FIXTURES[:3])
def test_real_buy_is_bid_sell_is_ask(record):
    asset = next(iter(record["response"]))
    row = clob.s11_parse(record["response"], [("market", asset)], NOW)[0]
    source = record["response"][asset]
    assert row == ("market", asset, Decimal(source["BUY"]), Decimal(source["SELL"]), NOW)
    assert row[2] < row[3]


def test_real_empty_book_and_absent_token():
    record = FIXTURES[3]
    asset = next(iter(record["response"]))
    assert record["response"][asset] == {"BUY": "0", "SELL": "1"}
    rows = clob.s11_parse(record["response"], [("empty", asset), ("missing", "absent")], NOW)
    assert [r[2:4] for r in rows] == [(None, None), (None, None)]


@pytest.mark.parametrize("value", ["1.5", "-0.1", "NaN", "Infinity", "bad", True])
def test_invalid_price_is_error(value):
    record = FIXTURES[0]
    asset = next(iter(record["response"]))
    response = {asset: record["response"][asset] | {"BUY": value}}
    with pytest.raises(ContractError):
        clob.s11_parse(response, [("market", asset)], NOW)


@pytest.mark.parametrize("response", [[], {"unexpected": {}}, {"a": "0.5"}])
def test_invalid_response_is_error(response):
    with pytest.raises(ContractError):
        clob.s11_parse(response, [("market", "a")], NOW)


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
    rows = clob.s10_fetch(pool, [("market", asset)])
    assert rows[0][4] == NOW < Clock.current
    assert calls[0][:2] == ("POST", "https://clob.polymarket.com/prices")
    assert calls[0][2]["body"] == [
        {"token_id": asset, "side": "BUY"},
        {"token_id": asset, "side": "SELL"},
    ]


# Priced markets: seconds since the stored request and the demanded interval (None: not demanded).
PRICED = {"early": (50, 10), "late": (80, 60), "fresh": (-3600, 10), "retired": (100, None)}
EVENT = "r5-test-event"


def add_market(connection, name, seconds=10, outcomes=2):
    market = "r4-test-" + name
    connection.execute(
        """INSERT INTO m_live.m01_market
        (market_id,event_id,sort_order,protocol_version,slug,question,active,closed,
         archived,in_current_scan,m_live_updated_at)
        VALUES (%s,%s,0,'v1',%s,%s,true,false,false,true,%s)""",
        (market, EVENT, market, market, NOW),
    )
    for index in range(outcomes):
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
    if seconds is not None:
        connection.execute(
            """INSERT INTO m_live.m01_demand_market
            (market_id,refresh_seconds,book_levels) VALUES (%s,%s,0)""",
            (market, seconds),
        )


@pytest.fixture
def database(monkeypatch, empty_database):
    connection = empty_database
    monkeypatch.setattr(clob, "h_connect", lambda **kwargs: nullcontext(connection))
    monkeypatch.setattr(dispatch, "h_connect", lambda **kwargs: nullcontext(connection))
    connection.execute(
        """INSERT INTO m_live.m01_event
        (event_id,slug,title,active,closed,archived,tags,in_current_scan,m_live_updated_at)
        VALUES (%s,%s,%s,true,false,false,'[]',true,%s)""",
        (EVENT, EVENT, EVENT, NOW),
    )
    for name in ("a", "b", "early", "late", "fresh", "one", "three", "missing", "retired"):
        age, seconds = PRICED.get(name, (None, 10))
        add_market(connection, name, seconds, 1 if name == "one" else 3 if name == "three" else 2)
        if age is not None:
            connection.execute(
                """INSERT INTO m_live.m02_clob_price
                (market_id,asset_id,best_bid,best_ask,requested_at,m_live_updated_at)
                VALUES (%s,%s,0.4,0.6,%s,%s)""",
                ("r4-test-" + name, f"r4-test-{name}-0", NOW - timedelta(seconds=age), NOW),
            )
    yield connection


def names(markets):
    """Short names of market ids or (market, asset) pairs."""
    return [(m if isinstance(m, str) else m[0]).removeprefix("r4-test-") for m in markets]


def stored(connection, name):
    return connection.execute(
        "SELECT best_bid,best_ask,requested_at FROM m_live.m02_clob_price WHERE market_id=%s",
        ("r4-test-" + name,),
    ).fetchone()


def written(picker, batch):
    """What the dispatcher does once a batch's write is done."""
    future = Future()
    future.set_result(0)
    dispatch.s12_collect({future: batch}, picker, block=False)


def came_back(picker, batch, at):
    dispatch.s10_fetched(picker, [(m, a, None, None, at) for m, a in batch], "default")


def picker_of(size, once=False):
    return dispatch.Picker("runtime_clob", size, once)


def take(picker):
    return dispatch.s05_take(picker, time.time())


def test_schedule_starts_from_demand_and_stored_prices(database):
    picker = picker_of(2)
    changes = clob.c01_maintain(picker)
    assert changes == {"deleted": 1, "added": 5, "removed": 0, "interval_changed": 0}
    # Binary demanded markets only; retired lost its price row.
    assert set(names(picker.markets)) == {"a", "b", "early", "late", "fresh"}
    assert stored(database, "retired") is None
    a, early = picker.markets["r4-test-a"], picker.markets["r4-test-early"]
    assert a.fetched is None and a.due == float("-inf") and a.asset == "r4-test-a-0"
    assert early.fetched == pytest.approx((NOW - timedelta(seconds=50)).timestamp())
    assert early.due == pytest.approx(early.fetched + 10)


def test_take_earliest_first_and_never_twice_in_flight(database):
    picker = picker_of(2)
    clob.c01_maintain(picker)
    batches = [take(picker) for _ in range(3)]
    # Never fetched first, then by due time, due or not (fresh is due in an hour).
    assert [names(b) for b in batches] == [["a", "b"], ["early", "late"], ["fresh"]]
    # Everything is in flight: nothing goes twice, and the resident runtime keeps waiting.
    assert take(picker) is None and not picker.finished
    # early and late come back: due an interval after this request, written or not ...
    at = datetime.now(UTC)
    came_back(picker, batches[1], at)
    assert picker.markets["r4-test-late"].due == pytest.approx(at.timestamp() + 60)
    # ... but in flight until their write is done.
    assert take(picker) is None
    written(picker, batches[1])
    assert names(take(picker)) == ["early", "late"]


def test_failed_batch_goes_back_unchanged(database):
    picker = picker_of(2)
    clob.c01_maintain(picker)
    batch = take(picker)
    due = {m: picker.markets[m].due for m, _ in batch}
    dispatch.s08_requeue(picker, batch, "198.51.100.7:8080", ProviderError(0))
    assert not picker.inflight and picker.exit_requeued == {"198.51.100.7:8080": 1}
    assert {m: picker.markets[m].due for m, _ in batch} == due
    assert take(picker) == batch


def test_invalid_batch_counts_as_fetched_and_comes_up_an_interval_later(database, capsys):
    picker = picker_of(2)
    clob.c01_maintain(picker)
    take(picker)
    batch = take(picker)  # early (10 s) and late (60 s)
    error = ContractError("Unexpected CLOB response keys")
    error.requested = time.time() - 1
    dispatch.s09_invalid(picker, batch, "198.51.100.7:8080", error)
    assert picker.inflight == {"r4-test-a", "r4-test-b"}
    assert picker.exit_invalid == {"198.51.100.7:8080": 1} and not picker.exit_requeued
    early, late = picker.markets["r4-test-early"], picker.markets["r4-test-late"]
    assert early.fetched == late.fetched == error.requested
    assert (early.due, late.due) == (error.requested + 10, error.requested + 60)
    # Nothing written: the stored rows stay as they were.
    assert stored(database, "early")[2] == NOW - timedelta(seconds=50)
    # Taken again in their turn: before fresh, which is due in an hour.
    assert names(take(picker)) == ["early", "late"]
    log = next(log for log in logs(capsys) if log["event"] == "batch_invalid")
    assert log["ip"] == "198.51.100.7:8080" and log["markets"] == 2
    assert names(log["market_ids"]) == ["early", "late"]
    assert log["reason"] == "Unexpected CLOB response keys"


def test_reload_adds_drops_and_moves_changed_intervals(database):
    picker = picker_of(2)
    clob.c01_maintain(picker)
    late = picker.markets["r4-test-late"]
    database.execute("DELETE FROM m_live.m01_demand_market WHERE market_id='r4-test-fresh'")
    database.execute(
        "UPDATE m_live.m01_demand_market SET refresh_seconds=5 WHERE market_id='r4-test-late'"
    )
    add_market(database, "new")
    changes = clob.c01_maintain(picker)
    assert changes == {"deleted": 1, "added": 1, "removed": 1, "interval_changed": 1}
    assert "r4-test-fresh" not in picker.markets and late.seconds == 5
    assert late.due == pytest.approx(late.fetched + 5)
    # Never fetched (a, b, new) first; late now comes before early.
    takes = [names(take(picker)) for _ in range(3)]
    assert takes == [["a", "b"], ["new", "late"], ["early"]]
    assert take(picker) is None


def test_once_takes_due_markets_once_then_finishes(database):
    picker = picker_of(3, once=True)
    clob.c01_maintain(picker)
    assert names(take(picker)) == ["a", "b", "early"]
    assert names(take(picker)) == ["late"]
    picker.inflight.clear()
    assert take(picker) is None and picker.finished


@pytest.mark.parametrize(
    "error, kind",
    [
        (ProviderError(401), "fatal"),
        (ProviderError(403), "fatal"),
        (ProviderError(429, 5), "fatal"),
        (ProviderError(0), "transient"),
        (ProviderError(502), "transient"),
        (ProviderError(404), "invalid"),
        (ProviderError(400), "invalid"),
        (ContractError("bad"), "invalid"),
        (RuntimeError("bug"), "fatal"),
    ],
)
def test_auth_all_exits_429_and_unknown_errors_end_the_call_the_rest_go_on(error, kind):
    assert dispatch.s07_kind(error) == kind


def test_write_only_changed_prices_or_an_interval_old_and_only_newer(database):
    row = ("r4-test-a", "r4-test-a-0", Decimal("0.3"), Decimal("0.7"), NOW)
    before = database.execute("SELECT clock_timestamp()").fetchone()[0]
    assert clob.s16_publish(database, [row]) == (1, 1, 1)
    after = database.execute("SELECT clock_timestamp()").fetchone()[0]
    updated = database.execute(
        "SELECT m_live_updated_at FROM m_live.m02_clob_price WHERE market_id='r4-test-a'"
    ).fetchone()[0]
    # Bound publication by DB clock readings, including an observed backward step.
    assert min(before, after) <= updated <= max(before, after)
    # Same prices within the interval (10 s): not written, requested_at stays.
    assert clob.s16_publish(database, [row[:4] + (NOW + timedelta(seconds=4),)]) == (0, 0, 0)
    assert stored(database, "a") == (Decimal("0.3"), Decimal("0.7"), NOW)
    # A changed side is written, also to or from no price.
    moved = (row[0], row[1], None, Decimal("0.7"), NOW + timedelta(seconds=5))
    assert clob.s16_publish(database, [moved]) == (1, 0, 1)
    assert stored(database, "a") == (None, Decimal("0.7"), moved[4])
    # Same prices, the stored row an interval old: written again.
    again = moved[:4] + (moved[4] + timedelta(seconds=10),)
    assert clob.s16_publish(database, [again]) == (1, 0, 1)
    assert stored(database, "a")[2] == again[4]
    # An older request never overwrites, whatever its prices.
    older = (row[0], row[1], Decimal("0.2"), Decimal("0.8"), NOW - timedelta(seconds=1))
    assert clob.s16_publish(database, [older]) == (0, 0, 0)
    later = (row[0], row[1], Decimal("0.5"), Decimal("0.6"), again[4] + timedelta(seconds=1))
    assert clob.s16_publish(database, [(row[0], "wrong-asset", *later[2:])]) == (0, 0, 0)
    database.execute("DELETE FROM m_live.m01_demand_market WHERE market_id='r4-test-a'")
    assert clob.s16_publish(database, [later]) == (0, 0, 0)


class Response:
    def __init__(self, body, status=200):
        self.body, self.status_code, self.headers = body, status, {}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def iter_content(self, **_):
        yield self.body


def fake_prices(pool, monkeypatch, delay=0.0, answer=None):
    """Answer /prices below IPPool.request, so slots, quotas, retries and counters stay real; record
    each request's markets and catch a market sent while a request with it is still open.
    answer(markets) may return a status or a body, or raise, instead of the prices."""
    requests_, active, overlaps = [], set(), []
    lock = threading.Lock()

    class Session:
        def request(self, method, url, **kwargs):
            body = kwargs["json"]
            markets = {r["token_id"].rsplit("-", 1)[0] for r in body}
            with lock:
                if markets & active:
                    overlaps.append(markets & active)
                active.update(markets)
                requests_.append(sorted(markets))
            try:
                time.sleep(delay)
                status = answer(markets) if answer else 200
            finally:
                with lock:
                    active.difference_update(markets)
            if isinstance(status, bytes):
                return Response(status)
            prices = {r["token_id"]: {"BUY": "0.4", "SELL": "0.6"} for r in body}
            return Response(json.dumps(prices).encode(), status or 200)

    monkeypatch.setattr(pool, "session", lambda index: Session())
    return requests_, overlaps


def settings(**overrides):
    return {
        "request_items": 1,
        "writers": 2,
        "max_pending_writes": 2,
        "summary_seconds": 60,
    } | overrides


def pool_of(inflight=4, retries=2):
    return IPPool("test", [], inflight, {"/prices": (500, 10)}, HttpPolicy(30, retries, 60, 10000))


def logs(capsys):
    return [json.loads(line) for line in capsys.readouterr().out.splitlines()]


def test_once_fetches_unseen_and_due_then_logs_summary(database, monkeypatch, capsys):
    pool = pool_of()
    sent, overlaps = fake_prices(pool, monkeypatch)
    result = clob.runtime_clob(pool, stop=threading.Event(), once=True, **settings())
    assert result == Result.COMPLETE
    assert sorted(m for r in sent for m in names(r)) == ["a", "b", "early", "late"]
    assert not overlaps and stored(database, "retired") is None
    # a and b are new; early and late keep 0.4/0.6 but were an interval old: all four written.
    for name in ("a", "b", "early", "late"):
        assert stored(database, name)[2] > NOW
    assert stored(database, "fresh")[2] == NOW + timedelta(seconds=3600)
    summary = next(log for log in logs(capsys) if log["event"] == "dispatch_summary")
    exits = summary["exits"]
    assert set(exits) == {"default"} and exits["default"] | {"http_p50": 0, "http_p95": 0} == {
        "requests": 4,
        "markets": 4,
        "errors": 0,
        "requeued": 0,
        "invalid": 0,
        "http_429": 0,
        "http_p50": 0,
        "http_p95": 0,
    }
    # Seconds of each HTTP 200 on this exit, from sending to the whole body read.
    assert 0 <= exits["default"]["http_p50"] <= exits["default"]["http_p95"] < 1
    assert summary["fetched"] == 4 and summary["written"] == 4 and summary["all_exits_429"] == 0
    # At most 2 waiting before intake stops, plus the 4 fetches already on their way.
    assert 1 <= summary["write_queue_max"] <= 2 + 4 and summary["write_queue_full_seconds"] >= 0
    assert summary["deleted"] == 1 and summary["added"] == 5 and summary["removed"] == 0
    assert summary["interval_changed"] == 0 and summary["unseen"] == summary["inflight"] == 0
    assert set(summary["groups"]) == {"10", "60"}
    ten = summary["groups"]["10"]
    assert ten["markets"] == ten["fetched"] == 4
    assert set(ten) == {"markets", "fetched", "age_p50", "age_p95", "overdue", "overdue_share"}
    assert summary["groups"]["60"]["overdue"] == 0 and pool.success == 4


def test_resident_keeps_refilling_without_duplicates_until_stopped(database, monkeypatch):
    pool = pool_of()
    sent, overlaps = fake_prices(pool, monkeypatch, delay=0.01)
    stop = threading.Event()
    timer = threading.Timer(1, stop.set)
    timer.start()
    try:
        result = clob.runtime_clob(pool, stop=stop, once=False, **settings())
    finally:
        timer.cancel()
    assert result == Result.COMPLETE
    # Not waiting for due times: a market fetched a moment ago goes again when slots are free.
    fetched = [m for r in sent for m in names(r)]
    assert set(fetched[:2]) == {"a", "b"}
    assert fetched.count("a") > 2 and "fresh" in fetched and len(sent) > 15
    assert not overlaps
    assert not {"retired", "one", "three", "missing"} & set(fetched)


def test_failed_batch_goes_back_and_dispatch_goes_on(database, monkeypatch, capsys):
    pool = pool_of()
    failures = []

    def answer(markets):
        if markets == {"r4-test-b"} and len(failures) < 3:
            failures.append(1)
            raise requests.exceptions.ProxyError("test proxy failure")

    sent, _ = fake_prices(pool, monkeypatch, answer=answer)
    result = clob.runtime_clob(pool, stop=threading.Event(), once=True, **settings())
    # Three attempts (two retries) fail, the batch goes back, b is fetched on a later turn.
    assert result == Result.COMPLETE and len(failures) == 3
    assert [names(r) for r in sent].count(["b"]) == 4 and stored(database, "b")[2] > NOW
    records = logs(capsys)
    summary = next(log for log in records if log["event"] == "dispatch_summary")
    assert summary["exits"]["default"]["requeued"] == 1
    assert summary["exits"]["default"]["errors"] == 3
    requeued = [log for log in records if log["event"] == "batch_requeued"]
    assert requeued == [requeued[0]] and requeued[0]["ip"] == "default"
    assert requeued[0]["markets"] == 1


@pytest.mark.parametrize("answer", [404, b'{"unrequested-asset": {}}'])
def test_invalid_batch_is_not_written_and_waits_an_interval(database, monkeypatch, capsys, answer):
    pool = pool_of()
    sent, _ = fake_prices(pool, monkeypatch, answer=lambda m: answer if m == {"r4-test-b"} else 0)
    pickers, picker_class = [], dispatch.Picker

    def capture(*args, **kwargs):
        pickers.append(picker_class(*args, **kwargs))
        return pickers[-1]

    monkeypatch.setattr(clob, "Picker", capture)
    before = time.time()
    result = clob.runtime_clob(pool, stop=threading.Event(), once=True, **settings())
    # Not retried (a 4xx or an invalid response would come back the same) and not put back.
    assert result == Result.COMPLETE and [names(r) for r in sent].count(["b"]) == 1
    assert stored(database, "b") is None and stored(database, "a")[2] > NOW
    b = pickers[0].markets["r4-test-b"]
    assert before <= b.fetched <= time.time() and b.due == b.fetched + 10
    records = logs(capsys)
    summary = next(log for log in records if log["event"] == "dispatch_summary")
    assert summary["exits"]["default"]["invalid"] == 1
    assert summary["exits"]["default"]["requeued"] == 0
    invalid = [log for log in records if log["event"] == "batch_invalid"]
    assert len(invalid) == 1 and invalid[0]["market_ids"] == ["r4-test-b"]
    assert invalid[0]["ip"] == "default" and invalid[0]["markets"] == 1
    assert invalid[0]["status"] == (404 if answer == 404 else 200)


@pytest.mark.parametrize("status", [401, 403, 429])
def test_auth_and_all_exits_429_end_the_call_after_in_flight_writes(database, monkeypatch, status):
    pool = pool_of(retries=0)
    sent, _ = fake_prices(pool, monkeypatch, answer=lambda m: status if m == {"r4-test-b"} else 0)
    with pytest.raises(ProviderError) as caught:
        clob.runtime_clob(pool, stop=threading.Event(), once=False, **settings())
    assert caught.value.status == status and ["r4-test-b"] in sent
    if status != 429:
        # Batches already sent finish and are written before the call ends. (After a 429 the
        # only exit cools down, so the others may fail the same way.)
        assert stored(database, "a")[2] > NOW


def test_database_error_ends_the_call_as_an_error(database, monkeypatch, capsys):
    pool = pool_of()
    fake_prices(pool, monkeypatch)

    def fail(connection, rows):
        raise psycopg.OperationalError("test database failure")

    monkeypatch.setattr(clob, "s16_publish", fail)
    result = clob.runtime_clob(pool, stop=threading.Event(), once=False, **settings())
    assert result == Result.ERROR
    errors = [log for log in logs(capsys) if log["event"] == "database_error"]
    assert errors and errors[0]["reason"] == "OperationalError"


def test_slot_frees_when_http_returns_and_markets_stay_in_flight_until_written(
    database, monkeypatch, capsys
):
    pool = pool_of(inflight=2)
    sent, overlaps = fake_prices(pool, monkeypatch)
    release, writes, pickers = threading.Event(), [], []
    publish, picker_class = clob.s16_publish, clob.Picker

    def blocked(connection, rows):
        writes.append(rows[0][0])
        assert release.wait(5)
        return publish(connection, rows)

    def capture(*args, **kwargs):
        pickers.append(picker_class(*args, **kwargs))
        return pickers[-1]

    monkeypatch.setattr(clob, "s16_publish", blocked)
    monkeypatch.setattr(clob, "Picker", capture)
    stop = threading.Event()
    options = settings(writers=1, max_pending_writes=3)
    runner = threading.Thread(
        target=lambda: pickers.append(clob.runtime_clob(pool, stop=stop, once=False, **options))
    )
    runner.start()
    try:
        deadline = time.monotonic() + 3
        while len(sent) < 3 and time.monotonic() < deadline:
            time.sleep(0.01)
        time.sleep(0.2)
        # The first write is stuck, yet a third batch went out (2 slots) and both exit slots are
        # free again ...
        assert len(sent) >= 3 and pool.inflight == [0]
        # ... until three batches wait to be written (plus what was already on its way).
        count = len(sent)
        time.sleep(0.2)
        assert len(sent) == count <= 3 + 2
        # The batch being written stays in flight: it is never sent again meanwhile.
        assert writes[0] in pickers[0].inflight and sent.count([writes[0]]) == 1
    finally:
        release.set()
        stop.set()
        runner.join(5)
    assert pickers[-1] == Result.COMPLETE and not overlaps and not pickers[0].inflight
    summary = next(log for log in logs(capsys) if log["event"] == "dispatch_summary")
    assert summary["write_queue_max"] >= 3 and summary["write_queue_full_seconds"] > 0


def test_summary_every_period_and_maintenance_failure_stops_the_runtime(
    database, monkeypatch, capsys
):
    pool = pool_of()
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
    summary = next(log for log in logs(capsys) if log["event"] == "dispatch_summary")
    assert 0.1 < summary["seconds"] < 1 and summary["exits"]["default"]["markets"] > 0
