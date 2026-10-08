"""HTTP transport: auth header, pinned version, token bucket, retry policy.

Frozen core of the adapter (ROBUSTNESS §1). Retry rules (DESIGN §6.3):
  * 429  -> sleep Retry-After, then retry. Safe for every verb: a 429 request
    was not processed.
  * 5xx / timeout / dropped connection:
      - reads (GET, query POSTs) and idempotent writes (PATCH page/block
        properties, DELETE) -> backoff and retry
      - a CREATE (POST that makes something) or an APPEND -> NEVER retried.
        Raises AmbiguousWrite; the engine reconciles first.
"""
from __future__ import annotations

import random
import threading
import time
from typing import Callable

import httpx

from .errors import AmbiguousWrite, NotionError
from .limits import (MAX_ATTEMPTS, RATE_BURST, RATE_PER_SECOND, REQUEST_TIMEOUT_S)
from .version import API_BASE, NOTION_VERSION


class TokenBucket:
    def __init__(self, rate: float = RATE_PER_SECOND, burst: int = RATE_BURST,
                 clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep):
        self.rate, self.burst = rate, burst
        self._clock, self._sleep = clock, sleep
        self._tokens = float(burst)
        self._at = clock()
        self._lock = threading.Lock()

    def take(self) -> None:
        with self._lock:
            now = self._clock()
            self._tokens = min(self.burst, self._tokens + (now - self._at) * self.rate)
            self._at = now
            if self._tokens < 1:
                wait = (1 - self._tokens) / self.rate
                self._sleep(wait)
                self._at = self._clock()
                self._tokens = 0.0
            else:
                self._tokens -= 1


class NotionClient:
    def __init__(self, token: str, *, transport: httpx.BaseTransport | None = None,
                 bucket: TokenBucket | None = None,
                 sleep: Callable[[float], None] = time.sleep,
                 base_url: str = API_BASE):
        self._http = httpx.Client(
            base_url=base_url, timeout=REQUEST_TIMEOUT_S, transport=transport,
            headers={"Authorization": f"Bearer {token}", "Notion-Version": NOTION_VERSION})
        self._bucket = bucket or TokenBucket(sleep=sleep)
        self._sleep = sleep
        self.requests = 0
        self.write_requests = 0

    def close(self) -> None:
        self._http.close()

    # -- one call ------------------------------------------------------------
    def request(self, method: str, path: str, *, json: dict | None = None,
                params: dict | None = None, read: bool | None = None,
                create: bool = False, files: dict | None = None, idempotent: bool = False) -> dict:
        """`read=True` marks a POST that only reads (search, query).
        `create=True` marks any write that is unsafe to repeat after an
        unknown outcome (POST create, PATCH append)."""
        method = method.upper()
        is_read = (method == "GET") if read is None else read
        retry_unknown = is_read or idempotent or (not create and method in ("PATCH", "DELETE"))
        last: Exception | None = None
        for attempt in range(MAX_ATTEMPTS):
            self._bucket.take()
            self.requests += 1
            if not is_read:
                self.write_requests += 1
            try:
                r = self._http.request(method, path, json=json, params=params, files=files)
            except (httpx.TimeoutException, httpx.TransportError) as e:
                last = e
                if not retry_unknown:
                    raise AmbiguousWrite(f"{method} {path.split('?')[0]}", type(e).__name__) from e
                self._sleep(self._backoff(attempt))
                continue
            if r.status_code == 429:
                wait = self._retry_after(r)
                last = NotionError(429, "rate_limited", "", wait)
                self._sleep(wait if wait is not None else self._backoff(attempt))
                continue
            if r.status_code >= 500:
                last = NotionError(r.status_code, self._code(r), "")
                if not retry_unknown:
                    raise AmbiguousWrite(f"{method} {path.split('?')[0]}", f"HTTP {r.status_code}")
                self._sleep(self._backoff(attempt))
                continue
            if r.status_code >= 400:
                body = self._body(r)
                raise NotionError(r.status_code, body.get("code", "error"), body.get("message", ""))
            return self._body(r)
        if isinstance(last, NotionError):
            raise last
        raise NotionError(599, "unreachable", str(last))

    # -- helpers -------------------------------------------------------------
    @staticmethod
    def _body(r: httpx.Response) -> dict:
        try:
            b = r.json()
            return b if isinstance(b, dict) else {}
        except Exception:
            return {}

    @classmethod
    def _code(cls, r: httpx.Response) -> str:
        return cls._body(r).get("code", "error")

    @staticmethod
    def _retry_after(r: httpx.Response) -> float | None:
        try:
            return float(r.headers.get("Retry-After"))
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _backoff(attempt: int) -> float:
        return min(30.0, 2 ** attempt) * (0.5 + random.random() / 2)

    # -- verbs ---------------------------------------------------------------
    def get(self, path: str, **kw) -> dict:
        return self.request("GET", path, **kw)

    def post(self, path: str, json: dict, **kw) -> dict:
        return self.request("POST", path, json=json, **kw)

    def patch(self, path: str, json: dict, **kw) -> dict:
        return self.request("PATCH", path, json=json, **kw)

    def delete(self, path: str, **kw) -> dict:
        return self.request("DELETE", path, **kw)
