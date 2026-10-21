"""Scheduling, bounded HTTP retries, rate control and process lifecycle."""

import email.utils
import json
import multiprocessing as mp
import signal
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum
from itertools import islice

import requests


class Result(StrEnum):
    COMPLETE = "complete"
    PENDING = "pending"
    NOT_UPDATED = "not_updated"
    RATE_LIMIT = "rate_limit"
    AUTH = "auth_error"
    ERROR = "error"


class ProviderError(Exception):
    def __init__(self, status: int, wait: float = 0):
        super().__init__(f"Provider HTTP {status}")
        self.status, self.wait = status, wait


class ContractError(Exception):
    pass


@dataclass(frozen=True)
class HttpPolicy:
    timeout: float
    retries: int
    requests_per_second: float
    rate_wait: float
    workers: int


def h_log(unit: str, event: str, **values) -> None:
    print(
        json.dumps(
            {"ts": datetime.now(UTC).isoformat(), "unit": unit, "event": event, **values},
            ensure_ascii=False,
            default=str,
        ),
        flush=True,
    )


class Http:
    """Per-runtime client. Technical waits/retries stay outside business runtime files."""

    def __init__(self, policy: HttpPolicy):
        self.policy = policy
        self.local = threading.local()
        self.lock = threading.Lock()
        self.next_request = 0.0
        self.requests = 0

    def request(self, method: str, url: str, *, params=None, body=None):
        if not hasattr(self.local, "session"):
            self.local.session = requests.Session()
            self.local.session.headers["User-Agent"] = "LAC-local-demo/1.0"
        for attempt in range(self.policy.retries + 1):
            with self.lock:
                slot = max(time.monotonic(), self.next_request)
                self.next_request = slot + 1 / self.policy.requests_per_second
                self.requests += 1
            time.sleep(max(0, slot - time.monotonic()))
            try:
                response = self.local.session.request(
                    method, url, params=params, json=body, timeout=self.policy.timeout
                )
            except requests.RequestException:
                if attempt == self.policy.retries:
                    raise ProviderError(0) from None
                continue
            if response.status_code in (401, 403):
                raise ProviderError(response.status_code)
            if response.status_code == 429:
                value = response.headers.get("Retry-After")
                wait = self.policy.rate_wait
                if value:
                    try:
                        wait = float(value)
                    except ValueError:
                        wait = max(
                            0, email.utils.parsedate_to_datetime(value).timestamp() - time.time()
                        )
                raise ProviderError(429, wait)
            if response.status_code >= 500 and attempt < self.policy.retries:
                continue
            if response.status_code != 200:
                raise ProviderError(response.status_code)
            try:
                return response.json(parse_float=Decimal)
            except ValueError:
                raise ContractError("Provider response is not JSON") from None
        raise ProviderError(0)

    def map(self, function, items):
        # Keep only a worker-sized queue. Consume/write results while the next HTTP
        # calls are in flight, without eagerly retaining a whole history chunk.
        iterator = iter(items)
        with ThreadPoolExecutor(max_workers=self.policy.workers) as executor:
            pending = deque(
                executor.submit(function, item) for item in islice(iterator, self.policy.workers)
            )
            while pending:
                result = pending.popleft().result()
                for item in islice(iterator, 1):
                    pending.append(executor.submit(function, item))
                yield result


def h_process(
    runtime,
    *,
    once: bool,
    interval: float,
    timeout: float,
    retries: int,
    rate: float,
    rate_wait: float,
    workers: int,
    **parameters,
) -> mp.Process:
    process = mp.Process(
        target=h_run,
        args=(
            runtime,
            once,
            interval,
            HttpPolicy(timeout, retries, rate, rate_wait, workers),
            parameters,
        ),
    )
    process.start()
    return process


def h_run(runtime, once: bool, interval: float, policy: HttpPolicy, parameters: dict) -> None:
    stopped = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stopped.set())
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    failures = 0
    h_log(runtime.__name__, "started", once=once, interval=interval, workers=policy.workers)
    while not stopped.is_set():
        start = time.monotonic()
        wait = interval
        try:
            result = runtime(Http(policy), **parameters)
        except ProviderError as error:
            result = (
                Result.AUTH
                if error.status in (401, 403)
                else (Result.RATE_LIMIT if error.status == 429 else Result.ERROR)
            )
            wait = error.wait or policy.rate_wait
            h_log(runtime.__name__, "provider_error", status=error.status, wait=wait)
        except ContractError as error:
            result = Result.ERROR
            h_log(runtime.__name__, "contract_error", reason=str(error))
        if result == Result.PENDING:
            continue
        h_log(runtime.__name__, "round_finished", result=result, seconds=time.monotonic() - start)
        if once:
            if result not in (Result.COMPLETE, Result.NOT_UPDATED):
                raise SystemExit(1)
            break
        if result == Result.AUTH:
            stopped.wait()
            break
        if result == Result.RATE_LIMIT:
            stopped.wait(wait)
        elif result == Result.ERROR:
            failures += 1
            stopped.wait(interval * min(2 ** (failures - 1), 8))
        else:
            failures = 0
            stopped.wait(max(0, interval - (time.monotonic() - start)))
    h_log(runtime.__name__, "stopped")


def h_wait(processes: list[mp.Process]) -> None:
    stopping = False
    while any(p.is_alive() for p in processes):
        try:
            for process in processes:
                process.join(0.2)
                if process.exitcode not in (None, 0) and not stopping:
                    for other in processes:
                        if other.is_alive():
                            other.terminate()
                    stopping = True
        except KeyboardInterrupt:
            if not stopping:
                for process in processes:
                    if process.is_alive():
                        process.terminate()
                stopping = True
    if any(p.exitcode != 0 for p in processes):
        raise SystemExit(1)
