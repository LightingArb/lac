"""The price table loses round 3's next_due and gets fillfactor 70; checked in a rolled-back transaction."""

from m_live import all_setup


def shape(connection):
    columns = [
        r[0]
        for r in connection.execute(
            """SELECT column_name FROM information_schema.columns
            WHERE table_schema='m_live' AND table_name='m02_clob_price' ORDER BY ordinal_position"""
        )
    ]
    index = connection.execute("SELECT to_regclass('m_live.clob_price_next_due')").fetchone()[0]
    options = connection.execute(
        "SELECT reloptions FROM pg_class WHERE oid='m_live.m02_clob_price'::regclass"
    ).fetchone()[0]
    return columns, index, options


def test_round3_price_table_loses_next_due_and_gets_fillfactor(empty_database, capsys):
    connection = empty_database
    connection.execute("ALTER TABLE m_live.m02_clob_price ADD COLUMN next_due TIMESTAMPTZ")
    connection.execute("CREATE INDEX clob_price_next_due ON m_live.m02_clob_price (next_due)")
    connection.execute("ALTER TABLE m_live.m02_clob_price RESET (fillfactor)")
    assert all_setup.s01_migrate_price(connection)
    columns, index, options = shape(connection)
    assert "next_due" not in columns and len(columns) == 6
    assert index is None and options == ["fillfactor=70"]
    assert capsys.readouterr().out.splitlines() == [
        "SETUP_MIGRATED m_live.m02_clob_price next_due dropped",
        "SETUP_MIGRATED m_live.m02_clob_price fillfactor=70",
    ]
    # Once done, a rerun changes nothing and prints nothing.
    assert not all_setup.s01_migrate_price(connection)
    assert shape(connection) == (columns, None, ["fillfactor=70"])
    assert capsys.readouterr().out == ""


def test_table_from_before_round3_only_gets_fillfactor(empty_database, capsys):
    connection = empty_database
    connection.execute("ALTER TABLE m_live.m02_clob_price RESET (fillfactor)")
    assert all_setup.s01_migrate_price(connection)
    assert shape(connection)[2] == ["fillfactor=70"]
    assert capsys.readouterr().out == "SETUP_MIGRATED m_live.m02_clob_price fillfactor=70\n"
