"""The agent loop's second half: what happens AFTER a tool runs.

Before this, tool results were streamed to the UI and thrown away — the model
never saw them, so "find the stale note and fix it" could search and then had
to guess. These tests pin the contract that makes multi-step work possible, and
the budgets that stop it running away.
"""
import json
from pathlib import Path
from unittest.mock import patch

import pytest

from models.agent import Tier
from services.agent import engine
from services.ai import usage as usage_log
from services.ai.providers import Provider
from services.agent.engine import MAX_TOOL_ROUNDS, _stream_loop


def say(text: str) -> list[dict]:
    return [{"type": "text", "content": text}]


def call(call_id: str, name: str, args: dict) -> list[dict]:
    return [{"type": "tool_call", "id": call_id, "name": name,
             "arguments": json.dumps(args)}]


def usage(input_tokens: int, output_tokens: int = 0) -> list[dict]:
    """A round that reports real usage, expressed as a marker the fake stream
    turns into a usage report — the engine sees only text/tool_call events."""
    return [{"type": "_usage", "input_tokens": input_tokens,
             "output_tokens": output_tokens}]


class _Scripted:
    """One scripted turn per round, recording the history it was handed — the
    only way to prove tool results actually went back to the model."""

    def __init__(self, rounds):
        self.rounds = list(rounds)
        self.requests: list[list[dict]] = []

    async def __call__(self, provider, messages, tools=None, max_tokens=2048):
        # copy: the engine keeps mutating the same list between rounds
        self.requests.append([dict(m) for m in messages])
        events = self.rounds.pop(0) if self.rounds else say("done")
        for ev in events:
            if ev["type"] == "_usage":
                usage_log.report(input_tokens=ev["input_tokens"],
                                 output_tokens=ev["output_tokens"])
                continue
            yield ev


def _provider():
    return Provider(provider="anthropic", api_key="k",
                    chat_model="claude-haiku-4-5", capabilities={"text"})


async def _collect(stream, provider=None, **kw):
    with patch.object(engine, "stream_agent", stream):
        return [e async for e in _stream_loop(
            provider or _provider(),
            messages_payload=kw.get("messages", []),
            tool_schemas=[], tier=Tier.INTERNAL_API, user_id="u1",
            tool_calls_made=0,
            **{k: v for k, v in kw.items() if k != "messages"})]


@pytest.mark.asyncio
async def test_a_tool_result_goes_back_to_the_model_and_the_turn_continues():
    client = _Scripted([
        call("c1", "brain.search_brain", {"query": "bias"}),
        say("Found it: your Lecture 4 note."),
    ])
    with patch.object(engine, "execute_brain_tool",
                      return_value={"matches": [{"id": "n1"}]}) as run:
        events = await _collect(client, messages=[{"role": "user", "content": "hi"}])

    run.assert_awaited()
    kinds = [e["type"] for e in events]
    assert kinds == ["tool_call", "tool_result", "text"]

    # Round two carried the assistant's tool_calls AND a matching tool reply.
    second = client.requests[1]
    assistant = next(m for m in second if m["role"] == "assistant")
    reply = next(m for m in second if m["role"] == "tool")
    assert assistant["tool_calls"][0]["id"] == "c1"
    assert reply["tool_call_id"] == "c1"
    assert "n1" in reply["content"]


@pytest.mark.asyncio
async def test_a_denial_is_answered_too_so_the_provider_does_not_reject_the_turn():
    """Every tool_call id must get exactly one reply — an unanswered one is a
    400 from the provider, not a quiet skip."""
    client = _Scripted([
        call("c1", "brain.delete_note", {"id": "n1", "confirm": True}),
        say("I'll need you to confirm that."),
    ])
    with patch.object(engine, "execute_brain_tool", return_value={"local_only": False}):
        events = await _collect(client, messages=[{"role": "user", "content": "delete it"}])

    denied = next(e for e in events if e["type"] == "tool_denied")
    assert denied["requires_approval"] is True

    replies = [m for m in client.requests[1] if m["role"] == "tool"]
    assert len(replies) == 1 and replies[0]["tool_call_id"] == "c1"
    # And it must tell the model to stop, or it spends every round retrying.
    assert "not call it again" in replies[0]["content"].lower()


@pytest.mark.asyncio
async def test_a_failing_tool_reports_the_error_to_the_model():
    client = _Scripted([
        call("c1", "brain.get_note", {"id": "gone"}),
        say("That note doesn't exist."),
    ])
    with patch.object(engine, "execute_brain_tool", side_effect=RuntimeError("404 not found")):
        events = await _collect(client, messages=[])

    assert any(e["type"] == "tool_denied" for e in events)
    reply = next(m for m in client.requests[1] if m["role"] == "tool")
    assert "404 not found" in reply["content"]


@pytest.mark.asyncio
async def test_invalid_json_arguments_teach_the_model_the_right_shape():
    client = _Scripted([
        [{"type": "tool_call", "id": "c1", "name": "brain.search_brain",
          "arguments": "{oops"}],
        say("retrying"),
    ])
    events = await _collect(client, messages=[])
    assert events[0]["type"] == "tool_denied"
    reply = next(m for m in client.requests[1] if m["role"] == "tool")
    assert "JSON" in reply["content"]


@pytest.mark.asyncio
async def test_a_large_tool_result_is_capped_with_an_instruction():
    big = {"matches": [{"id": f"n{i}", "text": "x" * 200} for i in range(200)]}
    client = _Scripted([
        call("c1", "brain.search_brain", {"query": "everything"}),
        say("ok"),
    ])
    with patch.object(engine, "execute_brain_tool", return_value=big):
        await _collect(client, messages=[])

    reply = next(m for m in client.requests[1] if m["role"] == "tool")
    assert len(reply["content"]) < engine.TOOL_RESULT_CHAR_CAP + 400
    assert "Narrow the query" in reply["content"]


@pytest.mark.asyncio
async def test_the_loop_stops_after_the_round_budget_instead_of_running_forever():
    """A model that keeps calling tools must hit a ceiling, and the ceiling
    must be visible rather than a silent truncation."""
    client = _Scripted([call(f"c{i}", "brain.search_brain", {"query": "x"})
                        for i in range(MAX_TOOL_ROUNDS + 3)])
    with patch.object(engine, "execute_brain_tool", return_value={"matches": []}):
        events = await _collect(client, messages=[])

    assert len(client.requests) == MAX_TOOL_ROUNDS
    assert events[-1]["type"] == "error"
    assert "rounds" in events[-1]["content"]


@pytest.mark.asyncio
async def test_the_call_budget_ends_the_work_but_still_answers_every_call():
    client = _Scripted([call(f"c{i}", "brain.search_brain", {"query": "x"})
                        for i in range(MAX_TOOL_ROUNDS)])
    with patch.object(engine, "execute_brain_tool", return_value={"matches": []}), \
         patch.object(engine, "MAX_TOOL_CALLS_PER_TURN", 2):
        events = await _collect(client, messages=[])

    assert any(e["type"] == "error" and "budget" in e["content"] for e in events)
    for request in client.requests[1:]:
        calls = [m for m in request if m["role"] == "assistant" and m.get("tool_calls")]
        replies = [m for m in request if m["role"] == "tool"]
        assert len(replies) == sum(len(c["tool_calls"]) for c in calls)


@pytest.mark.asyncio
async def test_a_plain_answer_makes_exactly_one_request():
    client = _Scripted([say("No tools needed.")])
    events = await _collect(client, messages=[])
    assert len(client.requests) == 1
    assert [e["type"] for e in events] == ["text"]


# ── the run log ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_each_round_writes_its_own_run_row(monkeypatch):
    """A turn that took two model calls cost two model calls, and the log has
    to be able to say so — otherwise per-turn spend is guesswork."""
    from services.ai import usage as usage_log

    rows: list[dict] = []
    monkeypatch.setattr(usage_log, "RECENT", usage_log.RECENT.__class__(maxlen=50))
    monkeypatch.setattr("services.database.get_supabase",
                        lambda: (_ for _ in ()).throw(RuntimeError("no db in tests")))

    client = _Scripted([
        call("c1", "brain.search_brain", {"query": "bias"}),
        say("done") + usage(1200, 90),
    ])
    with patch.object(engine, "execute_brain_tool", return_value={"matches": []}):
        with usage_log.annotate(surface="chat", job="agent", user_id="u1"):
            await _collect(client, messages=[])

    rows = list(usage_log.RECENT)
    assert len(rows) == 2                      # one per round
    assert all(r["surface"] == "chat" and r["job"] == "agent" for r in rows)
    # Round two reported real usage; round one had none and is marked estimated.
    assert rows[1]["input_tokens"] == 1200 and rows[1]["usage_reported"] is True
    assert rows[0]["usage_reported"] is False


@pytest.mark.asyncio
async def test_a_turn_stops_when_its_budget_is_spent(monkeypatch):
    """Checked between rounds, never during one: a call already paid for is
    left to finish, because killing it wastes the spend without saving it."""
    from services.ai import budget as budget_guard

    monkeypatch.setattr("services.database.get_supabase",
                        lambda: (_ for _ in ()).throw(RuntimeError("no db")))
    client = _Scripted([
        call("c1", "brain.search_brain", {}) + usage(400_000),
        say("should never be reached"),
    ])

    with patch.object(engine, "execute_brain_tool", return_value={"matches": []}):
        with budget_guard.limit(0.10) as spend:          # $0.40 of input > cap
            events = await _collect(client)

    assert len(client.requests) == 1                     # round two never ran
    assert events[-1]["type"] == "error"
    assert "$0.40" in events[-1]["content"]              # what it spent
    assert "$0.10" in events[-1]["content"]              # and the ceiling
    assert spend.exceeded is True
