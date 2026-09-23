"""AI-generated note descriptor.

It used to build its own HTTP request from an endpoint dict. It now goes
through the shared gateway like everything else, which means it obeys the same
provider chain and its spend appears in the run log — but the contract that
matters is unchanged: a descriptor is a nicety, and indexing must never fail
for want of one.
"""
from unittest.mock import patch

from services.descriptor import generate


def test_generate_returns_the_model_text():
    with patch("services.descriptor.complete_with_fallback",
               return_value="A note about ML."):
        assert generate("Machine Learning", ["gradient descent", "backprop"]) \
            == "A note about ML."


def test_the_prompt_carries_the_title_and_the_content():
    with patch("services.descriptor.complete_with_fallback",
               return_value="ok") as call:
        generate("My Note Title", ["block one text", "block two text"])

    job, _user, messages = call.call_args[0][:3]
    prompt = messages[0]["content"]
    assert job == "summarize_text"
    assert "My Note Title" in prompt
    assert "block one text" in prompt


def test_whitespace_is_stripped():
    with patch("services.descriptor.complete_with_fallback",
               return_value="  Padded descriptor.  "):
        assert generate("Title", ["block"]) == "Padded descriptor."


def test_a_provider_failure_falls_back_to_the_title_and_first_block():
    with patch("services.descriptor.complete_with_fallback",
               side_effect=RuntimeError("all providers failed")):
        result = generate("Deep Learning", ["neural networks are used everywhere"])
    assert result.startswith("Deep Learning")
    assert "neural networks" in result


def test_an_empty_answer_also_falls_back():
    """A model that returns nothing is a failed call wearing a success."""
    with patch("services.descriptor.complete_with_fallback", return_value="   "):
        assert generate("Deep Learning", ["neural nets"]).startswith("Deep Learning")


def test_fallback_with_no_blocks_is_just_the_title():
    with patch("services.descriptor.complete_with_fallback",
               side_effect=RuntimeError("no key")):
        assert generate("Empty Note", []) == "Empty Note."
