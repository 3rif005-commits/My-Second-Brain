"""One agent turn, in whatever dialect the provider speaks.

The engine thinks in OpenAI's shape — assistant messages carrying `tool_calls`,
`tool` messages carrying results — because that is what it was written against
and what every OpenAI-compatible gateway accepts. Anthropic's Messages API uses
a different shape entirely: `tool_use` blocks inside assistant content, and
`tool_result` blocks inside the *user* turn.

This module is the translation, so the engine keeps one history format and
Claude can still drive the loop. It yields provider-agnostic events:

    {"type": "text", "content": "..."}
    {"type": "tool_call", "id": "...", "name": "...", "arguments": "{json}"}

`arguments` stays a JSON *string*, matching what the OpenAI stream delivers, so
the caller's existing parse-and-report-errors path is unchanged.

Usage is reported to the run log from here, because both dialects carry it in
their own place and neither caller should have to know where.
"""
from __future__ import annotations

import json
import re
from typing import Any, AsyncIterator

import httpx

from services.ai import usage as usage_log
from services.ai.client import (
    _ANTHROPIC_URL, _ANTHROPIC_VERSION, _anthropic_error, _local_endpoint,
    _openai_url, _raise_stream_error, _to_anthropic, _to_openai_messages,
)
from services.ai.providers import Provider
from services import privacy

_TIMEOUT = 300

ANTHROPIC_DIALECT = {"anthropic"}


# ── request shaping ──────────────────────────────────────────────────────────

_WIRE_UNSAFE = re.compile(r"[^a-zA-Z0-9_-]")


def anthropic_tool_names(names: list[str]) -> dict[str, str]:
    """Our name → the name Claude is shown.

    Anthropic only accepts `^[a-zA-Z0-9_-]{1,128}$`, and every tool this app
    has is dotted (`brain.search_brain`, `mcp.<server>.<tool>`, `skill.load`).
    Sent as-is, the API refuses the whole request, so no tool-using turn ever
    reached Claude. The mapping is per request and made unique, because two
    names can collapse to one wire form (`a.b` and `a_b`).
    """
    out: dict[str, str] = {}
    taken: set[str] = set()
    for name in names:
        if name in out:
            continue
        base = _WIRE_UNSAFE.sub("_", name)[:120] or "tool"
        wire, n = base, 2
        while wire in taken:
            wire, n = f"{base}_{n}", n + 1
        out[name] = wire
        taken.add(wire)
    return out


def _tool_name(t: dict) -> str:
    return t.get("function", t)["name"]


_EMPTY_SCHEMA = {"type": "object", "properties": {}}


def _tool_schema(fn: dict) -> dict:
    """The tool's argument schema, whichever key it was declared under.

    Brain and MCP tools are declared Anthropic-style (`input_schema`),
    `skill.load` OpenAI-style (`parameters`). Reading only one key sent every
    brain tool to the model with NO arguments, and the model guessed —
    `search_brain({})`, `get_note({"note_id": ...})`.
    """
    return fn.get("parameters") or fn.get("input_schema") or _EMPTY_SCHEMA


def _openai_tool(t: dict) -> dict:
    fn = t.get("function", t)
    return {"type": "function",
            "function": {"name": fn["name"],
                         "description": fn.get("description", ""),
                         "parameters": _tool_schema(fn)}}


def tools_to_anthropic(tools: list[dict],
                       names: dict[str, str] | None = None) -> list[dict]:
    """OpenAI `parameters` is Anthropic's `input_schema`; names go through the
    wire mapping; the rest matches."""
    names = names if names is not None else anthropic_tool_names(
        [_tool_name(t) for t in tools or []])
    out = []
    for t in tools or []:
        fn = t.get("function", t)
        out.append({
            "name": names.get(fn["name"], fn["name"]),
            "description": fn.get("description", ""),
            "input_schema": _tool_schema(fn),
        })
    return out


def history_to_anthropic(messages: list[dict],
                         names: dict[str, str] | None = None
                         ) -> tuple[str, list[dict]]:
    """OpenAI-shaped history → (system, Anthropic messages).

    Two rules that are easy to get wrong and fail loudly at the API:
      - an assistant turn's tool calls become `tool_use` blocks in that
        assistant message, not a separate message;
      - every `tool` reply becomes a `tool_result` block in a USER message, and
        consecutive replies merge into one user turn — Anthropic rejects a
        conversation where an assistant turn follows an assistant turn.
    """
    system_parts: list[str] = []
    out: list[dict] = []

    for m in messages:
        role = m.get("role")

        if role == "system":
            content = m.get("content")
            if isinstance(content, str):
                system_parts.append(content)
            continue

        if role == "tool":
            block = {"type": "tool_result",
                     "tool_use_id": m.get("tool_call_id"),
                     "content": m.get("content") or ""}
            if out and out[-1]["role"] == "user" and isinstance(out[-1]["content"], list) \
                    and out[-1]["content"] and out[-1]["content"][0].get("type") == "tool_result":
                out[-1]["content"].append(block)
            else:
                out.append({"role": "user", "content": [block]})
            continue

        if role == "assistant" and m.get("tool_calls"):
            blocks: list[dict] = []
            text = m.get("content")
            if isinstance(text, str) and text.strip():
                blocks.append({"type": "text", "text": text})
            for call in m["tool_calls"]:
                fn = call.get("function", {})
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                name = fn.get("name") or ""
                if names is not None:
                    # a replayed call must use the name Claude was shown
                    name = names.get(name) or _WIRE_UNSAFE.sub("_", name)
                blocks.append({"type": "tool_use", "id": call.get("id"),
                               "name": name, "input": args})
            out.append({"role": "assistant", "content": blocks})
            continue

        # Anything else goes through the plain converter, which also knows
        # about image parts.
        sub_system, converted = _to_anthropic([m])
        if sub_system:
            system_parts.append(sub_system)
        # An assistant turn with empty content is not sendable; drop it rather
        # than have the API reject the whole request.
        out.extend(c for c in converted
                   if c.get("content") not in ("", [], None))

    return "\n".join(p for p in system_parts if p).strip(), out


# ── prompt caching (E3b) ─────────────────────────────────────────────────────
#
# Every provider reuses the unchanged START of a request. OpenAI, DeepSeek,
# Gemini and llama.cpp do it on their own; Anthropic (and Anthropic/Gemini
# models behind OpenRouter) only where a block is marked. Two marks: the end
# of the system prompt (the same for every message and every user) and the
# end of the latest message (so the next tool round, or the next message,
# reads the whole conversation back). A mark on a prefix under the model's
# minimum (512-4096 tokens) is ignored by the API: no error, no charge.

_EPHEMERAL = {"type": "ephemeral"}


def _cache_on() -> bool:
    from core.config import settings
    return bool(getattr(settings, "agent_prompt_cache", True))


def _mark_last_block(message: dict) -> dict:
    content = message.get("content")
    if isinstance(content, str):
        if not content:
            return message
        return {**message, "content": [{"type": "text", "text": content,
                                        "cache_control": _EPHEMERAL}]}
    if isinstance(content, list) and content:
        blocks = [dict(b) for b in content]
        blocks[-1]["cache_control"] = _EPHEMERAL
        return {**message, "content": blocks}
    return message


#: Where the engine attached this message's retrieved context (engine.py).
_TURN_CONTEXT = "\n\n<turn_context>"


def _split_question(message: dict) -> dict | None:
    """The latest question as two blocks — its own text, then the attached
    context — or None if it carries no context. The next message replays the
    question WITHOUT the context, so a cache entry is only reusable if it ends
    at the question, not after the context."""
    content = message.get("content")
    if not isinstance(content, str) or _TURN_CONTEXT not in content:
        return None
    question, _, context = content.partition(_TURN_CONTEXT)
    return {**message, "content": [
        {"type": "text", "text": question, "cache_control": _EPHEMERAL},
        {"type": "text", "text": _TURN_CONTEXT.lstrip("\n") + context}]}


def _mark_conversation(msgs: list[dict]) -> list[dict]:
    """Mark the end of the latest question (reused by the next message) and,
    during tool rounds, the newest block (reused by the next round)."""
    out = list(msgs)
    last_user = next((i for i in range(len(out) - 1, -1, -1)
                      if out[i].get("role") == "user"
                      and isinstance(out[i].get("content"), str)), None)
    split = _split_question(out[last_user]) if last_user is not None else None
    if split is not None:
        out[last_user] = split
    elif last_user is not None:
        out[last_user] = _mark_last_block(out[last_user])
    if out and (last_user is None or last_user != len(out) - 1):
        out[-1] = _mark_last_block(out[-1])
    return out


def anthropic_cache_marks(system: str, msgs: list[dict]) -> tuple[list | str, list[dict]]:
    """(system, messages) with the cache marks, Anthropic-shaped: the end of
    the system prompt, the end of the latest question, and in a tool round the
    newest tool result. At most three of the API's four."""
    marked_system: list | str = system
    if system:
        marked_system = [{"type": "text", "text": system, "cache_control": _EPHEMERAL}]
    return marked_system, _mark_conversation(msgs) if msgs else msgs


#: OpenRouter forwards `cache_control` on content parts to these families and
#: caches the rest automatically, like OpenAI does.
_OPENROUTER_MARKED = ("anthropic/", "google/")


def openrouter_cache_marks(model: str, msgs: list[dict]) -> list[dict]:
    """The system prompt and the latest question, as for Anthropic. A `tool`
    reply stays a plain string: the OpenAI shape has no parts there."""
    if not model.startswith(_OPENROUTER_MARKED):
        return msgs
    out = list(msgs)
    if out and out[0].get("role") == "system":
        out[0] = _mark_last_block(out[0])
    last_user = next((i for i in range(len(out) - 1, 0, -1)
                      if out[i].get("role") == "user"
                      and isinstance(out[i].get("content"), str)), None)
    if last_user is not None:
        out[last_user] = _split_question(out[last_user]) or _mark_last_block(out[last_user])
    return out


# ── streaming ────────────────────────────────────────────────────────────────

async def _stream_anthropic(client: httpx.AsyncClient, p: Provider,
                            messages: list[dict], tools: list[dict],
                            max_tokens: int) -> AsyncIterator[dict[str, Any]]:
    names = anthropic_tool_names([_tool_name(t) for t in tools])
    back = {wire: ours for ours, wire in names.items()}
    system, msgs = history_to_anthropic(messages, names)
    if _cache_on():
        system, msgs = anthropic_cache_marks(system, msgs)
    payload: dict[str, Any] = {"model": p.model, "messages": msgs,
                               "max_tokens": max_tokens, "stream": True}
    if system:
        payload["system"] = system
    if tools:
        payload["tools"] = tools_to_anthropic(tools, names)

    # tool_use arguments arrive as partial JSON fragments keyed by block index
    open_blocks: dict[int, dict] = {}

    async with client.stream(
        "POST", _ANTHROPIC_URL,
        headers={"x-api-key": p.api_key, "anthropic-version": _ANTHROPIC_VERSION,
                 "Content-Type": "application/json"},
        json=payload,
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

            kind = data.get("type")

            if kind == "error":
                raise RuntimeError(
                    f"Anthropic stream error: "
                    f"{(data.get('error') or {}).get('message', '')}"[:300])

            if kind == "message_start":
                u = ((data.get("message") or {}).get("usage") or {})
                usage_log.report(
                    input_tokens=u.get("input_tokens") or 0,
                    cache_read_tokens=u.get("cache_read_input_tokens") or 0,
                    cache_write_tokens=u.get("cache_creation_input_tokens") or 0,
                    output_tokens=u.get("output_tokens") or 0)

            elif kind == "message_delta":
                usage_log.report(
                    output_tokens=(data.get("usage") or {}).get("output_tokens") or 0)

            elif kind == "content_block_start":
                block = data.get("content_block") or {}
                if block.get("type") == "tool_use":
                    open_blocks[data.get("index", 0)] = {
                        "id": block.get("id"),
                        # the engine dispatches on OUR name, never the wire one
                        "name": back.get(block.get("name"), block.get("name")),
                        "args": ""}

            elif kind == "content_block_delta":
                delta = data.get("delta") or {}
                if delta.get("type") == "text_delta" and delta.get("text"):
                    yield {"type": "text", "content": delta["text"]}
                elif delta.get("type") == "input_json_delta":
                    slot = open_blocks.get(data.get("index", 0))
                    if slot is not None:
                        slot["args"] += delta.get("partial_json") or ""

            elif kind == "content_block_stop":
                slot = open_blocks.pop(data.get("index", 0), None)
                if slot is not None:
                    yield {"type": "tool_call", "id": slot["id"],
                           "name": slot["name"],
                           "arguments": slot["args"] or "{}"}


async def _stream_openai(client: httpx.AsyncClient, url: str, headers: dict,
                         model: str, messages: list[dict], tools: list[dict],
                         max_tokens: int) -> AsyncIterator[dict[str, Any]]:
    history = _openai_history(messages)
    if "openrouter.ai" in url and _cache_on():
        history = openrouter_cache_marks(model, history)
    payload: dict[str, Any] = {"model": model, "messages": history,
                               "max_tokens": max_tokens, "stream": True}
    if tools:
        payload["tools"] = [_openai_tool(t) for t in tools]
    from services import nebius                     # HACKATHON-NEBIUS
    payload.update(nebius.chat_extras(url, max_tokens))
    if any(host in url for host in ("openrouter.ai", "api.openai.com")):
        payload["stream_options"] = {"include_usage": True}

    pending: list[dict] = []
    async with client.stream("POST", url, headers=headers, json=payload) as resp:
        if resp.status_code != 200:
            body = await resp.aread()
            raise RuntimeError(f"LLM error {resp.status_code}: {body.decode()[:400]}")

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

            _raise_stream_error(data)
            usage_log.report_openai_usage(data)
            delta = (data.get("choices") or [{}])[0].get("delta", {})

            text = delta.get("content")
            if text:
                yield {"type": "text", "content": text}

            for tc in delta.get("tool_calls", []) or []:
                idx = tc.get("index", 0)
                while len(pending) <= idx:
                    pending.append({"id": "", "name": "", "args": ""})
                slot = pending[idx]
                if tc.get("id"):
                    slot["id"] = tc["id"]
                fn = tc.get("function") or {}
                if fn.get("name"):
                    slot["name"] = fn["name"]
                if fn.get("arguments"):
                    slot["args"] += fn["arguments"]

    # OpenAI only completes tool calls at the end of the stream.
    for slot in pending:
        yield {"type": "tool_call", "id": slot["id"], "name": slot["name"],
               "arguments": slot["args"] or "{}"}


def _openai_history(messages: list[dict]) -> list[dict]:
    """Pass tool plumbing through untouched; convert only the parts the
    multimodal converter understands."""
    out = []
    for m in messages:
        if m.get("role") == "tool" or m.get("tool_calls"):
            out.append(m)
        else:
            out.extend(_to_openai_messages([m]))
    return out


async def stream_agent(p: Provider, messages: list[dict],
                       tools: list[dict] | None = None,
                       max_tokens: int = 2048) -> AsyncIterator[dict[str, Any]]:
    """One model turn for the agent loop, as provider-agnostic events."""
    privacy.check_provider(p)
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        if p.provider == "anthropic":
            async for ev in _stream_anthropic(client, p, messages, tools or [],
                                              max_tokens):
                yield ev
            return

        if p.provider == "local":
            ep = _local_endpoint()
            url, headers, model = ep["url"], ep["headers"], ep["model"]
        else:
            url = _openai_url(p)
            headers = {"Authorization": f"Bearer {p.api_key}",
                       "Content-Type": "application/json"}
            model = p.model

        async for ev in _stream_openai(client, url, headers, model, messages,
                                       tools or [], max_tokens):
            yield ev
