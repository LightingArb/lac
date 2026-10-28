"""next_due added to a price table from before it; checked inside a rolled-back transaction."""

from datetime import UTC, datetime, timedelta

from m_live import all_setup

NOW = datetime.now(UTC)


def test_old_price_table_gets_next_due_filled_and_indexed(empty_database, capsys):
    connection = empty_database
    connection.execute("DROP INDEX m_live.clob_price_next_due")
    connection.execute("ALTER TABLE m_live.m02_clob_price DROP COLUMN next_due")
    connection.execute(
        """INSERT INTO m_live.m01_event
        (event_id,slug,title,active,closed,archived,tags,in_current_scan,m_live_updated_at)
        VALUES ('r6-test-event','e','e',true,false,false,'[]',true,%s)""",
        (NOW,),
    )
    for name, seconds in (("fast", 5), ("slow", 60), ("retired", None)):
        market = "r6-test-" + name
        connection.execute(
            """INSERT INTO m_live.m01_market
            (market_id,event_id,sort_order,protocol_version,slug,question,active,closed,
             archived,in_current_scan,m_live_updated_at)
            VALUES (%s,'r6-test-event',0,'v1',%s,%s,true,false,false,true,%s)""",
            (market, market, market, NOW),
        )
        if seconds is not None:
            connection.execute(
                """INSERT INTO m_live.m01_demand_market (market_id,refresh_seconds,book_levels)
                VALUES (%s,%s,0)""",
                (market, seconds),
            )
        connection.execute(
            """INSERT INTO m_live.m02_clob_price
            (market_id,asset_id,best_bid,best_ask,requested_at,m_live_updated_at)
            VALUES (%s,%s,0.4,0.6,%s,%s)""",
            (market, market + "-0", NOW - timedelta(seconds=30), NOW),
        )
    assert all_setup.s01_add_next_due(connection)
    rows = dict(
        connection.execute(
            "SELECT market_id,next_due - requested_at FROM m_live.m02_clob_price"
        ).fetchall()
    )
    # Last request + the market's interval; no longer demanded: the last request itself.
    assert rows == {
        "r6-test-fast": timedelta(seconds=5),
        "r6-test-slow": timedelta(seconds=60),
        "r6-test-retired": timedelta(0),
    }
    column = connection.execute(
        """SELECT is_nullable FROM information_schema.columns
        WHERE table_schema='m_live' AND table_name='m02_clob_price' AND column_name='next_due'"""
    ).fetchone()
    assert column == ("NO",)
    assert connection.execute(
        "SELECT to_regclass('m_live.clob_price_next_due') IS NOT NULL"
    ).fetchone()[0]
    assert "SETUP_MIGRATED m_live.m02_clob_price next_due" in capsys.readouterr().out
    # Once the column exists, a rerun changes nothing.
    assert not all_setup.s01_add_next_due(connection)
