"""Exact REST book fixtures; local DB state is rolled back."""

import copy
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from h_shared.h_ip_pool import ContractError, HttpPolicy, IPPool
from h_shared.h_process import Result
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


@pytest.fixture
def database(monkeypatch, empty_database):
    c = empty_database
    monkeypatch.setattr(book, "h_connect", lambda **kwargs: nullcontext(c))
    c.execute(
        """INSERT INTO m_live.m01_event
        (event_id,slug,title,active,closed,archived,tags,in_current_scan,m_live_updated_at)
        VALUES ('r7-event','r7-event','test',true,false,false,'[]',true,%s)""",
        (NOW,),
    )
    for name in ("a", "b", "early", "late", "null", "fresh", "one", "three", "missing", "retired"):
        market = "r7-" + name
        c.execute(
            """INSERT INTO m_live.m01_market
            (market_id,event_id,sort_order,protocol_version,slug,question,active,closed,
                archived,in_current_scan,m_live_updated_at)
            VALUES (%s,'r7-event',0,'v1',%s,%s,true,false,false,true,%s)""",
            (market, market, market, NOW),
        )
        for index in range(1 if name == "one" else 3 if name == "three" else 2):
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
        if name != "retired":
            c.execute(
                """INSERT INTO m_live.m01_demand_market (market_id,refresh_seconds,book_levels)
                VALUES (%s,%s,%s)""",
                (
                    market,
                    60 if name == "late" else 10,
                    1 if name == "late" else None if name == "null" else 0,
                ),
            )
        if name in ("early", "late", "null", "fresh", "retired"):
            age = {"early": 350, "late": 80, "null": 20, "fresh": 100, "retired": 100}[name]
            c.execute(
                """INSERT INTO m_live.m03_clob_book
                (market_id,asset_id,bids,asks,requested_at,m_live_updated_at)
                VALUES (%s,%s,'[]','[]',%s,%s)""",
                (market, market + "-0", NOW - timedelta(seconds=age), NOW),
            )
    return c


def test_two_intervals_unseen_then_oldest_and_binary_only(database):
    rows = book.s01_due(database, 100, NOW, 300)
    assert [r[0] for r in rows] == ["r7-a", "r7-b", "r7-early", "r7-late", "r7-null"]
    assert all(asset == market + "-0" for market, asset in rows)
    assert book.s01_due(database, 2, NOW, 300) == rows[:2]
    # The declared default is a parameter, not a hard-coded 300 inside the runtime.
    assert "r7-fresh" in [r[0] for r in book.s01_due(database, 100, NOW, 90)]


def test_round_cap_pending_and_removed_demand_cleanup(database, monkeypatch):
    client = IPPool("test", [], 4, {"/books": (500, 10)}, HttpPolicy(30, 0, 60, 10000))
    calls = []

    def request(method, url, **kwargs):
        calls.append(kwargs["body"])
        return [response(r["token_id"]) for r in kwargs["body"]]

    monkeypatch.setattr(client, "request", request)
    assert (
        book.runtime_book(
            client, request_items=1, max_markets=2, max_pending_writes=2, book_seconds=300
        )
        == Result.PENDING
    )
    assert len(calls) == 2 and all(len(r) == 1 for r in calls)
    assert (
        database.execute(
            "SELECT count(*) FROM m_live.m03_clob_book WHERE market_id='r7-retired'"
        ).fetchone()[0]
        == 0
    )
    database.execute("DELETE FROM m_live.m01_demand_market")
    assert (
        book.runtime_book(
            client, request_items=1, max_markets=2, max_pending_writes=2, book_seconds=300
        )
        == Result.COMPLETE
    )
    assert database.execute("SELECT count(*) FROM m_live.m03_clob_book").fetchone()[0] == 0
    assert len(calls) == 2
    client.close()


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


@pytest.mark.parametrize("write_limit", [1, 3, 8])
def test_fetch_continues_during_blocked_write_but_pending_data_is_bounded(monkeypatch, write_limit):
    client = IPPool("test", [], 4, {"/books": (500, 10)}, HttpPolicy(30, 0, 60, 10000))
    started, release, progressed = threading.Event(), threading.Event(), threading.Event()
    fetched, published = [], []
    lock = threading.Lock()
    connection = object()
    connections = []

    def connect(**kwargs):
        assert kwargs == {"autocommit": True}
        connections.append(connection)
        return nullcontext(connection)

    def request(method, url, **kwargs):
        asset = kwargs["body"][0]["token_id"]
        if asset != "0":
            assert started.wait(2)
        with lock:
            fetched.append(asset)
            if started.is_set():
                progressed.set()
        return [response(asset)]

    def publish(conn, rows):
        assert conn is connection
        started.set()
        assert release.wait(5)
        published.extend(rows)
        return len(rows), len(rows), 0

    monkeypatch.setattr(book, "h_connect", connect)
    monkeypatch.setattr(client, "request", request)
    monkeypatch.setattr(book, "s08_publish", publish)
    markets = [(str(i), str(i)) for i in range(100)]
    with ThreadPoolExecutor(max_workers=1) as runner:
        result = runner.submit(book.c02_refresh, client, markets, 1, write_limit)
        try:
            assert started.wait(2)
            assert progressed.wait(2), "HTTP must progress while the first DB write is blocked"
            time.sleep(0.1)
            with lock:
                waiting = len(fetched)
            # Includes all completed or active fetches and the active write.
            assert 1 < waiting <= write_limit + client.ip_inflight
            time.sleep(0.1)
            with lock:
                assert len(fetched) == waiting, "Backpressure must stop further intake"
            assert not published and not result.done()
        finally:
            release.set()
        assert result.result(timeout=5) == (100, 100, 0)
    assert len(connections) == 1
    assert {r[0] for r in published} == {m[0] for m in markets}
    assert client.success == 100
    client.close()


def test_writer_error_is_propagated_and_intake_stops(monkeypatch):
    client = IPPool("test", [], 4, {"/books": (500, 10)}, HttpPolicy(30, 0, 60, 10000))
    fetched = []
    monkeypatch.setattr(book, "h_connect", lambda **kwargs: nullcontext(object()))

    def request(method, url, **kwargs):
        fetched.append(1)
        return []

    def fail(connection, rows):
        raise RuntimeError("database write failed")

    monkeypatch.setattr(client, "request", request)
    monkeypatch.setattr(book, "s08_publish", fail)
    with pytest.raises(RuntimeError, match="database write failed"):
        book.c02_refresh(client, [(str(i), str(i)) for i in range(100)], 1, 3)
    assert len(fetched) <= 3 + client.ip_inflight
    client.close()


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
