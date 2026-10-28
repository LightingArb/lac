import argparse
from datetime import date

from h_shared.h_ip_pool import h_outbound_ips
from h_shared.h_process import h_process, h_wait
from m_historical.src.h_lock import h_lock
from m_historical.src.m01_price.runtime_history import runtime_history


def all_runtime() -> None:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true")
    mode.add_argument("--errors-only", action="store_true")
    args = parser.parse_args()
    # Each proxy exit must reach Polymarket (the CLOB) before any runtime starts.
    OUTBOUND_IPS = h_outbound_ips(check_url="https://clob.polymarket.com/time", check_timeout=30)
    # Data API quota is independent of m_live's Gamma and CLOB endpoint quotas.
    with h_lock():
        h_wait(
            [
                h_process(
                    runtime_history,
                    once=args.once or args.errors_only,
                    rest_s=60,
                    ips=OUTBOUND_IPS,
                    ip_inflight=16,
                    ip_limit={"/v2/prices-history": (200, 10)},
                    timeout=30,
                    retries=2,
                    rate_wait=60,
                    backoff_max=8,
                    auth_log_s=60,
                    max_response_bytes=64 * 1024 * 1024,
                    max_items=10000,
                    first_day=date(2026, 10, 23),
                    errors_only=args.errors_only,
                    lookback_days=7,
                    settle_minutes=10,
                    max_pending_writes=8,
                )
            ]
        )


if __name__ == "__main__":
    all_runtime()
