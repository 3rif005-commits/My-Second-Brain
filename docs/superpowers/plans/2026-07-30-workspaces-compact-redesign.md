# Workspaces Compact Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the canvas-based Workspaces UI and its data model with a compact single-note shell at `/brain/workspace/<noteId>` where many sources attach to one note and one AI synthesis comes out.

**Architecture:** Sources attach directly to a `notes` row (`note_resources`), created lazily on the first attach. The per-resource summary is gone: synthesis lives on `note_synthesis`, keyed by note, fired once by a settle guard when the last source finishes processing. The extraction / capture / AI-provider engine is untouched — only the shell around it (data model, router surface, frontend) is rebuilt.

**Tech Stack:** FastAPI + supabase-py (backend), Postgres/pgvector via Supabase SQL editor (migrations), Next.js 15 App Router + React 19 + Tailwind + BlockNote (frontend), pytest (backend tests), `tsc --noEmit` + `next build` (frontend gate).

## Global Constraints

- **Source of truth:** `docs/superpowers/specs/2026-07-30-workspaces-compact-redesign-design.md`. Do not redesign it.
- **Fully replace the canvas.** No alternate mode, no flag, no "keep it just in case". `WorkspaceCanvas.tsx`, `ResourceCard.tsx`, `NotePageCard.tsx`, both `brain/workspaces/` routes and the `@xyflow/react` dependency are deleted.
- **One note per session, never one per resource.** `summary_html` leaves the resource table entirely.
- **Do not rebuild the engine.** `pdf_elements.py`, `youtube.py`, `video.py`, `website.py`, `media.py`, `storage.py`, all of `services/ai/`, element-level PDF extraction, formula→LaTeX, grounded chat citation payloads and every `frontend/components/workspace/viewers/*` component are proven and live-tested as of 2026-07-29. Reshape the shell around them. `SplitView.tsx` is **dissolved into `NotePane.tsx` by moving** its editor host / `ingestHtml` handoff / anchor logic / send-to-note bus — not by rewriting them from scratch.
- **No native `window.confirm/prompt/alert`** anywhere — they freeze the tab for browser automation. Use `components/ui/ConfirmDialog.tsx`, `components/ui/PromptDialog.tsx`, `useToast()` from `app/providers.tsx`.
- **BlockNote 0.48.0:** `createReactBlockSpec` returns a factory — always call it (`math: MathBlockSpec()`).
- **react-pdf breaks SSR** (`DOMMatrix` at import time). Anything that reaches `PdfViewer` must be behind `next/dynamic({ ssr: false })`.
- **Backend tests** (two venvs; ROS Jazzy system pytest plugins break collection):
  `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/ -p asyncio`
  `backend/venv` = test venv (heavy deps stubbed in `backend/conftest.py`); `backend/.venv` = runtime venv. `pytest.ini` sets `asyncio_mode = auto`.
- **Frontend gate:** `cd frontend && npx tsc --noEmit && npm run build` — both clean.
- **No DB access from this machine.** `DATABASE_URL` in `backend/.env` is a placeholder. Migration 013 is destructive and must be run by the user in the Supabase SQL editor (project `esfhsdukyhyrlgzflsad`). Never assume it has been applied.
- **Dev-environment facts:** background servers do not survive a session boundary (`./llama.sh start`, `cd backend && .venv/bin/uvicorn main:app --reload --port 8000`, `cd frontend && npm run dev`). `next dev` cold-compiling this route takes 30–60s — not a hang. Supabase free tier auto-pauses; "Project is paused" is one non-destructive click to resume.
- **Anchor format changes** from `p:14` to `2:p:14` (source index first). Client regex: `^(\d+):([tps]):([\d.]+)$`.
- Delegate the repeated screenshot-inspection loop to a **Haiku subagent** (`Agent` tool, `model: "haiku"`). Keep the main session for design decisions and code.

## Deviations from the spec (deliberate, flagged for review)

1. **Spec §10 ordering, split finer.** §10 step 2 bundles the prompt module with `synthesis.py`, and step 3 bundles the processor slim-down with "the settle trigger". `maybe_synthesize` lives in `synthesis.py` (per §4), so this plan tests it with the module that owns it: Task 2 = prompt, Task 3 = synthesis service **including the settle guard**, Task 4 = processor slim-down (which only *calls* the guard). Same work, boundaries drawn where the tests are.
2. **Per-source text at synthesis time.** The old `processor.py` summarized while the extracted text was still in memory. Synthesis now runs after *all* sources land, so it must re-derive each source's text. It reassembles it from `resource_chunks` (chunk text + anchor-derived `[page N]` / `[mm:ss]` / `[section N]` tags), which needs no schema change beyond the approved one. Consequence: `_insert_chunks` must insert rows **even when embedding fails** (embedding NULL) — otherwise an embedding failure would silently starve synthesis. The RPC already filters `embedding IS NOT NULL`, so chat behaviour is unchanged.
3. **`mode` is not persisted.** §6 has `POST /notes/{id}/synthesize {mode}` but the approved `note_synthesis` shape has no `mode` column, and mode only affects how the *client* applies the draft. `run_synthesis(note_id, mode)` keeps the parameter (logged, per §4's signature) and the client holds its choice. A client that reloads mid-run re-decides via its normal replace/append path.
4. **`GET /notes/{id}/synthesis` also returns `applied_at`.** §6 lists `{status, html?, source_ids, title_suggestion?, error?}`, but §6 also defines `POST /synthesis/applied`, and the client cannot know whether a `ready` draft still needs applying without reading it back.
5. **The note title is rendered in the shell header, not inside `NotePane`.** §7's component table assigns "Title" to `NotePane`; §7's layout diagram puts it in the header row. The layout diagram is the more concrete artifact, so the header wins: the shell owns note load + title persistence and passes the note down.
6. **`_with_retry` moves** from `processor.py` into `services/workspace/dbretry.py` as `with_retry`, so `synthesis.py` can use it for its terminal write (§8's last row) without a circular import. Pure move — the body and the comment explaining *why* it exists are preserved verbatim.

---

## File Structure

**Backend — created**

| File | Responsibility |
|---|---|
| `supabase/migrations/013_note_sources.sql` | Drops the 012 canvas tables; creates `note_resources`, `note_synthesis`, `resource_elements`, `resource_chunks` (+ `match_note_source_chunks`), `note_anchors`. |
| `backend/prompts/note_synthesis.py` | Multi-source synthesis prompt: source blocks, budget split, source-indexed anchor instructions. Pure functions, no I/O. |
| `backend/services/workspace/synthesis.py` | `maybe_synthesize` (settle guard), `run_synthesis`, source-text reassembly, `note_synthesis` writes. |
| `backend/services/workspace/dbretry.py` | `with_retry` — transient-Supabase-disconnect retry, shared by processor + synthesis. |
| `backend/routers/note_sources.py` | The whole HTTP surface: sources, synthesis, anchors, chat, recents, ai-providers. |
| `backend/tests/test_note_synthesis.py` | Prompt tests. |
| `backend/tests/test_synthesis_trigger.py` | Settle-guard + `run_synthesis` tests. |
| `backend/tests/test_note_sources_router.py` | Router tests. |

**Backend — modified:** `services/workspace/processor.py` (slim-down + note-scoped chunks + settle call), `services/workspace/chat.py` (note scope), `main.py` (router registration), `tests/test_workspace_chat.py`.

**Backend — deleted:** `routers/workspaces.py`, `prompts/workspace_summary.py`, `tests/test_workspaces_router.py`, `tests/test_workspace_summary.py`.

**Frontend — created**

| File | Responsibility |
|---|---|
| `components/workspace/WorkspaceShell.tsx` | Layout + session state (sources, active source, note, chat open, split %), whole-shell drag-and-drop, status polling, deep links, modals. |
| `components/workspace/SourceRail.tsx` | Compact source list: select, add (file / URL), remove, retry. |
| `components/workspace/SourceViewer.tsx` | Dispatcher onto `viewers/*` by `kind`; owns the `ssr:false` boundary for `PdfViewer`. |
| `components/workspace/NotePane.tsx` | Editor host, autosave + debounced reindex, synthesis apply (replace/append), anchor registration, section chips, send-to-note bus. Absorbed from `SplitView.tsx`. |
| `components/workspace/DropZone.tsx` | Empty-state drop zone + recents strip. |
| `components/workspace/useSynthesis.ts` | Synthesis polling, staleness, replace/append decision. JSX-free. |
| `app/(brain)/brain/workspace/page.tsx` | Empty shell. |
| `app/(brain)/brain/workspace/[noteId]/page.tsx` | Shell for a note. |

**Frontend — modified:** `lib/workspace.ts` (rewritten), `components/workspace/WorkspaceChat.tsx` (note-scoped drawer), `components/workspace/viewers/*.tsx` (type/method renames only), `components/editor/BlockEditor.tsx` (+`insertHtmlAtEnd`), `components/editor/customBlocks.tsx` (checkpoint `noteId`), `components/editor/NoteEditorPage.tsx` ("Open sources (N)"), `components/sidebar/Sidebar.tsx`, `app/api/ws/[...path]/route.ts` (allowlist), `package.json`.

**Frontend — deleted:** `components/workspace/WorkspaceCanvas.tsx`, `ResourceCard.tsx`, `NotePageCard.tsx`, `SplitView.tsx`, `app/(brain)/brain/workspaces/` (both routes), `@xyflow/react`.

---

## Task 1: Migration 013 — `note_sources.sql` (BLOCKING GATE)

**Files:**
- Create: `supabase/migrations/013_note_sources.sql`

**Interfaces:**
- Produces: tables `note_resources`, `note_synthesis`, `resource_elements`, `resource_chunks`, `note_anchors`; RPC `match_note_source_chunks(query_embedding, match_user_id, target_note_id, match_count)`. Every later backend task reads these names.

- [ ] **Step 1: Write the migration**

```sql
-- Migration 013: note sources (Workspaces compact redesign)
--
-- Replaces the 012 canvas data model with "one note, many sources":
--   workspaces / workspace_pages / workspace_resources  →  note_resources
--   workspace_resources.summary_html                    →  note_synthesis.html
--
-- DESTRUCTIVE. Notes themselves are never touched — notes created by the old
-- per-resource summary flow survive as ordinary notes.
--
-- ai_providers and the private 'workspace-resources' storage bucket are KEPT.
-- Bucket objects under user_id/resource_id/... are orphaned by the drops below;
-- deleting them is manual housekeeping, not a migration step (the bucket is
-- private and the paths are user-scoped, so orphans are harmless).
--
-- Run manually in the Supabase SQL editor (project esfhsdukyhyrlgzflsad) —
-- DATABASE_URL is a placeholder on the dev machine.

BEGIN;

-- ---- drop the canvas model ----

DROP FUNCTION IF EXISTS match_workspace_chunks(vector, uuid, uuid, int);
DROP TABLE IF EXISTS note_anchors       CASCADE;
DROP TABLE IF EXISTS resource_chunks    CASCADE;
DROP TABLE IF EXISTS resource_elements  CASCADE;
DROP TABLE IF EXISTS workspace_pages    CASCADE;
DROP TABLE IF EXISTS workspace_resources CASCADE;
DROP TABLE IF EXISTS workspaces         CASCADE;


-- ---- note_resources (sources attached to one note) ----

CREATE TABLE note_resources (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id       UUID        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind          TEXT        NOT NULL CHECK (kind IN ('pdf','document','youtube','video','website')),
  title         TEXT        NOT NULL DEFAULT 'Untitled source',
  source_url    TEXT,
  storage_path  TEXT,
  mime_type     TEXT,
  status        TEXT        NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','processing','ready','failed')),
  error         TEXT,
  meta          JSONB       NOT NULL DEFAULT '{}',
  order_index   INTEGER     NOT NULL DEFAULT 0,   -- position in the source rail
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX note_resources_note_idx ON note_resources(note_id, order_index);
CREATE INDEX note_resources_user_idx ON note_resources(user_id);

ALTER TABLE note_resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY note_resources_owner_all ON note_resources
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- ---- note_synthesis (the AI draft for one note, built from many sources) ----

CREATE TABLE note_synthesis (
  note_id          UUID        PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  html             TEXT,
  status           TEXT        NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','running','ready','failed')),
  error            TEXT,
  source_ids       UUID[]      NOT NULL DEFAULT '{}',  -- what this draft was built from
  title_suggestion TEXT,
  applied_at       TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX note_synthesis_user_idx ON note_synthesis(user_id);

ALTER TABLE note_synthesis ENABLE ROW LEVEL SECURITY;
CREATE POLICY note_synthesis_owner_all ON note_synthesis
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- ---- resource_elements (selectable elements: text, heading, image, table, formula) ----

CREATE TABLE resource_elements (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id   UUID        NOT NULL REFERENCES note_resources(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  page          INTEGER     NOT NULL DEFAULT 0,
  element_type  TEXT        NOT NULL CHECK (element_type IN ('text','heading','image','table','formula')),
  order_index   INTEGER     NOT NULL DEFAULT 0,
  bbox          JSONB,               -- [x0, y0, x1, y1] in PDF points / relative units
  content       TEXT,                -- text / markdown table / latex
  image_path    TEXT                 -- storage path for image/formula crops
);

CREATE INDEX resource_elements_res_idx ON resource_elements(resource_id, page);

ALTER TABLE resource_elements ENABLE ROW LEVEL SECURITY;
CREATE POLICY resource_elements_owner_all ON resource_elements
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- ---- resource_chunks (anchored chunks: grounded chat + synthesis source text) ----

CREATE TABLE resource_chunks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id   UUID        NOT NULL REFERENCES note_resources(id) ON DELETE CASCADE,
  note_id       UUID        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  chunk_index   INTEGER     NOT NULL,
  chunk_text    TEXT        NOT NULL,
  anchor_type   TEXT        NOT NULL CHECK (anchor_type IN ('time','page','section')),
  anchor_start  DOUBLE PRECISION NOT NULL DEFAULT 0,
  anchor_end    DOUBLE PRECISION NOT NULL DEFAULT 0,
  embedding     vector(768),         -- NULL when embedding failed; text still usable
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX resource_chunks_note_idx ON resource_chunks(note_id);
CREATE INDEX resource_chunks_res_idx  ON resource_chunks(resource_id, chunk_index);
CREATE INDEX resource_chunks_embedding_hnsw ON resource_chunks
  USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);

ALTER TABLE resource_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY resource_chunks_owner_all ON resource_chunks
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION match_note_source_chunks(
  query_embedding  vector(768),
  match_user_id    uuid,
  target_note_id   uuid,
  match_count      int DEFAULT 10
)
RETURNS TABLE (
  id            uuid,
  resource_id   uuid,
  chunk_text    text,
  anchor_type   text,
  anchor_start  double precision,
  anchor_end    double precision,
  similarity    double precision
)
LANGUAGE sql STABLE
AS $$
  SELECT rc.id, rc.resource_id, rc.chunk_text,
         rc.anchor_type, rc.anchor_start, rc.anchor_end,
         1 - (rc.embedding <=> query_embedding) AS similarity
  FROM resource_chunks rc
  WHERE rc.note_id  = target_note_id
    AND rc.user_id  = match_user_id
    AND rc.embedding IS NOT NULL
  ORDER BY rc.embedding <=> query_embedding
  LIMIT match_count;
$$;


-- ---- note_anchors (note block ↔ source position sync) ----

CREATE TABLE note_anchors (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id       UUID        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  resource_id   UUID        NOT NULL REFERENCES note_resources(id) ON DELETE CASCADE,
  block_id      TEXT        NOT NULL,
  anchor_type   TEXT        NOT NULL CHECK (anchor_type IN ('time','page','section')),
  anchor_start  DOUBLE PRECISION NOT NULL DEFAULT 0,
  anchor_end    DOUBLE PRECISION NOT NULL DEFAULT 0,
  UNIQUE (note_id, block_id)
);

CREATE INDEX note_anchors_note_idx ON note_anchors(note_id);

ALTER TABLE note_anchors ENABLE ROW LEVEL SECURITY;
CREATE POLICY note_anchors_owner_all ON note_anchors
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

COMMIT;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/013_note_sources.sql
git commit -m "feat(db): migration 013 — note_resources + note_synthesis, drop canvas model"
```

- [ ] **Step 3: STOP. Ask the user to run it.**

Post this to the user verbatim and **do not proceed past Task 6 until they confirm**:

> `supabase/migrations/013_note_sources.sql` is ready. It **drops** `workspaces`,
> `workspace_pages`, `workspace_resources`, `resource_elements`, `resource_chunks`,
> `note_anchors` and the `match_workspace_chunks` function (clean slate, as approved
> in §3 of the spec). Your notes are not touched. Please paste it into the Supabase
> SQL editor for project `esfhsdukyhyrlgzflsad` and run it, then tell me it's done.
> If the dashboard says "Project is paused", that's the free-tier auto-pause — one
> non-destructive click to resume.

Tasks 2–6 (prompt, synthesis service, processor, chat, router + its mocked tests) and Tasks 7–12 (all frontend) do **not** touch a live database — keep working through them while waiting. Only the live browser pass (Task 13) is gated on the migration.

---

## Task 2: `prompts/note_synthesis.py` — the multi-source prompt

**Files:**
- Create: `backend/prompts/note_synthesis.py`
- Test: `backend/tests/test_note_synthesis.py`
- Delete (last step): `backend/prompts/workspace_summary.py`, `backend/tests/test_workspace_summary.py`

**Interfaces:**
- Consumes: `prompts.mastery_guide.SYSTEM_PROMPT`.
- Produces:
  - `TOTAL_SOURCE_BUDGET: int = 24000`
  - `split_budget(lengths: list[int], total: int = TOTAL_SOURCE_BUDGET) -> list[int]`
  - `build_note_synthesis_prompt(sources: list[dict], total_budget: int = TOTAL_SOURCE_BUDGET) -> str`, where each source dict is `{"title": str, "kind": str, "text": str, "duration": float | None}`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_note_synthesis.py`:

```python
"""Tests for the multi-source note synthesis prompt — every source gets its own
block, anchors are source-indexed, and the character budget is split fairly."""
from prompts.mastery_guide import SYSTEM_PROMPT
from prompts.note_synthesis import (TOTAL_SOURCE_BUDGET,
                                    build_note_synthesis_prompt, split_budget)

SOURCES = [
    {"title": "Backprop paper", "kind": "pdf", "text": "[page 1]\nchain rule", "duration": None},
    {"title": "3Blue1Brown — Backpropagation", "kind": "youtube",
     "text": "[00:12] gradient descent", "duration": 1122.0},
    {"title": "en.wikipedia.org/wiki/Backpropagation", "kind": "website",
     "text": "[section 1]\nhistory", "duration": None},
]


def test_reuses_mastery_guide_prompt_verbatim():
    assert SYSTEM_PROMPT in build_note_synthesis_prompt(SOURCES)


def test_every_source_gets_a_numbered_header():
    prompt = build_note_synthesis_prompt(SOURCES)
    assert '=== SOURCE 1: "Backprop paper" (pdf) ===' in prompt
    assert '=== SOURCE 2: "3Blue1Brown — Backpropagation" (youtube, 18:42) ===' in prompt
    assert '=== SOURCE 3: "en.wikipedia.org/wiki/Backpropagation" (website) ===' in prompt


def test_source_indexed_anchor_instruction_present():
    prompt = build_note_synthesis_prompt(SOURCES)
    assert 'data-anchor="SOURCE:TYPE:VALUE"' in prompt
    assert 'data-anchor="1:p:14"' in prompt      # worked example
    assert "t:SECONDS" in prompt
    assert "p:PAGE" in prompt
    assert "s:INDEX" in prompt


def test_tells_the_model_to_synthesize_not_concatenate():
    prompt = build_note_synthesis_prompt(SOURCES)
    assert "Organize the note by CONCEPT" in prompt
    assert "one <h2> per source" in prompt       # names the failure mode
    assert "<h1>" in prompt                      # topic title for the note


def test_per_kind_tagging_preserved_per_block():
    prompt = build_note_synthesis_prompt(SOURCES)
    assert "[page N]" in prompt
    assert "[mm:ss]" in prompt
    assert "[section N]" in prompt


def test_transcript_less_source_declares_the_attached_video():
    prompt = build_note_synthesis_prompt([
        {"title": "Lecture", "kind": "video", "text": "", "duration": 60.0}])
    assert "No transcript" in prompt
    assert "attached" in prompt


def test_budget_even_split_when_all_sources_are_long():
    assert split_budget([10_000, 10_000], 1_000) == [500, 500]


def test_budget_gives_short_sources_only_what_they_need():
    assert split_budget([100, 100], 1_000) == [100, 100]


def test_budget_redistributes_the_unused_share():
    # 500 each; source 0 only needs 100, so source 1 gets the leftover 400 too
    assert split_budget([100, 10_000], 1_000) == [100, 900]


def test_budget_handles_no_sources():
    assert split_budget([], 1_000) == []


def test_source_text_is_capped_by_the_total_budget():
    # U+2588 appears in no template, so counting it measures exactly the source
    # text that reached the prompt — not an incidental property of other strings.
    prompt = build_note_synthesis_prompt([
        {"title": f"Source {i}", "kind": "pdf", "text": "█" * 50_000,
         "duration": None}
        for i in range(3)
    ])
    used = prompt.count("█")
    assert used <= TOTAL_SOURCE_BUDGET
    assert used > TOTAL_SOURCE_BUDGET - 10   # the budget is actually spent
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/test_note_synthesis.py -p asyncio -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'prompts.note_synthesis'`

- [ ] **Step 3: Write the module**

`backend/prompts/note_synthesis.py`:

```python
"""Multi-source note synthesis prompt.

One note per session: every source attached to the note is fed in as its own
`=== SOURCE n ===` block and the model is asked to synthesize ACROSS them
(organize by concept, not by source). Anchors are source-indexed
(`data-anchor="2:p:14"`) so the client can map each section back to the right
source.

Replaces prompts/workspace_summary.py, which summarized exactly one resource.
Still built on the app's canonical note style (prompts/mastery_guide).
"""
from __future__ import annotations

from prompts.mastery_guide import SYSTEM_PROMPT as MASTERY_SYSTEM_PROMPT

TOTAL_SOURCE_BUDGET = 24000

SYNTHESIS_EXTENSION = """
SYNTHESIZE ACROSS THE SOURCES — do not concatenate them:
- Organize the note by CONCEPT, in the order that teaches the topic best. The
  order of the source blocks below is an input order, not an outline.
- State shared material ONCE, anchored to the source that explains it best.
- Where sources genuinely disagree, say so explicitly and anchor both sides.
- Where one source completes another (a proof, a worked example, a diagram),
  bring them together in the same section.
- Open with a single <h1> naming the TOPIC the sources share — not the filename
  or channel name of any one source.
- WRONG OUTPUT: one <h2> per source, each summarizing that source in isolation.
  That is a concatenation, not a synthesis, and it is the failure mode to avoid.
"""

ANCHOR_EXTENSION = """
SOURCE-INDEXED SYNC ANCHORS (mandatory for this note):
This note is displayed beside its sources and kept in sync with them. Every <h2>
section header MUST carry a data-anchor attribute of the form:

    <h2 data-importance="4" data-anchor="SOURCE:TYPE:VALUE">...</h2>

- SOURCE is the 1-based index of the source the section is anchored to — the n
  from the "=== SOURCE n ===" block the material came from.
- TYPE and VALUE depend on that source's tagging:
    video / audio source (lines prefixed [mm:ss] or [h:mm:ss]) → t:SECONDS
      SECONDS is where the section's material begins, in seconds.
    document / PDF source (text tagged [page N])               → p:PAGE
      PAGE is the 1-based page where the material begins.
    website source (text tagged [section N])                   → s:INDEX
      INDEX is the section number where the material begins.

Worked examples: data-anchor="1:p:14"   data-anchor="2:t:754"   data-anchor="3:s:6"

Anchors must be monotonically non-decreasing WITHIN one source; across sources
they may jump freely (you are organizing by concept, not by source).
Do not put data-anchor on any element other than <h2>.
Skip the interactive knowledge-check block for synthesized notes.
"""

_NO_TEXT_BODY = ("(No transcript could be extracted for this source. The video "
                 "itself is attached to this request — watch it, derive your own "
                 "section timestamps, and use them as t: anchors for this source.)")


def _kind_framing(kind: str) -> str:
    if kind in ("youtube", "video"):
        return ("SOURCE TYPE: video transcript. Lines are prefixed with [mm:ss] "
                "timestamps.")
    if kind in ("pdf", "document"):
        return "SOURCE TYPE: document. Text is tagged with [page N] markers."
    return "SOURCE TYPE: web article. Text is tagged with [section N] markers."


def _fmt_duration(seconds: float | None) -> str | None:
    if not seconds:
        return None
    total = int(seconds)
    if total >= 3600:
        return f"{total // 3600}:{(total % 3600) // 60:02d}:{total % 60:02d}"
    return f"{total // 60}:{total % 60:02d}"


def split_budget(lengths: list[int], total: int = TOTAL_SOURCE_BUDGET) -> list[int]:
    """Split `total` characters across sources: an even share each, with any
    unused share redistributed to the sources that can still use it (so one
    short website doesn't waste a slot)."""
    allots = [0] * len(lengths)
    hungry = [i for i, n in enumerate(lengths) if n > 0]
    pool = total
    while hungry:
        share = pool // len(hungry)
        satisfied = [i for i in hungry if lengths[i] <= share]
        if not satisfied:                      # everyone is capped at `share`
            for i in hungry:
                allots[i] = share
            break
        for i in satisfied:
            allots[i] = lengths[i]
            pool -= lengths[i]
        hungry = [i for i in hungry if i not in satisfied]
    return allots


def _source_block(index: int, source: dict, budget: int) -> str:
    kind = source["kind"]
    duration = _fmt_duration(source.get("duration"))
    label = f"{kind}, {duration}" if duration else kind
    text = (source.get("text") or "").strip()
    body = text[:budget] if text else _NO_TEXT_BODY
    return (f'=== SOURCE {index}: "{source["title"]}" ({label}) ===\n'
            f"{_kind_framing(kind)}\n{body}")


def build_note_synthesis_prompt(sources: list[dict],
                                total_budget: int = TOTAL_SOURCE_BUDGET) -> str:
    budgets = split_budget([len((s.get("text") or "").strip()) for s in sources],
                           total_budget)
    blocks = [_source_block(i, s, b)
              for i, (s, b) in enumerate(zip(sources, budgets), start=1)]
    return f"""{MASTERY_SYSTEM_PROMPT}

{SYNTHESIS_EXTENSION}

{ANCHOR_EXTENSION}

---
SOURCE MATERIAL — {len(sources)} source(s) attached to this note:

{chr(10).join(blocks)}
---

Generate the synthesized mastery guide HTML, with one <h1> topic title and
source-indexed data-anchor attributes on every <h2>, now:"""
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/test_note_synthesis.py -p asyncio -q`
Expected: PASS (11 tests)

- [ ] **Step 5: Delete the single-resource prompt and its tests**

```bash
cd /home/ayoub/projects/second_brain
git rm backend/prompts/workspace_summary.py backend/tests/test_workspace_summary.py
grep -rn "workspace_summary" backend/ --include="*.py" | grep -v '\.venv/' | grep -v '/venv/'
```
Expected grep output: only `backend/services/workspace/processor.py` (fixed in Task 4).

- [ ] **Step 6: Commit**

```bash
git add backend/prompts/note_synthesis.py backend/tests/test_note_synthesis.py
git commit -m "feat(ai): multi-source note synthesis prompt, replacing per-resource summary prompt"
```

---

## Task 3: `services/workspace/synthesis.py` — settle guard + synthesis run

**Files:**
- Create: `backend/services/workspace/synthesis.py`, `backend/services/workspace/dbretry.py`
- Test: `backend/tests/test_synthesis_trigger.py`

**Interfaces:**
- Consumes: `prompts.note_synthesis.build_note_synthesis_prompt`, `services.ai.router.complete_with_fallback` / `pick`, `services.ai.client.complete`, `services.database.get_supabase`.
- Produces:
  - `dbretry.with_retry(fn, attempts: int = 3, backoff: float = 0.5)`
  - `synthesis.maybe_synthesize(note_id: str) -> bool` — the settle guard; returns True if it fired.
  - `synthesis.run_synthesis(note_id: str, mode: str = "replace") -> None`
  - `synthesis.source_text_from_chunks(source_id: str) -> str`
  - `synthesis.ready_sources(note_id: str) -> list[dict]`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_synthesis_trigger.py`:

```python
"""Tests for the synthesis service: the settle guard (fire exactly once, when
the last source lands) and the run itself (prompt, writes, failure policy)."""
from unittest.mock import MagicMock, patch

from services.workspace import synthesis

READY = {"id": "s1", "status": "ready"}


def _db(sources, synth_rows, note_rows):
    """get_supabase() double: one MagicMock per table, chains pre-wired."""
    tables: dict = {}
    db = MagicMock()
    db.table.side_effect = lambda name: tables.setdefault(name, MagicMock())
    src = tables.setdefault("note_resources", MagicMock())
    src.select.return_value.eq.return_value.execute.return_value.data = sources
    syn = tables.setdefault("note_synthesis", MagicMock())
    syn.select.return_value.eq.return_value.execute.return_value.data = synth_rows
    notes = tables.setdefault("notes", MagicMock())
    notes.select.return_value.eq.return_value.execute.return_value.data = note_rows
    db.tables = tables
    return db


NOTE = [{"id": "n1", "user_id": "u1", "title": "Backprop paper", "content": []}]


# ── settle guard ─────────────────────────────────────────────────────────────

def test_no_fire_while_a_sibling_is_still_processing():
    db = _db([READY, {"id": "s2", "status": "processing"}], [], NOTE)
    with patch.object(synthesis, "get_supabase", return_value=db), \
         patch.object(synthesis, "run_synthesis") as run:
        assert synthesis.maybe_synthesize("n1") is False
    run.assert_not_called()


def test_no_fire_while_a_sibling_is_still_queued():
    db = _db([READY, {"id": "s2", "status": "queued"}], [], NOTE)
    with patch.object(synthesis, "get_supabase", return_value=db), \
         patch.object(synthesis, "run_synthesis") as run:
        assert synthesis.maybe_synthesize("n1") is False
    run.assert_not_called()


def test_fires_exactly_once_when_the_last_source_lands():
    db = _db([READY, {"id": "s2", "status": "ready"}], [], NOTE)
    with patch.object(synthesis, "get_supabase", return_value=db), \
         patch.object(synthesis, "run_synthesis") as run:
        assert synthesis.maybe_synthesize("n1") is True
    run.assert_called_once_with("n1", "replace")


def test_failed_sibling_does_not_block_the_settle_check():
    db = _db([READY, {"id": "s2", "status": "failed"}], [], NOTE)
    with patch.object(synthesis, "get_supabase", return_value=db), \
         patch.object(synthesis, "run_synthesis") as run:
        assert synthesis.maybe_synthesize("n1") is True
    run.assert_called_once()


def test_no_refire_when_a_synthesis_row_already_exists():
    db = _db([READY], [{"note_id": "n1"}], NOTE)
    with patch.object(synthesis, "get_supabase", return_value=db), \
         patch.object(synthesis, "run_synthesis") as run:
        assert synthesis.maybe_synthesize("n1") is False
    run.assert_not_called()


def test_no_fire_when_the_note_already_has_user_content():
    note = [{"id": "n1", "user_id": "u1", "title": "T",
             "content": [{"type": "paragraph"}]}]
    db = _db([READY], [], note)
    with patch.object(synthesis, "get_supabase", return_value=db), \
         patch.object(synthesis, "run_synthesis") as run:
        assert synthesis.maybe_synthesize("n1") is False
    run.assert_not_called()


def test_no_fire_when_the_note_is_gone():
    db = _db([READY], [], [])
    with patch.object(synthesis, "get_supabase", return_value=db), \
         patch.object(synthesis, "run_synthesis") as run:
        assert synthesis.maybe_synthesize("n1") is False
    run.assert_not_called()


# ── source text reassembly ───────────────────────────────────────────────────

def test_source_text_is_reassembled_with_anchor_tags():
    db = MagicMock()
    (db.table.return_value.select.return_value.eq.return_value.order.return_value
     .execute.return_value.data) = [
        {"chunk_text": "intro", "anchor_type": "page", "anchor_start": 1},
        {"chunk_text": "more intro", "anchor_type": "page", "anchor_start": 1},
        {"chunk_text": "chapter two", "anchor_type": "page", "anchor_start": 2},
    ]
    with patch.object(synthesis, "get_supabase", return_value=db):
        text = synthesis.source_text_from_chunks("s1")
    assert text == "[page 1]\nintro\nmore intro\n[page 2]\nchapter two"


def test_time_anchored_chunks_get_mmss_tags():
    db = MagicMock()
    (db.table.return_value.select.return_value.eq.return_value.order.return_value
     .execute.return_value.data) = [
        {"chunk_text": "hello", "anchor_type": "time", "anchor_start": 83.4},
    ]
    with patch.object(synthesis, "get_supabase", return_value=db):
        assert synthesis.source_text_from_chunks("s1") == "[01:23]\nhello"


# ── the run ──────────────────────────────────────────────────────────────────

def _run_db(sources, note=None):
    tables: dict = {}
    db = MagicMock()
    db.table.side_effect = lambda name: tables.setdefault(name, MagicMock())
    notes = tables.setdefault("notes", MagicMock())
    notes.select.return_value.eq.return_value.execute.return_value.data = (
        note or NOTE)
    src = tables.setdefault("note_resources", MagicMock())
    (src.select.return_value.eq.return_value.eq.return_value.order.return_value
     .execute.return_value.data) = sources
    db.tables = tables
    return db


SRC_ROWS = [
    {"id": "s1", "note_id": "n1", "user_id": "u1", "kind": "pdf",
     "title": "Backprop paper", "source_url": None, "meta": {}},
    {"id": "s2", "note_id": "n1", "user_id": "u1", "kind": "website",
     "title": "wiki", "source_url": "https://en.wikipedia.org/x", "meta": {}},
]


def test_run_synthesis_writes_ready_with_html_and_source_ids():
    db = _run_db(SRC_ROWS)
    with patch.object(synthesis, "get_supabase", return_value=db), \
         patch.object(synthesis, "source_text_from_chunks", return_value="[page 1]\ntext"), \
         patch.object(synthesis, "complete_with_fallback",
                      return_value="<h1>Backprop</h1><h2 data-anchor=\"1:p:1\">Why</h2>") as ai:
        synthesis.run_synthesis("n1")

    prompt = ai.call_args[0][2][0]["content"]
    assert '=== SOURCE 1: "Backprop paper" (pdf) ===' in prompt
    assert '=== SOURCE 2: "wiki" (website) ===' in prompt
    writes = [c.args[0] for c in db.tables["note_synthesis"].upsert.call_args_list]
    assert writes[0]["status"] == "running"
    assert writes[-1]["status"] == "ready"
    assert writes[-1]["source_ids"] == ["s1", "s2"]
    assert writes[-1]["title_suggestion"] == "Backprop"
    assert "<h2" in writes[-1]["html"]


def test_run_synthesis_strips_code_fences():
    db = _run_db(SRC_ROWS[:1])
    with patch.object(synthesis, "get_supabase", return_value=db), \
         patch.object(synthesis, "source_text_from_chunks", return_value="text"), \
         patch.object(synthesis, "complete_with_fallback",
                      return_value="```html\n<h2>Hi</h2>\n```"):
        synthesis.run_synthesis("n1")
    writes = [c.args[0] for c in db.tables["note_synthesis"].upsert.call_args_list]
    assert writes[-1]["html"] == "<h2>Hi</h2>"


def test_run_synthesis_records_failure_without_raising():
    db = _run_db(SRC_ROWS[:1])
    with patch.object(synthesis, "get_supabase", return_value=db), \
         patch.object(synthesis, "source_text_from_chunks", return_value="text"), \
         patch.object(synthesis, "complete_with_fallback",
                      side_effect=RuntimeError("all providers failed")):
        synthesis.run_synthesis("n1")
    writes = [c.args[0] for c in db.tables["note_synthesis"].upsert.call_args_list]
    assert writes[-1]["status"] == "failed"
    assert "all providers failed" in writes[-1]["error"]


def test_run_synthesis_with_no_ready_sources_fails_cleanly():
    db = _run_db([])
    with patch.object(synthesis, "get_supabase", return_value=db), \
         patch.object(synthesis, "complete_with_fallback") as ai:
        synthesis.run_synthesis("n1")
    ai.assert_not_called()
    writes = [c.args[0] for c in db.tables["note_synthesis"].upsert.call_args_list]
    assert writes[-1]["status"] == "failed"


def test_title_suggestion_applied_only_over_the_inherited_source_title():
    db = _run_db(SRC_ROWS)
    with patch.object(synthesis, "get_supabase", return_value=db), \
         patch.object(synthesis, "source_text_from_chunks", return_value="text"), \
         patch.object(synthesis, "complete_with_fallback",
                      return_value="<h1>Three views of backprop</h1>"):
        synthesis.run_synthesis("n1")
    # note.title == first source title ("Backprop paper") → upgraded
    db.tables["notes"].update.assert_called_once()
    assert (db.tables["notes"].update.call_args[0][0]["title"]
            == "Three views of backprop")


def test_title_the_user_typed_is_never_overwritten():
    note = [{"id": "n1", "user_id": "u1", "title": "My own title", "content": []}]
    db = _run_db(SRC_ROWS, note=note)
    with patch.object(synthesis, "get_supabase", return_value=db), \
         patch.object(synthesis, "source_text_from_chunks", return_value="text"), \
         patch.object(synthesis, "complete_with_fallback",
                      return_value="<h1>Three views of backprop</h1>"):
        synthesis.run_synthesis("n1")
    db.tables["notes"].update.assert_not_called()


def test_transcript_less_video_uses_the_video_native_provider():
    src = [{"id": "s1", "note_id": "n1", "user_id": "u1", "kind": "youtube",
            "title": "Lecture", "source_url": "https://youtu.be/abc12345678",
            "meta": {}}]
    db = _run_db(src)
    provider = MagicMock(capabilities=["video_native", "summarize_text"])
    with patch.object(synthesis, "get_supabase", return_value=db), \
         patch.object(synthesis, "source_text_from_chunks", return_value=""), \
         patch.object(synthesis, "pick", return_value=provider), \
         patch.object(synthesis, "complete", return_value="<h1>Lecture</h1>") as ai, \
         patch.object(synthesis, "complete_with_fallback") as text_ai:
        synthesis.run_synthesis("n1")
    text_ai.assert_not_called()
    parts = ai.call_args[0][1][0]["content"]
    assert parts[0]["type"] == "text"
    assert parts[1] == {"type": "video_url", "url": "https://youtu.be/abc12345678"}


def test_textless_source_without_a_video_provider_fails_with_a_clear_message():
    src = [{"id": "s1", "note_id": "n1", "user_id": "u1", "kind": "youtube",
            "title": "Lecture", "source_url": "https://youtu.be/abc12345678",
            "meta": {}}]
    db = _run_db(src)
    with patch.object(synthesis, "get_supabase", return_value=db), \
         patch.object(synthesis, "source_text_from_chunks", return_value=""), \
         patch.object(synthesis, "pick", return_value=None):
        synthesis.run_synthesis("n1")
    writes = [c.args[0] for c in db.tables["note_synthesis"].upsert.call_args_list]
    assert writes[-1]["status"] == "failed"
    assert "video-capable" in writes[-1]["error"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/test_synthesis_trigger.py -p asyncio -q`
Expected: FAIL — `ImportError: cannot import name 'synthesis' from 'services.workspace'`

- [ ] **Step 3: Write `dbretry.py`**

`backend/services/workspace/dbretry.py` (body moved verbatim out of `processor.py`, which loses its private copy in Task 4):

```python
"""Retry helper for Supabase writes that sit behind slow work."""
from __future__ import annotations

import time


def with_retry(fn, attempts: int = 3, backoff: float = 0.5):
    """Retry on transient Supabase disconnects (pooled HTTP/2 connections that
    go stale behind a slow ffmpeg/yt-dlp/whisper/LLM step get dropped
    server-side and raise on the next reuse). Without this, a fully-successful
    capture, transcription or synthesis run can get its terminal status write
    lost and end up mismarked `failed`, forcing a needless full reprocess."""
    for attempt in range(attempts):
        try:
            return fn()
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(backoff * (attempt + 1))
```

- [ ] **Step 4: Write `synthesis.py`**

`backend/services/workspace/synthesis.py`:

```python
"""Multi-source note synthesis — one note per session, never one per source.

maybe_synthesize(note_id)  the settle guard; called by processor.py after each
                           source reaches `ready`. Fires run_synthesis exactly
                           once, when the last source lands.
run_synthesis(note_id, m)  builds the multi-source prompt from every ready
                           source, calls the AI layer, writes note_synthesis.

`mode` ('replace' | 'append') is a client-side apply strategy — the draft is
identical either way — so it is logged, not persisted. A client that reloads
mid-run re-decides via its normal replace/append path.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from prompts.note_synthesis import build_note_synthesis_prompt
from services.ai.client import complete
from services.ai.router import complete_with_fallback, pick
from services.database import get_supabase
from services.workspace.dbretry import with_retry

logger = logging.getLogger(__name__)

_FENCE = re.compile(r"^```(?:html)?\s*|\s*```$", re.MULTILINE)
_H1 = re.compile(r"<h1[^>]*>(.*?)</h1>", re.IGNORECASE | re.DOTALL)
_TAGS = re.compile(r"<[^>]+>")
_PENDING = ("queued", "processing")


def _strip_fences(html: str) -> str:
    return _FENCE.sub("", html or "").strip()


def _anchor_tag(anchor_type: str, start) -> str:
    value = float(start or 0)
    if anchor_type == "time":
        s = int(value)
        return f"[{s // 60:02d}:{s % 60:02d}]"
    if anchor_type == "page":
        return f"[page {int(value)}]"
    return f"[section {int(value)}]"


def source_text_from_chunks(source_id: str) -> str:
    """Rebuild a source's tagged text from its anchored chunks.

    Synthesis runs after every source has settled, so the extracted text is no
    longer in memory the way it was for the old per-resource summary. The chunks
    cover the full text and carry the anchor each passage came from, so the
    `[page N]` / `[mm:ss]` / `[section N]` tagging the prompt relies on is
    reconstructed from anchor_type + anchor_start.
    """
    rows = (get_supabase().table("resource_chunks")
            .select("chunk_text,anchor_type,anchor_start")
            .eq("resource_id", source_id).order("chunk_index")
            .execute().data or [])
    parts: list[str] = []
    last_tag: str | None = None
    for r in rows:
        tag = _anchor_tag(r["anchor_type"], r["anchor_start"])
        if tag != last_tag:
            parts.append(tag)
            last_tag = tag
        parts.append(r["chunk_text"])
    return "\n".join(parts)


def ready_sources(note_id: str) -> list[dict]:
    return (get_supabase().table("note_resources").select("*")
            .eq("note_id", note_id).eq("status", "ready")
            .order("order_index").execute().data or [])


def _write(note_id: str, user_id: str, patch: dict) -> None:
    payload = {"note_id": note_id, "user_id": user_id, **patch,
               "updated_at": datetime.now(timezone.utc).isoformat()}
    with_retry(lambda: get_supabase().table("note_synthesis")
               .upsert(payload, on_conflict="note_id").execute())


def _claim(note_id: str, user_id: str) -> bool:
    """Claim the right to synthesize this note. `note_synthesis.note_id` is the
    primary key, so this insert is the mutual-exclusion point: when two sibling
    sources settle at the same moment in two background threads, exactly one
    insert wins and the loser no-ops instead of paying for a second LLM call."""
    try:
        get_supabase().table("note_synthesis").insert({
            "note_id": note_id, "user_id": user_id, "status": "running",
            "source_ids": [], "updated_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
        return True
    except Exception:
        return False


def maybe_synthesize(note_id: str) -> bool:
    """The settle guard. Proceeds only if no source on this note is still
    pending, no synthesis exists yet, and the note has no user content — so
    dropping 3 sources at once produces exactly one synthesis, fired by
    whichever source finishes last. Returns True if it fired."""
    if not note_id:
        return False
    db = get_supabase()
    sources = (db.table("note_resources").select("id,status")
               .eq("note_id", note_id).execute().data or [])
    if any((s.get("status") or "") in _PENDING for s in sources):
        return False
    if (db.table("note_synthesis").select("note_id")
            .eq("note_id", note_id).execute().data):
        return False
    notes = (db.table("notes").select("id,user_id,title,content")
             .eq("id", note_id).execute().data or [])
    if not notes or notes[0].get("content"):
        return False
    if not _claim(note_id, notes[0]["user_id"]):
        return False
    run_synthesis(note_id, "replace")
    return True


def _title_suggestion(html: str) -> str | None:
    m = _H1.search(html or "")
    if not m:
        return None
    title = _TAGS.sub("", m.group(1)).strip()
    return title[:200] or None


def _complete(prompt: str, video_urls: list[str], has_text: bool,
              user_id: str) -> str:
    """Text path, or the Gemini-native video path when a source has no
    transcript (same capability routing the per-resource summary used)."""
    if video_urls:
        provider = pick("summarize_video", user_id)
        if provider is not None and "video_native" in provider.capabilities:
            content: list[dict] = [{"type": "text", "text": prompt}]
            content += [{"type": "video_url", "url": u} for u in video_urls]
            return _strip_fences(complete(
                provider, [{"role": "user", "content": content}], max_tokens=8192))
        if not has_text:
            raise RuntimeError(
                "No transcript for this source and no video-capable provider "
                "configured — add a Gemini key in Settings → AI Providers.")
    return _strip_fences(complete_with_fallback(
        "summarize_text", user_id, [{"role": "user", "content": prompt}],
        max_tokens=8192))


def run_synthesis(note_id: str, mode: str = "replace") -> None:
    db = get_supabase()
    notes = (db.table("notes").select("id,user_id,title,content")
             .eq("id", note_id).execute().data or [])
    if not notes:
        logger.warning(f"run_synthesis: note {note_id} not found")
        return
    note = notes[0]
    user_id = note["user_id"]
    sources = ready_sources(note_id)
    source_ids = [s["id"] for s in sources]
    logger.info(f"synthesizing note {note_id} from {len(sources)} source(s), "
                f"mode={mode}")
    _write(note_id, user_id,
           {"status": "running", "error": None, "source_ids": source_ids})

    if not sources:
        _write(note_id, user_id, {"status": "failed", "source_ids": [],
                                  "error": "No processed sources to synthesize."})
        return

    try:
        blocks: list[dict] = []
        video_urls: list[str] = []
        for s in sources:
            text = source_text_from_chunks(s["id"])
            if not text:
                if s["kind"] in ("youtube", "video") and s.get("source_url"):
                    video_urls.append(s["source_url"])
                else:
                    # Never hand the model a blank source block: say the text is
                    # missing rather than letting it guess at an empty section.
                    logger.warning(f"note {note_id}: source {s['id']} "
                                   f"({s['kind']}) contributed no text — "
                                   f"chunks missing or extraction empty")
                    text = "(No text could be extracted from this source.)"
            blocks.append({"title": s["title"], "kind": s["kind"], "text": text,
                           "duration": (s.get("meta") or {}).get("duration")})

        has_text = any(b["text"] for b in blocks)
        prompt = build_note_synthesis_prompt(blocks)
        html = _complete(prompt, video_urls, has_text, user_id)
        if not html.strip():
            raise RuntimeError("The model returned an empty draft.")

        suggestion = _title_suggestion(html)
        _write(note_id, user_id, {"status": "ready", "html": html, "error": None,
                                  "source_ids": source_ids,
                                  "title_suggestion": suggestion})
        # A multi-source session should get a topic title instead of inheriting
        # source #1's filename — but never over a title the user typed.
        if suggestion and note.get("title") == sources[0]["title"]:
            db.table("notes").update({"title": suggestion}).eq("id", note_id).execute()
    except Exception as e:
        logger.warning(f"note {note_id}: synthesis failed: {e}")
        _write(note_id, user_id, {"status": "failed", "source_ids": source_ids,
                                  "error": str(e)[:500]})
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/test_synthesis_trigger.py -p asyncio -q`
Expected: PASS (17 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/services/workspace/synthesis.py backend/services/workspace/dbretry.py backend/tests/test_synthesis_trigger.py
git commit -m "feat(workspace): note synthesis service with settle-guard trigger"
```

---

## Task 4: `processor.py` slim-down + settle trigger

**Files:**
- Modify: `backend/services/workspace/processor.py`

**Interfaces:**
- Consumes: `synthesis.maybe_synthesize`, `dbretry.with_retry`.
- Produces: `process_resource(resource_id)` — unchanged signature; now purely extract → elements → chunks + embeddings → meta → `ready` → `maybe_synthesize(note_id)`.

- [ ] **Step 1: Rewrite the module docstring and imports**

Replace lines 1–36 of `backend/services/workspace/processor.py` with:

```python
"""Source processing pipeline — runs in the background after a source attaches.

process_resource(resource_id):
  queued → processing → ready | failed

Steps (per kind): extract content → store selectable elements → anchored chunks
+ embeddings (grounded chat AND the text synthesis reassembles) → meta → ready →
maybe_synthesize(note_id).

There is no per-source summary and no per-source output note: the note already
exists (it is what the source attached to), and the AI draft is one synthesis
across every source on that note (services/workspace/synthesis.py).

Failure policy:
  extraction failure → status=failed (nothing usable)
  embedding failure  → warn, continue; chunk rows still inserted unembedded so
                       synthesis can still read the source text (chat degrades)
  synthesis failure  → recorded on note_synthesis, never fails the source
"""
from __future__ import annotations

import logging
import os
import tempfile

from services.database import get_supabase
from services.embedder import embed_batch
from services.workspace import storage
from services.workspace.dbretry import with_retry
from services.workspace.synthesis import maybe_synthesize

logger = logging.getLogger(__name__)
```

Note: `re`, `time`, `complete`, `pick`, `complete_with_fallback`,
`build_workspace_summary_prompt`, `_FENCE`, `_strip_fences` and the local
`_with_retry` all go away with the summary code.

- [ ] **Step 2: Point the status/meta writes at `note_resources`**

```python
def _set_status(rid: str, status: str, error: str | None = None) -> None:
    patch: dict = {"status": status, "error": error}
    with_retry(lambda: get_supabase().table("note_resources")
               .update(patch).eq("id", rid).execute())


def _save_meta(rid: str, meta: dict) -> None:
    with_retry(lambda: get_supabase().table("note_resources")
               .update({"meta": meta}).eq("id", rid).execute())
```

- [ ] **Step 3: Make `_insert_chunks` note-scoped and embedding-failure-tolerant**

Replace the whole `_insert_chunks` function with:

```python
def _insert_chunks(resource: dict, chunks: list[dict]) -> None:
    if not chunks:
        return
    db = get_supabase()
    db.table("resource_chunks").delete().eq("resource_id", resource["id"]).execute()
    embeddings: list | None = None
    try:
        embeddings = embed_batch([c["chunk_text"] for c in chunks])
    except Exception as e:
        # Chat degrades for this source, but the chunk TEXT is what synthesis
        # reassembles the source from — so the rows still go in, unembedded.
        logger.warning(f"resource {resource['id']}: embedding skipped: {e}")
    rows = []
    for i, c in enumerate(chunks):
        row = {
            "resource_id": resource["id"],
            "note_id": resource["note_id"],
            "user_id": resource["user_id"],
            "chunk_index": c["chunk_index"],
            "chunk_text": c["chunk_text"],
            "anchor_type": c["anchor_type"],
            "anchor_start": c["anchor_start"],
            "anchor_end": c["anchor_end"],
        }
        if embeddings is not None:
            row["embedding"] = "[" + ",".join(str(v) for v in embeddings[i]) + "]"
        rows.append(row)
    for start in range(0, len(rows), 200):
        db.table("resource_chunks").insert(rows[start:start + 200]).execute()
```

- [ ] **Step 4: Delete the summary + output-note code**

Delete `_generate_summary`, `_NOTE_SOURCE_TYPE` and `_create_output_note` entirely (old lines 120–175).

- [ ] **Step 5: Retarget the remaining `workspace_resources` reads/writes and end the job with the settle call**

In `process_resource`, change the initial select and the two in-flight title updates from `workspace_resources` to `note_resources`:

```python
    rows = db.table("note_resources").select("*").eq("id", resource_id).execute().data
```
```python
                if ometa.get("title") and resource["title"].startswith("YouTube"):
                    db.table("note_resources").update(
                        {"title": ometa["title"]}).eq("id", resource_id).execute()
```
```python
            if data["title"] and resource["title"] in ("Untitled source", resource["source_url"]):
                db.table("note_resources").update(
                    {"title": data["title"]}).eq("id", resource_id).execute()
```

Then replace the whole tail of the `try` block (old lines 288–311, from `_save_meta(resource_id, meta)` through the `logger.info`) with:

```python
        _save_meta(resource_id, meta)
        _set_status(resource_id, "ready")
        logger.info(f"source {resource_id} ready (kind={resource['kind']})")

        # One note per session: the last source to settle fires the single
        # synthesis across every source on this note. Never fails the source.
        try:
            maybe_synthesize(resource.get("note_id"))
        except Exception as e:
            logger.warning(f"source {resource_id}: synthesis trigger failed: {e}")
```

- [ ] **Step 6: Verify nothing stale is left**

```bash
cd /home/ayoub/projects/second_brain/backend
grep -n "workspace_resources\|workspace_id\|summary_html\|workspace_summary\|_with_retry" services/workspace/processor.py
```
Expected: no output.

- [ ] **Step 7: Run the full backend suite (extractors must stay green)**

Run: `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/test_workspace_extractors.py tests/test_synthesis_trigger.py tests/test_note_synthesis.py -p asyncio -q`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/services/workspace/processor.py
git commit -m "refactor(workspace): processor extracts only — no per-resource summary or output note"
```

---

## Task 5: `chat.py` — workspace scope → note scope

**Files:**
- Modify: `backend/services/workspace/chat.py`
- Test: `backend/tests/test_workspace_chat.py`

**Interfaces:**
- Produces: `run_note_chat(note_id: str, user_id: str, messages: list[dict]) -> AsyncIterator[dict]`, `retrieve_chunks(query: str, note_id: str, user_id: str) -> list[dict]`. `build_system_prompt`, `citations_payload`, `_anchor_label` unchanged. Citation payload keys (`n`, `resource_id`, `title`, `anchor_type`, `anchor_start`, `anchor_end`, `snippet`) unchanged — the frontend `Citation` type depends on them.

- [ ] **Step 1: Update the tests first**

In `backend/tests/test_workspace_chat.py`: change the import and the three call sites, and add an RPC-args test.

```python
from services.workspace.chat import (
    build_system_prompt, citations_payload, run_note_chat, retrieve_chunks,
    _anchor_label,
)
```

Replace every `run_workspace_chat("ws1", "u1", ...)` with `run_note_chat("n1", "u1", ...)` (3 places), rename the three test functions from `test_run_workspace_chat_*` to `test_run_note_chat_*`, and append:

```python
def test_retrieval_is_note_scoped():
    db = MagicMock()
    db.rpc.return_value.execute.return_value.data = CHUNKS
    with patch("services.workspace.chat.embed", return_value=[0.1] * 768), \
         patch("services.workspace.chat.get_supabase", return_value=db):
        out = retrieve_chunks("query", "n1", "u1")
    assert out == CHUNKS
    name, args = db.rpc.call_args[0]
    assert name == "match_note_source_chunks"
    assert args["target_note_id"] == "n1"
    assert args["match_user_id"] == "u1"
    assert "target_workspace_id" not in args


def test_titles_come_from_note_resources():
    async def fake_stream(provider, messages, max_tokens=2048):
        yield "Answer [1]."

    db = MagicMock()
    db.table.return_value.select.return_value.in_.return_value.execute.return_value.data = [
        {"id": "r1", "title": "Lecture video"},
    ]
    with patch("services.workspace.chat.retrieve_chunks", return_value=CHUNKS), \
         patch("services.workspace.chat.get_supabase", return_value=db), \
         patch("services.workspace.chat.candidates",
               return_value=[MagicMock(provider="openai", label="OpenAI")]), \
         patch("services.workspace.chat.ai_stream", fake_stream):
        _ = [ev async for ev in run_note_chat("n1", "u1", [
            {"role": "user", "content": "q"}])]
    db.table.assert_called_with("note_resources")
```

Mark that last test `async def` (pytest.ini has `asyncio_mode = auto`).

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/test_workspace_chat.py -p asyncio -q`
Expected: FAIL — `ImportError: cannot import name 'run_note_chat'`

- [ ] **Step 3: Re-scope the module**

In `backend/services/workspace/chat.py`:

Docstring — replace the first paragraph and the grounding note:

```python
"""Note-scoped grounded chat with anchored citations.

run_note_chat(...) → AsyncIterator of SSE-ready event dicts (same grammar as the
agent engine: context / text / citations / error / done).

Grounding: retrieve top-K resource_chunks across ALL sources attached to THIS
note, number them [1]..[K] in a <sources> block, and require bracket citations.
Only markers that map to retrieved chunks become citation chips client-side —
unknown markers are ignored (anti-hallucination guard, same idea as the tutor's
note-id rule). The citation payload already carries resource_id + title, which
is exactly what multi-source attribution needs.
"""
```

System template first sentence:

```python
SYSTEM_TEMPLATE = """You are the study assistant for one note in the user's
Second Brain. Answer ONLY from the numbered sources below — they are excerpts
from the sources the user attached to this note.
```

Retrieval:

```python
def retrieve_chunks(query: str, note_id: str, user_id: str) -> list[dict]:
    embedding = embed(query)
    vec = "[" + ",".join(str(v) for v in embedding) + "]"
    res = get_supabase().rpc("match_note_source_chunks", {
        "query_embedding": vec,
        "match_user_id": user_id,
        "target_note_id": note_id,
        "match_count": _TOP_K,
    }).execute()
    return res.data or []
```

Entry point — rename and re-scope (body otherwise unchanged):

```python
async def run_note_chat(
    note_id: str,
    user_id: str,
    messages: list[dict],
) -> AsyncIterator[dict[str, Any]]:
```
```python
    # 1. retrieve note-scoped chunks across every attached source
    chunks: list[dict] = []
    try:
        chunks = retrieve_chunks(query, note_id, user_id)
```
```python
            rows = (get_supabase().table("note_resources")
                    .select("id,title").in_("id", rids).execute().data or [])
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/test_workspace_chat.py -p asyncio -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/workspace/chat.py backend/tests/test_workspace_chat.py
git commit -m "refactor(workspace): chat grounded in a note's sources instead of a workspace"
```

---

## Task 6: `routers/note_sources.py` + registration + proxy allowlist

**Files:**
- Create: `backend/routers/note_sources.py`
- Test: `backend/tests/test_note_sources_router.py`
- Modify: `backend/main.py:8`, `backend/main.py:37`, `frontend/app/api/ws/[...path]/route.ts:6-12`
- Delete: `backend/routers/workspaces.py`, `backend/tests/test_workspaces_router.py`

**Interfaces:**
- Consumes: `routers.ingest.get_user_id`, `services.workspace.processor.process_resource`, `services.workspace.synthesis.run_synthesis`, `services.workspace.chat.run_note_chat`, `services.workspace.media.capture` / `formula_to_latex`, `services.workspace.storage`.
- Produces the HTTP surface every frontend task calls:
  `POST /sources` → `{note_id, source}`; `GET /notes/{id}/sources` → `[source]`;
  `DELETE /sources/{sid}`; `GET /sources/{sid}`; `GET /sources/{sid}/file`;
  `POST /sources/{sid}/reprocess`; `POST /sources/{sid}/capture`;
  `POST /sources/{sid}/formula-latex`; `POST /notes/{id}/synthesize`;
  `GET /notes/{id}/synthesis`; `POST /notes/{id}/synthesis/applied`;
  `PUT|GET /notes/{id}/anchors`; `POST /notes/{id}/chat` (SSE);
  `GET /sessions/recent`; `GET|POST|PATCH|DELETE /ai-providers`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_note_sources_router.py`:

```python
"""Tests for the note-sources router — lazy note creation on first attach,
status polling, detach, capture guards, synthesis queueing, anchors, providers."""
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

AUTH = {"Authorization": "Bearer fake"}


def _table_router(tables: dict):
    """get_supabase().table(name) → per-table MagicMock from `tables`."""
    db = MagicMock()
    db.table.side_effect = lambda name: tables.setdefault(name, MagicMock())
    return db


@pytest.fixture
def client():
    with patch("routers.note_sources.get_user_id", return_value="user-1"):
        from main import app
        yield TestClient(app)


def _note_owned(tables, note_id="n1"):
    t = tables.setdefault("notes", MagicMock())
    t.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
        {"id": note_id, "user_id": "user-1", "title": "T", "content": []}]
    return t


def test_attach_url_without_note_id_creates_the_note_first(client):
    tables: dict = {}
    db = _table_router(tables)
    notes = tables.setdefault("notes", MagicMock())
    notes.insert.return_value.execute.return_value.data = [{"id": "n-new"}]
    srcs = tables.setdefault("note_resources", MagicMock())
    srcs.select.return_value.eq.return_value.execute.return_value.data = []
    srcs.insert.return_value.execute.return_value.data = [{
        "id": "s1", "note_id": "n-new", "kind": "youtube",
        "title": "YouTube video", "status": "queued", "meta": {}, "order_index": 0}]

    with patch("routers.note_sources.get_supabase", return_value=db), \
         patch("routers.note_sources.process_resource") as proc:
        res = client.post("/sources", data={
            "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}, headers=AUTH)

    assert res.status_code == 200
    body = res.json()
    assert body["note_id"] == "n-new"
    assert body["source"]["kind"] == "youtube"
    assert body["source"]["status"] == "queued"
    notes.insert.assert_called_once()
    proc.assert_called_once_with("s1")


def test_attach_to_existing_note_does_not_create_a_note(client):
    tables: dict = {}
    db = _table_router(tables)
    notes = _note_owned(tables)
    srcs = tables.setdefault("note_resources", MagicMock())
    srcs.select.return_value.eq.return_value.execute.return_value.data = [
        {"id": "s1"}, {"id": "s2"}]           # two already attached
    srcs.insert.return_value.execute.return_value.data = [{
        "id": "s3", "note_id": "n1", "kind": "website", "title": "x",
        "status": "queued", "meta": {}, "order_index": 2}]

    with patch("routers.note_sources.get_supabase", return_value=db), \
         patch("routers.note_sources.process_resource"):
        res = client.post("/sources", data={"url": "https://example.com",
                                            "note_id": "n1"}, headers=AUTH)

    assert res.status_code == 200
    assert res.json()["note_id"] == "n1"
    notes.insert.assert_not_called()
    assert srcs.insert.call_args[0][0]["order_index"] == 2   # appended to the rail


def test_attach_to_a_foreign_note_404s(client):
    tables: dict = {}
    db = _table_router(tables)
    notes = tables.setdefault("notes", MagicMock())
    notes.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
    with patch("routers.note_sources.get_supabase", return_value=db):
        res = client.post("/sources", data={"url": "https://example.com",
                                            "note_id": "other"}, headers=AUTH)
    assert res.status_code == 404


def test_attach_rejects_unsupported_file(client):
    with patch("routers.note_sources.get_supabase", return_value=MagicMock()):
        res = client.post("/sources", files={
            "file": ("malware.exe", b"MZ", "application/octet-stream")}, headers=AUTH)
    assert res.status_code == 400


def test_attach_requires_a_file_or_url(client):
    with patch("routers.note_sources.get_supabase", return_value=MagicMock()):
        res = client.post("/sources", data={}, headers=AUTH)
    assert res.status_code == 400


def test_list_sources_is_status_polling(client):
    tables: dict = {}
    db = _table_router(tables)
    _note_owned(tables)
    srcs = tables.setdefault("note_resources", MagicMock())
    (srcs.select.return_value.eq.return_value.order.return_value
     .execute.return_value.data) = [
        {"id": "s1", "status": "ready", "title": "a", "kind": "pdf", "meta": {},
         "order_index": 0},
        {"id": "s2", "status": "processing", "title": "b", "kind": "youtube",
         "meta": {}, "order_index": 1},
    ]
    with patch("routers.note_sources.get_supabase", return_value=db):
        res = client.get("/notes/n1/sources", headers=AUTH)
    assert res.status_code == 200
    assert [r["status"] for r in res.json()] == ["ready", "processing"]


def test_detach_keeps_the_note(client):
    tables: dict = {}
    db = _table_router(tables)
    srcs = tables.setdefault("note_resources", MagicMock())
    srcs.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
        {"id": "s1", "note_id": "n1", "user_id": "user-1", "kind": "pdf"}]
    with patch("routers.note_sources.get_supabase", return_value=db):
        res = client.delete("/sources/s1", headers=AUTH)
    assert res.status_code == 200
    assert res.json() == {"ok": True, "note_id": "n1"}
    srcs.delete.return_value.eq.return_value.execute.assert_called_once()
    assert "notes" not in tables          # the note is never touched


def test_capture_rejected_for_non_video_sources(client):
    tables: dict = {}
    db = _table_router(tables)
    srcs = tables.setdefault("note_resources", MagicMock())
    srcs.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
        {"id": "s1", "user_id": "user-1", "kind": "pdf"}]
    with patch("routers.note_sources.get_supabase", return_value=db):
        res = client.post("/sources/s1/capture", json={"type": "frame", "start": 10},
                          headers=AUTH)
    assert res.status_code == 400


def test_synthesize_queues_a_background_run(client):
    tables: dict = {}
    db = _table_router(tables)
    _note_owned(tables)
    with patch("routers.note_sources.get_supabase", return_value=db), \
         patch("routers.note_sources.run_synthesis") as run:
        res = client.post("/notes/n1/synthesize", json={"mode": "append"}, headers=AUTH)
    assert res.status_code == 200
    assert res.json()["status"] == "queued"
    assert tables["note_synthesis"].upsert.call_args[0][0]["status"] == "queued"
    run.assert_called_once_with("n1", "append")


def test_synthesize_rejects_an_unknown_mode(client):
    tables: dict = {}
    db = _table_router(tables)
    _note_owned(tables)
    with patch("routers.note_sources.get_supabase", return_value=db):
        res = client.post("/notes/n1/synthesize", json={"mode": "merge"}, headers=AUTH)
    assert res.status_code == 400


def test_get_synthesis_reports_none_before_the_first_run(client):
    tables: dict = {}
    db = _table_router(tables)
    _note_owned(tables)
    syn = tables.setdefault("note_synthesis", MagicMock())
    syn.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
    with patch("routers.note_sources.get_supabase", return_value=db):
        res = client.get("/notes/n1/synthesis", headers=AUTH)
    assert res.status_code == 200
    assert res.json() == {"status": "none", "source_ids": []}


def test_get_synthesis_returns_html_and_applied_at(client):
    tables: dict = {}
    db = _table_router(tables)
    _note_owned(tables)
    syn = tables.setdefault("note_synthesis", MagicMock())
    syn.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [{
        "note_id": "n1", "status": "ready", "html": "<h2>Hi</h2>",
        "source_ids": ["s1", "s2"], "title_suggestion": "Topic",
        "error": None, "applied_at": None}]
    with patch("routers.note_sources.get_supabase", return_value=db):
        res = client.get("/notes/n1/synthesis", headers=AUTH)
    body = res.json()
    assert body["html"] == "<h2>Hi</h2>"
    assert body["source_ids"] == ["s1", "s2"]
    assert body["applied_at"] is None


def test_put_anchors_replaces_rows(client):
    tables: dict = {}
    db = _table_router(tables)
    _note_owned(tables)
    anchors = tables.setdefault("note_anchors", MagicMock())
    body = [
        {"block_id": "b1", "resource_id": "r1", "anchor_type": "page",
         "anchor_start": 4, "anchor_end": 4},
        {"block_id": "b2", "resource_id": "r2", "anchor_type": "time",
         "anchor_start": 90.0, "anchor_end": 90.0},
    ]
    with patch("routers.note_sources.get_supabase", return_value=db):
        res = client.put("/notes/n1/anchors", json=body, headers=AUTH)
    assert res.status_code == 200
    assert res.json()["count"] == 2
    anchors.delete.return_value.eq.return_value.execute.assert_called_once()
    inserted = anchors.insert.call_args[0][0]
    assert inserted[0]["user_id"] == "user-1"
    assert {r["resource_id"] for r in inserted} == {"r1", "r2"}   # multi-source


def test_recent_sessions_groups_sources_by_note(client):
    tables: dict = {}
    db = _table_router(tables)
    srcs = tables.setdefault("note_resources", MagicMock())
    (srcs.select.return_value.eq.return_value.order.return_value.limit.return_value
     .execute.return_value.data) = [
        {"note_id": "n1", "kind": "pdf", "title": "a", "order_index": 0},
        {"note_id": "n1", "kind": "youtube", "title": "b", "order_index": 1},
        {"note_id": "n2", "kind": "website", "title": "c", "order_index": 0},
    ]
    notes = tables.setdefault("notes", MagicMock())
    notes.select.return_value.in_.return_value.execute.return_value.data = [
        {"id": "n1", "title": "Backprop", "updated_at": "2026-07-30T10:00:00Z",
         "deleted_at": None},
        {"id": "n2", "title": "Trashed", "updated_at": "2026-07-30T11:00:00Z",
         "deleted_at": "2026-07-30T12:00:00Z"},
    ]
    with patch("routers.note_sources.get_supabase", return_value=db):
        res = client.get("/sessions/recent", headers=AUTH)
    rows = res.json()
    assert len(rows) == 1                     # deleted note excluded
    assert rows[0]["note_id"] == "n1"
    assert rows[0]["source_count"] == 2
    assert set(rows[0]["kinds"]) == {"pdf", "youtube"}


def test_ai_providers_key_never_echoed(client):
    row = {"id": "p1", "user_id": "user-1", "provider": "gemini",
           "label": "Gemini", "api_key": "secret-key-12345", "enabled": True}
    db = MagicMock()
    (db.table.return_value.select.return_value.eq.return_value.order.return_value
     .execute.return_value.data) = [dict(row)]
    with patch("routers.note_sources.get_supabase", return_value=db):
        res = client.get("/ai-providers", headers=AUTH)
    body = res.json()[0]
    assert "api_key" not in body
    assert body["api_key_hint"].endswith("2345")


def test_create_ai_provider_validates(client):
    with patch("routers.note_sources.get_supabase", return_value=MagicMock()):
        assert client.post("/ai-providers", json={"provider": "bogus", "api_key": "k"},
                           headers=AUTH).status_code == 400
        assert client.post("/ai-providers",
                           json={"provider": "openai_compatible", "api_key": "k"},
                           headers=AUTH).status_code == 400   # base_url required
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/test_note_sources_router.py -p asyncio -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'routers.note_sources'`

- [ ] **Step 3: Write the router**

`backend/routers/note_sources.py`:

```python
"""Note sources router — one note, many attached sources.

Replaces routers/workspaces.py. A source attaches directly to a note (created
lazily on the first attach, so the first drop is one request rather than
create-then-attach), synthesis is per note, chat is grounded in that note's
sources. The canvas concepts — workspaces, pages, positions, per-resource
summaries — are gone.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone

from fastapi import (APIRouter, BackgroundTasks, File, Form, Header,
                     HTTPException, UploadFile)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from routers.ingest import get_user_id
from services.database import get_supabase
from services.url_extractor import _youtube_video_id as youtube_video_id
from services.workspace import storage
from services.workspace.chat import run_note_chat
from services.workspace.media import CaptureError, capture, formula_to_latex
from services.workspace.processor import process_resource
from services.workspace.synthesis import run_synthesis

logger = logging.getLogger(__name__)

router = APIRouter(tags=["note-sources"])

_VIDEO_EXTS = {".mp4", ".webm", ".mov", ".mkv", ".m4v"}
_DOC_EXTS = {".pdf", ".md", ".txt"}
_NOTE_SOURCE_TYPE = {"pdf": "pdf", "document": "text", "youtube": "video",
                     "video": "video", "website": "url"}


# ── models ───────────────────────────────────────────────────────────────────

class CaptureRequest(BaseModel):
    type: str  # frame | clip | audio
    start: float
    end: float | None = None


class FormulaRequest(BaseModel):
    element_id: str


class SynthesizeRequest(BaseModel):
    mode: str = "replace"  # replace | append (a client-side apply strategy)


class AnchorRow(BaseModel):
    block_id: str
    resource_id: str
    anchor_type: str
    anchor_start: float
    anchor_end: float = 0


class ChatRequest(BaseModel):
    messages: list[dict]


class ProviderCreate(BaseModel):
    provider: str
    api_key: str
    label: str = ""
    base_url: str | None = None
    chat_model: str | None = None


class ProviderPatch(BaseModel):
    enabled: bool | None = None
    api_key: str | None = None
    chat_model: str | None = None


# ── helpers ──────────────────────────────────────────────────────────────────

def _own_note(note_id: str, user_id: str) -> dict:
    rows = (get_supabase().table("notes").select("id,user_id,title,content")
            .eq("id", note_id).eq("user_id", user_id).execute().data)
    if not rows:
        raise HTTPException(status_code=404, detail={"error": "Note not found"})
    return rows[0]


def _own_source(source_id: str, user_id: str) -> dict:
    rows = (get_supabase().table("note_resources").select("*")
            .eq("id", source_id).eq("user_id", user_id).execute().data)
    if not rows:
        raise HTTPException(status_code=404, detail={"error": "Source not found"})
    return rows[0]


def _source_public(r: dict) -> dict:
    out = dict(r)
    meta = r.get("meta") or {}
    if meta.get("thumbnail_path"):
        try:
            out["thumbnail_url"] = storage.signed_url(meta["thumbnail_path"], 3600)
        except Exception:
            pass
    return out


def _classify(file: UploadFile | None, url: str | None) -> tuple[str, str, str]:
    """→ (kind, title, ext). Raises 400 on an unsupported or empty input."""
    if file is not None and file.filename:
        ext = os.path.splitext(file.filename)[1].lower()
        if ext in _VIDEO_EXTS:
            kind = "video"
        elif ext in _DOC_EXTS:
            kind = "pdf" if ext == ".pdf" else "document"
        else:
            raise HTTPException(status_code=400, detail={
                "error": f"Unsupported file type '{ext}'. Accepted: "
                         f"{', '.join(sorted(_DOC_EXTS | _VIDEO_EXTS))}"})
        return kind, os.path.splitext(os.path.basename(file.filename))[0], ext
    if url:
        kind = "youtube" if youtube_video_id(url) else "website"
        return kind, ("YouTube video" if kind == "youtube" else url), ""
    raise HTTPException(status_code=400,
                        detail={"error": "Provide a file or a url."})


# ── attach / list / detach ───────────────────────────────────────────────────

@router.post("/sources")
async def attach_source(
    background: BackgroundTasks,
    authorization: str = Header(),
    file: UploadFile | None = File(default=None),
    url: str | None = Form(default=None),
    note_id: str | None = Form(default=None),
):
    """Attach a source. With no note_id, the note is created first — the first
    drop is one request, not create-then-attach."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    url = url.strip() if url else None
    kind, title, ext = _classify(file, url)

    if note_id:
        _own_note(note_id, user_id)
    else:
        note_id = db.table("notes").insert({
            "user_id": user_id, "title": title, "content": [], "content_text": "",
            "source_type": _NOTE_SOURCE_TYPE.get(kind, "text"),
            "source_url": url,
            "source_filename": (file.filename if file is not None else None),
        }).execute().data[0]["id"]

    attached = (db.table("note_resources").select("id")
                .eq("note_id", note_id).execute().data or [])
    order_index = len(attached)

    if file is not None and file.filename:
        sid = str(uuid.uuid4())
        spath = f"{user_id}/{sid}/source{ext}"
        data = await file.read()
        try:
            storage.upload(spath, data, file.content_type or "application/octet-stream")
        except Exception as e:
            raise HTTPException(status_code=502, detail={"error": f"Upload failed: {e}"})
        row = db.table("note_resources").insert({
            "id": sid, "note_id": note_id, "user_id": user_id, "kind": kind,
            "title": title, "storage_path": spath, "mime_type": file.content_type,
            "order_index": order_index,
        }).execute().data[0]
    else:
        row = db.table("note_resources").insert({
            "note_id": note_id, "user_id": user_id, "kind": kind, "title": title,
            "source_url": url, "order_index": order_index,
        }).execute().data[0]

    background.add_task(process_resource, row["id"])
    return {"note_id": note_id, "source": _source_public(row)}


@router.get("/notes/{note_id}/sources")
async def list_sources(note_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_note(note_id, user_id)
    rows = (get_supabase().table("note_resources").select("*")
            .eq("note_id", note_id).order("order_index").execute().data or [])
    return [_source_public(r) for r in rows]


@router.delete("/sources/{source_id}")
async def detach_source(source_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    r = _own_source(source_id, user_id)
    # best-effort storage cleanup; the note always survives
    try:
        prefix = f"{user_id}/{source_id}"
        objs = get_supabase().storage.from_(storage.BUCKET).list(prefix) or []
        storage.remove([f"{prefix}/{o['name']}" for o in objs])
    except Exception:
        pass
    get_supabase().table("note_resources").delete().eq("id", source_id).execute()
    return {"ok": True, "note_id": r.get("note_id")}


# ── single source ────────────────────────────────────────────────────────────

@router.get("/sources/{source_id}")
async def get_source(source_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    r = _own_source(source_id, user_id)
    elements = (get_supabase().table("resource_elements").select("*")
                .eq("resource_id", source_id)
                .order("page").order("order_index").execute().data or [])
    for el in elements:
        if el.get("image_path"):
            try:
                el["image_url"] = storage.signed_url(el["image_path"], 3600)
            except Exception:
                pass
    out = _source_public(r)
    out["elements"] = elements
    return out


@router.get("/sources/{source_id}/file")
async def source_file_url(source_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    r = _own_source(source_id, user_id)
    if not r.get("storage_path"):
        raise HTTPException(status_code=404,
                            detail={"error": "Source has no stored file"})
    try:
        return {"url": storage.signed_url(r["storage_path"], 3600)}
    except Exception as e:
        raise HTTPException(status_code=502, detail={"error": f"Could not sign URL: {e}"})


@router.post("/sources/{source_id}/reprocess")
async def reprocess_source(source_id: str, background: BackgroundTasks,
                           authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_source(source_id, user_id)
    get_supabase().table("note_resources").update(
        {"status": "queued", "error": None}).eq("id", source_id).execute()
    background.add_task(process_resource, source_id)
    return {"ok": True}


@router.post("/sources/{source_id}/capture")
async def capture_media(source_id: str, body: CaptureRequest,
                        authorization: str = Header()):
    user_id = get_user_id(authorization)
    r = _own_source(source_id, user_id)
    if r["kind"] not in ("video", "youtube"):
        raise HTTPException(status_code=400,
                            detail={"error": "Capture only works on video sources"})
    try:
        return capture(r, body.type, body.start, body.end)
    except CaptureError as e:
        raise HTTPException(status_code=422, detail={"error": str(e)})


@router.post("/sources/{source_id}/formula-latex")
async def formula_latex(source_id: str, body: FormulaRequest,
                        authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_source(source_id, user_id)
    rows = (get_supabase().table("resource_elements").select("*")
            .eq("id", body.element_id).eq("user_id", user_id).execute().data)
    if not rows:
        raise HTTPException(status_code=404, detail={"error": "Element not found"})
    el = rows[0]
    if not el.get("image_path"):
        raise HTTPException(status_code=422, detail={"error": "Element has no image crop"})
    try:
        image_bytes = storage.download(el["image_path"])
        return {"latex": formula_to_latex(image_bytes, user_id)}
    except CaptureError as e:
        raise HTTPException(status_code=422, detail={"error": str(e)})
    except Exception as e:
        raise HTTPException(status_code=502, detail={"error": f"Formula OCR failed: {e}"})


# ── synthesis ────────────────────────────────────────────────────────────────

@router.post("/notes/{note_id}/synthesize")
async def synthesize(note_id: str, body: SynthesizeRequest,
                     background: BackgroundTasks, authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_note(note_id, user_id)
    if body.mode not in ("replace", "append"):
        raise HTTPException(status_code=400,
                            detail={"error": "mode must be 'replace' or 'append'"})
    get_supabase().table("note_synthesis").upsert({
        "note_id": note_id, "user_id": user_id, "status": "queued", "error": None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="note_id").execute()
    background.add_task(run_synthesis, note_id, body.mode)
    return {"ok": True, "status": "queued"}


@router.get("/notes/{note_id}/synthesis")
async def get_synthesis(note_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_note(note_id, user_id)
    rows = (get_supabase().table("note_synthesis").select("*")
            .eq("note_id", note_id).eq("user_id", user_id).execute().data)
    if not rows:
        return {"status": "none", "source_ids": []}
    r = rows[0]
    return {"status": r.get("status"), "html": r.get("html"),
            "source_ids": r.get("source_ids") or [],
            "title_suggestion": r.get("title_suggestion"),
            "error": r.get("error"), "applied_at": r.get("applied_at")}


@router.post("/notes/{note_id}/synthesis/applied")
async def mark_synthesis_applied(note_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_note(note_id, user_id)
    now = datetime.now(timezone.utc).isoformat()
    get_supabase().table("note_synthesis").update(
        {"applied_at": now, "updated_at": now}).eq("note_id", note_id).eq(
        "user_id", user_id).execute()
    return {"ok": True, "applied_at": now}


# ── note anchors (note block ↔ source position sync) ─────────────────────────

@router.put("/notes/{note_id}/anchors")
async def put_anchors(note_id: str, body: list[AnchorRow],
                      authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_note(note_id, user_id)
    db = get_supabase()
    db.table("note_anchors").delete().eq("note_id", note_id).execute()
    if body:
        db.table("note_anchors").insert([
            {"note_id": note_id, "user_id": user_id,
             "resource_id": a.resource_id, "block_id": a.block_id,
             "anchor_type": a.anchor_type,
             "anchor_start": a.anchor_start, "anchor_end": a.anchor_end}
            for a in body
        ]).execute()
    return {"ok": True, "count": len(body)}


@router.get("/notes/{note_id}/anchors")
async def get_anchors(note_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    return (get_supabase().table("note_anchors").select("*")
            .eq("note_id", note_id).eq("user_id", user_id).execute().data or [])


# ── grounded chat ────────────────────────────────────────────────────────────

@router.post("/notes/{note_id}/chat")
async def note_chat(note_id: str, body: ChatRequest, authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_note(note_id, user_id)

    async def stream():
        async for ev in run_note_chat(note_id, user_id, body.messages):
            yield "data: " + json.dumps(ev) + "\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


# ── recent sessions (the empty shell's recents strip) ────────────────────────

@router.get("/sessions/recent")
async def recent_sessions(authorization: str = Header(), limit: int = 12):
    user_id = get_user_id(authorization)
    db = get_supabase()
    srcs = (db.table("note_resources").select("note_id,kind,title,order_index")
            .eq("user_id", user_id).order("created_at", desc=True)
            .limit(200).execute().data or [])
    by_note: dict[str, dict] = {}
    for s in srcs:
        entry = by_note.setdefault(s["note_id"], {
            "note_id": s["note_id"], "source_count": 0, "kinds": []})
        entry["source_count"] += 1
        if s["kind"] not in entry["kinds"]:
            entry["kinds"].append(s["kind"])
    if not by_note:
        return []
    notes = (db.table("notes").select("id,title,updated_at,deleted_at")
             .in_("id", list(by_note)).execute().data or [])
    out = []
    for n in notes:
        if n.get("deleted_at"):
            continue
        out.append({**by_note[n["id"]], "title": n.get("title") or "Untitled",
                    "updated_at": n.get("updated_at")})
    out.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
    return out[:limit]


# ── AI providers ─────────────────────────────────────────────────────────────

@router.get("/ai-providers")
async def list_ai_providers(authorization: str = Header()):
    user_id = get_user_id(authorization)
    rows = (get_supabase().table("ai_providers").select("*")
            .eq("user_id", user_id).order("created_at").execute().data or [])
    for r in rows:
        key = r.pop("api_key", "") or ""
        r["api_key_hint"] = ("…" + key[-4:]) if len(key) >= 8 else "set"
    return rows


@router.post("/ai-providers")
async def create_ai_provider(body: ProviderCreate, authorization: str = Header()):
    user_id = get_user_id(authorization)
    if body.provider not in ("gemini", "anthropic", "openai", "openai_compatible"):
        raise HTTPException(status_code=400, detail={"error": "Unknown provider"})
    if body.provider == "openai_compatible" and not body.base_url:
        raise HTTPException(status_code=400,
                            detail={"error": "openai_compatible needs base_url"})
    row = get_supabase().table("ai_providers").insert({
        "user_id": user_id, "provider": body.provider,
        "label": body.label or body.provider, "api_key": body.api_key,
        "base_url": body.base_url, "chat_model": body.chat_model,
    }).execute().data[0]
    row.pop("api_key", None)
    return row


@router.patch("/ai-providers/{provider_id}")
async def patch_ai_provider(provider_id: str, body: ProviderPatch,
                            authorization: str = Header()):
    user_id = get_user_id(authorization)
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        return {"ok": True}
    rows = (get_supabase().table("ai_providers").update(patch)
            .eq("id", provider_id).eq("user_id", user_id).execute().data)
    if not rows:
        raise HTTPException(status_code=404, detail={"error": "Provider not found"})
    out = rows[0]
    out.pop("api_key", None)
    return out


@router.delete("/ai-providers/{provider_id}")
async def delete_ai_provider(provider_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    get_supabase().table("ai_providers").delete().eq("id", provider_id).eq(
        "user_id", user_id).execute()
    return {"ok": True}
```

- [ ] **Step 4: Register it and delete the old router**

`backend/main.py` line 8 — swap `workspaces` for `note_sources`:

```python
from routers import notes, ingest, retrieval, internal, agent, agent_inline, agent_ingest, skills_api, mcp_api, note_sources
```

line 37:

```python
app.include_router(note_sources.router)
```

```bash
cd /home/ayoub/projects/second_brain
git rm backend/routers/workspaces.py backend/tests/test_workspaces_router.py
grep -rn "routers.workspaces\|routers import.*workspaces" backend/ --include="*.py" | grep -v '\.venv/' | grep -v '/venv/'
```
Expected grep output: empty.

- [ ] **Step 5: Update the frontend proxy allowlist**

`frontend/app/api/ws/[...path]/route.ts` lines 6–12:

```ts
const ALLOWED_PREFIXES = [
  "sources",
  "notes",   // /notes/{id}/{sources,synthesis,synthesize,anchors,chat}
  "sessions",
  "ai-providers",
];
```

- [ ] **Step 6: Run the whole backend suite**

Run: `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/ -p asyncio -q`
Expected: PASS, no collection errors. Every remaining reference to the old surface is gone.

- [ ] **Step 7: Commit**

```bash
git add backend/routers/note_sources.py backend/tests/test_note_sources_router.py backend/main.py "frontend/app/api/ws/[...path]/route.ts"
git commit -m "feat(api): note_sources router replaces the workspaces router"
```

---

## Task 7: `lib/workspace.ts` rewrite + kill the canvas

**Files:**
- Modify: `frontend/lib/workspace.ts` (full rewrite), `frontend/components/workspace/viewers/PdfViewer.tsx:13,24,51`, `viewers/VideoPlayer.tsx:7,11,26`, `viewers/YouTubePlayer.tsx:7,35`, `viewers/WebsiteViewer.tsx:7,11`, `frontend/package.json`
- Delete: `frontend/components/workspace/WorkspaceCanvas.tsx`, `ResourceCard.tsx`, `NotePageCard.tsx`, `frontend/app/(brain)/brain/workspaces/` (both routes)

**Interfaces:**
- Produces (every later frontend task consumes these):
  - types `NoteSource`, `WsElement`, `NoteAnchor`, `Citation`, `Synthesis`, `RecentSession`, `SendAction`, `ResourceKind`, `ResourceStatus`, `AnchorType`, `SynthesisStatus`
  - `wsApi.{addSource,listSources,getSource,sourceFileUrl,deleteSource,reprocessSource,capture,formulaLatex,synthesize,getSynthesis,markSynthesisApplied,getAnchors,putAnchors,recentSessions}`
  - `sourceColor(orderIndex: number): string`, `parseSourceAnchor(v: string)`, `fmtTime`, `anchorLabel`, `youtubeVideoId`

This task is a single commit on purpose: deleting the canvas and rewriting the
types it depended on must land together or `tsc` cannot pass in between.

- [ ] **Step 1: Rewrite `frontend/lib/workspace.ts`**

```ts
// Workspace feature — shared types + thin API client over the /api/ws proxy.
// One note, many sources: sources attach directly to a note and one AI
// synthesis comes out. No workspaces, no pages, no canvas positions.

export type ResourceKind = "pdf" | "document" | "youtube" | "video" | "website";
export type ResourceStatus = "queued" | "processing" | "ready" | "failed";
export type AnchorType = "time" | "page" | "section";
export type SynthesisStatus = "none" | "queued" | "running" | "ready" | "failed";

export interface NoteSource {
  id: string;
  note_id: string;
  kind: ResourceKind;
  title: string;
  source_url: string | null;
  storage_path: string | null;
  mime_type?: string | null;
  status: ResourceStatus;
  error: string | null;
  meta: {
    pages?: number;
    page_sizes?: [number, number][];
    duration?: number;
    author?: string;
    has_transcript?: boolean;
    thumbnail_path?: string;
    [k: string]: unknown;
  };
  order_index: number;
  thumbnail_url?: string;
  elements?: WsElement[];
}

export interface WsElement {
  id: string;
  resource_id: string;
  page: number;
  element_type: "text" | "heading" | "image" | "table" | "formula";
  order_index: number;
  bbox: [number, number, number, number] | null;
  content: string | null;
  image_path: string | null;
  image_url?: string;
}

export interface NoteAnchor {
  id?: string;
  note_id?: string;
  block_id: string;
  resource_id: string;
  anchor_type: AnchorType;
  anchor_start: number;
  anchor_end: number;
}

export interface Citation {
  n: number;
  resource_id: string;
  title: string;
  anchor_type: AnchorType;
  anchor_start: number;
  anchor_end: number;
  snippet?: string;
}

export interface Synthesis {
  status: SynthesisStatus;
  html?: string | null;
  source_ids: string[];
  title_suggestion?: string | null;
  error?: string | null;
  applied_at?: string | null;
}

export interface RecentSession {
  note_id: string;
  title: string;
  source_count: number;
  kinds: ResourceKind[];
  updated_at?: string;
}

export type SendAction =
  | { type: "text"; text: string }
  | { type: "image"; url: string; caption?: string }
  | { type: "table"; markdown: string }
  | { type: "latex"; latex: string }
  | { type: "checkpoint"; anchorType: AnchorType; value: number; label?: string }
  | { type: "clip"; url: string; label?: string }
  | { type: "audio"; url: string; label?: string };

// ── API helpers ──────────────────────────────────────────────────────────────

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body?.detail?.error || body?.error || msg;
    } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.json();
}

export const wsApi = {
  /** Attach a file or URL. Without noteId the backend creates the note first. */
  addSource: (input: { file?: File; url?: string; noteId?: string | null }) => {
    const fd = new FormData();
    if (input.file) fd.set("file", input.file);
    if (input.url) fd.set("url", input.url);
    if (input.noteId) fd.set("note_id", input.noteId);
    return fetch("/api/ws/sources", { method: "POST", body: fd })
      .then((r) => j<{ note_id: string; source: NoteSource }>(r));
  },
  listSources: (noteId: string) =>
    fetch(`/api/ws/notes/${noteId}/sources`).then((r) => j<NoteSource[]>(r)),
  getSource: (sid: string) =>
    fetch(`/api/ws/sources/${sid}`).then((r) => j<NoteSource>(r)),
  sourceFileUrl: (sid: string) =>
    fetch(`/api/ws/sources/${sid}/file`).then((r) => j<{ url: string }>(r)),
  deleteSource: (sid: string) =>
    fetch(`/api/ws/sources/${sid}`, { method: "DELETE" })
      .then((r) => j<{ ok: boolean; note_id: string }>(r)),
  reprocessSource: (sid: string) =>
    fetch(`/api/ws/sources/${sid}/reprocess`, { method: "POST" }).then((r) => j(r)),
  capture: (sid: string, type: "frame" | "clip" | "audio", start: number, end?: number) =>
    fetch(`/api/ws/sources/${sid}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, start, end }),
    }).then((r) => j<{ path: string; url: string; mime: string }>(r)),
  formulaLatex: (sid: string, elementId: string) =>
    fetch(`/api/ws/sources/${sid}/formula-latex`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ element_id: elementId }),
    }).then((r) => j<{ latex: string }>(r)),

  synthesize: (noteId: string, mode: "replace" | "append") =>
    fetch(`/api/ws/notes/${noteId}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    }).then((r) => j<{ ok: boolean; status: string }>(r)),
  getSynthesis: (noteId: string) =>
    fetch(`/api/ws/notes/${noteId}/synthesis`).then((r) => j<Synthesis>(r)),
  markSynthesisApplied: (noteId: string) =>
    fetch(`/api/ws/notes/${noteId}/synthesis/applied`, { method: "POST" })
      .then((r) => j(r)),

  getAnchors: (noteId: string) =>
    fetch(`/api/ws/notes/${noteId}/anchors`).then((r) => j<NoteAnchor[]>(r)),
  putAnchors: (noteId: string, anchors: NoteAnchor[]) =>
    fetch(`/api/ws/notes/${noteId}/anchors`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(anchors),
    }).then((r) => j(r)),

  recentSessions: () =>
    fetch("/api/ws/sessions/recent").then((r) => j<RecentSession[]>(r)),
};

// ── display helpers ──────────────────────────────────────────────────────────

/** Stable per-source accent, keyed off order_index. With 4 sources in play,
 *  "which source is this from?" has to be answerable at a glance, and a colour
 *  dot is cheaper than repeating titles in every chip. */
export const SOURCE_COLORS = [
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ec4899", // pink
  "#8b5cf6", // violet
];

export function sourceColor(orderIndex: number): string {
  const n = SOURCE_COLORS.length;
  return SOURCE_COLORS[(((orderIndex ?? 0) % n) + n) % n];
}

/** Source-indexed anchor: "2:p:14" → { sourceIndex: 2, type: "page", value: 14 } */
export function parseSourceAnchor(
  v: string
): { sourceIndex: number; type: AnchorType; value: number } | null {
  const m = v.match(/^(\d+):([tps]):([\d.]+)$/);
  if (!m) return null;
  const type: AnchorType = m[2] === "t" ? "time" : m[2] === "p" ? "page" : "section";
  return { sourceIndex: parseInt(m[1], 10), type, value: parseFloat(m[3]) };
}

export function youtubeVideoId(url: string): string | null {
  const patterns = [
    /youtube\.com\/watch\?.*v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

export function fmtTime(seconds: number): string {
  const s = Math.floor(seconds);
  if (s >= 3600) {
    return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function anchorLabel(type: AnchorType, value: number): string {
  if (type === "time") return fmtTime(value);
  if (type === "page") return `p. ${Math.round(value)}`;
  return `§${Math.round(value)}`;
}
```

- [ ] **Step 2: Rename the type + one method in the four viewers (mechanical, no logic changes)**

In each of `viewers/PdfViewer.tsx`, `viewers/VideoPlayer.tsx`, `viewers/YouTubePlayer.tsx`, `viewers/WebsiteViewer.tsx`: change the import of `WsResource` to `NoteSource` and the `resource: WsResource;` prop declaration to `resource: NoteSource;`.

In `PdfViewer.tsx:51` and `VideoPlayer.tsx:26`: `wsApi.resourceFileUrl(` → `wsApi.sourceFileUrl(`.

```bash
cd /home/ayoub/projects/second_brain/frontend
sed -i 's/\bWsResource\b/NoteSource/g; s/wsApi\.resourceFileUrl(/wsApi.sourceFileUrl(/g' components/workspace/viewers/*.tsx
grep -rn "WsResource\|resourceFileUrl" components/workspace/viewers/
```
Expected grep output: empty.

- [ ] **Step 3: Delete the canvas**

```bash
cd /home/ayoub/projects/second_brain
git rm frontend/components/workspace/WorkspaceCanvas.tsx \
       frontend/components/workspace/ResourceCard.tsx \
       frontend/components/workspace/NotePageCard.tsx
git rm -r "frontend/app/(brain)/brain/workspaces"
cd frontend && npm uninstall @xyflow/react
grep -rn "xyflow" --include="*.tsx" --include="*.ts" --include="*.json" . | grep -v node_modules | grep -v package-lock
```
Expected grep output: empty.

- [ ] **Step 4: Typecheck — expect exactly the known breakage**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors **only** in `components/workspace/SplitView.tsx` and `components/workspace/WorkspaceChat.tsx` (both rewritten in Tasks 8 and 11) — `SplitView` still imports `WsResource`/`wsApi.getResource`, `WorkspaceChat` still posts to `/api/ws/workspaces/...`. Any other file erroring means something outside the plan referenced the canvas — fix it before continuing.

- [ ] **Step 5: Commit**

```bash
cd /home/ayoub/projects/second_brain
git add frontend/lib/workspace.ts frontend/components/workspace/viewers frontend/package.json frontend/package-lock.json
git commit -m "feat(frontend)!: note-source types + API client; delete the canvas UI and @xyflow/react"
```

---

## Task 8: `NotePane.tsx` — absorb `SplitView`, add append-apply to the editor

**Files:**
- Create: `frontend/components/workspace/NotePane.tsx`
- Modify: `frontend/components/editor/BlockEditor.tsx:143-149` (handle) and its `useImperativeHandle` body
- Delete: `frontend/components/workspace/SplitView.tsx`

**Interfaces:**
- Consumes: `BlockEditorHandle`, `wsApi.getAnchors/putAnchors`, `parseSourceAnchor`, `sourceColor`, `anchorLabel`.
- Produces:
  - `BlockEditorHandle.insertHtmlAtEnd(html: string): Promise<AnyBlock[]>` — parses HTML, appends it, returns the blocks that landed.
  - `NoteData = { id: string; title: string; content: AnyBlock[] }`
  - `NoteApplyApi = { apply(html, sourceIds, mode): void; hasUserEdits(): boolean }`
  - `<NotePane note sources activeSourceId onSelectSource seekRef actionSinkRef positionSinkRef applyRef onApplied onSavingChange />`

- [ ] **Step 1: Add `insertHtmlAtEnd` to the block editor**

`frontend/components/editor/BlockEditor.tsx` — extend the handle interface (after `scrollToBlock`, line 148):

```ts
  /** Parse HTML and append it at the end; returns the blocks that landed.
   *  Used by workspace synthesis in "append" mode (the `ingestHtml` prop is
   *  the replace path and rewrites the whole document). */
  insertHtmlAtEnd: (html: string) => Promise<AnyBlock[]>;
```

and implement it inside `useImperativeHandle` (after `scrollToBlock`):

```ts
      async insertHtmlAtEnd(html: string) {
        const doc = new window.DOMParser().parseFromString(html, "text/html");
        const parsed = await editor.tryParseHTMLToBlocks(doc.body.innerHTML);
        const before = (editor.document as AnyBlock[]).length;
        const last = (editor.document as AnyBlock[])[before - 1];
        if (last) editor.insertBlocks(parsed, last.id, "after");
        else editor.replaceBlocks(editor.document, parsed);
        const now = editor.document as AnyBlock[];
        const added = last ? now.slice(before) : now;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        onSave?.(now, getPlainText(now));
        return added;
      },
```

- [ ] **Step 2: Write `NotePane.tsx`**

`frontend/components/workspace/NotePane.tsx`:

```tsx
"use client";

// The note half of the compact workspace shell.
//
// Everything that used to live in SplitView, moved here unchanged in substance:
// the editor host, the synthesis-HTML → blocks handoff, anchor collection and
// registration, forward/reverse sync, the send-to-note bus, autosave + debounced
// reindex. What changed is that anchors are now source-indexed ("2:p:14"), so a
// single note's sections can point at several different sources.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Link2 } from "lucide-react";
import type { BlockEditorHandle } from "@/components/editor/BlockEditor";
import {
  anchorLabel, parseSourceAnchor, sourceColor, wsApi,
  type AnchorType, type NoteAnchor, type NoteSource, type SendAction,
} from "@/lib/workspace";

const BlockEditor = dynamic(
  () => import("@/components/editor/BlockEditor").then((m) => m.BlockEditor),
  { ssr: false, loading: () => <div className="h-40 animate-pulse bg-gray-50 dark:bg-gray-800 rounded-lg m-4" /> }
) as React.ForwardRefExoticComponent<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any & React.RefAttributes<BlockEditorHandle>
>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

export interface NoteData {
  id: string;
  title: string;
  content: AnyBlock[];
}

export interface NoteApplyApi {
  /** Apply a synthesis draft. `sourceIds` is the draft's source order — the
   *  1-based source index inside each data-anchor indexes into it. */
  apply: (html: string, sourceIds: string[], mode: "replace" | "append") => void;
  /** True when the note holds content that did not come from the last applied
   *  draft — i.e. the user's own work is in there and must not be clobbered. */
  hasUserEdits: () => boolean;
}

interface PendingAnchor { sourceIndex: number; type: AnchorType; value: number }

interface NotePaneProps {
  note: NoteData;
  sources: NoteSource[];
  activeSourceId: string | null;
  onSelectSource: (id: string) => void;
  seekRef: React.MutableRefObject<((value: number) => void) | null>;
  /** NotePane publishes its send-to-note sink here so the viewer can push blocks. */
  actionSinkRef: React.MutableRefObject<((a: SendAction) => void) | null>;
  /** NotePane publishes its forward-sync handler here (source position → block). */
  positionSinkRef: React.MutableRefObject<((value: number) => void) | null>;
  applyRef: React.MutableRefObject<NoteApplyApi | null>;
  onApplied: () => void;
  onSavingChange?: (saving: boolean) => void;
}

function getPlainText(blocks: AnyBlock[]): string {
  return blocks
    .map((b: AnyBlock) => {
      const inline = Array.isArray(b.content)
        ? b.content.map((c: AnyBlock) => (c?.type === "text" ? c.text ?? "" : "")).join("")
        : "";
      const child = b.children?.length ? getPlainText(b.children) : "";
      return [inline, child].filter(Boolean).join("\n");
    })
    .join("\n");
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function markdownTableToBlock(md: string): AnyBlock | null {
  const rows = md.trim().split("\n")
    .map((r) => r.trim())
    .filter((r) => r.startsWith("|"))
    .filter((r) => !/^\|[\s:|-]+\|$/.test(r)) // drop separator row
    .map((r) => r.slice(1, r.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim()));
  if (rows.length === 0) return null;
  const width = Math.max(...rows.map((r) => r.length));
  return {
    type: "table",
    content: {
      type: "tableContent",
      rows: rows.map((cells) => ({
        cells: Array.from({ length: width }, (_, i) => [
          { type: "text", text: cells[i] ?? "", styles: {} },
        ]),
      })),
    },
  };
}

export function NotePane({
  note, sources, activeSourceId, onSelectSource, seekRef, actionSinkRef,
  positionSinkRef, applyRef, onApplied, onSavingChange,
}: NotePaneProps) {
  const [anchors, setAnchors] = useState<NoteAnchor[]>([]);
  const [ingestHtml, setIngestHtml] = useState<string | undefined>();
  const [syncOn, setSyncOn] = useState(true);
  const editorRef = useRef<BlockEditorHandle>(null);
  const pendingRef = useRef<{ anchors: PendingAnchor[]; sourceIds: string[] } | null>(null);
  const lastSyncedBlock = useRef<string | null>(null);
  const reindexDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTextRef = useRef<string>(getPlainText(note.content ?? []));
  const baselineTextRef = useRef<string | null>(null);

  // ── anchors ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    wsApi.getAnchors(note.id)
      .then((a) => { if (!cancelled) setAnchors(a); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [note.id]);

  const sourceById = useMemo(
    () => new Map(sources.map((s) => [s.id, s])), [sources]);

  const registerAnchors = useCallback((blocks: AnyBlock[], mode: "replace" | "append") => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending || pending.anchors.length === 0) return;
    const headings = blocks.filter(
      (b: AnyBlock) => b.type === "heading" && (b.props?.level ?? 1) === 2);
    const rows: NoteAnchor[] = [];
    headings.forEach((h: AnyBlock, i: number) => {
      const p = pending.anchors[i];
      if (!p) return;
      const rid = pending.sourceIds[p.sourceIndex - 1];
      if (!rid) return;   // model invented a source index — drop it
      rows.push({
        block_id: h.id, resource_id: rid, anchor_type: p.type,
        anchor_start: p.value, anchor_end: p.value,
      });
    });
    if (rows.length === 0) return;
    const merged = mode === "append" ? [...anchors, ...rows] : rows;
    wsApi.putAnchors(note.id, merged).then(() => setAnchors(merged)).catch(() => {});
  }, [anchors, note.id]);

  // ── synthesis apply API (used by useSynthesis) ─────────────────────────────
  const collect = useCallback((html: string, sourceIds: string[]) => {
    // Read data-anchor values in document order BEFORE BlockNote parsing strips
    // unknown attributes; they get zipped with the heading blocks afterwards.
    const doc = new window.DOMParser().parseFromString(html, "text/html");
    const list: PendingAnchor[] = [];
    doc.querySelectorAll("h2[data-anchor]").forEach((h) => {
      const parsed = parseSourceAnchor(h.getAttribute("data-anchor") || "");
      if (parsed) list.push(parsed);
    });
    pendingRef.current = { anchors: list, sourceIds };
  }, []);

  useEffect(() => {
    applyRef.current = {
      apply: (html, sourceIds, mode) => {
        collect(html, sourceIds);
        baselineTextRef.current = null;
        if (mode === "append") {
          editorRef.current?.insertHtmlAtEnd(html).then((blocks) => {
            registerAnchors(blocks, "append");
            baselineTextRef.current = currentTextRef.current;
            onApplied();
          }).catch(() => {});
        } else {
          setIngestHtml(html);   // BlockEditor's proven replace path
        }
      },
      hasUserEdits: () => {
        const cur = normalize(currentTextRef.current);
        if (!cur) return false;
        if (baselineTextRef.current !== null
            && normalize(baselineTextRef.current) === cur) return false;
        return true;   // content we can't prove came from a draft → treat as the user's
      },
    };
    return () => { applyRef.current = null; };
  }, [applyRef, collect, registerAnchors, onApplied]);

  const handleBlocksApplied = useCallback((blocks: AnyBlock[]) => {
    registerAnchors(blocks, "replace");
    baselineTextRef.current = getPlainText(blocks);
    onApplied();
  }, [registerAnchors, onApplied]);

  // ── save ──────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async (blocks: AnyBlock[], plainText: string) => {
    currentTextRef.current = plainText;
    onSavingChange?.(true);
    await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: blocks, content_text: plainText }),
    }).catch(() => {});
    onSavingChange?.(false);
    if (reindexDebounceRef.current) clearTimeout(reindexDebounceRef.current);
    reindexDebounceRef.current = setTimeout(() => {
      fetch("/api/internal/reindex-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note_id: note.id }),
      }).catch(() => {});
    }, 30_000);
  }, [note.id, onSavingChange]);

  // ── forward sync: active source position → highlight the matching block ───
  const activeAnchors = useMemo(
    () => anchors.filter((a) => a.resource_id === activeSourceId)
      .sort((a, b) => a.anchor_start - b.anchor_start),
    [anchors, activeSourceId]);

  const handlePosition = useCallback((value: number) => {
    if (!syncOn || activeAnchors.length === 0) return;
    let match: NoteAnchor | null = null;
    for (const a of activeAnchors) {
      if (a.anchor_start <= value + 0.01) match = a;
      else break;
    }
    if (match && match.block_id !== lastSyncedBlock.current) {
      lastSyncedBlock.current = match.block_id;
      editorRef.current?.scrollToBlock(match.block_id);
    }
  }, [syncOn, activeAnchors]);

  useEffect(() => {
    positionSinkRef.current = handlePosition;
    return () => { positionSinkRef.current = null; };
  }, [positionSinkRef, handlePosition]);

  // ── reverse sync: section chip → switch source, seek, scroll the note ─────
  const jumpToAnchor = useCallback((a: NoteAnchor) => {
    if (a.resource_id !== activeSourceId) onSelectSource(a.resource_id);
    seekRef.current?.(a.anchor_start);
    editorRef.current?.scrollToBlock(a.block_id);
    lastSyncedBlock.current = a.block_id;
  }, [activeSourceId, onSelectSource, seekRef]);

  // ── send-to-note bus ──────────────────────────────────────────────────────
  const handleAction = useCallback((action: SendAction) => {
    const ed = editorRef.current;
    if (!ed) return;
    const blocks: AnyBlock[] = [];
    if (action.type === "text") {
      for (const para of action.text.split("\n\n")) {
        if (para.trim()) blocks.push({ type: "paragraph", content: para.trim() });
      }
    } else if (action.type === "image") {
      blocks.push({ type: "image", props: { url: action.url, caption: action.caption ?? "" } });
    } else if (action.type === "table") {
      const t = markdownTableToBlock(action.markdown);
      if (t) blocks.push(t);
      else if (action.markdown.trim()) blocks.push({ type: "paragraph", content: action.markdown });
    } else if (action.type === "latex") {
      blocks.push({ type: "math", props: { latex: action.latex } });
    } else if (action.type === "checkpoint") {
      blocks.push({
        type: "checkpoint",
        props: {
          noteId: note.id,
          resourceId: activeSourceId ?? "",
          anchorType: action.anchorType,
          value: String(action.value),
          label: action.label ?? "",
        },
      });
    } else if (action.type === "clip") {
      blocks.push({ type: "video", props: { url: action.url, caption: action.label ?? "" } });
    } else if (action.type === "audio") {
      blocks.push({ type: "audio", props: { url: action.url, caption: action.label ?? "" } });
    }
    if (blocks.length) ed.insertBlocksAtEnd(blocks);
  }, [note.id, activeSourceId]);

  useEffect(() => {
    actionSinkRef.current = handleAction;
    return () => { actionSinkRef.current = null; };
  }, [actionSinkRef, handleAction]);

  // ── render ────────────────────────────────────────────────────────────────
  const chips = useMemo(() => {
    const order = new Map(sources.map((s) => [s.id, s.order_index]));
    return [...anchors].sort((a, b) =>
      (order.get(a.resource_id) ?? 99) - (order.get(b.resource_id) ?? 99)
      || a.anchor_start - b.anchor_start);
  }, [anchors, sources]);

  return (
    <div className="h-full min-w-0 flex flex-col bg-white dark:bg-gray-900">
      {chips.length > 0 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-100 dark:border-gray-800 overflow-x-auto shrink-0">
          <span className="text-[10px] uppercase tracking-wider text-gray-400 mr-1 shrink-0">
            Sections
          </span>
          {chips.map((a) => {
            const src = sourceById.get(a.resource_id);
            return (
              <button
                key={a.block_id}
                onClick={() => jumpToAnchor(a)}
                title={`${src?.title ?? "source"} — ${anchorLabel(a.anchor_type, a.anchor_start)}`}
                className="shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 hover:text-indigo-600 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: sourceColor(src?.order_index ?? 0) }} />
                {anchorLabel(a.anchor_type, a.anchor_start)}
              </button>
            );
          })}
          <button
            onClick={() => setSyncOn((v) => !v)}
            title="Toggle source ↔ note sync"
            className={`ml-auto shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border transition-colors ${
              syncOn
                ? "border-indigo-300 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-300"
                : "border-gray-200 text-gray-400 dark:border-gray-700"
            }`}
          >
            <Link2 size={10} /> {syncOn ? "on" : "off"}
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-5 py-4">
          <BlockEditor
            ref={editorRef}
            noteId={note.id}
            initialContent={
              Array.isArray(note.content) && note.content.length > 0
                ? note.content : undefined
            }
            onSave={handleSave}
            ingestHtml={ingestHtml}
            onBlocksApplied={handleBlocksApplied}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Delete `SplitView.tsx`**

```bash
cd /home/ayoub/projects/second_brain
git rm frontend/components/workspace/SplitView.tsx
grep -rn "SplitView" frontend --include="*.tsx" --include="*.ts" | grep -v node_modules
```
Expected grep output: empty (its only importer, the canvas route, is already gone).

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors only in `components/workspace/WorkspaceChat.tsx` (Task 11).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/workspace/NotePane.tsx frontend/components/editor/BlockEditor.tsx
git commit -m "feat(frontend): NotePane absorbs SplitView; multi-source anchors + append apply"
```

---

## Task 9: `SourceRail`, `SourceViewer`, `DropZone`

**Files:**
- Create: `frontend/components/workspace/SourceRail.tsx`, `SourceViewer.tsx`, `DropZone.tsx`

**Interfaces:**
- Produces:
  - `<SourceRail sources activeId onSelect onAddFiles onAddUrl onRemove onRetry busy />`
  - `<SourceViewer source onPosition onAction seekRef />`
  - `<DropZone onAddFiles onAddUrl busy />`
- `onAddFiles: (files: File[]) => void`, `onAddUrl: (url: string) => void`, `onRemove/onRetry: (s: NoteSource) => void` — the shell supplies all four in Task 10.

- [ ] **Step 1: Write `SourceRail.tsx`**

```tsx
"use client";

// The source rail: every source attached to this note, one compact row each.
// Add (file picker or pasted URL), select → viewer, retry a failed source,
// remove. Rows are ~28px so five sources still leave the viewer usable.
import { useRef, useState } from "react";
import { FileText, Globe, Plus, RefreshCw, Video, X, Youtube } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { sourceColor, type NoteSource, type ResourceKind } from "@/lib/workspace";

function KindIcon({ kind }: { kind: ResourceKind }) {
  const Icon = kind === "youtube" ? Youtube
    : kind === "video" ? Video
    : kind === "website" ? Globe
    : FileText;
  return <Icon size={12} className="shrink-0 text-gray-400" />;
}

function StatusDot({ source }: { source: NoteSource }) {
  if (source.status === "failed") {
    return <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />;
  }
  if (source.status === "ready") {
    return <span className="w-1.5 h-1.5 rounded-full shrink-0"
                 style={{ backgroundColor: sourceColor(source.order_index) }} />;
  }
  return <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />;
}

interface SourceRailProps {
  sources: NoteSource[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAddFiles: (files: File[]) => void;
  onAddUrl: (url: string) => void;
  onRemove: (s: NoteSource) => void;
  onRetry: (s: NoteSource) => void;
  busy?: boolean;
}

export function SourceRail({
  sources, activeId, onSelect, onAddFiles, onAddUrl, onRemove, onRetry, busy,
}: SourceRailProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<NoteSource | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="shrink-0 max-h-[38%] flex flex-col border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
          Sources {sources.length > 0 && `(${sources.length})`}
        </span>
        <div className="relative">
          <button
            onClick={() => setShowAdd((v) => !v)}
            disabled={busy}
            title="Add a source"
            className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-indigo-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors"
          >
            <Plus size={14} />
          </button>
          {showAdd && (
            <div className="absolute right-0 top-full mt-1 w-52 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 overflow-hidden">
              <button
                className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                onClick={() => { setShowAdd(false); fileInputRef.current?.click(); }}
              >
                Upload file (PDF, MD, TXT, video)
              </button>
              <button
                className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                onClick={() => { setShowAdd(false); setShowUrl(true); }}
              >
                Paste URL (website / YouTube)
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-1.5">
        {sources.length === 0 && (
          <p className="px-1.5 pb-2 text-[11px] text-gray-400">
            Drop a PDF, a video, or paste a link anywhere in this panel.
          </p>
        )}
        {sources.map((s) => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`group flex items-center gap-1.5 h-7 px-2 rounded-md cursor-pointer transition-colors ${
              s.id === activeId
                ? "bg-indigo-50 dark:bg-indigo-900/30"
                : "hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <StatusDot source={s} />
            <KindIcon kind={s.kind} />
            <span className={`flex-1 min-w-0 truncate text-xs ${
              s.id === activeId
                ? "text-indigo-700 dark:text-indigo-300 font-medium"
                : "text-gray-700 dark:text-gray-300"
            }`} title={s.error ? `Failed: ${s.error}` : s.title}>
              {s.title}
            </span>
            {s.status === "processing" && (
              <span className="text-[10px] text-amber-500 shrink-0">processing</span>
            )}
            {s.status === "queued" && (
              <span className="text-[10px] text-gray-400 shrink-0">queued</span>
            )}
            {s.status === "failed" && (
              <button
                onClick={(e) => { e.stopPropagation(); onRetry(s); }}
                title={s.error ?? "Retry"}
                className="shrink-0 text-red-400 hover:text-red-600"
              >
                <RefreshCw size={11} />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setPendingRemove(s); }}
              title="Remove this source"
              className="shrink-0 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-opacity"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.md,.txt,.mp4,.webm,.mov,.mkv,.m4v"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onAddFiles(files);
        }}
      />
      <PromptDialog
        open={showUrl}
        title="Add a source URL"
        label="URL"
        placeholder="https://… (website or YouTube video)"
        confirmLabel="Add"
        onSubmit={(v) => { setShowUrl(false); if (v.trim()) onAddUrl(v.trim()); }}
        onCancel={() => setShowUrl(false)}
      />
      <ConfirmDialog
        open={pendingRemove !== null}
        title={`Remove "${pendingRemove?.title ?? ""}"?`}
        description="It is detached from this note and its extracted data is deleted. Your note keeps everything you already wrote."
        confirmLabel="Remove"
        onConfirm={() => {
          const s = pendingRemove;
          setPendingRemove(null);
          if (s) onRemove(s);
        }}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Write `SourceViewer.tsx`**

```tsx
"use client";

// Thin dispatcher from a source's `kind` onto the proven viewers. It also loads
// the source detail (elements + signed image URLs), which is what the viewers'
// element overlays and send-to-note actions need.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { wsApi, type NoteSource, type SendAction } from "@/lib/workspace";
import { YouTubePlayer } from "./viewers/YouTubePlayer";
import { VideoPlayer } from "./viewers/VideoPlayer";
import { WebsiteViewer } from "./viewers/WebsiteViewer";

// react-pdf's pdfjs touches DOMMatrix at import time, which does not exist in
// Node — this viewer can never be server-rendered.
const PdfViewer = dynamic(
  () => import("./viewers/PdfViewer").then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center text-xs text-gray-400">
        Loading PDF viewer…
      </div>
    ),
  }
);

interface SourceViewerProps {
  source: NoteSource | null;
  onPosition: (value: number) => void;
  onAction: (a: SendAction) => void;
  seekRef: React.MutableRefObject<((value: number) => void) | null>;
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center px-6 text-center text-xs text-gray-400">
      {children}
    </div>
  );
}

export function SourceViewer({ source, onPosition, onAction, seekRef }: SourceViewerProps) {
  const [detail, setDetail] = useState<NoteSource | null>(null);

  useEffect(() => {
    if (!source) { setDetail(null); return; }
    let cancelled = false;
    setDetail(null);
    wsApi.getSource(source.id)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setDetail(source); });
    return () => { cancelled = true; };
  }, [source]);

  if (!source) return <Message>Select a source to open it here.</Message>;
  if (source.status === "failed") {
    return <Message>Processing failed: {source.error ?? "unknown error"} — use retry in the rail.</Message>;
  }
  if (source.status !== "ready") {
    return <Message>Processing “{source.title}”… the note is written once every source is in.</Message>;
  }
  if (!detail || detail.id !== source.id) return <Message>Loading source…</Message>;

  const common = { resource: detail, onPosition, onAction, seekRef };
  if (detail.kind === "pdf" || detail.kind === "document") return <PdfViewer {...common} />;
  if (detail.kind === "youtube") return <YouTubePlayer {...common} />;
  if (detail.kind === "video") return <VideoPlayer {...common} />;
  return <WebsiteViewer {...common} />;
}
```

- [ ] **Step 3: Write `DropZone.tsx`**

```tsx
"use client";

// Empty state of the workspace shell: one drop target, and a recents strip so a
// session can be resumed without a sidebar section to maintain.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Link2 } from "lucide-react";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { wsApi, type RecentSession } from "@/lib/workspace";

interface DropZoneProps {
  onAddFiles: (files: File[]) => void;
  onAddUrl: (url: string) => void;
  busy?: boolean;
}

export function DropZone({ onAddFiles, onAddUrl, busy }: DropZoneProps) {
  const router = useRouter();
  const [recents, setRecents] = useState<RecentSession[]>([]);
  const [showUrl, setShowUrl] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    wsApi.recentSessions().then(setRecents).catch(() => {});
  }, []);

  return (
    <div className="h-full overflow-y-auto flex flex-col items-center justify-center gap-8 px-6 py-10">
      <div className="w-full max-w-xl rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 px-8 py-12 text-center">
        <p className="text-3xl mb-3">📥</p>
        <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">
          Drop your sources here
        </h1>
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          PDFs, notes, videos, YouTube links, articles — as many as you like.
          They all feed one note, written for you once the last one finishes.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <FileUp size={15} /> {busy ? "Uploading…" : "Choose files"}
          </button>
          <button
            onClick={() => setShowUrl(true)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            <Link2 size={15} /> Paste a link
          </button>
        </div>
      </div>

      {recents.length > 0 && (
        <div className="w-full max-w-xl">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
            Pick up where you left off
          </p>
          <div className="flex flex-wrap gap-2">
            {recents.map((r) => (
              <button
                key={r.note_id}
                onClick={() => router.push(`/brain/workspace/${r.note_id}`)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate max-w-[220px]">
                  {r.title}
                </span>
                <span className="text-[10px] text-gray-400 shrink-0">
                  {r.source_count} source{r.source_count === 1 ? "" : "s"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.md,.txt,.mp4,.webm,.mov,.mkv,.m4v"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onAddFiles(files);
        }}
      />
      <PromptDialog
        open={showUrl}
        title="Add a source URL"
        label="URL"
        placeholder="https://… (website or YouTube video)"
        confirmLabel="Add"
        onSubmit={(v) => { setShowUrl(false); if (v.trim()) onAddUrl(v.trim()); }}
        onCancel={() => setShowUrl(false)}
      />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors only in `WorkspaceChat.tsx` (Task 11).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/workspace/SourceRail.tsx frontend/components/workspace/SourceViewer.tsx frontend/components/workspace/DropZone.tsx
git commit -m "feat(frontend): source rail, viewer dispatcher, and empty-state drop zone"
```

---

## Task 10: `useSynthesis.ts` + `WorkspaceShell.tsx` + routes + sidebar

**Files:**
- Create: `frontend/components/workspace/useSynthesis.ts`, `frontend/components/workspace/WorkspaceShell.tsx`, `frontend/app/(brain)/brain/workspace/page.tsx`, `frontend/app/(brain)/brain/workspace/[noteId]/page.tsx`
- Modify: `frontend/components/sidebar/Sidebar.tsx:147-152`

**Interfaces:**
- Consumes: `NotePane` + `NoteApplyApi` + `NoteData`, `SourceRail`, `SourceViewer`, `DropZone`, `wsApi`, `useToast`.
- Produces: `useSynthesis(opts) -> SynthesisController`, `<WorkspaceShell noteId={string | null} />`.
- The chat drawer slot is left as a TODO comment in this task and filled in Task 11 — the shell is testable without it.

- [ ] **Step 1: Write `useSynthesis.ts`**

```ts
"use client";

// Synthesis lifecycle for one note: poll, decide replace-vs-append, apply,
// and derive the "Re-synthesize (N sources)" state from what the current draft
// was actually built from.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { wsApi, type NoteSource, type Synthesis } from "@/lib/workspace";
import type { NoteApplyApi } from "./NotePane";

interface Options {
  noteId: string | null;
  sources: NoteSource[];
  applyRef: React.MutableRefObject<NoteApplyApi | null>;
}

export interface SynthesisController {
  synthesis: Synthesis | null;
  /** A draft is queued or being written right now. */
  running: boolean;
  /** The current draft was built from a different source set than what's ready. */
  stale: boolean;
  readyCount: number;
  /** The replace-vs-append dialog should be open. */
  askMode: boolean;
  requestSynthesis: () => void;
  chooseMode: (mode: "replace" | "append") => void;
  cancelMode: () => void;
  dismissError: () => void;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

export function useSynthesis({ noteId, sources, applyRef }: Options): SynthesisController {
  const [synthesis, setSynthesis] = useState<Synthesis | null>(null);
  const [askMode, setAskMode] = useState(false);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const appliedRef = useRef<string | null>(null);   // html we already applied
  const modeRef = useRef<"replace" | "append" | null>(null);

  const readyIds = useMemo(
    () => sources.filter((s) => s.status === "ready").map((s) => s.id), [sources]);
  const pending = sources.some((s) => s.status === "queued" || s.status === "processing");
  const running = synthesis?.status === "queued" || synthesis?.status === "running";

  const refresh = useCallback(() => {
    if (!noteId) return;
    wsApi.getSynthesis(noteId).then(setSynthesis).catch(() => {});
  }, [noteId]);

  useEffect(() => {
    appliedRef.current = null;
    modeRef.current = null;
    setSynthesis(null);
    refresh();
  }, [noteId, refresh]);

  // Poll while a source is still processing (the settle guard fires on the last
  // one) or while a draft is being written.
  useEffect(() => {
    if (!noteId || (!pending && !running)) return;
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [noteId, pending, running, refresh]);

  // Apply a ready, unapplied draft.
  useEffect(() => {
    const html = synthesis?.html;
    if (!noteId || !html || synthesis?.status !== "ready") return;
    if (synthesis.applied_at || appliedRef.current === html) return;
    const api = applyRef.current;
    if (!api) return;   // NotePane not mounted yet; the effect re-runs when it is

    // Never silently overwrite the user's own work: without an explicit choice,
    // an edited note gets the draft appended, not slammed on top.
    const mode = modeRef.current
      ?? (api.hasUserEdits() ? "append" : "replace");
    appliedRef.current = html;
    modeRef.current = null;
    api.apply(html, synthesis.source_ids ?? [], mode);
    wsApi.markSynthesisApplied(noteId).then(refresh).catch(() => {});
  }, [noteId, synthesis, applyRef, refresh]);

  const queue = useCallback((mode: "replace" | "append") => {
    if (!noteId) return;
    modeRef.current = mode;
    setErrorDismissed(false);
    setSynthesis((s) => ({
      status: "queued", source_ids: s?.source_ids ?? [], html: null,
    }));
    wsApi.synthesize(noteId, mode).then(refresh).catch(() => refresh());
  }, [noteId, refresh]);

  const requestSynthesis = useCallback(() => {
    if (!noteId || running) return;
    if (applyRef.current?.hasUserEdits()) setAskMode(true);
    else queue("replace");
  }, [noteId, running, applyRef, queue]);

  const chooseMode = useCallback((mode: "replace" | "append") => {
    setAskMode(false);
    queue(mode);
  }, [queue]);

  return {
    synthesis: synthesis && synthesis.status === "failed" && errorDismissed
      ? { ...synthesis, error: null } : synthesis,
    running,
    stale: synthesis?.status === "ready"
      && !sameSet(synthesis.source_ids ?? [], readyIds),
    readyCount: readyIds.length,
    askMode,
    requestSynthesis,
    chooseMode,
    cancelMode: () => setAskMode(false),
    dismissError: () => setErrorDismissed(true),
  };
}
```

- [ ] **Step 2: Write `WorkspaceShell.tsx`**

```tsx
"use client";

// The compact workspace shell: one note, the sources attached to it, and every
// tool that acts on them — in one tight layout. Left column = source rail +
// viewer (resizable, remembered); right column = the note in the ordinary block
// editor; chat is a drawer over the note, never a third column.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, MessageSquare, RefreshCw } from "lucide-react";
import { useToast } from "@/app/providers";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { wsApi, type Citation, type NoteSource, type SendAction } from "@/lib/workspace";
import { DropZone } from "./DropZone";
import { NotePane, type NoteApplyApi, type NoteData } from "./NotePane";
import { SourceRail } from "./SourceRail";
import { SourceViewer } from "./SourceViewer";
import { useSynthesis } from "./useSynthesis";

const SPLIT_KEY = "workspace:splitPct";

interface WorkspaceShellProps {
  noteId: string | null;
}

export function WorkspaceShell({ noteId }: WorkspaceShellProps) {
  const router = useRouter();
  const search = useSearchParams();
  const { showToast } = useToast();

  const [note, setNote] = useState<NoteData | null>(null);
  const [sources, setSources] = useState<NoteSource[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [splitPct, setSplitPct] = useState(45);

  const seekRef = useRef<((value: number) => void) | null>(null);
  const actionSinkRef = useRef<((a: SendAction) => void) | null>(null);
  const positionSinkRef = useRef<((value: number) => void) | null>(null);
  const applyRef = useRef<NoteApplyApi | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const syn = useSynthesis({ noteId, sources, applyRef });

  // ── load ──────────────────────────────────────────────────────────────────
  const loadSources = useCallback(async () => {
    if (!noteId) return;
    const rows = await wsApi.listSources(noteId).catch(() => null);
    if (rows) setSources(rows);
  }, [noteId]);

  useEffect(() => {
    if (!noteId) { setNote(null); setSources([]); return; }
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/notes/${noteId}`);
      if (!res.ok || cancelled) return;
      const n = await res.json();
      setNote({ id: n.id, title: n.title ?? "Untitled", content: n.content ?? [] });
    })();
    loadSources();
    return () => { cancelled = true; };
  }, [noteId, loadSources]);

  // poll while any source is still working
  const pending = sources.some((s) => s.status === "queued" || s.status === "processing");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(loadSources, 2000);
    return () => clearInterval(timer);
  }, [pending, loadSources]);

  // pick a sensible active source
  useEffect(() => {
    if (activeId && sources.some((s) => s.id === activeId)) return;
    const firstReady = sources.find((s) => s.status === "ready") ?? sources[0];
    setActiveId(firstReady?.id ?? null);
  }, [sources, activeId]);

  // the note's title can be upgraded server-side when the draft lands
  useEffect(() => {
    if (!noteId || syn.synthesis?.status !== "ready") return;
    fetch(`/api/notes/${noteId}`).then((r) => r.ok ? r.json() : null).then((n) => {
      if (n?.title) setNote((prev) => prev ? { ...prev, title: n.title } : prev);
    }).catch(() => {});
  }, [noteId, syn.synthesis?.status]);

  // ── split divider ─────────────────────────────────────────────────────────
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(SPLIT_KEY));
    if (stored >= 25 && stored <= 70) setSplitPct(stored);
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current || !containerRef.current) return;
      const box = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - box.left) / box.width) * 100;
      setSplitPct(Math.min(70, Math.max(25, pct)));
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      setSplitPct((p) => { window.localStorage.setItem(SPLIT_KEY, String(Math.round(p))); return p; });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ── add / remove sources ──────────────────────────────────────────────────
  const addInputs = useCallback(async (
    items: { file?: File; url?: string }[]
  ) => {
    setBusy(true);
    let landed = noteId;
    for (const item of items) {
      try {
        const r = await wsApi.addSource({ ...item, noteId: landed });
        landed = r.note_id;
      } catch (e) {
        showToast(e instanceof Error ? e.message
          : `Could not add ${item.file?.name ?? item.url ?? "source"}`);
      }
    }
    setBusy(false);
    if (!noteId && landed) router.replace(`/brain/workspace/${landed}`);
    else await loadSources();
  }, [noteId, router, loadSources, showToast]);

  const addFiles = useCallback((files: File[]) =>
    addInputs(files.map((file) => ({ file }))), [addInputs]);
  const addUrl = useCallback((url: string) =>
    addInputs([{ url }]), [addInputs]);

  const removeSource = useCallback(async (s: NoteSource) => {
    await wsApi.deleteSource(s.id).catch((e) =>
      showToast(e instanceof Error ? e.message : "Could not remove that source"));
    if (activeId === s.id) setActiveId(null);
    await loadSources();
  }, [activeId, loadSources, showToast]);

  const retrySource = useCallback(async (s: NoteSource) => {
    await wsApi.reprocessSource(s.id).catch(() => {});
    await loadSources();
  }, [loadSources]);

  // ── whole-shell drag & drop ───────────────────────────────────────────────
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) { addFiles(files); return; }
    const text = e.dataTransfer.getData("text/uri-list")
      || e.dataTransfer.getData("text/plain");
    if (text?.startsWith("http")) addUrl(text.trim());
  }, [addFiles, addUrl]);

  // ── deep link: ?source=<id>&t=|p=|s= ──────────────────────────────────────
  const deepLink = useMemo(() => {
    const sid = search.get("source");
    if (!sid) return null;
    const t = search.get("t"), p = search.get("p"), s = search.get("s");
    const raw = t ?? p ?? s;
    return { sid, value: raw !== null ? parseFloat(raw) : null };
  }, [search]);

  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (!deepLink || deepLinkDone.current) return;
    if (!sources.some((s) => s.id === deepLink.sid)) return;
    deepLinkDone.current = true;
    setActiveId(deepLink.sid);
    if (deepLink.value === null || Number.isNaN(deepLink.value)) return;
    const timer = setInterval(() => {
      if (seekRef.current) {
        seekRef.current(deepLink.value as number);
        clearInterval(timer);
      }
    }, 300);
    const stop = setTimeout(() => clearInterval(timer), 15000);
    return () => { clearInterval(timer); clearTimeout(stop); };
  }, [deepLink, sources]);

  const handleCitation = useCallback((c: Citation) => {
    setActiveId(c.resource_id);
    seekRef.current?.(c.anchor_start);
  }, []);

  // ── title ─────────────────────────────────────────────────────────────────
  async function saveTitle() {
    const next = (titleDraft ?? "").trim();
    setTitleDraft(null);
    if (!note || !next || next === note.title) return;
    setNote({ ...note, title: next });
    await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    }).catch(() => {});
  }

  const activeSource = sources.find((s) => s.id === activeId) ?? null;

  // ── empty shell ───────────────────────────────────────────────────────────
  if (!noteId || !note) {
    return (
      <div
        className={`h-full ${dragOver ? "ring-2 ring-inset ring-indigo-400" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {noteId ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            Loading session…
          </div>
        ) : (
          <DropZone onAddFiles={addFiles} onAddUrl={addUrl} busy={busy} />
        )}
      </div>
    );
  }

  return (
    <div
      className={`h-full flex flex-col bg-white dark:bg-gray-900 ${
        dragOver ? "ring-2 ring-inset ring-indigo-400" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {/* header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <button
          onClick={() => router.push("/brain/workspace")}
          title="New session"
          className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          <ArrowLeft size={15} />
        </button>
        {titleDraft !== null ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); }}
            className="text-sm font-semibold bg-transparent border-b border-indigo-400 outline-none text-gray-900 dark:text-gray-100 min-w-0 flex-1"
          />
        ) : (
          <button
            onClick={() => setTitleDraft(note.title)}
            title="Rename this note"
            className="text-sm font-semibold text-gray-900 dark:text-gray-100 hover:text-indigo-600 truncate"
          >
            {note.title}
          </button>
        )}
        <span className="text-[11px] text-gray-400 shrink-0">
          {sources.length} source{sources.length === 1 ? "" : "s"}
        </span>
        <span className="text-[11px] text-gray-400 shrink-0 ml-auto">
          {saving ? "Saving…" : syn.running ? "Writing the note…" : ""}
        </span>
        <button
          onClick={syn.requestSynthesis}
          disabled={syn.running || syn.readyCount === 0}
          title="Rewrite the note from the current sources"
          className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors disabled:opacity-40 ${
            syn.stale
              ? "border-indigo-300 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-300"
              : "border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
          }`}
        >
          <RefreshCw size={11} className={syn.running ? "animate-spin" : ""} />
          {syn.stale ? `Re-synthesize (${syn.readyCount} sources)` : "Re-synthesize"}
        </button>
        <button
          onClick={() => setChatOpen((v) => !v)}
          title="Ask about these sources"
          className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
            chatOpen
              ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300"
              : "text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
          }`}
        >
          <MessageSquare size={14} />
        </button>
        <a
          href={`/brain/${note.id}`}
          title="Open this note on its own page"
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <ExternalLink size={14} />
        </a>
      </div>

      {/* synthesis failure banner */}
      {syn.synthesis?.status === "failed" && syn.synthesis.error && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 border-b border-amber-200 dark:border-amber-900 shrink-0">
          <span className="flex-1 min-w-0 truncate">
            Couldn’t write the note: {syn.synthesis.error}
          </span>
          <button onClick={syn.requestSynthesis} className="underline shrink-0">Retry</button>
          <button onClick={syn.dismissError} className="shrink-0">✕</button>
        </div>
      )}

      {/* body */}
      <div ref={containerRef} className="flex-1 min-h-0 flex">
        <div className="flex flex-col min-w-0 border-r border-gray-200 dark:border-gray-800"
             style={{ width: `${splitPct}%` }}>
          <SourceRail
            sources={sources}
            activeId={activeId}
            onSelect={setActiveId}
            onAddFiles={addFiles}
            onAddUrl={addUrl}
            onRemove={removeSource}
            onRetry={retrySource}
            busy={busy}
          />
          <div className="flex-1 min-h-0 flex flex-col">
            <SourceViewer
              source={activeSource}
              onPosition={(v) => positionSinkRef.current?.(v)}
              onAction={(a) => actionSinkRef.current?.(a)}
              seekRef={seekRef}
            />
          </div>
        </div>

        <div
          onMouseDown={() => { draggingRef.current = true; document.body.style.cursor = "col-resize"; }}
          className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-indigo-300 dark:hover:bg-indigo-700 transition-colors"
          title="Drag to resize"
        />

        <div className="relative flex-1 min-w-0">
          <NotePane
            note={note}
            sources={sources}
            activeSourceId={activeId}
            onSelectSource={setActiveId}
            seekRef={seekRef}
            actionSinkRef={actionSinkRef}
            positionSinkRef={positionSinkRef}
            applyRef={applyRef}
            onApplied={() => {}}
            onSavingChange={setSaving}
          />
          {/* Task 11 mounts the WorkspaceChat drawer here (chatOpen / handleCitation). */}
        </div>
      </div>

      <ConfirmDialog
        open={syn.askMode}
        title="This note has your own edits in it"
        description="Replace everything with the new draft, or add the new draft at the end and keep what you wrote?"
        confirmLabel="Add at the end"
        cancelLabel="Replace everything"
        danger={false}
        onConfirm={() => syn.chooseMode("append")}
        onCancel={() => syn.chooseMode("replace")}
      />
    </div>
  );
}
```

Note on the dialog: `ConfirmDialog` is two-button, so "append" is the confirm
action and "replace" is the cancel action, both labelled explicitly. Dismissing
by clicking the backdrop therefore chooses *replace* — if that reads wrong in the
browser pass (Task 13), swap the two labels so the destructive one is not the
backdrop default, or add a third `Cancel` affordance. Do **not** reach for
`window.confirm`.

- [ ] **Step 3: Write both routes**

`frontend/app/(brain)/brain/workspace/page.tsx`:

```tsx
"use client";

import { Suspense } from "react";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

export default function NewWorkspaceSessionPage() {
  return (
    <Suspense fallback={<div className="h-full" />}>
      <WorkspaceShell noteId={null} />
    </Suspense>
  );
}
```

`frontend/app/(brain)/brain/workspace/[noteId]/page.tsx`:

```tsx
"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

export default function WorkspaceSessionPage() {
  const params = useParams<{ noteId: string }>();
  return (
    <Suspense fallback={<div className="h-full" />}>
      <WorkspaceShell noteId={params.noteId} />
    </Suspense>
  );
}
```

- [ ] **Step 4: Point the sidebar at the new route**

`frontend/components/sidebar/Sidebar.tsx` lines 147–152:

```tsx
        <NavItem
          label="Workspace"
          icon={LayoutGrid}
          active={pathname?.startsWith("/brain/workspace") ?? false}
          onClick={() => navigate("/brain/workspace")}
        />
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors only in `WorkspaceChat.tsx` (Task 11).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/workspace/useSynthesis.ts frontend/components/workspace/WorkspaceShell.tsx "frontend/app/(brain)/brain/workspace" frontend/components/sidebar/Sidebar.tsx
git commit -m "feat(frontend): compact workspace shell, synthesis lifecycle, and its routes"
```

---

## Task 11: `WorkspaceChat` — note-scoped drawer

**Files:**
- Modify: `frontend/components/workspace/WorkspaceChat.tsx`, `frontend/components/workspace/WorkspaceShell.tsx` (mount the drawer)

**Interfaces:**
- Produces: `<WorkspaceChat noteId onCitation onClose />` — same streaming logic, new endpoint and drawer chrome.

- [ ] **Step 1: Re-scope the chat component**

In `frontend/components/workspace/WorkspaceChat.tsx`:

Header comment and props:

```tsx
// Grounded chat over one note's sources — answers only from what's attached to
// this note, every claim carrying a [n] citation that opens the right source at
// the exact spot. Rendered as a drawer over the note pane: a third column in a
// compact layout leaves nothing readable.
```
```tsx
interface WorkspaceChatProps {
  noteId: string;
  onCitation: (citation: Citation) => void;
  onClose: () => void;
}
```
```tsx
export function WorkspaceChat({ noteId, onCitation, onClose }: WorkspaceChatProps) {
```

The fetch target and the `send` dependency list:

```tsx
      const res = await fetch(`/api/ws/notes/${noteId}/chat`, {
```
```tsx
  }, [input, messages, streaming, noteId]);
```

Add a source colour dot to each citation chip so multi-source answers are
readable at a glance — replace the chip `<button>` in `CitedText` with:

```tsx
          <button
            key={i}
            onClick={() => onCitation(c)}
            title={`${c.title} — ${anchorLabel(c.anchor_type, c.anchor_start)}\n${c.snippet ?? ""}`}
            className="inline-flex items-center gap-0.5 align-baseline mx-0.5 px-1.5 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300 text-[10px] font-semibold hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors cursor-pointer"
          >
            <span className="w-1 h-1 rounded-full"
                  style={{ backgroundColor: sourceColor(colorIndex.get(c.resource_id) ?? 0) }} />
            {m[1]}
          </button>
```

with `CitedText` taking one more prop:

```tsx
function CitedText({ content, citations, colorIndex, onCitation }: {
  content: string;
  citations: Citation[];
  colorIndex: Map<string, number>;
  onCitation: (c: Citation) => void;
}) {
```

and the component accepting + forwarding it:

```tsx
interface WorkspaceChatProps {
  noteId: string;
  colorIndex: Map<string, number>;   // resource_id → order_index, for the dots
  onCitation: (citation: Citation) => void;
  onClose: () => void;
}
```
```tsx
                <CitedText
                  content={m.content}
                  citations={m.citations ?? []}
                  colorIndex={colorIndex}
                  onCitation={onCitation}
                />
```

Import `sourceColor` alongside `anchorLabel`:

```tsx
import { anchorLabel, sourceColor, type Citation } from "@/lib/workspace";
```

Drawer chrome — replace the root `<div>` className and the title:

```tsx
    <div className="absolute inset-y-0 right-0 z-30 w-[380px] max-w-full flex flex-col border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl">
```
```tsx
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          Ask your sources
        </span>
```

and the empty-state copy:

```tsx
          <p className="text-xs text-gray-400 leading-relaxed">
            Ask anything about the sources attached to this note. Answers are
            grounded in them — every claim carries a clickable citation that opens
            the right source at the exact page or timestamp.
          </p>
```

- [ ] **Step 2: Mount the drawer in the shell**

In `WorkspaceShell.tsx`, add the import:

```tsx
import { WorkspaceChat } from "./WorkspaceChat";
```

a colour index memo (next to `activeSource`):

```tsx
  const colorIndex = useMemo(
    () => new Map(sources.map((s) => [s.id, s.order_index])), [sources]);
```

and replace the Task-10 placeholder comment inside the note column with:

```tsx
          {chatOpen && (
            <WorkspaceChat
              noteId={note.id}
              colorIndex={colorIndex}
              onCitation={handleCitation}
              onClose={() => setChatOpen(false)}
            />
          )}
```

- [ ] **Step 3: Typecheck and build — this is the first fully clean gate**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: both clean, no errors. If `npm run build` complains about
`useSearchParams`, the `Suspense` boundaries from Task 10 Step 3 are missing.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/workspace/WorkspaceChat.tsx frontend/components/workspace/WorkspaceShell.tsx
git commit -m "feat(frontend): note-scoped grounded chat as a drawer with per-source citation dots"
```

---

## Task 12: Checkpoint block, deep links, and "Open sources (N)"

**Files:**
- Modify: `frontend/components/editor/customBlocks.tsx:94-139`, `frontend/components/editor/NoteEditorPage.tsx`

**Interfaces:**
- Consumes: `wsApi.listSources`.
- Produces: checkpoint blocks that link to `/brain/workspace/{noteId}?source={rid}&t=|p=|s=`, and an "Open sources (N)" affordance on the ordinary note page (D2's second half).

- [ ] **Step 1: Re-point the checkpoint block**

In `frontend/components/editor/customBlocks.tsx`, replace `checkpointHref` and the
`CheckpointBlockSpec` render (lines 94–139):

```tsx
function checkpointHref(p: {
  noteId: string; resourceId: string; anchorType: string; value: string;
}): string {
  const key = p.anchorType === "time" ? "t" : p.anchorType === "page" ? "p" : "s";
  return `/brain/workspace/${p.noteId}?source=${p.resourceId}&${key}=${p.value}`;
}

function fmtAnchor(anchorType: string, value: string): string {
  if (anchorType === "time") {
    const s = Math.floor(Number(value) || 0);
    const mm = Math.floor(s / 60);
    return `${mm}:${String(s % 60).padStart(2, "0")}`;
  }
  if (anchorType === "page") return `p. ${value}`;
  return `§${value}`;
}

export const CheckpointBlockSpec = createReactBlockSpec(
  {
    type: "checkpoint",
    propSchema: {
      noteId: { default: "" },
      // Deprecated: kept in the schema so checkpoint blocks written before the
      // workspaces redesign still parse instead of breaking their note. Such a
      // block has no noteId and renders as a dead pill below.
      workspaceId: { default: "" },
      resourceId: { default: "" },
      anchorType: { default: "time" }, // time | page | section
      value: { default: "0" },
      label: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const p = block.props;
      const body = (
        <>
          <span>{p.anchorType === "time" ? "⏱" : "📍"}</span>
          <span>{p.label || "Checkpoint"}</span>
          <span className="opacity-70">{fmtAnchor(p.anchorType, p.value)}</span>
        </>
      );
      // A checkpoint left behind by the old canvas model has nowhere to link to.
      if (!p.noteId || !p.resourceId) {
        return (
          <span
            title="This checkpoint's source is no longer available"
            className="inline-flex items-center gap-1.5 my-0.5 px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-400 text-xs font-medium"
            contentEditable={false}
          >
            {body}
          </span>
        );
      }
      return (
        <a
          href={checkpointHref(p)}
          className="inline-flex items-center gap-1.5 my-0.5 px-2.5 py-1 rounded-full border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 text-xs font-medium no-underline hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors cursor-pointer"
          contentEditable={false}
        >
          {body}
        </a>
      );
    },
  }
);
```

- [ ] **Step 2: Add "Open sources (N)" to the ordinary note page**

In `frontend/components/editor/NoteEditorPage.tsx`, add the import:

```tsx
import { wsApi } from "@/lib/workspace";
```

state + load (next to the other `useState` declarations, around line 84):

```tsx
  const [sourceCount, setSourceCount] = useState(0);
```
```tsx
  // A note with sources attached can be reopened in the workspace shell — the
  // other half of "how do I get back to a session?" (the first half is the
  // recents strip in the empty shell).
  useEffect(() => {
    wsApi.listSources(note.id)
      .then((rows) => setSourceCount(rows.length))
      .catch(() => setSourceCount(0));
  }, [note.id]);
```

and the button, inside the toolbar's left group right after the save-status
`<span>` (line 235):

```tsx
            {sourceCount > 0 && (
              <button
                onClick={() => router.push(`/brain/workspace/${note.id}`)}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                title="Open this note beside its sources"
              >
                <Layers size={12} />
                Open sources ({sourceCount})
              </button>
            )}
```

Add `Layers` to the existing `lucide-react` import in that file.

- [ ] **Step 3: Typecheck and build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/editor/customBlocks.tsx frontend/components/editor/NoteEditorPage.tsx
git commit -m "feat(frontend): checkpoint deep links to the workspace shell + Open sources affordance"
```

---

## Task 13: Full verification pass + browser/UX review

**Files:** none created; fixes land in the files above.

**Prerequisite:** the user has confirmed migration 013 ran (Task 1 Step 3). If
they haven't, stop and ask again — nothing below works against the 012 schema.

- [ ] **Step 1: Full backend suite**

Run: `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/ -p asyncio`
Expected: all pass, zero collection errors. Paste the summary line as evidence.

- [ ] **Step 2: Frontend gate**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: clean. Paste the build summary.

- [ ] **Step 3: Confirm nothing stale survives**

```bash
cd /home/ayoub/projects/second_brain
grep -rn "workspace_resources\|workspace_pages\|match_workspace_chunks\|summary_html" backend/ --include="*.py" | grep -v '\.venv/' | grep -v '/venv/'
grep -rn "WorkspaceCanvas\|SplitView\|xyflow\|brain/workspaces" frontend --include="*.tsx" --include="*.ts" | grep -v node_modules | grep -v '\.next'
```
Expected: both empty.

- [ ] **Step 4: Start the three servers**

```bash
./llama.sh start
cd backend && .venv/bin/uvicorn main:app --reload --port 8000
cd frontend && npm run dev
```
Run each in the background. `next dev` cold-compiling `/brain/workspace` takes
30–60s on this machine — not a hang.

- [ ] **Step 5: Drive the real UI with claude-in-chrome**

Load the browser tools in one `ToolSearch` call, then walk the happy path at
`http://localhost:3000/brain/workspace`:

1. drop a PDF → note is created, URL becomes `/brain/workspace/<noteId>`, rail row appears `queued → processing → ready`;
2. add a YouTube URL and a website URL **while the PDF is still processing** → exactly **one** synthesis fires when the last one lands (check the backend log for a single `synthesizing note …` line);
3. the note fills with one synthesized draft — **not** three per-source sections;
4. section chips carry different source colours; clicking a chip for a non-active source switches the viewer first, then seeks;
5. capture a frame and a clip from the video source → blocks land in the note;
6. insert a checkpoint → the amber pill deep-links back into this shell at the right spot;
7. open the chat drawer → citations across sources, clicking one selects that source and seeks;
8. remove a source → "Re-synthesize (N sources)" appears; run it and take the replace/append choice.

Also open a note that has no sources: no "Open sources" button, and any
pre-redesign checkpoint block renders as a **grey dead pill**, not a broken link
or a crashed editor.

- [ ] **Step 6: Delegate the visual review to Haiku**

Dispatch a subagent with the `Agent` tool, `model: "haiku"`, telling it to take
and read screenshots of `/brain/workspace/<noteId>` with **1, 3, and 5 sources
attached** (plus the empty `/brain/workspace`) and report on: layout and spacing,
visual hierarchy, whether it reads as "operational and minimalist" per the brief,
whether the rail / viewer / note / chat-drawer proportions hold up at 5 sources,
and dark mode. Iterate: apply its feedback as code changes here in the main
session, then re-dispatch for a re-check. Don't burn the main model on raw
screenshot loops.

- [ ] **Step 7: Commit any fixes from the browser pass**

```bash
git add -A
git commit -m "fix(frontend): workspace shell fixes from the live browser + UX review pass"
```

---

## Task 14: Docs, status, and memories

**Files:**
- Rewrite: `docs/workspace-manual-test-checklist.md`
- Modify: `STATUS.md` (the "Workspaces — CODE COMPLETE" section), `ANDROID_PARITY.md` (#20)
- Modify: `/home/ayoub/.claude/projects/-home-ayoub-projects-second-brain/memory/project_workspaces_redesign.md`, `project_workspaces_feature.md`, and the `MEMORY.md` index lines if their hooks change

- [ ] **Step 1: Rewrite the manual test checklist for the new flow**

Replace `docs/workspace-manual-test-checklist.md` with a click-path the user can
run top to bottom, not an archaeology exercise. Sections, in order:

1. **Setup** — three servers, the exact commands, the 30–60s cold compile note, migration 013 already applied.
2. **Empty shell** — `/brain/workspace` renders the drop zone; recents strip lists earlier sessions and opens one.
3. **First drop → one note** — drop a PDF: note created, URL rewrites to `/brain/workspace/<id>`, rail shows `queued → processing → ready`, note title starts as the filename.
4. **Three sources → ONE synthesis** — add a YouTube link and an article while the PDF is still processing; exactly one draft appears, organized by concept, with a topic `<h1>` title replacing the filename; explicitly check there is **not** one `<h2>` per source.
5. **Per-source viewers** — PDF pages + element overlays, YouTube player, website reader; switching sources in the rail swaps the viewer.
6. **Capture** — frame, clip, audio from both an uploaded video and a YouTube source (ffmpeg / yt-dlp; a yt-dlp section fetch can legitimately take 30–128s).
7. **Sync** — section chips jump the right source; scrolling a source highlights the matching block; the sync toggle works.
8. **Checkpoints** — insert one, open its deep link in a new tab, confirm it lands on the right source at the right spot; a pre-redesign checkpoint shows the grey dead pill.
9. **Chat citations across sources** — ask something answerable only by combining two sources; citations from both appear with their source colours; clicking one selects that source and seeks.
10. **Re-synthesize** — remove a source (note keeps its blocks, that source's chips disappear), see "Re-synthesize (N sources)", run it; with your own edits in the note, confirm the replace-vs-append choice appears and both branches behave.
11. **Failure paths** — a bad URL fails in the rail with retry and does not block the others' synthesis; with no AI provider configured, synthesis fails with a message pointing at Settings → AI Providers while sources stay viewable and capture still works.
12. **Editing freedom** — restructure, rewrite and extend the note; reload; the changes persisted.

- [ ] **Step 2: Update `STATUS.md`**

Replace the "Workspaces — CODE COMPLETE" section with a "Workspaces — compact
single-note shell" section: what shipped (route `/brain/workspace/<noteId>`,
`note_resources` + `note_synthesis`, settle-guard synthesis, source-indexed
anchors, chat drawer), what was deleted (canvas, `workspaces`/`workspace_pages`,
per-resource summaries, `@xyflow/react`), that migration 013 is applied, and the
verification state (test counts, browser pass date).

- [ ] **Step 3: Update `ANDROID_PARITY.md` #20**

Rewrite gap #20 against the new design: Android parity now means the compact
shell (source rail + viewer + one note + chat drawer) over `note_resources` /
`note_synthesis`, not a canvas. Still **no Android build** in this scope.

- [ ] **Step 4: Update the memories**

- `project_workspaces_redesign.md`: flip "Implementation NOT started" to shipped, dated, with the commit range; record what actually landed vs. the spec (the six flagged deviations), and that the canvas is gone for good.
- `project_workspaces_feature.md`: mark the canvas-era description as superseded, keep every still-true gotcha (BlockNote factory, react-pdf SSR, embed batch size, no native dialogs, Nemotron CoT leak, react-pdf z-index, dead background servers, yt-dlp slowness, shared clip/audio marker), and point at the new architecture.
- Add any new gotcha this build hit that a future session would trip on.

- [ ] **Step 5: Give the user their test commands**

Per the standing "test after each milestone" preference, hand over:

```bash
# backend
cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/ -p asyncio

# frontend
cd frontend && npx tsc --noEmit && npm run build

# live
./llama.sh start
cd backend && .venv/bin/uvicorn main:app --reload --port 8000
cd frontend && npm run dev
# then: http://localhost:3000/brain/workspace  → docs/workspace-manual-test-checklist.md
```

- [ ] **Step 6: Commit**

```bash
git add docs/workspace-manual-test-checklist.md STATUS.md ANDROID_PARITY.md
git commit -m "docs: rewrite the workspace manual checklist and status for the compact redesign"
```

---

## Self-review

**Spec coverage:** §2 route/shell → Tasks 10, 12. §3 schema → Task 1. §4 engine kept/changed table → Tasks 2–6 (every row mapped: processor, synthesis, prompt, chat, router). §5 D1 settle trigger + prompt changes → Tasks 2, 3. §6 endpoints → Task 6 (all 16 lines present, plus the `applied_at` addition flagged). §7 deletions → Task 7; layout + all seven components → Tasks 8–11; source colours → Task 7 (`sourceColor`) used in Tasks 8, 9, 11; section chips → Task 8; checkpoint block + deep links + dead pill → Tasks 12 and 10 (shell-side deep-link handling). §8 error handling → Task 6 (per-source failure), Task 3 (synthesis failure, no-provider message, `with_retry` on the terminal write), Task 9 (rail retry), Task 10 (failure banner), Task 1 (`ON DELETE CASCADE`). §9 testing → Tasks 2, 3, 5, 6, 13. §10 build order → followed, with the one flagged re-slice. §11 out of scope → nothing here touches Android, ingest, the agent engine, MCP or `ai_providers` behaviour.

**Type consistency checked:** `NoteSource` / `Synthesis` / `NoteAnchor` / `Citation` / `RecentSession` are defined once in Task 7 and used unchanged in Tasks 8–12. `wsApi` method names are fixed in Task 7 and every later call site uses them (`sourceFileUrl` in the viewers, `getSource` in `SourceViewer`, `listSources` in the shell and `NoteEditorPage`, `synthesize`/`getSynthesis`/`markSynthesisApplied` in `useSynthesis`, `getAnchors`/`putAnchors` in `NotePane`, `recentSessions` in `DropZone`). `NoteApplyApi.apply(html, sourceIds, mode)` is produced by Task 8 and consumed by Task 10 with the same signature. `BlockEditorHandle.insertHtmlAtEnd` is declared and implemented in Task 8 and called only there. Backend: `maybe_synthesize(note_id)` (Task 3) is called by Task 4; `run_synthesis(note_id, mode)` (Task 3) is called by Task 6; `run_note_chat(note_id, user_id, messages)` (Task 5) is called by Task 6; `with_retry` (Task 3) is used by Tasks 3 and 4. `match_note_source_chunks` args in Task 1's SQL match the RPC call in Task 5 and its test.

**Known-thin spots, deliberately left to the browser pass (Task 13):** the exact three-way replace/append/cancel affordance (two-button `ConfirmDialog` used, with a written fallback if the backdrop default reads wrong), and the rail's `max-h-[38%]` split against 5 sources.

