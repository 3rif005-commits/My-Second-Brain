"""Semantic retrieval — top-K notes by cosine similarity via Supabase RPC."""

from services.database import get_supabase

SIMILARITY_THRESHOLD = 0.72
TOP_K = 8


def retrieve(query_embedding: list[float], user_id: str) -> list[dict]:
    """Return top-K notes semantically similar to query_embedding for the given user."""
    vec_literal = "[" + ",".join(str(v) for v in query_embedding) + "]"

    result = get_supabase().rpc(
        "match_notes",
        {
            "query_embedding": vec_literal,
            "match_user_id": user_id,
            "match_threshold": SIMILARITY_THRESHOLD,
            "match_count": TOP_K,
        },
    ).execute()

    return result.data or []
