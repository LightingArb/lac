"""One JSON record per stdout line; no file or database log sink."""

import json
from datetime import UTC, datetime


def h_log(unit: str, event: str, **values) -> None:
    print(
        json.dumps(
            {"ts": datetime.now(UTC).isoformat(), "unit": unit, "event": event, **values},
            ensure_ascii=False,
            default=str,
        ),
        flush=True,
    )
