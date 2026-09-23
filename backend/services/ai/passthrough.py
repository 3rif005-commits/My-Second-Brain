"""Forward an OpenAI-shaped request to a provider, unchanged, and log it.

Some callers cannot use the gateway's own event shape: BlockNote's xl-ai client
parses the upstream bytes itself, and the Vercel AI SDK expects to talk to an
OpenAI-compatible endpoint. Re-encoding for them would mean owning a wire
contract only a browser can verify.

So the bytes pass through untouched and the stream is teed on the way past: one
run row, the usage the upstream reported, and the budget charged. That is the
whole difference between "a surface we cannot see" and "a surface we do not
rewrite".

Providers whose dialect is not OpenAI's are refused here rather than
mistranslated — the caller gets a reason it can show.
"""
from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from core.config import settings
from services.ai import budget as budget_guard
from services.ai import usage as usage_log
from services.ai.providers import Provider
from services.ai.router import candidates

OPENAI_DIALECT = {"openai", "openai_compatible", "local"}
_TIMEOUT = 120


def pick_openai_provider(user_id: str = "") -> Provider:
    """The first provider in the chain that speaks OpenAI's wire format.

    Raises with the ones it skipped and why, because "no key" and "wrong
    dialect" need different fixes from whoever reads the error.
    """
    skipped: list[str] = []
    for p in candidates("chat", user_id):
        if p.provider not in OPENAI_DIALECT:
            skipped.append(f"{p.label or p.provider} (not an OpenAI-compatible API)")
            continue
        if p.provider != "local" and not p.api_key:
            skipped.append(f"{p.label or p.provider} (no API key)")
            continue
        return p
    raise RuntimeError("No OpenAI-compatible provider is configured — "
                       + ("; ".join(skipped) if skipped else "none configured"))


def endpoint_for(p: Provider) -> tuple[str, dict, str]:
    if p.provider == "local":
        from services.ai.client import _local_endpoint
        ep = _local_endpoint()
        return ep["url"], ep["headers"], ep["model"]
    url = ("https://api.openai.com/v1/chat/completions" if p.provider == "openai"
           else f"{(p.base_url or '').rstrip('/')}/chat/completions")
    return url, {"Authorization": f"Bearer {p.api_key}",
                 "Content-Type": "application/json"}, p.model


def read_usage(chunk: bytes) -> None:
    """Pull usage off a chunk on its way to the client, without altering it."""
    for line in chunk.split(b"\n"):
        if not line.startswith(b"data: ") or line == b"data: [DONE]":
            continue
        try:
            usage_log.report_openai_usage(json.loads(line[6:]))
        except Exception:                       # noqa: BLE001 — a partial frame
            continue


async def stream_passthrough(provider: Provider, payload: dict, *, surface: str,
                             job: str, user_id: str | None = None,
                             note_id: str | None = None,
                             model: str | None = None) -> AsyncIterator[bytes]:
    """Forward `payload` and yield the upstream's bytes verbatim.

    An error response is converted into one SSE `error` event, because a client
    that receives nothing at all shows the user nothing at all.
    """
    url, headers, default_model = endpoint_for(provider)
    body = {**payload, "model": model or default_model, "stream": True}
    request_chars = len(json.dumps(body, default=str))
    forwarded = 0

    with usage_log.annotate(surface=surface, job=job, trigger="user",
                            user_id=user_id, note_id=note_id), \
         budget_guard.limit(settings.max_usd_per_run or None), \
         usage_log.track(provider.provider, body["model"],
                         estimate_chars=(request_chars, 0)) as spend:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            async with client.stream("POST", url, headers=headers, json=body) as resp:
                if resp.status_code != 200:
                    raw = await resp.aread()
                    message = _error_message(raw, resp.status_code)
                    yield (f"data: {json.dumps({'type': 'error', 'content': message})}"
                           "\n\n").encode()
                    raise RuntimeError(message)
                async for chunk in resp.aiter_bytes():
                    forwarded += len(chunk)
                    read_usage(chunk)
                    yield chunk

        if not spend.reported:
            spend.set_estimate(usage_log.tokens_from_chars(request_chars),
                               usage_log.tokens_from_chars(forwarded))


def _error_message(raw: bytes, status: int) -> str:
    try:
        detail = json.loads(raw).get("error", {})
        text = detail.get("message") if isinstance(detail, dict) else str(detail)
    except Exception:                           # noqa: BLE001
        text = raw.decode(errors="replace")
    return f"AI provider error ({status}): {str(text)[:300]}"
