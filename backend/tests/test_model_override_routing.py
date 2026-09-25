"""A chosen model goes to the provider that serves it. A bare Claude id sent
to OpenRouter (which wants "anthropic/…") was a 400 on every call, even with
Anthropic configured — found by E8's first eval call."""
from services.ai.providers import Provider
from services.ai.router import with_model_override

POOL = [Provider("anthropic", api_key="k"),
        Provider("openai_compatible", api_key="k", base_url="https://openrouter.ai/api/v1"),
        Provider("local")]


def test_a_claude_id_goes_to_anthropic():
    [p] = with_model_override(POOL, "claude-haiku-4-5")
    assert p.provider == "anthropic" and p.model == "claude-haiku-4-5"


def test_a_gateway_id_goes_to_the_gateway():
    [p] = with_model_override(POOL, "anthropic/claude-haiku-4.5")
    assert p.provider == "openai_compatible" and p.model == "anthropic/claude-haiku-4.5"


def test_a_claude_id_without_anthropic_falls_back_to_the_gateway():
    [p] = with_model_override(POOL[1:], "claude-haiku-4-5")
    assert p.provider == "openai_compatible"


def test_local_and_none_are_unchanged():
    assert with_model_override(POOL, None) == POOL
    assert with_model_override(POOL, "local")[0].provider == "local"
