import json
from pathlib import Path

import pytest

from h_shared.h_process import ContractError
from m_historical.src.m01_polymarket.runtime_polymarket import s01_points


def test_real_history_preserves_terminal_and_gaps():
    response = json.loads((Path(__file__).parent / "history.json").read_text())
    points, cursor = s01_points(response, 1792317480, 1792576680)
    assert len(points) == 4300
    assert cursor is None
    assert points[max(points)][2] == 0
    assert any(b - a > 60 for a, b in zip(sorted(points), sorted(points)[1:]))


def test_bad_resolution_fails_closed():
    response = {
        "data": [{"timestamp": 120, "price": 0.5, "resolution_seconds": 300}],
        "pagination": {"next_cursor": None, "has_more": False},
    }
    with pytest.raises(ContractError):
        s01_points(response, 0, 200)


def test_same_minute_keeps_latest_tick_without_filling():
    response = {
        "data": [
            {"timestamp": 120, "price": 0.3, "resolution_seconds": 60},
            {"timestamp": 139, "price": 0.4, "resolution_seconds": 0},
        ],
        "pagination": {"next_cursor": None, "has_more": False},
    }
    points, _ = s01_points(response, 0, 200)
    assert list(points) == [120]
    assert points[120][0] == 139
