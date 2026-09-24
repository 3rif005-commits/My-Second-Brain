"""One AI in the workspace (user decision, 2026-09-24): the app-wide assistant
merged into the workspace AI panel — the agent, scoped to the open note."""
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from models.agent import AgentRequest, ChatMessage, Mode, Tier
from services.agent import engine
from services.agent.skills import SkillRegistry
from services.workspace import chat, skill_run
from tests.test_engine_tool_loop import _Scripted, _collect, call, say

NOTE = "note-1"
RESULT = {"skill": "flashcards", "title": "Flashcards", "html": "<h2>A</h2><table></table>",
          "source_ids": ["s1"], "truncated": False, "input_tokens": 10,
          "output_tokens": 5, "usd": 0.01}


@pytest.mark.asyncio
async def test_the_open_note_is_never_written_through_a_tool():
    brain = AsyncMock()
    with patch.object(engine, "execute_brain_tool", brain):
        events = await _collect(_Scripted([
            call("c1", "brain.update_note", {"id": NOTE, "blocks": []}),
            say("ok")]), workspace_note=NOTE)
    denied = next(e for e in events if e["type"] == "tool_denied")
    assert "open in the editor" in denied["reason"]
    brain.assert_not_called()                     # nothing reached the database


@pytest.mark.asyncio
async def test_another_note_is_still_editable_through_the_normal_gate():
    with patch.object(engine, "execute_brain_tool", AsyncMock(return_value={"id": "other"})):
        events = await _collect(_Scripted([
            call("c1", "brain.update_note", {"id": "other", "blocks": []}),
            say("ok")]), workspace_note=NOTE)
    denied = [e for e in events if e["type"] == "tool_denied"]
    assert not any("open in the editor" in e.get("reason", "") for e in denied)


@pytest.mark.asyncio
async def test_a_job_the_model_starts_becomes_a_card_not_context():
    stream = _Scripted([call("c1", "workspace.run_job", {"name": "flashcards", "focus": "RL"}),
                        say("Your flashcards are ready to insert.")])
    with patch.object(skill_run, "produce_skill_result", return_value=RESULT) as run:
        events = await _collect(stream, workspace_note=NOTE)
    run.assert_called_once_with(NOTE, "u1", "flashcards", "RL")
    types = [e["type"] for e in events]
    assert "skill_start" in types and "result" in types
    tool_reply = next(m for m in stream.requests[1] if m.get("role") == "tool")
    assert "<h2>" not in tool_reply["content"]    # the model never gets the result itself
    assert "shown to the user as a card" in tool_reply["content"]


@pytest.mark.asyncio
async def test_a_job_that_cannot_run_is_explained_not_crashed():
    stream = _Scripted([call("c1", "workspace.run_job", {"name": "compare-sources"}), say("Sorry.")])
    with patch.object(skill_run, "produce_skill_result",
                      side_effect=ValueError("Compare sources: comparing needs at least two sources.")):
        events = await _collect(stream, workspace_note=NOTE)
    assert any(e["type"] == "job_error" and "two sources" in e["content"] for e in events)


def _request(surface="workspace", **kw):
    return AgentRequest(messages=[ChatMessage(role="user", content="q")], query="q",
                        mode=Mode.API, current_note_id=NOTE, surface=surface, **kw)


@pytest.mark.asyncio
async def test_a_workspace_turn_reads_the_notes_sources_and_offers_the_jobs():
    chunks = [{"resource_id": "r1", "chunk_text": "Q-learning updates Q-values.",
               "anchor_type": "page", "anchor_start": 3, "anchor_end": 3}]
    seen = {}

    async def fake_loop(provider, messages_payload, tool_schemas, **kw):
        seen["system"] = messages_payload[0]["content"]
        seen["tools"] = [t["name"] for t in tool_schemas]
        seen["kw"] = kw
        yield {"type": "text", "content": "Q-values update [1]."}

    with patch.object(chat, "workspace_chunks", return_value=(chunks, {"r1": "Lecture 10"})), \
         patch.object(skill_run, "chat_skills", return_value=[
             {"skill": "flashcards", "description": "cards", "runnable": None}]), \
         patch.object(engine, "get_provider", return_value=MagicMock(provider="anthropic", model="m")), \
         patch.object(engine, "_get_mcp_tools_for_user", AsyncMock(return_value=([], []))), \
         patch.object(engine, "_stream_loop", fake_loop), \
         patch.object(engine, "embed") as embed:
        events = [e async for e in engine.run_turn(_request(), "u1", SkillRegistry({}))]
    embed.assert_not_called()                       # no brain-wide retrieval
    assert "[1] (Lecture 10, p. 3)" in seen["system"] or "[1] (Lecture 10" in seen["system"]
    assert "workspace.run_job" in seen["tools"]
    assert "skill.load" in seen["tools"]           # skills by index, loaded on demand
    assert not any(e["type"] == "skill_active" for e in events)   # nothing pasted in
    assert seen["kw"]["workspace_note"] == NOTE and seen["kw"]["untrusted_context"] is True
    ctx = next(e for e in events if e["type"] == "context")
    assert ctx["citations"][0]["resource_id"] == "r1"
    assert [e["type"] for e in events][-2:] == ["citations", "done"]


@pytest.mark.asyncio
async def test_outside_the_workspace_nothing_changes():
    seen = {}

    async def fake_loop(provider, messages_payload, tool_schemas, **kw):
        seen["tools"] = [t["name"] for t in tool_schemas]
        seen["kw"] = kw
        yield {"type": "text", "content": "hi"}

    with patch.object(engine, "embed", return_value=[0.0]), \
         patch.object(engine, "retrieve", return_value=[]), \
         patch.object(engine, "get_provider", return_value=MagicMock(provider="anthropic", model="m")), \
         patch.object(engine, "_get_mcp_tools_for_user", AsyncMock(return_value=([], []))), \
         patch.object(engine, "_stream_loop", fake_loop):
        [e async for e in engine.run_turn(_request(surface="chat"), "u1", SkillRegistry({}))]
    assert "workspace.run_job" not in seen["tools"]
    assert seen["kw"]["workspace_note"] is None


def test_a_slash_job_through_the_agent_endpoint_runs_without_a_model_turn():
    from fastapi.testclient import TestClient
    import routers.agent as agent_router

    async def fake_job(note_id, user_id, name, focus="", picked=False):
        yield {"type": "skill_start", "skill": name, "title": "Flashcards", "focus": focus, "picked": False}
        yield {"type": "result", **RESULT}

    saved = []
    with patch("routers.agent.get_user_id", return_value="u1"), \
         patch.object(agent_router, "_append_user_message_to_thread"), \
         patch.object(agent_router, "_append_assistant_message_to_thread",
                      side_effect=lambda tid, text: saved.append(text)), \
         patch.object(chat, "run_skill_in_chat", fake_job), \
         patch.object(agent_router, "run_turn", side_effect=AssertionError("no model turn")):
        from main import app
        r = TestClient(app).post("/agent", headers={"Authorization": "Bearer x"}, json={
            "messages": [{"role": "user", "content": "/flashcards RL"}], "query": "/flashcards RL",
            "surface": "workspace", "current_note_id": NOTE, "job": "flashcards", "focus": "RL"})
    events = [json.loads(l[6:]) for l in r.text.splitlines() if l.startswith("data: {")]
    assert [e["type"] for e in events] == ["skill_start", "result", "done"]
    assert saved and saved[0].startswith("Flashcards ready")
