"""A provider's batch API, behind one small interface.

A batch is the same request sent to be answered later — usually within the
hour, at most 24 h — for half the price. Only Anthropic's Message Batches is
implemented; a provider says it has one with the `batch` capability, and
`adapter_for` is the only place that maps a provider to code.

Nothing here decides anything about jobs. It sends, polls, collects and
cancels, and reports what the provider said in plain data.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

import httpx

from services.ai.client import _anthropic_headers, _anthropic_payload
from services.ai.providers import Provider

logger = logging.getLogger(__name__)

API = "https://api.anthropic.com/v1/messages/batches"
TIMEOUT = 60.0
#: batches are priced at half of the live rate, input and output alike
DISCOUNT = 0.5


@dataclass
class Status:
    """`ended` means results can be read; `in_progress` includes `canceling`."""
    state: str                                  # in_progress | ended
    created_at: str | None = None
    counts: dict = field(default_factory=dict)


@dataclass
class Outcome:
    """One request's result. `kind` is succeeded | errored | canceled | expired."""
    kind: str
    text: str = ""
    stop_reason: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    error: str | None = None


class BatchError(RuntimeError):
    """The provider refused or failed the batch call itself (not a request in it)."""


def _check(resp: httpx.Response) -> dict:
    if resp.status_code >= 400:
        raise BatchError(f"Anthropic batch API error {resp.status_code}: {resp.text[:300]}")
    return resp.json()


def parse_results(jsonl: str) -> dict[str, Outcome]:
    """custom_id → Outcome, from a results file (one JSON object per line)."""
    out: dict[str, Outcome] = {}
    for line in jsonl.splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        result = item.get("result") or {}
        kind = result.get("type", "errored")
        if kind == "succeeded":
            msg = result.get("message") or {}
            usage = msg.get("usage") or {}
            text = "".join(b.get("text", "") for b in msg.get("content") or []
                           if b.get("type") == "text")
            out[item.get("custom_id", "")] = Outcome(
                "succeeded", text=text, stop_reason=msg.get("stop_reason"),
                input_tokens=usage.get("input_tokens") or 0,
                output_tokens=usage.get("output_tokens") or 0,
                cache_read_tokens=usage.get("cache_read_input_tokens") or 0,
                cache_write_tokens=usage.get("cache_creation_input_tokens") or 0)
        elif kind == "errored":
            err = (result.get("error") or {}).get("error") or result.get("error") or {}
            message = err.get("message") if isinstance(err, dict) else str(err)
            out[item.get("custom_id", "")] = Outcome("errored", error=(message or "the provider reported an error")[:300])
        else:
            out[item.get("custom_id", "")] = Outcome(kind)
    return out


class AnthropicBatches:
    def submit(self, p: Provider, custom_id: str, messages: list[dict], max_tokens: int) -> str:
        """Send one request as its own batch; returns the batch id."""
        params = _anthropic_payload(p, messages, max_tokens, stream=False)
        body = {"requests": [{"custom_id": custom_id, "params": params}]}
        return _check(httpx.post(API, headers=_anthropic_headers(p), json=body, timeout=TIMEOUT))["id"]

    def poll(self, p: Provider, batch_id: str) -> Status:
        data = _check(httpx.get(f"{API}/{batch_id}", headers=_anthropic_headers(p), timeout=TIMEOUT))
        ended = data.get("processing_status") == "ended"
        return Status("ended" if ended else "in_progress", data.get("created_at"),
                      data.get("request_counts") or {})

    def collect(self, p: Provider, batch_id: str) -> dict[str, Outcome]:
        resp = httpx.get(f"{API}/{batch_id}/results", headers=_anthropic_headers(p), timeout=TIMEOUT)
        if resp.status_code >= 400:
            raise BatchError(f"Anthropic batch results error {resp.status_code}: {resp.text[:300]}")
        return parse_results(resp.text)

    def cancel(self, p: Provider, batch_id: str) -> None:
        _check(httpx.post(f"{API}/{batch_id}/cancel", headers=_anthropic_headers(p), timeout=TIMEOUT))

    def recent(self, p: Provider, limit: int = 30) -> list[dict]:
        """The account's latest batches, newest first — used only to find one
        whose id was never stored (the process died between send and save)."""
        return _check(httpx.get(f"{API}?limit={limit}", headers=_anthropic_headers(p),
                                timeout=TIMEOUT)).get("data") or []


_ADAPTERS = {"anthropic": AnthropicBatches()}


def adapter_for(p: Provider | None):
    """The batch adapter for this provider, or None when it has no batch API."""
    if p is None or "batch" not in p.capabilities:
        return None
    return _ADAPTERS.get(p.provider)
