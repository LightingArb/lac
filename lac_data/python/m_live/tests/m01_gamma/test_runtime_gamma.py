import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from h_shared.h_process import ContractError
from m_live.src.m01_gamma.runtime_gamma import s01_event, s02_market


def test_real_gamma_ids_and_closed_children():
    event = json.loads((Path(__file__).parent / "gamma_event.json").read_text())
    observed = datetime.now(UTC)
    row = s01_event(event, observed)
    market, outcomes = s02_market(event["markets"][2], row[0], 2, observed)
    assert row[0] == "16183"
    assert market[0] == "3886788"
    assert [o[2] for o in outcomes] == ["Yes", "No"]
    assert (
        outcomes[0][5]
        == "60254242186181201116068695532944273957016007314867422632945541198596993319740"
    )
    assert event["markets"][0]["closed"] is True


def test_misaligned_external_array_is_rejected():
    event = json.loads((Path(__file__).parent / "gamma_event.json").read_text())
    market = event["markets"][2]
    market["clobTokenIds"] = '["one"]'
    with pytest.raises(ContractError, match="length mismatch"):
        s02_market(market, event["id"], 0, datetime.now(UTC))
