"""The ingest page's two model calls.

This module used to be a third LLM client, with its own OpenRouter, Gemini and
llama.cpp paths, its own provider order, and no run log or budget. It now calls
`services/ai` like everything else and keeps only the part that was genuinely
its own: `_classify_error`, whose suggestions the ingest page shows to the user
("rate-limited — wait or switch model"), which a bare 500 cannot replace.

The per-request model choice (the X-LLM-Model header) survives as the gateway's
`model_override`.
"""

import json
import logging
import re
import time
from fastapi import HTTPException
from prompts.mastery_guide import build_mastery_guide_prompt
from services.ai import usage as usage_log
from services.ai.router import complete_with_fallback

logger = logging.getLogger(__name__)

OPENROUTER_DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"


# ── OpenRouter error classification ────────────────────────────────────────

def _classify_error(exc: Exception, model: str, elapsed_ms: int) -> HTTPException:
    """Turn a raw OpenRouter exception into a structured HTTPException."""
    msg = str(exc).lower()

    if "429" in msg or "rate limit" in msg or "rate_limit" in msg or "too many requests" in msg:
        return HTTPException(status_code=503, detail={
            "error": f"{model} is rate-limited right now due to high demand.",
            "error_code": "RATE_LIMITED",
            "model": model,
            "suggestion": "Wait a few minutes and try again, or switch to a different model.",
        })

    if "timeout" in msg or "timed out" in msg or elapsed_ms >= 44_000:
        return HTTPException(status_code=504, detail={
            "error": f"{model} did not respond within the timeout ({elapsed_ms // 1000}s).",
            "error_code": "TIMEOUT",
            "model": model,
            "suggestion": "The model may be overloaded. Try again or pick a faster model.",
        })

    if "503" in msg or "service unavailable" in msg or "unavailable" in msg:
        return HTTPException(status_code=503, detail={
            "error": f"{model} is temporarily unavailable (503 from provider).",
            "error_code": "MODEL_UNAVAILABLE",
            "model": model,
            "suggestion": "This endpoint may be degraded. Try a different model.",
        })

    if "502" in msg or "bad gateway" in msg:
        return HTTPException(status_code=502, detail={
            "error": f"{model} returned a bad gateway error.",
            "error_code": "BAD_GATEWAY",
            "model": model,
            "suggestion": "The model's backend may be restarting. Retry in a moment.",
        })

    if "connection" in msg or "econnrefused" in msg or "network" in msg:
        return HTTPException(status_code=503, detail={
            "error": "Could not reach OpenRouter. Check your internet connection.",
            "error_code": "CONNECTION_ERROR",
            "model": model,
            "suggestion": "Verify OPENROUTER_API_KEY is set and you have internet access.",
        })

    # Unknown error — include the raw message so it's debuggable
    return HTTPException(status_code=502, detail={
        "error": f"{model} failed: {str(exc)[:300]}",
        "error_code": "OPENROUTER_ERROR",
        "model": model,
        "suggestion": "Check the backend logs for more detail.",
    })


# ── OpenRouter (OpenAI-compatible) ─────────────────────────────────────────

_openrouter_client = None


def _fallback_model_name(model_override: str | None) -> str:
    """What to call the model in an error message the user will read."""
    if model_override in ("llamacpp", "local"):
        return "the local model"
    return model_override or "the configured model"


def _complete(system: str, user: str, *, max_tokens: int,
              model_override: str | None, request_id: str,
              job: str) -> str:
    """One call through the shared gateway, with this module's error
    classification kept on top.

    Everything else in the app routes through services/ai — provider order,
    fallback, the run log, the budget ceiling. This path used to have its own
    OpenRouter, Gemini and llama.cpp clients and none of that; the only thing
    worth keeping was the classifier, because the ingest page shows its
    suggestions to the user.
    """
    rid = f"rid={request_id} | " if request_id else ""
    logger.info(f"{rid}llm_attempt | job={job} | override={model_override}")
    t0 = time.perf_counter()
    try:
        with usage_log.annotate(surface="ingest", job=job, trigger="user"):
            return complete_with_fallback(
                "summarize_text", "",
                [{"role": "system", "content": system},
                 {"role": "user", "content": user}],
                max_tokens=max_tokens, model_override=model_override)
    except Exception as e:
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        logger.warning(f"{rid}llm_failed | {elapsed_ms}ms | {e}")
        raise _classify_error(e, _fallback_model_name(model_override), elapsed_ms)


# ── Public API ──────────────────────────────────────────────────────────────

def generate_mastery_guide(
    source_text: str,
    title: str = "",
    model_override: str | None = None,
    request_id: str = "",
) -> str:
    system = "Follow the instructions in the user message exactly. Output only HTML."
    local = model_override in ("llamacpp", "local")
    # The on-device model has a small context; the old code fed it a truncated
    # source for exactly this reason and that limit has not changed.
    prompt = build_mastery_guide_prompt(
        source_text[:6000] if local else source_text, title)
    return _complete(system, prompt, max_tokens=2048 if local else 4096,
                     model_override=model_override, request_id=request_id,
                     job="mastery_guide")


def extract_metadata(
    source_text: str,
    model_override: str | None = None,
    request_id: str = "",
) -> dict:
    user_prompt = (
        f"Extract the main title and up to 5 topic keywords from the text below.\n"
        f"Return ONLY valid JSON: {{\"title\": \"...\", \"topics\": [\"...\", \"...\"]}}\n\n"
        f"TEXT:\n{source_text[:1500]}"
    )
    system = "You extract metadata. Return only valid JSON, no commentary."

    text = _complete(system, user_prompt, max_tokens=200,
                     model_override=model_override, request_id=request_id,
                     job="metadata")
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
    return json.loads(text)
