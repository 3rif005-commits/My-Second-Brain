"""Jobs (skills) run from the workspace chat — the replacement for the
Compare / Flashcards / Generate buttons (user decision, 2026-09-24)."""
from unittest.mock import MagicMock, patch

import pytest

from services.workspace import chat, skill_run

OFFERED = [{"skill": "flashcards", "description": "Q&A cards."},
           {"skill": "study-guide", "description": "A full guide."}]
RESULT = {"skill": "flashcards", "title": "Flashcards", "html": "<h1>Cards</h1>",
          "source_ids": ["s1"], "truncated": False, "input_tokens": 10,
          "output_tokens": 5, "usd": 0.01}


def _common(fake_stream):
    return [patch.object(chat, "embed", return_value=[0.1] * 768),
            patch.object(chat, "retrieve_chunks", return_value=[]),
            patch.object(chat, "get_supabase", return_value=MagicMock()),
            patch.object(chat, "candidates", return_value=[MagicMock(provider="x", label="X")]),
            patch.object(chat, "ai_stream", fake_stream),
            patch.object(skill_run, "chat_skills", return_value=OFFERED),
            patch.object(skill_run, "produce_skill_result", return_value=RESULT)]


async def _run(fake_stream, **kw):
    ps = _common(fake_stream)
    for p in ps:
        p.start()
    try:
        return [e async for e in chat.run_note_chat(
            "n1", "u1", [{"role": "user", "content": "make me flashcards"}], **kw)]
    finally:
        for p in ps:
            p.stop()


async def _never(provider, messages, max_tokens=2048):
    raise AssertionError("a /command must not ask the model to choose")
    yield ""  # pragma: no cover


@pytest.mark.asyncio
async def test_a_slash_command_runs_the_job_directly():
    events = await _run(_never, skill="flashcards", focus="Q-learning only")
    types = [e["type"] for e in events]
    assert types == ["skill_start", "result", "done"]
    assert events[0]["focus"] == "Q-learning only" and events[0]["picked"] is False
    assert events[1]["html"] == "<h1>Cards</h1>"


@pytest.mark.asyncio
async def test_the_model_can_pick_a_job_and_the_marker_is_never_shown():
    async def stream(provider, messages, max_tokens=2048):
        assert "<<skill:NAME>>" in messages[0]["content"]      # the catalogue was offered
        for part in ["<<ski", "ll:flash", "cards>> on Q-learning"]:
            yield part
    events = await _run(stream)
    assert not any(e["type"] == "text" for e in events)
    start = next(e for e in events if e["type"] == "skill_start")
    assert start["skill"] == "flashcards" and start["picked"] and start["focus"] == "on Q-learning"
    assert any(e["type"] == "result" for e in events)


@pytest.mark.asyncio
async def test_an_unknown_marker_is_just_text():
    async def stream(provider, messages, max_tokens=2048):
        yield "<<skill:delete-everything>>"
    events = await _run(stream)
    assert [e["content"] for e in events if e["type"] == "text"] == ["<<skill:delete-everything>>"]
    assert not any(e["type"] == "skill_start" for e in events)


@pytest.mark.asyncio
async def test_a_normal_answer_streams_as_before():
    async def stream(provider, messages, max_tokens=2048):
        yield "Q-learning "
        yield "updates values [1]."
    events = await _run(stream)
    assert "".join(e["content"] for e in events if e["type"] == "text") == "Q-learning updates values [1]."
    assert [e["type"] for e in events][-2:] == ["citations", "done"]


@pytest.mark.asyncio
async def test_a_job_that_cannot_run_says_why():
    with patch.object(skill_run, "produce_skill_result",
                      side_effect=ValueError("Compare sources: comparing needs at least two sources.")):
        events = [e async for e in chat.run_skill_in_chat("n1", "u1", "compare-sources")]
    assert events[-1] == {"type": "error",
                          "content": "Compare sources: comparing needs at least two sources."}


def test_the_study_guide_is_a_chat_job_and_uses_the_users_instructions():
    names = [s.name for s in skill_run.registry().all()
             if s.output and skill_run.CHAT_SURFACES & set(s.surfaces)]
    assert "study-guide" in names
    blocks = [{"title": "L10", "kind": "pdf", "text": "[page 1]\nQ-learning"}]
    with patch.object(skill_run, "_blocks_for", return_value=(blocks, ["s1"])), \
         patch("services.workspace.synthesis.estimate_synthesis", return_value={"usd": 0.01}), \
         patch("services.workspace.synthesis._complete", return_value="<h1>Guide</h1><h2>RL</h2>") as comp:
        out = skill_run.produce_skill_result("n1", "u1", "study-guide", focus="exam focus")
    prompt = comp.call_args[0][0]
    from prompts.mastery_guide import SYSTEM_PROMPT
    assert SYSTEM_PROMPT[:200] in prompt            # the HTML dialect, not the Markdown spec
    assert "exam focus" in prompt
    assert out["html"].startswith("<h1>Guide</h1>") and out["source_ids"] == ["s1"]
