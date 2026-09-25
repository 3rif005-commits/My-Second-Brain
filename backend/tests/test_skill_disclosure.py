"""Progressive disclosure of skills (E7), behind AGENT_SKILL_DISCLOSURE.

Default stays "inline" — the shipped behaviour the baseline numbers describe.
"index" puts only the catalogue in the prompt and lets the model call
skill.load for the one it needs, which is what keeps the base prompt flat as
the catalogue grows.
"""
import json
from pathlib import Path
from unittest.mock import patch

import pytest

from models.agent import AgentRequest, ChatMessage, Mode, Tier
from services.agent import engine
from services.agent.engine import _stream_loop, run_turn
from services.agent.skills import Skill, SkillRegistry
from services.ai.providers import Provider


def _registry():
    return SkillRegistry({
        "note-author": Skill(
            name="note-author",
            description="Format note content for the block editor.",
            # Realistic size: the shipped skills run 1-2.5KB, and that is what
            # makes the trade worth making.
            body="THE FULL NOTE-AUTHOR INSTRUCTIONS\n" + ("detail. " * 250),
            tools=None, priority=4, source_path=Path("/x")),
        "cite-everything": Skill(
            name="cite-everything",
            description="Cite the user's notes when answering from them.",
            body="THE FULL CITATION INSTRUCTIONS\n" + ("detail. " * 250),
            tools=None, priority=5, source_path=Path("/y")),
    })


def _provider():
    return Provider(provider="openai_compatible", api_key="k",
                    base_url="https://x/v1", chat_model="m", capabilities={"text"})


def scripted(*rounds):
    turns = list(rounds)
    sent = []

    async def _stream(provider, messages, tools=None, max_tokens=2048):
        sent.append({"messages": [dict(m) for m in messages], "tools": tools})
        for ev in (turns.pop(0) if turns else [{"type": "text", "content": "done"}]):
            yield ev

    _stream.sent = sent
    return _stream


async def _run(monkeypatch, mode: str, stream):
    monkeypatch.setattr(engine.settings, "agent_skill_disclosure", mode)
    monkeypatch.setattr(engine, "get_provider", lambda *a, **kw: _provider())
    monkeypatch.setattr(engine, "embed", lambda q: [0.0] * 768)
    monkeypatch.setattr(engine, "retrieve", lambda e, u: [])
    monkeypatch.setattr(engine, "stream_agent", stream)
    req = AgentRequest(messages=[ChatMessage(role="user", content="cite my notes")],
                       query="cite my notes", mode=Mode.API)
    return [e async for e in run_turn(req, user_id="u1", skill_registry=_registry())]



def _request_text(stream) -> str:
    """Everything the model read on the first round: system prompt and messages."""
    return "\n".join(m.get("content") or "" for m in stream.sent[0]["messages"]
                     if isinstance(m.get("content"), str))


@pytest.mark.asyncio
async def test_inline_mode_pastes_the_matched_skill_body(monkeypatch):
    stream = scripted([{"type": "text", "content": "ok"}])
    events = await _run(monkeypatch, "inline", stream)

    system = _request_text(stream)       # skills ride at the end of the message (E3b)
    assert "THE FULL CITATION INSTRUCTIONS" in system
    assert any(e["type"] == "skill_active" for e in events)
    assert all(t["name"] != "skill.load" for t in stream.sent[0]["tools"])


@pytest.mark.asyncio
async def test_index_mode_sends_the_catalogue_and_no_bodies(monkeypatch):
    stream = scripted([{"type": "text", "content": "ok"}])
    await _run(monkeypatch, "index", stream)

    system = _request_text(stream)
    assert "note-author: Format note content" in system      # the catalogue
    assert "cite-everything: Cite the user's notes" in system
    assert "THE FULL CITATION INSTRUCTIONS" not in system     # not the body
    assert "THE FULL NOTE-AUTHOR INSTRUCTIONS" not in system
    assert any(t["name"] == "skill.load" for t in stream.sent[0]["tools"])


@pytest.mark.asyncio
async def test_the_index_is_much_smaller_than_the_bodies(monkeypatch):
    """The whole justification: metadata costs ~100 tokens per skill, bodies
    cost whatever they cost, on every single turn.

    Note the crossover this test had to be rewritten to respect: with two
    30-character skills the catalogue is LARGER than the bodies it replaces.
    Progressive disclosure buys nothing until either the bodies are long or the
    catalogue is — which is exactly when it starts mattering.
    """
    inline_stream = scripted([{"type": "text", "content": "ok"}])
    await _run(monkeypatch, "inline", inline_stream)
    index_stream = scripted([{"type": "text", "content": "ok"}])
    await _run(monkeypatch, "index", index_stream)

    inline_len = len(_request_text(inline_stream))
    index_len = len(_request_text(index_stream))
    assert index_len < inline_len


@pytest.mark.asyncio
async def test_skill_load_returns_the_body_to_the_model(monkeypatch):
    stream = scripted(
        [{"type": "tool_call", "id": "c1", "name": "skill.load",
          "arguments": json.dumps({"name": "cite-everything"})}],
        [{"type": "text", "content": "now citing properly"}],
    )
    events = await _run(monkeypatch, "index", stream)

    reply = next(m for m in stream.sent[1]["messages"] if m["role"] == "tool")
    assert reply["content"].startswith("THE FULL CITATION INSTRUCTIONS")
    assert [e["name"] for e in events if e["type"] == "skill_active"] == ["cite-everything"]


@pytest.mark.asyncio
async def test_an_unknown_skill_answers_with_the_list_not_an_error(monkeypatch):
    """A model asking for a skill that does not exist needs to see what does."""
    stream = scripted(
        [{"type": "tool_call", "id": "c1", "name": "skill.load",
          "arguments": json.dumps({"name": "does-not-exist"})}],
        [{"type": "text", "content": "using what exists"}],
    )
    await _run(monkeypatch, "index", stream)

    reply = next(m for m in stream.sent[1]["messages"] if m["role"] == "tool")
    assert "No skill by that name" in reply["content"]
    assert "cite-everything" in reply["content"]


@pytest.mark.asyncio
async def test_loading_a_skill_needs_no_permission_tier(monkeypatch):
    """It reads instructions and touches nothing, so the gate that guards
    writes has nothing to say about it — including in a turn that read
    untrusted text."""
    stream = scripted(
        [{"type": "tool_call", "id": "c1", "name": "skill.load",
          "arguments": json.dumps({"name": "note-author"})}],
        [{"type": "text", "content": "ok"}],
    )
    with patch.object(engine, "stream_agent", stream):
        events = [e async for e in _stream_loop(
            _provider(), messages_payload=[], tool_schemas=[],
            tier=Tier.EXTERNAL, user_id="u1", tool_calls_made=0,
            untrusted_context=True, skill_registry=_registry())]

    assert any(e["type"] == "tool_result" and e["summary"] == "loaded note-author"
               for e in events)
