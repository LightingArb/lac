"""Session lock held by the module entry point throughout every child round."""

from collections.abc import Iterator
from contextlib import contextmanager

from h_shared.h_db import h_connect
from h_shared.h_log import h_log


@contextmanager
def h_lock() -> Iterator[None]:
    """Refuse overlapping Normal/maintenance invocations in the same database."""
    with h_connect(autocommit=True) as connection:
        # lac_data setup uses 7165432; this key belongs to historical execution.
        if not connection.execute("SELECT pg_try_advisory_lock(7165433)").fetchone()[0]:
            h_log("all_runtime", "already_running", reason="Stop m_historical before starting")
            raise SystemExit(1)
        # Closing this dedicated autocommit session releases the lock, including
        # when h_wait exits with an error. No transaction spans provider I/O.
        yield
