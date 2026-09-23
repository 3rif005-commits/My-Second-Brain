"""Which model serves an agent turn.

Local mode still reuses SmartRouter (tablet first, llama.cpp behind it). API
mode no longer reads `settings.api_provider` on its own: it asks
`services/ai` for the same provider chain the workspace and the eval runner
use, so there is one provider configuration in the app rather than three.

One restriction, stated instead of hidden. The agent engine speaks the OpenAI
chat-completions dialect — streamed `tool_calls`, `tool` reply messages — and
Anthropic's Messages API uses a different tool dialect entirely. This module
used to hand back Anthropic's URL with the OpenAI payload unchanged, which
fails on the first request; an agent turn now refuses with an explanation
instead. Teaching `services/ai/client` the Anthropic tool dialect is the second
half of the gateway merge, and it is what will let Claude drive the agent.
"""
from __future__ import annotations

from typing import Any, Literal

from models.agent import Mode
from services.ai.providers import Provider
from services.ai.router import candidates
from services.router import smart_router

#: Providers whose wire format the engine already speaks.
OPENAI_DIALECT = {"openai", "openai_compatible", "local"}


def _endpoint_for(p: Provider) -> dict[str, Any]:
    if p.provider == "local":
        return smart_router.get_endpoint()
    url = ("https://api.openai.com/v1/chat/completions" if p.provider == "openai"
           else f"{(p.base_url or '').rstrip('/')}/chat/completions")
    return {
        "url": url,
        "headers": {"Content-Type": "application/json",
                    "Authorization": f"Bearer {p.api_key}"},
        "model": p.model,
        "source": p.label or p.provider,
        "provider": p.provider,
    }


def get_endpoint(mode: Mode, task: Literal["chat", "classify"] = "chat",
                 user_id: str | None = None) -> dict[str, Any]:
    """Return endpoint config: {url, headers, model, source, provider}.

    Raises RuntimeError when no configured provider can serve an agent turn,
    naming the ones that were skipped and why — "no API key" and "cannot do
    tool calls in this dialect" are different problems with different fixes.
    """
    if mode == Mode.LOCAL:
        return smart_router.get_endpoint()

    pool = candidates("chat", user_id or "")
    skipped: list[str] = []
    for p in pool:
        if p.provider in OPENAI_DIALECT:
            endpoint = _endpoint_for(p)
            if p.provider != "local" and not p.api_key:
                skipped.append(f"{p.label or p.provider} (no API key)")
                continue
            return endpoint
        skipped.append(f"{p.label or p.provider} (agent turns need the OpenAI "
                       f"tool dialect; {p.provider} is not wired for it yet)")

    detail = "; ".join(skipped) if skipped else "none configured"
    raise RuntimeError(
        "No provider can serve an agent turn — " + detail
        + ". Add an OpenRouter or OpenAI key, or switch this thread to Local mode."
    )
