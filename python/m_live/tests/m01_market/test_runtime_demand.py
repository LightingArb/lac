import copy
import json
from contextlib import nullcontext
from datetime import UTC, datetime
from pathlib import Path

import psycopg

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
    monkeypatch.setattr(full, "h_connect", lambda: nullcontext(connection))
    event = json.loads((Path(__file__).parent / "gamma_event.json").read_text())
    event["active"], event["closed"], event["archived"] = True, False, False
    event["updatedAt"] = "2099-01-01T00:00:00Z"
    event["tags"] = [{"id": "1", "label": "Sports", "slug": "sports"}]
    source = copy.deepcopy(event["markets"][2])
    source["active"], source["closed"], source["archived"] = True, False, False
    source["updatedAt"] = event["updatedAt"]
    now = datetime.now(UTC)
    row, outcomes = full.s02_market(source, event["id"], 2, now)
    full.c02_publish([full.s01_event(event, now)], [row], outcomes, 100)

    def published():
        return connection.execute(
            "SELECT refresh_seconds,book_levels FROM m_live.m01_demand_market WHERE market_id=%s",
            (source["id"],),
        ).fetchone()

    demand.c02_publish({}, 60, 10)
    assert published() == (60, 0)
    connection.execute("UPDATE m_live.m01_event SET tags='[]' WHERE event_id=%s", (event["id"],))
    demand.c02_publish({}, 60, 10)
    assert published() == (10, 0)
    demand.c02_publish({source["conditionId"]: (3, None)}, 60, 10)
    assert published() == (3, None)
    connection.execute(
        "UPDATE m_live.m01_market SET closed=true WHERE market_id=%s", (source["id"],)
    )
    demand.c02_publish({}, 60, 10)
    assert published() is None
