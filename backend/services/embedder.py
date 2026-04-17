"""Embedding service — Google gemini-embedding-001 (768 dimensions)."""

from google import genai
from google.genai import types as genai_types
from core.config import settings

_client: genai.Client | None = None
EMBEDDING_MODEL = "models/gemini-embedding-001"
EMBEDDING_DIM = 768


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        if not settings.google_api_key:
            raise RuntimeError("GOOGLE_API_KEY is not set — needed for embeddings")
        _client = genai.Client(api_key=settings.google_api_key)
    return _client


def embed(text: str) -> list[float]:
    """Return a 768-dim embedding vector for the given text."""
    client = _get_client()
    result = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=text[:8000],
        config=genai_types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIM),
    )
    return list(result.embeddings[0].values)
