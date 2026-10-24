"""Use the existing local tables, empty only inside a rolled-back transaction."""

import pytest

from h_shared.h_db import h_connect


@pytest.fixture
def empty_database():
    with h_connect() as connection, connection.transaction(force_rollback=True):
        # No QA database/schema, no backup and no committed removal of local data.
        # All FK-related m_live tables are listed; m_historical is untouched.
        connection.execute("""
            TRUNCATE m_live.m02_clob_price, m_live.m01_demand_market,
                m_live.m01_outcome, m_live.m01_market, m_live.m01_event
        """)
        yield connection
