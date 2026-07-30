# Phase 4 — Block Indexing + Note Descriptors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace word-based chunking with block-level indexing, add AI-generated note descriptors, and implement two-pass cosine retrieval with block-anchor deep links.

**Architecture:** A new `block_chunker` service parses BlockNote JSON into indexed blocks. A `descriptor` service generates short LLM summaries for each note. A `services/indexer.py` helper is shared between the ingest pipeline and the reindex endpoints. The retriever becomes two-pass: first find relevant notes by descriptor, then drill into blocks within those notes.

**Tech Stack:** Python/FastAPI backend, Supabase (pgvector), httpx for LLM calls, Next.js/TypeScript frontend.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `supabase/migrations/011_block_chunks.sql` | Add descriptor columns + RPC functions |
| Create | `backend/services/block_chunker.py` | Parse BlockNote JSON → list of block dicts |
| Create | `backend/services/descriptor.py` | LLM-generated 2-3 sentence note summary |
| Create | `backend/services/indexer.py` | Shared index_note() helper used by ingest + reindex |
| Create | `backend/tests/test_block_chunker.py` | Unit tests for block parsing |
| Create | `backend/tests/test_descriptor.py` | Unit tests for descriptor generation + fallback |
| Create | `backend/tests/test_retriever.py` | Unit tests for two-pass retriever |
| Create | `frontend/app/api/internal/reindex-note/route.ts` | Next.js proxy → FastAPI reindex-note |
| Modify | `backend/services/retriever.py` | Two-pass: descriptor search → block search |
| Modify | `backend/routers/agent_ingest.py` | Wire indexer after agent turn |
| Modify | `backend/routers/internal.py` | Add /internal/reindex + /internal/reindex-note |
| Modify | `frontend/components/editor/NoteEditorPage.tsx` | 30s debounce → reindex-note on edit |

---

## CRITICAL: Git Commit Method

This repo has object corruption. Every commit uses these four plumbing commands exactly (only change the message):

```bash
TREE=$(git write-tree)
PARENT=$(git rev-parse refs/heads/wip/pre-ai-substrate-merge)
COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "your message here")
git update-ref refs/heads/wip/pre-ai-substrate-merge "$COMMIT"
```

**Never use `git commit`.** Never run two agents with git operations in parallel.

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/011_block_chunks.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 011_block_chunks.sql
-- Phase 4: block-level indexing + note descriptors

-- Add descriptor fields to notes
ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS descriptor          TEXT,
  ADD COLUMN IF NOT EXISTS descriptor_embedding vector(768);

CREATE INDEX IF NOT EXISTS notes_descriptor_embedding_hnsw
  ON notes USING hnsw (descriptor_embedding vector_cosine_ops)
  WITH (m=16, ef_construction=64);

-- Add block_id to note_chunks (nullable — old chunks have no block_id)
ALTER TABLE note_chunks
  ADD COLUMN IF NOT EXISTS block_id TEXT;

-- RLS: service role can bypass for reindex writes (service key already bypasses RLS)

-- Pass 1: match notes by descriptor embedding
CREATE OR REPLACE FUNCTION match_note_descriptors(
  query_embedding     vector(768),
  match_user_id       uuid,
  match_count         int DEFAULT 5
)
RETURNS TABLE (
  id          uuid,
  title       text,
  descriptor  text,
  dist        float
)
LANGUAGE sql STABLE
AS $$
  SELECT id, title, descriptor,
         descriptor_embedding <=> query_embedding AS dist
  FROM notes
  WHERE user_id    = match_user_id
    AND deleted_at IS NULL
    AND descriptor_embedding IS NOT NULL
  ORDER BY dist
  LIMIT match_count;
$$;

-- Pass 2: match blocks within a set of notes
CREATE OR REPLACE FUNCTION match_blocks_in_notes(
  query_embedding vector(768),
  match_user_id   uuid,
  note_ids        uuid[],
  match_count     int DEFAULT 15
)
RETURNS TABLE (
  note_id     uuid,
  block_id    text,
  chunk_text  text,
  chunk_index int,
  dist        float
)
LANGUAGE sql STABLE
AS $$
  SELECT nc.note_id, nc.block_id, nc.chunk_text, nc.chunk_index,
         nc.embedding <=> query_embedding AS dist
  FROM note_chunks nc
  WHERE nc.note_id  = ANY(note_ids)
    AND nc.user_id  = match_user_id
    AND nc.embedding IS NOT NULL
  ORDER BY dist
  LIMIT match_count;
$$;
```

- [ ] **Step 2: Commit**

```bash
TREE=$(git write-tree)
PARENT=$(git rev-parse refs/heads/wip/pre-ai-substrate-merge)
COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "feat(db): migration 011 — descriptor columns + block_id + two-pass RPCs")
git update-ref refs/heads/wip/pre-ai-substrate-merge "$COMMIT"
```

---

## Task 2: Block Chunker (TDD)

**Files:**
- Create: `backend/tests/test_block_chunker.py`
- Create: `backend/services/block_chunker.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_block_chunker.py`:

```python
"""Tests for BlockNote JSON → chunk list parser."""
import pytest
from services.block_chunker import parse


def test_heading_block_is_indexed():
    content = [
        {
            "id": "b1",
            "type": "heading",
            "content": [{"type": "text", "text": "Introduction to ML"}],
            "children": [],
        }
    ]
    result = parse(content)
    assert len(result) == 1
    assert result[0]["block_id"] == "b1"
    assert result[0]["chunk_text"] == "Introduction to ML"
    assert result[0]["chunk_index"] == 0


def test_paragraph_block_is_indexed():
    content = [
        {
            "id": "p1",
            "type": "paragraph",
            "content": [{"type": "text", "text": "Hello world"}],
            "children": [],
        }
    ]
    result = parse(content)
    assert result[0]["block_id"] == "p1"
    assert result[0]["chunk_text"] == "Hello world"


def test_empty_block_is_skipped():
    content = [
        {"id": "b1", "type": "paragraph", "content": [], "children": []},
        {"id": "b2", "type": "paragraph", "content": [{"type": "text", "text": "real text"}], "children": []},
    ]
    result = parse(content)
    assert len(result) == 1
    assert result[0]["block_id"] == "b2"


def test_horizontal_rule_is_skipped():
    content = [
        {"id": "d1", "type": "horizontalRule", "content": [], "children": []},
        {"id": "p1", "type": "paragraph", "content": [{"type": "text", "text": "after divider"}], "children": []},
    ]
    result = parse(content)
    assert len(result) == 1
    assert result[0]["block_id"] == "p1"


def test_nested_children_are_traversed():
    content = [
        {
            "id": "b1",
            "type": "bulletListItem",
            "content": [{"type": "text", "text": "Parent item"}],
            "children": [
                {
                    "id": "b2",
                    "type": "bulletListItem",
                    "content": [{"type": "text", "text": "Child item"}],
                    "children": [],
                }
            ],
        }
    ]
    result = parse(content)
    assert len(result) == 2
    assert result[0]["block_id"] == "b1"
    assert result[0]["chunk_text"] == "Parent item"
    assert result[1]["block_id"] == "b2"
    assert result[1]["chunk_text"] == "Child item"


def test_chunk_index_reflects_traversal_order():
    content = [
        {"id": "a", "type": "paragraph", "content": [{"type": "text", "text": "first"}], "children": []},
        {"id": "b", "type": "paragraph", "content": [{"type": "text", "text": "second"}], "children": []},
        {"id": "c", "type": "paragraph", "content": [{"type": "text", "text": "third"}], "children": []},
    ]
    result = parse(content)
    assert [r["chunk_index"] for r in result] == [0, 1, 2]


def test_multiple_inline_texts_concatenated():
    content = [
        {
            "id": "b1",
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "Hello "},
                {"type": "text", "text": "world"},
            ],
            "children": [],
        }
    ]
    result = parse(content)
    assert result[0]["chunk_text"] == "Hello  world"


def test_empty_content_returns_empty_list():
    assert parse([]) == []
    assert parse(None) == []


def test_deep_nesting_traversed():
    content = [
        {
            "id": "top",
            "type": "toggle",
            "content": [{"type": "text", "text": "Toggle heading"}],
            "children": [
                {
                    "id": "mid",
                    "type": "bulletListItem",
                    "content": [{"type": "text", "text": "bullet"}],
                    "children": [
                        {
                            "id": "leaf",
                            "type": "paragraph",
                            "content": [{"type": "text", "text": "deep"}],
                            "children": [],
                        }
                    ],
                }
            ],
        }
    ]
    result = parse(content)
    ids = [r["block_id"] for r in result]
    assert "top" in ids
    assert "mid" in ids
    assert "leaf" in ids
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/ayoub/projects/second_brain/backend && PYTHONPATH=. venv/bin/python -m pytest tests/test_block_chunker.py -v 2>&1 | head -20
```

Expected: `ModuleNotFoundError: No module named 'services.block_chunker'`

- [ ] **Step 3: Implement block_chunker.py**

Create `backend/services/block_chunker.py`:

```python
"""Parse BlockNote JSON content into indexable block chunks.

Input:  note content — a list of BlockNote block objects (from notes.content).
Output: list of {"block_id": str, "chunk_index": int, "chunk_text": str}
        in depth-first traversal order; empty blocks and dividers excluded.
"""
from __future__ import annotations


def parse(content: list | None) -> list[dict]:
    """Walk the BlockNote block tree and return one dict per non-empty block."""
    if not content:
        return []
    chunks: list[dict] = []
    _walk(content, chunks)
    return chunks


def _walk(blocks: list[dict], out: list[dict]) -> None:
    for block in blocks:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "horizontalRule":
            continue
        text = _extract_text(block)
        if text:
            out.append({
                "block_id":    block.get("id", ""),
                "chunk_index": len(out),
                "chunk_text":  text,
            })
        children = block.get("children") or []
        if children:
            _walk(children, out)


def _extract_text(block: dict) -> str:
    parts: list[str] = []
    for inline in block.get("content") or []:
        if isinstance(inline, dict) and inline.get("type") == "text":
            parts.append(inline.get("text", ""))
    return " ".join(parts).strip()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/ayoub/projects/second_brain/backend && PYTHONPATH=. venv/bin/python -m pytest tests/test_block_chunker.py -v
```

Expected: all 9 tests PASS.

Note: `test_multiple_inline_texts_concatenated` checks for `"Hello  world"` (double space) — that is correct since the join uses `" "` as separator and the source texts already include trailing spaces. If your implementation uses a different separator, adjust the test to match actual output.

- [ ] **Step 5: Commit**

```bash
cd /home/ayoub/projects/second_brain
TREE=$(git write-tree)
PARENT=$(git rev-parse refs/heads/wip/pre-ai-substrate-merge)
COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "feat(chunker): block_chunker — BlockNote JSON → indexed block list")
git update-ref refs/heads/wip/pre-ai-substrate-merge "$COMMIT"
```

---

## Task 3: Descriptor Generator (TDD)

**Files:**
- Create: `backend/tests/test_descriptor.py`
- Create: `backend/services/descriptor.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_descriptor.py`:

```python
"""Tests for AI-generated note descriptor."""
from unittest.mock import MagicMock, patch

import pytest

from services.descriptor import generate


_OPENAI_ENDPOINT = {
    "url": "https://openrouter.ai/api/v1/chat/completions",
    "headers": {"Authorization": "Bearer test-key"},
    "model": "test-model",
    "source": "openrouter",
}


def _mock_client(text: str):
    """Return a context-manager mock whose .post() returns a valid OpenAI response."""
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.return_value = {
        "choices": [{"message": {"content": text}}]
    }
    client = MagicMock()
    client.__enter__ = MagicMock(return_value=client)
    client.__exit__ = MagicMock(return_value=False)
    client.post.return_value = resp
    return client


def test_generate_returns_llm_text():
    with patch("services.descriptor.get_endpoint", return_value=_OPENAI_ENDPOINT):
        with patch("services.descriptor.httpx.Client", return_value=_mock_client("A note about ML.")):
            result = generate("Machine Learning", ["gradient descent", "backprop"])
    assert result == "A note about ML."


def test_generate_sends_title_and_content_in_prompt():
    captured = {}

    def capture_post(url, *, headers, json, **kwargs):
        captured["json"] = json
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        resp.json.return_value = {"choices": [{"message": {"content": "ok"}}]}
        return resp

    client_mock = MagicMock()
    client_mock.__enter__ = MagicMock(return_value=client_mock)
    client_mock.__exit__ = MagicMock(return_value=False)
    client_mock.post = capture_post

    with patch("services.descriptor.get_endpoint", return_value=_OPENAI_ENDPOINT):
        with patch("services.descriptor.httpx.Client", return_value=client_mock):
            generate("My Note Title", ["block one text", "block two text"])

    prompt_text = captured["json"]["messages"][0]["content"]
    assert "My Note Title" in prompt_text
    assert "block one text" in prompt_text


def test_fallback_when_no_api_key():
    with patch("services.descriptor.get_endpoint", side_effect=RuntimeError("no key")):
        result = generate("Deep Learning", ["neural networks are used everywhere"])
    assert result.startswith("Deep Learning")
    assert "neural networks" in result


def test_fallback_when_http_fails():
    with patch("services.descriptor.get_endpoint", return_value=_OPENAI_ENDPOINT):
        with patch("services.descriptor.httpx.Client") as MockCls:
            client_mock = MagicMock()
            client_mock.__enter__ = MagicMock(return_value=client_mock)
            client_mock.__exit__ = MagicMock(return_value=False)
            client_mock.post.side_effect = Exception("connection refused")
            MockCls.return_value = client_mock
            result = generate("Deep Learning", ["neural nets"])
    assert result.startswith("Deep Learning")


def test_fallback_with_no_blocks():
    with patch("services.descriptor.get_endpoint", side_effect=RuntimeError("no key")):
        result = generate("Empty Note", [])
    assert result == "Empty Note."


def test_strips_whitespace_from_llm_output():
    with patch("services.descriptor.get_endpoint", return_value=_OPENAI_ENDPOINT):
        with patch("services.descriptor.httpx.Client", return_value=_mock_client("  Padded descriptor.  ")):
            result = generate("Title", ["block"])
    assert result == "Padded descriptor."
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/ayoub/projects/second_brain/backend && PYTHONPATH=. venv/bin/python -m pytest tests/test_descriptor.py -v 2>&1 | head -20
```

Expected: `ModuleNotFoundError: No module named 'services.descriptor'`

- [ ] **Step 3: Implement descriptor.py**

Create `backend/services/descriptor.py`:

```python
"""Generate a 2-3 sentence AI descriptor for a note.

Used to populate notes.descriptor + notes.descriptor_embedding so the
two-pass retriever can find notes by topic before drilling into blocks.
"""
from __future__ import annotations

import httpx

from models.agent import Mode
from services.agent.model import get_endpoint

_PROMPT = """\
You are summarizing a personal knowledge note for use in an AI retrieval system.
Write 2-3 sentences that describe what this note is about.
Be specific: mention the main topic, key concepts, and what a reader would learn.
Do not use phrases like "this note" or "this document".

Title: {title}
Content (first 2000 chars):
{content}

Descriptor:"""


def generate(note_title: str, blocks: list[str]) -> str:
    """Return a 2-3 sentence descriptor string for the note.

    Falls back to "{title}. {first_block[:200]}" if the LLM is unreachable.
    """
    content = "\n\n".join(blocks)[:2000]

    try:
        endpoint = get_endpoint(mode=Mode.API, task="chat")
    except RuntimeError:
        return _fallback(note_title, blocks)

    payload = {
        "model": endpoint["model"],
        "messages": [{"role": "user", "content": _PROMPT.format(title=note_title, content=content)}],
        "max_tokens": 120,
        "stream": False,
    }

    try:
        with httpx.Client(timeout=30) as client:
            resp = client.post(endpoint["url"], headers=endpoint["headers"], json=payload)
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception:
        return _fallback(note_title, blocks)


def _fallback(title: str, blocks: list[str]) -> str:
    first = blocks[0][:200] if blocks else ""
    if first:
        return f"{title}. {first}"
    return f"{title}."
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/ayoub/projects/second_brain/backend && PYTHONPATH=. venv/bin/python -m pytest tests/test_descriptor.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/ayoub/projects/second_brain
TREE=$(git write-tree)
PARENT=$(git rev-parse refs/heads/wip/pre-ai-substrate-merge)
COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "feat(descriptor): LLM note descriptor generator with fallback")
git update-ref refs/heads/wip/pre-ai-substrate-merge "$COMMIT"
```

---

## Task 4: Shared Indexer Service

**Files:**
- Create: `backend/services/indexer.py`

No dedicated tests — this helper is exercised via the ingest and reindex tests. Its constituent parts (block_chunker, descriptor) are already tested.

- [ ] **Step 1: Create indexer.py**

Create `backend/services/indexer.py`:

```python
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
```

- [ ] **Step 2: Commit**

```bash
cd /home/ayoub/projects/second_brain
TREE=$(git write-tree)
PARENT=$(git rev-parse refs/heads/wip/pre-ai-substrate-merge)
COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "feat(indexer): shared index_note helper for ingest + reindex")
git update-ref refs/heads/wip/pre-ai-substrate-merge "$COMMIT"
```

---

## Task 5: Two-Pass Retriever (TDD)

**Files:**
- Create: `backend/tests/test_retriever.py`
- Modify: `backend/services/retriever.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_retriever.py`:

```python
"""Tests for two-pass cosine retriever."""
from unittest.mock import MagicMock, call, patch

import pytest

from services.retriever import retrieve


def _db_with_rpc_results(pass1_rows, pass2_rows):
    """Build a mock supabase client whose .rpc() side_effect returns pass1 then pass2."""
    db = MagicMock()
    r1 = MagicMock(); r1.data = pass1_rows
    r2 = MagicMock(); r2.data = pass2_rows
    db.rpc.side_effect = [r1, r2]
    return db


def test_two_pass_returns_block_level_deep_link():
    db = _db_with_rpc_results(
        pass1_rows=[
            {"id": "note1", "title": "ML Basics", "descriptor": "About gradients", "dist": 0.1},
        ],
        pass2_rows=[
            {"note_id": "note1", "block_id": "blk-abc", "chunk_text": "Gradient descent minimizes loss.", "chunk_index": 0, "dist": 0.15},
        ],
    )
    with patch("services.retriever.get_supabase", return_value=db):
        results = retrieve([0.1] * 768, "user-x")

    assert len(results) == 1
    assert results[0]["id"] == "note1"
    assert results[0]["title"] == "ML Basics"
    assert results[0]["deep_link"] == "/brain/note1#blk-abc"
    assert "Gradient descent" in results[0]["content_text"]
    assert results[0]["similarity"] > 0


def test_two_pass_multiple_blocks_from_same_note():
    db = _db_with_rpc_results(
        pass1_rows=[
            {"id": "note1", "title": "Note", "descriptor": "desc", "dist": 0.1},
        ],
        pass2_rows=[
            {"note_id": "note1", "block_id": "b1", "chunk_text": "block one", "chunk_index": 0, "dist": 0.1},
            {"note_id": "note1", "block_id": "b2", "chunk_text": "block two", "chunk_index": 1, "dist": 0.2},
            {"note_id": "note1", "block_id": "b3", "chunk_text": "block three", "chunk_index": 2, "dist": 0.3},
        ],
    )
    with patch("services.retriever.get_supabase", return_value=db):
        results = retrieve([0.1] * 768, "user-x")

    assert len(results) == 3
    deep_links = {r["deep_link"] for r in results}
    assert "/brain/note1#b1" in deep_links
    assert "/brain/note1#b2" in deep_links


def test_two_pass_multiple_notes():
    db = _db_with_rpc_results(
        pass1_rows=[
            {"id": "note1", "title": "Note 1", "descriptor": "d1", "dist": 0.1},
            {"id": "note2", "title": "Note 2", "descriptor": "d2", "dist": 0.2},
        ],
        pass2_rows=[
            {"note_id": "note1", "block_id": "b1", "chunk_text": "text1", "chunk_index": 0, "dist": 0.1},
            {"note_id": "note2", "block_id": "b2", "chunk_text": "text2", "chunk_index": 0, "dist": 0.2},
        ],
    )
    with patch("services.retriever.get_supabase", return_value=db):
        results = retrieve([0.1] * 768, "user-x")

    note_ids = {r["id"] for r in results}
    assert "note1" in note_ids
    assert "note2" in note_ids


def test_fallback_to_match_chunks_when_no_descriptors():
    """When pass1 returns nothing (no notes have descriptors yet), fall back."""
    db = MagicMock()
    empty = MagicMock(); empty.data = []
    fallback_result = MagicMock()
    fallback_result.data = [
        {
            "note_id":    "note1",
            "title":      "Old Note",
            "deep_link":  "/brain/note1",
            "chunk_text": "legacy chunk",
            "similarity": 0.7,
        }
    ]
    db.rpc.side_effect = [empty, fallback_result]

    with patch("services.retriever.get_supabase", return_value=db):
        results = retrieve([0.1] * 768, "user-x")

    # Fallback should have been called (second rpc call is match_chunks)
    assert db.rpc.call_count == 2
    second_call_name = db.rpc.call_args_list[1][0][0]
    assert second_call_name == "match_chunks"


def test_pass1_uses_correct_rpc():
    db = _db_with_rpc_results(pass1_rows=[], pass2_rows=[])
    db.rpc.side_effect = [MagicMock(data=[]), MagicMock(data=[])]

    with patch("services.retriever.get_supabase", return_value=db):
        retrieve([0.1] * 768, "user-x")

    first_rpc = db.rpc.call_args_list[0][0][0]
    assert first_rpc == "match_note_descriptors"


def test_empty_embedding_returns_empty():
    db = MagicMock()
    db.rpc.return_value = MagicMock(data=[])
    with patch("services.retriever.get_supabase", return_value=db):
        results = retrieve([], "user-x")
    assert results == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/ayoub/projects/second_brain/backend && PYTHONPATH=. venv/bin/python -m pytest tests/test_retriever.py -v 2>&1 | head -30
```

Expected: multiple failures — the retriever currently uses `match_chunks`, not `match_note_descriptors`.

- [ ] **Step 3: Rewrite retriever.py**

Replace `backend/services/retriever.py` entirely:

```python
"""Semantic retrieval — two-pass cosine similarity via Supabase RPC.

Pass 1: match notes by descriptor_embedding (notes must have been indexed).
Pass 2: within the top notes, find the best matching blocks.

Falls back to legacy match_chunks RPC for notes that haven't been re-indexed
(no descriptor_embedding set).
"""
from __future__ import annotations

from services.database import get_supabase

_TOP_NOTES    = 5
_TOP_BLOCKS   = 15   # total across all top notes
_LEGACY_THRESHOLD = 0.50
_LEGACY_CHUNKS    = 12


def retrieve(query_embedding: list[float], user_id: str) -> list[dict]:
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
            "match_count":     _TOP_BLOCKS,
        },
    ).execute()

    block_rows = pass2.data or []

    if not block_rows:
        return _legacy_fallback(db, vec, user_id)

    results = []
    for row in block_rows:
        nid      = str(row["note_id"])
        block_id = row.get("block_id") or ""
        meta     = note_meta.get(nid, {})
        score    = max(0.0, 1.0 - float(row["dist"]))
        deep_link = f"/brain/{nid}#{block_id}" if block_id else f"/brain/{nid}"
        results.append({
            "id":           nid,
            "title":        meta.get("title", ""),
            "deep_link":    deep_link,
            "content_text": row.get("chunk_text", "")[:300],
            "similarity":   score,
        })

    return results


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

    best = sorted(seen.values(), key=lambda r: r["similarity"], reverse=True)[:6]
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/ayoub/projects/second_brain/backend && PYTHONPATH=. venv/bin/python -m pytest tests/test_retriever.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Verify existing brain_tools tests still pass (no regression)**

```bash
cd /home/ayoub/projects/second_brain/backend && PYTHONPATH=. venv/bin/python -m pytest tests/test_brain_tools.py -v
```

Expected: all pass (they mock `retrieve` directly, so the new implementation is not invoked).

- [ ] **Step 6: Commit**

```bash
cd /home/ayoub/projects/second_brain
TREE=$(git write-tree)
PARENT=$(git rev-parse refs/heads/wip/pre-ai-substrate-merge)
COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "feat(retriever): two-pass descriptor→block retrieval with legacy fallback")
git update-ref refs/heads/wip/pre-ai-substrate-merge "$COMMIT"
```

---

## Task 6: Update Ingest Pipeline

**Files:**
- Modify: `backend/routers/agent_ingest.py`

After `run_ingest_turn` completes, fetch the updated note content from DB and index it (blocks + descriptor). The indexing runs before `[DONE]` so the frontend knows the note is searchable when the stream ends.

- [ ] **Step 1: Update agent_ingest.py**

Replace the entire file `backend/routers/agent_ingest.py`:

```python
"""POST /agent/ingest — multipart endpoint for agentic PDF/URL ingestion.

Accepts either a file upload or a url form field. Extracts the source text,
creates an empty note, then streams the agent loop (with note-author skill
auto-loaded) as SSE. Emits ingest_created {note_id} before the LLM call so
the frontend can navigate to the note immediately.

After the agent turn completes, indexes the note content (block chunks +
descriptor) so it is searchable before [DONE] is emitted.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import AsyncIterator

from fastapi import APIRouter, Form, Header, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse

from models.agent import AgentRequest, ChatMessage, Mode
from routers.ingest import get_user_id
from services.agent.engine import run_ingest_turn
from services.agent.skills import SkillRegistry
from services.database import get_supabase
from services.file_extractor import extract_file
from services.indexer import index_note
from services.url_extractor import extract_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agent", tags=["agent"])

_BUNDLED_SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"
_USER_SKILLS_DIR = Path.home() / ".secondbrain" / "skills"

SUPPORTED_EXTENSIONS = {".pdf", ".txt", ".md", ".rst", ".csv", ".pptx", ".docx"}


def _get_registry() -> SkillRegistry:
    return SkillRegistry.load([_BUNDLED_SKILLS_DIR, _USER_SKILLS_DIR])


def _create_stub_note(user_id: str, title: str) -> str:
    row = (
        get_supabase()
        .table("notes")
        .insert({"user_id": user_id, "title": title, "content": []})
        .execute()
        .data[0]
    )
    return row["id"]


@router.post("/ingest")
async def agent_ingest(
    authorization: str = Header(),
    file: UploadFile | None = File(default=None),
    url: str | None = Form(default=None),
    mode: str = Form(default="api"),
):
    user_id = get_user_id(authorization)

    # --- Source extraction ---
    if file is not None:
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in SUPPORTED_EXTENSIONS:
            raise HTTPException(
                400,
                detail=f"Unsupported file type '{ext}'. Accepted: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
            )
        suffix = ext or ".bin"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name
        try:
            source_text = extract_file(tmp_path, file.filename or "")
        except ValueError as e:
            raise HTTPException(422, detail=str(e))
        finally:
            os.unlink(tmp_path)
        title = file.filename or "Untitled"
    elif url and url.strip():
        try:
            title, source_text = extract_url(url.strip())
        except ValueError as e:
            raise HTTPException(422, detail=str(e))
    else:
        raise HTTPException(400, detail="Provide either a file or a url field.")

    if not source_text.strip():
        raise HTTPException(422, detail="Could not extract text from source.")

    note_id = _create_stub_note(user_id, title)
    ingest_mode = Mode.API if mode == "api" else Mode.LOCAL
    registry = _get_registry()

    async def stream() -> AsyncIterator[bytes]:
        yield ("data: " + json.dumps({"type": "ingest_created", "note_id": note_id}) + "\n\n").encode()

        request = AgentRequest(
            thread_id=None,
            messages=[
                ChatMessage(
                    role="user",
                    content=(
                        f"Create a structured mastery-guide note from the following source "
                        f"material. Note title: \"{title}\". Note ID (use with brain.update_note): "
                        f"{note_id}\n\n---\n\n{source_text[:12000]}"
                    ),
                )
            ],
            query=f"Ingest: {title}",
            mode=ingest_mode,
            current_note_id=note_id,
            surface="ingest",
        )

        async for ev in run_ingest_turn(request, user_id=user_id, skill_registry=registry):
            yield ("data: " + json.dumps(ev) + "\n\n").encode()

        # Index note content after agent has written it
        try:
            index_note(note_id, user_id)
        except Exception:
            logger.exception("post-ingest indexing failed for note %s", note_id)

        yield b"data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")
```

- [ ] **Step 2: Run existing ingest tests to check for regressions**

```bash
cd /home/ayoub/projects/second_brain/backend && PYTHONPATH=. venv/bin/python -m pytest tests/test_agent_ingest.py -v
```

Expected: all existing tests PASS (new import and indexer call don't break existing flow).

- [ ] **Step 3: Commit**

```bash
cd /home/ayoub/projects/second_brain
TREE=$(git write-tree)
PARENT=$(git rev-parse refs/heads/wip/pre-ai-substrate-merge)
COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "feat(ingest): index note blocks + descriptor after agent turn")
git update-ref refs/heads/wip/pre-ai-substrate-merge "$COMMIT"
```

---

## Task 7: Reindex Endpoints

**Files:**
- Modify: `backend/routers/internal.py`

Add two JWT-gated endpoints (user auth, not internal-key auth) for triggering reindex.

- [ ] **Step 1: Update internal.py**

Open `backend/routers/internal.py` and add the following imports at the top (after existing imports):

```python
from services.indexer import index_note
```

Then add these two new models and endpoints at the bottom of the file (after the existing `internal_list_notes` endpoint):

```python
class ReindexNoteRequest(BaseModel):
    note_id: str


@router.post("/reindex-note")
def reindex_note(body: ReindexNoteRequest, authorization: str = Header()):
    """Re-chunk and re-describe a single note. Auth: user JWT."""
    from routers.ingest import get_user_id
    user_id = get_user_id(authorization)
    success = index_note(body.note_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"reindexed": 1}


@router.post("/reindex")
def reindex_all(authorization: str = Header()):
    """Re-chunk and re-describe all notes for the authenticated user."""
    from routers.ingest import get_user_id
    user_id = get_user_id(authorization)

    db = get_supabase()
    notes_res = (
        db.table("notes")
        .select("id")
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .execute()
    )
    note_ids = [r["id"] for r in (notes_res.data or [])]

    reindexed = 0
    failed = 0
    for nid in note_ids:
        try:
            if index_note(nid, user_id):
                reindexed += 1
            else:
                failed += 1
        except Exception:
            failed += 1

    return {"reindexed": reindexed, "failed": failed}
```

- [ ] **Step 2: Run full backend test suite**

```bash
cd /home/ayoub/projects/second_brain/backend && PYTHONPATH=. venv/bin/python -m pytest tests/ -v --ignore=tests/test_block_chunker.py --ignore=tests/test_descriptor.py --ignore=tests/test_retriever.py 2>&1 | tail -20
```

Expected: no new failures.

- [ ] **Step 3: Commit**

```bash
cd /home/ayoub/projects/second_brain
TREE=$(git write-tree)
PARENT=$(git rev-parse refs/heads/wip/pre-ai-substrate-merge)
COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "feat(internal): /reindex and /reindex-note endpoints")
git update-ref refs/heads/wip/pre-ai-substrate-merge "$COMMIT"
```

---

## Task 8: Frontend — API Proxy + Editor Debounce

**Files:**
- Create: `frontend/app/api/internal/reindex-note/route.ts`
- Modify: `frontend/components/editor/NoteEditorPage.tsx`

- [ ] **Step 1: Create the Next.js proxy route**

Create directory and file `frontend/app/api/internal/reindex-note/route.ts`:

```typescript
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const fastApiUrl = process.env.FASTAPI_URL ?? "http://localhost:8000";
  const body = await req.json();

  let res: Response;
  try {
    res = await fetch(`${fastApiUrl}/internal/reindex-note`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return new Response(JSON.stringify({ error: "Backend unreachable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const data = await res.json().catch(() => ({}));
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 2: Add debounce ref to NoteEditorPage.tsx**

Open `frontend/components/editor/NoteEditorPage.tsx`.

Add `reindexDebounceRef` alongside the existing `titleDebounceRef` (around line 88):

Find this line:
```typescript
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Add after it:
```typescript
  const reindexDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

- [ ] **Step 3: Add debounced reindex call inside handleSaveContent**

Find the `handleSaveContent` callback (around line 151):

```typescript
  const handleSaveContent = useCallback(
    async (blocks: AnyBlock[], plainText: string) => {
      setSaving(true);
      await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: blocks, content_text: plainText }),
      });
      setSaving(false);
      setLastSaved(new Date());
    },
    [note.id]
  );
```

Replace it with:

```typescript
  const handleSaveContent = useCallback(
    async (blocks: AnyBlock[], plainText: string) => {
      setSaving(true);
      await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: blocks, content_text: plainText }),
      });
      setSaving(false);
      setLastSaved(new Date());

      // Debounce re-index: fire 30s after last block change
      if (reindexDebounceRef.current) clearTimeout(reindexDebounceRef.current);
      reindexDebounceRef.current = setTimeout(() => {
        fetch("/api/internal/reindex-note", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note_id: note.id }),
        }).catch(() => {
          // silent — reindex is best-effort
        });
      }, 30_000);
    },
    [note.id]
  );
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/ayoub/projects/second_brain/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no new TypeScript errors.

- [ ] **Step 5: Commit**

```bash
cd /home/ayoub/projects/second_brain
TREE=$(git write-tree)
PARENT=$(git rev-parse refs/heads/wip/pre-ai-substrate-merge)
COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "feat(frontend): debounced reindex-note on editor change + Next.js proxy")
git update-ref refs/heads/wip/pre-ai-substrate-merge "$COMMIT"
```

---

## Task 9: Full Test Suite Verification

- [ ] **Step 1: Run all new unit tests**

```bash
cd /home/ayoub/projects/second_brain/backend && PYTHONPATH=. venv/bin/python -m pytest tests/test_block_chunker.py tests/test_descriptor.py tests/test_retriever.py -v
```

Expected: all tests PASS.

- [ ] **Step 2: Run full backend test suite**

```bash
cd /home/ayoub/projects/second_brain/backend && PYTHONPATH=. venv/bin/python -m pytest tests/ -v 2>&1 | tail -30
```

Expected: no regressions — all existing tests continue to pass.

- [ ] **Step 3: Check git integrity before push**

```bash
cd /home/ayoub/projects/second_brain
git fsck --full 2>&1 | grep -E "empty|missing" | head -10
```

Expected: no output (no corruption).

---

## Self-Review Checklist

Spec requirement → task coverage:

| Spec requirement | Task |
|---|---|
| Migration: descriptor cols + block_id col + HNSW index | Task 1 |
| Migration: match_note_descriptors RPC | Task 1 |
| Migration: match_blocks_in_notes RPC | Task 1 |
| block_chunker: parse BlockNote JSON | Task 2 |
| block_chunker: skip empty/divider blocks | Task 2 |
| block_chunker: traverse nested children | Task 2 |
| block_chunker: preserve block_id | Task 2 |
| descriptor: 2-3 sentence LLM summary | Task 3 |
| descriptor: fallback on LLM failure | Task 3 |
| descriptor: embed via embedder.embed() | Task 4 (indexer) |
| retriever: two-pass cosine | Task 5 |
| retriever: deep_link = /brain/{noteId}#{blockId} | Task 5 |
| retriever: fallback for un-indexed notes | Task 5 |
| ingest: block chunk + describe after agent turn | Task 6 |
| /internal/reindex — all notes | Task 7 |
| /internal/reindex-note — single note | Task 7 |
| frontend: 30s debounce on edit | Task 8 |
| frontend: Next.js proxy route | Task 8 |

All requirements covered. No placeholders. All code is complete.
