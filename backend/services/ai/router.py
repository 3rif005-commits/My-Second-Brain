"""Capability-based job routing.

pick(job, user_id) returns the best available Provider for a job type, or None
when no provider can do it (caller degrades gracefully).

Job types and their preference chains:
  summarize_video   video_native > text  (text = caller passes transcript)
  summarize_text    text (API first) > local
  chat              text (API first) > local
  formula_ocr       vision > None
  vision            vision > None
  synthesize_vision vision > None  (note synthesis WITH the source's figures)
"""
from __future__ import annotations

from typing import Callable

from services.ai.providers import Provider, list_providers

_JOB_CHAINS: dict[str, list[str]] = {
    "summarize_video": ["video_native", "text"],
    "summarize_text": ["text"],
    "chat": ["text"],
    "formula_ocr": ["vision"],
    "vision": ["vision"],
    "synthesize_vision": ["vision"],
}

# Jobs that may NOT fall back to the local model (quality/capability floor).
_NO_LOCAL = {"formula_ocr", "vision", "synthesize_vision"}


def candidates(job: str, user_id: str, providers: list[Provider] | None = None) -> list[Provider]:
    """All providers matching the job's capability chain, best first.

    Callers should try them in order — a configured key can still fail at
    request time (quota exhausted, endpoint down), and the next candidate is
    the graceful-degradation path.
    """
    chain = _JOB_CHAINS.get(job, ["text"])
    pool = providers if providers is not None else list_providers(user_id)
    if job in _NO_LOCAL:
        pool = [p for p in pool if p.provider != "local"]
    out: list[Provider] = []
    for cap in chain:
        for p in pool:
            if cap in p.capabilities and p not in out:
                out.append(p)
    return out


def pick(job: str, user_id: str, providers: list[Provider] | None = None) -> Provider | None:
    """Return the first provider matching the job's capability chain."""
    ranked = candidates(job, user_id, providers)
    return ranked[0] if ranked else None


def with_model_override(pool: list[Provider], model: str | None) -> list[Provider]:
    """Narrow a candidate chain to one explicitly chosen model.

    The ingest page lets the user pick the model per request (the X-LLM-Model
    header), and that choice has to survive the move onto this gateway. Two
    shapes: "llamacpp"/"local" means the on-device model, anything else is a
    model id to run on the first gateway that can carry one.
    """
    from dataclasses import replace

    if not model:
        return pool
    if model in ("llamacpp", "local"):
        return [p for p in pool if p.provider == "local"] or [
            Provider(provider="local", label="Local (Gemma)", capabilities={"text"})]
    # A model id its own provider serves goes to that provider: "claude-…" to
    # Anthropic, "gemini-…" to Gemini. Sending a bare Claude id to the first
    # OpenAI-compatible gateway (OpenRouter wants "anthropic/…") was a 400
    # every time, even with Anthropic configured.
    for prefix, provider in _NATIVE_PREFIXES:
        if model.startswith(prefix):
            for p in pool:
                if p.provider == provider:
                    return [replace(p, chat_model=model)]
    for p in pool:
        if p.provider in ("openai_compatible", "openai"):
            return [replace(p, chat_model=model)]
    return pool


#: Model-id prefixes a provider serves under its own API.
_NATIVE_PREFIXES = (("claude-", "anthropic"), ("gemini-", "gemini"),
                    ("gpt-", "openai"), ("o1", "openai"), ("o3", "openai"),
                    ("o4", "openai"))


def complete_with_fallback(job: str, user_id: str, messages: list[dict],
                           max_tokens: int = 4096,
                           validate: Callable[[str], bool] | None = None,
                           model_override: str | None = None) -> str:
    """Run a completion, falling through the candidate chain on failure.

    A provider can return HTTP 200 with content that's useless for the job
    (e.g. a reasoning-heavy free model emitting its chain-of-thought instead
    of the requested output) — that's not an exception, so without `validate`
    it's accepted as success and the chain never gets a chance to try the
    next, likely more reliable, candidate. Pass a job-specific sanity check
    to treat a malformed response the same as a failure.
    """
    from services.ai.client import complete
    from services.ai import usage as usage_log

    errors: list[str] = []
    for p in with_model_override(candidates(job, user_id), model_override):
        try:
            # Each attempt is its own run row: a fallback chain that burned two
            # providers cost two calls, and the log should say so.
            with usage_log.annotate(job=job, user_id=user_id):
                result = complete(p, messages, max_tokens=max_tokens)
        except Exception as e:  # quota, network, bad key — try the next one
            errors.append(f"{p.label or p.provider}: {str(e)[:120]}")
            continue
        if validate is not None and not validate(result):
            errors.append(f"{p.label or p.provider}: response failed validation "
                          "(looks incomplete or malformed)")
            continue
        return result
    raise RuntimeError(
        "All AI providers failed for job "
        f"'{job}': {' | '.join(errors) if errors else 'none configured'}"
    )
