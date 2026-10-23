"""The inline editor AI (/agent/inline).

It runs on the user's Fast routing slot. OpenAI-dialect providers get the
request byte-for-byte; Anthropic is translated (tests/test_openai_bridge.py).
It used to be pinned to OpenRouter, so with no OpenRouter key (the live site)
every editor AI request failed.
"""
from dataclasses import replace
from unittest.mock import patch

import pytest

from routers import agent_inline
from services.ai.providers import Provider
from services.routing.policy import default_policy
from services.routing.switchboard import NoProvider

OPENROUTER = Provider(provider="openai_compatible", api_key="sk-test",
                      base_url="https://openrouter.ai/api/v1",
                      chat_model="nvidia/some-free-model:free", label="OpenRouter",
                      capabilities={"text"})
ANTHROPIC = Provider(provider="anthropic", api_key="sk-ant-test",
                     chat_model="claude-haiku-4-5", label="Anthropic", capabilities={"text"})


def _policy(model=""):
    pol = default_policy()
    pol["slots"]["fast"] = {"provider": "auto", "model": model}
    return pol


def test_uses_the_fast_slot_provider():
    with patch.object(agent_inline.routing_policy, "load", return_value=_policy()), \
         patch.object(agent_inline, "resolve_slot", return_value=ANTHROPIC) as rs:
        assert agent_inline._inline_provider("u1") is ANTHROPIC
    assert rs.call_args[0][0] == "fast"


def test_openrouter_without_a_slot_model_uses_the_tool_capable_inline_model():
    with patch.object(agent_inline.routing_policy, "load", return_value=_policy()), \
         patch.object(agent_inline, "resolve_slot", return_value=OPENROUTER), \
         patch.object(agent_inline.settings, "inline_model", "openai/gpt-4o-mini"):
        assert agent_inline._inline_provider("u1").model == "openai/gpt-4o-mini"
    with patch.object(agent_inline.routing_policy, "load", return_value=_policy("x/chosen")), \
         patch.object(agent_inline, "resolve_slot", return_value=OPENROUTER):
        # the user's own pick stands (resolve_slot already applied it)
        assert agent_inline._inline_provider("u1").model == OPENROUTER.model


@pytest.mark.asyncio
async def test_nothing_configured_is_a_readable_503(monkeypatch):
    monkeypatch.setattr(agent_inline, "get_user_id", lambda auth: "u1")
    with patch.object(agent_inline, "_inline_provider", side_effect=NoProvider("Map it")):
        with pytest.raises(agent_inline.HTTPException) as e:
            await agent_inline.agent_inline({"messages": []}, authorization="Bearer x")
    assert e.value.status_code == 503 and "Map it" in e.value.detail["error"]


# ── the run log tee ──────────────────────────────────────────────────────────


from services.ai import passthrough
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
    monkeypatch.setattr(passthrough.httpx, "AsyncClient", lambda **kw: _Client())

    gpt = replace(OPENROUTER, chat_model="openai/gpt-4o-mini")
    with patch.object(agent_inline, "_inline_provider", return_value=gpt):
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

    monkeypatch.setattr(passthrough.httpx, "AsyncClient", lambda **kw: _NoUsage())
    with patch.object(agent_inline, "_inline_provider", return_value=OPENROUTER):
        response = await agent_inline.agent_inline({"messages": [{"role": "user",
                                                                 "content": "x" * 400}]},
                                                   authorization="Bearer x")
        await _drain(response)

    row = list(usage_log.RECENT)[-1]
    assert row["usage_reported"] is False
    assert row["input_tokens"] > 0
