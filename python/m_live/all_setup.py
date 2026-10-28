from pathlib import Path

from h_shared.h_db import h_connect, h_setup


def all_setup() -> None:
    c01_add_next_due()
    h_setup("m_live", Path(__file__).parent / "sql")


def c01_add_next_due() -> None:
    """A price table from before next_due gets the column, filled and indexed, before the check.

    A new database gets it from sql/m02_price.sql; once the column exists this does nothing.
    """
    with h_connect("postgres") as connection:
        if not connection.execute("SELECT 1 FROM pg_database WHERE datname='lac_data'").fetchone():
            return
    with h_connect() as connection:
        s01_add_next_due(connection)


def s01_add_next_due(connection) -> bool:
    """Add, fill (last request + the market's interval; requested_at when no longer demanded) and
    index next_due in one transaction. Returns whether anything changed."""
    columns = {
        r[0]
        for r in connection.execute(
            """SELECT column_name FROM information_schema.columns
            WHERE table_schema='m_live' AND table_name='m02_clob_price'"""
        )
    }
    if not columns or "next_due" in columns:
        return False
    connection.execute("ALTER TABLE m_live.m02_clob_price ADD COLUMN next_due TIMESTAMPTZ")
    connection.execute("""UPDATE m_live.m02_clob_price AS p
        SET next_due=p.requested_at + d.refresh_seconds * interval '1 second'
        FROM m_live.m01_demand_market AS d WHERE d.market_id=p.market_id""")
    connection.execute(
        "UPDATE m_live.m02_clob_price SET next_due=requested_at WHERE next_due IS NULL"
    )
    connection.execute("ALTER TABLE m_live.m02_clob_price ALTER COLUMN next_due SET NOT NULL")
    connection.execute(
        "CREATE INDEX IF NOT EXISTS clob_price_next_due ON m_live.m02_clob_price (next_due)"
    )
    print("SETUP_MIGRATED m_live.m02_clob_price next_due", flush=True)
    return True


if __name__ == "__main__":
    all_setup()
