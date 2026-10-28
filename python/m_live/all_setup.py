from pathlib import Path

from h_shared.h_db import h_connect, h_setup


def all_setup() -> None:
    c01_migrate()
    h_setup("m_live", Path(__file__).parent / "sql")


def c01_migrate() -> None:
    """An existing price table loses next_due (round 3); existing price and book tables get
    fillfactor 70, before the check.

    A new database gets the tables from sql/; once done this does nothing.
    """
    with h_connect("postgres") as connection:
        if not connection.execute("SELECT 1 FROM pg_database WHERE datname='lac_data'").fetchone():
            return
    with h_connect() as connection:
        s01_migrate_price(connection)
        s02_migrate_book(connection)


def s01_migrate_price(connection) -> bool:
    """Drop next_due with its index and set fillfactor 70 (applies to pages written from now on;
    old pages get room as VACUUM frees them), in one transaction. Returns whether anything changed."""
    options = connection.execute(
        "SELECT reloptions FROM pg_class WHERE oid=to_regclass('m_live.m02_clob_price')"
    ).fetchone()
    if options is None:
        return False
    changes = []
    if connection.execute(
        """SELECT 1 FROM information_schema.columns
        WHERE table_schema='m_live' AND table_name='m02_clob_price' AND column_name='next_due'"""
    ).fetchone():
        connection.execute("DROP INDEX IF EXISTS m_live.clob_price_next_due")
        connection.execute("ALTER TABLE m_live.m02_clob_price DROP COLUMN next_due")
        changes.append("next_due dropped")
    if "fillfactor=70" not in (options[0] or []):
        connection.execute("ALTER TABLE m_live.m02_clob_price SET (fillfactor = 70)")
        changes.append("fillfactor=70")
    for change in changes:
        print(f"SETUP_MIGRATED m_live.m02_clob_price {change}", flush=True)
    return bool(changes)


def s02_migrate_book(connection) -> bool:
    """Set fillfactor 70 on an existing book table, as for prices. Returns whether it changed."""
    options = connection.execute(
        "SELECT reloptions FROM pg_class WHERE oid=to_regclass('m_live.m03_clob_book')"
    ).fetchone()
    if options is None or "fillfactor=70" in (options[0] or []):
        return False
    connection.execute("ALTER TABLE m_live.m03_clob_book SET (fillfactor = 70)")
    print("SETUP_MIGRATED m_live.m03_clob_book fillfactor=70", flush=True)
    return True


if __name__ == "__main__":
    all_setup()
