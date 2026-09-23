"""Which model serves an agent turn.

The agent's provider selection used to be its own thing — `settings.api_provider`
— separate from the chain the workspace and the eval runner use, and its
"anthropic" branch returned the Messages API URL while the engine sent OpenAI
chat-completions JSON. Now it returns a Provider and `services.ai.agent_stream`
owns the wire format, so Claude is a real option for an agent turn and the
refusal is reserved for dialects that genuinely have no adapter.
"""
from unittest.mock import patch

import pytest

from models.agent import Mode
from services.agent import model as model_router
from services.agent.model import get_provider
from services.ai.providers import Provider


def _provider(kind, key="k", base_url="", chat_model="m", label=""):
    return Provider(provider=kind, api_key=key, base_url=base_url,
                    chat_model=chat_model, label=label or kind,
                    capabilities={"text"})


def test_local_mode_returns_the_local_provider():
    """The local endpoint is resolved later, by the stream adapter, so mode
    selection no longer needs SmartRouter at all."""
    p = get_provider(Mode.LOCAL, task="chat")
    assert p.provider == "local"


def test_api_mode_takes_the_first_provider_in_the_chain():
    chain = [_provider("openai_compatible", key="or-key",
                       base_url="https://openrouter.ai/api/v1",
                       chat_model="nvidia/nemotron-3-super-120b-a12b:free",
                       label="OpenRouter (.env)")]
    with patch.object(model_router, "candidates", return_value=chain):
        p = get_provider(Mode.API, task="chat", user_id="u1")

    assert p.provider == "openai_compatible"
    assert p.model == "nvidia/nemotron-3-super-120b-a12b:free"


def test_anthropic_now_drives_the_agent_and_outranks_the_rest():
    """The point of the whole gateway merge: Claude is first in the chain for
    every other job, and an agent turn no longer has to skip it."""
    chain = [_provider("anthropic", chat_model="claude-haiku-4-5"),
             _provider("openai", key="oa-key", chat_model="gpt-4o-mini")]
    with patch.object(model_router, "candidates", return_value=chain):
        p = get_provider(Mode.API, task="chat", user_id="u1")
    assert p.provider == "anthropic"
    assert p.model == "claude-haiku-4-5"


def test_a_provider_with_no_tool_loop_adapter_is_skipped_with_that_reason():
    """Gemini's function calling has its own shape and no adapter yet — say so
    rather than sending it a request it will reject."""
    chain = [_provider("gemini", chat_model="gemini-flash-latest")]
    with patch.object(model_router, "candidates", return_value=chain):
        with pytest.raises(RuntimeError) as e:
            get_provider(Mode.API, task="chat", user_id="u1")
    message = str(e.value)
    assert "no tool-loop adapter" in message
    assert "Local mode" in message


def test_a_keyless_provider_is_skipped_with_that_reason():
    chain = [_provider("openai", key="", chat_model="gpt-4o-mini",
                       label="OpenAI (.env)")]
    with patch.object(model_router, "candidates", return_value=chain):
        with pytest.raises(RuntimeError, match="no API key"):
            get_provider(Mode.API, task="chat", user_id="u1")


def test_no_providers_at_all_is_a_clear_message_not_a_key_error():
    with patch.object(model_router, "candidates", return_value=[]):
        with pytest.raises(RuntimeError, match="none configured"):
            get_provider(Mode.API, task="chat", user_id="u1")
