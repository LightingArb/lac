"""Transport/scheduler boundary tests use synthetic HTTP, never market fixtures."""

import json
import multiprocessing as mp
import os
import subprocess
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
import requests

import h_shared.h_process as process
from h_shared.h_ip_pool import ContractError, HttpPolicy, IPPool, ProviderError, h_outbound_ips
from h_shared.h_process import Result, Schedule, h_delay, h_process, h_stop, h_wait


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
    assert h_outbound_ips() == []
    monkeypatch.setenv("OUTBOUND_IPS", '["127.0.0.1"]')
    assert h_outbound_ips() == ["127.0.0.1"]
    for value in ('["192.0.2.250"]', "null", "{}", "[1]", "invalid"):
        monkeypatch.setenv("OUTBOUND_IPS", value)
        with pytest.raises(SystemExit) as caught:
            h_outbound_ips()
        assert caught.value.code == 1
    assert "configuration_error" in capsys.readouterr().out


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
