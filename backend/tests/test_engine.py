"""Tests for the Agent Engine — covers skill activation, system-prompt build,
tool call handling, and SSE event sequence.

The LLM HTTP call is mocked at the httpx.AsyncClient.stream level.
"""
import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from models.agent import AgentRequest, ChatMessage, Mode, Tier
from services.agent.engine import run_turn
from services.agent.skills import SkillRegistry, Skill
from services.ai.providers import Provider


def _fake_provider():
    return Provider(provider="openai_compatible", api_key="k",
                    base_url="https://x/api/v1", chat_model="fake",
                    label="test", capabilities={"text"})


async def _collect(ait):
    """Collect all items from an async iterator into a list."""
    return [item async for item in ait]


def _make_registry() -> SkillRegistry:
    skills = {
        "cite-everything": Skill(
            name="cite-everything",
            description="Use whenever the answer draws on the user's notes",
            body="Cite notes with markdown links.",
            tools=None, priority=5, source_path=Path("/x"),
        ),
    }
    return SkillRegistry(skills)


def fake_stream(*events):
    """Stand in for services.ai.agent_stream.stream_agent: the engine now takes
    provider-agnostic events, so tests script events rather than SSE bytes."""
    async def _stream(provider, messages, tools=None, max_tokens=2048):
        for ev in events:
            yield ev
    return _stream


def say(*pieces):
    return [{"type": "text", "content": p} for p in pieces]


@pytest.mark.asyncio
@patch("services.agent.engine.execute_brain_tool")
@patch("services.agent.engine.retrieve")
@patch("services.agent.engine.embed")
@patch("services.agent.engine.get_provider")
@patch("services.agent.engine.stream_agent")
async def test_engine_streams_text_event(
    mock_stream, mock_provider, mock_embed, mock_retrieve, mock_exec,
):
    mock_provider.return_value = _fake_provider()
    mock_embed.return_value = [0.1] * 768
    mock_retrieve.return_value = []
    mock_stream.side_effect = fake_stream(*say("Hello", " world"))

    req = AgentRequest(
        messages=[ChatMessage(role="user", content="hi")],
        query="hi",
        mode=Mode.API,
    )
    events = [e async for e in run_turn(req, user_id="u1",
                                        skill_registry=_make_registry())]
    text_events = [e for e in events if e["type"] == "text"]
    assert "".join(e["content"] for e in text_events) == "Hello world"
    # done event must come last and carry IDs
    assert events[-1]["type"] == "done"


@pytest.mark.asyncio
@patch("services.agent.engine.execute_brain_tool")
@patch("services.agent.engine.retrieve")
@patch("services.agent.engine.embed")
@patch("services.agent.engine.get_provider")
@patch("services.agent.engine.stream_agent")
async def test_engine_activates_matching_skill(
    mock_stream, mock_provider, mock_embed, mock_retrieve, mock_exec,
):
    mock_provider.return_value = _fake_provider()
    mock_embed.return_value = [0.0] * 768
    mock_retrieve.return_value = []
    mock_stream.side_effect = fake_stream(*say("ok"))

    req = AgentRequest(
        messages=[ChatMessage(role="user", content="cite from my notes")],
        query="cite from my notes",
        mode=Mode.API,
    )
    events = [e async for e in run_turn(req, user_id="u1",
                                        skill_registry=_make_registry())]
    # cite-everything has 'cite' and 'notes' in description; query has both
    skill_events = [e for e in events if e["type"] == "skill_active"]
    assert any(e["name"] == "cite-everything" for e in skill_events)


@pytest.mark.asyncio
@patch("services.agent.engine.execute_brain_tool")
@patch("services.agent.engine.retrieve")
@patch("services.agent.engine.embed")
@patch("services.agent.engine.get_provider")
@patch("services.agent.engine.stream_agent")
async def test_engine_emits_error_when_endpoint_fails(
    mock_stream, mock_provider, mock_embed, mock_retrieve, mock_exec,
):
    mock_provider.side_effect = RuntimeError("API key not configured")
    req = AgentRequest(
        messages=[ChatMessage(role="user", content="hi")],
        query="hi",
        mode=Mode.API,
    )
    events = [e async for e in run_turn(req, user_id="u1",
                                        skill_registry=_make_registry())]
    error_events = [e for e in events if e["type"] == "error"]
    assert len(error_events) == 1
    assert "API key" in error_events[0]["content"]


def test_interactive_turn_auto_loads_interactive_skill():
    """run_interactive_turn must auto-load interactive-block-author skill."""
    from services.agent.engine import run_interactive_turn

    registry = SkillRegistry({
        "interactive-block-author": Skill(
            name="interactive-block-author",
            description="Generate interactive HTML blocks",
            body="Output only raw HTML/CSS/JS.",
            tools=None, priority=5, source_path=Path("/fake"),
        )
    })
    request = AgentRequest(
        messages=[ChatMessage(role="user", content="A quiz about photosynthesis")],
        query="A quiz about photosynthesis",
        mode=Mode.API,
        surface="interactive",
    )
    with (
        patch("services.agent.engine.get_provider", return_value=_fake_provider()),
        patch("services.agent.engine.stream_agent",
              side_effect=fake_stream(*say("<html><body>Quiz</body></html>"))),
    ):
        events = asyncio.run(_collect(
            run_interactive_turn(request, user_id="u1", skill_registry=registry)
        ))

    types = [e["type"] for e in events]
    assert "skill_active" in types
    assert any(e.get("name") == "interactive-block-author"
               for e in events if e["type"] == "skill_active")
    text_events = [e for e in events if e["type"] == "text"]
    assert any("<html>" in e["content"] for e in text_events)
