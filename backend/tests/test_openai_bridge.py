"""The editor AI on Claude: xl-ai's OpenAI chat-completions request → the
Messages API, and Claude's stream → OpenAI chunks the AI SDK accepts."""
import json

import pytest

from services.ai import openai_bridge
from services.ai.openai_bridge import ChunkEncoder, to_anthropic_request
from services.ai.providers import Provider

XL_AI_BODY = {
    "model": "gpt-4o",
    "messages": [
        {"role": "system", "content": "You edit BlockNote documents."},
        {"role": "user", "content": [{"type": "text", "text": "Document: [...]"}]},
        {"role": "user", "content": "Improve writing"},
    ],
    "tools": [{"type": "function", "function": {
        "name": "applyDocumentOperations", "description": "Apply ops",
        "parameters": {"type": "object", "properties": {"operations": {"type": "array"}}}}}],
    "tool_choice": "required",
    "stream": True,
    "stream_options": {"include_usage": True},
}


def test_request_translation():
    payload, back = to_anthropic_request(XL_AI_BODY, "claude-haiku-4-5")
    assert payload["model"] == "claude-haiku-4-5" and payload["stream"] is True
    assert payload["system"] == "You edit BlockNote documents."
    assert [m["role"] for m in payload["messages"]] == ["user", "user"]
    assert payload["tools"] == [{"name": "applyDocumentOperations", "description": "Apply ops",
                                 "input_schema": XL_AI_BODY["tools"][0]["function"]["parameters"]}]
    assert payload["tool_choice"] == {"type": "any"}          # "required"
    assert payload["max_tokens"] > 0
    assert back == {"applyDocumentOperations": "applyDocumentOperations"}


def test_named_tool_choice_and_none():
    body = {**XL_AI_BODY, "tool_choice": {"type": "function",
                                          "function": {"name": "applyDocumentOperations"}}}
    assert to_anthropic_request(body, "m")[0]["tool_choice"] == \
        {"type": "tool", "name": "applyDocumentOperations"}
    assert "tools" not in to_anthropic_request({**XL_AI_BODY, "tool_choice": "none"}, "m")[0]


CLAUDE_STREAM = [
    {"type": "message_start", "message": {"usage": {"input_tokens": 900, "output_tokens": 1}}},
    {"type": "content_block_start", "index": 0,
     "content_block": {"type": "tool_use", "id": "toolu_1", "name": "applyDocumentOperations",
                       "input": {}}},
    {"type": "content_block_delta", "index": 0,
     "delta": {"type": "input_json_delta", "partial_json": '{"operations":'}},
    {"type": "content_block_delta", "index": 0,
     "delta": {"type": "input_json_delta", "partial_json": "[]}"}},
    {"type": "content_block_stop", "index": 0},
    {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 42}},
    {"type": "message_stop"},
]


def _frames(events):
    enc = ChunkEncoder("claude-haiku-4-5", {"applyDocumentOperations": "applyDocumentOperations"})
    raw = b"".join(f for ev in events for f in enc.feed(ev)) + b"".join(enc.finish())
    return [ln[6:] for ln in raw.decode().split("\n\n") if ln.startswith("data: ")]


def test_stream_becomes_openai_chunks():
    frames = _frames(CLAUDE_STREAM)
    assert frames[-1] == "[DONE]"
    chunks = [json.loads(f) for f in frames[:-1]]
    assert all(c["object"] == "chat.completion.chunk" for c in chunks)
    assert len({c["id"] for c in chunks}) == 1
    deltas = [c["choices"][0]["delta"] for c in chunks if c["choices"]]
    first_call = next(d["tool_calls"][0] for d in deltas if "tool_calls" in d)
    # the AI SDK refuses a tool call whose first delta lacks id / type / name
    assert first_call == {"index": 0, "id": "toolu_1", "type": "function",
                          "function": {"name": "applyDocumentOperations", "arguments": ""}}
    args = "".join(d["tool_calls"][0]["function"]["arguments"] for d in deltas if "tool_calls" in d)
    assert json.loads(args) == {"operations": []}
    assert [c["choices"][0]["finish_reason"] for c in chunks if c["choices"]][-1] == "tool_calls"
    assert chunks[-1]["choices"] == [] and chunks[-1]["usage"]["prompt_tokens"] == 900 \
        and chunks[-1]["usage"]["completion_tokens"] == 42


def test_text_and_error_events():
    frames = _frames([{"type": "content_block_delta", "index": 0,
                       "delta": {"type": "text_delta", "text": "Hi"}},
                      {"type": "error", "error": {"message": "overloaded"}}])
    assert json.loads(frames[1])["choices"][0]["delta"] == {"content": "Hi"}
    assert json.loads(frames[-1]) == {"error": {"message": "Anthropic: overloaded"}}
    assert "[DONE]" not in frames                    # a failed stream doesn't claim success


@pytest.mark.asyncio
async def test_end_to_end_over_a_fake_anthropic(monkeypatch):
    sent = {}

    class Resp:
        status_code = 200

        async def aiter_lines(self):
            for ev in CLAUDE_STREAM:
                yield f"event: {ev['type']}"
                yield "data: " + json.dumps(ev)
                yield ""

    class CM:
        async def __aenter__(self):
            return Resp()

        async def __aexit__(self, *a):
            return None

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

        def stream(self, method, url, json=None, headers=None):
            sent.update(url=url, json=json, headers=headers)
            return CM()

    monkeypatch.setattr(openai_bridge.httpx, "AsyncClient", lambda **kw: Client())
    monkeypatch.setattr("services.database.get_supabase",
                        lambda: (_ for _ in ()).throw(RuntimeError("no db")))
    p = Provider(provider="anthropic", api_key="sk-ant", chat_model="claude-haiku-4-5",
                 capabilities={"text"})
    out = b"".join([c async for c in openai_bridge.stream_anthropic_as_openai(
        p, XL_AI_BODY, surface="inline", job="inline_edit", user_id="u1")])
    assert sent["url"] == "https://api.anthropic.com/v1/messages"
    assert sent["headers"]["x-api-key"] == "sk-ant" and "anthropic-version" in sent["headers"]
    assert sent["json"]["tool_choice"] == {"type": "any"}
    assert out.endswith(b"data: [DONE]\n\n") and b"toolu_1" in out
