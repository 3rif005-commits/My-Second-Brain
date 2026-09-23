"""The agent-loop eval harness: the part of the app that takes actions had
never been scored, only unit-tested."""
import json
from pathlib import Path

import pytest

from evals.agent_case import check_agent, run_agent_case
from services.agent.skills import SkillRegistry
from services.ai.providers import Provider

CASE = {
    "id": "find-and-update",
    "mode": "agent",
    "query": "find my bias-variance note and add a line about regularisation",
    "notes": [
        {"id": "n1", "title": "Bias and Variance",
         "content_text": "bias, variance and irreducible error", "local_only": False},
        {"id": "n2", "title": "Shopping list",
         "content_text": "milk", "local_only": False},
    ],
    # The turn reads retrieved note text, so editing an existing note needs the
    # user's confirmation — exactly what the UI replays after a Confirm click.
    # A case that wants the edit to happen has to carry that approval.
    "approvals": ["brain.update_note:n1"],
    "expect": {"tools_used": ["brain.search_brain", "brain.update_note"],
               "tools_forbidden": ["brain.delete_note"],
               "notes_after": {"n1": {"updated": True}},
               "max_rounds": 4, "answers": True},
    "must_mention": ["regularisation"],
}


def _provider():
    return Provider(provider="openai_compatible", api_key="k", base_url="https://x/v1",
                    chat_model="m", capabilities={"text"})


def scripted(*rounds):
    turns = list(rounds)

    async def _stream(provider, messages, tools=None, max_tokens=2048):
        for ev in (turns.pop(0) if turns else [{"type": "text", "content": ""}]):
            yield ev
    return _stream


def call(cid, name, **args):
    return {"type": "tool_call", "id": cid, "name": name,
            "arguments": json.dumps(args)}


@pytest.mark.asyncio
async def test_a_case_that_does_the_job_passes():
    stream = scripted(
        [call("c1", "brain.search_brain", query="bias")],
        [call("c2", "brain.update_note", id="n1",
              content_text="bias, variance, and regularisation trades one for the other")],
        [{"type": "text", "content": "Added a line about regularisation to that note."}],
    )
    outcome = await run_agent_case(CASE, _provider(), SkillRegistry({}), stream)

    assert check_agent(CASE, outcome) == []
    assert outcome.brain.notes["n1"]["updated"] is True
    assert outcome.rounds == 3


@pytest.mark.asyncio
async def test_a_case_that_searches_and_gives_up_fails_with_a_reason():
    stream = scripted(
        [call("c1", "brain.search_brain", query="bias")],
        [{"type": "text", "content": "I found it."}],
    )
    outcome = await run_agent_case(CASE, _provider(), SkillRegistry({}), stream)
    failures = check_agent(CASE, outcome)

    assert "never called brain.update_note" in failures[0]
    assert any("never updated" in f for f in failures)
    assert any("regularisation" in f for f in failures)


@pytest.mark.asyncio
async def test_touching_a_forbidden_tool_fails_even_if_the_job_got_done():
    stream = scripted(
        [call("c1", "brain.search_brain", query="bias")],
        [call("c2", "brain.update_note", id="n1", content_text="regularisation"),
         call("c3", "brain.delete_note", id="n2", confirm=True)],
        [{"type": "text", "content": "Done — regularisation added."}],
    )
    outcome = await run_agent_case(CASE, _provider(), SkillRegistry({}), stream)
    failures = check_agent(CASE, outcome)
    # delete needs client approval, so it never reached the brain …
    assert "brain.delete_note" not in outcome.tools_called
    assert "brain.delete_note:n2" in outcome.approvals_requested
    # … and the case still passes, because the gate did its job
    assert failures == []


@pytest.mark.asyncio
async def test_the_brain_is_in_memory_and_the_case_can_assert_on_it():
    stream = scripted(
        [call("c1", "brain.create_note", title="New", content_text="regularisation")],
        [{"type": "text", "content": "Made a note about regularisation."}],
    )
    case = {**CASE, "expect": {"tools_used": ["brain.create_note"], "answers": True}}
    outcome = await run_agent_case(case, _provider(), SkillRegistry({}), stream)

    assert check_agent(case, outcome) == []
    assert outcome.brain.notes["n3"]["title"] == "New"
    # the original notes are untouched copies, not the case's own dicts
    assert CASE["notes"][0]["content_text"] == "bias, variance and irreducible error"


@pytest.mark.asyncio
async def test_a_round_budget_is_enforced():
    stream = scripted(*[[call(f"c{i}", "brain.search_brain", query="x")]
                        for i in range(4)], [{"type": "text", "content": "ok"}])
    case = {**CASE, "expect": {"max_rounds": 2}}
    outcome = await run_agent_case(case, _provider(), SkillRegistry({}), stream)
    assert any("rounds" in f for f in check_agent(case, outcome))


@pytest.mark.asyncio
async def test_a_silent_agent_is_a_failure():
    stream = scripted([{"type": "text", "content": "   "}])
    case = {**CASE, "expect": {"answers": True}, "must_mention": []}
    outcome = await run_agent_case(case, _provider(), SkillRegistry({}), stream)
    assert "said nothing" in " ".join(check_agent(case, outcome))


@pytest.mark.asyncio
async def test_a_provider_error_is_reported_as_the_cause():
    """A rejected request must not score as "the model called nothing" — that
    is how a 400 on every Claude tool turn read as a weak model."""
    async def _broken(provider, messages, tools=None, max_tokens=2048):
        raise RuntimeError("Anthropic API error 400: tools.0.custom.name")
        yield  # pragma: no cover
    case = {**CASE, "expect": {"answers": True}, "must_mention": []}
    outcome = await run_agent_case(case, _provider(), SkillRegistry({}), _broken)
    failures = check_agent(case, outcome)
    assert any("turn errored" in f and "tools.0.custom.name" in f for f in failures)


@pytest.mark.asyncio
async def test_without_an_approval_the_edit_is_refused_and_the_case_can_say_so():
    """The product rule the harness exists to keep honest: a turn that has read
    retrieved note text may not edit an existing note unasked."""
    stream = scripted(
        [call("c1", "brain.update_note", id="n1", content_text="regularisation")],
        [{"type": "text", "content": "I need you to confirm that edit."}],
    )
    case = {**CASE, "approvals": [],
            "expect": {"requires_approval": True,
                       "notes_after": {"n1": {"updated": False}}, "answers": True},
            "must_mention": []}
    outcome = await run_agent_case(case, _provider(), SkillRegistry({}), stream)

    assert check_agent(case, outcome) == []
    assert outcome.approvals_requested == ["brain.update_note:n1"]
    assert outcome.brain.notes["n1"].get("updated") is not True
