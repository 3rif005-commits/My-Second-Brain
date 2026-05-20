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
        return [_embed_gemini(t) for t in texts]
    return _embed_llamacpp_batch(texts)


# ── llama.cpp ────────────────────────────────────────────────────────────────

def _embed_llamacpp(text: str) -> list[float]:
    import httpx
    resp = httpx.post(
        f"{settings.llamacpp_embed_url}/v1/embeddings",
        json={"model": "nomic-embed-text", "input": text[:1800]},  # ~450 tokens, fits in batch=512
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["data"][0]["embedding"]


def _embed_llamacpp_batch(texts: list[str]) -> list[list[float]]:
    """Single HTTP call for a list of texts — llama.cpp supports array input."""
    import httpx
    resp = httpx.post(
        f"{settings.llamacpp_embed_url}/v1/embeddings",
        json={"model": "nomic-embed-text", "input": [t[:1800] for t in texts]},
        timeout=120,
    )
    resp.raise_for_status()
    items = sorted(resp.json()["data"], key=lambda x: x["index"])
    return [item["embedding"] for item in items]


# ── Gemini (future) ──────────────────────────────────────────────────────────

_gemini_client = None


def _embed_gemini(text: str) -> list[float]:
    global _gemini_client
    from google import genai
    from google.genai import types as genai_types
    if _gemini_client is None:
        if not settings.google_api_key:
            raise RuntimeError("GOOGLE_API_KEY not set")
        _gemini_client = genai.Client(api_key=settings.google_api_key)
    result = _gemini_client.models.embed_content(
        model="models/gemini-embedding-001",
        contents=text[:8000],
        config=genai_types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIM),
    )
    return list(result.embeddings[0].values)
