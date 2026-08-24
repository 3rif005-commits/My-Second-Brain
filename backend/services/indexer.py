"""Shared note indexing logic — used by agent_ingest and internal reindex.

index_note(note_id, user_id):
  1. Fetch note content from DB
  2. Parse into blocks (block_chunker)
  3. If this note is a database row (Milestone 14, Task 46): prepend a
     rendered property-preamble chunk (spec §12, Q10 item 1)
  4. Delete old note_chunks rows
  5. Embed blocks → insert new note_chunks rows
  6. Generate descriptor → embed → update notes row
"""
from __future__ import annotations

import logging
from typing import Any

from services.block_chunker import parse as parse_blocks
from services.database import get_supabase
from services.db.properties.format import format_property_value
from services.descriptor import generate as generate_descriptor
from services.embedder import embed, embed_batch

logger = logging.getLogger(__name__)

# Synthetic `block_id` for the property-preamble chunk this module inserts as
# chunk 0 for database-row notes. It isn't a real BlockNote block id (those
# are opaque strings BlockNote itself mints), so this needs to be a value
# that cannot collide with one; the double-underscore wrapping is the same
# "reserved identifier" convention Python itself uses for dunder names, and
# nothing in this codebase mints block ids that way. Confirmed nothing else
# depends on `block_id` beyond a deep-link scroll-to-block anchor (`grep
# block_id frontend/`, see task-46-report.md) — `editorRef.scrollToBlock()`
# on an id that doesn't exist in the live editor is a no-op, not a crash, so
# a stale anchor pointing at this synthetic id degrades gracefully.
PROPERTY_PREAMBLE_BLOCK_ID = "__property_preamble__"


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


def _build_property_preamble(note_id: str, user_id: str) -> str | None:
    """Database-row notes only: render `"<name>: <value> · <name>: <value>"`
    from the row's own property values, or None if this note isn't a
    database row or every property on it is empty (an empty preamble line
    would be noise, not signal — the caller skips inserting a chunk for it
    either way).

    `db_row_props.note_id` is that table's own PRIMARY KEY, a straight FK to
    `notes.id` (migration 014) — so a single `maybe_single()` lookup is both
    the row-membership check and the properties fetch. Uses the exact same
    `get_supabase()` service-role client every other read in this module
    already uses (bypasses RLS) — no asyncpg/`get_pool()` here, this is a
    single-row-by-primary-key fetch, not a filter/sort the query compiler
    would be needed for.
    """
    db = get_supabase()
    row_res = (
        db.table("db_row_props")
        .select("properties, data_source_id")
        .eq("note_id", note_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not row_res or not row_res.data:
        return None

    row = row_res.data
    properties: dict[str, Any] = row.get("properties") or {}
    data_source_id = row.get("data_source_id")
    if not data_source_id:
        return None

    # `position` ordering matches how every other view already orders
    # columns (`db_properties.position`), so the preamble reads in the same
    # left-to-right order a person sees in Table view. `config` is fetched
    # alongside `key`/`name`/`type` (a small, deliberate widening of the
    # brief's literal example query) so select/status/multi_select option
    # ids can be resolved to their configured display names instead of
    # shown raw — see format.py's `_option_label`.
    props_res = (
        db.table("db_properties")
        .select("key, name, type, config")
        .eq("data_source_id", data_source_id)
        .eq("user_id", user_id)
        .order("position")
        .execute()
    )
    prop_defs = (props_res.data if props_res else None) or []

    parts: list[str] = []
    for prop in prop_defs:
        key = prop.get("key")
        prop_type = prop.get("type")
        if not key or not prop_type:
            continue
        wrapper = properties.get(key)
        raw_value = wrapper.get(prop_type) if isinstance(wrapper, dict) else None
        formatted = format_property_value(prop_type, raw_value, prop.get("config"))
        if formatted:
            name = prop.get("name") or key
            parts.append(f"{name}: {formatted}")

    return " · ".join(parts) if parts else None


def _with_property_preamble(note_id: str, user_id: str, blocks: list[dict]) -> list[dict]:
    """Prepend the property-preamble chunk (if any) as chunk 0, renumbering
    every subsequent chunk's `chunk_index`. Returns `blocks` unchanged
    (same objects, same indices) when there's no preamble to add — the
    non-database-note and all-properties-empty cases both fall through to
    this, so neither regresses the pre-Task-46 chunk list.

    Deliberately does not touch `block_chunker.py`: that module has no
    reason to know about database rows, and this concern (a database-row
    lookup) already lives in this module.
    """
    preamble_text = _build_property_preamble(note_id, user_id)
    if not preamble_text:
        return blocks

    renumbered = [{**b, "chunk_index": i + 1} for i, b in enumerate(blocks)]
    preamble_chunk = {
        "block_id": PROPERTY_PREAMBLE_BLOCK_ID,
        "chunk_index": 0,
        "chunk_text": preamble_text,
    }
    return [preamble_chunk, *renumbered]


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
    indexed_blocks = _with_property_preamble(note_id, user_id, blocks)
    embed_and_insert_chunks(note_id, user_id, indexed_blocks)

    # Descriptor generation deliberately reads from `blocks` (the note's own
    # body), not `indexed_blocks` — the brief's "descriptor generation is
    # unchanged" holds exactly: the property preamble is a note_chunks/
    # retrieval concern only, not a topic-summary input.
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
