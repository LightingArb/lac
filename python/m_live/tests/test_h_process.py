"""Transport/scheduler boundary tests use synthetic HTTP, never market fixtures."""

import base64
import json
import multiprocessing as mp
import os
import subprocess
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
import requests

import h_shared.h_process as process
from h_shared.h_ip_pool import (
    ContractError,
    HttpPolicy,
    IPPool,
    ProviderError,
    h_outbound_ips,
    h_validate_ips,
)
from h_shared.h_process import Result, Schedule, h_delay, h_process, h_stop, h_wait

SECRET = "s3cr3t-pw"
CHECK = {"check_url": "http://clob.invalid/time", "check_timeout": 2}


def pool(*, ips=(), inflight=2, limits=None, retries=2, size=10000):
    return IPPool(
        "test_runtime",
        list(ips),
        inflight,
        limits or {"/prices": (100, 1), "/books": (100, 1)},
        HttpPolicy(1, retries, 1, size),
    )


class Response:
    def __init__(self, status=200, body=b'{"value": 0.5}', retry_after=None):
        self.status_code, self.body = status, body
        self.headers = {} if retry_after is None else {"Retry-After": retry_after}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def iter_content(self, **_):
        yield self.body


def transport(monkeypatch, client, fn):
    class Session:
        def __init__(self, i):
            self.i = i

        def request(self, method, url, **kwargs):
            return fn(self.i, method, url, kwargs)

    monkeypatch.setattr(client, "session", Session)


def test_ip_inflight_and_default_then_extra(monkeypatch):
    client = pool(ips=["192.0.2.1"], inflight=2)
    active, peak, seen = Counter(), Counter(), set()
    lock = threading.Lock()

    def request(i, *_):
        with lock:
            active[i] += 1
            peak[i] = max(peak[i], active[i])
            seen.add(i)
        time.sleep(0.015)
        with lock:
            active[i] -= 1
        return Response()

    transport(monkeypatch, client, request)
    assert client.addresses == (None, "192.0.2.1")
    with ThreadPoolExecutor(max_workers=12) as executor:
        list(executor.map(lambda _: client.request("GET", "https://test/prices"), range(24)))
    assert peak == {0: 2, 1: 2}
    assert seen == {0, 1}
    assert pool().addresses == (None,)


def test_endpoint_windows_and_keyset_share_listing_quota(monkeypatch):
    client = pool(limits={"/events": (1, 0.15), "/books": (1, 0.15)})
    calls = []
    transport(
        monkeypatch, client, lambda i, m, u, k: calls.append((u, time.monotonic())) or Response()
    )
    client.request("GET", "https://test/events")
    client.request("GET", "https://test/books")
    client.request("GET", "https://test/events/keyset")
    assert calls[1][1] - calls[0][1] < 0.1
    assert calls[2][1] - calls[0][1] >= 0.14
    client.reset_round()
    client.request("GET", "https://test/events")
    assert calls[3][1] - calls[2][1] >= 0.14


def test_single_ip_429_only_cools_that_endpoint(monkeypatch):
    client = pool(ips=["192.0.2.1"])
    calls = []

    def request(i, method, url, kwargs):
        calls.append((i, url))
        return Response(429, retry_after="1") if i == 0 and url.endswith("/prices") else Response()

    transport(monkeypatch, client, request)
    assert client.request("GET", "https://test/prices")["value"] == 0.5
    client.request("GET", "https://test/books")
    assert calls == [
        (0, "https://test/prices"),
        (1, "https://test/prices"),
        (0, "https://test/books"),
    ]


def test_all_ips_429_reports_wait_other_endpoint_still_works(monkeypatch):
    client = pool(ips=["192.0.2.1"])
    transport(
        monkeypatch,
        client,
        lambda i, m, u, k: Response(429, retry_after="1") if u.endswith("/prices") else Response(),
    )
    with pytest.raises(ProviderError) as caught:
        client.request("GET", "https://test/prices")
    assert caught.value.status == 429 and 0 < caught.value.wait <= 1
    client.request("GET", "https://test/books")


@pytest.mark.parametrize("status,expected", [(500, 3), (401, 1), (403, 1), (400, 1)])
def test_bounded_retry_and_auth_status(monkeypatch, status, expected):
    client, calls = pool(), []
    transport(monkeypatch, client, lambda *args: calls.append(args) or Response(status))
    with pytest.raises(ProviderError) as caught:
        client.request("GET", "https://test/prices", target="asset")
    assert caught.value.status == status
    assert len(calls) == expected


def test_network_retries_are_bounded_and_logs_do_not_echo_credentials(monkeypatch, capsys):
    client, calls = pool(), []

    def request(*args):
        calls.append(args)
        raise requests.ConnectionError("credential=do-not-log")

    transport(monkeypatch, client, request)
    with pytest.raises(ProviderError):
        client.request("GET", "https://user:secret@test/prices", target="asset")
    logs = capsys.readouterr().out
    assert len(calls) == 3 and "do-not-log" not in logs and "secret" not in logs
    error = next(json.loads(line) for line in logs.splitlines() if '"request_error"' in line)
    assert {"ts", "unit", "event", "target", "provider", "ip", "status", "reason"} <= error.keys()


@pytest.mark.parametrize("body,size", [(b"not-json", 100), (b"{}" * 20, 10)])
def test_bad_or_oversize_response_fails_closed(monkeypatch, body, size):
    client = pool(size=size)
    transport(monkeypatch, client, lambda *_: Response(body=body))
    with pytest.raises(ContractError):
        client.request("GET", "https://test/prices")


def test_source_address_is_observed_by_http_server():
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append(self.client_address[0])
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    client = pool(ips=["127.0.0.2"])
    try:
        for _ in range(2):
            client.request("GET", f"http://127.0.0.1:{server.server_port}/prices")
        assert seen == ["127.0.0.1", "127.0.0.2"]
    finally:
        client.close()
        server.shutdown()
        server.server_close()
        thread.join()


def test_outbound_environment_validation(monkeypatch, capsys):
    monkeypatch.setenv("OUTBOUND_IPS", "[]")
    assert h_outbound_ips(**CHECK) == []
    monkeypatch.setenv("OUTBOUND_IPS", '["127.0.0.1"]')
    assert h_outbound_ips(**CHECK) == ["127.0.0.1"]
    for value in ('["192.0.2.250"]', "null", "{}", "[1]", "invalid"):
        monkeypatch.setenv("OUTBOUND_IPS", value)
        with pytest.raises(SystemExit) as caught:
            h_outbound_ips(**CHECK)
        assert caught.value.code == 1
    assert "configuration_error" in capsys.readouterr().out


@contextmanager
def http_proxy(status=200):
    """A local HTTP proxy: answers every absolute-form request itself and records it."""
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append((self.path, self.headers.get("Proxy-Authorization")))
            body = b'{"value": 0.5}'
            self.send_response(status)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://lac:{SECRET}@127.0.0.1:{server.server_port}", seen
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_exits_are_local_ips_or_http_proxies_and_errors_hide_credentials():
    proxy = f"http://lac:{SECRET}@203.0.113.7:50100"
    assert h_validate_ips(["127.0.0.1", proxy]) == ["127.0.0.1", proxy]
    assert h_validate_ips(["http://203.0.113.7:3128"]) == ["http://203.0.113.7:3128"]
    other = f"http://other:{SECRET}@203.0.113.7:50100"
    bad = [
        ("Duplicate outbound exit 127.0.0.1", ["127.0.0.1", "127.0.0.1"]),
        ("Duplicate outbound exit 203.0.113.7:50100", [proxy, other]),
        ("Only http:// proxies", [f"https://lac:{SECRET}@203.0.113.7:50100"]),
        ("Only http:// proxies", [f"socks5://lac:{SECRET}@203.0.113.7:50101"]),
        ("Proxy is not", [f"http://lac:{SECRET}@203.0.113.7"]),
        ("Proxy is not", [f"http://lac:{SECRET}@203.0.113.7:50100/path"]),
        ("Proxy is not", [f"http://lac:{SECRET}@203.0.113.7:port"]),
        ("neither an IP nor", [f"lac:{SECRET}@203.0.113.7:50100"]),
        ("not assigned to this host", ["192.0.2.250"]),
    ]
    for message, entries in bad:
        with pytest.raises(ValueError, match=message) as caught:
            h_validate_ips(entries)
        assert SECRET not in str(caught.value)


def test_proxy_exit_requests_really_go_through_the_proxy():
    with http_proxy() as (proxy, seen):
        client = pool(ips=[proxy])
        try:
            # The target name cannot resolve: only a request relayed by the proxy gets an answer.
            for _ in range(2):
                client.next_ip = 1
                assert client.request("GET", "http://market.invalid/prices")["value"] == 0.5
        finally:
            client.close()
    expected = "Basic " + base64.b64encode(f"lac:{SECRET}".encode()).decode()
    assert seen == [("http://market.invalid/prices", expected)] * 2
    assert client.requests_by_exit() == {"default": 0, proxy.rsplit("@", 1)[1]: 2}


def test_each_exit_has_its_own_quota_and_429_cooldown(monkeypatch):
    proxy = f"http://lac:{SECRET}@proxy.test:8080"
    client = pool(ips=["192.0.2.1", proxy], limits={"/prices": (1, 0.3)})
    calls, limited = [], set()

    def request(i, method, url, kwargs):
        calls.append((i, time.monotonic()))
        return Response(429, retry_after="5") if i in limited else Response()

    transport(monkeypatch, client, request)
    for _ in range(3):
        client.request("GET", "https://test/prices")
    # One request per exit fits the window at once; a fourth waits for the oldest window.
    assert [i for i, _ in calls] == [0, 1, 2]
    assert calls[2][1] - calls[0][1] < 0.2
    client.request("GET", "https://test/prices")
    assert calls[3][0] == 0 and calls[3][1] - calls[0][1] >= 0.25
    assert client.requests_by_exit() == {"default": 2, "192.0.2.1": 1, "proxy.test:8080": 1}
    # A 429 through the proxy cools only the proxy; the request moves to another exit.
    limited.add(2)
    time.sleep(0.31)
    client.next_ip = 2
    client.request("GET", "https://test/prices")
    assert [i for i, _ in calls[-2:]] == [2, 0]
    assert client.blocked[2]["/prices"] > time.monotonic() + 4
    assert client.blocked[0]["/prices"] == client.blocked[1]["/prices"] == 0


def test_proxy_check_failure_stops_before_any_runtime(monkeypatch, capsys):
    with http_proxy() as (proxy, seen):
        monkeypatch.setenv("OUTBOUND_IPS", json.dumps(["127.0.0.1", proxy]))
        assert h_outbound_ips(**CHECK) == ["127.0.0.1", proxy]
        assert seen == [("http://clob.invalid/time", seen[0][1])]
    with http_proxy(status=403) as (proxy, _):
        monkeypatch.setenv("OUTBOUND_IPS", json.dumps([proxy]))
        with pytest.raises(SystemExit) as caught:
            h_outbound_ips(**CHECK)
        assert caught.value.code == 1
    logs = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert [log["event"] for log in logs] == ["proxy_checked", "configuration_error"]
    assert logs[1]["status"] == 403 and logs[1]["proxy"] == proxy.rsplit("@", 1)[1]
    # A proxy nobody answers on: the module exits before starting anything.
    result = subprocess.run(
        [sys.executable, "-m", "m_live.all_runtime", "--once"],
        check=False,
        env=os.environ | {"OUTBOUND_IPS": json.dumps([f"http://lac:{SECRET}@127.0.0.1:1"])},
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 1
    error = next(json.loads(line) for line in result.stdout.splitlines())
    assert error["event"] == "configuration_error" and error["proxy"] == "127.0.0.1:1"
    assert error["error"] == "ProxyError" and '"started"' not in result.stdout
    assert SECRET not in result.stdout + result.stderr


def test_logs_name_a_proxy_by_host_and_port_only(monkeypatch, capsys):
    proxy = f"http://lac:{SECRET}@proxy.test:8080"

    class Stop:
        def is_set(self):
            return False

        def set(self):
            pass

        def wait(self, seconds):
            pass

    def runtime(ips):
        ips.request("GET", "https://test/prices")
        return Result.COMPLETE

    def session(self, index):
        class Session:
            def request(self, *_, **__):
                raise requests.ConnectionError(f"via {proxy}")

        return Session()

    monkeypatch.setattr(process.signal, "signal", lambda *_: None)
    monkeypatch.setattr(IPPool, "session", session)
    # Both exits fail (one retry), so the single round ends in error and the runtime exits 1.
    with pytest.raises(SystemExit):
        process.h_run(
            runtime,
            True,
            Schedule(10, None, 8, 5),
            [proxy],
            1,
            {"/prices": (10, 1)},
            HttpPolicy(1, 1, 1, 100),
            {},
            Stop(),
            {"sha": "test", "service": "test"},
        )
    out = capsys.readouterr().out
    logs = [json.loads(line) for line in out.splitlines()]
    assert logs[0]["event"] == "started" and logs[0]["ips"] == ["default", "proxy.test:8080"]
    errors = [log for log in logs if log["event"] == "request_error"]
    assert {log["ip"] for log in errors} == {"default", "proxy.test:8080"}
    finished = next(log for log in logs if log["event"] == "round_finished")
    assert finished["exit_requests"] == {"default": 1, "proxy.test:8080": 1}
    assert SECRET not in out


def test_six_results_and_backoff_reset():
    fixed, rest = Schedule(10, None, 8, 5), Schedule(None, 0.5, 8, 5)
    assert h_delay(Result.COMPLETE, fixed, 3, 9, 7) == (7, 0)
    assert h_delay(Result.COMPLETE, fixed, 12, 9, 7) == (0, 0)
    assert h_delay(Result.COMPLETE, rest, 3, 9, 7) == (0.5, 0)
    assert h_delay(Result.NOT_UPDATED, fixed, 3, 0, 7) == (7, 0)
    assert h_delay(Result.PENDING, fixed, 3, 4, 7) == (0, 0)
    assert h_delay(Result.RATE_LIMIT, fixed, 3, 4, 7) == (7, 4)
    assert h_delay(Result.AUTH, fixed, 3, 4, 7) == (5, 4)
    assert [h_delay(Result.ERROR, fixed, 3, n, 7)[0] for n in range(6)] == [10, 20, 40, 80, 80, 80]


def test_no_network_runtime_rejects_http():
    client = IPPool("runtime_demand", [], 1, {}, HttpPolicy(30, 2, 60, 10000))
    client.report(success=2)
    assert client.success == 2
    with pytest.raises(ValueError, match="Undeclared endpoint"):
        client.request("GET", "https://gamma-api.polymarket.com/events")
    assert client.requests == 0
    client.close()


def test_auth_pauses_only_runtime_and_keeps_logging(monkeypatch, capsys):
    waits, calls = [], []

    class Stop:
        def is_set(self):
            return len(waits) == 2

        def set(self):
            pass

        def wait(self, seconds):
            waits.append(seconds)

    def runtime(ips):
        calls.append(1)
        return Result.AUTH

    monkeypatch.setattr(process.signal, "signal", lambda *_: None)
    process.h_run(
        runtime,
        False,
        Schedule(10, None, 8, 5),
        [],
        1,
        {"/prices": (10, 1)},
        HttpPolicy(1, 2, 1, 100),
        {},
        Stop(),
        {"sha": "test", "service": "test"},
    )
    logs = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert len(calls) == 1 and waits == [5, 5]
    assert sum(log["event"] == "auth_paused" for log in logs) == 2


def config():
    return {
        "period_s": 0.02,
        "ip_inflight": 1,
        "ip_limit": {"/prices": (10, 1)},
        "timeout": 1,
        "retries": 2,
        "rate_wait": 1,
        "max_response_bytes": 100,
        "backoff_max": 8,
        "auth_log_s": 0.02,
    }


def test_invalid_ip_aborts_module_before_any_runtime_starts():
    result = subprocess.run(
        [sys.executable, "-m", "m_live.all_runtime", "--once"],
        check=False,
        env=os.environ | {"OUTBOUND_IPS": '["192.0.2.250"]'},
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 1
    assert '"configuration_error"' in result.stdout
    assert '"started"' not in result.stdout


def test_rest_milliseconds_and_explicit_default():
    settings = config()
    del settings["period_s"]
    started, finished = mp.Event(), mp.Event()
    child = h_process(
        runtime_slow,
        **settings,
        rest_ms=10,
        ips="default",
        once=True,
        started=started,
        finished=finished,
    )
    h_wait([child])
    assert finished.is_set() and child.process.exitcode == 0


def runtime_slow(ips, *, started, finished):
    started.set()
    time.sleep(0.1)
    finished.set()
    return Result.COMPLETE


def runtime_crash(ips, *, started):
    started.wait(2)
    raise RuntimeError("test programmer error")


def test_stop_waits_for_active_round_and_default_ips():
    started, finished = mp.Event(), mp.Event()
    child = h_process(runtime_slow, **config(), started=started, finished=finished)
    assert started.wait(2)
    h_stop()
    h_wait([child])
    assert finished.is_set() and child.process.exitcode == 0


def test_crash_stops_service_after_sibling_finishes():
    started, finished = mp.Event(), mp.Event()
    slow = h_process(runtime_slow, **config(), started=started, finished=finished)
    crash = h_process(runtime_crash, **config(), started=started)
    with pytest.raises(SystemExit) as caught:
        h_wait([slow, crash])
    assert caught.value.code == 1 and finished.is_set()
    assert not slow.process.is_alive()


def test_ip_map_slow_request_does_not_hold_completed_requests():
    client = pool(inflight=2)
    first_started, release_first, third_started = (
        threading.Event(),
        threading.Event(),
        threading.Event(),
    )

    def fetch(item):
        if item == 0:
            first_started.set()
            assert release_first.wait(5)
        else:
            assert first_started.wait(2)
            if item == 2:
                third_started.set()
        return item

    with ThreadPoolExecutor(max_workers=1) as consumer:
        result = consumer.submit(lambda: list(client.map(fetch, range(10))))
        try:
            assert third_started.wait(2), (
                "A completed slot must refill before the slow first request"
            )
        finally:
            release_first.set()
        assert sorted(result.result(timeout=5)) == list(range(10))
    client.close()


def test_dispatch_refills_a_free_slot_at_once_and_takes_nothing_while_full(monkeypatch):
    client = pool(ips=["192.0.2.1"], inflight=2)
    release_first, active, peak = threading.Event(), Counter(), Counter()
    lock = threading.Lock()
    queue = list(range(12))
    taken = []

    def request(i, method, url, kwargs):
        with lock:
            active[i] += 1
            peak[i] = max(peak[i], active[i])
        if kwargs["json"] == 0:
            assert release_first.wait(5)
        else:
            time.sleep(0.01)
        with lock:
            active[i] -= 1
        return Response()

    def take():
        with lock:
            assert sum(active.values()) <= 4
        if not queue:
            return None
        taken.append(queue.pop(0))
        return taken[-1]

    def fetch(item):
        return client.request("POST", "https://test/prices", body=item)

    transport(monkeypatch, client, request)
    done = threading.Event()
    with ThreadPoolExecutor(max_workers=1) as consumer:
        result = consumer.submit(lambda: list(client.dispatch(take, fetch, done.is_set)))
        try:
            # The slow first batch holds one slot; the other three keep going through the rest.
            deadline = time.monotonic() + 2
            while queue and time.monotonic() < deadline:
                time.sleep(0.01)
            assert not queue and not result.done()
            release_first.set()
            time.sleep(0.3)
            assert not result.done(), "Without until(), dispatch keeps waiting for work"
        finally:
            release_first.set()
            done.set()
        assert len(result.result(timeout=5)) == 12
    assert max(peak.values()) <= 2 and sum(client.exit_requests) == 12
    client.close()


def test_dispatch_stops_on_until_and_yields_exit_labels(monkeypatch):
    client = pool(ips=["192.0.2.1"], inflight=1)
    count = iter(range(1000))
    stop = threading.Event()

    def fetch(item):
        if item == 5:
            stop.set()
        return client.request("POST", "https://test/prices", body=item)

    transport(monkeypatch, client, lambda *_: Response())
    results = list(client.dispatch(lambda: next(count), fetch, stop.is_set))
    assert 6 <= len(results) <= 8
    assert {label for _, _, label in results} == {"default", "192.0.2.1"}
    assert all(result == {"value": 0.5} for _, result, _ in results)
    client.close()


def test_dispatch_failure_drains_in_flight_then_raises(monkeypatch):
    client = pool(inflight=3)
    started, finished = threading.Event(), []
    items = iter(range(1000))

    def fetch(item):
        if item == 1:
            assert started.wait(2)
            raise ContractError("test contract failure")
        started.set()
        time.sleep(0.05)
        finished.append(item)
        return item

    yielded = []
    with pytest.raises(ContractError):
        for batch, result, _ in client.dispatch(lambda: next(items), fetch, lambda: False):
            yielded.append(result)
    # Batches already sent finish and are handed over; nothing new starts after the failure.
    assert sorted(yielded) == sorted(finished) and 0 in yielded and len(finished) <= 4


def test_dispatch_keeps_quota_and_429_per_exit(monkeypatch):
    client = pool(ips=["192.0.2.1"], inflight=1, limits={"/prices": (2, 0.5)})
    calls = []
    items = iter(range(1000))

    def request(i, method, url, kwargs):
        calls.append((i, time.monotonic()))
        return Response(429, retry_after="5") if i == 1 else Response()

    def fetch(item):
        return client.request("POST", "https://test/prices", body=item)

    transport(monkeypatch, client, request)
    started = time.monotonic()
    results = list(client.dispatch(lambda: next(items), fetch, lambda: len(calls) >= 6))
    # 192.0.2.1 answers 429 once and cools down; its batch moves to the default exit, which
    # keeps its own window of 2 per 0.5 s.
    assert [i for i, _ in calls].count(1) == 1
    assert client.exit_429 == Counter({"192.0.2.1": 1}) and not client.exit_errors
    default = [t for i, t in calls if i == 0]
    for first, third in zip(default, default[2:]):
        assert third - first >= 0.45
    assert time.monotonic() - started >= 0.9 and all(label == "default" for *_, label in results)
    client.close()


def test_resident_runtime_gets_stop_and_once(monkeypatch):
    seen = []

    class Stop:
        def is_set(self):
            return bool(seen)

        def set(self):
            pass

        def wait(self, seconds):
            pass

    def runtime(ips, *, stop, once, size):
        seen.append((stop.is_set(), once, size))
        return Result.COMPLETE

    monkeypatch.setattr(process.signal, "signal", lambda *_: None)
    stop = Stop()
    process.h_run(
        runtime,
        True,
        Schedule(None, 0.5, 8, 5, resident=True),
        [],
        1,
        {"/prices": (10, 1)},
        HttpPolicy(1, 2, 1, 100),
        {"size": 3},
        stop,
        {"sha": "test", "service": "test"},
    )
    assert seen == [(False, True, 3)]
