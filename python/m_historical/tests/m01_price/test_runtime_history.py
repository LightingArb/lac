"""Real Data API fixtures and rollback-only local history integration tests."""

import copy
import json
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from h_shared import h_db
from h_shared.h_db import h_connect
from h_shared.h_ip_pool import ContractError, HttpPolicy, IPPool, ProviderError
from h_shared.h_process import Result
from m_historical.all_setup import all_setup
from m_historical.src.h_lock import h_lock
from m_historical.src.m01_price import runtime_history as history

RECORDS = json.loads((Path(__file__).parent / "history.json").read_text())
NOW = datetime(2026, 10, 24, 12, tzinfo=UTC)
DAY = date(2026, 10, 23)
START = 1792713600


def pool():
    return IPPool("test", [], 4, {"/v2/prices-history": (200, 10)}, HttpPolicy(30, 0, 60, 1000000))


def test_real_response_minute_prices_and_empty_day():
    record = RECORDS[0]
    prices = history.s02_prices(record["response"], START, START + 86400)
    assert len(prices) == 1440
    expected = {}
    for p in record["response"]["data"]:
        if p["resolution_seconds"] == 60 and START <= p["timestamp"] < START + 86400:
            i = (p["timestamp"] - START) // 60
            if i not in expected or p["timestamp"] > expected[i]["timestamp"]:
                expected[i] = p
    assert prices == [
        Decimal(str(expected[i]["price"])) if i in expected else None for i in range(1440)
    ]
    assert history.s02_prices(RECORDS[1]["response"], START, START + 86400) is None


def test_minute_boundary_tail_ignored_and_latest_timestamp_wins():
    # Mutated real points exercise the internal UTC filtering/tie branches.
    body = copy.deepcopy(RECORDS[0]["response"])
    p = body["data"][0]
    body["data"] = [
        p | {"timestamp": START - 1, "price": "0.2"},
        p | {"timestamp": START + 59, "price": "0.4"},
        p | {"timestamp": START, "price": "0.3"},
        p | {"timestamp": START + 59, "resolution_seconds": 0, "price": "0.9"},
        p | {"timestamp": START + 86399, "price": "0.6"},
        p | {"timestamp": START + 86400, "price": "0.7"},
    ]
    prices = history.s02_prices(body, START, START + 86400)
    assert prices == [Decimal("0.4")] + [None] * 1438 + [Decimal("0.6")]
    body["data"] = [p | {"resolution_seconds": 0}]
    assert history.s02_prices(body, START, START + 86400) is None


@pytest.mark.parametrize(
    "mutation", ["page", "missing_cursor", "resolution", "timestamp", "price", "shape"]
)
def test_malformed_provider_response_fails_item(mutation):
    body = copy.deepcopy(RECORDS[0]["response"])
    if mutation == "page":
        body["pagination"].update(has_more=True, next_cursor="more")
    elif mutation == "missing_cursor":
        del body["pagination"]["next_cursor"]
    elif mutation == "resolution":
        body["data"][0]["resolution_seconds"] = 300
    elif mutation == "timestamp":
        body["data"][0]["timestamp"] = True
    elif mutation == "price":
        body["data"][0]["price"] = "NaN"
    else:
        body["data"][0] = None
    with pytest.raises(ContractError):
        history.s02_prices(body, START, START + 86400)


def test_requested_time_precedes_http_and_exact_parameters(monkeypatch):
    client = pool()
    requested = []

    def request(method, url, **kwargs):
        requested.append(datetime.now(UTC))
        assert method == "GET" and url.endswith("/v2/prices-history")
        assert kwargs["params"] == {
            "token_id": "a",
            "start": START,
            "end": START + 86400,
            "bucket_seconds": 60,
            "limit": 10000,
        }
        return RECORDS[1]["response"]

    monkeypatch.setattr(client, "request", request)
    row = history.s01_fetch(client, ("m", "a", DAY))
    assert row[:4] == ("m", "a", DAY, None) and row[4] <= requested[0]
    client.close()


@pytest.fixture
def database(monkeypatch):
    with h_connect() as connection, connection.transaction(force_rollback=True):
        connection.execute("""
            TRUNCATE m_historical.m01_price_day, m_live.m03_clob_book,
                m_live.m02_clob_price, m_live.m01_demand_market,
                m_live.m01_outcome, m_live.m01_market, m_live.m01_event
        """)
        monkeypatch.setattr(history, "h_connect", lambda **kwargs: nullcontext(connection))
        connection.execute(
            """
            INSERT INTO m_live.m01_event
                (event_id,slug,title,active,closed,archived,tags,in_current_scan,m_live_updated_at)
            VALUES ('history-test','test','test',true,false,false,'[]',true,%s)
        """,
            (NOW,),
        )
        markets = [
            ("a", NOW - timedelta(days=20), False, None, 2, False),
            ("b", NOW - timedelta(days=20), False, None, 2, False),
            ("closed", NOW - timedelta(days=20), True, NOW - timedelta(days=3), 2, False),
            ("unknown", NOW - timedelta(days=20), True, None, 2, False),
            ("new", NOW.replace(hour=0), False, None, 2, False),
            ("one", NOW - timedelta(days=20), False, None, 1, False),
            ("three", NOW - timedelta(days=20), False, None, 3, False),
            ("missing", NOW - timedelta(days=20), False, None, 2, True),
            ("no-created", None, False, None, 2, False),
            (
                "close-edge",
                NOW - timedelta(days=20),
                True,
                datetime(2026, 10, 18, tzinfo=UTC),
                2,
                False,
            ),
            ("create-edge", datetime(2026, 10, 18, tzinfo=UTC), False, None, 2, False),
        ]
        for market, created, closed, closed_time, count, missing in markets:
            connection.execute(
                """
                INSERT INTO m_live.m01_market
                    (market_id,event_id,sort_order,protocol_version,slug,question,active,closed,
                     archived,in_current_scan,m_live_updated_at,created_at,closed_time)
                VALUES (%s,'history-test',0,'v1',%s,%s,true,%s,false,true,%s,%s,%s)
            """,
                (market, market, market, closed, NOW, created, closed_time),
            )
            for i in range(count):
                connection.execute(
                    """
                    INSERT INTO m_live.m01_outcome (market_id,outcome_index,label,asset_id)
                    VALUES (%s,%s,%s,%s)
                """,
                    (market, i, str(i), None if missing and i == 1 else market + "-" + str(i)),
                )
        yield connection


def test_selection_seven_days_settle_boundaries_eligibility_and_order(database):
    rows = history.c01_select(database, 100, 7, 10, NOW, date(2026, 10, 1))
    assert min(r[2] for r in rows) == date(2026, 10, 17)
    assert max(r[2] for r in rows) == DAY
    assert rows == sorted(rows, key=lambda r: (r[2], r[0]))
    assert {r[0] for r in rows} == {"a", "b", "closed", "close-edge", "create-edge"}
    assert all(asset == market + "-0" for market, asset, _ in rows)
    assert ("closed", "closed-0", date(2026, 10, 21)) in rows
    assert not any(r[0] == "closed" and r[2] >= date(2026, 10, 22) for r in rows)
    assert [r[2] for r in rows if r[0] == "close-edge"] == [date(2026, 10, 17)]
    assert min(r[2] for r in rows if r[0] == "create-edge") == date(2026, 10, 18)
    before = history.c01_select(
        database, 100, 7, 10, NOW.replace(hour=0, minute=9, second=59), date(2026, 10, 1)
    )
    assert {r[2] for r in before} == {date(2026, 10, d) for d in range(17, 23)}
    at = history.c01_select(database, 100, 7, 10, NOW.replace(hour=0, minute=10), date(2026, 10, 1))
    assert at == rows
    assert history.c01_select(database, 3, 7, 10, NOW, date(2026, 10, 1)) == rows[:3]
    assert {r[2] for r in history.c01_select(database, 100, 7, 10, NOW, DAY)} == {DAY}
    assert history.c01_select(database, 100, 7, 10, NOW, DAY + timedelta(days=1)) == []
    assert history.c01_select(database, 100, 7, 10, NOW.replace(hour=0, minute=9), DAY) == []


def test_insert_immutable_null_and_existing_rows_excluded(database):
    client = pool()
    row = ("a", "a-0", DAY, [Decimal("0.3")] + [None] * 1439, NOW, "success", None, None)
    assert history.s03_publish(client, database, row) == (1, 0, 0)
    assert history.s03_publish(
        client, database, ("a", "other", DAY, None, NOW, "no_data", None, None)
    ) == (0, 0, 0)
    stored = database.execute(
        """
        SELECT asset_id,prices,requested_at FROM m_historical.m01_price_day
        WHERE market_id='a' AND day=%s
    """,
        (DAY,),
    ).fetchone()
    assert stored == ("a-0", row[3], NOW)
    assert ("a", "a-0", DAY) not in history.c01_select(database, 100, 7, 10, NOW, DAY)
    assert history.s03_publish(
        client, database, ("b", "b-0", DAY, None, NOW, "no_data", None, None)
    ) == (1, 1, 0)
    assert ("b", "b-0", DAY) not in history.c01_select(database, 100, 7, 10, NOW, DAY)
    client.close()


def test_one_invalid_item_is_terminal_error_and_does_not_block_others(database, monkeypatch):
    class Clock(datetime):
        @classmethod
        def now(cls, zone):
            return NOW

    monkeypatch.setattr(history, "datetime", Clock)
    client = pool()
    calls = []

    def request(method, url, **kwargs):
        asset = kwargs["params"]["token_id"]
        calls.append(asset)
        if asset == "a-0":
            return {"data": [], "pagination": {"has_more": True, "next_cursor": "next"}}
        if asset == "b-0":
            raise ProviderError(500)
        return RECORDS[1]["response"]

    monkeypatch.setattr(client, "request", request)
    assert (
        history.runtime_history(
            client,
            max_items=4,
            first_day=date(2026, 10, 1),
            lookback_days=7,
            settle_minutes=10,
            max_pending_writes=2,
        )
        == Result.PENDING
    )
    assert len(calls) == 4
    assert database.execute("SELECT count(*) FROM m_historical.m01_price_day").fetchone()[0] == 4
    assert client.errors == 2 and client.no_data == 2
    assert database.execute(
        "SELECT market_id,status,error_http_status,error_count FROM m_historical.m01_price_day WHERE status='error' ORDER BY market_id"
    ).fetchall() == [("a", "error", 200, 1), ("b", "error", 500, 1)]
    assert all(
        r[2] > date(2026, 10, 17)
        for r in history.c01_select(database, 100, 7, 10, NOW, date(2026, 10, 1))
    )
    client.close()


@pytest.mark.parametrize("bound", [1, 3, 8])
def test_http_and_writes_overlap_with_bounded_pending_data(monkeypatch, bound):
    client = pool()
    started, release, progressed = threading.Event(), threading.Event(), threading.Event()
    fetched = []
    published = []
    connection = object()

    def request(method, url, **kwargs):
        if kwargs["params"]["token_id"] != "0":
            assert started.wait(2)
        fetched.append(kwargs["params"]["token_id"])
        if started.is_set():
            progressed.set()
        return RECORDS[1]["response"]

    def write(ips, conn, row, *, errors_only=False):
        assert conn is connection
        started.set()
        assert release.wait(5)
        published.append(row)
        return 1, 1, 0

    monkeypatch.setattr(client, "request", request)
    monkeypatch.setattr(history, "s03_publish", write)
    with ThreadPoolExecutor(max_workers=1) as runner:
        result = runner.submit(
            history.c02_collect,
            client,
            connection,
            [(str(i), str(i), DAY) for i in range(100)],
            bound,
        )
        try:
            assert started.wait(2) and progressed.wait(2)
            time.sleep(0.1)
            count = len(fetched)
            assert 1 < count <= bound + client.ip_inflight
            time.sleep(0.1)
            assert len(fetched) == count and not result.done()
        finally:
            release.set()
        assert result.result(timeout=5) == (100, 100, 0)
    assert len(published) == 100
    client.close()


def test_setup_creates_date_array_and_checks_existing_types_in_rollback(database, monkeypatch):
    monkeypatch.setattr(h_db, "h_connect", lambda *args, **kwargs: nullcontext(database))
    database.execute("DROP TABLE m_historical.m01_price_day")
    all_setup()
    all_setup()
    types = database.execute("""
        SELECT column_name,data_type FROM information_schema.columns
        WHERE table_schema='m_historical' AND table_name='m01_price_day'
    """).fetchall()
    assert dict(types)["day"] == "date" and dict(types)["prices"] == "ARRAY"
    with database.transaction(force_rollback=True):
        database.execute("ALTER TABLE m_historical.m01_price_day ALTER COLUMN prices TYPE real[]")
        with pytest.raises(RuntimeError, match="Schema mismatch"):
            all_setup()


def test_errors_only_freezes_scope_processes_once_and_overwrites(database, monkeypatch):
    class Clock(datetime):
        @classmethod
        def now(cls, zone):
            return NOW

    monkeypatch.setattr(history, "datetime", Clock)
    client = pool()
    database.execute(
        "UPDATE m_live.m01_market SET created_at=%s WHERE market_id='new'",
        (NOW - timedelta(days=20),),
    )
    for market, day in [
        ("a", DAY),
        ("b", DAY),
        ("create-edge", DAY),
        ("a", DAY - timedelta(days=1)),
    ]:
        history.s03_publish(
            client, database, (market, market + "-0", day, None, NOW, "error", "old failure", 500)
        )
    calls = []

    def request(method, url, **kwargs):
        asset = kwargs["params"]["token_id"]
        calls.append(asset)
        if asset == "a-0":
            # A newly appearing error must not join the frozen cohort.
            history.s03_publish(
                client, database, ("new", "new-0", DAY, None, NOW, "error", "later failure", 500)
            )
            return RECORDS[0]["response"]
        if asset == "b-0":
            return RECORDS[1]["response"]
        raise ProviderError(502)

    monkeypatch.setattr(client, "request", request)
    assert (
        history.runtime_history(
            client,
            max_items=1,
            first_day=DAY,
            lookback_days=7,
            settle_minutes=10,
            max_pending_writes=1,
            errors_only=True,
        )
        == Result.COMPLETE
    )
    assert calls == ["a-0", "b-0", "create-edge-0"]
    assert database.execute(
        "SELECT market_id,status,error_reason,error_http_status,error_count,prices IS NULL FROM m_historical.m01_price_day WHERE day=%s ORDER BY market_id",
        (DAY,),
    ).fetchall() == [
        ("a", "success", None, None, 1, False),
        ("b", "no_data", None, None, 1, True),
        ("create-edge", "error", "Provider HTTP 502", 502, 2, True),
        ("new", "error", "later failure", 500, 1, True),
    ]
    assert database.execute(
        "SELECT error_count FROM m_historical.m01_price_day WHERE day < %s", (DAY,)
    ).fetchone() == (1,)
    # A maintenance publication may never overwrite an already completed row.
    assert history.s03_publish(
        client, database, ("a", "a-0", DAY, None, NOW, "error", "bad", 500), errors_only=True
    ) == (0, 0, 0)
    client.close()


@pytest.mark.parametrize("status", [401, 403, 429])
@pytest.mark.parametrize("errors_only", [False, True])
def test_auth_and_rate_limits_do_not_write_error(database, monkeypatch, status, errors_only):
    client = pool()
    if errors_only:
        history.s03_publish(client, database, ("a", "a-0", DAY, None, NOW, "error", "old", 500))
    before = database.execute("SELECT * FROM m_historical.m01_price_day").fetchall()

    def request(*args, **kwargs):
        raise ProviderError(status, 60)

    monkeypatch.setattr(client, "request", request)
    with pytest.raises(ProviderError) as raised:
        history.c02_collect(client, database, [("a", "a-0", DAY)], 1, errors_only=errors_only)
    assert raised.value.status == status
    assert database.execute("SELECT * FROM m_historical.m01_price_day").fetchall() == before
    client.close()


@pytest.mark.parametrize("network", [False, True])
def test_exhausted_shared_retries_persist_one_error(database, monkeypatch, network):
    import requests

    client = IPPool(
        "test", [], 1, {"/v2/prices-history": (200, 10)}, HttpPolicy(30, 2, 60, 1000000)
    )
    calls = []

    class Response:
        status_code = 503

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    class Session:
        def request(self, *args, **kwargs):
            calls.append(1)
            if network:
                raise requests.ConnectTimeout("test transport failure")
            return Response()

    monkeypatch.setattr(client, "session", lambda index: Session())
    assert history.c02_collect(client, database, [("a", "a-0", DAY)], 1) == (1, 0, 1)
    assert len(calls) == 3
    assert database.execute(
        "SELECT status,error_reason,error_http_status,error_count FROM m_historical.m01_price_day"
    ).fetchone() == (
        "error",
        "ConnectTimeout" if network else "Provider HTTP 503",
        None if network else 503,
        1,
    )
    assert ("a", "a-0", DAY) not in history.c01_select(database, 100, 7, 10, NOW, DAY)
    client.close()


@pytest.mark.parametrize("arguments", [[], ["--once"], ["--errors-only"]])
def test_entrypoint_rejects_overlap_for_whole_service_lifetime(arguments):
    with h_lock():
        result = subprocess.run(
            [sys.executable, "-m", "m_historical.all_runtime", *arguments],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        assert result.returncode == 1
        assert json.loads(result.stdout)["event"] == "already_running"
    # Session close releases the lock; no runtime or provider request is started.
    with h_lock():
        pass


def test_hold_cursor_has_no_transaction_during_fetch():
    from psycopg.pq import TransactionStatus

    with (
        h_connect(autocommit=True) as connection,
        connection.cursor(name="hold_check", withhold=True, scrollable=False) as cursor,
    ):
        cursor.execute("SELECT i FROM generate_series(1, 3) AS i")
        assert connection.info.transaction_status == TransactionStatus.IDLE
        assert cursor.fetchmany(1) == [(1,)]
        assert connection.info.transaction_status == TransactionStatus.IDLE
        assert cursor.fetchmany(2) == [(2,), (3,)]
