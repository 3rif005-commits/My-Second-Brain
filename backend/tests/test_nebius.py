"""HACKATHON-NEBIUS: the Nemotron-on-Nebius add-on (services/nebius.py).

Off by default, and off means the app is unchanged. On: Token Factory fills
fast/strong, the VM is the front door, a big context goes strong, and when the
VM is off the request falls back to Token Factory while private notes stay
behind.
"""
import asyncio

import httpx
import pytest

from core.config import settings
from services import nebius
from services.ai import pricing, providers
from services.routing import brain as brain_mod
from services.routing import policy as policy_mod
from services.routing import switchboard
from services.routing.rules import Signals

TF = "api.tokenfactory.nebius.com"

pytestmark = pytest.mark.real_routing


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setattr(settings, "nebius_api_key", "tf-test-key")
    monkeypatch.setattr(settings, "nebius_vm_url", "")
    monkeypatch.setattr(settings, "nebius_vm_api_key", "vm-test-key")
    for k in ("anthropic_api_key", "google_api_key", "openai_api_key",
              "openrouter_api_key", "custom_llm_api_key"):
        monkeypatch.setattr(settings, k, "")
    monkeypatch.setattr(settings, "llm_provider", "openrouter")
    monkeypatch.setattr(settings, "litert_url", "")
    nebius._health.update(alive=False, checked=0.0)
    yield
    nebius._health.update(alive=False, checked=0.0)


def _vm(monkeypatch, alive: bool, url="https://203.0.113.7.sslip.io"):
    monkeypatch.setattr(settings, "nebius_vm_url", url)
    seen = []

    def get(u, headers=None, timeout=None):
        seen.append((u, headers))
        if not alive:
            raise httpx.ConnectError("refused")
        return httpx.Response(200, json={"data": []})
    monkeypatch.setattr(nebius.httpx, "get", get)
    return seen


def _route(policy, slot=None):
    return asyncio.run(switchboard.route(policy, "", Signals(query="hi", query_chars=2),
                                         manual_slot=slot))


# ── off: nothing changes ────────────────────────────────────────────────────

def test_off_leaves_the_app_as_it_was(monkeypatch):
    monkeypatch.setattr(settings, "nebius_api_key", "")
    monkeypatch.setattr(settings, "nebius_vm_url", "")
    p = policy_mod.default_policy()
    assert p["slots"]["fast"] == {"provider": "auto", "model": ""}
    assert p["brain"]["kind"] == "rules_only"
    assert not any(x.label == "Nebius Token Factory" for x in providers._env_providers())
    assert providers.local_provider().label == "Local (Gemma)"
    # OpenRouter's free Nemotron stays free.
    assert pricing.price_for("nvidia/nemotron-3-super-120b-a12b:free") == (0.0, 0.0)


# ── on: the routing shape ───────────────────────────────────────────────────

def test_default_policy_puts_nemotron_on_every_cloud_slot(on):
    p = policy_mod.default_policy()
    assert p["slots"]["fast"] == {"provider": TF, "model": settings.nebius_fast_model}
    assert p["slots"]["strong"] == {"provider": TF, "model": settings.nebius_strong_model}
    assert p["slots"]["local"]["provider"] == "local"
    big = next(r for r in p["rules"] if r["id"] == "big-context")
    assert big["use"] == "strong"
    assert p["privacy"]["when_private_needed"] == "local"
    assert p["brain"] == {**p["brain"], "kind": "cloud", "provider": TF}


def test_with_a_vm_the_front_door_is_the_brain(on, monkeypatch):
    _vm(monkeypatch, alive=True)
    assert policy_mod.default_policy()["brain"]["kind"] == "local"


def test_a_saved_policy_is_left_alone(on):
    saved = policy_mod.validate({})            # what a pre-Nebius save looked like
    saved["slots"]["fast"] = {"provider": "auto", "model": ""}
    assert policy_mod.validate(saved)["slots"]["fast"] == {"provider": "auto", "model": ""}


def test_strong_slot_reaches_token_factory_with_the_strong_model(on):
    r = _route(policy_mod.default_policy(), slot="strong")
    assert r.provider.label == "Nebius Token Factory"
    assert r.provider.model == settings.nebius_strong_model
    assert r.provider.base_url == settings.nebius_base_url
    assert r.ceiling == "personal"


def test_big_context_goes_strong_without_asking_the_brain(on, monkeypatch):
    async def never(*a, **k):
        raise AssertionError("a rule decided; the brain must not run")
    monkeypatch.setattr(brain_mod, "decide", never)
    r = asyncio.run(switchboard.route(policy_mod.default_policy(), "",
                                      Signals(query="x", est_tokens=50_000)))
    assert r.slot == "strong" and r.decided_by == "rule"


# ── the VM ──────────────────────────────────────────────────────────────────

def test_vm_up_is_the_local_slot_with_its_key(on, monkeypatch):
    seen = _vm(monkeypatch, alive=True)
    from services.router import smart_router
    ep = smart_router.get_endpoint()
    assert ep["source"] == "nebius-vm"
    assert ep["url"] == "https://203.0.113.7.sslip.io/v1/chat/completions"
    assert ep["headers"]["Authorization"] == "Bearer vm-test-key"
    assert seen[0][0].endswith("/v1/models")
    r = _route(policy_mod.default_policy(), slot="local")
    assert r.is_local and r.ceiling == "private"
    assert r.provider.label == "Nemotron (your Nebius VM)"


def test_vm_off_falls_back_to_token_factory_never_with_private_notes(on, monkeypatch):
    _vm(monkeypatch, alive=False)
    pol = policy_mod.default_policy()
    pol["rules"].insert(0, {"id": "t", "enabled": True, "kind": "always",
                            "value": None, "use": "local"})
    r = _route(pol)
    assert r.slot == "fast" and r.decided_by == "fallback"
    assert r.provider.label == "Nebius Token Factory"
    assert r.ceiling == "personal", "the cloud ceiling: private notes are held back"


def test_vm_off_and_you_picked_local_is_an_error_not_the_cloud(on, monkeypatch):
    _vm(monkeypatch, alive=False)
    with pytest.raises(switchboard.NoProvider):
        _route(policy_mod.default_policy(), slot="local")


def test_vm_off_the_brain_falls_back_to_token_factory(on, monkeypatch):
    _vm(monkeypatch, alive=False)
    bp = brain_mod.brain_provider(policy_mod.default_policy() | {"brain": {"kind": "local"}}, "")
    assert bp.label == "Nebius Token Factory"


def test_vm_health_is_cached(on, monkeypatch):
    seen = _vm(monkeypatch, alive=True)
    for _ in range(5):
        assert nebius.vm_up()
    assert len(seen) == 1


@pytest.mark.parametrize("url,ok", [
    ("https://vm.example.com", True),
    ("https://vm.example.com/v1/", True),
    ("http://127.0.0.1:8000", True),
    ("http://203.0.113.7:8000", False),        # private notes in the clear
    ("ftp://vm.example.com", False),
])
def test_vm_url_must_be_https_off_this_machine(on, monkeypatch, url, ok):
    monkeypatch.setattr(settings, "nebius_vm_url", url)
    assert nebius.vm_configured() is ok


# ── cost ────────────────────────────────────────────────────────────────────

def test_token_factory_nemotron_is_not_logged_as_free(on, monkeypatch):
    assert pricing.price_for(settings.nebius_strong_model) is None   # unknown, not $0
    monkeypatch.setattr(settings, "nebius_price_in", 0.3)
    monkeypatch.setattr(settings, "nebius_price_out", 0.9)
    assert pricing.price_for(settings.nebius_fast_model) == (0.3, 0.9)


# ── one-shot calls skip Nemotron's thinking ─────────────────────────────────

def test_one_shot_calls_to_nebius_turn_thinking_off(on, monkeypatch):
    _vm(monkeypatch, alive=True)
    off = {"reasoning_effort": "none", "chat_template_kwargs": {"enable_thinking": False}}
    assert nebius.no_thinking("https://api.tokenfactory.nebius.com/v1/chat/completions") == off
    assert nebius.no_thinking("https://203.0.113.7.sslip.io/v1/chat/completions") == off
    assert nebius.no_thinking("https://openrouter.ai/api/v1/chat/completions") == {}
    assert nebius.no_thinking("https://api.tokenfactory.nebius.com.evil.example/v1") == {}


def test_thinking_switch_reaches_the_wire(on, monkeypatch):
    from services.ai import client
    sent = {}

    class _Resp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def raise_for_status(self): pass
        def iter_lines(self):
            yield 'data: {"choices":[{"delta":{"content":"{\\"slot\\":\\"fast\\"}"}}]}'
            yield "data: [DONE]"

    def stream(method, url, headers=None, json=None, timeout=None):
        sent.update(json)
        return _Resp()
    monkeypatch.setattr(client.httpx, "stream", stream)
    out = client.complete(nebius.token_factory(), [{"role": "user", "content": "x"}], 60)
    assert out == '{"slot":"fast"}'
    assert sent["reasoning_effort"] == "none"
    assert sent["chat_template_kwargs"] == {"enable_thinking": False}


def test_off_sends_nothing_extra(monkeypatch):
    monkeypatch.setattr(settings, "nebius_api_key", "")
    assert nebius.no_thinking("https://api.tokenfactory.nebius.com/v1/chat/completions") == {}


def test_no_vm_at_all_local_falls_back_to_token_factory(on):
    # Found live: with no VM the brain picked "local" for a notes search and
    # the chat errored — nothing runs locally on the server.
    pol = policy_mod.default_policy()
    pol["rules"].insert(0, {"id": "t", "enabled": True, "kind": "always",
                            "value": None, "use": "local"})
    r = _route(pol)
    assert r.slot == "fast" and r.provider.label == "Nebius Token Factory"
    assert r.ceiling == "personal"


def test_chat_rounds_on_token_factory_think_lightly_with_room(on):
    extras = nebius.chat_extras("https://api.tokenfactory.nebius.com/v1/chat/completions", 2048)
    assert extras == {"reasoning_effort": "low", "max_tokens": nebius.CHAT_MAX_TOKENS}
    assert nebius.chat_extras("https://openrouter.ai/api/v1/chat/completions", 2048) == {}


def test_chat_extras_off_without_the_add_on(monkeypatch):
    monkeypatch.setattr(settings, "nebius_api_key", "")
    assert nebius.chat_extras("https://api.tokenfactory.nebius.com/v1/chat/completions", 2048) == {}


def test_an_only_nebius_account_gets_nebius_and_nothing_else(on, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-ant-real")
    monkeypatch.setattr(settings, "nebius_only_users", "demo-user, other")
    demo = providers.list_providers("demo-user")
    assert [p.provider for p in demo] == ["openai_compatible", "local"]
    assert demo[0].label == "Nebius Token Factory"
    assert demo[0].chat_model == settings.nebius_strong_model     # the heavy work
    # Everyone else keeps their own providers, Claude first.
    assert providers.list_providers("someone-else")[0].provider == "anthropic"


def test_only_nebius_needs_a_user_and_the_add_on(on, monkeypatch):
    monkeypatch.setattr(settings, "nebius_only_users", "demo-user")
    assert not nebius.only_nebius("")
    monkeypatch.setattr(settings, "nebius_api_key", "")
    assert not nebius.only_nebius("demo-user")


def test_the_brain_stays_the_small_model_for_an_only_nebius_account(on, monkeypatch):
    monkeypatch.setattr(settings, "nebius_only_users", "demo-user")
    policy = policy_mod.default_policy()
    bp = brain_mod.brain_provider(policy, "demo-user")
    assert bp.chat_model == settings.nebius_fast_model


def test_the_cloud_brain_gets_time_for_the_network(on):
    assert policy_mod.default_policy()["brain"]["timeout_ms"] >= 6000
