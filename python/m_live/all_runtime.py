import argparse

from h_shared.h_ip_pool import h_outbound_ips
from h_shared.h_process import h_process, h_wait
from m_live.src.m01_gamma.runtime_gamma import runtime_gamma
from m_live.src.m02_clob.runtime_clob import runtime_clob


def all_runtime() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--unit", choices=("gamma", "clob", "all"), default="all")
    args = parser.parse_args()
    OUTBOUND_IPS = h_outbound_ips()
    # https://docs.polymarket.com/api-reference/rate-limits
    # Round 2 explicitly assigns /events/keyset to the /events listing quota.
    processes = []
    if args.unit in ("gamma", "all"):
        processes.append(
            h_process(
                runtime_gamma,
                once=args.once,
                period_s=600,
                ips=OUTBOUND_IPS,
                ip_inflight=4,
                ip_limit={"/events": (500, 10)},
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
