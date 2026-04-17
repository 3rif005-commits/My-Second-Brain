"""LLM client — OpenRouter (default) or Gemini, switched via LLM_PROVIDER env var."""

import json
import re
from fastapi import HTTPException
from prompts.mastery_guide import build_mastery_guide_prompt
from core.config import settings


# ── OpenRouter (OpenAI-compatible) ─────────────────────────────────────────

_openrouter_client = None
OPENROUTER_MODEL = "google/gemma-4-26b-a4b-it:free"


def _get_openrouter():
    global _openrouter_client
    if _openrouter_client is None:
        from openai import OpenAI
        if not settings.openrouter_api_key:
            raise RuntimeError("OPENROUTER_API_KEY is not set in backend/.env")
        _openrouter_client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=settings.openrouter_api_key,
        )
    return _openrouter_client


def _openrouter_complete(system: str, user: str, model: str | None = None) -> str:
    """Stream the response to avoid free-tier server-side timeouts on large generations."""
    client = _get_openrouter()
    try:
        stream = client.chat.completions.create(
            model=model or OPENROUTER_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_tokens=8192,
            stream=True,
            timeout=240,
        )
        chunks = []
        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                chunks.append(chunk.choices[0].delta.content)
        content = "".join(chunks)
    except Exception as e:
        msg = str(e)
        if "429" in msg or "quota" in msg.lower() or "rate" in msg.lower():
            raise HTTPException(status_code=503, detail=f"OpenRouter rate limit: {msg}")
        raise HTTPException(status_code=502, detail=f"OpenRouter error: {msg}")

    if not content:
        raise HTTPException(status_code=502, detail="OpenRouter returned empty content.")
    return content


# ── Gemini ─────────────────────────────────────────────────────────────────

_gemini_client = None


def _get_gemini():
    global _gemini_client
    if _gemini_client is None:
        from google import genai
        if not settings.google_api_key:
            raise RuntimeError("GOOGLE_API_KEY is not set in backend/.env")
        _gemini_client = genai.Client(api_key=settings.google_api_key)
    return _gemini_client


def _gemini_complete(prompt: str) -> str:
    from google.genai import errors as genai_errors
    client = _get_gemini()
    try:
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=prompt,
        )
        return response.text
    except genai_errors.ClientError as e:
        if e.status_code == 429:
            raise HTTPException(
                status_code=503,
                detail="Gemini API quota exhausted. Enable billing at https://ai.google.dev or wait for daily reset.",
            )
        raise HTTPException(status_code=502, detail=f"Gemini API error: {e}")


# ── Public API ──────────────────────────────────────────────────────────────

def generate_mastery_guide(source_text: str, title: str = "", model_override: str | None = None) -> str:
    """Generate a mastery-guide HTML compatible with BlockNote from source_text."""
    prompt = build_mastery_guide_prompt(source_text, title)

    if settings.llm_provider == "gemini":
        return _gemini_complete(prompt)

    # OpenRouter — identity and format rules are embedded in the prompt itself
    return _openrouter_complete(
        "Follow the instructions in the user message exactly. Output only HTML.",
        prompt,
        model=model_override,
    )


def extract_metadata(source_text: str) -> dict:
    """Return {title: str, topics: list[str]} extracted from source_text."""
    user_prompt = (
        f"Extract the main title and up to 5 topic keywords from the text below.\n"
        f"Return ONLY valid JSON: {{\"title\": \"...\", \"topics\": [\"...\", \"...\"]}}\n\n"
        f"TEXT:\n{source_text[:3000]}"
    )

    if settings.llm_provider == "gemini":
        text = _gemini_complete(user_prompt)
    else:
        text = _openrouter_complete(
            "You extract metadata. Return only valid JSON, no commentary.",
            user_prompt,
        )

    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
    return json.loads(text)
