import argparse

from h_shared.h_ip_pool import h_outbound_ips
from h_shared.h_process import h_process, h_wait
from m_historical.src.m01_price.runtime_history import runtime_history


def all_runtime() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    OUTBOUND_IPS = h_outbound_ips()
    # Data API quota is independent of m_live's Gamma and CLOB endpoint quotas.
    h_wait(
        [
            h_process(
                runtime_history,
                once=args.once,
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
                lookback_days=7,
                settle_minutes=10,
                max_pending_writes=8,
            )
        ]
    )


if __name__ == "__main__":
    all_runtime()
