"""Embedding service — llama.cpp (default) or Gemini.

EMBEDDER_PROVIDER=llamacpp  →  nomic-embed-text via llama.cpp server on port 8081
EMBEDDER_PROVIDER=gemini    →  gemini-embedding-001 (requires billing)
"""

from core.config import settings

EMBEDDING_DIM = 768


def embed(text: str) -> list[float]:
    if settings.embedder_provider == "gemini":
        return _embed_gemini(text)
    return _embed_llamacpp(text)


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed multiple texts; falls back to sequential if batch unsupported."""
    if settings.embedder_provider == "gemini":
        return _embed_gemini_many(texts)
    return _embed_llamacpp_batch(texts)


# ── llama.cpp ────────────────────────────────────────────────────────────────
#
# The 1800-char cap is a heuristic ("~450 tokens, fits in batch=512") that
# holds for ordinary prose but not for token-dense text (citation lists,
# tables of numbers/abbreviations) — those can exceed the server's physical
# batch size even within 1800 chars, and llama.cpp rejects the whole request
# when any single item in a batch overflows it. _embed_llamacpp_safe retries
# with progressively smaller caps so one dense chunk can't take down a batch.

_TRUNCATE_CAPS = (1800, 900, 400)


def _embed_llamacpp(text: str) -> list[float]:
    return _embed_llamacpp_safe(text)


def _embed_llamacpp_safe(text: str) -> list[float]:
    import httpx
    last_error: Exception | None = None
    for cap in _TRUNCATE_CAPS:
        try:
            resp = httpx.post(
                f"{settings.llamacpp_embed_url}/v1/embeddings",
                json={"model": "nomic-embed-text", "input": text[:cap]},
                timeout=60,
            )
            resp.raise_for_status()
            return resp.json()["data"][0]["embedding"]
        except httpx.HTTPStatusError as e:
            last_error = e
            continue
    raise last_error  # type: ignore[misc]


def _embed_llamacpp_batch(texts: list[str]) -> list[list[float]]:
    """Single HTTP call for a list of texts — llama.cpp supports array input.

    Falls back to sequential per-item embedding (with truncation retries) if
    the batch call fails, so one token-dense text doesn't sink the whole batch.
    """
    import httpx
    try:
        resp = httpx.post(
            f"{settings.llamacpp_embed_url}/v1/embeddings",
            json={"model": "nomic-embed-text", "input": [t[:1800] for t in texts]},
            timeout=120,
        )
        resp.raise_for_status()
        items = sorted(resp.json()["data"], key=lambda x: x["index"])
        return [item["embedding"] for item in items]
    except httpx.HTTPStatusError:
        return [_embed_llamacpp_safe(t) for t in texts]


# ── Gemini (future) ──────────────────────────────────────────────────────────

_gemini_client = None
# Texts per embed_content request (the API's limit). One request per text made a 300-page PDF
# take many minutes on the deployed backend and ran into the per-minute request quota.
GEMINI_BATCH = 100


def _embed_gemini(text: str) -> list[float]:
    return _embed_gemini_many([text])[0]


def _embed_gemini_many(texts: list[str]) -> list[list[float]]:
    global _gemini_client
    # Embedding a note sends its text to Google: same rule as any model call.
    from services import privacy
    from services.ai.providers import Provider
    privacy.check_provider(Provider("gemini", label="Gemini embeddings"))
    from google import genai
    from google.genai import types as genai_types
    if _gemini_client is None:
        if not settings.google_api_key:
            raise RuntimeError("GOOGLE_API_KEY not set")
        _gemini_client = genai.Client(api_key=settings.google_api_key)
    config = genai_types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIM)
    out: list[list[float]] = []
    for start in range(0, len(texts), GEMINI_BATCH):
        part = [t[:8000] for t in texts[start:start + GEMINI_BATCH]]
        result = _gemini_client.models.embed_content(
            model="models/gemini-embedding-001", contents=part, config=config)
        if len(result.embeddings or []) != len(part):
            raise RuntimeError(f"Gemini returned {len(result.embeddings or [])} embeddings for {len(part)} texts")
        out.extend(list(e.values) for e in result.embeddings)
    return out
