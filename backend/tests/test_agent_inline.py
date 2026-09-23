"""Tests for the inline AI endpoint config.

The /agent/inline route is a transparent OpenAI-compatible streaming proxy;
the unit-testable surface is the endpoint selection: always OpenRouter with
settings.inline_model (forced tool-calling support), failing loudly when the
key is missing.
"""
from unittest.mock import patch

import pytest

from routers import agent_inline


def test_inline_endpoint_uses_openrouter_and_inline_model():
    with patch.object(agent_inline.settings, "openrouter_api_key", "sk-test"), \
         patch.object(agent_inline.settings, "inline_model", "openai/gpt-4o-mini"):
        ep = agent_inline._inline_endpoint()

    assert ep["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert ep["model"] == "openai/gpt-4o-mini"
    assert ep["headers"]["Authorization"] == "Bearer sk-test"


def test_inline_endpoint_requires_api_key():
    with patch.object(agent_inline.settings, "openrouter_api_key", ""):
        with pytest.raises(RuntimeError, match="OPENROUTER_API_KEY"):
            agent_inline._inline_endpoint()


# ── the run log tee ──────────────────────────────────────────────────────────

import json
from unittest.mock import MagicMock

from services.ai import usage as usage_log

UPSTREAM = [
    b'data: {"choices":[{"delta":{"content":"He"}}]}\n\n',
    b'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n',
    b'data: {"choices":[],"usage":{"prompt_tokens":800,"completion_tokens":60}}\n\n',
    b"data: [DONE]\n\n",
]


class _Resp:
    status_code = 200

    async def aiter_bytes(self):
        for chunk in UPSTREAM:
            yield chunk

    async def aread(self):
        return b""


class _CM:
    async def __aenter__(self):
        return _Resp()

    async def __aexit__(self, *a):
        return None


class _Client:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return None

    def stream(self, *a, **kw):
        return _CM()


async def _drain(response):
    return b"".join([c async for c in response.body_iterator])


@pytest.mark.asyncio
async def test_the_proxy_forwards_bytes_untouched_and_still_logs_the_spend(monkeypatch):
    """xl-ai parses these bytes itself, so the stream must arrive exactly as
    the upstream sent it — the run row is a side effect, not a rewrite."""
    monkeypatch.setattr(usage_log, "RECENT", usage_log.RECENT.__class__(maxlen=10))
    monkeypatch.setattr("services.database.get_supabase",
                        lambda: (_ for _ in ()).throw(RuntimeError("no db")))
    monkeypatch.setattr(agent_inline, "get_user_id", lambda auth: "u1")
    monkeypatch.setattr(agent_inline.httpx, "AsyncClient", lambda **kw: _Client())

    with patch.object(agent_inline.settings, "openrouter_api_key", "sk-test"), \
         patch.object(agent_inline.settings, "inline_model", "openai/gpt-4o-mini"):
        response = await agent_inline.agent_inline({"messages": []}, authorization="Bearer x")
        body = await _drain(response)

    assert body == b"".join(UPSTREAM)          # byte-for-byte

    row = list(usage_log.RECENT)[-1]
    assert row["surface"] == "inline" and row["job"] == "inline_edit"
    assert row["model"] == "openai/gpt-4o-mini"
    assert row["input_tokens"] == 800 and row["output_tokens"] == 60
    assert row["usage_reported"] is True


@pytest.mark.asyncio
async def test_without_upstream_usage_the_row_is_marked_an_estimate(monkeypatch):
    monkeypatch.setattr(usage_log, "RECENT", usage_log.RECENT.__class__(maxlen=10))
    monkeypatch.setattr("services.database.get_supabase",
                        lambda: (_ for _ in ()).throw(RuntimeError("no db")))
    monkeypatch.setattr(agent_inline, "get_user_id", lambda auth: "u1")

    class _NoUsage(_Client):
        def stream(self, *a, **kw):
            class _C(_CM):
                async def __aenter__(self):
                    class _R(_Resp):
                        async def aiter_bytes(self):
                            yield b'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'
                    return _R()
            return _C()

    monkeypatch.setattr(agent_inline.httpx, "AsyncClient", lambda **kw: _NoUsage())
    with patch.object(agent_inline.settings, "openrouter_api_key", "sk-test"):
        response = await agent_inline.agent_inline({"messages": [{"role": "user",
                                                                 "content": "x" * 400}]},
                                                   authorization="Bearer x")
        await _drain(response)

    row = list(usage_log.RECENT)[-1]
    assert row["usage_reported"] is False
    assert row["input_tokens"] > 0
