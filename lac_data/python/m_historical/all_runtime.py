import argparse
import time
from datetime import datetime

from h_shared.h_process import h_process, h_wait
from m_historical.all_setup import all_setup
from m_historical.src.m01_polymarket.runtime_polymarket import runtime_polymarket


def all_runtime() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", required=True)
    parser.add_argument("--days", type=int, default=3)
    parser.add_argument("--top-events", type=int, default=500)
    parser.add_argument("--end", help="Fixed ISO-8601 UTC end; omit to freeze current minute")
    args = parser.parse_args()
    if not 1 <= args.days <= 15 or not 1 <= args.top_events <= 500:
        parser.error("days must be 1..15; top-events must be 1..500")
    if args.end:
        parsed = datetime.fromisoformat(args.end)
        if parsed.tzinfo is None:
            parser.error("--end needs a timezone")
        end = int(parsed.timestamp()) // 60 * 60
    else:
        end = int(time.time()) // 60 * 60
    all_setup()
    h_wait(
        [
            h_process(
                runtime_polymarket,
                once=True,
                interval=60,
                timeout=30,
                retries=2,
                rate=10,
                rate_wait=60,
                workers=8,
                days=args.days,
                top_events=args.top_events,
                end=end,
                max_assets=1000,
                publish_assets=40,
                page_limit=10000,
                max_pages=10,
                bucket_seconds=60,
                write_batch=1000,
            )
        ]
    )


if __name__ == "__main__":
    all_runtime()
