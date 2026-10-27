"""Provider registry for the provider-agnostic AI layer.

A provider = a configured way to reach a model API, with a capability set.
Sources, in priority order:
  1. rows in the ai_providers table for this user (user-configured keys)
  2. .env fallbacks (google_api_key → gemini, anthropic/openai/openrouter keys)
  3. the local Gemma endpoint via SmartRouter (always present, text-only)

Capabilities:
  text          — chat/completion over text
  vision        — image inputs
  video_native  — native video understanding (file or YouTube URL)
  long_context  — ≥100K token context
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from core.config import settings

logger = logging.getLogger(__name__)

DEFAULT_MODELS = {
    "gemini": "gemini-flash-latest",
    "anthropic": "claude-haiku-4-5",
    "openai": "gpt-4o-mini",
    "openai_compatible": settings.api_model_openrouter,
}

CAPABILITIES = {
    "gemini": {"text", "vision", "video_native", "long_context"},
    # "batch": the provider has an asynchronous half-price API. A capability
    # flag on the provider, never a check for a model name.
    "anthropic": {"text", "vision", "long_context", "batch"},
    "openai": {"text", "vision", "long_context"},
    "openai_compatible": {"text"},   # conservative: unknown gateway models
    "local": {"text"},
}


@dataclass
class Provider:
    provider: str                    # gemini | anthropic | openai | openai_compatible | local
    api_key: str = ""
    base_url: str = ""               # openai_compatible only
    chat_model: str = ""
    label: str = ""
    capabilities: set[str] = field(default_factory=set)

    @property
    def model(self) -> str:
        return self.chat_model or DEFAULT_MODELS.get(self.provider, "")


def _host_of(url: str) -> str:
    """A readable label when none was configured — the run log should say
    "api.deepseek.com", not "openai_compatible"."""
    return (url or "").split("//")[-1].split("/")[0] or "custom"


def disabled_providers() -> set[str]:
    return {p.strip().lower() for p in (settings.ai_disabled_providers or "").split(",")
            if p.strip()}


def _env_providers() -> list[Provider]:
    """Providers derived from .env settings (server-level configuration).

    Order is preference order — `router.candidates()` keeps it, and
    `complete_with_fallback` walks it in order. Anthropic comes first because
    it is the provider this app is tuned for: the note prompts target the app's
    own BlockNote block structure, and Claude is what that structure is
    validated against. Gemini stays ahead of the rest for the video-native jobs
    only Gemini can do (the capability chain, not this list, decides that).
    """
    out: list[Provider] = []
    if settings.anthropic_api_key:
        out.append(Provider("anthropic", api_key=settings.anthropic_api_key,
                            chat_model=settings.api_model_anthropic,
                            label="Anthropic (.env)", capabilities=set(CAPABILITIES["anthropic"])))
    if settings.custom_llm_base_url and settings.custom_llm_api_key:
        out.append(Provider(
            "openai_compatible", api_key=settings.custom_llm_api_key,
            base_url=settings.custom_llm_base_url.rstrip("/"),
            chat_model=settings.custom_llm_model,
            label=settings.custom_llm_label or _host_of(settings.custom_llm_base_url),
            capabilities=set(CAPABILITIES["openai_compatible"])))
    if settings.google_api_key:
        out.append(Provider("gemini", api_key=settings.google_api_key,
                            label="Gemini (.env)", capabilities=set(CAPABILITIES["gemini"])))
    if settings.openai_api_key:
        out.append(Provider("openai", api_key=settings.openai_api_key,
                            chat_model=settings.api_model_openai,
                            label="OpenAI (.env)", capabilities=set(CAPABILITIES["openai"])))
    if settings.openrouter_api_key:
        out.append(Provider("openai_compatible", api_key=settings.openrouter_api_key,
                            base_url="https://openrouter.ai/api/v1",
                            chat_model=settings.api_model_openrouter,
                            label="OpenRouter (.env)",
                            capabilities=set(CAPABILITIES["openai_compatible"])))
    return out


def _base_url_allowed(url: str) -> bool:
    """A saved row is re-checked on use (the name may resolve elsewhere now, or
    the row predates the check). Refused rows drop out of the chain: the next
    provider answers instead, as for any provider that cannot serve."""
    from services import egress
    try:
        egress.check_url(url, cached=True)
        return True
    except egress.EgressBlocked as e:
        logger.warning("AI provider at %s skipped: %s", url, e)
        return False


def _user_providers(user_id: str) -> list[Provider]:
    from services.database import get_supabase
    if not user_id:
        return []          # no user, no saved rows — skip the doomed query
    try:
        rows = (
            get_supabase()
            .table("ai_providers")
            .select("*")
            .eq("user_id", user_id)
            .eq("enabled", True)
            .execute()
            .data
            or []
        )
    except Exception:
        return []
    out = []
    for r in rows:
        p = r["provider"]
        if r.get("base_url") and not _base_url_allowed(r["base_url"]):
            continue
        out.append(Provider(
            provider=p,
            api_key=r.get("api_key") or "",
            base_url=r.get("base_url") or "",
            chat_model=r.get("chat_model") or "",
            label=r.get("label") or p,
            capabilities=set(CAPABILITIES.get(p, {"text"})),
        ))
    return out


def local_provider() -> Provider:
    return Provider("local", label="Local (Gemma)", capabilities=set(CAPABILITIES["local"]))


def _drop_disabled(providers: list[Provider]) -> list[Provider]:
    off = disabled_providers()
    return [p for p in providers if p.provider not in off]


def list_providers(user_id: str) -> list[Provider]:
    """All usable providers for a user, in preference order.

    The base order is the old one — the user's own saved rows, then .env, then
    the local model as the last resort — with one rule laid over the top:
    **Anthropic outranks everything, wherever it came from.** This app's note
    prompts target the app's own BlockNote block structure (callouts, math
    blocks, `<details>` toggles) and that markup is written against Claude, so
    a Gemini or OpenRouter key left behind in Settings → AI Providers must not
    quietly take the synthesis job back and produce a note the editor parses
    into something else.

    The sort is stable, so within the Anthropic group a user's own key still
    beats the .env one, and every other provider keeps its previous relative
    order. Capability routing is unaffected: `router.candidates()` walks the
    job's capability chain first, so `summarize_video` still reaches Gemini —
    Claude has no `video_native`, so it is not a candidate for that chain at
    all.

    `AI_DISABLED_PROVIDERS` removes a provider from the chain entirely. A
    provider with no credit balance is not a fallback — it is a guaranteed
    failure on every call, a wasted round trip and an error row each time — so
    when Anthropic runs dry, turning it off is how the app stops paying for it
    in latency. The local model is never dropped: it is the floor.
    """
    ordered = _drop_disabled(
        _user_providers(user_id) + _env_providers()) + [local_provider()]
    return sorted(ordered, key=lambda p: 0 if p.provider == "anthropic" else 1)
