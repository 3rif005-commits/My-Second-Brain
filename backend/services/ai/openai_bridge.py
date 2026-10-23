"""An OpenAI chat-completions stream, served by Claude.

BlockNote's editor AI (xl-ai, through the Vercel AI SDK's OpenAI provider)
speaks one wire format: an OpenAI chat-completions request with a forced
`applyDocumentOperations` tool call, answered by `chat.completion.chunk`
events. Pass-through (services/ai/passthrough) serves that for every
OpenAI-dialect provider. This is the Anthropic side: the request is
translated to the Messages API — natively, not through an OpenAI shim — and
Claude's stream is re-encoded chunk by chunk, so tool arguments still arrive
incrementally and the editor shows the edit as it is written.

The translation reuses agent_stream's history and tool converters, which the
agent loop already exercises against the real API.
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any, AsyncIterator

import httpx

from core.config import settings
from services import privacy
from services.ai import budget as budget_guard
from services.ai import usage as usage_log
from services.ai.agent_stream import anthropic_tool_names, history_to_anthropic, tools_to_anthropic
from services.ai.client import _ANTHROPIC_URL, _ANTHROPIC_VERSION, _anthropic_error
from services.ai.providers import Provider

_TIMEOUT = 300
_DEFAULT_MAX_TOKENS = 16000
_FINISH = {"tool_use": "tool_calls", "end_turn": "stop", "stop_sequence": "stop",
           "max_tokens": "length", "refusal": "content_filter"}


def to_anthropic_request(body: dict, model: str) -> tuple[dict, dict[str, str]]:
    """OpenAI chat-completions body → (Messages API payload, wire→our tool names)."""
    tools = body.get("tools") or []
    names = anthropic_tool_names([t.get("function", t)["name"] for t in tools])
    system, msgs = history_to_anthropic(body.get("messages") or [], names)
    payload: dict[str, Any] = {
        "model": model,
        "messages": msgs,
        "max_tokens": int(body.get("max_completion_tokens") or body.get("max_tokens")
                          or _DEFAULT_MAX_TOKENS),
        "stream": True,
    }
    if system:
        payload["system"] = system
    choice = body.get("tool_choice")
    if tools and choice != "none":
        payload["tools"] = tools_to_anthropic(tools, names)
        if choice == "required":
            payload["tool_choice"] = {"type": "any"}
        elif isinstance(choice, dict) and (choice.get("function") or {}).get("name"):
            name = choice["function"]["name"]
            payload["tool_choice"] = {"type": "tool", "name": names.get(name, name)}
    if body.get("stop"):
        stop = body["stop"]
        payload["stop_sequences"] = [stop] if isinstance(stop, str) else list(stop)
    return payload, {wire: ours for ours, wire in names.items()}


def _chunk(cid: str, model: str, delta: dict | None = None,
           finish: str | None = None, usage: dict | None = None) -> bytes:
    data: dict[str, Any] = {"id": cid, "object": "chat.completion.chunk",
                            "created": int(time.time()), "model": model,
                            "choices": [] if usage else
                            [{"index": 0, "delta": delta or {}, "finish_reason": finish}]}
    if usage:
        data["usage"] = usage
    return f"data: {json.dumps(data)}\n\n".encode()


class ChunkEncoder:
    """Anthropic stream events → OpenAI `chat.completion.chunk` SSE frames.

    `feed` one event at a time, then `finish`. Each tool_use block gets the
    next OpenAI tool-call index; its first frame carries id, type and name (the
    AI SDK refuses a tool call without them), later frames carry argument
    fragments. Usage follows the last choice, as with
    `stream_options.include_usage`, then `[DONE]`.
    """

    def __init__(self, model: str, back: dict[str, str]):
        self.model, self.back = model, back
        self.cid = f"chatcmpl-{uuid.uuid4().hex[:24]}"
        self.tool_index: dict[int, int] = {}       # Anthropic block index → OpenAI index
        self.usage = {"prompt_tokens": 0, "completion_tokens": 0}
        self.finish_reason = "stop"
        self.started = self.failed = False

    def _c(self, delta: dict | None = None, finish: str | None = None,
           usage: dict | None = None) -> bytes:
        return _chunk(self.cid, self.model, delta, finish, usage)

    def feed(self, ev: dict) -> list[bytes]:
        out: list[bytes] = []
        if not self.started:
            self.started = True
            out.append(self._c({"role": "assistant", "content": ""}))
        kind = ev.get("type")
        if kind == "message_start":
            u = (ev.get("message") or {}).get("usage") or {}
            self.usage["prompt_tokens"] = ((u.get("input_tokens") or 0)
                                           + (u.get("cache_read_input_tokens") or 0)
                                           + (u.get("cache_creation_input_tokens") or 0))
        elif kind == "content_block_start":
            block = ev.get("content_block") or {}
            if block.get("type") == "tool_use":
                i = self.tool_index[ev.get("index", 0)] = len(self.tool_index)
                out.append(self._c({"tool_calls": [{
                    "index": i, "id": block.get("id"), "type": "function",
                    "function": {"name": self.back.get(block.get("name"), block.get("name")),
                                 "arguments": ""}}]}))
        elif kind == "content_block_delta":
            delta = ev.get("delta") or {}
            if delta.get("type") == "text_delta" and delta.get("text"):
                out.append(self._c({"content": delta["text"]}))
            elif delta.get("type") == "input_json_delta" and delta.get("partial_json"):
                i = self.tool_index.get(ev.get("index", 0))
                if i is not None:
                    out.append(self._c({"tool_calls": [{
                        "index": i, "function": {"arguments": delta["partial_json"]}}]}))
        elif kind == "message_delta":
            reason = (ev.get("delta") or {}).get("stop_reason")
            if reason:
                self.finish_reason = _FINISH.get(reason, "stop")
            self.usage["completion_tokens"] = (ev.get("usage") or {}).get("output_tokens") or 0
        elif kind == "error":
            self.failed = True
            message = (ev.get("error") or {}).get("message") or "stream error"
            out.append(_error_frame(f"Anthropic: {message}"))
        return out

    def finish(self) -> list[bytes]:
        if self.failed:
            return []
        usage = {**self.usage,
                 "total_tokens": self.usage["prompt_tokens"] + self.usage["completion_tokens"]}
        return [self._c({}, self.finish_reason), self._c(usage=usage), b"data: [DONE]\n\n"]


def _error_frame(message: str) -> bytes:
    """The error shape the AI SDK's OpenAI provider recognises and shows."""
    return f"data: {json.dumps({'error': {'message': message[:300]}})}\n\n".encode()


def _report(ev: dict) -> None:
    """Usage to the run log, as agent_stream does for the agent loop."""
    if ev.get("type") == "message_start":
        u = (ev.get("message") or {}).get("usage") or {}
        usage_log.report(input_tokens=u.get("input_tokens") or 0,
                         cache_read_tokens=u.get("cache_read_input_tokens") or 0,
                         cache_write_tokens=u.get("cache_creation_input_tokens") or 0,
                         output_tokens=u.get("output_tokens") or 0)
    elif ev.get("type") == "message_delta":
        usage_log.report(output_tokens=(ev.get("usage") or {}).get("output_tokens") or 0)


async def stream_anthropic_as_openai(provider: Provider, body: dict, *, surface: str,
                                     job: str, user_id: str | None = None,
                                     note_id: str | None = None) -> AsyncIterator[bytes]:
    """Serve an OpenAI chat-completions streaming request with Claude."""
    privacy.check_provider(provider)
    payload, back = to_anthropic_request(body, provider.model)
    request_chars = len(json.dumps(payload, default=str))

    with usage_log.annotate(surface=surface, job=job, trigger="user",
                            user_id=user_id, note_id=note_id), \
         budget_guard.limit(settings.max_usd_per_run or None), \
         usage_log.track(provider.provider, provider.model,
                         estimate_chars=(request_chars, 0)):
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            async with client.stream(
                "POST", _ANTHROPIC_URL, json=payload,
                headers={"x-api-key": provider.api_key,
                         "anthropic-version": _ANTHROPIC_VERSION,
                         "Content-Type": "application/json"},
            ) as resp:
                if resp.status_code != 200:
                    yield _error_frame(str(_anthropic_error(resp.status_code, await resp.aread())))
                    return
                enc = ChunkEncoder(provider.model, back)
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    try:
                        ev = json.loads(line[6:])
                    except json.JSONDecodeError:
                        continue
                    _report(ev)
                    for frame in enc.feed(ev):
                        yield frame
                    if enc.failed:
                        return
                for frame in enc.finish():
                    yield frame
