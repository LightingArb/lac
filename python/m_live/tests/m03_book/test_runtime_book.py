"""Exact REST book fixtures; local DB state is rolled back."""

import copy
import json
import threading
import time
from collections import Counter
from concurrent.futures import Future
from contextlib import nullcontext
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import psycopg
import pytest
import requests

from h_shared.h_ip_pool import ContractError, HttpPolicy, IPPool
from h_shared.h_process import Result
from m_live.src import h_dispatch as dispatch
from m_live.src.m03_book import runtime_book as book

FIXTURE = json.loads((Path(__file__).parent / "books.json").read_text())
SOURCE, EMPTY = FIXTURE["books"]
NOW = datetime.now(UTC)


def response(asset):
    # Identity replacement is only for scheduler/DB internal branches.
    return SOURCE | {"asset_id": asset}


def test_real_sorted_numeric_levels_and_metadata():
    row = book.s03_parse([SOURCE], [("market", SOURCE["asset_id"])], NOW)[0]
    for i, side, reverse in ((2, "bids", True), (3, "asks", False)):
        actual = json.loads(row[i], parse_float=Decimal)
        expected = sorted(
            [[Decimal(x["price"]), Decimal(x["size"])] for x in SOURCE[side]],
            key=lambda x: x[0],
            reverse=reverse,
        )
        assert actual == expected
        assert all(isinstance(v, (Decimal, int)) for level in actual for v in level)
    assert row[4] == datetime(1970, 1, 1, tzinfo=UTC) + timedelta(
        milliseconds=int(SOURCE["timestamp"])
    )
    assert row[5:8] == (
        SOURCE["hash"],
        Decimal(SOURCE["tick_size"]),
        Decimal(SOURCE["min_order_size"]),
    )
    assert row[8] == NOW


def test_empty_missing_and_unrequested_are_distinct():
    rows = book.s03_parse(
        [EMPTY, {"asset_id": "unrequested", "bids": "invalid"}],
        [("empty", EMPTY["asset_id"]), ("missing", "absent")],
        NOW,
    )
    assert rows[0][2:4] == ("[]", "[]")
    assert rows[1][2:8] == (None,) * 6


@pytest.mark.parametrize(
    "field,value",
    [
        ("price", "-0.1"),
        ("price", "1.1"),
        ("price", "NaN"),
        ("price", True),
        ("size", "0"),
        ("size", "-1"),
        ("size", "Infinity"),
        ("size", "bad"),
        ("size", None),
    ],
)
def test_invalid_levels_fail_closed(field, value):
    source = copy.deepcopy(SOURCE)
    source["bids"][0][field] = value
    with pytest.raises(ContractError):
        book.s03_parse([source], [("market", SOURCE["asset_id"])], NOW)


@pytest.mark.parametrize(
    "change",
    [
        {"bids": None},
        {"asks": "bad"},
        {"bids": [[]]},
        {"timestamp": True},
        {"timestamp": "1.5"},
        {"timestamp": "9" * 40},
        {"hash": None},
        {"tick_size": "0"},
        {"min_order_size": "-1"},
    ],
)
def test_invalid_metadata_or_shape_fails(change):
    with pytest.raises(ContractError):
        book.s03_parse([SOURCE | change], [("market", SOURCE["asset_id"])], NOW)


@pytest.mark.parametrize("value", [{}, [None], [{"bids": []}], [SOURCE, SOURCE]])
def test_invalid_response_and_duplicate_token_fail(value):
    with pytest.raises(ContractError):
        book.s03_parse(value, [("market", SOURCE["asset_id"])], NOW)


def test_requested_time_is_before_http(monkeypatch):
    class Clock(datetime):
        current = NOW

        @classmethod
        def now(cls, zone):
            return cls.current

    client = IPPool("test", [], 4, {"/books": (500, 10)}, HttpPolicy(30, 0, 60, 10000))

    def request(method, url, **kwargs):
        assert (method, url) == ("POST", "https://clob.polymarket.com/books")
        assert kwargs["body"] == [{"token_id": SOURCE["asset_id"]}]
        Clock.current += timedelta(seconds=7)
        return [SOURCE]

    monkeypatch.setattr(book, "datetime", Clock)
    monkeypatch.setattr(client, "request", request)
    assert book.s02_refresh(client, [("market", SOURCE["asset_id"])])[0][8] == NOW
    client.close()


def add_market(c, name, refresh=10, levels=0, outcomes=2):
    market = "r7-" + name
    c.execute(
        """INSERT INTO m_live.m01_market
        (market_id,event_id,sort_order,protocol_version,slug,question,active,closed,
            archived,in_current_scan,m_live_updated_at)
        VALUES (%s,'r7-event',0,'v1',%s,%s,true,false,false,true,%s)""",
        (market, market, market, NOW),
    )
    for index in range(outcomes):
        c.execute(
            """INSERT INTO m_live.m01_outcome (market_id,outcome_index,label,asset_id)
            VALUES (%s,%s,%s,%s)""",
            (
                market,
                index,
                str(index),
                None if name == "missing" and index == 1 else f"{market}-{index}",
            ),
        )
    if refresh is not None:
        c.execute(
            """INSERT INTO m_live.m01_demand_market (market_id,refresh_seconds,book_levels)
            VALUES (%s,%s,%s)""",
            (market, refresh, levels),
        )


# Books stored this many seconds ago.
AGES = {"early": 350, "late": 80, "null": 20, "fresh": 100, "retired": 100}


@pytest.fixture
def database(monkeypatch, empty_database):
    c = empty_database
    monkeypatch.setattr(book, "h_connect", lambda **kwargs: nullcontext(c))
    monkeypatch.setattr(dispatch, "h_connect", lambda **kwargs: nullcontext(c))
    c.execute(
        """INSERT INTO m_live.m01_event
        (event_id,slug,title,active,closed,archived,tags,in_current_scan,m_live_updated_at)
        VALUES ('r7-event','r7-event','test',true,false,false,'[]',true,%s)""",
        (NOW,),
    )
    for name in ("a", "b", "early", "late", "null", "fresh", "one", "three", "missing", "retired"):
        add_market(
            c,
            name,
            None if name == "retired" else 60 if name == "late" else 10,
            1 if name == "late" else None if name == "null" else 0,
            1 if name == "one" else 3 if name == "three" else 2,
        )
        if name in AGES:
            c.execute(
                """INSERT INTO m_live.m03_clob_book
                (market_id,asset_id,bids,asks,requested_at,m_live_updated_at)
                VALUES (%s,%s,'[]','[]',%s,%s)""",
                ("r7-" + name, f"r7-{name}-0", NOW - timedelta(seconds=AGES[name]), NOW),
            )
    return c


def names(markets):
    """Short names of market ids or (market, asset) pairs."""
    return [(m if isinstance(m, str) else m[0]).removeprefix("r7-") for m in markets]


def stored(connection, name):
    return connection.execute(
        "SELECT requested_at FROM m_live.m03_clob_book WHERE market_id=%s", ("r7-" + name,)
    ).fetchone()


def picker_of(size, once=False):
    return dispatch.Picker("runtime_book", size, once, 0.5)


def test_schedule_starts_from_demand_and_stored_books(database):
    picker = picker_of(10)
    changes = book.c01_maintain(picker, book_seconds=300)
    assert changes == {"deleted": 1, "added": 6, "removed": 0, "interval_changed": 0}
    # Binary demanded markets only; retired lost its book row.
    assert set(names(picker.markets)) == {"a", "b", "early", "late", "null", "fresh"}
    assert stored(database, "retired") is None
    # book_levels=0: book_seconds; another book_levels (or null): the demand's interval.
    seconds = {name: picker.markets["r7-" + name].seconds for name in names(picker.markets)}
    assert seconds == {"a": 300, "b": 300, "early": 300, "late": 60, "null": 10, "fresh": 300}
    a, early = picker.markets["r7-a"], picker.markets["r7-early"]
    assert a.fetched is None and a.due == float("-inf") and a.asset == "r7-a-0"
    assert early.fetched == pytest.approx((NOW - timedelta(seconds=350)).timestamp())
    assert early.due == pytest.approx(early.fetched + 300)
    # The declared default is a parameter, not a hard-coded 300 inside the runtime.
    other = picker_of(10)
    book.c01_maintain(other, book_seconds=90)
    assert other.markets["r7-fresh"].seconds == 90


def test_take_due_only_unseen_first_and_wait_when_none_is_due(database):
    picker = picker_of(2)
    book.c01_maintain(picker, book_seconds=300)
    now = time.time()
    # Never fetched first, then due ones by due time; fresh is due in 200 s and is not taken.
    batches = [dispatch.s05_take(picker, now) for _ in range(3)]
    assert [names(b) for b in batches] == [["a", "b"], ["early", "late"], ["null"]]
    assert dispatch.s05_take(picker, now) is None and not picker.finished
    # Nothing due: no new look for half a second.
    assert picker.look_again == now + 0.5
    # null comes back: due an interval (10 s) after this request, and in flight until written.
    at = datetime.now(UTC)
    dispatch.s10_fetched(picker, [("r7-null", "r7-null-0", *(None,) * 6, at)], "default")
    assert picker.markets["r7-null"].due == pytest.approx(at.timestamp() + 10)
    assert "r7-null" in picker.inflight
    future = Future()
    future.set_result(0)
    dispatch.s12_collect({future: batches[2]}, picker, block=False)
    later = at.timestamp() + 10
    assert dispatch.s05_take(picker, later - 1) is None
    assert picker.look_again == pytest.approx(later - 0.5)
    assert names(dispatch.s05_take(picker, later)) == ["null"]


def test_reload_adds_drops_changes_intervals_and_deletes_rows(database):
    picker = picker_of(10)
    book.c01_maintain(picker, book_seconds=300)
    late = picker.markets["r7-late"]
    database.execute("DELETE FROM m_live.m01_demand_market WHERE market_id='r7-fresh'")
    database.execute("UPDATE m_live.m01_demand_market SET book_levels=0 WHERE market_id='r7-late'")
    add_market(database, "new")
    changes = book.c01_maintain(picker, book_seconds=300)
    assert changes == {"deleted": 1, "added": 1, "removed": 1, "interval_changed": 1}
    assert "r7-fresh" not in picker.markets and stored(database, "fresh") is None
    # late now has 300 s: its last fetch + 300 s is still ahead, so it is not taken.
    assert late.seconds == 300 and late.due == pytest.approx(late.fetched + 300)
    assert names(dispatch.s05_take(picker, time.time())) == ["a", "b", "new", "early", "null"]


def test_start_spreads_unseen_and_due_books_over_one_interval_new_ones_later_come_first(database):
    picker = dispatch.Picker("runtime_book", 10, False, 0.5, spread=True)
    before = time.time()
    book.c01_maintain(picker, book_seconds=300)
    after = time.time()
    markets = {name: picker.markets["r7-" + name] for name in names(picker.markets)}
    # No row (a, b) or already due (early, late, null): now + up to one interval, last fetch kept.
    for name in ("a", "b", "early", "late", "null"):
        market = markets[name]
        assert before <= market.due <= after + market.seconds
    assert markets["a"].fetched is None
    assert markets["early"].fetched == pytest.approx((NOW - timedelta(seconds=350)).timestamp())
    # Not due yet (fresh): its last request + interval, as before.
    assert markets["fresh"].due == pytest.approx(markets["fresh"].fetched + 300)
    assert dispatch.s05_take(picker, before - 1) is None
    # Only the first load spreads: a market added later is taken first.
    add_market(database, "new")
    assert book.c01_maintain(picker, book_seconds=300)["added"] == 1
    assert names(dispatch.s05_take(picker, before)) == ["new"]


def test_start_spread_is_even_over_the_interval():
    picker = dispatch.Picker("runtime_book", 10, False, 0.5, spread=True)
    before = time.time()
    dispatch.h_merge(picker, [(f"m{i}", f"m{i}-0", 300, None) for i in range(4000)])
    quarters = Counter(min(int((m.due - before) // 75), 3) for m in picker.markets.values())
    # 1,000 expected per quarter of the interval; 860 is five standard deviations below.
    assert min(quarters[q] for q in range(4)) > 860


def test_publication_identity_demand_newer_and_exact_decimal(database):
    source = response("r7-a-0") | {
        "bids": [{"price": "0.123456789123456789", "size": "123456789.123456789"}]
    }
    row = book.s03_parse([source], [("r7-a", "r7-a-0")], NOW)[0]
    assert book.s08_publish(database, [row]) == (1, 1, 0)
    older = row[:-1] + (NOW - timedelta(seconds=1),)
    assert book.s08_publish(database, [older]) == (0, 0, 0)
    stored = database.execute(
        "SELECT bids::text,source_timestamp,source_hash,requested_at FROM m_live.m03_clob_book WHERE market_id='r7-a'"
    ).fetchone()
    assert json.loads(stored[0], parse_float=Decimal) == [
        [Decimal("0.123456789123456789"), Decimal("123456789.123456789")]
    ]
    assert stored[1:] == (row[4], row[5], NOW)
    database.execute(
        "UPDATE m_live.m01_outcome SET asset_id='changed' WHERE market_id='r7-a' AND outcome_index=0"
    )
    assert book.s08_publish(database, [row]) == (0, 0, 0)
    fresh = (row[0], "changed", *row[2:-1], NOW + timedelta(seconds=1))
    assert book.s08_publish(database, [fresh]) == (1, 1, 0)
    database.execute("DELETE FROM m_live.m01_demand_market WHERE market_id='r7-a'")
    assert book.s08_publish(database, [fresh]) == (0, 0, 0)
    database.execute(
        "UPDATE m_live.m01_outcome SET asset_id=NULL WHERE market_id='r7-b' AND outcome_index=1"
    )
    missing = book.s03_parse([], [("r7-b", "r7-b-0")], NOW)[0]
    assert book.s08_publish(database, [missing]) == (0, 0, 0)


def test_database_empty_and_missing_metadata(database):
    rows = book.s03_parse(
        [EMPTY | {"asset_id": "r7-a-0"}], [("r7-a", "r7-a-0"), ("r7-b", "r7-b-0")], NOW
    )
    assert book.s08_publish(database, rows) == (2, 1, 1)
    stored = database.execute(
        "SELECT bids,asks,source_timestamp,source_hash,tick_size,min_order_size FROM m_live.m03_clob_book WHERE market_id='r7-b'"
    ).fetchone()
    assert stored == (None,) * 6
    assert database.execute(
        "SELECT bids,asks FROM m_live.m03_clob_book WHERE market_id='r7-a'"
    ).fetchone() == ([], [])


class Response:
    def __init__(self, body, status=200):
        self.body, self.status_code, self.headers = body, status, {}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def iter_content(self, **_):
        yield self.body


def fake_books(pool, monkeypatch, answer=None):
    """Answer /books below IPPool.request (slots, retries and counters stay real) and record each
    request's markets. answer(markets) may return a status or a book list, or raise."""
    sent, lock = [], threading.Lock()

    class Session:
        def request(self, method, url, **kwargs):
            tokens = [r["token_id"] for r in kwargs["json"]]
            markets = {token.rsplit("-", 1)[0] for token in tokens}
            with lock:
                sent.append(sorted(markets))
            status = answer(markets) if answer else 200
            if isinstance(status, list):
                return Response(json.dumps(status).encode())
            return Response(json.dumps([response(t) for t in tokens]).encode(), status or 200)

    monkeypatch.setattr(pool, "session", lambda index: Session())
    return sent


def settings(**overrides):
    return {
        "request_items": 1,
        "writers": 2,
        "max_pending_writes": 2,
        "summary_seconds": 60,
        "book_seconds": 300,
        "due_wait": 0.5,
    } | overrides


def pool_of(inflight=4, retries=2):
    return IPPool("test", [], inflight, {"/books": (500, 10)}, HttpPolicy(30, retries, 60, 10**7))


def logs(capsys):
    return [json.loads(line) for line in capsys.readouterr().out.splitlines()]


def capture_pickers(monkeypatch):
    pickers, picker_class = [], dispatch.Picker

    def capture(*args, **kwargs):
        pickers.append(picker_class(*args, **kwargs))
        return pickers[-1]

    monkeypatch.setattr(book, "Picker", capture)
    return pickers


def spread_to(monkeypatch, part):
    """Fix the start spread: a book due at start comes due at now + part(its interval)."""
    monkeypatch.setattr(dispatch.random, "uniform", lambda low, high: part(high))


def test_once_fetches_unseen_and_due_once_then_logs_summary(database, monkeypatch, capsys):
    pool = pool_of()
    sent = fake_books(pool, monkeypatch)
    result = book.runtime_book(pool, stop=threading.Event(), once=True, **settings())
    assert result == Result.COMPLETE
    assert sorted(m for r in sent for m in names(r)) == ["a", "b", "early", "late", "null"]
    # Every fetched book is written; fresh is not due and keeps its row.
    for name in ("a", "b", "early", "late", "null"):
        assert stored(database, name)[0] > NOW
    assert stored(database, "fresh")[0] == NOW - timedelta(seconds=100)
    summary = next(log for log in logs(capsys) if log["event"] == "dispatch_summary")
    exits = summary["exits"]["default"]
    assert {k: v for k, v in exits.items() if not k.startswith("http_p")} == {
        "requests": 5,
        "markets": 5,
        "errors": 0,
        "requeued": 0,
        "invalid": 0,
        "http_429": 0,
    }
    assert 0 <= exits["http_p50"] <= exits["http_p95"] < 1
    assert summary["fetched"] == summary["written"] == 5 and summary["deleted"] == 1
    assert set(summary["groups"]) == {"10", "60", "300"}
    assert summary["groups"]["300"]["markets"] == 4 and summary["groups"]["300"]["fetched"] == 4
    assert summary["unseen"] == summary["inflight"] == 0 and pool.success == 5


def test_resident_spreads_due_books_at_start_and_fetches_only_due_ones(database, monkeypatch):
    pool = pool_of()
    sent = fake_books(pool, monkeypatch)
    # Books due at start come due a whole interval later if it is 300 s, else right away.
    spread_to(monkeypatch, lambda seconds: seconds if seconds == 300 else 0)
    stop = threading.Event()
    timer = threading.Timer(1, stop.set)
    timer.start()
    try:
        result = book.runtime_book(pool, stop=stop, once=False, **settings())
    finally:
        timer.cancel()
    assert result == Result.COMPLETE
    # Within a second nothing is due again (the shortest interval is 10 s): late and null once;
    # a, b and early (spread 300 s ahead), fresh (due in 200 s) and the non-binary or undemanded
    # markets never.
    fetched = sorted(m for r in sent for m in names(r))
    assert fetched == ["late", "null"]


def test_failed_batch_goes_back_and_dispatch_goes_on(database, monkeypatch, capsys):
    pool = pool_of()
    failures = []

    def answer(markets):
        if markets == {"r7-b"} and len(failures) < 3:
            failures.append(1)
            raise requests.exceptions.ProxyError("test proxy failure")

    sent = fake_books(pool, monkeypatch, answer)
    result = book.runtime_book(pool, stop=threading.Event(), once=True, **settings())
    # Three attempts (two retries) fail, the batch goes back, b is fetched on a later turn.
    assert result == Result.COMPLETE and sent.count(["r7-b"]) == 4
    assert stored(database, "b")[0] > NOW
    records = logs(capsys)
    summary = next(log for log in records if log["event"] == "dispatch_summary")
    assert summary["exits"]["default"]["requeued"] == 1
    assert summary["exits"]["default"]["invalid"] == 0
    assert [log["markets"] for log in records if log["event"] == "batch_requeued"] == [1]


@pytest.mark.parametrize(
    ("failure", "status", "reason"),
    [
        (requests.exceptions.ProxyError, 0, "ProxyError"),
        (requests.exceptions.ReadTimeout, 0, "ReadTimeout"),
        (502, 502, "HTTP 502"),
    ],
)
def test_requeued_batch_logs_what_the_last_attempt_failed_on(
    database, monkeypatch, capsys, failure, status, reason
):
    pool, failures = pool_of(retries=0), []

    def answer(markets):
        if markets == {"r7-b"} and not failures:
            failures.append(1)
            if failure == 502:
                return 502
            raise failure("test failure")

    fake_books(pool, monkeypatch, answer)
    result = book.runtime_book(pool, stop=threading.Event(), once=True, **settings())
    assert result == Result.COMPLETE
    requeued = [log for log in logs(capsys) if log["event"] == "batch_requeued"]
    assert [(log["status"], log["reason"]) for log in requeued] == [(status, reason)]


@pytest.mark.parametrize("answer", [400, [SOURCE | {"asset_id": "r7-early-0", "hash": None}]])
def test_invalid_batch_is_not_written_and_waits_an_interval(database, monkeypatch, capsys, answer):
    pool = pool_of()
    sent = fake_books(pool, monkeypatch, lambda m: answer if m == {"r7-early"} else 0)
    pickers = capture_pickers(monkeypatch)
    before = time.time()
    result = book.runtime_book(pool, stop=threading.Event(), once=True, **settings())
    # Sent once, not written (the stored book stays), next due an interval after this request.
    assert result == Result.COMPLETE and sent.count(["r7-early"]) == 1
    assert stored(database, "early")[0] == NOW - timedelta(seconds=350)
    early = pickers[0].markets["r7-early"]
    assert before <= early.fetched <= time.time() and early.due == early.fetched + 300
    records = logs(capsys)
    invalid = [log for log in records if log["event"] == "batch_invalid"]
    assert len(invalid) == 1 and invalid[0]["market_ids"] == ["r7-early"]
    assert invalid[0]["status"] == (400 if answer == 400 else 200)
    summary = next(log for log in records if log["event"] == "dispatch_summary")
    assert summary["exits"]["default"]["invalid"] == 1 and summary["written"] == 4


def test_slot_frees_when_http_returns_and_books_stay_in_flight_until_written(
    database, monkeypatch, capsys
):
    pool = pool_of(inflight=1)
    sent = fake_books(pool, monkeypatch)
    spread_to(monkeypatch, lambda seconds: 0)
    pickers = capture_pickers(monkeypatch)
    release, writes, results = threading.Event(), [], []
    publish = book.s08_publish

    def blocked(connection, rows):
        writes.append(rows[0][0])
        assert release.wait(5)
        return publish(connection, rows)

    monkeypatch.setattr(book, "s08_publish", blocked)
    stop = threading.Event()
    options = settings(writers=1, max_pending_writes=2)
    runner = threading.Thread(
        target=lambda: results.append(book.runtime_book(pool, stop=stop, once=False, **options))
    )
    runner.start()
    try:
        deadline = time.monotonic() + 3
        while len(sent) < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        time.sleep(0.2)
        # The first write is stuck, yet with one exit slot a second batch went out; then two
        # batches wait to be written and nothing more is sent.
        assert len(sent) == 2 and pool.inflight == [0]
        assert writes[0] in pickers[0].inflight and sent.count([writes[0]]) == 1
    finally:
        release.set()
        stop.set()
        runner.join(5)
    assert results == [Result.COMPLETE] and not pickers[0].inflight
    summary = next(log for log in logs(capsys) if log["event"] == "dispatch_summary")
    assert summary["write_queue_max"] == 2 and summary["write_queue_full_seconds"] > 0


def test_database_error_ends_the_call_as_an_error(database, monkeypatch, capsys):
    pool = pool_of()
    fake_books(pool, monkeypatch)
    spread_to(monkeypatch, lambda seconds: 0)

    def fail(connection, rows):
        raise psycopg.OperationalError("test database failure")

    monkeypatch.setattr(book, "s08_publish", fail)
    result = book.runtime_book(pool, stop=threading.Event(), once=False, **settings())
    assert result == Result.ERROR
    errors = [log for log in logs(capsys) if log["event"] == "database_error"]
    assert errors and errors[0]["unit"] == "runtime_book"


def test_real_legacy_zero_minimum_preserves_valid_levels(database):
    source = FIXTURE["legacy_zero_minimum"]
    assert source["min_order_size"] == "0" and source["bids"] and source["asks"]
    row = book.s03_parse([source], [("market", source["asset_id"])], NOW)[0]
    assert row[7] == Decimal(0)
    assert all(level[1] > 0 for side in row[2:4] for level in json.loads(side))
    # The observed source identity is replaced only for the local DB branch.
    assert book.s08_publish(database, [("r7-a", "r7-a-0", *row[2:])]) == (1, 1, 0)
    assert database.execute(
        "SELECT min_order_size FROM m_live.m03_clob_book WHERE market_id='r7-a'"
    ).fetchone() == (Decimal(0),)
