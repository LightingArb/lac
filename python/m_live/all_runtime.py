import argparse

from h_shared.h_process import h_process, h_wait
from m_live.all_setup import all_setup
from m_live.src.m01_gamma.runtime_gamma import runtime_gamma
from m_live.src.m02_clob.runtime_clob import runtime_clob


def all_runtime() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--unit", choices=("gamma", "clob", "all"), default="all")
    args = parser.parse_args()
    all_setup()
    processes = []
    if args.unit in ("gamma", "all"):
        processes.append(
            h_process(
                runtime_gamma,
                once=args.once,
                interval=600,
                timeout=30,
                retries=2,
                rate=10,
                rate_wait=60,
                workers=1,
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
                interval=600,
                timeout=30,
                retries=2,
                rate=10,
                rate_wait=60,
                workers=8,
                request_items=500,
                write_batch=1000,
            )
        )
    h_wait(processes)


if __name__ == "__main__":
    all_runtime()
