"""Semantic retrieval — chunk-level cosine similarity via Supabase RPC.

Queries note_chunks (fine-grained) instead of note_index (whole-note).
Deduplicates by note_id, keeping the highest-similarity chunk per note,
so the tutor always gets the most relevant excerpt — not a truncated blob.
"""

from services.database import get_supabase

SIMILARITY_THRESHOLD = 0.50
TOP_K_CHUNKS = 12   # fetch more chunks than notes needed — dedup reduces count
TOP_K_NOTES  = 6    # max distinct notes returned to the tutor


def retrieve(query_embedding: list[float], user_id: str) -> list[dict]:
    vec_literal = "[" + ",".join(str(v) for v in query_embedding) + "]"

    # Try chunk-level retrieval first
    chunk_result = get_supabase().rpc(
        "match_chunks",
        {
            "query_embedding": vec_literal,
            "match_user_id": user_id,
            "match_threshold": SIMILARITY_THRESHOLD,
            "match_count": TOP_K_CHUNKS,
        },
    ).execute()

    rows = chunk_result.data or []
    rows = [r for r in rows if r.get("deleted_at") is None]

    if rows:
        # Deduplicate: keep best chunk per note
        seen: dict[str, dict] = {}
        for row in rows:
            nid = str(row["note_id"])
            if nid not in seen or row["similarity"] > seen[nid]["similarity"]:
                seen[nid] = row
        best = sorted(seen.values(), key=lambda r: r["similarity"], reverse=True)[:TOP_K_NOTES]
        return [
            {
                "id":           str(r["note_id"]),
                "title":        r.get("title", ""),
                "content_text": r.get("chunk_text", ""),
                "deep_link":    r.get("deep_link", f"/brain/{r['note_id']}"),
                "similarity":   r.get("similarity", 0.0),
            }
            for r in best
        ]

    # Fallback: whole-note retrieval for notes not yet chunked
    note_result = get_supabase().rpc(
        "match_notes",
        {
            "query_embedding": vec_literal,
            "match_user_id": user_id,
            "match_threshold": SIMILARITY_THRESHOLD,
            "match_count": TOP_K_NOTES,
        },
    ).execute()
    note_rows = note_result.data or []
    return [r for r in note_rows if r.get("deleted_at") is None]
