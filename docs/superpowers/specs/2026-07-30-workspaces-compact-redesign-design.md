# Workspaces — Compact Single-Note Redesign (design spec)

> Status: **approved 2026-07-30**, ready for `superpowers:writing-plans`.
> Supersedes the UX and data model of `docs/plans/2026-07-12-workspaces.md`.
> Keeps that plan's extraction / capture / AI-provider engine intact.
> Brief that started this: `docs/prompts/workspace-redesign-compact-ui-prompt.md`.

## 1. Why

The canvas-based Workspaces feature is CODE COMPLETE and live-verified
(2026-07-12 → 2026-07-29), but the UX is wrong for how the user works. Rejected,
explicitly and not up for revival:

- an infinite freeform canvas with dragged/resized resource and note cards;
- a separate "create and name a workspace" step before any work can start;
- **one output note per resource** (3 imports → 3 summary notes).

Wanted instead: an operational, minimalist, reliable compact surface — open it,
drop sources, every tool right there, one note comes out.

## 2. What "workspace" means now

A workspace is no longer a persistent, listable, named entity. It is the route
`/brain/workspace/<noteId>` — a compact shell over **one note** plus **the
sources attached to that note**. `/brain/workspace` (no id) is the same shell in
its empty state: drop zone + recents. One sidebar entry, "Workspace", points
there. No list page, no create dialog, no canvas.

The backing note is an ordinary `notes` row from the first moment: same
BlockNote editor, same autosave, same block indexing, searchable, linkable,
@-mentionable, and fully editable — requirement 3 of the brief is satisfied by
the note simply *being* a normal note, not by adding editing affordances to an
AI output.

### Decisions the user delegated ("do the best thing")

- **D1 — Synthesis trigger**: auto first draft on a settle condition, then
  explicit re-synthesize. See §5.
- **D2 — Resuming a session**: recents strip inside the empty shell, plus an
  "Open sources (N)" button in the ordinary note toolbar when a note has
  sources. No new sidebar section to maintain.

Both are deliberately cheap to flip later; neither is load-bearing for anything
else in this spec.

### Decisions the user made explicitly

- Entry point: dedicated route, note created lazily on first source attach,
  normal note page gets an "Open sources" affordance (§2, §6).
- Existing workspace data: **clean slate** (§3).

## 3. Data model — `supabase/migrations/013_note_sources.sql`

Clean slate. The migration:

1. `DROP TABLE ... CASCADE` on `workspaces`, `workspace_pages`,
   `workspace_resources`, `resource_elements`, `resource_chunks`, `note_anchors`;
   `DROP FUNCTION match_workspace_chunks`.
2. Creates the tables below with owner-only RLS, same pattern as migration 012.
3. Leaves `ai_providers` and the `workspace-resources` storage bucket in place.
   Bucket *objects* are orphaned by the drop; deleting them is a manual
   housekeeping step, not a migration step (the bucket is private and the paths
   are `user_id/resource_id/...`, so orphans are harmless).

Notes themselves are never touched — old summary notes survive as plain notes.

```
note_resources     id            uuid pk
                   note_id       uuid not null → notes(id) ON DELETE CASCADE
                   user_id       uuid not null → profiles(id) ON DELETE CASCADE
                   kind          text check ('pdf','document','youtube','video','website')
                   title         text not null default 'Untitled source'
                   source_url    text
                   storage_path  text
                   mime_type     text
                   status        text check ('queued','processing','ready','failed')
                   error         text
                   meta          jsonb not null default '{}'
                   order_index   int  not null default 0   -- position in the rail
                   created_at, updated_at
                   -- REMOVED vs workspace_resources:
                   --   workspace_id, pos_x, pos_y, width, height, z_index, summary_html

note_synthesis     note_id       uuid pk → notes(id) ON DELETE CASCADE
                   user_id       uuid not null → profiles(id) ON DELETE CASCADE
                   html          text
                   status        text check ('queued','running','ready','failed')
                   error         text
                   source_ids    uuid[] not null default '{}'
                   title_suggestion text
                   applied_at    timestamptz
                   updated_at    timestamptz not null default now()

resource_elements  unchanged shape; FK resource_id → note_resources(id)

resource_chunks    unchanged shape EXCEPT workspace_id → note_id (→ notes, CASCADE);
                   index on (note_id); HNSW embedding index kept as-is
                   RPC: match_note_source_chunks(query_embedding, match_user_id,
                                                 target_note_id, match_count)

note_anchors       unchanged shape (id, note_id, user_id, resource_id, block_id,
                   anchor_type, anchor_start, anchor_end, UNIQUE(note_id, block_id));
                   resource_id now FKs note_resources. Already multi-source-capable —
                   this table needed no reshaping for "one note, many sources".
```

Two moves carry the whole redesign at the schema level:

- **`summary_html` moves off the resource onto `note_synthesis`.** After this
  there is nowhere to store a per-resource summary, so "one note per resource"
  cannot come back by accident.
- **`note_synthesis.source_ids` records what a draft was built from.** Comparing
  it against the note's current ready sources is what makes the re-synthesize
  affordance honest, and it is the whole state machine for D1.

`DATABASE_URL` is a placeholder on this machine (see the `backend-test-quirks`
memory), so **the user must run this migration manually in the Supabase SQL
editor**. It is destructive; the implementing session must stop and ask rather
than assume it has been applied.

## 4. Engine — kept vs. changed

**Untouched** (proven, live-tested 2026-07-29 — do not rebuild):
`services/workspace/pdf_elements.py`, `youtube.py`, `video.py`, `website.py`,
`media.py` (ffmpeg / yt-dlp frame, clip, audio), `storage.py`, all of
`services/ai/` (providers, capability routing, request-time fallback, the
streaming `complete()` fix for reasoning-model CoT leakage), the `_with_retry`
status/meta fix, element-level PDF extraction, formula→LaTeX, and every
`frontend/components/workspace/viewers/*` component.

**Changed:**

| File | Change |
|---|---|
| `services/workspace/processor.py` | Delete `_create_output_note()` and `_generate_summary()`. Job becomes purely extract → elements → chunks+embeddings → meta → `ready`. Ends by calling `maybe_synthesize(note_id)` (§5). Keep `_with_retry` on status/meta writes. |
| `services/workspace/synthesis.py` | **New.** `maybe_synthesize(note_id)` (the settle guard) and `run_synthesis(note_id, mode)` — builds the multi-source prompt, calls `complete_with_fallback("summarize_text", ...)`, writes `note_synthesis`. |
| `prompts/note_synthesis.py` | **New**, replaces `prompts/workspace_summary.py`. Still built on `prompts/mastery_guide.SYSTEM_PROMPT`. See §5. |
| `services/workspace/chat.py` | Workspace scope → note scope: `retrieve_chunks(query, note_id, user_id)`, RPC `match_note_source_chunks`, titles read from `note_resources`. Citation payload unchanged (already carries `resource_id` + `title`, which is exactly what multi-source needs). ~5 lines plus renames. |
| `routers/workspaces.py` → `routers/note_sources.py` | Rewritten surface, §6. Re-register in `main.py`. |

`services/ai/` needs no capability changes: synthesis is still a
`summarize_text` job, and the video-native path (`summarize_video`, transcript-less
YouTube) still applies per source — a transcript-less source contributes its
Gemini-derived text into the same single synthesis rather than becoming its own note.

## 5. Synthesis — one note, many sources

### D1: trigger — settle condition, no timers

`maybe_synthesize(note_id)` runs after each source reaches `ready` and proceeds
only if **all three** hold:

1. no source on this note is still `queued` or `processing`;
2. no `note_synthesis` row exists for this note;
3. the note has no user content (`content` empty or absent).

Consequences, all intended:

- Drop 3 PDFs at once → each finishes at a different time; the first two see a
  sibling still processing and no-op; the last one fires exactly one synthesis
  across all 3. No timers, no debounce window, no wasted LLM calls.
- Attach a 4th source later → it finishes, sees an existing synthesis, no-ops.
  The UI compares `source_ids` against current ready sources and offers
  **"Re-synthesize (4 sources)"**.
- A failed source never blocks the settle check (`failed` is terminal, not
  pending), so one bad URL cannot strand the synthesis forever.
- All sources failed → no synthesis, note stays empty, per-source errors visible
  in the rail with retry.

Re-synthesis is always explicit and takes `mode`:

- `replace` — overwrite the note's blocks with the new draft;
- `append` — insert the new draft at the end, leaving existing blocks alone.

The client asks which **only when the note has user content**; on an untouched
note it silently uses `replace`.

### Prompt — `prompts/note_synthesis.py`

Three changes from `workspace_summary.py`:

1. **Source-indexed anchors.** `data-anchor="2:p:14"` — source index (1-based,
   matching the order of the `=== SOURCE n ===` blocks in the prompt), then
   `t`/`p`/`s`, then the value. Today's format is `p:14` with the resource
   implied. Monotonic *within* a source, not across sources. Client regex moves
   from `^([tps]):([\d.]+)$` to `^(\d+):([tps]):([\d.]+)$`, and the anchor-row
   builder maps source index → resource id.
2. **Synthesize, don't concatenate.** Explicit instructions: organize by
   concept, not by source; state shared material once, anchored to the source
   that explains it best; call out where sources genuinely disagree or
   complement each other. Name the failure mode to avoid — one `<h2>` per source
   is wrong output.
3. **Per-source budget split.** Today: flat `source_text[:24000]`. Now: a total
   character budget split evenly across sources, with any unused share
   redistributed to sources that can use it, so one short website doesn't waste
   a slot. Each block is prefixed
   `=== SOURCE 2: "3Blue1Brown — Backpropagation" (youtube, 18:42) ===`, with the
   existing per-kind `[page N]` / `[mm:ss]` / `[section N]` tagging preserved
   *inside* each block.

`title_suggestion` (from an `<h1>` the prompt is asked to emit) lets a
multi-source session get a topic title instead of inheriting source #1's
filename. Applied only when the note title still equals its auto-assigned
default — never overwrites a title the user typed.

The note's initial title is the first source's title; multi-source sessions get
upgraded to `title_suggestion` when the draft lands.

## 6. Backend endpoints — `routers/note_sources.py`

```
POST   /sources                     multipart: file | url, optional note_id
                                    no note_id → create the note first
                                    → {note_id, source}; queues background processing
GET    /notes/{id}/sources          list + status polling
DELETE /sources/{sid}               detach + best-effort storage cleanup; note survives
GET    /sources/{sid}               detail incl. elements (+ signed image urls)
GET    /sources/{sid}/file          signed url for the viewer
POST   /sources/{sid}/reprocess
POST   /sources/{sid}/capture       {type: frame|clip|audio, start, end?} → {url}
POST   /sources/{sid}/formula-latex {element_id} → {latex}
POST   /notes/{id}/synthesize       {mode: replace|append} → background run
GET    /notes/{id}/synthesis        poll: {status, html?, source_ids, title_suggestion?, error?}
POST   /notes/{id}/synthesis/applied
PUT    /notes/{id}/anchors          replace note_anchors (unchanged contract)
GET    /notes/{id}/anchors
POST   /notes/{id}/chat             SSE, grounded in that note's sources
GET    /sessions/recent             notes with sources, for the empty shell (D2)
GET/POST/PATCH/DELETE /ai-providers unchanged
```

`POST /sources` creating the note when `note_id` is absent is the "no ceremony"
primitive from requirement 5 — the first drop is one request, not
create-then-attach. Auth stays `get_user_id(authorization)` per
`routers/ingest.py`. Ownership helpers: `_own_note(note_id, user_id)` replaces
`_own_workspace`; `_own_source` replaces `_own_resource`.

Frontend proxy: keep the existing generic `app/api/ws/[...path]/route.ts`
(JWT-forwarding, SSE passthrough, multipart passthrough — all proven); update its
path allowlist to `sources`, `notes`, `sessions`, `ai-providers`.

## 7. Frontend

### Deleted

`components/workspace/WorkspaceCanvas.tsx`, `ResourceCard.tsx`,
`NotePageCard.tsx`; `app/(brain)/brain/workspaces/page.tsx` and
`[workspaceId]/page.tsx`; the `@xyflow/react` dependency (verified used nowhere
else in the repo). `SplitView.tsx` is **dissolved, not deleted blindly** — its
editor host, `ingestHtml` handoff, anchor collection, and send-to-note bus move
into `NotePane.tsx` rather than being rewritten from scratch.

### Layout

```
┌ ← | Backprop, three ways ✎ | 3 sources | ⟳ Re-synthesize (4) | 💬 | ⋯ ┐
├──────────── sources + viewer (resizable, 45%) ─┬──── note ───────────┤
│ SOURCES                                  [+]  │ ## Why the chain     │
│ ● paper.pdf                    ready      ✕   │    rule shows up     │
│ ◐ 3B1B — backprop         processing          │ text text text…      │
│ ● en.wikipedia.org/…           ready      ✕   │                      │
│ ───────────────────────────────────────────── │ (ordinary            │
│ [ viewer for the selected source ]            │  BlockEditor —       │
│ 🖼 Frame  🎬 Clip  🎧 Audio  📍 Checkpoint     │  fully editable)     │
└───────────────────────────────────────────────┴──────────────────────┘
```

Left column default 45%, draggable divider, persisted to `localStorage` (a UI
preference, not server state). Source rail rows are compact (~28px): kind icon,
title, status dot, remove. Rail scrolls; the viewer takes the remaining height.
The chat is a **drawer over the note pane**, not a third column — a third column
in a compact layout leaves nothing readable.

### New components (`components/workspace/`)

| Component | Responsibility |
|---|---|
| `WorkspaceShell.tsx` | Layout + session state: sources, active source, note, synthesis status, chat open. Whole-shell drag-and-drop. Status polling (2s) while any source is queued/processing — same pattern the canvas used. |
| `SourceRail.tsx` | Source list, `[+]` add (file picker + inline URL paste), remove, retry on failed, select → viewer. |
| `SourceViewer.tsx` | Thin dispatcher onto the existing `viewers/*` by `kind`. Must stay `next/dynamic({ssr:false})` — react-pdf touches `DOMMatrix` at import time. |
| `NotePane.tsx` | Title, `BlockEditor`, autosave + debounced reindex, `ingestHtml` handoff, anchor registration, section chips, send-to-note bus. Absorbed from `SplitView.tsx`. |
| `DropZone.tsx` | Empty-state drop zone + recents strip (D2). |
| `useSynthesis.ts` | Poll `/synthesis`, apply html → blocks, replace/append prompt, "Re-synthesize (N)" state derived from `source_ids` vs current sources. |
| `WorkspaceChat.tsx` | Existing component, re-scoped to `noteId`, rendered as a drawer. Citation click → select that source + seek. |

`lib/workspace.ts`: types and API client rewritten (`WsResource` → `NoteSource`,
drop canvas fields, drop `Workspace`/`WsPage`, add `Synthesis`); keep
`fmtTime`/`anchorLabel`/`youtubeVideoId` as-is.

### Source colours

Each source gets a stable accent colour from its `order_index`, used in the rail,
the section chips, and the citation chips. With 4 sources in play "which source
is this from?" must be answerable at a glance, and a colour dot is cheaper than
repeating titles in every chip. Fixed palette, no per-source persistence.

### Section chips

Above the note pane, one per anchor, each carrying its source's colour dot plus
its anchor label (`12:30`, `p. 4`, `§7`). Clicking a chip whose source is not the
active one switches the viewer to that source first, then seeks and scrolls the
note. Forward sync (source position → highlight matching block) only follows
anchors belonging to the **active** source.

### Checkpoint block

`components/editor/customBlocks.tsx`: prop `workspaceId` → `noteId`; href
`/brain/workspaces/{workspaceId}?resource={rid}&…` →
`/brain/workspace/{noteId}?source={rid}&t=…`. A checkpoint with no `noteId`
(left behind by the clean slate) renders as a dead grey pill, not a broken link.
Deep-link handling moves to the shell: `?source=<id>&t=|p=|s=` selects that
source and seeks once the viewer is ready.

## 8. Error handling

| Failure | Behaviour |
|---|---|
| Extraction fails | Source `failed` + error in the rail + retry. Other sources unaffected; synthesis still runs on what succeeded. |
| Embedding fails | Warn, source still `ready`. Chat degraded for that source (existing behaviour). |
| Synthesis fails | `note_synthesis.status='failed'` + error. Note stays editable; banner offers retry. Never blocks the session. |
| No AI provider | Synthesis fails with a clear message pointing at Settings → AI Providers. Sources still viewable, capture still works. |
| All sources failed | No synthesis, empty note, per-source errors visible. |
| Note deleted | `ON DELETE CASCADE` clears sources, chunks, anchors, synthesis. |
| Source deleted after synthesis | Note keeps its blocks (it's the user's note now). Anchors for that resource cascade away; chips for it disappear. `source_ids` mismatch surfaces "Re-synthesize (N)". |
| Supabase transient disconnect | Existing `_with_retry` on status/meta writes; extend it to the `note_synthesis` terminal write for the same reason (synthesis sits behind a slow LLM call). |

## 9. Testing

Backend — `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/ -p asyncio`
(ROS Jazzy system pytest plugins break collection otherwise; `backend/venv` is
the test venv, `backend/.venv` is the runtime venv):

- `test_workspace_extractors.py` — untouched, must stay green.
- `test_workspaces_router.py` → `test_note_sources_router.py`: attach-without-note
  creates a note; attach to an existing note; status polling; detach keeps the
  note; capture rejects non-video kinds; synthesize endpoint queues.
- `test_workspace_chat.py` → note-scoped retrieval, RPC args, citation mapping,
  unknown-marker drop.
- `test_workspace_summary.py` → `test_note_synthesis.py`: every source header
  present; source-indexed anchor instruction present; budget split behaviour
  (even split, remainder redistribution); per-kind tagging preserved per block.
- **New** `test_synthesis_trigger.py`: the settle guard — no fire while a sibling
  is processing; fires exactly once on the last source; no refire when a
  synthesis row exists; no fire when the note has user content; `failed` siblings
  don't block.

Frontend: `npx tsc --noEmit` and `npm run build` clean.

Live/manual: rewrite `docs/workspace-manual-test-checklist.md` for the new flow
(drop 3 sources → single synthesized note → per-source viewers → capture →
checkpoints → chat citations across sources → re-synthesize replace/append).
Browser-driven UI/UX review is delegated to a Haiku subagent per the brief
(screenshot loops are image-heavy; the main model keeps design and code
decisions). `next dev` cold-compiling this route takes 30–60s on this machine —
not a hang.

## 10. Build order

1. Migration `013_note_sources.sql` (**user runs it manually — stop and ask**).
2. `prompts/note_synthesis.py` + `services/workspace/synthesis.py` + tests.
3. `processor.py` slim-down + settle trigger + tests.
4. `chat.py` re-scope + tests.
5. `routers/note_sources.py` + `main.py` + proxy allowlist + router tests.
6. `lib/workspace.ts` rewrite; delete canvas components, routes, `@xyflow/react`.
7. `NotePane.tsx` (absorb `SplitView`), `SourceRail`, `SourceViewer`, `DropZone`.
8. `WorkspaceShell.tsx` + both routes + sidebar entry.
9. `useSynthesis.ts` + re-synthesize UX; `WorkspaceChat` drawer re-scope.
10. Checkpoint block + deep links + dead-pill fallback.
11. Full test pass, browser pass with Haiku review, rewrite the manual checklist,
    update `STATUS.md`, `ANDROID_PARITY.md` #20, and the project memories.

## 11. Out of scope

Android (tracked as `ANDROID_PARITY.md` #20 — no build). No changes to the
classic ingest pipeline, the agent engine, MCP, or `ai_providers`. No
per-source summaries in any form. No canvas mode, not even optional.
