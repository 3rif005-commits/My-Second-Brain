"""Unified completion client over heterogeneous providers.

Message format (internal convention, OpenAI-flavoured):
    [{"role": "system"|"user"|"assistant", "content": str | [part, ...]}]
part:
    {"type": "text", "text": str}
    {"type": "image", "data": bytes, "mime": "image/png"}
    {"type": "video_url", "url": str}          # YouTube URL (gemini only)
    {"type": "pdf", "data": bytes}             # native PDF (gemini only)

complete(provider, messages)  → str            (sync; summaries, formula OCR)
stream(provider, messages)    → AsyncIterator[str]  (chat SSE)
"""
from __future__ import annotations

import base64
import json
from typing import AsyncIterator

import httpx

from services.ai.providers import Provider

_TIMEOUT = 300


# ── helpers ──────────────────────────────────────────────────────────────────

def _openai_url(p: Provider) -> str:
    if p.provider == "openai":
        return "https://api.openai.com/v1/chat/completions"
    base = (p.base_url or "").rstrip("/")
    return f"{base}/chat/completions"


def _to_openai_messages(messages: list[dict]) -> list[dict]:
    out = []
    for m in messages:
        content = m["content"]
        if isinstance(content, str):
            out.append({"role": m["role"], "content": content})
            continue
        parts = []
        for part in content:
            if part["type"] == "text":
                parts.append({"type": "text", "text": part["text"]})
            elif part["type"] == "image":
                b64 = base64.b64encode(part["data"]).decode()
                parts.append({"type": "image_url", "image_url": {
                    "url": f"data:{part.get('mime', 'image/png')};base64,{b64}"}})
            elif part["type"] == "text_fallback":
                parts.append({"type": "text", "text": part["text"]})
            # video_url / pdf parts are silently dropped for OpenAI-style APIs —
            # the ai.router never routes video/pdf-native jobs here.
        out.append({"role": m["role"], "content": parts})
    return out


def _to_anthropic(messages: list[dict]) -> tuple[str, list[dict]]:
    system = ""
    out = []
    for m in messages:
        if m["role"] == "system":
            system += (m["content"] if isinstance(m["content"], str) else "") + "\n"
            continue
        content = m["content"]
        if isinstance(content, str):
            out.append({"role": m["role"], "content": content})
            continue
        parts = []
        for part in content:
            if part["type"] == "text":
                parts.append({"type": "text", "text": part["text"]})
            elif part["type"] == "image":
                parts.append({"type": "image", "source": {
                    "type": "base64",
                    "media_type": part.get("mime", "image/png"),
                    "data": base64.b64encode(part["data"]).decode(),
                }})
        out.append({"role": m["role"], "content": parts})
    return system.strip(), out


_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
_ANTHROPIC_VERSION = "2023-06-01"


def _anthropic_headers(p: Provider) -> dict:
    return {"x-api-key": p.api_key, "anthropic-version": _ANTHROPIC_VERSION,
            "Content-Type": "application/json"}


def _anthropic_payload(p: Provider, messages: list[dict], max_tokens: int,
                       stream: bool) -> dict:
    system, msgs = _to_anthropic(messages)
    payload: dict = {"model": p.model, "messages": msgs, "max_tokens": max_tokens}
    if system:                       # the API rejects an empty system string
        payload["system"] = system
    if stream:
        payload["stream"] = True
    return payload


def _anthropic_error(status: int, body: bytes | str) -> RuntimeError:
    """Anthropic puts the actual cause — unknown model, bad key, overloaded —
    in the response body. `raise_for_status()` throws that away and leaves a
    bare status code, which is the least useful thing to see right after
    swapping providers."""
    text = body.decode() if isinstance(body, bytes) else body
    return RuntimeError(f"Anthropic API error {status}: {text[:300]}")


def _anthropic_text_delta(data: dict) -> str | None:
    """Text out of one SSE event, or None. Only `text_delta` payloads are
    collected — a thinking block streams as `thinking_delta` with no `text`
    key, so reasoning can never leak into the returned content the way it did
    with OpenRouter's reasoning models."""
    if data.get("type") == "error":
        raise RuntimeError(
            f"Anthropic stream error: {(data.get('error') or {}).get('message', '')}"[:300])
    if data.get("type") != "content_block_delta":
        return None
    return (data.get("delta") or {}).get("text")


def _gemini_contents(messages: list[dict]):
    """Flatten to google-genai contents; system messages prepended as text."""
    from google.genai import types as gt
    parts = []
    for m in messages:
        content = m["content"]
        if isinstance(content, str):
            parts.append(gt.Part.from_text(text=content))
            continue
        for part in content:
            if part["type"] == "text":
                parts.append(gt.Part.from_text(text=part["text"]))
            elif part["type"] == "image":
                parts.append(gt.Part.from_bytes(
                    data=part["data"], mime_type=part.get("mime", "image/png")))
            elif part["type"] == "pdf":
                parts.append(gt.Part.from_bytes(
                    data=part["data"], mime_type="application/pdf"))
            elif part["type"] == "video_url":
                parts.append(gt.Part.from_uri(
                    file_uri=part["url"], mime_type="video/*"))
    return parts


def _gemini_client(p: Provider):
    from google import genai
    return genai.Client(api_key=p.api_key)


def _local_endpoint() -> dict:
    from services.router import smart_router
    return smart_router.get_endpoint()


# ── sync completion ──────────────────────────────────────────────────────────

def complete(p: Provider, messages: list[dict], max_tokens: int = 4096) -> str:
    if p.provider == "gemini":
        client = _gemini_client(p)
        resp = client.models.generate_content(
            model=p.model, contents=_gemini_contents(messages))
        return resp.text or ""

    if p.provider == "anthropic":
        return _anthropic_complete(p, messages, max_tokens)

    if p.provider in ("openai", "openai_compatible"):
        return _openai_compatible_complete(
            _openai_url(p), {"Authorization": f"Bearer {p.api_key}",
                             "Content-Type": "application/json"},
            p.model, messages, max_tokens)

    if p.provider == "local":
        ep = _local_endpoint()
        return _openai_compatible_complete(
            ep["url"], ep["headers"], ep["model"], messages, max_tokens)

    raise RuntimeError(f"Unknown provider: {p.provider}")


def _anthropic_complete(p: Provider, messages: list[dict], max_tokens: int) -> str:
    """Goes over the wire streaming even though the caller wants one string.

    Note synthesis asks for a whole mastery guide in one call, and a
    non-streamed request that large can outrun the HTTP read timeout with
    nothing to show for it. Same reason `_openai_compatible_complete` streams.
    """
    chunks: list[str] = []
    with httpx.stream(
        "POST", _ANTHROPIC_URL,
        headers=_anthropic_headers(p),
        json=_anthropic_payload(p, messages, max_tokens, stream=True),
        timeout=_TIMEOUT,
    ) as resp:
        if resp.status_code != 200:
            raise _anthropic_error(resp.status_code, resp.read())
        for line in resp.iter_lines():
            if not line.startswith("data: "):
                continue
            try:
                data = json.loads(line[6:])
            except json.JSONDecodeError:
                continue
            text = _anthropic_text_delta(data)
            if text:
                chunks.append(text)
    return "".join(chunks)


def _openai_compatible_complete(url: str, headers: dict, model: str,
                                messages: list[dict], max_tokens: int) -> str:
    """Non-streaming callers still go over the wire with stream=True and collect
    only `delta.content` — reasoning models (e.g. Nemotron on OpenRouter) don't
    reliably separate chain-of-thought from the final answer in a single
    non-streamed `message.content` field, but DO expose it as distinct
    `reasoning`/`reasoning_content` deltas when streamed, which we simply never
    collect. Non-reasoning models are unaffected either way.

    Discarding those deltas keeps them out of the *content* we return, but the
    model still spends `max_tokens` generating them — on a long, detailed
    prompt (e.g. the mastery-guide synthesis prompt) a reasoning-heavy free
    model can burn most of the budget planning and leave only a few hundred
    tokens for the actual answer, truncating it right after the outline. For
    OpenRouter specifically, ask it to skip reasoning generation entirely
    instead of just hiding it after the fact — this is an OpenRouter-specific
    field, so only send it when we know we're talking to OpenRouter.
    """
    payload = {"model": model, "messages": _to_openai_messages(messages),
               "max_tokens": max_tokens, "stream": True}
    if "openrouter.ai" in url:
        payload["reasoning"] = {"exclude": True}

    chunks: list[str] = []
    with httpx.stream(
        "POST", url, headers=headers,
        json=payload,
        timeout=_TIMEOUT,
    ) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line.startswith("data: "):
                continue
            raw = line[6:]
            if raw == "[DONE]":
                break
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            text = (data.get("choices") or [{}])[0].get("delta", {}).get("content")
            if text:
                chunks.append(text)
    return "".join(chunks)


# ── async streaming (text deltas) ────────────────────────────────────────────

async def stream(p: Provider, messages: list[dict],
                 max_tokens: int = 2048) -> AsyncIterator[str]:
    if p.provider == "gemini":
        client = _gemini_client(p)
        # google-genai streaming is sync-iterable; wrap it
        for chunk in client.models.generate_content_stream(
                model=p.model, contents=_gemini_contents(messages)):
            if chunk.text:
                yield chunk.text
        return

    if p.provider == "anthropic":
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            async with client.stream(
                "POST", _ANTHROPIC_URL,
                headers=_anthropic_headers(p),
                json=_anthropic_payload(p, messages, max_tokens, stream=True),
            ) as resp:
                if resp.status_code != 200:
                    raise _anthropic_error(resp.status_code, await resp.aread())
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    try:
                        data = json.loads(line[6:])
                    except json.JSONDecodeError:
                        continue
                    text = _anthropic_text_delta(data)
                    if text:
                        yield text
        return

    # OpenAI-compatible (openai / openai_compatible / local)
    if p.provider == "local":
        ep = _local_endpoint()
        url, headers, model = ep["url"], ep["headers"], ep["model"]
    else:
        url = _openai_url(p)
        headers = {"Authorization": f"Bearer {p.api_key}",
                   "Content-Type": "application/json"}
        model = p.model

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        async with client.stream(
            "POST", url, headers=headers,
            json={"model": model, "messages": _to_openai_messages(messages),
                  "max_tokens": max_tokens, "stream": True},
        ) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                raise RuntimeError(f"LLM error {resp.status_code}: {body.decode()[:300]}")
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                raw = line[6:]
                if raw == "[DONE]":
                    break
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                text = (data.get("choices") or [{}])[0].get("delta", {}).get("content")
                if text:
                    yield text
