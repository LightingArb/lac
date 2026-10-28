"""Keep every exit busy with CLOB /prices batches, earliest next refresh first; publish each response."""

import threading
import time
from collections import Counter, deque
from concurrent.futures import Future, ThreadPoolExecutor, wait
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from functools import partial
from queue import Queue

from h_shared.h_db import h_connect
from h_shared.h_ip_pool import ContractError, IPPool, h_exit_label
from h_shared.h_log import h_log
from h_shared.h_process import Result


@dataclass
class Picker:
    """What to send next: never-fetched markets first, then price rows by next_due.

    A market taken into a batch stays in inflight until that batch is written (or this call ends),
    so it is never in two batches at once. once: only due markets, each at most once per call.
    """

    size: int
    refill: int
    once: bool
    unseen: deque = field(default_factory=deque)
    queued: deque = field(default_factory=deque)
    inflight: set = field(default_factory=set)
    sent: set = field(default_factory=set)
    finished: bool = False
    summaries: Future | None = None  # the maintenance and summary thread
    markets: Counter = field(default_factory=Counter)  # markets fetched per exit label
    lock: threading.Lock = field(default_factory=threading.Lock)


def runtime_clob(
    ips: IPPool,
    *,
    stop,
    once: bool,
    request_items: int,
    refill_batches: int,
    writers: int,
    max_pending_writes: int,
    summary_seconds: float,
) -> Result:
    """Resident: until stop is set, keep every exit's slots busy with batches of request_items
    markets (never fetched first, then earliest next_due, due or not) and publish each response on
    writers connections. once: never-fetched and due markets only, then return.

    Every summary_seconds: delete prices no longer demanded, recompute next_due where the interval
    changed, reload never-fetched markets and log dispatch_summary.
    """
    if writers < 1 or max_pending_writes < 1 or refill_batches < 1:
        raise ValueError("Declare positive writers, pending writes and refill batches")
    picker = Picker(request_items, refill_batches * request_items, once)
    maintained = c01_maintain(picker)
    with c02_summaries(ips, picker, summary_seconds, maintained):
        c03_dispatch(ips, picker, stop, writers, max_pending_writes)
    return Result.COMPLETE


def c01_maintain(picker: Picker) -> dict[str, int]:
    with h_connect(autocommit=True) as connection:
        deleted = s01_delete_retired(connection)
        recomputed = s02_recompute_next_due(connection)
        unseen = s03_unseen(connection)
    with picker.lock:
        picker.unseen = deque(
            m for m in unseen if m[0] not in picker.inflight and m[0] not in picker.sent
        )
    return {"deleted": deleted, "recomputed": recomputed}


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


def s02_recompute_next_due(connection) -> int:
    """A market whose interval changed (settings or product demand) moves to last request + new
    interval; with an unchanged interval nothing is written."""
    return connection.execute("""
        UPDATE m_live.m02_clob_price AS p
        SET next_due=c.next_due
        FROM (
            SELECT p.market_id, p.requested_at + d.refresh_seconds * interval '1 second' AS next_due
            FROM m_live.m02_clob_price AS p
            JOIN m_live.m01_demand_market AS d ON d.market_id=p.market_id
            WHERE p.next_due <> p.requested_at + d.refresh_seconds * interval '1 second'
            ORDER BY p.market_id FOR UPDATE OF p
        ) AS c
        WHERE p.market_id=c.market_id
    """).rowcount


def s03_unseen(connection) -> list[tuple[str, str]]:
    """Demanded binary markets (both outcomes with an asset) without a price row: next_due is
    -infinity for them, so they go before every priced market."""
    return connection.execute("""
        SELECT d.market_id, min(o.asset_id) FILTER (WHERE o.outcome_index=0)
        FROM m_live.m01_demand_market AS d
        JOIN m_live.m01_outcome AS o ON o.market_id=d.market_id
        WHERE NOT EXISTS (
            SELECT 1 FROM m_live.m02_clob_price AS p WHERE p.market_id=d.market_id
        )
        GROUP BY d.market_id
        HAVING count(*)=2 AND count(o.asset_id)=2 AND count(*) FILTER (WHERE o.outcome_index=0)=1
        ORDER BY d.market_id
    """).fetchall()


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
        markets = Counter(picker.markets)
    return {"requests": requests, "markets": markets, "errors": errors, "http_429": rate_limited}


def s05_summary(ips: IPPool, picker: Picker, state: dict, maintained: dict) -> dict:
    now, before = s04_counters(ips, picker), state["before"]
    delta = {key: now[key] - before[key] for key in now}
    labels = [h_exit_label(address) for address in ips.addresses]
    with h_connect() as connection:
        groups = s06_ages(connection)
    with picker.lock:
        unseen, inflight = len(picker.unseen), len(picker.inflight)
    h_log(
        "runtime_clob",
        "dispatch_summary",
        seconds=round(time.monotonic() - state["started"], 1),
        exits={label: {key: delta[key][label] for key in delta} for label in labels},
        all_exits_429=delta["http_429"]["all"],
        groups=groups,
        unseen=unseen,
        inflight=inflight,
        **maintained,
    )
    return {"before": now, "started": time.monotonic()}


def s06_ages(connection) -> dict[str, dict]:
    """Per interval: demanded markets, those with a price, age p50/p95 in seconds and how many
    priced ones are past next_due."""
    rows = connection.execute("""
        SELECT d.refresh_seconds, count(*), count(p.market_id),
            percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM now() - p.requested_at)),
            percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM now() - p.requested_at)),
            count(*) FILTER (WHERE p.next_due <= now())
        FROM m_live.m01_demand_market AS d
        LEFT JOIN m_live.m02_clob_price AS p ON p.market_id=d.market_id
        GROUP BY d.refresh_seconds ORDER BY d.refresh_seconds
    """).fetchall()
    return {
        str(seconds): {
            "markets": markets,
            "priced": priced,
            "age_p50": None if p50 is None else round(p50, 2),
            "age_p95": None if p95 is None else round(p95, 2),
            "overdue": overdue,
        }
        for seconds, markets, priced, p50, p95, overdue in rows
    }


def c03_dispatch(ips: IPPool, picker: Picker, stop, writers: int, max_pending_writes: int) -> None:
    """Fetch on every free exit slot; write on `writers` connections, each batch one committed
    statement. While max_pending_writes batches wait to be written, no new request starts."""
    pending = {}
    with ExitStack() as stack:
        connections = Queue()
        for _ in range(writers):
            connections.put(stack.enter_context(h_connect(autocommit=True)))
        executor = stack.enter_context(ThreadPoolExecutor(max_workers=writers))
        reader = stack.enter_context(h_connect(autocommit=True))

        def take():
            s14_collect(pending, picker, block=False)
            if len(pending) >= max_pending_writes:
                return None
            return s07_take(picker, reader)

        try:
            for batch, rows, exit_label in ips.dispatch(
                take, partial(s09_fetch, ips), lambda: stop.is_set() or picker.finished
            ):
                with picker.lock:
                    picker.markets[exit_label] += len(batch)
                pending[executor.submit(s12_write, ips, connections, rows)] = batch
        finally:
            s14_collect(pending, picker, block=True)


def s07_take(picker: Picker, connection) -> list[tuple[str, str]] | None:
    if picker.summaries is not None and picker.summaries.done():
        picker.summaries.result()  # it only ends early on a maintenance failure, raised here
    with picker.lock:
        skip = picker.inflight | picker.sent
        batch = []
        while len(batch) < picker.size and picker.unseen:
            market = picker.unseen.popleft()
            if market[0] not in skip:
                batch.append(market)
                skip.add(market[0])
    if len(batch) < picker.size and not picker.queued:
        # In-flight markets hold the earliest next_due values, so read past them.
        rows = s08_next_due(connection, len(skip) + picker.refill, picker.once)
        picker.queued = deque(m for m in rows if m[0] not in skip)
    while len(batch) < picker.size and picker.queued:
        market = picker.queued.popleft()
        if market[0] not in skip:
            batch.append(market)
            skip.add(market[0])
    if not batch:
        # once: nothing more is due; resident: every demanded market is in flight.
        picker.finished = picker.once
        return None
    with picker.lock:
        picker.inflight.update(m for m, _ in batch)
        if picker.once:
            picker.sent.update(m for m, _ in batch)
    return batch


def s08_next_due(connection, limit: int, due_only: bool) -> list[tuple[str, str]]:
    """Priced, still demanded markets by next_due (due or not, unless due_only), with the current
    first-outcome asset."""
    return connection.execute(
        """SELECT p.market_id, o.asset_id
        FROM m_live.m02_clob_price AS p
        JOIN m_live.m01_outcome AS o ON o.market_id=p.market_id AND o.outcome_index=0
        WHERE o.asset_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM m_live.m01_demand_market AS d WHERE d.market_id=p.market_id)
          AND (NOT %s OR p.next_due <= now())
        ORDER BY p.next_due
        LIMIT %s""",
        (due_only, limit),
    ).fetchall()


def s09_fetch(ips: IPPool, markets: list[tuple[str, str]]) -> list[tuple]:
    body = [{"token_id": asset, "side": side} for _, asset in markets for side in ("BUY", "SELL")]
    requested = datetime.now(UTC)
    response = ips.request(
        "POST", "https://clob.polymarket.com/prices", body=body, target=[m[0] for m in markets]
    )
    return s10_parse(response, markets, requested)


def s10_parse(response: dict, markets: list[tuple[str, str]], requested: datetime) -> list[tuple]:
    assets = {asset for _, asset in markets}
    if not isinstance(response, dict) or not set(response).issubset(assets):
        raise ContractError("Unexpected CLOB response keys")
    rows = []
    for market, asset in markets:
        value = response.get(asset)
        if value is not None and not isinstance(value, dict):
            raise ContractError("CLOB prices must contain side maps")
        bid = s11_price(value.get("BUY")) if value is not None else None
        ask = s11_price(value.get("SELL")) if value is not None else None
        # REST BUY/SELL are bid/ask; 0 bid and 1 ask denote absent book sides.
        rows.append(
            (market, asset, None if bid == 0 else bid, None if ask == 1 else ask, requested)
        )
    return rows


def s11_price(value) -> Decimal | None:
    if value is None:
        return None
    try:
        price = Decimal(str(value))
    except InvalidOperation:
        raise ContractError("Invalid CLOB price") from None
    if not price.is_finite() or not 0 <= price <= 1:
        raise ContractError("CLOB price outside [0,1]")
    return price


def s12_write(ips: IPPool, connections: Queue, rows: list[tuple]) -> tuple[int, int, int]:
    connection = connections.get()
    try:
        counts = s13_publish(connection, rows)
    finally:
        connections.put(connection)
    ips.report(success=counts[0], no_data=sum(r[2] is None and r[3] is None for r in rows))
    return counts


def s13_publish(connection, rows: list[tuple]) -> tuple[int, int, int]:
    if not rows:
        return 0, 0, 0
    # Re-read current demand and first-outcome identity after HTTP. A late
    # response cannot reintroduce a withdrawn market or overwrite a newer quote.
    # Every write moves next_due, also when the price is unchanged.
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
        )
        INSERT INTO m_live.m02_clob_price
            (market_id,asset_id,best_bid,best_ask,requested_at,m_live_updated_at,next_due)
        SELECT r.market_id,r.asset_id,r.best_bid,r.best_ask,r.requested_at,clock_timestamp(),
            r.requested_at + e.refresh_seconds * interval '1 second'
        FROM incoming AS r JOIN eligible AS e
            ON e.market_id=r.market_id AND e.asset_id=r.asset_id
        ORDER BY r.market_id
        ON CONFLICT (market_id) DO UPDATE SET
            asset_id=EXCLUDED.asset_id,best_bid=EXCLUDED.best_bid,best_ask=EXCLUDED.best_ask,
            requested_at=EXCLUDED.requested_at,m_live_updated_at=EXCLUDED.m_live_updated_at,
            next_due=EXCLUDED.next_due
        WHERE EXCLUDED.requested_at >= m02_clob_price.requested_at
        RETURNING best_bid,best_ask""",
        tuple([r[i] for r in rows] for i in range(5)),
    ).fetchall()
    return (
        len(published),
        sum(r[0] is not None for r in published),
        sum(r[1] is not None for r in published),
    )


def s14_collect(pending: dict, picker: Picker, *, block: bool) -> None:
    """Release the markets of finished writes; block: wait for every pending write first."""
    if not pending:
        return
    done, _ = wait(pending, timeout=None if block else 0)
    for future in done:
        batch = pending.pop(future)
        with picker.lock:
            picker.inflight.difference_update(m for m, _ in batch)
    for future in done:
        future.result()
