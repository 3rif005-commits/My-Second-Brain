"""The ingest page's model calls, now on the shared gateway.

What had to survive the move: the per-request model choice (X-LLM-Model), the
small-context truncation for the on-device model, and the error classifier
whose suggestions the ingest page shows to the user.
"""
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from services import llm


def test_the_mastery_guide_goes_through_the_gateway():
    with patch.object(llm, "complete_with_fallback",
                      return_value="<h1>Guide</h1>") as call:
        html = llm.generate_mastery_guide("source text", title="Lecture 4")

    assert html == "<h1>Guide</h1>"
    job, _user, messages = call.call_args[0][:3]
    assert job == "summarize_text"
    assert "Lecture 4" in messages[1]["content"]
    assert call.call_args.kwargs["model_override"] is None


def test_the_per_request_model_choice_is_passed_through():
    with patch.object(llm, "complete_with_fallback", return_value="x") as call:
        llm.generate_mastery_guide("t", model_override="nvidia/nemotron:free")
    assert call.call_args.kwargs["model_override"] == "nvidia/nemotron:free"


def test_the_local_model_still_gets_a_truncated_source():
    """Kept from the old code for the same reason it existed: the on-device
    model's context is small, and a full lecture does not fit."""
    with patch.object(llm, "complete_with_fallback", return_value="x") as call:
        llm.generate_mastery_guide("y" * 20_000, model_override="llamacpp")

    prompt = call.call_args[0][2][1]["content"]
    # the source is cut at 6k; the prompt template around it has its own text
    assert "y" * 6_000 in prompt
    assert "y" * 6_001 not in prompt
    assert call.call_args.kwargs["max_tokens"] == 2048


def test_metadata_parses_json_even_in_a_code_fence():
    fenced = '```json\n{"title": "Bias", "topics": ["ml", "stats"]}\n```'
    with patch.object(llm, "complete_with_fallback", return_value=fenced):
        meta = llm.extract_metadata("some text")
    assert meta == {"title": "Bias", "topics": ["ml", "stats"]}


def test_a_rate_limit_becomes_a_503_with_advice_not_a_bare_500():
    """The ingest page renders `suggestion`; losing it in the move onto the
    gateway would have been a silent UX regression."""
    with patch.object(llm, "complete_with_fallback",
                      side_effect=RuntimeError("429 Too Many Requests")):
        with pytest.raises(HTTPException) as e:
            llm.generate_mastery_guide("t", model_override="some/model")

    assert e.value.status_code == 503
    assert e.value.detail["error_code"] == "RATE_LIMITED"
    assert "some/model" in e.value.detail["model"]
    assert e.value.detail["suggestion"]


def test_a_local_failure_names_the_local_model_in_the_message():
    with patch.object(llm, "complete_with_fallback",
                      side_effect=RuntimeError("connection refused")):
        with pytest.raises(HTTPException) as e:
            llm.extract_metadata("t", model_override="llamacpp")
    assert "local model" in e.value.detail["model"]


def test_calls_are_labelled_for_the_run_log():
    seen = {}

    def fake(job, user, messages, **kw):
        from services.ai import usage as usage_log
        ctx = usage_log._context.get()
        seen.update(surface=ctx.surface, job=ctx.job)
        return "{}"

    with patch.object(llm, "complete_with_fallback", side_effect=fake):
        llm.extract_metadata("t")
    assert seen == {"surface": "ingest", "job": "metadata"}
