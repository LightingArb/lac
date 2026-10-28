import copy
import json
import os
import subprocess
import sys
from contextlib import nullcontext
from datetime import UTC, datetime
from pathlib import Path

import psycopg
import pytest

from m_live.src.h_settings import h_clob_inflight, h_refresh_seconds
from m_live.src.m01_market import runtime_demand as demand
from m_live.src.m01_market import runtime_gamma_full as full


def test_merge_and_failed_product(monkeypatch):
    def read(product, batch):
        if product == "weather":
            raise psycopg.OperationalError("test connection failure")
        return {
            "crypto": [("a", 12, 2), ("b", 30, None)],
            "sport": [("a", 5, 8), ("b", 10, 4)],
        }[product]

    monkeypatch.setattr(demand, "s01_read", read)
    rows, errors = demand.c01_products(["crypto", "weather", "sport"], 100)
    assert rows == {"a": (5, 8), "b": (10, None)} and errors == 1


def test_publish_defaults_requests_and_retire(monkeypatch, empty_database):
    connection = empty_database
    monkeypatch.setattr(demand, "h_connect", lambda: nullcontext(connection))
    monkeypatch.setattr(full, "h_connect", lambda **kwargs: nullcontext(connection))
    event = json.loads((Path(__file__).parent / "gamma_event.json").read_text())
    event["active"], event["closed"], event["archived"] = True, False, False
    event["updatedAt"] = "2099-01-01T00:00:00Z"
    event["tags"] = [{"id": "1", "label": "Sports", "slug": "sports"}]
    source = copy.deepcopy(event["markets"][2])
    source["active"], source["closed"], source["archived"] = True, False, False
    source["updatedAt"] = event["updatedAt"]
    now = datetime.now(UTC)
    row, outcomes = full.s02_market(source, event["id"], 2, now)
    full.c02_publish([full.s01_event(event, now)], [row], outcomes, 100, transaction_events=1)

    def published():
        return connection.execute(
            "SELECT refresh_seconds,book_levels FROM m_live.m01_demand_market WHERE market_id=%s",
            (source["id"],),
        ).fetchone()

    def tags(*slugs):
        connection.execute(
            "UPDATE m_live.m01_event SET tags=%s WHERE event_id=%s",
            (json.dumps([{"id": str(i), "slug": s} for i, s in enumerate(slugs)]), event["id"]),
        )

    demand.c02_publish({}, REFRESH)
    assert published() == (60, 0)
    # Several matching tags: the fastest one; no matching tag: default.
    tags("sports", "crypto", "politics")
    demand.c02_publish({}, REFRESH)
    assert published() == (5, 0)
    tags("politics", "weather")
    demand.c02_publish({}, REFRESH)
    assert published() == (10, 0)
    tags("politics", "default")
    demand.c02_publish({}, REFRESH | {"default": 30})
    assert published() == (30, 0)
    tags()
    demand.c02_publish({}, REFRESH)
    assert published() == (10, 0)
    # A product request replaces the category interval (the shortest among products).
    tags("crypto")
    demand.c02_publish({source["conditionId"]: (3, None)}, REFRESH)
    assert published() == (3, None)
    demand.c02_publish({source["conditionId"]: (20, 4)}, REFRESH)
    assert published() == (20, 4)
    connection.execute(
        "UPDATE m_live.m01_market SET closed=true WHERE market_id=%s", (source["id"],)
    )
    demand.c02_publish({}, REFRESH)
    assert published() is None


REFRESH = {"sports": 60, "crypto": 5, "weather": 10, "default": 10}


@pytest.mark.parametrize(
    "value",
    [
        None,
        "not json",
        "[60]",
        '{"sports": 60}',
        '{"default": 0}',
        '{"default": 10, "crypto": -5}',
        '{"default": 10, "crypto": 2.5}',
        '{"default": 10, "crypto": "5"}',
        '{"default": true}',
    ],
)
def test_bad_refresh_seconds_stop_the_service(monkeypatch, capsys, value):
    if value is None:
        monkeypatch.delenv("REFRESH_SECONDS", raising=False)
    else:
        monkeypatch.setenv("REFRESH_SECONDS", value)
    with pytest.raises(SystemExit) as caught:
        h_refresh_seconds()
    assert caught.value.code == 1
    log = json.loads(capsys.readouterr().out)
    assert log["event"] == "configuration_error" and "REFRESH_SECONDS" in log["reason"]


def test_refresh_seconds_and_clob_inflight_settings(monkeypatch):
    monkeypatch.setenv("REFRESH_SECONDS", json.dumps(REFRESH))
    assert h_refresh_seconds() == REFRESH
    monkeypatch.delenv("CLOB_INFLIGHT", raising=False)
    assert h_clob_inflight() == 32
    monkeypatch.setenv("CLOB_INFLIGHT", "16")
    assert h_clob_inflight() == 16
    for value in ("0", "-1", "many"):
        monkeypatch.setenv("CLOB_INFLIGHT", value)
        with pytest.raises(SystemExit):
            h_clob_inflight()


def test_bad_setting_stops_module_before_any_runtime_starts():
    result = subprocess.run(
        [sys.executable, "-m", "m_live.all_runtime", "--once"],
        check=False,
        env=os.environ | {"REFRESH_SECONDS": '{"sports": 60}'},
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 1
    assert '"configuration_error"' in result.stdout and "REFRESH_SECONDS" in result.stdout
    assert '"started"' not in result.stdout
