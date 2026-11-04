# AI source tools: let the AI insert what the source viewer can insert

Status: **steps 1–4 and 6 built 2026-11-04; step 5 partly** (diagnosis 2026-11-03).

### What was built (2026-11-04)

- Migration `034_element_text.sql` (`description`, `latex`, `described_at`). Code that
  writes them is best-effort, so it runs before the migration too (it just re-reads).
- `backend/services/agent/source_tools.py`: all ten tools in §1. Offered in the workspace
  panel only, scoped to the notes that passed the privacy gate. Tiers in `permissions.py`.
- Added after the first live test: `workspace.search_source` (read-only). The excerpts are
  only a few retrieved passages and `find_elements` has nothing for a video, so the AI had
  no way to read a transcript to quote it; it spent all 5 rounds on `brain.search_brain`.
- Decisions on the open questions:
  - **Token records** ride on the stream (`source_insert` event, kept on the chat message
    like citations). No table. A reloaded thread loses them, as it loses citations.
  - **Describe lazily**: `look_at` writes and saves the description on first use.
  - **Capture tier**: `INTERNAL_API`, no Confirm (the user asked for it); one capture per turn.
  - **Clip cap**: 120 s.
  - **`look_at` returns text**: a separate vision call under the note's privacy level, so
    tool results never need image parts (works on every provider).
- Excerpts carry `src=<8 chars>`; a source is found by full id or that prefix.
- `formula-latex` reads saved LaTeX first and saves a new reading.
- Frontend: `lib/sourceInserts.ts` (record → blocks, chat preview), `lib/embeddedBlocks.ts`
  (`<div data-sb-blocks>`: blocks carried in draft HTML, restored after BlockNote parses it,
  in both the replace and append paths), `answerToHtml` turns tokens into blocks and `[n]`
  into a pill after the paragraph that cites it.
- `note_html.py` keeps `<video>`/`<audio>` and reads `data-sb-blocks` too.
- `mcp_remote`: read-only `list_note_sources` and `find_source_elements`.
- CLAUDE.md rule + `test_every_send_to_note_button_has_an_ai_tool`.

### Not built

- **Synthesis / chaptered / job placeholders** (`[[FIGURE p7]]` resolved on the server) and
  the `FIGURE_EXTENSION` / `note-author` prompt changes: these are the study-guide prompt,
  which only the user edits. The resolver can emit `<div data-sb-blocks>`, which both the
  editor and `note_html.py` already read.
- Insert tools in `mcp_remote` (external apps write markdown; they have no Insert step).
- Cleanup of captures the user never inserts (`{user}/{resource}/captures/`).
- Manual check on a real lecture PDF and a YouTube source.

## The problem

The source viewer has buttons that put things from a source into the note: quotes with a
page pill, tables, formulas (as LaTeX), PDF figures, video frames, clips, audio and
checkpoints. The AI can do none of these. Asking the workspace AI panel to "put the
diagram from page 7 in my note" or "add the frame at 12:30" cannot work.

This is not one missing tool. The features were built UI-first (button → REST endpoint →
editor), and the AI's tools are separate hand-written lists that were never extended.

### How the buttons work today (this part works)

- Viewers call `wsApi.*` in `frontend/lib/workspace.ts`:
  - `capture(sid, "frame"|"clip"|"audio", start, end)` → `POST /sources/{id}/capture`
    (`backend/routers/note_sources.py:513`) → `services/workspace/media.py:74`
    (ffmpeg, yt-dlp for YouTube; Render has both). Returns `{path, url, mime}`, URL signed
    for 10 years.
  - `formulaLatex(sid, elementId)` → `POST /sources/{id}/formula-latex` → vision OCR.
- PDF elements (`text|heading|image|table|formula`) are extracted into `resource_elements`
  (`services/workspace/pdf_elements.py`); crops in `image_path`, tables as markdown in
  `content`. `GET /sources/{id}` signs crop URLs for **1 hour** (`note_sources.py:476`).
- The viewer emits an action; `NotePane.tsx:355` (`handleAction`) turns it into blocks:
  `text` → quote + `checkpoint` pill (`sendBlocks.ts: textBlocks`), `image`, `table`,
  `latex` → `math`, `checkpoint`, `clip` → `video`, `audio` → `audio`;
  then `insertBlocksAtCursor`.

### The AI surfaces, and why none of them can do it

| AI | Tools / code | Why it can't insert source content |
|---|---|---|
| Workspace AI panel (main one) | `services/agent/engine.py` + `brain_tools.py` | Only `brain.*` tools (notes, links, databases), `workspace.run_job`, `skill.load`, memory, MCP. `WORKSPACE_NOTICE` forbids writing the open note by tool ("write it in your reply; the user inserts it"), so the only output path is reply text. |
| Note generation + jobs | `services/workspace/synthesis.py`, `chaptered.py`, `skill_run.py` | Figures reach the model only if `workspace_synthesis_vision` (default False, `core/config.py:75`) or the source has no text; then as bytes with no address. `prompts/note_synthesis.py` `FIGURE_EXTENSION` says *describe* figures. Video sources: no figures at all. |
| External apps | `mcp_remote/server.py` | Notes as markdown text only. |
| Editor AI | `/agent/inline` (BlockNote xl-ai) | Rewrites text only. Out of scope. |

### What else blocks it (things a tool alone would not fix)

1. **No source IDs in context.** `<sources>` excerpts are `[n] (title, t=12:30) text`
   (`services/workspace/chat.py:142`). The AI cannot name a source to act on.
2. **No element inventory.** The AI never sees which figures/tables/formulas are on a page.
3. **The reply → note path drops media.** `frontend/lib/answerToHtml.tsx` renders markdown
   with ReactMarkdown without raw HTML, so `<video>`/`<audio>` vanish; images only survive
   if the model copies a ~300-character signed URL exactly (models often damage them).
   **Rule: the AI never handles URLs; it handles tokens/IDs.**
4. **Citations lose their link on insert.** `resolveCitations` turns `[1]` into plain text
   "(Lecture 10, p. 3)". The note can't jump back. It should become a `checkpoint` pill,
   like "Send to note" makes.
5. **Formula LaTeX is never saved.** `formula-latex` re-runs vision OCR on every click.
6. **Backend HTML converter drops video/audio.** `services/note_html.py` handles `<img>`
   (line 361) but not `<video>`/`<audio>`, so `brain.create_note`/`update_note` lose them.
7. **Crop links expire** (1 h). Anything the AI inserts must use the long-lived form
   (the editor's `freshFileUrl` only patches what it shows).
8. **Prompts forbid or ignore it:** `WORKSPACE_NOTICE`, `FIGURE_EXTENSION`,
   `skills/note-author.md`, `_HTML_HELP` in `brain_tools.py`.

## Design

### 1. One shared toolkit for every source → note action

One module (e.g. `backend/services/agent/source_tools.py`) holding schemas + implementations,
used by the engine (workspace surface), and later by `mcp_remote`. Mirror every viewer button.

| Tool | Gives / inserts | Built on |
|---|---|---|
| `workspace.list_sources` | IDs, title, kind, pages or duration, figure/table/formula counts | `note_resources` of the open note (+ session notes) |
| `workspace.find_elements(source_id, page?, type?)` | elements as **text** (see §2): headings, tables (md), formulas (LaTeX), figures (description) | `resource_elements` |
| `workspace.insert_quote(source_id, page\|time, text)` | quote + jump-back pill | `textBlocks` |
| `[n]` citation markers on insert | `checkpoint` pill instead of plain text | `checkpoint` block |
| `workspace.insert_formula(element_id)` | `math` block | saved LaTeX; OCR once if missing |
| `workspace.insert_table(element_id)` | `table` block | stored markdown → `markdownTableToBlock` |
| `workspace.insert_figure(element_id)` | `image` block (+ page pill) | stored crop, long-lived signed URL |
| `workspace.capture_frame(source_id, at)` | `image` (+ time pill) | `media.capture("frame")` |
| `workspace.capture_clip(source_id, start, end)` | `video` | `media.capture("clip")`, **length cap** (e.g. ≤ 120 s) |
| `workspace.capture_audio(source_id, start, end)` | `audio` | `media.capture("audio")`, same cap |
| `workspace.look_at(element_id \| source_id+time)` | pixels to the model, gated (§2) | `figures._downscale` |

**Tokens, not URLs.** Every insert tool stores a small record (kind, url/path, caption,
source_id, anchor type + value, latex/markdown) and returns a short token such as
`[[src:7f3a]]` plus a one-line summary. The AI places the token in its reply.

**One resolver** turns tokens into blocks:
- Frontend: in the panel's Insert path (`Chat.tsx` `insertAnswer` → `answerToHtml` →
  `deliver`) and in the chat bubble preview (show the image/clip, not the token).
- Backend: for synthesis / chaptered / jobs output, where the model writes placeholders
  (`[[FIGURE p7]]`, `[[FRAME 12:30]]`, `[[FORMULA el:…]]`) and the server swaps in the real
  thing after generation.
- Add `<video>`/`<audio>` to `note_html.py` so the brain tools keep them too.

Where to keep token records: a JSON field on the turn / AI output (no migration), or a
small table (migration). Decide when building.

### 2. Text first, pixels only when needed

Evidence already in the repo (`core/config.py:67`): on the reference lecture, sending figures
added nothing the text lacked and lowered rule compliance (10/10 → 4/5 runs). Pixels cost
~1,000 tokens each, need a vision provider, and some privacy levels forbid them. So the AI
gets a **text version** of every element by default:

| Element | Text version | Cost |
|---|---|---|
| Table | markdown (already stored) | free |
| Formula | LaTeX, OCR'd once and saved | one vision call, ever |
| Video frame | transcript lines around that time (already stored) | free |
| Figure | 1–3 sentence description, written once and saved | one vision call per figure, ever |

Pixels go to the model only when:
1. the user asks about that specific figure / moment;
2. a figure is likely informative and has no description yet (logos and page furniture are
   dropped by the existing `figures.py` filter: dedupe, `FURNITURE_PAGES`, `MIN_EDGE`,
   `MIN_STDDEV`);
3. the source is scanned (no text at all; already the case today);
4. the AI calls `look_at`. Gated by `budget_guard`, privacy (`services/privacy.py`, same check
   as `formula_to_latex`), and a vision-capable provider; **saves a description as a side
   effect**, so each figure is looked at at most once.

Describing can be lazy (on first `find_elements` / `look_at`) or a background step after
extraction. Lazy is cheaper; start there.

### Cross-cutting rules for every new tool

- Privacy: withheld sources/notes stay withheld; same scope the engine already applies.
- Permission tier (`services/agent/permissions.py`): read tools free; capture creates files
  and costs time, decide its tier.
- Cost/time: yt-dlp + ffmpeg can take up to 300 s on Render free; cap clip length, one
  capture at a time per turn.
- Storage: captures the user never inserts should be cleaned up (they live under
  `{user}/{resource}/captures/`).
- Never write the open note by tool; everything goes through the reply + Insert path.

### Process fix

Add to `CLAUDE.md`: any button that puts something into a note also gets a tool in the shared
toolkit. Optionally a test that lists `NotePane.handleAction` action types and fails when one
has no tool.

## Build order

1. **Migration `034_element_text.sql`**: `ALTER TABLE resource_elements ADD COLUMN IF NOT
   EXISTS description TEXT, ADD COLUMN IF NOT EXISTS latex TEXT` (+ optional
   `described_at TIMESTAMPTZ`); end with `NOTIFY pgrst, 'reload schema';`. Run it in the
   Supabase SQL editor **before** pushing code that uses it. Then: save LaTeX in
   `formula-latex`; `list_sources` + `find_elements`; add source IDs to the excerpts.
2. **Insert tools + token resolver + citation pills** in the workspace panel
   (quote, citation, formula, table, figure).
3. **Capture tools** (frame / clip / audio) with the length cap.
4. **`look_at`** with the §2 rules. First check that tool results can carry image parts on
   every provider in `services/ai/client.py` (message image parts are supported; tool-result
   images are not confirmed).
5. **Synthesis / chaptered / jobs placeholders** + prompt updates (`WORKSPACE_NOTICE`,
   `FIGURE_EXTENSION`, `note-author` skill, `_HTML_HELP`), `<video>`/`<audio>` in
   `note_html.py`.
6. **Same tools in `mcp_remote`** for external apps.

## Tests to add

- Backend: each tool's schema + dispatch; privacy withholding; clip cap; LaTeX saved and
  reused (no second OCR); `note_html` keeps `<video>`/`<audio>`; placeholder resolver.
- Frontend: token → block for every kind; `[n]` → checkpoint pill on insert; chat preview.
- Manual: on a real lecture PDF and a YouTube source, ask the panel for a figure, a formula,
  a table, a quote, a frame and a clip; insert each; undo; delete the captures created.

## Open questions

- Token records: JSON on the AI output vs a table.
- Describe figures lazily or right after extraction.
- Permission tier for capture tools.
- Clip length cap value.
