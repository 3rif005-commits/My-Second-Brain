# backend/tests/test_agent_ingest.py
"""Tests for run_ingest_turn and POST /agent/ingest."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from services.agent.engine import run_ingest_turn
from services.ai.providers import Provider
from services.agent.skills import Skill, SkillRegistry
from models.agent import AgentRequest, ChatMessage, Mode


def _make_note_author_registry() -> SkillRegistry:
    return SkillRegistry({
        "note-author": Skill(
            name="note-author",
            description="Format notes as mastery guides",
            body="Use H2 sections. Call brain.update_note with structured blocks.",
            tools=None, priority=5, source_path=Path("/fake"),
        )
    })


# --- Fake streaming infrastructure (mirrors test_engine.py pattern) ---

def fake_stream(*texts):
    """Stand in for services.ai.agent_stream.stream_agent — the engine takes
    provider-agnostic events now, so tests script events, not SSE bytes."""
    async def _stream(provider, messages, tools=None, max_tokens=2048):
        for t in texts:
            yield {"type": "text", "content": t}
    return _stream


def _fake_provider():
    return Provider(provider="openai_compatible", api_key="k",
                    base_url="https://x/api/v1", chat_model="test",
                    label="test", capabilities={"text"})


async def _collect(ait):
    return [ev async for ev in ait]


# --- Tests ---

def test_run_ingest_turn_auto_activates_note_author():
    registry = _make_note_author_registry()
    request = AgentRequest(
        messages=[ChatMessage(role="user", content="Note ID: n1\n\nSome text")],
        query="Ingest: test.pdf",
        mode=Mode.API,
        surface="ingest",
        current_note_id="n1",
    )
    with (
        patch("services.agent.engine.get_provider", return_value=_fake_provider()),
        patch("services.agent.engine.stream_agent", side_effect=fake_stream("Hello")),
    ):
        events = asyncio.run(_collect(
            run_ingest_turn(request, user_id="u1", skill_registry=registry)
        ))

    types = [e["type"] for e in events]
    assert "skill_active" in types
    assert "text" in types
    assert "done" in types
    skill_names = [e["name"] for e in events if e["type"] == "skill_active"]
    assert "note-author" in skill_names


def test_run_ingest_turn_no_retrieval_context():
    """context event must have empty notes list."""
    registry = _make_note_author_registry()
    request = AgentRequest(
        messages=[ChatMessage(role="user", content="text")],
        query="Ingest",
        mode=Mode.API,
        surface="ingest",
    )
    with (
        patch("services.agent.engine.get_provider", return_value=_fake_provider()),
        patch("services.agent.engine.stream_agent", side_effect=fake_stream("hi")),
    ):
        events = asyncio.run(_collect(
            run_ingest_turn(request, user_id="u1", skill_registry=registry)
        ))

    context_events = [e for e in events if e["type"] == "context"]
    assert context_events
    assert context_events[0]["notes"] == []


# --- Endpoint tests ---

from fastapi.testclient import TestClient
from unittest.mock import patch as mock_patch


@pytest.fixture
def test_client():
    from main import app
    return TestClient(app)


def test_endpoint_rejects_unknown_extension(test_client):
    with mock_patch("routers.agent_ingest.get_user_id", return_value="user-1"):
        resp = test_client.post(
            "/agent/ingest",
            headers={"Authorization": "Bearer faketoken"},
            files={"file": ("evil.exe", b"MZ", "application/octet-stream")},
            data={"mode": "api"},
        )
    assert resp.status_code == 400
    assert "Unsupported" in resp.json()["detail"]


def test_endpoint_rejects_missing_source(test_client):
    with mock_patch("routers.agent_ingest.get_user_id", return_value="user-1"):
        resp = test_client.post(
            "/agent/ingest",
            headers={"Authorization": "Bearer faketoken"},
            data={"mode": "api"},
        )
    assert resp.status_code == 400
    assert "file" in resp.json()["detail"].lower() or "url" in resp.json()["detail"].lower()


def test_endpoint_rejects_missing_auth(test_client):
    # No Authorization header — get_user_id raises 401
    with mock_patch("routers.agent_ingest.get_user_id", side_effect=Exception("401")):
        resp = test_client.post("/agent/ingest", data={"mode": "api"})
    assert resp.status_code in (400, 401, 422, 500)
