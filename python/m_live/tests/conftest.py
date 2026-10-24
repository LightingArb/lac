"""Use the existing local tables, empty only inside a rolled-back transaction."""

import pytest

from h_shared.h_db import h_connect


@pytest.fixture
def empty_database():
    with h_connect() as connection, connection.transaction(force_rollback=True):
        # No QA database/schema, no backup and no committed removal of local data.
        # Include the declared historical FK table; every removal is rolled back.
        connection.execute("""
            TRUNCATE m_historical.m01_price_day, m_live.m03_clob_book, m_live.m02_clob_price, m_live.m01_demand_market,
                m_live.m01_outcome, m_live.m01_market, m_live.m01_event
        """)
        yield connection
