"""POST /v1/chat/completions — the app's own OpenAI-compatible endpoint.

It exists so the editor's AI stops being the one surface that spends tokens
nothing records. The contract that matters: the bytes reach the client
untouched, and a row reaches the run log.
"""
import json

import pytest

from routers import gateway
from services.ai import passthrough
from services.ai import usage as usage_log
from services.ai.providers import Provider

UPSTREAM = [
    b'data: {"choices":[{"delta":{"content":"Re"}}]}\n\n',
    b'data: {"choices":[{"delta":{"content":"written"}}]}\n\n',
    b'data: {"choices":[],"usage":{"prompt_tokens":600,"completion_tokens":40}}\n\n',
    b"data: [DONE]\n\n",
]


class _Resp:
    def __init__(self, chunks=UPSTREAM, status=200):
        self.status_code = status
        self._chunks = chunks

    async def aiter_bytes(self):
        for c in self._chunks:
            yield c

    async def aread(self):
        return b'{"error":{"message":"upstream said no"}}'


class _CM:
    def __init__(self, resp):
        self._resp = resp

    async def __aenter__(self):
        return self._resp

    async def __aexit__(self, *a):
        return None


class _Client:
    def __init__(self, resp=None):
        self.resp = resp or _Resp()
        self.sent = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return None

    def stream(self, method, url, headers=None, json=None):
        self.sent = {"url": url, "headers": headers, "body": json}
        return _CM(self.resp)


def _provider():
    return Provider(provider="openai_compatible", api_key="k",
                    base_url="https://openrouter.ai/api/v1",
                    chat_model="configured/model", label="test",
                    capabilities={"text"})


async def _drain(response):
    return b"".join([c async for c in response.body_iterator])


@pytest.fixture
def no_db(monkeypatch):
    monkeypatch.setattr(usage_log, "RECENT", usage_log.RECENT.__class__(maxlen=10))
    monkeypatch.setattr("services.database.get_supabase",
                        lambda: (_ for _ in ()).throw(RuntimeError("no db")))
    monkeypatch.setattr(gateway, "get_user_id",
                        lambda auth: "11111111-1111-4111-8111-111111111111")


@pytest.mark.asyncio
async def test_bytes_pass_through_and_the_spend_is_logged(no_db, monkeypatch):
    client = _Client()
    monkeypatch.setattr(passthrough.httpx, "AsyncClient", lambda **kw: client)
    monkeypatch.setattr(gateway, "pick_openai_provider", lambda uid: _provider())

    response = await gateway.chat_completions(
        {"messages": [{"role": "user", "content": "rewrite this"}]},
        authorization="Bearer x")
    body = await _drain(response)

    assert body == b"".join(UPSTREAM)          # byte-for-byte
    row = list(usage_log.RECENT)[-1]
    assert row["surface"] == "editor" and row["job"] == "editor_ai"
    assert row["input_tokens"] == 600 and row["usage_reported"] is True


@pytest.mark.asyncio
async def test_the_configured_model_wins_over_whatever_the_client_asked_for(
        no_db, monkeypatch):
    """This is the app's gateway, not a general-purpose API: the provider chain
    decides the model, not the browser."""
    client = _Client()
    monkeypatch.setattr(passthrough.httpx, "AsyncClient", lambda **kw: client)
    monkeypatch.setattr(gateway, "pick_openai_provider", lambda uid: _provider())

    await _drain(await gateway.chat_completions(
        {"messages": [], "model": "gpt-9-ultra"}, authorization="Bearer x"))

    assert client.sent["body"]["model"] == "configured/model"
    assert client.sent["body"]["stream"] is True


@pytest.mark.asyncio
async def test_an_upstream_error_reaches_the_client_as_an_sse_event(
        no_db, monkeypatch):
    """A client that receives nothing shows the user nothing."""
    client = _Client(_Resp(chunks=[], status=429))
    monkeypatch.setattr(passthrough.httpx, "AsyncClient", lambda **kw: client)
    monkeypatch.setattr(gateway, "pick_openai_provider", lambda uid: _provider())

    body = await _drain(await gateway.chat_completions(
        {"messages": []}, authorization="Bearer x"))

    event = json.loads(body.decode().removeprefix("data: ").strip())
    assert event["type"] == "error"
    assert "429" in event["content"] and "upstream said no" in event["content"]
    assert list(usage_log.RECENT)[-1]["status"] == "error"


@pytest.mark.asyncio
async def test_no_configured_provider_is_a_503_with_the_reason(no_db, monkeypatch):
    from fastapi import HTTPException

    def _refuse(uid):
        raise RuntimeError("No OpenAI-compatible provider is configured — "
                           "Anthropic (.env) (not an OpenAI-compatible API)")

    monkeypatch.setattr(gateway, "pick_openai_provider", _refuse)
    with pytest.raises(HTTPException) as e:
        await gateway.chat_completions({"messages": []}, authorization="Bearer x")

    assert e.value.status_code == 503
    assert "not an OpenAI-compatible API" in e.value.detail["error"]


def test_provider_selection_skips_the_wrong_dialect_with_a_reason(monkeypatch):
    anthropic = Provider(provider="anthropic", api_key="k",
                         chat_model="claude-haiku-4-5", label="Anthropic (.env)",
                         capabilities={"text"})
    keyless = Provider(provider="openai", api_key="", chat_model="gpt-4o-mini",
                       label="OpenAI (.env)", capabilities={"text"})
    monkeypatch.setattr(passthrough, "candidates", lambda job, uid: [anthropic, keyless])

    with pytest.raises(RuntimeError) as e:
        passthrough.pick_openai_provider("u")
    assert "not an OpenAI-compatible API" in str(e.value)
    assert "no API key" in str(e.value)


def test_it_takes_the_first_usable_provider(monkeypatch):
    anthropic = Provider(provider="anthropic", api_key="k", chat_model="claude",
                         capabilities={"text"})
    monkeypatch.setattr(passthrough, "candidates",
                        lambda job, uid: [anthropic, _provider()])
    assert passthrough.pick_openai_provider("u").model == "configured/model"
