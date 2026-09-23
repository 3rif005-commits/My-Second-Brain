"""Provider-agnostic agent streaming — the piece that lets Claude drive the
agent loop.

The engine keeps one history format (OpenAI-shaped: assistant `tool_calls`,
`tool` replies). Anthropic wants `tool_use` blocks inside the assistant turn
and `tool_result` blocks inside the USER turn. Getting that wrong does not
degrade quietly; the API rejects the request.
"""
import json

import pytest

from services.ai import agent_stream
from services.ai.agent_stream import (
    anthropic_tool_names, history_to_anthropic, stream_agent, tools_to_anthropic,
)
from services.ai.providers import Provider

TOOLS = [{"name": "brain.search_brain", "description": "search",
          "parameters": {"type": "object", "properties": {"query": {"type": "string"}}}}]


def anthropic_provider():
    return Provider(provider="anthropic", api_key="k",
                    chat_model="claude-haiku-4-5", capabilities={"text"})


# ── request shaping ──────────────────────────────────────────────────────────

def test_tool_schemas_become_input_schema():
    converted = tools_to_anthropic(TOOLS)
    assert converted[0]["name"] == "brain_search_brain"
    assert converted[0]["input_schema"]["properties"]["query"]["type"] == "string"
    assert "parameters" not in converted[0]


def test_tool_calls_become_tool_use_blocks_in_the_assistant_turn():
    system, msgs = history_to_anthropic([
        {"role": "system", "content": "be brief"},
        {"role": "user", "content": "find it"},
        {"role": "assistant", "content": "",
         "tool_calls": [{"id": "c1", "type": "function",
                         "function": {"name": "brain.search_brain",
                                      "arguments": '{"query": "bias"}'}}]},
        {"role": "tool", "tool_call_id": "c1", "content": '{"matches": []}'},
    ])
    assert system == "be brief"
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]

    use = msgs[1]["content"][0]
    assert use["type"] == "tool_use" and use["id"] == "c1"
    assert use["input"] == {"query": "bias"}      # parsed, not a JSON string

    result = msgs[2]["content"][0]
    assert result["type"] == "tool_result" and result["tool_use_id"] == "c1"


def test_parallel_tool_replies_merge_into_one_user_turn():
    """Two assistant turns in a row, or two user turns in a row, are rejected
    outright by the API — so replies to parallel calls must merge."""
    _, msgs = history_to_anthropic([
        {"role": "user", "content": "do both"},
        {"role": "assistant", "content": "", "tool_calls": [
            {"id": "a", "function": {"name": "t", "arguments": "{}"}},
            {"id": "b", "function": {"name": "t", "arguments": "{}"}},
        ]},
        {"role": "tool", "tool_call_id": "a", "content": "one"},
        {"role": "tool", "tool_call_id": "b", "content": "two"},
    ])
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]
    assert [b["tool_use_id"] for b in msgs[2]["content"]] == ["a", "b"]


def test_assistant_text_survives_alongside_its_tool_calls():
    _, msgs = history_to_anthropic([
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "Let me look.",
         "tool_calls": [{"id": "c1", "function": {"name": "t", "arguments": "{}"}}]},
    ])
    kinds = [b["type"] for b in msgs[1]["content"]]
    assert kinds == ["text", "tool_use"]


def test_malformed_tool_arguments_do_not_break_the_conversion():
    """The model wrote bad JSON once already; refusing to convert the history
    would lose the whole conversation on top of it."""
    _, msgs = history_to_anthropic([
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "",
         "tool_calls": [{"id": "c1", "function": {"name": "t", "arguments": "{oops"}}]},
    ])
    assert msgs[1]["content"][0]["input"] == {}


def test_every_tool_name_is_one_anthropic_accepts():
    # The live API refuses the WHOLE request over one dotted name — this is
    # how Claude never drove the agent loop despite a green suite.
    import re
    names = anthropic_tool_names(
        ["brain.search_brain", "mcp.my server.do/it", "skill.load", "x" * 200])
    for wire in names.values():
        assert re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", wire), wire


def test_names_that_collapse_together_stay_distinct():
    names = anthropic_tool_names(["a.b", "a_b", "a-b"])
    assert len(set(names.values())) == 3


def test_replayed_tool_calls_use_the_name_claude_was_shown():
    names = anthropic_tool_names(["brain.search_brain"])
    _, msgs = history_to_anthropic([
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": "", "tool_calls": [
            {"id": "c1", "function": {"name": "brain.search_brain",
                                      "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "c1", "content": "[]"},
    ], names)
    assert msgs[1]["content"][0]["name"] == "brain_search_brain"


# ── streaming ────────────────────────────────────────────────────────────────

class _Resp:
    def __init__(self, lines, status=200):
        self.status_code = status
        self._lines = lines

    async def aiter_lines(self):
        for line in self._lines:
            yield line

    async def aread(self):
        return b'{"error": {"message": "boom"}}'


class _CM:
    def __init__(self, resp):
        self.resp = resp

    async def __aenter__(self):
        return self.resp

    async def __aexit__(self, *a):
        return None


class _Client:
    def __init__(self, resp):
        self.resp = resp
        self.payload = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return None

    def stream(self, method, url, headers=None, json=None):
        self.payload = json
        return _CM(self.resp)


def anthropic_sse(*events):
    return [f"data: {json.dumps(e)}" for e in events]


ANTHROPIC_TOOL_TURN = anthropic_sse(
    {"type": "message_start", "message": {"usage": {"input_tokens": 120}}},
    {"type": "content_block_start", "index": 0,
     "content_block": {"type": "text"}},
    {"type": "content_block_delta", "index": 0,
     "delta": {"type": "text_delta", "text": "Looking… "}},
    {"type": "content_block_stop", "index": 0},
    {"type": "content_block_start", "index": 1,
     "content_block": {"type": "tool_use", "id": "toolu_1",
                       "name": "brain_search_brain"}},
    # arguments arrive as JSON fragments, which is the whole difficulty
    {"type": "content_block_delta", "index": 1,
     "delta": {"type": "input_json_delta", "partial_json": '{"query":'}},
    {"type": "content_block_delta", "index": 1,
     "delta": {"type": "input_json_delta", "partial_json": ' "bias"}'}},
    {"type": "content_block_stop", "index": 1},
    {"type": "message_delta", "usage": {"output_tokens": 40}},
)


@pytest.mark.asyncio
async def test_anthropic_tool_use_arrives_as_one_assembled_call(monkeypatch):
    client = _Client(_Resp(ANTHROPIC_TOOL_TURN))
    monkeypatch.setattr(agent_stream.httpx, "AsyncClient", lambda **kw: client)

    events = [e async for e in stream_agent(
        anthropic_provider(), [{"role": "user", "content": "find bias"}], TOOLS)]

    assert events[0] == {"type": "text", "content": "Looking… "}
    call = events[1]
    assert call["type"] == "tool_call" and call["id"] == "toolu_1"
    # sent under the wire name, handed back under ours: the engine dispatches
    # on "brain.search_brain" and would not recognise the wire form
    assert client.payload["tools"][0]["name"] == "brain_search_brain"
    assert call["name"] == "brain.search_brain"
    assert json.loads(call["arguments"]) == {"query": "bias"}   # fragments joined
    # and the request carried Anthropic-shaped tools
    assert "input_schema" in client.payload["tools"][0]


@pytest.mark.asyncio
async def test_anthropic_usage_reaches_the_run_log(monkeypatch):
    from services.ai import usage as usage_log

    client = _Client(_Resp(ANTHROPIC_TOOL_TURN))
    monkeypatch.setattr(agent_stream.httpx, "AsyncClient", lambda **kw: client)
    monkeypatch.setattr("services.database.get_supabase",
                        lambda: (_ for _ in ()).throw(RuntimeError("no db")))

    with usage_log.track("anthropic", "claude-haiku-4-5") as u:
        async for _ in stream_agent(anthropic_provider(),
                                    [{"role": "user", "content": "x"}], TOOLS):
            pass

    assert u.reported is True
    assert u.input_tokens == 120 and u.output_tokens == 40


@pytest.mark.asyncio
async def test_an_anthropic_error_is_raised_with_its_body(monkeypatch):
    client = _Client(_Resp([], status=400))
    monkeypatch.setattr(agent_stream.httpx, "AsyncClient", lambda **kw: client)

    with pytest.raises(RuntimeError, match="boom"):
        async for _ in stream_agent(anthropic_provider(), [], TOOLS):
            pass


@pytest.mark.asyncio
async def test_the_openai_path_yields_the_same_event_shapes(monkeypatch):
    chunks = [f"data: {json.dumps(c)}" for c in [
        {"choices": [{"delta": {"content": "Looking… "}}]},
        {"choices": [{"delta": {"tool_calls": [{
            "index": 0, "id": "c1",
            "function": {"name": "brain.search_brain",
                         "arguments": '{"query": "bias"}'}}]}}]},
    ]] + ["data: [DONE]"]
    client = _Client(_Resp(chunks))
    monkeypatch.setattr(agent_stream.httpx, "AsyncClient", lambda **kw: client)

    provider = Provider(provider="openai", api_key="k", chat_model="gpt-4o-mini",
                        capabilities={"text"})
    events = [e async for e in stream_agent(
        provider, [{"role": "user", "content": "find bias"}], TOOLS)]

    assert events[0] == {"type": "text", "content": "Looking… "}
    assert events[1]["type"] == "tool_call"
    assert json.loads(events[1]["arguments"]) == {"query": "bias"}
    # tools are wrapped the way chat-completions expects
    assert client.payload["tools"][0]["type"] == "function"


# The real brain tools are declared with `input_schema`, not `parameters`. The
# fixtures above used `parameters`, which is why a suite of green tests sat on
# top of a model that was shown every brain tool with no arguments at all.
REAL_SHAPE = [{"name": "brain.get_note", "description": "read one note",
               "input_schema": {"type": "object",
                                "properties": {"id": {"type": "string"}},
                                "required": ["id"]}}]


def test_an_input_schema_tool_keeps_its_arguments_for_claude():
    converted = tools_to_anthropic(REAL_SHAPE)
    assert converted[0]["input_schema"]["required"] == ["id"]


@pytest.mark.asyncio
async def test_an_input_schema_tool_keeps_its_arguments_for_openai(monkeypatch):
    client = _Client(_Resp(["data: [DONE]"]))
    monkeypatch.setattr(agent_stream.httpx, "AsyncClient", lambda **kw: client)
    provider = Provider(provider="openai", api_key="k", chat_model="m",
                        capabilities={"text"})
    [e async for e in stream_agent(provider, [{"role": "user", "content": "x"}],
                                   REAL_SHAPE)]
    fn = client.payload["tools"][0]["function"]
    assert fn["parameters"]["required"] == ["id"]
    assert "input_schema" not in fn


def test_every_shipped_brain_tool_reaches_claude_with_its_arguments():
    from services.agent.brain_tools import BRAIN_TOOL_SCHEMAS
    for t in tools_to_anthropic(BRAIN_TOOL_SCHEMAS):
        schema = t["input_schema"]
        assert schema.get("properties") or not schema.get("required"), t["name"]
    get_note = next(t for t in tools_to_anthropic(BRAIN_TOOL_SCHEMAS)
                    if t["name"] == "brain_get_note")
    assert "id" in get_note["input_schema"]["properties"]
