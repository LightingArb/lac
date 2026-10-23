from decimal import Decimal

import pytest

from h_shared.h_process import ContractError
from m_live.src.m02_clob.runtime_clob import s01_fetch


class HttpFixture:
    def __init__(self, response):
        self.response = response

    def request(self, *args, **kwargs):
        return self.response


def test_observed_book_sides_and_absent_tokens():
    # round1 probes/side_check.json and sentinel_check.json are the provenance.
    rows, count = s01_fetch(
        HttpFixture({"a": {"BUY": "0.61", "SELL": "0.65"}}), "prices", ["a", "missing"]
    )
    assert rows[0][1:3] == (Decimal("0.61"), Decimal("0.65"))
    assert rows[1][1:3] == (None, None)
    assert count == 1
    rows, _ = s01_fetch(HttpFixture({"a": {"BUY": "0", "SELL": "1"}}), "prices", ["a"])
    assert rows[0][1:3] == (None, None)


def test_invalid_price_not_published():
    with pytest.raises(ContractError):
        s01_fetch(HttpFixture({"a": "1.5"}), "midpoints", ["a"])
