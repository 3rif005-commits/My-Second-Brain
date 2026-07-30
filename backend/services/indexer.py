"""Shared note indexing logic — used by agent_ingest and internal reindex.

index_note(note_id, user_id):
  1. Fetch note content from DB
  2. Parse into blocks (block_chunker)
  3. Delete old note_chunks rows
  4. Embed blocks → insert new note_chunks rows
  5. Generate descriptor → embed → update notes row
"""
from __future__ import annotations

import logging

from services.block_chunker import parse as parse_blocks
from services.database import get_supabase
from services.descriptor import generate as generate_descriptor
from services.embedder import embed, embed_batch

logger = logging.getLogger(__name__)


def embed_and_insert_chunks(note_id: str, user_id: str, blocks: list[dict]) -> None:
    """Delete existing chunks for note and insert fresh block-level rows."""
    db = get_supabase()
    db.table("note_chunks").delete().eq("note_id", note_id).execute()

    if not blocks:
        return

    texts = [b["chunk_text"] for b in blocks]
    embeddings = embed_batch(texts)

    rows = [
        {
            "note_id":     note_id,
            "user_id":     user_id,
            "chunk_index": b["chunk_index"],
            "chunk_text":  b["chunk_text"],
            "block_id":    b["block_id"],
            "embedding":   "[" + ",".join(str(v) for v in emb) + "]",
        }
        for b, emb in zip(blocks, embeddings)
    ]
    db.table("note_chunks").insert(rows).execute()


def index_note(note_id: str, user_id: str) -> bool:
    """Fetch, chunk, embed and describe a single note. Returns True on success."""
    db = get_supabase()
    res = (
        db.table("notes")
        .select("id, title, content")
        .eq("id", note_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        logger.warning("index_note: note %s not found for user %s", note_id, user_id)
        return False

    note = res.data
    content = note.get("content") or []
    title = note.get("title") or ""

    blocks = parse_blocks(content)
    embed_and_insert_chunks(note_id, user_id, blocks)

    if not blocks:
        return True

    texts = [b["chunk_text"] for b in blocks]
    desc = generate_descriptor(title, texts)
    desc_emb = embed(desc)

    db.table("notes").update({
        "descriptor":           desc,
        "descriptor_embedding": "[" + ",".join(str(v) for v in desc_emb) + "]",
    }).eq("id", note_id).execute()

    return True
