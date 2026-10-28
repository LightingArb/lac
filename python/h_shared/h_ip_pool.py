"""Per-runtime outbound IP slots, endpoint windows and bounded HTTP I/O."""

import email.utils
import ipaddress
import json
import os
import subprocess
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from decimal import Decimal
from itertools import islice
from urllib.parse import urlsplit

import requests
from requests.adapters import HTTPAdapter

from h_shared.h_log import h_log


class ProviderError(Exception):
    def __init__(self, status: int, wait: float = 0):
        super().__init__(f"Provider HTTP {status}")
        self.status, self.wait = status, wait
        self.logged = False


class ContractError(Exception):
    """External data does not satisfy the runtime's declared input contract."""


@dataclass(frozen=True)
class HttpPolicy:
    timeout: float
    retries: int
    rate_wait: float
    max_response_bytes: int


def h_outbound_ips(check_url: str, check_timeout: float) -> list[str]:
    """Read only the injected environment; never search for a dotenv file.

    Each proxy must answer check_url with HTTP 200 before any runtime starts (one GET per proxy).
    """
    try:
        value = json.loads(os.environ["OUTBOUND_IPS"])
        if not isinstance(value, list) or any(not isinstance(ip, str) for ip in value):
            raise ValueError("OUTBOUND_IPS is not a JSON array of strings")
        exits = h_validate_ips(value)
    except (KeyError, ValueError, TypeError, OSError, subprocess.SubprocessError) as error:
        # Messages from h_validate_ips name a proxy by host:port only.
        h_log("all_runtime", "configuration_error", reason=f"Invalid OUTBOUND_IPS: {error}")
        raise SystemExit(1) from None
    for proxy in (e for e in exits if h_is_proxy(e)):
        h_check_proxy(proxy, check_url, check_timeout)
    return exits


def h_validate_ips(ips: list[str]) -> list[str]:
    """Each exit is an IP on a local interface (requests bind it as source address) or an
    http://user:password@host:port proxy (requests go through it). Reject the rest before
    spawning; messages never echo an entry, so proxy credentials stay out of the log.
    """
    exits, seen = [], set()
    for entry in ips:
        if "://" in entry:
            key = h_proxy_label(entry)
        else:
            try:
                entry = key = str(ipaddress.ip_address(entry))
            except ValueError:
                raise ValueError("Outbound entry is neither an IP nor an http:// proxy") from None
        if key in seen:
            raise ValueError(f"Duplicate outbound exit {key}")
        seen.add(key)
        exits.append(entry)
    addresses = [e for e in exits if not h_is_proxy(e)]
    if addresses:
        interfaces = json.loads(subprocess.check_output(["ip", "-j", "address"], text=True))
        local = {a["local"] for interface in interfaces for a in interface["addr_info"]}
        if not set(addresses).issubset(local):
            raise ValueError("Outbound IP is not assigned to this host")
    return exits


def h_is_proxy(address: str | None) -> bool:
    return address is not None and "://" in address


def h_proxy_label(proxy: str) -> str:
    """host:port of an http:// proxy; the only part of it that logs and errors may show."""
    try:
        parts = urlsplit(proxy)
        port = parts.port
    except ValueError:
        raise ValueError("Proxy is not http://user:password@host:port") from None
    if parts.scheme != "http":
        raise ValueError("Only http:// proxies are supported")
    if not parts.hostname or port is None or parts.path not in ("", "/"):
        raise ValueError("Proxy is not http://user:password@host:port")
    if parts.query or parts.fragment:
        raise ValueError("Proxy is not http://user:password@host:port")
    host = f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname
    return f"{host}:{port}"


def h_exit_label(address: str | None) -> str:
    """How logs name an exit: default, the IP, or a proxy's host:port."""
    if address is None:
        return "default"
    return h_proxy_label(address) if h_is_proxy(address) else address


def h_check_proxy(proxy: str, url: str, timeout: float) -> None:
    """GET url once through the proxy; anything but HTTP 200 stops the service."""
    label, started = h_proxy_label(proxy), time.monotonic()
    try:
        with requests.Session() as session:
            session.trust_env = False
            session.headers["User-Agent"] = "LAC-local-demo/1.0"
            with session.get(
                url,
                proxies={"http": proxy, "https": proxy},
                timeout=timeout,
                allow_redirects=False,
                stream=True,
            ) as response:
                status, reason = response.status_code, None
    except requests.RequestException as error:
        status, reason = 0, type(error).__name__
    if status != 200:
        h_log(
            "all_runtime",
            "configuration_error",
            reason="Proxy check failed",
            proxy=label,
            url=url,
            status=status,
            error=reason,
        )
        raise SystemExit(1)
    seconds = round(time.monotonic() - started, 3)
    h_log("all_runtime", "proxy_checked", proxy=label, url=url, status=status, seconds=seconds)


class SourceAdapter(HTTPAdapter):
    def __init__(self, source: str):
        self.source = source
        super().__init__(max_retries=0)

    def init_poolmanager(self, *args, **kwargs):
        kwargs["source_address"] = (self.source, 0)
        return super().init_poolmanager(*args, **kwargs)


class IPPool:
    """Thread-safe admission; default route is unbound, extra addresses are bound, proxies relay.

    Every exit (default, local IP, proxy) has its own slots, endpoint quotas and 429 cooldowns,
    which persist across rounds in this runtime process only.
    request() performs HTTP I/O; map() bounds outstanding work by total IP slots.
    """

    def __init__(
        self,
        unit: str,
        ips: list[str],
        ip_inflight: int,
        ip_limit: dict[str, tuple[int, float]],
        policy: HttpPolicy,
    ):
        if ip_inflight < 1 or any(n < 1 or s <= 0 for n, s in ip_limit.values()):
            raise ValueError("Declare positive IP concurrency and endpoint quotas")
        if (
            policy.timeout <= 0
            or policy.retries < 0
            or policy.rate_wait <= 0
            or policy.max_response_bytes < 1
        ):
            raise ValueError("Invalid HTTP policy")
        self.unit, self.policy = unit, policy
        self.addresses = (None, *ips)
        self.ip_inflight, self.ip_limit = ip_inflight, ip_limit
        self.condition = threading.Condition()
        self.inflight = [0] * len(self.addresses)
        self.used = [{key: deque() for key in ip_limit} for _ in self.addresses]
        self.blocked = [{key: 0.0 for key in ip_limit} for _ in self.addresses]
        self.local = threading.local()
        self.sessions = []
        self.next_ip = 0
        self.reset_round()

    def reset_round(self) -> None:
        self.requests = self.success = self.no_data = self.errors = self.response_bytes = 0
        self.exit_requests = [0] * len(self.addresses)

    def requests_by_exit(self) -> dict[str, int]:
        """Requests admitted this round per exit, keyed by its log label."""
        return {h_exit_label(a): n for a, n in zip(self.addresses, self.exit_requests)}

    def report(self, *, success: int = 0, no_data: int = 0, error: int = 0) -> None:
        with self.condition:
            self.success += success
            self.no_data += no_data
            self.errors += error

    def endpoint(self, url: str) -> str:
        path = urlsplit(url).path
        # Keyset uses the matching listing quota, as explicitly assigned in round 2.
        key = path.removesuffix("/keyset") if path.endswith("/keyset") else path
        if key not in self.ip_limit:
            raise ValueError(f"Undeclared endpoint quota: {path}")
        return key

    def acquire(self, endpoint: str, rejected: set[int]) -> int:
        with self.condition:
            while True:
                now = time.monotonic()
                available = {
                    i
                    for i in range(len(self.addresses))
                    if i not in rejected and self.blocked[i][endpoint] <= now
                }
                if not available:
                    raise ProviderError(429, max(0, min(b[endpoint] for b in self.blocked) - now))
                waits = []
                for offset in range(len(self.addresses)):
                    i = (self.next_ip + offset) % len(self.addresses)
                    if self.blocked[i][endpoint] > now:
                        waits.append(self.blocked[i][endpoint] - now)
                    if i not in available:
                        continue
                    count, window = self.ip_limit[endpoint]
                    used = self.used[i][endpoint]
                    while used and used[0] <= now - window:
                        used.popleft()
                    if len(used) >= count:
                        waits.append(used[0] + window - now)
                    elif self.inflight[i] < self.ip_inflight:
                        self.inflight[i] += 1
                        used.append(now)
                        self.requests += 1
                        self.exit_requests[i] += 1
                        self.next_ip = (i + 1) % len(self.addresses)
                        return i
                self.condition.wait(min(waits) if waits else None)

    def release(self, index: int) -> None:
        with self.condition:
            self.inflight[index] -= 1
            self.condition.notify_all()

    def cooldown(self, index: int, endpoint: str, wait: float) -> None:
        with self.condition:
            self.blocked[index][endpoint] = max(
                self.blocked[index][endpoint], time.monotonic() + wait
            )
            self.condition.notify_all()

    def session(self, index: int) -> requests.Session:
        if not hasattr(self.local, "sessions"):
            self.local.sessions = {}
        if index not in self.local.sessions:
            session = requests.Session()
            session.trust_env = False
            session.headers["User-Agent"] = "LAC-local-demo/1.0"
            address = self.addresses[index]
            if h_is_proxy(address):
                session.proxies = {"http": address, "https": address}
            elif address is not None:
                adapter = SourceAdapter(address)
                session.mount("https://", adapter)
                session.mount("http://", adapter)
            self.local.sessions[index] = session
            with self.condition:
                self.sessions.append(session)
        return self.local.sessions[index]

    def retry_after(self, value: str | None) -> float:
        if value:
            try:
                wait = float(value)
                if wait >= 0 and wait < float("inf"):
                    return wait
            except ValueError:
                try:
                    return max(
                        0, email.utils.parsedate_to_datetime(value).timestamp() - time.time()
                    )
                except (ValueError, TypeError, OverflowError):
                    pass
        return self.policy.rate_wait

    def log_error(self, error: Exception, **extra) -> None:
        if getattr(error, "logged", False):
            return
        context = getattr(
            self.local, "context", {"target": "round", "provider": None, "ip": None, "status": None}
        )
        reason = (
            type(error).__name__ if isinstance(error, requests.RequestException) else str(error)
        )
        error.context = context | extra
        h_log(self.unit, "request_error", **(error.context | {"reason": reason}))
        error.logged = True

    def request(self, method: str, url: str, *, params=None, body=None, target=None):
        endpoint = self.endpoint(url)
        failures, rejected = 0, set()
        while True:
            try:
                index = self.acquire(endpoint, rejected)
            except ProviderError as error:
                self.log_error(
                    error,
                    provider=urlsplit(url).hostname,
                    endpoint=endpoint,
                    target=target or endpoint,
                    ip="all",
                    status=429,
                    wait=error.wait,
                )
                raise
            self.local.context = {
                "target": target or endpoint,
                "provider": urlsplit(url).hostname,
                "endpoint": endpoint,
                "ip": h_exit_label(self.addresses[index]),
                "status": 0,
            }
            try:
                started = time.monotonic()
                with self.session(index).request(
                    method,
                    url,
                    params=params,
                    json=body,
                    timeout=self.policy.timeout,
                    stream=True,
                    allow_redirects=False,
                ) as response:
                    self.local.context["status"] = response.status_code
                    if response.status_code == 429:
                        wait = self.retry_after(response.headers.get("Retry-After"))
                        self.cooldown(index, endpoint, wait)
                        rejected.add(index)
                        self.log_error(
                            ProviderError(429, wait), wait=wait, until=time.time() + wait
                        )
                        continue
                    if response.status_code != 200:
                        raise ProviderError(response.status_code)
                    content = bytearray()
                    for chunk in response.iter_content(chunk_size=65536):
                        if time.monotonic() - started > self.policy.timeout:
                            raise requests.Timeout()
                        content.extend(chunk)
                        if len(content) > self.policy.max_response_bytes:
                            raise ContractError("Provider response exceeds declared byte limit")
                    with self.condition:
                        self.response_bytes += len(content)
                    try:
                        return json.loads(content, parse_float=Decimal)
                    except (ValueError, UnicodeError):
                        raise ContractError("Provider response is not JSON") from None
            except (requests.RequestException, ProviderError) as error:
                self.log_error(error)
                retryable = isinstance(error, requests.RequestException) or error.status >= 500
                if not retryable or failures >= self.policy.retries:
                    if isinstance(error, ProviderError):
                        raise
                    final = ProviderError(0)
                    final.logged = True
                    raise final from None
                failures += 1
                h_log(self.unit, "request_retry", **self.local.context, attempt=failures, wait=0)
            except ContractError as error:
                self.log_error(error)
                raise
            finally:
                self.release(index)

    def map(self, function, items):
        from concurrent.futures import FIRST_COMPLETED, wait

        workers = len(self.addresses) * self.ip_inflight
        iterator = iter(items)

        def call(item):
            try:
                return function(item)
            except ContractError as error:
                self.log_error(error)
                raise

        with ThreadPoolExecutor(max_workers=workers) as executor:
            pending = {executor.submit(call, item) for item in islice(iterator, workers)}
            try:
                while pending:
                    done, _ = wait(pending, return_when=FIRST_COMPLETED)
                    for future in done:
                        pending.remove(future)
                        result = future.result()
                        for item in islice(iterator, 1):
                            pending.add(executor.submit(call, item))
                        yield result
            finally:
                for future in pending:
                    future.cancel()

    def close(self) -> None:
        for session in self.sessions:
            session.close()
        self.sessions.clear()
        self.local = threading.local()
