"""One process per runtime, two scheduling modes, graceful service lifecycle."""

import multiprocessing as mp
import signal
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path

from h_shared.h_ip_pool import (
    ContractError,
    HttpPolicy,
    IPPool,
    ProviderError,
    h_exit_label,
    h_validate_ips,
)
from h_shared.h_log import h_log


class Result(StrEnum):
    COMPLETE = "complete"
    PENDING = "pending"
    NOT_UPDATED = "not_updated"
    RATE_LIMIT = "rate_limit"
    AUTH = "auth_error"
    ERROR = "error"


@dataclass(frozen=True)
class Schedule:
    period_s: float | None
    rest_s: float | None
    backoff_max: int
    auth_log_s: float
    # Resident: one call keeps working until the stop signal (or a failure); it gets stop and once.
    resident: bool = False


@dataclass
class Child:
    process: mp.Process
    stop: object
    once: bool


_children: list[Child] = []
_identity = {}
_handlers = {}
_stopping = False


def h_process(
    runtime: Callable[..., Result],
    *,
    ip_inflight: int,
    ip_limit: dict[str, tuple[int, float]] | None = None,
    timeout: float,
    retries: int,
    rate_wait: float,
    max_response_bytes: int,
    backoff_max: int,
    auth_log_s: float,
    ips: list[str] | str = "default",
    once: bool = False,
    period_s: float | None = None,
    rest_s: float | None = None,
    rest_ms: float | None = None,
    resident: bool = False,
    **parameters,
) -> Child:
    """Start one child; each invocation passes IPPool and declared parameters to runtime.

    period_s measures from round start; rest_s/rest_ms measure from round end.
    A resident runtime also gets stop (set on the stop signal) and once; one invocation returns when
    stop is set, or raises on a failure, which then waits like a failed round.
    Validation failures stop the complete service before further children can start.
    """
    ip_limit = {} if ip_limit is None else ip_limit
    try:
        if sum(v is not None for v in (period_s, rest_s, rest_ms)) != 1:
            raise ValueError("Declare exactly one of period_s, rest_s, rest_ms")
        rest = rest_ms / 1000 if rest_ms is not None else rest_s
        if (period_s if period_s is not None else rest) <= 0 or backoff_max < 1 or auth_log_s <= 0:
            raise ValueError("Invalid schedule")
        addresses = [] if ips == "default" else h_validate_ips(ips)
        policy = HttpPolicy(timeout, retries, rate_wait, max_response_bytes)
        IPPool(runtime.__name__, addresses, ip_inflight, ip_limit, policy).close()
    except (ValueError, TypeError, OSError, subprocess.SubprocessError) as error:
        h_log("all_runtime", "configuration_error", reason=str(error))
        h_stop()
        if _children:
            h_wait(_children)
        raise SystemExit(1) from None
    if not _children:
        root = Path(__file__).resolve().parents[2]
        _identity.update(
            service=runtime.__module__.split(".")[0],
            sha=subprocess.check_output(
                ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
            ).strip(),
            dirty=bool(
                subprocess.check_output(
                    ["git", "-C", str(root), "status", "--porcelain"], text=True
                )
            ),
        )
        for sig in (signal.SIGINT, signal.SIGTERM):
            _handlers[sig] = signal.signal(sig, h_stop)
        h_log("all_runtime", "started", **_identity)
    stop = mp.Event()
    process = mp.Process(
        target=h_run,
        name=runtime.__name__,
        args=(
            runtime,
            once,
            Schedule(period_s, rest, backoff_max, auth_log_s, resident),
            addresses,
            ip_inflight,
            ip_limit,
            policy,
            parameters,
            stop,
            dict(_identity),
        ),
    )
    child = Child(process, stop, once)
    _children.append(child)
    if _stopping:
        stop.set()
    process.start()
    return child


def h_stop(*_) -> None:
    global _stopping
    _stopping = bool(_children)
    for child in _children:
        child.stop.set()


def h_delay(
    result: Result, schedule: Schedule, elapsed: float, failures: int, rate_wait: float
) -> tuple[float, int]:
    """Return scheduling wait and consecutive general failures; no I/O."""
    if result == Result.AUTH:
        return schedule.auth_log_s, failures
    if result == Result.PENDING:
        return 0, 0
    if result == Result.RATE_LIMIT:
        return rate_wait, failures
    if result == Result.ERROR:
        failures += 1
        base = schedule.period_s if schedule.period_s is not None else schedule.rest_s
        multiplier = min(
            2 ** min(failures - 1, schedule.backoff_max.bit_length()), schedule.backoff_max
        )
        return base * multiplier, failures
    # No publication-window runtime is configured here. NOT_UPDATED follows its
    # declared period/rest, without inventing a publication-window retry loop.
    wait = max(0, schedule.period_s - elapsed) if schedule.period_s is not None else schedule.rest_s
    return wait, 0


def h_run(
    runtime,
    once: bool,
    schedule: Schedule,
    addresses: list[str],
    ip_inflight: int,
    ip_limit: dict[str, tuple[int, float]],
    policy: HttpPolicy,
    parameters: dict,
    stopped,
    identity: dict,
) -> None:
    signal.signal(signal.SIGINT, lambda *_: stopped.set())
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    ips = IPPool(runtime.__name__, addresses, ip_inflight, ip_limit, policy)
    failures, exit_code = 0, 0
    h_log(
        runtime.__name__,
        "started",
        **identity,
        once=once,
        period_s=schedule.period_s,
        rest_s=schedule.rest_s,
        ips=[h_exit_label(address) for address in ips.addresses],
        ip_inflight=ip_inflight,
    )
    try:
        while not stopped.is_set():
            started_at = datetime.now(UTC).isoformat()
            start = time.monotonic()
            ips.reset_round()
            rate_wait = policy.rate_wait
            pause_context = {"target": "runtime", "provider": None, "ip": None, "status": None}
            try:
                if schedule.resident:
                    result = runtime(ips, stop=stopped, once=once, **parameters)
                else:
                    result = runtime(ips, **parameters)
                if not isinstance(result, Result):
                    raise TypeError("Runtime must return one of the six Result values")
            except ProviderError as error:
                result = (
                    Result.AUTH
                    if error.status in (401, 403)
                    else (Result.RATE_LIMIT if error.status == 429 else Result.ERROR)
                )
                if result == Result.RATE_LIMIT:
                    rate_wait = error.wait
                ips.log_error(error)
                pause_context = getattr(error, "context", pause_context)
            except ContractError as error:
                result = Result.ERROR
                ips.log_error(error)
            except Exception as error:
                h_log(runtime.__name__, "system_error", reason=type(error).__name__)
                exit_code = 1
                raise
            finally:
                ips.close()
            elapsed = time.monotonic() - start
            h_log(
                runtime.__name__,
                "round_finished",
                result=result,
                started_at=started_at,
                ended_at=datetime.now(UTC).isoformat(),
                seconds=elapsed,
                requests=ips.requests,
                exit_requests=ips.requests_by_exit(),
                success=ips.success,
                no_data=ips.no_data,
                error=max(
                    ips.errors, int(result in (Result.ERROR, Result.AUTH, Result.RATE_LIMIT))
                ),
            )
            if stopped.is_set():
                break
            if once and result != Result.PENDING:
                exit_code = int(result not in (Result.COMPLETE, Result.NOT_UPDATED))
                break
            if result == Result.AUTH:
                while not stopped.is_set():
                    h_log(
                        runtime.__name__,
                        "auth_paused",
                        **pause_context,
                        reason="Permission error; paused until restart",
                        wait=schedule.auth_log_s,
                        until=time.time() + schedule.auth_log_s,
                    )
                    stopped.wait(schedule.auth_log_s)
                break
            wait, failures = h_delay(result, schedule, elapsed, failures, rate_wait)
            h_log(runtime.__name__, "waiting", result=result, wait=wait, until=time.time() + wait)
            stopped.wait(wait)
    finally:
        ips.close()
        h_log(runtime.__name__, "stopped", **identity, exit_code=exit_code)
    if exit_code:
        raise SystemExit(exit_code)


def h_wait(children: list[Child] | None = None) -> None:
    """Wait for all active rounds; a crashed child stops the complete service."""
    global _stopping
    children = list(_children if children is None else children)
    failed = False
    try:
        while any(child.process.is_alive() for child in children):
            for child in children:
                child.process.join(0.2)
                code = child.process.exitcode
                unexpected = code is not None and not child.once and not child.stop.is_set()
                if code not in (None, 0) or unexpected:
                    if not failed:
                        h_log("all_runtime", "child_exit", child=child.process.name, exit_code=code)
                    failed = True
                    h_stop()
        failed |= any(
            child.process.exitcode != 0 or (not child.once and not child.stop.is_set())
            for child in children
        )
    finally:
        h_log("all_runtime", "stopped", **_identity, exit_code=int(failed))
        _children.clear()
        _stopping = False
        _identity.clear()
        for sig, handler in _handlers.items():
            signal.signal(sig, handler)
        _handlers.clear()
    if failed:
        raise SystemExit(1)
