"""Which model serves an agent turn.

Local mode still reuses SmartRouter (tablet first, llama.cpp behind it). API
mode no longer reads `settings.api_provider` on its own: it asks
`services/ai` for the same provider chain the workspace and the eval runner
use, so there is one provider configuration in the app rather than three.

This module used to build raw endpoint dicts, and its `anthropic` branch
returned the Messages API URL for an OpenAI-shaped payload — broken on the
first request. It now returns a Provider and `services.ai.agent_stream` owns
the wire format, so Claude and the OpenAI-compatible gateways are both real
options for an agent turn.
"""
from __future__ import annotations

from typing import Any, Literal

from models.agent import Mode
from services.ai.providers import Provider
from services.ai.router import candidates

#: Dialects `services.ai.agent_stream` can drive a tool loop in. Gemini is the
#: remaining gap: it has its own function-calling shape and no adapter yet.
AGENT_DIALECTS = {"anthropic", "openai", "openai_compatible", "local"}


def get_provider(mode: Mode, task: Literal["chat", "classify"] = "chat",
                 user_id: str | None = None) -> Provider:
    """The provider that will serve this agent turn.

    Raises RuntimeError when none can, naming what was skipped and why — "no
    API key" and "no tool-loop adapter for this provider" are different
    problems with different fixes.
    """
    if mode == Mode.LOCAL:
        return Provider(provider="local", label="Local (Gemma)",
                        capabilities={"text"})

    skipped: list[str] = []
    for p in candidates("chat", user_id or ""):
        if p.provider not in AGENT_DIALECTS:
            skipped.append(f"{p.label or p.provider} (no tool-loop adapter for "
                           f"{p.provider} yet)")
            continue
        if p.provider != "local" and not p.api_key:
            skipped.append(f"{p.label or p.provider} (no API key)")
            continue
        return p

    detail = "; ".join(skipped) if skipped else "none configured"
    raise RuntimeError(
        "No provider can serve an agent turn — " + detail
        + ". Add an Anthropic, OpenRouter or OpenAI key, or switch this thread "
          "to Local mode."
    )
