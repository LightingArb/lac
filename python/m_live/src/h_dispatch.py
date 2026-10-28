"""Resident dispatch shared by runtime_clob and runtime_book: every demanded market in a schedule
in memory (earliest next refresh first), every exit's slots kept busy, failed batches back in the
schedule (or an interval later when a retry would fail the same way), writes on a small pool of
connections, and every period: maintenance and one dispatch_summary."""

import bisect
import heapq
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import Future, ThreadPoolExecutor, wait
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass, field
from functools import partial
from queue import Queue

import psycopg

from h_shared.h_db import h_connect
from h_shared.h_ip_pool import ContractError, IPPool, ProviderError, h_exit_label
from h_shared.h_log import h_log
from h_shared.h_process import Result


@dataclass
class Market:
    asset: str
    seconds: int  # refresh interval from the demand table
    fetched: float | None  # epoch of the last request that came back (at start: the stored one)
    due: float  # fetched + seconds; -inf while never fetched


@dataclass
class Picker:
    """The schedule in memory: every demanded market and a heap of (due, market_id), earliest first.

    A taken market leaves the heap and stays in inflight until its batch is written or its failed
    batch is handled; then it goes back into the heap with its due time. Heap entries of markets
    whose due time changed or that left the demand table are skipped when they come up.
    due_wait None: take the earliest markets, due or not (prices); seconds: due markets only, and
    when none is due look again after that long (books).
    once: due markets only, each at most once per call.
    """

    unit: str
    size: int
    once: bool
    due_wait: float | None = None
    markets: dict = field(default_factory=dict)
    heap: list = field(default_factory=list)
    inflight: set = field(default_factory=set)
    sent: set = field(default_factory=set)
    look_again: float = 0.0  # due_wait: epoch before which nothing is taken
    finished: bool = False
    summaries: Future | None = None  # the maintenance and summary thread
    exit_markets: Counter = field(default_factory=Counter)  # markets fetched per exit label
    exit_requeued: Counter = field(default_factory=Counter)  # batches put back per exit label
    exit_invalid: Counter = field(default_factory=Counter)  # batches an interval later per exit
    counts: Counter = field(default_factory=Counter)  # fetched, written, write_queue_full_ms
    write_queue_max: int = 0  # most batches waiting to be written since the last summary
    full_since: float | None = None  # when intake stopped for a full write queue
    lock: threading.Lock = field(default_factory=threading.Lock)


def h_dispatch(
    ips: IPPool,
    picker: Picker,
    *,
    stop,
    maintain,
    fetch,
    write,
    writers: int,
    max_pending_writes: int,
    summary_seconds: float,
) -> Result:
    """Resident: until stop is set, keep every exit's slots busy with batches from the schedule and
    write what comes back on `writers` connections. once: never-fetched and due markets only, then
    return.

    maintain(picker) deletes rows no longer demanded and merges the demand table into the schedule
    (h_merge), at the start and every summary_seconds, before each dispatch_summary. fetch(batch) is
    one request and gives rows (market_id first, request time last); write(connection, rows) writes
    them and gives how many rows it wrote. A failed batch a retry would fail the same way (invalid
    response, a 4xx other than 401/403/429) counts as fetched and comes up an interval later,
    unwritten; any other failed batch goes back unchanged. Only 401/403, every exit held by 429
    and database errors end the call.
    """
    if writers < 1 or max_pending_writes < 1:
        raise ValueError("Declare positive writers and pending writes")
    try:
        maintained = maintain(picker)
        with c01_summaries(ips, picker, maintain, summary_seconds, maintained):
            c02_dispatch(ips, picker, stop, fetch, write, writers, max_pending_writes)
    except psycopg.Error as error:
        # Ends this call like a failed round; the shared schedule waits and starts it again.
        h_log(picker.unit, "database_error", reason=type(error).__name__)
        return Result.ERROR
    return Result.COMPLETE


def h_merge(picker: Picker, demand: list[tuple]) -> dict[str, int]:
    """demand: (market_id, asset, interval, stored requested_at in epoch seconds or None). Add new
    markets (due: stored requested_at + interval, -inf without a stored row), drop the ones no
    longer demanded, move a market whose interval changed to its last fetch + new interval."""
    added = changed = 0
    with picker.lock:
        markets, seen = picker.markets, set()
        for market_id, asset, seconds, requested in demand:
            seen.add(market_id)
            market = markets.get(market_id)
            if market is None:
                due = float("-inf") if requested is None else requested + seconds
                market = markets[market_id] = Market(asset, seconds, requested, due)
                added += 1
            else:
                market.asset = asset
                if market.seconds == seconds:
                    continue
                market.seconds = seconds
                changed += 1
                if market.fetched is None:
                    continue
                market.due = market.fetched + seconds
            if market_id not in picker.inflight:
                heapq.heappush(picker.heap, (market.due, market_id))
        removed = markets.keys() - seen
        for market_id in removed:
            del markets[market_id]
        if len(picker.heap) > 2 * len(markets) + 1000:
            # Skipped entries pile up as due times change; rebuild from the markets now and then.
            picker.heap = [(m.due, i) for i, m in markets.items() if i not in picker.inflight]
            heapq.heapify(picker.heap)
    return {"added": added, "removed": len(removed), "interval_changed": changed}


@contextmanager
def c01_summaries(ips: IPPool, picker: Picker, maintain, seconds: float, maintained: dict):
    """Every `seconds` on its own thread: maintain, then log dispatch_summary; once more at a
    normal end. A maintenance failure ends that thread; the dispatcher then stops on it."""
    done = threading.Event()
    state = {"before": s01_counters(ips, picker), "started": time.monotonic()}

    def loop():
        while not done.wait(seconds):
            state.update(s02_summary(ips, picker, state, maintain(picker)))

    with ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"{picker.unit}_summary") as thread:
        picker.summaries = thread.submit(loop)
        try:
            yield
        finally:
            done.set()
    picker.summaries.result()
    s02_summary(ips, picker, state, maintained)


def s01_counters(ips: IPPool, picker: Picker) -> dict[str, Counter]:
    with ips.condition:
        requests = Counter(ips.requests_by_exit())
        rate_limited, errors = Counter(ips.exit_429), Counter(ips.exit_errors)
    with picker.lock:
        markets, requeued = Counter(picker.exit_markets), Counter(picker.exit_requeued)
        invalid, counts = Counter(picker.exit_invalid), Counter(picker.counts)
    return {
        "requests": requests,
        "markets": markets,
        "errors": errors,
        "requeued": requeued,
        "invalid": invalid,
        "http_429": rate_limited,
        "counts": counts,
    }


def s02_summary(ips: IPPool, picker: Picker, state: dict, maintained: dict) -> dict:
    with picker.lock:
        if picker.full_since is not None:
            # Intake is stopped right now: count it up to here.
            moment = time.monotonic()
            picker.counts["write_queue_full_ms"] += round((moment - picker.full_since) * 1000)
            picker.full_since = moment
    now, before = s01_counters(ips, picker), state["before"]
    delta = {key: now[key] - before[key] for key in now}
    http = {label: sorted(values) for label, values in ips.seconds_by_exit().items()}
    labels = [h_exit_label(address) for address in ips.addresses]
    with picker.lock:
        write_queue_max, picker.write_queue_max = picker.write_queue_max, 0
        inflight = len(picker.inflight)
    groups, unseen = s03_ages(picker, time.time())
    exit_keys = ("requests", "markets", "errors", "requeued", "invalid", "http_429")
    h_log(
        picker.unit,
        "dispatch_summary",
        seconds=round(time.monotonic() - state["started"], 1),
        exits={
            label: {key: delta[key][label] for key in exit_keys}
            | {
                "http_p50": s04_percentile(http[label], 0.5),
                "http_p95": s04_percentile(http[label], 0.95),
            }
            for label in labels
        },
        all_exits_429=delta["http_429"]["all"],
        fetched=delta["counts"]["fetched"],
        written=delta["counts"]["written"],
        write_queue_max=write_queue_max,
        write_queue_full_seconds=round(delta["counts"]["write_queue_full_ms"] / 1000, 1),
        groups=groups,
        unseen=unseen,
        inflight=inflight,
        **maintained,
    )
    return {"before": now, "started": time.monotonic()}


def s03_ages(picker: Picker, now: float) -> tuple[dict[str, dict], int]:
    """Per interval, from the schedule: markets, those fetched at least once, age p50/p95 in
    seconds since the last fetch, and how many fetched ones are older than their interval."""
    with picker.lock:
        snapshot = [(m.seconds, m.fetched) for m in picker.markets.values()]
    ages, never = defaultdict(list), Counter()
    for seconds, fetched in snapshot:
        if fetched is None:
            never[seconds] += 1
        else:
            ages[seconds].append(now - fetched)
    groups = {}
    for seconds in sorted(ages.keys() | never.keys()):
        values = sorted(ages[seconds])
        overdue = len(values) - bisect.bisect_right(values, seconds)
        groups[str(seconds)] = {
            "markets": len(values) + never[seconds],
            "fetched": len(values),
            "age_p50": s04_percentile(values, 0.5),
            "age_p95": s04_percentile(values, 0.95),
            "overdue": overdue,
            "overdue_share": round(overdue / len(values), 4) if values else None,
        }
    return groups, sum(never.values())


def s04_percentile(values: list[float], fraction: float) -> float | None:
    """Linear interpolation between the closest ranks of sorted values (as percentile_cont)."""
    if not values:
        return None
    position = fraction * (len(values) - 1)
    low = int(position)
    high = min(low + 1, len(values) - 1)
    return round(values[low] + (values[high] - values[low]) * (position - low), 2)


def c02_dispatch(
    ips: IPPool, picker: Picker, stop, fetch, write, writers: int, max_pending_writes: int
) -> None:
    """Fetch on every free exit slot; a slot is free again as soon as its HTTP ends. Responses are
    written on `writers` connections, one committed statement per batch; while max_pending_writes
    batches wait to be written, no new request starts."""
    pending = {}
    with ExitStack() as stack:
        connections = Queue()
        for _ in range(writers):
            connections.put(stack.enter_context(h_connect(autocommit=True)))
        executor = stack.enter_context(ThreadPoolExecutor(max_workers=writers))

        def take():
            if picker.summaries is not None and picker.summaries.done():
                picker.summaries.result()  # it only ends early on a maintenance failure, raised here
            s12_collect(pending, picker, block=False)
            full = len(pending) >= max_pending_writes
            with picker.lock:
                if full and picker.full_since is None:
                    picker.full_since = time.monotonic()
                elif not full and picker.full_since is not None:
                    waited = time.monotonic() - picker.full_since
                    picker.counts["write_queue_full_ms"] += round(waited * 1000)
                    picker.full_since = None
            return None if full else s05_take(picker, time.time())

        try:
            for batch, rows, exit_label, error in ips.dispatch(
                take,
                partial(s06_fetch, fetch),
                lambda: stop.is_set() or picker.finished,
                lambda error: s07_kind(error) == "fatal",
            ):
                if error is None:
                    s10_fetched(picker, rows, exit_label)
                    pending[executor.submit(s11_write, picker, connections, write, rows)] = batch
                    with picker.lock:
                        picker.write_queue_max = max(picker.write_queue_max, len(pending))
                elif s07_kind(error) == "invalid":
                    s09_invalid(picker, batch, exit_label, error)
                else:
                    s08_requeue(picker, batch, exit_label, error)
        finally:
            s12_collect(pending, picker, block=True)


def s05_take(picker: Picker, now: float) -> list[tuple[str, str]] | None:
    """Up to `size` markets with the earliest due times (due or not, unless due_wait or once);
    never one already in flight."""
    with picker.lock:
        if now < picker.look_again:
            return None
        batch, heap = [], picker.heap
        while len(batch) < picker.size and heap:
            due, market_id = heap[0]
            market = picker.markets.get(market_id)
            if (
                market is None
                or market.due != due
                or market_id in picker.inflight
                or market_id in picker.sent
            ):
                heapq.heappop(heap)
                continue
            if (picker.once or picker.due_wait is not None) and due > now:
                break
            heapq.heappop(heap)
            batch.append((market_id, market.asset))
            picker.inflight.add(market_id)
            if picker.once:
                picker.sent.add(market_id)
        if not batch:
            # once: done when nothing is due or in flight (a failed batch may still come back);
            # resident: every demanded market is in flight or (due_wait) not due yet, wait.
            picker.finished = picker.once and not picker.inflight
            if picker.due_wait is not None and not picker.once:
                picker.look_again = now + picker.due_wait
            return None
        return batch


def s06_fetch(fetch, batch: list[tuple[str, str]]) -> list[tuple]:
    """The runtime's request for one batch; a failure carries the epoch it started at, the request
    time of a batch that then counts as fetched."""
    started = time.time()
    try:
        return fetch(batch)
    except (ContractError, ProviderError) as error:
        error.requested = started
        raise


def s07_kind(error: Exception) -> str:
    """fatal: 401/403, every exit held by 429 (a 429 only gets here then) and anything that is not
    a provider or contract failure. invalid: a retry would fail the same way (a response that does
    not meet the contract, another 4xx). transient: may pass on another exit or a moment later
    (ProxyError, timeout, connection error, 5xx)."""
    if isinstance(error, ContractError):
        return "invalid"
    if not isinstance(error, ProviderError) or error.status in (401, 403, 429):
        return "fatal"
    return "invalid" if 400 <= error.status < 500 else "transient"


def s08_requeue(picker: Picker, batch: list[tuple[str, str]], exit_label: str, error) -> None:
    """A transient failure: the batch's markets leave inflight with their due times unchanged (so
    they come up again in their turn), its exit gets one requeued batch, and dispatch goes on."""
    with picker.lock:
        picker.exit_requeued[exit_label] += 1
        for market_id, _ in batch:
            picker.inflight.discard(market_id)
            picker.sent.discard(market_id)
            market = picker.markets.get(market_id)
            if market is not None:
                heapq.heappush(picker.heap, (market.due, market_id))
    h_log(
        picker.unit,
        "batch_requeued",
        ip=exit_label,
        status=getattr(error, "context", {}).get("status"),
        reason=str(error),
        markets=len(batch),
    )


def s09_invalid(picker: Picker, batch: list[tuple[str, str]], exit_label: str, error) -> None:
    """A failure a retry would repeat: the batch's markets count as fetched at this request (next
    due: request time + interval), nothing is written, its exit gets one invalid batch."""
    with picker.lock:
        picker.exit_invalid[exit_label] += 1
        for market_id, _ in batch:
            picker.inflight.discard(market_id)
            market = picker.markets.get(market_id)
            if market is not None:
                market.fetched = error.requested
                market.due = market.fetched + market.seconds
                heapq.heappush(picker.heap, (market.due, market_id))
    h_log(
        picker.unit,
        "batch_invalid",
        ip=exit_label,
        status=getattr(error, "context", {}).get("status"),
        reason=str(error),
        markets=len(batch),
        market_ids=[market_id for market_id, _ in batch[:5]],
    )


def s10_fetched(picker: Picker, rows: list[tuple], exit_label: str) -> None:
    """The batch came back: each market's next due time is this request + its interval, written or
    not; the markets stay in flight until their write is done."""
    with picker.lock:
        picker.exit_markets[exit_label] += len(rows)
        picker.counts["fetched"] += len(rows)
        for row in rows:
            market = picker.markets.get(row[0])
            if market is not None:
                market.fetched = row[-1].timestamp()
                market.due = market.fetched + market.seconds


def s11_write(picker: Picker, connections: Queue, write, rows: list[tuple]) -> int:
    connection = connections.get()
    try:
        written = write(connection, rows)
    finally:
        connections.put(connection)
    with picker.lock:
        picker.counts["written"] += written
    return written


def s12_collect(pending: dict, picker: Picker, *, block: bool) -> None:
    """Release the markets of finished writes back into the schedule; block: wait for every
    pending write first."""
    if not pending:
        return
    done, _ = wait(pending, timeout=None if block else 0)
    with picker.lock:
        for future in done:
            for market_id, _ in pending.pop(future):
                picker.inflight.discard(market_id)
                market = picker.markets.get(market_id)
                if market is not None:
                    heapq.heappush(picker.heap, (market.due, market_id))
    for future in done:
        future.result()
