"""Nebius + NVIDIA Nemotron — the hackathon add-on (HACKATHON-NEBIUS).

Everything Nebius-specific lives in this file. The rest of the app calls in at
a handful of places, each marked `HACKATHON-NEBIUS`; removing the add-on is
deleting this file, its test, and those lines (docs/hackathon/NEBIUS.md).
With NEBIUS_API_KEY unset, `enabled()` is False and the app behaves exactly as
it does without this file.

The shape (the user's design):

  front door   a small Nemotron on the user's own Nebius VM (NEBIUS_VM_URL).
               It is the `local` slot — the one private notes may reach — and
               the brain that picks a slot when no rule decided.
  fast/strong  bigger Nemotrons over Nebius Token Factory (NEBIUS_API_KEY).
  fixed rules  private notes go to the front door or are held back; a big
               context always goes to the strong model. The brain decides the
               rest.
  VM off       requests and the brain fall back to Token Factory. Private
               notes never do: the privacy gate holds them back, as it does
               for any cloud provider.
"""
from __future__ import annotations

import logging
import time
from urllib.parse import urlsplit

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

TOKEN_FACTORY_HOST = "api.tokenfactory.nebius.com"
HEALTH_TTL = 30          # seconds a VM health answer is trusted
HEALTH_TIMEOUT = 2.0


def enabled() -> bool:
    return bool(settings.nebius_api_key)


# ── Token Factory: the cloud Nemotrons ──────────────────────────────────────

def token_factory():
    """The Token Factory provider. Its own model is the fast one; the strong
    slot names the strong model (see `apply_defaults`)."""
    from services.ai.providers import Provider
    return Provider("openai_compatible", api_key=settings.nebius_api_key,
                    base_url=settings.nebius_base_url.rstrip("/"),
                    chat_model=settings.nebius_fast_model,
                    label="Nebius Token Factory",
                    capabilities={"text", "long_context"})


def provider_key() -> str:
    """How routing and the privacy settings name Token Factory."""
    return (urlsplit(settings.nebius_base_url).hostname or TOKEN_FACTORY_HOST)


def no_thinking(url: str) -> dict:
    """Extra request fields for a one-shot call (`client.complete`: the brain,
    a ping, a title). Nemotron thinks first by default and the thinking is
    dropped from the answer, so a small budget came back empty — the brain
    got no JSON on the live site and every request took the default slot.
    Token Factory's documented switch is `reasoning_effort: none` (NVIDIA's
    `enable_thinking` alone was ignored there, checked live); a vLLM server on
    the VM reads `enable_thinking`. Chat turns keep their thinking."""
    if not enabled():
        return {}
    vm = _vm_base()
    if urlsplit(url).hostname == provider_key() or (vm and url.startswith(vm)):
        return {"reasoning_effort": "none",
                "chat_template_kwargs": {"enable_thinking": False}}
    return {}


#: Room for a chat round on Token Factory. Nemotron thinks before it answers
#: and the thinking is dropped, so at the app's usual 2,048 a long-context
#: question spent it all thinking and the answer came back empty (live, demo
#: account, 2026-10-28).
CHAT_MAX_TOKENS = 6144


def chat_extras(url: str, max_tokens: int) -> dict:
    """Extra fields for an agent (chat) round: light thinking, enough room.
    Unlike `no_thinking`, chat keeps some reasoning — it is what makes the
    strong model worth routing to."""
    if not enabled() or urlsplit(url).hostname != provider_key():
        return {}
    return {"reasoning_effort": "low", "max_tokens": max(max_tokens, CHAT_MAX_TOKENS)}


def price_for(model: str) -> tuple[float, float] | None | bool:
    """Token Factory's price for one of its models, None when not set, or
    False when the model is not a Token Factory one. Without this the
    `nvidia/nemotron` prefix — free on OpenRouter — would log paid calls as
    free."""
    if not enabled() or model not in (settings.nebius_fast_model,
                                      settings.nebius_strong_model):
        return False
    if settings.nebius_price_in is None:
        return None
    return (settings.nebius_price_in, settings.nebius_price_out or 0.0)


# ── The VM: the front door ──────────────────────────────────────────────────

def _vm_base() -> str:
    url = settings.nebius_vm_url.strip().rstrip("/")
    return url[:-3] if url.endswith("/v1") else url


def vm_configured() -> bool:
    """A VM URL that is safe to send private notes to: https, or http to this
    machine only. Plain http over the internet would carry private notes in
    the clear, so such a URL is refused (logged), not used."""
    base = _vm_base()
    if not base:
        return False
    parts = urlsplit(base)
    if parts.scheme == "https":
        return True
    if parts.scheme == "http" and parts.hostname in ("localhost", "127.0.0.1", "::1"):
        return True
    logger.warning("NEBIUS_VM_URL ignored: it must be https (private notes travel to it)")
    return False


_health = {"alive": False, "checked": 0.0}


def vm_up() -> bool:
    """Is the VM answering? One probe per HEALTH_TTL; /v1/models works on vLLM,
    llama.cpp and any OpenAI-compatible server."""
    if not vm_configured():
        return False
    now = time.monotonic()
    if now - _health["checked"] >= HEALTH_TTL:
        try:
            r = httpx.get(f"{_vm_base()}/v1/models", headers=_vm_headers(),
                          timeout=HEALTH_TIMEOUT)
            alive = r.status_code == 200
        except Exception:                                   # noqa: BLE001
            alive = False
        if alive != _health["alive"]:
            logger.info("nebius | vm %s", "up" if alive else "down")
        _health.update(alive=alive, checked=now)
    return _health["alive"]


def _vm_headers() -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if settings.nebius_vm_api_key:
        h["Authorization"] = f"Bearer {settings.nebius_vm_api_key}"
    return h


def vm_endpoint() -> dict | None:
    """The VM in SmartRouter's endpoint shape, or None when it is off."""
    if not vm_up():
        return None
    return {"url": f"{_vm_base()}/v1/chat/completions", "headers": _vm_headers(),
            "model": settings.nebius_vm_model, "source": "nebius-vm"}


def local_label() -> str | None:
    return "Nemotron (your Nebius VM)" if vm_configured() else None


# ── Routing defaults ────────────────────────────────────────────────────────

def apply_defaults(policy: dict) -> dict:
    """The default routing policy with the Nemotron shape laid over it. Only
    the default: a policy the user saved is theirs and is left alone (Settings
    → Routing → Restore default brings this back)."""
    tf = {"provider": provider_key()}
    policy["slots"]["fast"] = {**tf, "model": settings.nebius_fast_model}
    policy["slots"]["strong"] = {**tf, "model": settings.nebius_strong_model}
    policy["slots"]["long"] = {**tf, "model": settings.nebius_strong_model}
    for rule in policy["rules"]:
        if rule["id"] == "big-context":
            rule["use"] = "strong"          # a big job always gets the strong model
    policy["privacy"]["when_private_needed"] = "local"
    if vm_configured():
        policy["brain"] = {**policy["brain"], "kind": "local"}
    else:
        # The small model decides; never the strong one an only-Nebius
        # account's provider list leads with (`only_providers`).
        policy["brain"] = {**policy["brain"], "kind": "cloud", "provider": provider_key(),
                           "model": settings.nebius_fast_model}
    return policy


def only_nebius(user_id: str) -> bool:
    """Is this account limited to Nebius (NEBIUS_ONLY_USERS)? The demo account
    is, so everything it shows — chat, ingest, study guides, titles, search
    descriptors — really runs on Nemotron."""
    if not enabled() or not user_id:
        return False
    return user_id in {u.strip() for u in settings.nebius_only_users.split(",") if u.strip()}


def only_providers() -> list:
    """The providers such an account gets: Token Factory, with the strong
    model for one-shot jobs (a study guide is the heavy work), and the local
    slot, which `resolve_slot` refuses when no local model answers."""
    from dataclasses import replace
    from services.ai.providers import local_provider
    return [replace(token_factory(), chat_model=settings.nebius_strong_model), local_provider()]


def brain_fallback():
    """When the brain is the VM and the VM is off: Token Factory's fast model
    decides instead. The brain sees the message only, never note text, and the
    rules (sensitive words → local) have already run."""
    if enabled() and vm_configured() and not vm_up():
        return token_factory()
    return None
