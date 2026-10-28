"""Keep every exit busy with CLOB /prices batches, earliest next refresh first (scheduled in memory);
write a market's price only when it changed or the stored one is an interval old."""

import bisect
import heapq
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import Future, ThreadPoolExecutor, wait
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
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

    A taken market leaves the heap and stays in inflight until its batch is written, or put back
    after a failed fetch; then it goes back into the heap with its due time. Heap entries of
    markets whose due time changed or that left the demand table are skipped when they come up.
    once: due markets only, each at most once per call.
    """

    size: int
    once: bool
    markets: dict = field(default_factory=dict)
    heap: list = field(default_factory=list)
    inflight: set = field(default_factory=set)
    sent: set = field(default_factory=set)
    finished: bool = False
    summaries: Future | None = None  # the maintenance and summary thread
    exit_markets: Counter = field(default_factory=Counter)  # markets fetched per exit label
    exit_requeued: Counter = field(default_factory=Counter)  # batches put back per exit label
    counts: Counter = field(default_factory=Counter)  # fetched, written, write_queue_full_ms
    write_queue_max: int = 0  # most batches waiting to be written since the last summary
    full_since: float | None = None  # when intake stopped for a full write queue
    lock: threading.Lock = field(default_factory=threading.Lock)


def runtime_clob(
    ips: IPPool,
    *,
    stop,
    once: bool,
    request_items: int,
    writers: int,
    max_pending_writes: int,
    summary_seconds: float,
) -> Result:
    """Resident: until stop is set, keep every exit's slots busy with batches of request_items
    markets, earliest due first (due or not; never fetched first), and write the responses on
    writers connections. once: never-fetched and due markets only, then return.

    A failed batch goes back to the schedule unchanged and its exit gets a requeued batch; only
    401/403, every exit held by 429 and database errors end the call. Every summary_seconds:
    delete prices no longer demanded, reload the demand table into the schedule, log
    dispatch_summary.
    """
    if writers < 1 or max_pending_writes < 1:
        raise ValueError("Declare positive writers and pending writes")
    picker = Picker(request_items, once)
    try:
        maintained = c01_maintain(picker)
        with c02_summaries(ips, picker, summary_seconds, maintained):
            c03_dispatch(ips, picker, stop, writers, max_pending_writes)
    except psycopg.Error as error:
        # Ends this call like a failed round; the shared schedule waits and starts it again.
        h_log("runtime_clob", "database_error", reason=type(error).__name__)
        return Result.ERROR
    return Result.COMPLETE


def c01_maintain(picker: Picker) -> dict[str, int]:
    with h_connect(autocommit=True) as connection:
        deleted = s01_delete_retired(connection)
        demand = s02_demand(connection)
    return {"deleted": deleted} | s03_merge(picker, demand)


def s01_delete_retired(connection) -> int:
    # Rows are locked in market_id order, as writers lock them, so the two never deadlock.
    return connection.execute("""
        DELETE FROM m_live.m02_clob_price
        WHERE market_id IN (
            SELECT p.market_id FROM m_live.m02_clob_price AS p
            WHERE NOT EXISTS (
                SELECT 1 FROM m_live.m01_demand_market AS d WHERE d.market_id=p.market_id
            )
            ORDER BY p.market_id FOR UPDATE
        )
    """).rowcount


def s02_demand(connection) -> list[tuple]:
    """Demanded binary markets (both outcomes with an asset): first-outcome asset, interval and the
    stored price's requested_at in epoch seconds (None without a price row)."""
    return connection.execute("""
        SELECT d.market_id, min(o.asset_id) FILTER (WHERE o.outcome_index=0), d.refresh_seconds,
            extract(epoch FROM p.requested_at)::float8
        FROM m_live.m01_demand_market AS d
        JOIN m_live.m01_outcome AS o ON o.market_id=d.market_id
        LEFT JOIN m_live.m02_clob_price AS p ON p.market_id=d.market_id
        GROUP BY d.market_id, d.refresh_seconds, p.requested_at
        HAVING count(*)=2 AND count(o.asset_id)=2 AND count(*) FILTER (WHERE o.outcome_index=0)=1
    """).fetchall()


def s03_merge(picker: Picker, demand: list[tuple]) -> dict[str, int]:
    """Add new markets (due: stored requested_at + interval, -inf without a price row), drop the
    ones no longer demanded, move a market whose interval changed to its last fetch + new interval."""
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
def c02_summaries(ips: IPPool, picker: Picker, seconds: float, maintained: dict):
    """Every `seconds` on its own thread: maintain, then log dispatch_summary; once more at a
    normal end. A maintenance failure ends that thread; the dispatcher then stops on it."""
    done = threading.Event()
    state = {"before": s04_counters(ips, picker), "started": time.monotonic()}

    def loop():
        while not done.wait(seconds):
            state.update(s05_summary(ips, picker, state, c01_maintain(picker)))

    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="runtime_clob_summary") as thread:
        picker.summaries = thread.submit(loop)
        try:
            yield
        finally:
            done.set()
    picker.summaries.result()
    s05_summary(ips, picker, state, maintained)


def s04_counters(ips: IPPool, picker: Picker) -> dict[str, Counter]:
    with ips.condition:
        requests = Counter(ips.requests_by_exit())
        rate_limited, errors = Counter(ips.exit_429), Counter(ips.exit_errors)
    with picker.lock:
        markets, requeued = Counter(picker.exit_markets), Counter(picker.exit_requeued)
        counts = Counter(picker.counts)
    return {
        "requests": requests,
        "markets": markets,
        "errors": errors,
        "requeued": requeued,
        "http_429": rate_limited,
        "counts": counts,
    }


def s05_summary(ips: IPPool, picker: Picker, state: dict, maintained: dict) -> dict:
    with picker.lock:
        if picker.full_since is not None:
            # Intake is stopped right now: count it up to here.
            moment = time.monotonic()
            picker.counts["write_queue_full_ms"] += round((moment - picker.full_since) * 1000)
            picker.full_since = moment
    now, before = s04_counters(ips, picker), state["before"]
    delta = {key: now[key] - before[key] for key in now}
    labels = [h_exit_label(address) for address in ips.addresses]
    with picker.lock:
        write_queue_max, picker.write_queue_max = picker.write_queue_max, 0
        inflight = len(picker.inflight)
    groups, unseen = s06_ages(picker, time.time())
    exit_keys = ("requests", "markets", "errors", "requeued", "http_429")
    h_log(
        "runtime_clob",
        "dispatch_summary",
        seconds=round(time.monotonic() - state["started"], 1),
        exits={label: {key: delta[key][label] for key in exit_keys} for label in labels},
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


def s06_ages(picker: Picker, now: float) -> tuple[dict[str, dict], int]:
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
            "age_p50": s07_percentile(values, 0.5),
            "age_p95": s07_percentile(values, 0.95),
            "overdue": overdue,
            "overdue_share": round(overdue / len(values), 4) if values else None,
        }
    return groups, sum(never.values())


def s07_percentile(values: list[float], fraction: float) -> float | None:
    """Linear interpolation between the closest ranks of sorted values (as percentile_cont)."""
    if not values:
        return None
    position = fraction * (len(values) - 1)
    low = int(position)
    high = min(low + 1, len(values) - 1)
    return round(values[low] + (values[high] - values[low]) * (position - low), 2)


def c03_dispatch(ips: IPPool, picker: Picker, stop, writers: int, max_pending_writes: int) -> None:
    """Fetch on every free exit slot; a slot is free again as soon as its HTTP ends. Responses are
    written on `writers` connections, one committed statement per batch; while max_pending_writes
    batches wait to be written, no new request starts. A failed batch goes back to the schedule."""
    pending = {}
    with ExitStack() as stack:
        connections = Queue()
        for _ in range(writers):
            connections.put(stack.enter_context(h_connect(autocommit=True)))
        executor = stack.enter_context(ThreadPoolExecutor(max_workers=writers))

        def take():
            if picker.summaries is not None and picker.summaries.done():
                picker.summaries.result()  # it only ends early on a maintenance failure, raised here
            s17_collect(pending, picker, block=False)
            full = len(pending) >= max_pending_writes
            with picker.lock:
                if full and picker.full_since is None:
                    picker.full_since = time.monotonic()
                elif not full and picker.full_since is not None:
                    waited = time.monotonic() - picker.full_since
                    picker.counts["write_queue_full_ms"] += round(waited * 1000)
                    picker.full_since = None
            return None if full else s08_take(picker, time.time())

        try:
            for batch, rows, exit_label, error in ips.dispatch(
                take, partial(s10_fetch, ips), lambda: stop.is_set() or picker.finished, s09_fatal
            ):
                if error is not None:
                    s13_requeue(picker, batch, exit_label, error)
                    continue
                s14_fetched(picker, rows, exit_label)
                pending[executor.submit(s15_write, ips, picker, connections, rows)] = batch
                with picker.lock:
                    picker.write_queue_max = max(picker.write_queue_max, len(pending))
        finally:
            s17_collect(pending, picker, block=True)


def s08_take(picker: Picker, now: float) -> list[tuple[str, str]] | None:
    """Up to `size` markets with the earliest due times, due or not; never one already in flight."""
    with picker.lock:
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
            if picker.once and due > now:
                break
            heapq.heappop(heap)
            batch.append((market_id, market.asset))
            picker.inflight.add(market_id)
            if picker.once:
                picker.sent.add(market_id)
        if not batch:
            # once: done when nothing is due or in flight (a failed batch may still come back);
            # resident: every demanded market is in flight, wait.
            picker.finished = picker.once and not picker.inflight
            return None
        return batch


def s09_fatal(error: Exception) -> bool:
    """401/403, every exit held by 429 (a 429 only gets here then) and anything that is not a
    provider or contract failure end the call; any other failed batch goes back."""
    if isinstance(error, ProviderError):
        return error.status in (401, 403, 429)
    return not isinstance(error, ContractError)


def s10_fetch(ips: IPPool, markets: list[tuple[str, str]]) -> list[tuple]:
    body = [{"token_id": asset, "side": side} for _, asset in markets for side in ("BUY", "SELL")]
    requested = datetime.now(UTC)
    response = ips.request(
        "POST", "https://clob.polymarket.com/prices", body=body, target=[m[0] for m in markets]
    )
    return s11_parse(response, markets, requested)


def s11_parse(response: dict, markets: list[tuple[str, str]], requested: datetime) -> list[tuple]:
    assets = {asset for _, asset in markets}
    if not isinstance(response, dict) or not set(response).issubset(assets):
        raise ContractError("Unexpected CLOB response keys")
    rows = []
    for market, asset in markets:
        value = response.get(asset)
        if value is not None and not isinstance(value, dict):
            raise ContractError("CLOB prices must contain side maps")
        bid = s12_price(value.get("BUY")) if value is not None else None
        ask = s12_price(value.get("SELL")) if value is not None else None
        # REST BUY/SELL are bid/ask; 0 bid and 1 ask denote absent book sides.
        rows.append(
            (market, asset, None if bid == 0 else bid, None if ask == 1 else ask, requested)
        )
    return rows


def s12_price(value) -> Decimal | None:
    if value is None:
        return None
    try:
        price = Decimal(str(value))
    except InvalidOperation:
        raise ContractError("Invalid CLOB price") from None
    if not price.is_finite() or not 0 <= price <= 1:
        raise ContractError("CLOB price outside [0,1]")
    return price


def s13_requeue(picker: Picker, batch: list[tuple[str, str]], exit_label: str, error) -> None:
    """A failed batch: its markets leave inflight with their due times unchanged (so they come up
    again in their turn), its exit gets one requeued batch, and dispatch goes on."""
    with picker.lock:
        picker.exit_requeued[exit_label] += 1
        for market_id, _ in batch:
            picker.inflight.discard(market_id)
            picker.sent.discard(market_id)
            market = picker.markets.get(market_id)
            if market is not None:
                heapq.heappush(picker.heap, (market.due, market_id))
    status = getattr(error, "context", {}).get("status")
    h_log(
        "runtime_clob",
        "batch_requeued",
        ip=exit_label,
        status=status,
        reason=str(error),
        markets=len(batch),
    )


def s14_fetched(picker: Picker, rows: list[tuple], exit_label: str) -> None:
    """The batch came back: each market's next due time is this request + its interval, written or
    not; the markets stay in flight until their write is done."""
    with picker.lock:
        picker.exit_markets[exit_label] += len(rows)
        picker.counts["fetched"] += len(rows)
        for market_id, _, _, _, requested in rows:
            market = picker.markets.get(market_id)
            if market is not None:
                market.fetched = requested.timestamp()
                market.due = market.fetched + market.seconds


def s15_write(ips: IPPool, picker: Picker, connections: Queue, rows: list[tuple]) -> tuple:
    connection = connections.get()
    try:
        counts = s16_publish(connection, rows)
    finally:
        connections.put(connection)
    with picker.lock:
        picker.counts["written"] += counts[0]
    ips.report(success=len(rows), no_data=sum(r[2] is None and r[3] is None for r in rows))
    return counts


def s16_publish(connection, rows: list[tuple]) -> tuple[int, int, int]:
    """Write a market only when its bid or ask differs from the stored row, or the stored row is
    at least one interval older than this request (or there is none yet)."""
    if not rows:
        return 0, 0, 0
    # Re-read current demand and first-outcome identity after HTTP. A late
    # response cannot reintroduce a withdrawn market or overwrite a newer quote.
    published = connection.execute(
        """WITH incoming AS (
            SELECT market_id,asset_id,best_bid,best_ask,requested_at
            FROM unnest(%s::text[],%s::text[],%s::numeric[],%s::numeric[],%s::timestamptz[])
                AS r(market_id,asset_id,best_bid,best_ask,requested_at)
        ), eligible AS (
            SELECT o.market_id,min(o.asset_id) FILTER (WHERE o.outcome_index=0) AS asset_id,
                min(d.refresh_seconds) AS refresh_seconds
            FROM m_live.m01_outcome AS o
            JOIN incoming AS r ON r.market_id=o.market_id
            JOIN m_live.m01_demand_market AS d ON d.market_id=o.market_id
            GROUP BY o.market_id
            HAVING count(*)=2 AND count(o.asset_id)=2
                AND count(*) FILTER (WHERE o.outcome_index=0)=1
        ), changed AS (
            SELECT r.* FROM incoming AS r
            JOIN eligible AS e ON e.market_id=r.market_id AND e.asset_id=r.asset_id
            LEFT JOIN m_live.m02_clob_price AS p ON p.market_id=r.market_id
            WHERE p.market_id IS NULL OR p.asset_id<>r.asset_id
                OR p.best_bid IS DISTINCT FROM r.best_bid
                OR p.best_ask IS DISTINCT FROM r.best_ask
                OR p.requested_at + e.refresh_seconds * interval '1 second' <= r.requested_at
        )
        INSERT INTO m_live.m02_clob_price
            (market_id,asset_id,best_bid,best_ask,requested_at,m_live_updated_at)
        SELECT market_id,asset_id,best_bid,best_ask,requested_at,clock_timestamp()
        FROM changed
        ORDER BY market_id
        ON CONFLICT (market_id) DO UPDATE SET
            asset_id=EXCLUDED.asset_id,best_bid=EXCLUDED.best_bid,best_ask=EXCLUDED.best_ask,
            requested_at=EXCLUDED.requested_at,m_live_updated_at=EXCLUDED.m_live_updated_at
        WHERE EXCLUDED.requested_at >= m02_clob_price.requested_at
        RETURNING best_bid,best_ask""",
        tuple([r[i] for r in rows] for i in range(5)),
    ).fetchall()
    return (
        len(published),
        sum(r[0] is not None for r in published),
        sum(r[1] is not None for r in published),
    )


def s17_collect(pending: dict, picker: Picker, *, block: bool) -> None:
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
