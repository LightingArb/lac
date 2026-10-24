import argparse

from h_shared.h_ip_pool import h_outbound_ips
from h_shared.h_process import h_process, h_wait
from m_live.src.m01_market.runtime_demand import runtime_demand
from m_live.src.m01_market.runtime_gamma_full import runtime_gamma_full
from m_live.src.m01_market.runtime_gamma_recent import runtime_gamma_recent
from m_live.src.m02_clob.runtime_clob import runtime_clob


def all_runtime() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument(
        "--unit", choices=("recent", "full", "demand", "clob", "all"), default="all"
    )
    args = parser.parse_args()
    OUTBOUND_IPS = h_outbound_ips()
    # https://docs.polymarket.com/api-reference/rate-limits
    # /markets: 300/10s; /events: 500/10s split full 400 + recent 100.
    # Keyset consumes the corresponding listing quota; total 800 < combined 900.
    processes = []
    if args.unit in ("recent", "all"):
        processes.append(
            h_process(
                runtime_gamma_recent,
                once=args.once,
                period_s=60,
                ips=OUTBOUND_IPS,
                ip_inflight=4,
                ip_limit={"/markets": (300, 10), "/events": (100, 10)},
                timeout=30,
                retries=2,
                rate_wait=60,
                backoff_max=8,
                auth_log_s=60,
                max_response_bytes=64 * 1024 * 1024,
                page_size=100,
                max_pages=20,
                overlap_seconds=120,
                lookback_hours=1,
                follow_limit=1000,
                event_batch=100,
                write_batch=1000,
            )
        )
    if args.unit in ("full", "all"):
        processes.append(
            h_process(
                runtime_gamma_full,
                once=args.once,
                period_s=600,
                ips=OUTBOUND_IPS,
                ip_inflight=4,
                ip_limit={"/events": (400, 10)},
                timeout=30,
                retries=2,
                rate_wait=60,
                backoff_max=8,
                auth_log_s=60,
                max_response_bytes=64 * 1024 * 1024,
                page_size=100,
                max_pages=1000,
                write_batch=1000,
            )
        )
    if args.unit in ("demand", "all"):
        processes.append(
            h_process(
                runtime_demand,
                once=args.once,
                period_s=60,
                ip_inflight=1,
                timeout=30,
                retries=2,
                rate_wait=60,
                backoff_max=8,
                auth_log_s=60,
                max_response_bytes=64 * 1024 * 1024,
                products=[],
                sports_seconds=60,
                other_seconds=10,
                read_batch=1000,
            )
        )
    if args.unit in ("clob", "all"):
        processes.append(
            h_process(
                runtime_clob,
                once=args.once,
                period_s=600,
                ips=OUTBOUND_IPS,
                ip_inflight=4,
                # /last-trades-prices: 官方未列，照同類 endpoint 的額度。
                ip_limit={
                    "/prices": (500, 10),
                    "/midpoints": (500, 10),
                    "/last-trades-prices": (500, 10),
                },
                timeout=30,
                retries=2,
                rate_wait=60,
                backoff_max=8,
                auth_log_s=60,
                max_response_bytes=64 * 1024 * 1024,
                request_items=500,
                report_every=100,
                write_batch=1000,
            )
        )
    h_wait(processes)


if __name__ == "__main__":
    all_runtime()
