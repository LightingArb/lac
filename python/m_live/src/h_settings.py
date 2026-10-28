"""REFRESH_SECONDS and CLOB_INFLIGHT from the injected environment; a bad value stops the service."""

import json
import os

from h_shared.h_log import h_log


def h_refresh_seconds() -> dict[str, int]:
    """Refresh interval per event tag slug, plus "default" for markets carrying none of them.

    Example: {"sports": 60, "crypto": 5, "weather": 10, "default": 10}. runtime_demand gives a market
    the fastest interval among its tags; a product's own demand still replaces it.
    """
    try:
        value = json.loads(os.environ["REFRESH_SECONDS"])
        if not isinstance(value, dict) or "default" not in value:
            raise ValueError('needs a JSON object with "default"')
        if any(type(seconds) is not int or seconds <= 0 for seconds in value.values()):
            raise ValueError("values must be positive whole seconds")
        return value
    except (KeyError, ValueError) as error:
        h_log("all_runtime", "configuration_error", reason=f"Invalid REFRESH_SECONDS: {error}")
        raise SystemExit(1) from None


def h_clob_inflight() -> int:
    """Requests in flight per exit for CLOB /prices; 32 when not set."""
    try:
        value = int(os.environ.get("CLOB_INFLIGHT", "32"))
        if value < 1:
            raise ValueError("must be a positive whole number")
        return value
    except ValueError as error:
        h_log("all_runtime", "configuration_error", reason=f"Invalid CLOB_INFLIGHT: {error}")
        raise SystemExit(1) from None
