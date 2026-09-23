"""Which model serves an agent turn.

The agent's provider selection used to be its own thing — `settings.api_provider`
— separate from the chain the workspace and the eval runner use. Worse, the
"anthropic" branch returned the Messages API URL while the engine sends OpenAI
chat-completions JSON, so that setting produced a turn that failed on its first
request. Both are fixed here: one provider chain, and an honest refusal where a
dialect is not supported yet.
"""
from unittest.mock import patch

import pytest

from models.agent import Mode
from services.agent import model as model_router
from services.agent.model import get_endpoint
from services.ai.providers import Provider


def _provider(kind, key="k", base_url="", chat_model="m", label=""):
    return Provider(provider=kind, api_key=key, base_url=base_url,
                    chat_model=chat_model, label=label or kind,
                    capabilities={"text"})


@patch("services.agent.model.smart_router")
def test_local_uses_smart_router(mock_smart):
    mock_smart.get_endpoint.return_value = {
        "url": "http://tablet:8082/v1/chat/completions",
        "headers": {"Content-Type": "application/json"},
        "model": "gemma-4-e2b",
        "source": "tablet",
    }
    ep = get_endpoint(Mode.LOCAL, task="chat")
    assert ep["source"] == "tablet"
    assert "tablet" in ep["url"]


def test_api_mode_takes_the_first_openai_dialect_provider_in_the_chain():
    chain = [_provider("openai_compatible", key="or-key",
                       base_url="https://openrouter.ai/api/v1",
                       chat_model="nvidia/nemotron-3-super-120b-a12b:free",
                       label="OpenRouter (.env)")]
    with patch.object(model_router, "candidates", return_value=chain):
        ep = get_endpoint(Mode.API, task="chat", user_id="u1")

    assert ep["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert ep["headers"]["Authorization"] == "Bearer or-key"
    assert ep["model"] == "nvidia/nemotron-3-super-120b-a12b:free"
    assert ep["provider"] == "openai_compatible"


def test_anthropic_is_skipped_for_now_instead_of_returning_a_broken_endpoint():
    """The old code handed back Anthropic's Messages URL with an OpenAI payload,
    which 400s on the first request. Until the client speaks the Anthropic tool
    dialect, an agent turn must say so."""
    with patch.object(model_router, "candidates",
                      return_value=[_provider("anthropic", chat_model="claude-haiku-4-5")]):
        with pytest.raises(RuntimeError) as e:
            get_endpoint(Mode.API, task="chat", user_id="u1")

    message = str(e.value)
    assert "anthropic" in message.lower()
    assert "tool dialect" in message            # says WHY, not just "failed"
    assert "Local mode" in message              # and what the user can do


def test_a_compatible_provider_behind_anthropic_is_still_used():
    chain = [_provider("anthropic", chat_model="claude-haiku-4-5"),
             _provider("openai", key="oa-key", chat_model="gpt-4o-mini")]
    with patch.object(model_router, "candidates", return_value=chain):
        ep = get_endpoint(Mode.API, task="chat", user_id="u1")
    assert ep["url"] == "https://api.openai.com/v1/chat/completions"
    assert ep["model"] == "gpt-4o-mini"


def test_a_keyless_provider_is_skipped_with_that_reason():
    chain = [_provider("openai", key="", chat_model="gpt-4o-mini",
                       label="OpenAI (.env)")]
    with patch.object(model_router, "candidates", return_value=chain):
        with pytest.raises(RuntimeError, match="no API key"):
            get_endpoint(Mode.API, task="chat", user_id="u1")


def test_no_providers_at_all_is_a_clear_message_not_a_key_error():
    with patch.object(model_router, "candidates", return_value=[]):
        with pytest.raises(RuntimeError, match="none configured"):
            get_endpoint(Mode.API, task="chat", user_id="u1")
