"""A custom OpenAI-compatible provider, and switching a dead one off.

Written for DeepSeek (api.deepseek.com, model `deepseek-flash`) but nothing
here is DeepSeek-specific: any platform speaking /v1/chat/completions works,
which is the point.
"""
import pytest

from services.ai import pricing
from services.ai.providers import Provider, disabled_providers, list_providers


@pytest.fixture
def custom(monkeypatch):
    from core.config import settings
    monkeypatch.setattr(settings, "custom_llm_base_url", "https://api.deepseek.com")
    monkeypatch.setattr(settings, "custom_llm_api_key", "sk-test")
    monkeypatch.setattr(settings, "custom_llm_model", "deepseek-flash")
    monkeypatch.setattr(settings, "custom_llm_label", "")
    monkeypatch.setattr(settings, "ai_disabled_providers", "")
    return settings


def _chain(user_id=""):
    return [(p.provider, p.model) for p in list_providers(user_id)]


def test_a_configured_custom_provider_joins_the_chain(custom):
    assert ("openai_compatible", "deepseek-flash") in _chain()


def test_it_is_skipped_without_a_key(custom, monkeypatch):
    monkeypatch.setattr(custom, "custom_llm_api_key", "")
    assert all(model != "deepseek-flash" for _, model in _chain())


def test_the_label_defaults_to_the_host_so_the_run_log_is_readable(custom):
    p = next(p for p in list_providers("") if p.model == "deepseek-flash")
    assert p.label == "api.deepseek.com"


def test_a_disabled_provider_leaves_the_chain(custom, monkeypatch):
    """A provider with no balance is not a fallback — it is a guaranteed
    failure on every call, and it used to be tried first."""
    monkeypatch.setattr(custom, "ai_disabled_providers", "anthropic, gemini")
    assert disabled_providers() == {"anthropic", "gemini"}
    kinds = [kind for kind, _ in _chain()]
    assert "anthropic" not in kinds and "gemini" not in kinds
    assert ("openai_compatible", "deepseek-flash") in _chain()


def test_the_local_model_is_never_dropped(custom, monkeypatch):
    """It is the floor: with everything else off, work still has somewhere to
    go."""
    monkeypatch.setattr(custom, "ai_disabled_providers",
                        "anthropic,gemini,openai,openai_compatible,local")
    assert ("local", "") in _chain()


def test_an_unpriced_custom_model_reports_no_dollar_figure(custom):
    assert pricing.price_for("deepseek-flash") is None


def test_a_configured_price_is_used(custom, monkeypatch):
    monkeypatch.setattr(custom, "custom_llm_price_in", 0.27)
    monkeypatch.setattr(custom, "custom_llm_price_out", 1.10)
    assert pricing.price_for("deepseek-flash") == (0.27, 1.10)
    assert pricing.estimate_usd("deepseek-flash", 1_000_000, 0) == 0.27


def test_a_free_tier_can_be_declared_zero(custom, monkeypatch):
    """Zero is a claim the user makes deliberately; the default stays unknown,
    because "unknown" and "free" are different answers."""
    monkeypatch.setattr(custom, "custom_llm_price_in", 0.0)
    monkeypatch.setattr(custom, "custom_llm_price_out", 0.0)
    assert pricing.estimate_usd("deepseek-flash", 5_000, 5_000) == 0.0
