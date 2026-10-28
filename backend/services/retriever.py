"""Semantic retrieval — two-pass cosine similarity via Supabase RPC.

Pass 1: match notes by descriptor_embedding (notes must have been indexed).
Pass 2: within the top notes, find the best matching blocks.

Falls back to legacy match_chunks RPC for notes that haven't been re-indexed
(no descriptor_embedding set).

With the question's text (`query`), pass 2 fuses the embedding's block order
with word matching over every block of the chosen notes (E8,
services/hybrid_search.py). Pass 1 — which notes — is still the descriptor
embedding alone: E8's eval does not model it yet.
"""
from __future__ import annotations

from services.database import get_supabase
from services.hybrid_search import fuse, lexical_order

_TOP_NOTES    = 5
_TOP_BLOCKS   = 15   # total across all top notes
_VECTOR_BLOCKS = 40  # embedding candidates fed into the fusion (E8)
_LEXICAL_CAP  = 3000 # blocks of the chosen notes read for word matching
#: A hit is shown with its neighbours up to this many characters (E8b): half
#: of all blocks are under 40 characters — a heading or one bullet — and the
#: chat was answering from the title of the explanation it needed.
_WINDOW_CHARS = 700
_BLOCK_CAP    = 1000 # one long block alone (a table) is shown up to this
_LEGACY_THRESHOLD = 0.50
_LEGACY_CHUNKS    = 12


def retrieve(query_embedding: list[float], user_id: str,
             query: str | None = None) -> list[dict]:
    if not query_embedding:
        return []

    vec = "[" + ",".join(str(v) for v in query_embedding) + "]"
    db  = get_supabase()

    # ── Pass 1: note descriptor search ───────────────────────────────────────
    pass1 = db.rpc(
        "match_note_descriptors",
        {"query_embedding": vec, "match_user_id": user_id, "match_count": _TOP_NOTES},
    ).execute()

    note_rows = pass1.data or []
    # Private notes have no embedding on a cloud-embedder server (indexer.
    # keeps_private), so pass 1 cannot see them: they join by their words.
    # They still go through the privacy gate like any retrieved note.
    private = _private_matches(db, query, user_id) if query else []
    for p in private:
        if p["id"] not in {r["id"] for r in note_rows}:
            note_rows.append(p)

    if not note_rows:
        return _legacy_fallback(db, vec, user_id)

    note_ids = [r["id"] for r in note_rows]
    note_meta = {r["id"]: r for r in note_rows}

    # ── Pass 2: block search within top notes ─────────────────────────────────
    pass2 = db.rpc(
        "match_blocks_in_notes",
        {
            "query_embedding": vec,
            "match_user_id":   user_id,
            "note_ids":        note_ids,
            "match_count":     _VECTOR_BLOCKS if query else _TOP_BLOCKS,
        },
    ).execute()

    block_rows = pass2.data or []
    note_blocks: list[dict] = []
    if query:
        note_blocks = _note_blocks(db, note_ids, user_id)
        block_rows = _fused_blocks(query, block_rows, note_blocks)

    if not block_rows:
        return _legacy_fallback(db, vec, user_id)

    windows = with_neighbours(block_rows, note_blocks) if note_blocks else [
        (row, (row.get("chunk_text") or "")[:300]) for row in block_rows]
    results = []
    for row, text in windows:
        nid      = str(row["note_id"])
        block_id = row.get("block_id") or ""
        meta     = note_meta.get(nid, {})
        # A block found by its words alone has no embedding distance.
        score    = max(0.0, 1.0 - float(row["dist"])) if row.get("dist") is not None else 0.0
        deep_link = f"/brain/{nid}#{block_id}" if block_id else f"/brain/{nid}"
        results.append({
            "id":           nid,
            "title":        meta.get("title", ""),
            "deep_link":    deep_link,
            "content_text": text,
            "similarity":   score,
        })

    # A private note found by its words has no embedding, so the fusion can
    # rank its passages below the cut; it keeps its best one, and the privacy
    # gate decides who may read it.
    found = {r["id"] for r in results}
    for p in private:
        if str(p["id"]) in found:
            continue
        own = [b for b in note_blocks if str(b.get("note_id")) == str(p["id"])]
        best = lexical_order(query, [b.get("chunk_text") or "" for b in own])
        if best:
            b = own[best[0]]
            results.append({
                "id": str(p["id"]), "title": p.get("title") or "",
                "deep_link": f"/brain/{p['id']}#{b.get('block_id')}" if b.get("block_id")
                             else f"/brain/{p['id']}",
                "content_text": (b.get("chunk_text") or "")[:_BLOCK_CAP],
                "similarity": 0.0,
            })

    return results


def with_neighbours(hits: list[dict], blocks: list[dict],
                    budget: int = _WINDOW_CHARS) -> list[tuple[dict, str]]:
    """Each hit with the blocks around it, in note order, up to `budget`
    characters: the block itself, then what follows it (the text under a
    heading), then what precedes it. Hits whose windows overlap an earlier,
    better-ranked window are dropped — the model sees each passage once."""
    by_note: dict[str, dict[int, str]] = {}
    for b in blocks:
        by_note.setdefault(str(b["note_id"]), {})[int(b["chunk_index"])] = b.get("chunk_text") or ""
    taken: dict[str, set[int]] = {}
    out: list[tuple[dict, str]] = []
    for hit in hits:
        nid, i = str(hit["note_id"]), hit.get("chunk_index")
        texts = by_note.get(nid, {})
        if i is None or int(i) not in texts:
            out.append((hit, (hit.get("chunk_text") or "")[:_BLOCK_CAP]))
            continue
        i = int(i)
        if i in taken.get(nid, set()):
            continue                                # already shown in a window
        lo = hi = i
        size = len(texts[i])
        while size < budget:
            grew = False
            if hi + 1 in texts and size + len(texts[hi + 1]) <= budget:
                hi += 1; size += len(texts[hi]) + 1; grew = True
            elif lo - 1 in texts and size + len(texts[lo - 1]) <= budget:
                lo -= 1; size += len(texts[lo]) + 1; grew = True
            if not grew:
                break
        span = set(range(lo, hi + 1))
        taken.setdefault(nid, set()).update(span)
        window = "\n".join(texts[j] for j in range(lo, hi + 1) if j in texts)
        # Neighbours stop at the budget; a single long block (a table) is
        # kept up to the prompt's own cap instead of being cut at 300.
        out.append((hit, window[:_BLOCK_CAP]))
    return out


def _block_key(row: dict) -> str:
    return f"{row['note_id']}:{row.get('chunk_index')}"


_PRIVATE_SCAN = 200   # private notes read for word matching
_PRIVATE_TOP  = 2


def _private_matches(db, query: str, user_id: str) -> list[dict]:
    """The user's private notes whose title or text shares words with the
    query — read from our own database, nothing sent anywhere."""
    try:
        rows = (db.table("notes").select("id,title").eq("user_id", user_id)
                .eq("local_only", True).is_("deleted_at", "null")
                .limit(_PRIVATE_SCAN).execute().data or [])
    except Exception:                              # noqa: BLE001
        return []
    if not rows:
        return []
    texts: dict[str, list[str]] = {str(r["id"]): [r.get("title") or ""]
                                   for r in rows if isinstance(r, dict) and r.get("id")}
    for b in _note_blocks(db, list(texts), user_id):
        if str(b.get("note_id")) in texts:
            texts[str(b["note_id"])].append(b.get("chunk_text") or "")
    ids = list(texts)
    order = lexical_order(query, [" ".join(texts[i]) for i in ids])[:_PRIVATE_TOP]
    by_id = {str(r["id"]): r for r in rows}
    return [{"id": ids[i], "title": by_id[ids[i]].get("title") or ""} for i in order]


def _note_blocks(db, note_ids: list, user_id: str) -> list[dict]:
    """Every block of the chosen notes — for word matching and neighbours."""
    try:
        return (db.table("note_chunks")
                .select("note_id,block_id,chunk_text,chunk_index")
                .in_("note_id", note_ids).eq("user_id", user_id)
                .limit(_LEXICAL_CAP).execute().data or [])
    except Exception:                              # noqa: BLE001
        return []


def _fused_blocks(query: str, vector_rows: list[dict],
                  rows: list[dict]) -> list[dict]:
    """Pass 2's blocks in fused order: the embedding's, and word matching over
    every block of the chosen notes (so the lecture's own term, or a block
    that never got an embedding, can still surface)."""
    if not rows:
        return vector_rows[:_TOP_BLOCKS]           # the embedding's order stands
    by_key = {_block_key(r): r for r in rows}
    for r in vector_rows:
        by_key[_block_key(r)] = r                  # keeps the embedding's dist
    order = fuse(query, [_block_key(r) for r in vector_rows],
                 {k: r.get("chunk_text") or "" for k, r in by_key.items()},
                 limit=_TOP_BLOCKS)
    return [by_key[k] for k in order]


def _legacy_fallback(db, vec: str, user_id: str) -> list[dict]:
    """Fall back to old single-pass chunk retrieval for un-indexed notes."""
    res = db.rpc(
        "match_chunks",
        {
            "query_embedding": vec,
            "match_user_id":   user_id,
            "match_threshold": _LEGACY_THRESHOLD,
            "match_count":     _LEGACY_CHUNKS,
        },
    ).execute()
    rows = res.data or []
    rows = [r for r in rows if r.get("deleted_at") is None]

    if not rows:
        return []

    seen: dict[str, dict] = {}
    for row in rows:
        nid = str(row["note_id"])
        if nid not in seen or row["similarity"] > seen[nid]["similarity"]:
            seen[nid] = row

    best = sorted(seen.values(), key=lambda r: r["similarity"], reverse=True)[:_TOP_NOTES]
    return [
        {
            "id":           str(r["note_id"]),
            "title":        r.get("title", ""),
            "content_text": r.get("chunk_text", "")[:300],
            "deep_link":    r.get("deep_link", f"/brain/{r['note_id']}"),
            "similarity":   r.get("similarity", 0.0),
        }
        for r in best
    ]
