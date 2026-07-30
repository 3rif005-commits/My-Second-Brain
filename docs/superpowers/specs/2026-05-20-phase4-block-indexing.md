# Phase 4 — Block Indexing + Note Descriptors

**Date:** 2026-05-20  
**Status:** Approved  
**Goal:** Replace word-based chunking with block-level indexing. Every note gets an AI-generated descriptor. Retrieval becomes two-pass (note descriptor → block). Every level in the future hierarchy will inherit this same pattern.

---

## Vision

The Second Brain will eventually contain deep hierarchies: databases → notes → sub-notes → blocks. Every node at every level needs a **context descriptor** — a short AI-generated summary of what it contains — so the model can navigate the hierarchy without reading everything.

Phase 4 builds this foundation at the note and block level. When databases and sub-notes arrive, they will follow the same pattern: aggregate child descriptors into a parent descriptor.

---

## What Changes

| Layer | Before | After |
|---|---|---|
| Chunking unit | ~150 word text windows | One chunk per BlockNote block (block_id preserved) |
| Note identity | Title only | AI-generated descriptor (2-3 sentences) + embedding |
| Retrieval | Single cosine pass on notes table | Two-pass: descriptor search → block search |
| Deep links | `/brain/{noteId}` | `/brain/{noteId}#{blockId}` — exact block |
| On edit | No re-index | Debounced re-index (30s after last change) |
| Existing notes | Only new ingests chunked | All existing notes re-indexed via `/internal/reindex` |

---

## Data Model

### Migration 011 — `011_block_chunks.sql`

```sql
-- Add descriptor fields to notes
ALTER TABLE notes
  ADD COLUMN descriptor          TEXT,
  ADD COLUMN descriptor_embedding vector(768);

CREATE INDEX notes_descriptor_embedding_hnsw
  ON notes USING hnsw (descriptor_embedding vector_cosine_ops)
  WITH (m=16, ef_construction=64);

-- Add block_id to note_chunks (replace chunk_index as primary locator)
ALTER TABLE note_chunks
  ADD COLUMN block_id TEXT;

-- Index for fast lookup of chunks by note
CREATE INDEX note_chunks_note_id_idx ON note_chunks (note_id);
```

`note_chunks` schema after migration:

| Column | Type | Purpose |
|---|---|---|
| id | UUID PK | row identity |
| note_id | UUID → notes | parent note |
| user_id | UUID → profiles | RLS |
| chunk_index | INTEGER | position order (kept for ordering) |
| chunk_text | TEXT | extracted block text |
| block_id | TEXT | BlockNote block id (for deep link anchor) |
| embedding | vector(768) | cosine-searchable embedding |
| created_at | TIMESTAMPTZ | — |

---

## Components

### 1. Block Chunker — `backend/services/block_chunker.py`

Parses BlockNote JSON (`notes.content` column) into a list of indexable chunks.

**Input:** BlockNote JSON (array of block objects)  
**Output:** `list[{"block_id": str, "chunk_index": int, "chunk_text": str}]`

**Rules:**
- Iterate every block in the content array (including nested blocks recursively)
- Extract all text content from each block (concatenate inline content strings)
- **Skip** blocks with no text or that are dividers (`type: "horizontalRule"`)
- **Index everything else** — headings, paragraphs, bullets, numbered items, toggles, code blocks, etc.
- `chunk_index` = position in traversal order (for ordering results)
- `block_id` = the block's `id` field from BlockNote JSON

**Block text extraction:**
```python
def _extract_text(block: dict) -> str:
    """Recursively extract plain text from a BlockNote block."""
    parts = []
    for inline in block.get("content", []):
        if isinstance(inline, dict) and inline.get("type") == "text":
            parts.append(inline.get("text", ""))
    # Recurse into children
    for child in block.get("children", []):
        parts.append(_extract_text(child))
    return " ".join(p for p in parts if p).strip()
```

---

### 2. Descriptor Generator — `backend/services/descriptor.py`

Calls the configured LLM to produce a 2-3 sentence descriptor for a note.

**Input:** `note_title: str`, `blocks: list[str]` (chunk texts in order)  
**Output:** `descriptor: str` (2-3 sentences, plain text)

**Prompt:**
```
You are summarizing a personal knowledge note for use in an AI retrieval system.
Write 2-3 sentences that describe what this note is about.
Be specific: mention the main topic, key concepts, and what a reader would learn.
Do not use phrases like "this note" or "this document".

Title: {title}
Content (first 2000 chars):
{content}

Descriptor:
```

**Implementation notes:**
- Uses `get_endpoint(mode=Mode.API, task="chat")` — same model router as the agent
- Non-streaming call (short output, ~60 tokens max)
- Fallback: if LLM call fails, use `"{title}. {first_block_text[:200]}"` as descriptor
- Result is also embedded via `embedder.embed(descriptor)` and stored as `descriptor_embedding`

---

### 3. Retriever — `backend/services/retriever.py` (replace)

Two-pass cosine search.

**Pass 1 — Note descriptor search:**
```sql
SELECT id, title, descriptor, descriptor_embedding <=> $embedding AS dist
FROM notes
WHERE user_id = $user_id
  AND deleted_at IS NULL
  AND descriptor_embedding IS NOT NULL
ORDER BY dist
LIMIT 5
```

**Pass 2 — Block search within top notes:**
```sql
SELECT nc.note_id, nc.block_id, nc.chunk_text, nc.chunk_index,
       nc.embedding <=> $embedding AS dist
FROM note_chunks nc
WHERE nc.note_id = ANY($note_ids)
  AND nc.user_id = $user_id
ORDER BY dist
LIMIT 3
```
(Run once per top note from Pass 1, or as a single query with `ANY()`.)

**Result shape:**
```python
[{
    "id":        note_id,
    "title":     "Gradient Descent",
    "deep_link": "/brain/{note_id}#{block_id}",
    "snippet":   chunk_text[:300],
    "score":     1 - dist,
}]
```

Up to 15 results total (5 notes × 3 blocks each), deduplicated by note if the same note appears via multiple blocks.

---

### 4. Ingest Pipeline — `backend/routers/agent_ingest.py` (extend)

After a note is created from a file or URL, the pipeline runs:

```
extract text
  → create note (existing)
  → emit ingest_created SSE event (existing)
  → parse BlockNote JSON → block_chunker.parse()
  → embed each block → insert into note_chunks
  → descriptor.generate(title, blocks)
  → embed descriptor → update notes SET descriptor, descriptor_embedding
  → stream agent turn (existing)
```

The block chunking and descriptor generation run **before** the agent turn so the note is searchable immediately.

---

### 5. Re-index Endpoint — `backend/routers/internal.py` (extend)

`POST /internal/reindex`

Idempotent. Walks all notes for the authenticated user, re-chunks and re-describes each.

```python
for note in get_all_notes(user_id):
    blocks = block_chunker.parse(note["content"])
    # Delete existing chunks
    supabase.table("note_chunks").delete().eq("note_id", note["id"]).execute()
    # Re-insert
    embed_and_insert_chunks(note["id"], user_id, blocks)
    # Regenerate descriptor
    desc = descriptor.generate(note["title"], [b["chunk_text"] for b in blocks])
    desc_embedding = embedder.embed(desc)
    supabase.table("notes").update({
        "descriptor": desc, "descriptor_embedding": desc_embedding
    }).eq("id", note["id"]).execute()
```

Returns `{"reindexed": N, "failed": M}`.

---

### 6. Edit Re-index — Frontend debounce + Backend endpoint

**Backend:** `POST /internal/reindex-note` (body: `{"note_id": str}`)  
Same logic as full reindex but for a single note. Auth-gated (user can only reindex their own notes).

**Frontend:** `frontend/components/editor/NoteEditorPage.tsx`

```typescript
// Debounce: 30 seconds after last block change
const reindexDebounce = useRef<ReturnType<typeof setTimeout>>();

function onEditorChange() {
  clearTimeout(reindexDebounce.current);
  reindexDebounce.current = setTimeout(() => {
    fetch("/api/internal/reindex-note", {
      method: "POST",
      body: JSON.stringify({ note_id: noteId }),
    });
  }, 30_000);
}
```

**Next.js proxy:** `frontend/app/api/internal/reindex-note/route.ts` — forwards with Bearer token.

---

## Deep Link Format

Block-level deep links use the URL hash:

```
/brain/{noteId}#{blockId}
```

The `NoteEditorPage` already renders BlockNote blocks with their `id` attribute. No UI changes needed — browsers natively scroll to `#blockId` anchors.

When the agent cites a block, it includes `deep_link: "/brain/{noteId}#{blockId}"` in the tool result. The chat UI renders this as a clickable link.

---

## File Map

| Action | Path |
|---|---|
| Create | `backend/services/block_chunker.py` |
| Create | `backend/services/descriptor.py` |
| Create | `backend/tests/test_block_chunker.py` |
| Create | `backend/tests/test_descriptor.py` |
| Create | `supabase/migrations/011_block_chunks.sql` |
| Create | `frontend/app/api/internal/reindex-note/route.ts` |
| Modify | `backend/services/retriever.py` — two-pass cosine |
| Modify | `backend/routers/agent_ingest.py` — wire block chunker + descriptor |
| Modify | `backend/routers/internal.py` — add `/internal/reindex` and `/internal/reindex-note` |
| Modify | `frontend/components/editor/NoteEditorPage.tsx` — debounced re-index on change |

---

## Testing

| Test | What it verifies |
|---|---|
| `test_block_chunker.py` | Heading blocks indexed, empty/divider blocks skipped, nested blocks traversed, block_id preserved |
| `test_descriptor.py` | Descriptor generated from title + blocks, fallback used on LLM failure |
| `test_retriever.py` | Two-pass returns block-level deep links, deduplicates by note |
| Manual: reindex endpoint | `POST /internal/reindex` returns `{"reindexed": N}`, note_chunks populated |
| Manual: edit debounce | Edit a note, wait 30s, check note_chunks updated in Supabase Studio |
| Manual: search quality | Ask a question → cited answer links to specific block → click deep link → lands on correct block |

---

## Definition of Done

- All existing notes have `descriptor` and `descriptor_embedding` set after `/internal/reindex`
- New ingests auto-populate block chunks + descriptor
- Editing a note triggers re-index after 30s idle
- Agent answers cite `/brain/{noteId}#{blockId}` deep links
- Clicking a deep link scrolls to the correct block in the editor
- All new unit tests pass
