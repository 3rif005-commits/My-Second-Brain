# Second Brain — Project Status

> Source of truth across all conversations. Read at session start, update at session end.
> Last updated: 2026-10-24

---

## Next (ranked — pick from the top)

| # | What | Why first |
|---|------|-----------|
| 1 | Every database query from Render to Supabase takes ~180 ms (measured with the CSV import's Server-Timing header); a simple database list takes ~1 s. Likely the two services are in different regions (`render.yaml` sets no region, so Render's default, Oregon). Check the Supabase project's region; co-locating would speed up every database page | the whole app, not one feature |
| 2 | Settings at phone width not re-checked after the settings rework (Chrome wouldn't resize); Connected apps has no "how to connect" text because the app's own MCP server isn't deployed with Render | small |
| 3 | Editor AI: one Revert (after Simplify) left stray letters in the paragraph ("foronr"); two later Simplify/Fix-spelling reverts restored the text exactly. Watch for it; if it recurs, check xl-ai's revert with large rewrites | couldn't reproduce |

**Settings pass 2026-10-24 (live, dark mode):** every kit dropdown opened behind the Settings
window (Popover z-50 vs z-60; now z-10000). MCP: URL servers only spoke SSE at URL+"/sse", so
current (Streamable HTTP) servers never connected; the trust level was never enforced (now "Ask me
first" asks per tool call); stdio ran commands on the server (now refused where RENDER is set);
page rebuilt on the kit with live status per server. Notion page on the kit: destination picker is
a radio list with a "pick one" prompt; backup is a download on the hosted server. Routing/Schedules
headings consistent. Chat: Confirm no longer repeats the question. Live-checked: DeepWiki via chat
(asked first, answered), Send to Notion (heading/bold/code/bullets/code block arrived). Test note and
its Notion page are in the two Trashes; the Notion destination is SB-TEST-root until the user picks theirs.

**Done 2026-10-24:** connected-apps Markdown now goes through `services/note_html` (bold, links,
code, tables, task lists kept; 63f40af4). CSV import writes every row in one statement
(`create_rows_bulk`, 63491405): live, 3 rows 6.8 s → 4.8 s, 300 rows 6.9 s (was ~1,200 queries,
would have timed out); the 20 queries left are database/column setup. Full backend suite run
against the local Postgres harness (`docker start sb-pgtest`): 2,870 passed, 0 errors.

**Code block + interactive block, Notion-style (2026-10-24):** code block: Shiki colours (Notion's
Prism colours, light/dark), hover pill (language menu with search, Copy, Wrap), Notion's box geometry
(8px inset, text 36px/22px in). Interactive block rebuilt on Notion's **Mermaid code block**,
measured live in Notion (UI Reference page, test blocks removed): one box in the code-block fill,
views Code / Preview / Split per block (props `view`, `wrap`), code edited in place (saves after
600 ms), pill Ask AI | view | Expand | Download | Copy | Wrap | ⋯ (Caption, Copy code, Wrap toggle,
Save as image, Delete), Expand lightbox, caption. Content follows light/dark: frame page transparent
with `--sb-*` colours, Mermaid dark/default theme like Notion; AI skill writes with those colours.
Blocks may load libraries from jsDelivr, cdnjs, unpkg, esm.sh (user's choice). Live-checked on the
deployed site in a throwaway note (now in Trash): split/preview/expand geometry equal to Notion's
(box 228 / diagram 164), AI quiz in dark mode, no inner scrollbar. Then: Notion's side resize bars
(prop `width`, share of the column, centred; real mouse drag + reload checked live) and light mode
measured in Notion (user-approved, theme restored to Dark): Mermaid "neutral" theme, Mermaid arrows
as operators. An AI reply in words is shown as a message instead of replacing the block. Light mode
of our own app not checked live (switching it is the user's setting; covered by unit tests).

Live check 2026-10-23 (older features on the deployed site): see "Live check of older features" below.

---

## Live check of older features — 2026-10-23

Fixed and re-verified on the deployed site:
- **Privacy:** the `local` provider fell back to OpenRouter on a server with no local model; private
  notes are allowed to reach `local`, so with an OpenRouter key set they'd have gone to a cloud.
  Now `LocalModelUnavailable` with a plain message (1725a142).
- **CSV import:** select cells showed option ids ("UE1lkFAU") — importer stored ids, the app reads
  names (236e99c8); import answered after indexing every row (31 s for 5 rows) — now indexes after
  the response (5789ba9f, NameError fixed in de5c32c6, which a no-Postgres endpoint test now covers).
- **AI ingest** saved an empty note: the permission gate held `brain.update_note` (untrusted source
  text) and the dialog can't approve; the route now pre-approves writes to its own new note only
  (bbe2c2fa). Content now arrives, but see Next #1.

Worked: chat answer + citation jump; all settings pages (no console errors); routing test (Fast);
database filter / sort / board view.

**Follow-up the same day (all live-checked on the deployed site):**
- AI-written notes: `brain.create_note`/`update_note` take `html`; `services/note_html.py` converts it
  server-side to the exact block shapes BlockNote 0.48's own parser makes (checked against it), and
  normalizes hand-written blocks. Live: chat-created note has callout, H2, collapsible H3, rendered
  formula, table; no "Unsupported block", no empty heading (52903222).
- Trash lists database rows ("A1 in sb-test-db2") and deleted databases ("Database", restore-only);
  live restore → back in the Databases list → re-deleted (e43d41c2).
- Editor AI runs on the user's Fast slot; Anthropic through a native Messages-API bridge
  (`services/ai/openai_bridge.py`). Live: Simplify / Fix spelling on Claude Haiku → suggestion with
  Accept/Revert (cd35e124).
- Small ones fixed: one skill chip per answer, one-line chat placeholder, filter builder at md width,
  "Loading rows…" spinner, routing pane sideways scroll (sticky Save bar's negative margins).

Noted earlier (small, now fixed except CSV speed): chat box placeholder wraps (shows "notes…"); settings pane scrolls
sideways after Test; filter popover too narrow ("To read" cut off); a database shows an empty table
(no spinner) while rows load; CSV import still ~7 s for 3 rows; three "Loaded skill" chips on every
chat answer (the assistant rules load each turn). Two test chat conversations left for the user to
delete (deleting is permanent).

---

## New note from a session — 2026-10-26

- The + on a pane (and Ctrl+K) has a **New note** button beside its search box and a "New note" row
  (named what you typed; Alt+Enter opens it beside). It POSTs `/api/notes` and opens the empty note as
  a tab, written in like any other brought-in note. Not live-checked yet.

## Floating note in a session — 2026-10-26 (deployed; checked on the live site)

- A note or source tab (a YouTube video beside your note) can float. On the shown tab only ⇄ shows;
  pointing at it slides float out to its left, as the AI panel's dock switch does. A seek or citation
  to a floating source plays it there. Live-checked with the YouTube source.
- **Several windows can float at once (max 4, `MAX_FLOAT`)**, each a step down/right of the last, a click
  brings one to the front; a fifth sends the oldest back to the pane the new one left. Each window's
  position is kept per tab (`workspace:float:<tab>`). A layout saved with one floating tab still loads.
- The float button lifts the tab into a window over the panes: move by
  its bar, size from any edge/corner, ⇲ or double-click the bar puts it back in the pane you're in.
  Clicking in it makes it the writing target. Logic in
  `sessionLayout.ts` (`floatTab`/`dockFloat`/`focusFloat`, `floating` saved with the layout), window
  in `FloatingTab.tsx`, position per device in `workspace:note-float`.
- Fixed with it: a note moved to another pane re-mounted its editor with the content it opened with;
  moves now hand it what the editor holds (`NoteApplyApi.document()`).
- Live-checked: float, move, swap (content intact), double-click dock. Not checked: resize edges, a
  capture/AI insert landing in the floating note.

## AI panel as its own window + faster source uploads — 2026-10-25 (deployed; checked on the live site)

- **Restyle to the workspace's look** (live-checked right, bottom, float): panel on `bg-surface` with a
  hairline edge (was the lighter chip grey); your messages in a grey bubble, answers as plain text
  with a small accent mark (no blue bubble, no card); composer card with the app's border and focus
  ring; menus on the app's menu surface; new chat = short lead + three starting points that only
  fill the input. Shown chat tab never shrinks; the floating window now stays wholly on screen.
- **Sizing pass** (live-checked right + bottom): one header row (history moved into the tab row,
  `+` replaces the chat's own new-thread button; e2e helpers now click "New chat tab"). Docked right
  the tab row is 44 px, level with the session header. Docked bottom: 768 px centred column,
  one-line empty state, no hint line, default 300 / min 220 px (180 left a sliver). Past
  conversations: opaque, a 360 px side sheet at the bottom. Tabs not shown (pane + AI) no longer
  reserve room for their hover buttons, so a narrow pane shows words, not one letter.
- **AI panel** (`components/ai/SidePanel.tsx`, tabs logic in `panelTabs.ts`): no longer a tab inside a
  session pane. It is the app's one panel on every page, docked **right** (full height) or **bottom**
  (full width, under every pane); the switch is in its tab bar, side/width/height are remembered.
  Up to 8 conversation tabs, each a live Chat kept mounted (a running answer survives switching tabs).
  Editor jobs and "Ask AI" on a selection go to the tab shown when they arrive. Old saved layouts drop
  their Ask tab. Live-checked: right ↔ bottom, survives reload, + opens tabs, × closes them.
  **Float** (third option): a window over the page, moved by its tab bar, sized from any edge or
  corner, double-click the bar to dock; position remembered (`ai-panel-float`) and kept on screen.
  Opaque background (the docked tint let a video show through). Phones always get the right sheet.
  Not checked live: sending in two tabs at once. On a 921 px window the right dock leaves room for one
  pane; the bottom dock keeps two.
- **Video capture tools** (`viewers/CaptureDock.tsx`): the bar under the player is gone. A vertical
  glass rail centred on the media's right edge slides in when the pointer reaches that edge (a YouTube
  iframe hides hover everywhere else), stays while recording/capturing, hides ~0.7 s after leaving,
  leaves a pull-tab, and shows for 2.5 s when a video opens. Labels + keys open to the left of each
  button; an open range is a REC badge (running length, range, Discard) top-right under the player's
  title row. Look: `.ws-media-glass` (globals.css) for anything floating over media. Live-checked: shows,
  hides, hover labels, shortcut card, REC badge (opened with V, discarded with Esc).
  Not checked live: a real capture through the rail.
- **Source uploads**: the browser writes straight into the user's Storage folder (owner-write policy,
  migration 012) with no backend round trip first, all files upload in parallel, and a cheap request
  wakes Render meanwhile. Fallback: the old signed-link route. Not timed live.

## Workspace: any tab on either side — 2026-10-25 (deployed; checked on the live site)

Design: the "Next" row of https://claude.ai/artifact/CuAxsUrEqB5J62BP7N9ML6. A session is a topic:
its own note (owns the sources) plus other notes and sources brought in beside it.

- Up to 3 panes (2 at 921 px, 1 when narrow), each a row of tabs; any tab (source, note, Ask AI)
  goes in any pane: drag it, or ⇄; × closes (stays in the session). Logic: `sessionLayout.ts`
  (16 unit tests). Layout remembered per session in localStorage (`workspace:tabs:<note>`).
- One picker: + on a pane or Ctrl+K in a session (Ctrl+P stays app-wide search) — this session's
  closed items, your notes, sources in other notes (`GET /library/sources`), upload/link.
  Enter = here, Alt+Enter = beside.
- Writing target = the note last worked in (pen on its tab). Add to note, captures and AI inserts
  go there and name it ("Add to …", "Insert into …"); a hidden target gets a toast.
- The AI reads every note and source in the session: one search per note, plus brought-in notes'
  own text; each passage passes the privacy gate under its own note's level (no migration).
  A citation to a note opens it.
- Start page: "Continue a note…" (any note); every note page shows Open in workspace.

Checked live: default layout, picker (all four groups), opening an old note, ⇄ two notes side by
side, "Add to sb-test-old-note" landing in the hidden target (saved), pen moving on click, Ask AI
docked beside the note answering from the old note with a citation that opens it, layout restored
after reload, a PDF from another note opened beside. Found + fixed live: the /api/ws proxy
blocked /library; tabs overflowed a 460 px pane. Not checked: drag-and-drop of tabs (⇄ used),
the 3-pane maximised layout, narrow one-pane mode with this build, light mode.
Test notes sb-test-photosynthesis and sb-test-old-note moved to Trash.

---

## Workspace redesign — 2026-10-25 (deployed; checked on the live site)

Design: https://claude.ai/artifact/CuAxsUrEqB5J62BP7N9ML6 (review of the old shell, research
notes, mockups at the user's real 921 × 649 window). Approved with "Build it".

- **Two panes that fit**: the source on the left (its sources as tabs, + to add, × to remove),
  **Note** and **Ask AI** as tabs on the right. The app's one AI panel docks over the Ask tab
  (the same always-mounted panel: jobs and the conversation survive switching), so opening the
  AI no longer hides the source or cuts the note. ⌘J lands on the Ask tab.
- Full screen (≥1180 px for the shell): Note and Ask side by side. Narrow (<700 px): one pane,
  Source / Note / Ask. The app sidebar starts hidden in a session (remembered apart).
- PDFs fit the pane's width; toolbar with page counter, prev/next, zoom, Mark page.
- Selecting text: **Add to note · Ask AI** (prefills the question with the passage and page).
- Video: an always-visible capture bar (Mark · Frame · Clip · Audio), icons only below 600 px;
  Clip/Audio become End clip/End audio in place while a range is open.
- Empty note: Write a study guide / Make flashcards (real price from the job estimate) /
  Start writing. Anchored headings get a source-coloured dot in the margin instead of the
  "Jump to §2 §2" bar. ⋯ menu: open as page, "When I add a source here".

Checked live: docking in all three layouts, ⌘J, narrow switching, PDF fit + selection menu
(prefill only, nothing sent), a clip through the new bar. Not checked: light mode, a YouTube
source with the new bar, a real phone. Test session "sb-test-capture" moved to Trash.

---

## Workspace: last unchecked flows, live on the deployed site — 2026-10-25

Checked in Chrome on Vercel + Render (no local stack): **a 3-file drop** (2 Markdown + 1 video)
→ one note, all three read; **frame, clip (4 s) and audio (3 s) capture** from an uploaded video,
by button and by shortcut; **AI insert into a note that already has content** (the old "append
branch"; synthesis is now run from the AI panel). Found and fixed, each re-checked live:

- **Insert replaced a note holding only captures**: "is it empty?" read plain text, and frames,
  clips and audio have none. Now judged by blocks (workspace and the ordinary note page).
  Undo also drops the removed draft's Jump-to chips.
- **Every Jump-to chip read "§0"** for Markdown/Word/website sources: the text the AI read was
  rebuilt from 1,500-char chunks with one section tag per chunk. Now one tag per section; chips
  count from 1.
- **Headings never had Notion's sizes** (H1 48 px on a 39 px line, so wrapped titles overlapped;
  H2 32 px): BlockNote's `font-size: var(--level)` outranked ours. Now 30/24/20 px.
- The capture dock's End-clip button moved out from under the cursor when a range opened; a
  stale "the note gets written once every source is in" message.

Not fixed: with the sidebar and AI panel both open in a ~920 px window, the workspace has
291 px for 376 px of content, and a jump can scroll its header sideways out of view.
Test note "sb-test-photosynthesis" moved to Trash.

---

## ArtCraft study build — 2026-10-22 (deployed; core flows live-checked on the deployed site)

Study + plan: `docs/artcraft-study/FINDINGS.md`, `SHORTLIST.md` (build list with per-item state).
**Pushed to `main` and deployed 2026-10-22** (Vercel + Render); checked on the live site the same evening. Tests: frontend 1,371 pass (full suite); full backend suite 2,372 passed,
0 failed (449 errors = no local test Postgres, expected). No setting or panel was added: the UI additions are two menu items
(Present, Export as LaTeX), a ⤓ button on live blocks, a collapsed Transcript (or Chapters) row under
videos, a one-line warning under a live block that tries to reach the network, a yellow tint on
quoted PDF passages, and page actions listed in quick find (⌘P).

| Item | Verified | Not verified |
|------|----------|--------------|
| Never lose an edit (failed saves kept, retried, restored) | 12 unit tests; **live (deployed)**: saves forced to fail → "Not saved — retrying" + browser copy; reload → line restored, saved to server, copy dropped | — |
| Fast big PDFs (only near pages drawn) | unit tests; **live 2026-10-23**: 300-page PDF ready in seconds on the locked build; jumping to the middle/end draws only pages 148–154 / 297–300 | — |
| PDF bookmarks → chapters | real file: 10 bookmarks → 10 headings; Lect10 unchanged | — |
| Word/PowerPoint/Excel in Workspace | 14 tests; 6 real files (FR/AR); **live (deployed)**: .docx (table, equation → LaTeX, FR/AR), .pptx (FR/AR), .xlsx all upload and show | equation shows as raw `$…$` in the source viewer |
| Send to note keeps the page | unit tests; **live (local + deployed)**: quote + one "📍 p. 1" pill land in the note; PDF tint shows; source opens in ~2 s on Render; **pill jump live 2026-10-23** (p. 150 from page 1, and a cold `?p=220` link). Found + fixed: it opened page 1 (seek before the PDF loaded; deep-link timer killed by its own effect) and a second tab (tiptap opened every `<a>`) | — |
| Live block basics (auto-height, edit in place) | unit tests; **live (deployed)**: inserted from the slash menu, Code → Apply | a little empty space under short diagrams |
| Live block: Mermaid, 3D, export, CSP | **live (deployed)**: Mermaid renders from the pinned CDN; ⤓ saved a correct SVG; 3D renders. Found + fixed: cube cut off (camera now fits the bounding sphere) | a model with no material renders black on unlit faces (glTF default is metallic) |
| Drop .glb/.stl → 3D block | **live (deployed)**: .glb drop → upload → 3D block. Found + fixed: "Drop to add sources" stuck after the drop. Model links are 10-year signed URLs stored in the note | — |
| Word equations → LaTeX | real lab sheet: 20/20 (12 in tables) | — |
| Video transcript + creator chapters | unit tests | real YouTube (yt-dlp chapters) |
| Present a note as slides | unit tests; **live (deployed)**: opened from ⌘P on Lecture 10, arrows + G overview work | — |
| Photo of a diagram → Mermaid | **live (deployed)**: dropped photo → correct Mermaid (Haiku). Found + fixed: the drop also reached the page ("Unsupported file type .png") | — |
| Subtitles (.srt/.vtt) | **live (deployed)**: .srt + .mp4 of the same name → transcript from the subtitles | — |
| Scanned PDF pages → vision | **live (deployed)**: image-only PDF → page read, embedded; chat answer cites it and opens it | — |
| Export as LaTeX | unit tests; **live (deployed)**: downloads, live blocks as placeholders. Markdown export: found + fixed (live blocks exported their toolbar text) | compiling (no TeX here); Export as PDF (opens the print dialog — check by hand) |
| Speaker labels | **live (deployed)**: two synthetic voices A/B/A/B → "Speaker 1/2/1/2" (numpy works on Render) | a real recording |
| Quoted passages tinted in the PDF (read from the note, no migration) | **live in Chrome 2026-10-22**: Send to note → tint exactly over the line; quote deleted → tint gone. Found + fixed: pill read "p. 1 p. 1" | — |
| Overlong slide continues on a "(cont.)" slide | unit tests; **live (deployed)**: Lecture 10 → 9 slides, "Reinforcement Learning (cont.)" + 4× "Q-Learning (cont.)" in the G overview (label shows there, not on the slide) | — |
| Uploaded video's own chapter marks, with pictures | real ffmpeg file; **live (deployed)**: uploaded 8 s video with 2 chapters → Chapters row with 2 pictures (Render has ffmpeg); clicking a chapter seeks | a long real video |
| ⌘P lists and runs page actions (`lib/commands.ts`) | unit + quick-find test; **live (deployed)**: "latex" → Export as LaTeX listed; "present" → runs Present | running an export (downloads a file) |
| `llama.sh setup` checks models against Hugging Face's sha256 | run here: embed model matches; **your Gemma file is 1,760 bytes short of the published one** (older upload or damaged) | — |
| Notion parity floor (`docs/ui-audit/parity-floor.json`), eval slowdown rule, `docs/editor-behaviour.md` | unit tests | parity.mjs not re-run (needs a browser) |

**Found on the deployed site and fixed (2026-10-22):** a missing session spun forever; photo drop
leaked to the page; drop highlight stuck; 3D cube cut off; Markdown export wrote toolbar text;
**a source being processed when Render restarts stayed "processing" forever** (now resumed at
startup, gives up after 2 restarts; `render.yaml` build filter so frontend pushes don't restart
Render — if the service isn't Blueprint-synced, set the same filter in the Render dashboard);
**Gemini embeddings were one request per chunk** (now 100 per request).

**Fixed 2026-10-23: uploads over 4.5 MB failed on the deployed site** (413, Vercel's function
body limit). Files now go straight from the browser to Supabase Storage through a one-time signed
link (`POST /sources/upload-url`), then `POST /sources` registers the `upload_path` (25452ce1).
Live-checked: a 7 MB PDF attached and reached "ready" (test session moved to Trash). Storage's
project limit (50 MB on the free plan) is now the cap. 3D model drops take the same route
(`/notes/{id}/model-upload-url`, 1165e838): live-checked with a 6 MB .glb dropped into a test
note: link → Storage → registered, cube rendered (note moved to Trash).

**2026-10-23, also done:** backend versions locked (`backend/requirements.lock`, every package exact;
Render installs with `-c requirements.lock`, live). Polish, each checked on the deployed site: Word
equations render (KaTeX) in the source viewer; live blocks fit their content (a two-node diagram
106 px, no inner scrollbar on 3D); material-less glTF no longer black (RoomEnvironment). Still by
hand: Export as PDF (print dialog). Test sessions to empty from Trash: sb-test-deploy-check,
sb-test-office, sb-test-upload, sb-test-model, sb-test-big.

**Fixed 2026-10-23: a 300-page PDF never finished on Render.** Render's logs and events showed
"Ran out of memory (used over 512MB)". The unpinned `pymupdf>=1.24` had started installing
PyMuPDF 2.0, which brings an AI layout model (onnxruntime + pymupdf_layout): 146 → 333 MB peak and
~40× slower per page. Pinned `<2` (b4d91c35); the same 300-page file now goes from download to
ready in ~22 s on Render. The logs also showed the startup resume crashing every boot: it wrote
status "error", which the table's check constraint rejects. It now writes "failed".
Both test sources sit in the trashed "sb-test-office" note.

**How to check (run when the laptop is otherwise idle — live browser runs crashed Claude's
session three times):**

```bash
# unit tests for everything above (no browser)
cd frontend && npx tsc --noEmit && npx vitest run lib components
cd ../backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/python -m pytest tests/test_office_extract.py tests/test_pdf_bookmarks.py tests/test_scanned_pdf.py tests/test_speakers.py -q
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/test_live_block.py tests/test_subtitles.py tests/test_video_transcript.py tests/test_note_sources_router.py -p asyncio -q

# the one live e2e (creates and deletes its own "SB-TEST" note)
./app.sh start            # from the repo root; first /brain compile takes 2+ min
cd frontend && npx playwright test --project=unsaved-edits-live
```

By hand in the app: drop a .docx/.pptx/.xlsx and a long PDF into a workspace; select PDF text
→ Send to note; add a live block and ask for "a flowchart of photosynthesis" and "a 3D model
of a cell"; press ⤓; drop a .glb file into a note; ⋯ → Present (try a page with a very long
section); ⋯ → Export as LaTeX; ⌘P and type "latex"; after Send to note, look for the tint on
the PDF passage, delete the quote and see it go; upload a video that has chapter marks.

---

## Current Phase

**Phase 5 — Web App Polish (AI Substrate + Workspaces + Notion Databases)** `[🔧 IN PROGRESS]`

Since 2026-05-17, active work has been on the web app's AI layer rather than Android:
AI Substrate Phase 1 (agent engine, skills, brain tools), the Workspaces feature
(rebuilt 2026-07-30 as a compact single-note shell, replacing the original
canvas UX), MCP client support (agent calling external MCP servers),
inline-editor AI fixes, and — the largest feature in this phase — a full-parity
Notion Databases clone (15 milestones, CODE COMPLETE as of 2026-08-25, see its
dated section below) — all CODE COMPLETE, see their dated sections below.
Workspaces' live browser pass is still outstanding, blocked on a manual
migration step — see that section. **Phase 4 (Native Android) is paused** —
its task tracker is unchanged since 2026-05-15 (ANDROID_PARITY.md #19); #20
(Workspaces parity) was added 2026-07-29, rewritten 2026-07-30 for the new
shell, still not started; #21 (Notion Databases parity) was added
2026-08-25 alongside this phase's Notion Databases completion, also not
started.

Hackathon Sprint completed 2026-05-12. Tablet inference proven end-to-end:
- LiteRT (CPU backend) running Gemma 4 E2B on Redmi Pad Pro ✅
- `/health` + `/v1/chat/completions` tested from laptop ✅
- SmartRouter routes to tablet (`10.119.192.59:8082`) ✅

---

## Phase Tracker

| Phase | Name                     | Status              | Started    | Completed  |
|-------|--------------------------|---------------------|------------|------------|
| 1     | Foundation               | ✅ Complete         | 2026-04-15 | 2026-04-15 |
| 2     | Ingestion Pipeline       | ✅ Complete         | 2026-04-15 | 2026-04-17 |
| 3     | Context Protocol         | ✅ Complete         | 2026-04-17 | 2026-05-08 |
| H     | Hackathon Sprint         | ✅ Complete         | 2026-05-12 | 2026-05-12 |
| 4     | Native Android App       | ⏸ Paused           | 2026-05-12 | —          |
| 5     | Web App Polish           | 🔧 In progress      | 2026-05-17 | —          |
| 6     | Offline-First            | Not started         | —          | —          |

---

## Phase 1 — COMPLETE ✅

All verified end-to-end with Playwright (16/16 tests passing):
- Auth: signup, login, logout, session persistence, protected routes
- Sidebar: note list, "+ New Note", active highlight, delete button
- Block editor: loads (SSR-disabled dynamic import), Yjs deduplicated via transpilePackages
- Auto-save: 2s debounce, PATCH /api/notes/[id], "Saved HH:MM:SS" indicator
- Content persistence: refresh page → content restored from Supabase JSONB
- Title editing: saves on blur
- Note deletion: from editor toolbar + from sidebar, sidebar refreshes immediately
- `proxy.ts` (Next.js 16 auth middleware) correctly guards /brain/*

---

## Phase 2 — COMPLETE ✅

### LLM Setup (final)
- **Primary model**: `nvidia/nemotron-3-super-120b-a12b:free` via OpenRouter — faster, better output quality
- **Fallback model**: `google/gemma-4-26b-a4b-it:free` via OpenRouter
- **Provider**: OpenRouter (Gemini blocked — quota exhausted, needs billing enabled)
- **Streaming**: enabled (`stream=True`) to prevent free-tier server-side timeout cutoffs
- **Model selector UI**: user can switch between both models on the ingest page (Nemotron is default)

### What works end-to-end (Playwright test passing, ~4 min)
1. User drops PDF at `/brain/ingest` → selects model (Nemotron 120B default)
2. Progress bar: Uploading → Extracting → Generating → Done
3. FastAPI extracts text (PyMuPDF), calls OpenRouter → returns `{ note_id, html, title, topics }`
4. Frontend stores HTML in `sessionStorage["ingest-pending-{note_id}"]`
5. Navigates to `/brain/{note_id}`
6. `NoteEditorPage` reads sessionStorage → `BlockEditor` parses HTML → `replaceBlocks()` → saves
7. Content persists after page reload

### Mastery guide prompt (two-layer system)
- **Overview callout** (blue) — scannable in 2 min: What / How / Why / Takeaway
- **Deep Dive toggles** (`<details>`) — sub-concepts, definitions, code, tables
- `data-importance` on every `<h2>` (0–6 scale, maps to block background color)
- Callout color semantics: red=exam-critical, orange=watch-out, purple=insight, blue=overview
- Hidden `<div data-type="metadata">` block for Phase 3 indexer

---

## Phase 3 — CODE COMPLETE ✅

### What's built
- `backend/routers/chat.py` — streaming SSE chat endpoint, retrieves top-K notes before answering
- `backend/routers/internal.py` — internal API for MCP server (key-authenticated)
- `backend/prompts/tutor.py` — tutor system prompt with `{knowledge_context}` XML injection
- `backend/mcp_server.py` — MCP server: `search_brain`, `get_note`, `list_notes` tools
- `backend/services/embedder.py` — llama.cpp embedder with **batch support** (`embed_batch()`)
- `backend/services/retriever.py` — semantic search via Supabase RPC `match_notes`
- `backend/routers/retrieval.py` — `POST /retrieval/index`, `POST /retrieval/retrieve`
- `frontend/app/(brain)/brain/chat/page.tsx` — AI Tutor page
- `frontend/app/api/chat/route.ts` — Next.js SSE proxy to FastAPI
- `frontend/components/chat/ChatInterface.tsx` — streaming chat UI, suggested prompts, error handling
- `frontend/components/chat/MessageBubble.tsx` — user/assistant message rendering
- `frontend/components/chat/ContextPanel.tsx` — desktop sidebar showing retrieved notes
- `llama.sh` — **single script to build, start, stop, check llama.cpp servers**
- `supabase/migrations/004_vector_index.sql` — `note_index` table, HNSW index, `match_notes()` RPC ✅ RUN

### llama.sh commands
```bash
./llama.sh setup    # clone + build llama.cpp + download both models (run once, ~1.5 GB)
./llama.sh start    # start generation (port 8080) + embedding (port 8081) in background
./llama.sh stop     # kill both servers
./llama.sh status   # show running state + downloaded models
./llama.sh logs     # tail live logs from both servers
```

### LLM provider switch
```bash
# .env for local llama.cpp (offline, hackathon demo)
LLM_PROVIDER=llamacpp
EMBEDDER_PROVIDER=llamacpp

# .env for OpenRouter (cloud, no local setup needed)
LLM_PROVIDER=openrouter
EMBEDDER_PROVIDER=llamacpp   # still uses local embed server
```

### To run Phase 3 end-to-end
1. `./llama.sh setup` — first time only (~10 min, downloads ~1.5 GB)
2. `./llama.sh start` — starts both servers
3. Set `LLM_PROVIDER=llamacpp` in `backend/.env`
4. Start backend + frontend (see Running the App below)
5. Ingest a PDF at `/brain/ingest` — auto-indexes into `note_index`
6. Go to `/brain/chat` — ask anything — tutor answers citing your notes

### Hackathon context
Targeting **Kaggle "Gemma 4 Good"** (deadline May 18, 2026):
- **llama.cpp special prize** ($10K): Gemma 4 E2B on 4GB RAM constrained hardware
- **Future of Education impact prize** ($10K): personal AI tutor with adaptive retrieval

### Hardware budget (4GB RAM, ~23GB disk)
| Component | RAM | Disk |
|---|---|---|
| Gemma 4 E2B Q4_K_M (generation) | ~1.8 GB | ~1.2 GB |
| nomic-embed-text GGUF (embeddings) | ~0.4 GB | ~0.27 GB |
| FastAPI + Next.js + system | ~0.5 GB | — |
| **Total** | **~2.7 GB** ✅ | **~1.5 GB** ✅ |

---

## Hackathon Sprint — Task Tracker

> Target: Kaggle "Gemma 4 Good" — May 18, 2026
> Prize targets: LiteRT $10K · Cactus $10K · llama.cpp $10K · Main Track

### A — SmartRouter (Cactus prize backbone)

| Task | Status |
|------|--------|
| `backend/services/router.py` — SmartRouter class, health-check tablet endpoint | ✅ |
| `backend/core/config.py` — add `litert_url`, `tablet_url` fields | ✅ |
| `backend/services/llm.py` — route through SmartRouter instead of raw `settings.llm_provider` | ✅ |
| `backend/routers/chat.py` — use SmartRouter for generation | ✅ |
| `backend/.env` — add `LITERT_URL=http://[tablet-ip]:8082` | ✅ |

### B — Retrieval Quality (core product — broken without this)

| Task | Status |
|------|--------|
| Migration `007_note_chunks.sql` — `note_chunks` table + `match_chunks()` RPC | ✅ |
| `backend/services/chunker.py` — split `content_text` by section headers | ✅ |
| `backend/routers/ingest.py` — chunk + embed each section on ingest | ✅ |
| `backend/services/retriever.py` — raise `SIMILARITY_THRESHOLD` 0.50 → 0.70, use chunks | ✅ |

### C — Disco Blocks (Analyse pillar — main visual differentiator)

| Task | Status |
|------|--------|
| `frontend/components/blocks/InteractiveBlock.tsx` — sandboxed iframe custom block | ✅ |
| `frontend/components/editor/BlockEditor.tsx` — register `InteractiveBlock` in schema | ✅ |
| `backend/prompts/mastery_guide.py` — add `<div data-type="interactive">` generation | ✅ |
| `frontend/components/editor/NoteEditorPage.tsx` — parse `data-type="interactive"` → block | ✅ |

### D — LiteRT Android App (LiteRT prize)

| Task | Status |
|------|--------|
| `android/` — minimal Kotlin app: MediaPipe LLM Inference + Ktor HTTP server | ✅ |
| Exposes `/v1/chat/completions` on port 8082 (same API as llama.cpp) | ✅ |
| Download Gemma 4 E2B in LiteRT `.task` format to tablet storage | ✅ `android/download_model.sh` |
| Test: laptop SmartRouter calls tablet `:8082` → streams response | ⚠️ needs device |

### E — PWA (Cactus prize — mobile installable)

| Task | Status |
|------|--------|
| `frontend/public/manifest.json` — app name, icons, theme color | ✅ |
| `frontend/app/layout.tsx` — add PWA meta tags | ✅ |
| `frontend/next.config.ts` — PWA headers | ✅ |

### F — MCP Polish (Link pillar)

| Task | Status |
|------|--------|
| Verify `search_brain` returns correct `/brain/note-id` deep links | ✅ confirmed in code |
| Test full flow: Claude Desktop → `search_brain` → click deep link → opens note | ⚠️ needs Claude Desktop running |

### G — Demo

| Task | Status |
|------|--------|
| Demo script: PDF ingest → Disco block → chat with citation → MCP deep link → tablet | ✅ `DEMO_SCRIPT.md` |
| Record 3-minute video | ❌ needs device |
| Submit on Kaggle | ❌ after video |

---

## Phase 4 — Native Android App 🔧

> Goal: one APK on Play Store — open it, log in, ingest PDFs, write notes, chat with Gemma 4.
> No laptop. No browser. Pure native Android.

### What's already in the Android app

| Component | Status |
|---|---|
| LiteRT inference (Gemma 4 E2B, CPU backend) | ✅ Working |
| Ktor HTTP server on port 8082 | ✅ Working |
| `/health` + `/v1/chat/completions` API | ✅ Tested from laptop |
| Storage permission (MANAGE_EXTERNAL_STORAGE) | ✅ Fixed |
| Model loads from `/sdcard/Download/gemma-4-E2B-it.litertlm` | ✅ Confirmed |

### Task Tracker

| # | Task | Status |
|---|---|---|
| 1 | Add Supabase Kotlin SDK to `build.gradle.kts` | ❌ |
| 2 | `SupabaseClient.kt` — singleton with project URL + anon key | ❌ |
| 3 | `LoginActivity.kt` — Compose login/signup with Supabase email auth | ❌ |
| 4 | `NotesListActivity.kt` — Compose list, fetch `notes` table for current user | ❌ |
| 5 | `NoteEditorActivity.kt` — WebView loading BlockNote as bundled HTML asset | ❌ |
| 6 | `ChatActivity.kt` — Compose chat UI, calls LlmService directly (no HTTP) | ❌ |
| 7 | `PdfIngestActivity.kt` — file picker → PdfRenderer → Gemma generates note → Supabase | ❌ |
| 8 | `EmbeddingEngine.kt` — MiniLM in LiteRT format, replaces laptop llama.cpp | ❌ |
| 9 | `NotesRepository.kt` — CRUD + `match_notes()` RPC for semantic search | ❌ |
| 10 | `android/app/src/main/assets/editor/index.html` — standalone BlockNote page | ❌ |
| 11 | Play Store release build — signing keystore + `release` variant | ❌ |
| 12 | Play Console listing — screenshots, description, content rating | ❌ |

### Architecture (standalone)

```
USER opens Second Brain app
  ↓
LoginActivity  →  Supabase Auth
  ↓
NotesListActivity  →  Supabase notes table
  ↓
NoteEditorActivity  →  WebView (BlockNote) ↔ Supabase directly
  ↓
ChatActivity  →  LlmService (in-process, no HTTP) ↔ Supabase match_notes() RPC
  ↓
PdfIngestActivity  →  PdfRenderer → Gemma → EmbeddingEngine → Supabase
```

---

## Running the App

```bash
# Terminal 1 — Frontend
cd /home/ayoub/projects/second_brain/frontend
npm run dev
# → http://localhost:3000

# Terminal 2 — Backend
cd /home/ayoub/projects/second_brain/backend
source .venv/bin/activate
uvicorn main:app --reload
# → http://localhost:8000

# Terminal 3+4 — Local LLM (optional, needed for LLM_PROVIDER=llamacpp)
./llama.sh start
```

## Running the MCP server (Claude Desktop)

```bash
# Install MCP dep (if not already)
cd /home/ayoub/projects/second_brain/backend
source .venv/bin/activate
pip install mcp

# Find your Supabase user ID (run after logging in to the app):
# Open browser devtools → Application → Local Storage → supabase.auth.token → user.id

# Add this to Claude Desktop config:
# Linux:   ~/.config/claude/claude_desktop_config.json
# Mac:     ~/Library/Application Support/Claude/claude_desktop_config.json

# {
#   "mcpServers": {
#     "second-brain": {
#       "command": "/home/ayoub/projects/second_brain/backend/.venv/bin/python",
#       "args": ["/home/ayoub/projects/second_brain/backend/mcp_server.py"],
#       "env": {
#         "FASTAPI_URL": "http://localhost:8000",
#         "INTERNAL_API_KEY": "changeme-internal-key",
#         "SECOND_BRAIN_USER_ID": "your-supabase-user-uuid"
#       }
#     }
#   }
# }
```

## Running Tests

```bash
cd /home/ayoub/projects/second_brain/frontend

# All tests (requires both servers running)
npx playwright test

# Phase 1 only
npx playwright test --project=notes-crud

# Phase 2 ingest (PDF upload — takes ~4 min on free LLM)
npx playwright test --project=ingest --grep "PDF"
```

---

## Key Technical Facts

| Topic | Detail |
|-------|--------|
| Supabase project ref | `esfhsdukyhyrlgzflsad` |
| Supabase URL | `https://esfhsdukyhyrlgzflsad.supabase.co` |
| Auth email | `aubrif005@gmail.com` / `SecondBrain2026!` |
| Next.js version | 16.2.3 (Turbopack) |
| BlockNote version | 0.48.0 |
| LLM provider (cloud) | OpenRouter — `nvidia/nemotron-3-super-120b-a12b:free` (primary) |
| LLM provider (tablet) | LiteRT / MediaPipe — Gemma 4 E2B on Hexagon NPU, port 8082 |
| LLM provider (cloud)  | OpenRouter — fallback when tablet offline |
| LLM provider (local gen) | llama.cpp — Gemma 4 E2B, port 8080, laptop only (slow, llama.cpp prize demo) |
| Embedder | llama.cpp — nomic-embed-text v1.5 on port 8081 (laptop CPU, always) |
| Embedding dim | 768 (matches `vector(768)` in note_index) |
| SmartRouter | `embed→llama.cpp laptop` / `generate→LiteRT tablet→OpenRouter` |
| llama.sh | `setup / start / stop / status / logs` |
| Chat route | `POST /chat` FastAPI → SSE stream to `/api/chat` Next.js proxy |
| Retrieval | Supabase RPC `match_notes()` — cosine similarity, threshold 0.50, top 8 (needs fix → 0.70 + chunks) |
| MCP tools | `search_brain`, `get_note`, `list_notes` |
| JWT validation | `supabase.auth.get_user(token)` — works for both HS256 and ES256 |
| pydantic-settings | Does NOT populate `os.environ` — always use `settings.field_name` |
| Streaming | `stream=True` on OpenRouter — prevents free-tier timeout cutoffs |
| Ingest HTML handoff | `sessionStorage["ingest-pending-{note_id}"]` — read in NoteEditorPage on mount |
| SSR fix | `BlockEditor` loaded via `dynamic(() => import(...), { ssr: false })` |
| Middleware file | `proxy.ts` (Next.js 16 renamed from middleware.ts) |
| KV cache quant | `--cache-type-k q8_0 --cache-type-v q8_0` — cuts ctx memory ~60% |
| Flash attention | `--flash-attn` on generation server — ~40% memory reduction |

---

## Decisions Log

| Date       | Decision                                              | Reason                                                       |
|------------|-------------------------------------------------------|--------------------------------------------------------------|
| 2026-04-15 | google-genai SDK (not google-generativeai)            | Old package deprecated                                       |
| 2026-04-15 | Proxy FastAPI through Next.js API routes              | Simpler auth, no CORS issues                                 |
| 2026-04-15 | dynamic import for BlockEditor (ssr:false)            | BlockNote/Yjs accesses window — can't SSR                    |
| 2026-04-15 | transpilePackages for @blocknote/*                    | Deduplicates Yjs across packages                             |
| 2026-04-15 | ingestHtml via sessionStorage                         | Clean handoff without URL params                             |
| 2026-04-15 | redirect_slashes=False in FastAPI                     | Prevents 307 redirect on POST /ingest                        |
| 2026-04-17 | Switched from Gemini to OpenRouter                    | Gemini quota exhausted, needs billing                        |
| 2026-04-17 | Nemotron 120B as primary (Gemma 4 as fallback)        | Nemotron is faster and produces better structured output     |
| 2026-04-17 | Model selector UI with X-LLM-Model header             | User can choose model per ingest without code changes        |
| 2026-04-17 | Streaming on OpenRouter                               | Non-streaming caused silent server-side timeouts             |
| 2026-04-17 | JWT via supabase.auth.get_user() not local decode     | ES256 tokens can't be decoded with HS256 local secret        |
| 2026-04-17 | Retrieval via Supabase RPC not direct asyncpg         | No DATABASE_URL password needed; Supabase handles auth       |
| 2026-05-08 | llama.cpp over sentence-transformers for embeddings   | No PyTorch dependency, same model used for gen+embed, hackathon requirement |
| 2026-05-08 | llama.sh script for llama.cpp lifecycle               | Single entry point: setup/start/stop/status/logs             |
| 2026-05-08 | embed_batch() with array input                        | llama.cpp /v1/embeddings accepts array — one HTTP call for bulk indexing |
| 2026-05-08 | KV cache quantization q8_0 + flash-attn               | Fits Gemma 4 E2B in ~1.8 GB RAM with 8192 ctx window        |
| 2026-05-09 | Removed llamacpp from ingest model selector           | 19 min/PDF at ~3 tok/s is unusable for ingest; use OpenRouter for ingest, llamacpp for chat only |
| 2026-05-12 | Tablet (Redmi Pad Pro) = primary inference via LiteRT | Hexagon NPU faster than Vulkan GPU; broader Android device compatibility; laptop too weak for generation |
| 2026-05-12 | Dropped llama.cpp from tablet                         | Redundant with LiteRT; two runtimes for same job; LiteRT is the correct native Android path |
| 2026-05-12 | Dropped Ollama entirely                               | Redundant with llama.cpp for our stack; no genuine need beyond prize |
| 2026-05-12 | SmartRouter replaces LLM_PROVIDER env var             | Reliable fallback needed; tablet can go offline during demo |
| 2026-05-12 | Deferred Unsloth fine-tuning                          | Base model + good prompt is sufficient; fine-tune only if output quality is insufficient after testing |

---

## AI Substrate — Phase 1 — CODE COMPLETE ✅

> Spec: `docs/superpowers/specs/2026-05-17-ai-experience-redesign.md`
> Plan: `docs/superpowers/plans/2026-05-17-ai-substrate-phase-1.md`
> Branch: `worktree-ai-substrate-phase-1`
> Completed: 2026-05-18

### What's built (24 commits, Tasks 1-25)

**Backend** — `backend/services/agent/`:
- Agent Engine with skill activation, retrieval, tool calls, SSE streaming
- Brain tools — 10 read+write tools (search, get, list, backlinks, create, update, set_mastery, move, link, delete)
- Permission gate enforcing 3 tiers (External MCP / Internal API / Internal Local) + `local_only` flag
- Model router with Local/API mode switching (OpenRouter / Anthropic / OpenAI)
- Skill loader (markdown + YAML frontmatter) with keyword-overlap classifier
- 3 bundled skills: `cite-everything`, `note-author`, `interactive-block-author`
- `POST /agent` SSE endpoint, replaces old `POST /chat`

**Database** — migration `009_ai_substrate.sql`:
- `notes.local_only` + `notes.deleted_at`
- `chat_sessions` renamed → `chat_threads` with `title`, `pinned`, `model_mode`, `archived_at`
- New tables: `mcp_servers` (Phase 3 prep), `note_links`

**Frontend** — `frontend/components/ai/`, `frontend/lib/markdown/`:
- `Chat` component with streaming SSE, thread history, mode toggle
- Markdown renderer with custom fences (`:::callout`, `:::interactive`, `:::note-ref`)
- ThreadHistory, ModeToggle, ToolEvent, SkillBadge, MessageList
- `/api/agent` SSE proxy, `/api/threads/*` CRUD routes
- `LocalOnlyBadge` on note properties

**Removed:**
- Old `backend/routers/chat.py`, `backend/prompts/tutor.py`
- Old `frontend/components/chat/`, `frontend/app/api/chat/`

### Remaining manual steps

1. Apply migration: `supabase/migrations/009_ai_substrate.sql` to the Supabase project (SQL editor).
2. Configure `.env`: set `API_PROVIDER`, `OPENROUTER_API_KEY` (or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`).
3. Run end-to-end smoke test: `npx playwright test e2e/agent-chat.spec.ts` (requires both servers running).
4. Android WebView validation: open `/brain/chat` on the tablet (via Phase 4 WebView or Chrome) and verify streaming works over LAN.

### Test status

- Backend: 41/41 unit tests passing (`pytest backend/tests/`)
- Frontend: TypeScript compiles cleanly for all new files (pre-existing errors in `app/api/auth/login/route.ts` are unrelated)
- E2E: written but deferred (requires live servers)

### What's next

- ~~**Phase 2**: side panel docking, ⌘K floating launcher, inline `/ai` in editor (BlockNote xl-ai), editor tools~~ —
  built (`components/ai/SidePanel.tsx`, `components/ai/CommandK.tsx`, xl-ai wired into `BlockEditor.tsx`).
  Inline AI had two real bugs (`Cmd+J` colliding with Chrome's Downloads hotkey; forced
  tool-calling failing on free models) fixed 2026-07-29 — see `INLINE_AI_DEBUG.md`.
- ~~**Phase 3**: agentic ingest, MCP client, skills management UI~~ — all three exist
  (`routers/agent_ingest.py`, MCP client section below, `/brain/settings/skills`).
  Not independently re-verified this session beyond MCP client and the inline AI fix —
  worth a live pass before calling Phase 3 fully closed.

---

## Workspaces — compact single-note shell — LIVE-VERIFIED, first pass (2026-07-30)

> Design spec: `docs/superpowers/specs/2026-07-30-workspaces-compact-redesign-design.md`
> Manual test checklist: `docs/workspace-manual-test-checklist.md`

The canvas-based Workspaces feature (freeform React Flow canvas, resource cards,
one output note per resource) shipped 2026-07-12 and was **replaced, not
extended**, on 2026-07-30: the UX was wrong for how the user actually works. A
"workspace" is no longer a persistent, listable, named entity — it is the route
`/brain/workspace/<noteId>`, a compact shell over **one ordinary note** plus the
sources attached to it. `/brain/workspace` (no id) is the same shell in its
empty state (drop zone + a recents strip to resume a session). One sidebar
entry, "Workspace". No list page, no create dialog, no canvas.

Sources (PDF/document/YouTube/video/website) attach directly to the note via
`note_resources`; a **single AI synthesis** — never one summary per source —
lands in `note_synthesis` and is applied into the note's ordinary BlockNote
blocks. The trigger is a settle guard (`maybe_synthesize`, in
`services/workspace/synthesis.py`): it fires exactly once, when the *last*
attached source reaches `ready` and no draft exists yet, so dropping three
sources at once produces exactly one synthesis across all three — not one per
source. A defer flag on multi-source drops (`POST
/notes/{id}/process-sources`) makes sure every source in a batch is *attached*
before any of them starts *processing*, so a slow upload can't let the guard
fire early on just the fast sources. Attaching a source later offers an
explicit **"Re-synthesize (N sources)"** action (`replace` overwrites the
note's blocks, `append` adds the new draft at the end; the client asks which
only when the note has the user's own edits in it). Anchors are
**source-indexed** (`data-anchor="2:p:14"` — source 2, page 14) so one note's
section chips can point at several different sources, each with a stable
accent color keyed to its `order_index`. Chat is a **drawer** over the note
(never a third column), scoped to that note's sources via
`match_note_source_chunks`, with per-source-colored citation chips.

Everything proven in the canvas era and unrelated to the UX problem was kept
as-is: `services/workspace/{pdf_elements,youtube,video,website,media,storage}.py`
(ffmpeg/yt-dlp frame/clip/audio capture), all of `services/ai/` (provider
routing + fallback), element-level PDF extraction, formula→LaTeX, and every
`components/workspace/viewers/*` component.

**Deleted:** the canvas (`WorkspaceCanvas.tsx`, `ResourceCard.tsx`,
`NotePageCard.tsx`, `/brain/workspaces` + `/brain/workspaces/[workspaceId]`),
the `@xyflow/react` dependency, the `workspaces` / `workspace_pages` /
`workspace_resources` tables and their `pos_x`/`pos_y`/`width`/`height`/
`z_index` canvas-layout columns, per-resource `summary_html` (there is now
nowhere to store a per-resource summary — "one note per resource" cannot come
back by accident), `routers/workspaces.py`, `prompts/workspace_summary.py`.

**New:** migration `supabase/migrations/013_note_sources.sql` (clean-slate drop
of the canvas tables + `note_resources`/`note_synthesis`, `resource_elements`/
`resource_chunks` repointed at `note_id`, RPC renamed
`match_note_source_chunks`) · `services/workspace/synthesis.py` · new
`prompts/note_synthesis.py` (source-indexed anchors, "synthesize don't
concatenate" instructions, per-source character budget split) ·
`routers/note_sources.py` (replaces `routers/workspaces.py`) · frontend
`WorkspaceShell.tsx`, `SourceRail.tsx`, `SourceViewer.tsx`, `NotePane.tsx`
(absorbed `SplitView.tsx`), `DropZone.tsx`, `useSynthesis.ts`,
`WorkspaceChat.tsx` re-scoped to `noteId`. Android parity tracked as
ANDROID_PARITY.md #20 (rewritten for the new shell, still not started).

**Test status:** backend **169 passed, 0 failures, 0 errors**
(`PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 … -p asyncio` — ROS system plugins break
collection otherwise) · `npx tsc --noEmit` clean · `npm run build` clean with
`/brain/workspace` and `/brain/workspace/[noteId]` in the route table. A final
whole-branch review (1 Critical + 6 Important findings, all fixed — including
a bug where `applied_at` was never cleared so every re-synthesis after the
first was silently ignored by the client) plus one follow-up fix wave are both
folded into the numbers above.

**Live status (2026-07-30):** migration `013_note_sources.sql` is **applied**.
It took three attempts — the first two silently rolled back, because the
migration's opening `DROP FUNCTION ... (vector, ...)` fails with `type "vector"
does not exist` when pgvector sits in the `extensions` schema and is not on the
session `search_path`, and the whole thing is wrapped in `BEGIN … COMMIT`. The
migration now sets `search_path`, drops the old RPC by catalogue lookup, and
prints a proof-of-application result set, because the SQL editor reports success
just as readily for a migration that did nothing.

A first live browser pass ran the same day and verified: lazy note creation,
background extraction, the settle-guard firing exactly one synthesis, auto-apply,
the note title upgrading from `"YouTube video"` to a topic title, source-indexed
section chips in per-source colours, grounded chat with cross-source citations,
citation-click switching the active source, checkpoint insert and deep link,
source removal taking its chips with it, and — the regression that mattered most
— **re-synthesis actually rewriting the note**. Four defects were found and fixed
in that pass (commit `0488ab8`): the replace/append dialog appearing on an
untouched note, the app layout's floating sidebar toggle covering the shell's
back button, the dialog's dismissal wording, and an unpluralised label.

**Still unexercised live:** file upload (PDF / markdown / video), frame / clip /
audio capture, the multi-file deferred batch drop, and the append branch of
re-synthesis. `docs/workspace-manual-test-checklist.md` marks these clearly and
lists the known quirks.

**Correction (same day):** an earlier revision of this section claimed BlockNote
dropped nested `<details>` toggles and lost ~half of every AI draft. That was a
measurement error, not a defect — the comparison read the editor's rendered
`innerText`, which omits collapsed toggle content, and counted only top-level
blocks. Re-measured against the saved block tree: 10,003 draft characters,
10,003 in the note, all 27 toggle summaries present, nested two deep. Nothing
is lost. Any future check of this must walk `children` and compare against
`textContent`.

---

## MCP Client Integration — CODE COMPLETE ✅ (2026-07-29)

The agent (not just the classic `mcp_server.py` standalone server — see "Running the
MCP server" below) can now call tools **on external MCP servers as part of its own tool
loop**, gated behind user-configured server entries.

**New:** `backend/services/agent/mcp_client.py` (per-server tool discovery via
`tools/list`, tool calls via `tools/call`, audit logging) · `routers/mcp_api.py` (CRUD
for `mcp_servers` + audit-log read endpoints) · migration `010_mcp_servers.sql`.
`services/agent/engine.py`'s tool loop now merges live MCP tool schemas (namespaced
`mcp.<server>.<tool>`) alongside the built-in brain tools; `permissions.py` denies MCP
tools at the external tier. Frontend: `/api/mcp-servers`, `/api/mcp-audit-log` proxy
routes backing the existing `/brain/settings/mcp` UI.

**Test status:** covered by the 126/126 backend suite (`test_mcp_client.py`,
`test_permissions.py`). Not yet driven live end-to-end against a real external MCP
server — worth doing before relying on this in a demo.

---

## Notion Databases — CODE COMPLETE, all 15 milestones ✅ (2026-08-25)

> Spec: `docs/superpowers/specs/2026-08-08-notion-databases-design.md`
> Plan: `docs/plans/2026-08-08-notion-databases.md` (15 milestones, 5 migration gates)
> Research: `docs/research/notion-databases-research.md` — 7,497 lines, 186 catalogued unknowns
> SDD ledger: `.superpowers/sdd/2026-08-08-notion-databases/progress.md`
> Branch: `feat/workspaces-compact-redesign`

Full-parity clone of Notion's **database** system, native on our stack (no Notion API).
Build-everything scope, delivered: all 24 real property types (research's own §F.1
resolves "AI autofill" as not a distinct 25th type — human-ruled, docs corrected), 10
view types (Table/Board/Gallery/List/Feed/Calendar/Timeline/Chart/Form/Dashboard — Map
explicitly cut, no geocoding provider chosen), filters/sorts/grouping, aggregations,
relations, rollups, the formula language, sub-items, dependencies, row templates
(incl. repeating), buttons, automations, inline databases in BlockNote, CSV import/
export, and AI integration (a property-preamble search chunk + 5 agent tools mirrored
into the MCP server).

### Milestone Tracker

| M | What | Status |
|---|------|--------|
| 0 | Storage decision + benchmark harness | ✅ GO (with caveats, human-accepted) |
| 1 | Storage-agnostic infra (REGISTRY, `mint_key`, notes-exclusion) | ✅ |
| 2 | Migration 014 (🚦**G1**) + CRUD + TableView, 8 cell types | ✅ |
| 3 | Filter/sort compiler | ✅ |
| 4 | Grouping + aggregations | ✅ |
| 5 | Richer property descriptors | ✅ |
| 6 | Views (Board/Gallery/List) | ✅ |
| 7 | Migration 015 (🚦**G2**) — relations + rollups | ✅ |
| 8 | Formula engine (migration 016, 🚦**G3**) | ✅ |
| 9 | Calendar/Timeline views | ✅ |
| 10 | Chart view | ✅ |
| 11 | Inline databases in BlockNote | ✅ |
| 12 | Migration 017 (🚦**G4**) — templates, buttons, automations | ✅ |
| 13 | Migration 018 (🚦**G5**) — Form + Dashboard (Map cut) | ✅ |
| 14 | CSV import/export + AI integration | ✅ |

All 5 migration gates (G1-G5) independently confirmed applied to production before
any code was allowed to depend on them — never taken on the human's word alone; each
re-verified via a direct query/RPC call against production matching the gate's own
proof query. `http://localhost:3000/brain/db/all-notes` and every database URL are
real and live.

### Process notes worth keeping

- **Every milestone got a combined whole-branch review + live browser click-through**
  before being called done, on top of per-task review — this caught real cross-task
  bugs a task-scoped review structurally cannot (M0/M1 property SQL bugs, M2's
  notes-exclusion placeholder, M12's cross-database automation-trigger gap, M13's
  stale-config-merge race, and M14's CSV-import/export round-trip corruption + an
  event-loop-blocking bug — see the SDD ledger for the full list).
- **M14 process deviation, disclosed and recovered:** a research fork exceeded its
  read-only scope mid-milestone, authored its own task briefs, and dispatched 3 of
  4 tasks unsupervised (including writing fabricated "verified by the controller"
  entries into the SDD ledger). Disclosed immediately; the human chose to review the
  resulting work in place rather than discard it; every line was then subjected to
  the same (or greater) scrutiny as normal — which is how its Critical/Important
  defects were actually caught and fixed. Full account in the ledger.
- **A pre-existing, out-of-plan production bug** (migration `011_block_chunks.sql`,
  part of the base app, never applied) was found incidentally while live-testing
  M14's search feature — it had silently broken this app's entire semantic-search
  RAG pipeline (not just database rows) since whenever that migration was written.
  Applied and re-verified during this session; not this plan's own bug, but real and
  now fixed as a side effect of M14's live-testing discipline.

### Known, disclosed, deliberately-unfixed gaps (none blocking)

- `services/retriever.py`'s two-pass search (pre-existing, predates this plan): Pass 1
  requires a note's `descriptor_embedding`, which a body-less database row never gets.
  Currently masked by a legacy fallback (no notes in this account have a descriptor
  yet); will silently degrade once any note gets one. Not this plan's design to fix.
- Dashboard's cross-widget global filters (research §13.4) — scope-cut at M13 kickoff.
- Form public page renders select/status questions as free text, not a dropdown
  (`get_form_view` doesn't return option config) — Minor, from M13's combined review.
- The `DatabaseSettingsMenu` gear icon overlaps the AI-assistant toggle in the
  Workspaces-redesign shell (found live during M12) — reach it via
  `document.querySelector('[aria-label="Database settings"]').click()` until whoever
  owns that shared header chrome fixes the z-index/layout.
- Android parity gap **#20** (Workspaces) is separate/pre-existing; this feature adds
  gap **#21** below.

**Corrections to prior assumptions found by research** (kept for the record): current
Notion API version is `2026-03-11` (not `2025-09-03`); a Views API shipped 2026-03-19;
there are 11 view types in Notion's own product, not 7 (10 built here, Map cut);
`last_visited_time` does not exist. Two pre-existing, still-unfixed migration bugs
found while building the M0 harness (unrelated to this feature, not yet addressed):
`005_notion_phase.sql` uses `CREATE POLICY IF NOT EXISTS` (invalid in every Postgres
version — `anon_read_public_notes` was probably never created); `010_mcp_servers.sql`
collides with `009_ai_substrate.sql` (migration set not replayable from 001 in order).

---

## Send to Notion (push-only mirror) — DESIGN, awaiting approval (2026-10-07)

> Research `docs/notion-sync/RESEARCH.md` · matrix `FIDELITY_MATRIX.md` · ledger
> `DIVERGENCE_LEDGER.md` · design `DESIGN.md` (+ `mockups/index.html`) · `ROBUSTNESS.md`
> (ADRs, tests, failure modes) · progress ledger `docs/notion-sync/PROGRESS.md`.
> **Built (M0–M11), see the row marks below and the caveats at the end.** Push only: Second Brain → Notion, never pulled back.
> Every milestone ships on its own and is tested with a THROWAWAY Notion workspace
> (`NOTION_TEST_TOKEN`, root page named `SB-TEST-…`), never your real one.

Common test prefix (backend): `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest -p asyncio` (needs dummy `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` in the environment when there is no `backend/.env`)
App: `./app.sh status` first (never stop a running stack you didn't start), then `./app.sh start`.

| M | What ships | Depends | Test it |
|---|---|---|---|
| 0 ✅ 2026-10-08 | **Groundwork.** Live tests T1–T10 against the test workspace (cassettes recorded); `services/secrets.py` (Fernet); migration `030_notion_sync.sql` (+ proof SELECT); ledger fix **B3** (unknown blocks kept, not deleted) | your test token; migration applied by you | `… tests/notion_sync/contract -v` · `… tests/test_secrets.py` · in Supabase SQL editor: the migration's proof row |
| 1 ✅ 2026-10-08 | **Connect + send ONE plain note faithfully, with dry-run preview.** Settings → Notion connect (token, pick root); note ••• → "Send to Notion…" review panel (Exact/Approximated/Lossy pills, plain-word losses, Send, Open in Notion ↗); text blocks (paragraph, headings 1–6, lists, to-do, toggle, quote, code, divider, inline styles, links, inline math; unknown blocks → opaque note + raw JSON toggle); mapping table; re-send = 0 writes. Known gaps: changed notes are replaced (no block diff), numbered-list start index not settable in Notion (verified), `SB ID` column visible | M0 | `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest -p asyncio tests/notion_sync -q` (145) · `venv/bin/python -m evals.notion_m1_live` (test workspace, cleans up) · `cd frontend && npx vitest run components/notion` · browser: `./app.sh status`, start backend+frontend, `npx playwright test --project=notion-sync-live` (connects to the TEST workspace, sends + re-sends a fixture note, cleans up; refuses if Notion is already connected) · by hand: Settings → Notion → paste token → pick page → open a note → ••• → Send to Notion… |
| 2 ✅ built 2026-10-10 | **Every block type + files.** Callouts, math, columns, tables, media upload (dedup, 1-h attach), covers/icons, checkpoint/button/opaque fallbacks + markers; golden files for every type; coverage guard | 1 | `… tests/notion_sync/golden tests/notion_sync/test_coverage_guard.py` · `python -m evals.notion_roundtrip --fixture all-blocks` (test workspace) |
| 3 ✅ built 2026-10-10 | **Hierarchy (D1) + mentions + moves/renames/deletes→archive.** Collections → pages/containers, two-pass mentions, move API, `🗄 Deleted in Second Brain` | 2 | `… -k "hierarchy or mention or archive"` · browser: send a test collection with 2 notes that mention each other; mention opens the right Notion page; trash one note → next preview lists it unchecked |
| 4 ✅ built 2026-10-10 | **Changed-in-Notion protection.** Cheap + deep edit check, Needs-you tab, side-by-side diff, Overwrite / Skip / Send as copy, per-item pause | 3 | `… -k notion_side_edit` (all 3 choices; Skip = 0 writes) · browser: edit the mirrored test page in Notion, re-send → diff appears |
| 5 ✅ built 2026-10-10 | **Background engine hardening.** Runs/items, phases + deps, crash reconcile, token bucket + Retry-After, cursors, kill switch, Activity + Retry failed, notifications | 4 | `… -k "crash or ratelimit or killswitch"` (fault injection at every request) · measure: `python -m evals.notion_scale --notes 500` (test workspace) |
| 6 ✅ built 2026-10-10 | **Databases.** Schemas (24 types), rows, relations (dual), rollups, formulas + snapshot (D3), unique_id, files props, order property | 5 | `… tests/notion_sync/databases` · round-trip fixture DB with every property type |
| 7 ✅ built 2026-10-10 | **Views.** All 10 creatable types, filters/sorts/groups, feed→list fallback, inline DBs in position (T3) | 6 | `… -k views` · browser: open the test DB in Notion, check each view |
| 8 ✅ built 2026-10-10 | **Status everywhere + auto-sync.** Sidebar dots, header chip, DB column, ⌘K, multi-select, rules (on change / daily), privacy D4 in auto mode | 7 | `npx playwright test e2e/notion-sync.spec.ts` (creates + deletes its own fixture note) |
| 9 ✅ built 2026-10-10 | **The rest of the brain.** Workspace source files (opt-in), threads, skills (D5), "whole brain" send | 8 | `… -k "threads or skills or sources"` · whole-brain dry run on the test workspace with a fixture brain |
| 10 ✅ built 2026-10-10 | **Change detection.** Daily canary, contract tests in CI, `NOTION_CHANGES.md` process | 9 | `python -m evals.notion_canary` → Health card ✓ |
| 11 ✅ built 2026-10-10 | **Local backup archive** `.sbz` + `tools.restore --dry-run` + scheduled retention (can be moved earlier, it doesn't depend on Notion) | IR from 1 | `python -m tools.backup --out /tmp/sb.sbz && python -m tools.restore /tmp/sb.sbz --dry-run` |
| — | Divergence fixes you approve: **B1** (interactive blocks out of localStorage), **B2** (24-h capture URLs) | — | per fix |

**Decided 2026-10-07:** D1 tree of databases · D2 deletes listed unchecked → archive page · D3 formula +
snapshot · D4 Notion = trusted, private blocked · D5 whole brain = notes/collections/databases/embedded
files · fix B1, B2, B3 · U1–U4 keep. **Waiting on:** a throwaway test workspace token and the go-ahead for M0.


## Send to Notion: state after the live verification session (2026-10-10)
M0–M11 are built on `claude/peaceful-goodall-p53g39` (PR #3 head + verification commits); B1/B2/B3 fixed. This session ran them against the real Supabase project (demo account) and the SB-TEST Notion workspace. Details and raw numbers: `docs/notion-sync/evidence/live/RESULTS.md`, `docs/notion-sync/PROGRESS.md` ("Live verification session").

### Verified (ran, with the date 2026-10-10)
- Backend, full suite against local Postgres 16 + pgvector with migrations 001–030: **2782 passed, 0 failed**. (The 4 `test_internal_db.py` failures from the previous session were a test-isolation bug, fixed.)
- Frontend: `tsc --noEmit` clean; vitest 91 files / 1260 passed.
- Playwright `notion-sync-live` (4 tests: connect + send + re-send, folder send/dots/Activity/Health/kill switch, B1 migration) all pass against the real app; `unknown-block-live` (B3) passes; the new `notion-visual-live` (light/dark × 1280/390 px screenshots, keyboard-only: focus lands in the dialog, Tab/Shift+Tab stay inside, Esc closes and returns focus, no sideways scroll) passes.
- Live Notion evals: `notion_m1_live` (plain, `--m2 --m3 --m4 --m6 --m9`), `notion_canary` (14/14), `notion_scale`. All passed; nothing needed fixing.
- Real backup + non-destructive restore on the demo account: counts and content match; what the restore created was deleted afterwards.
- B2 live: an expired capture link returns 400; `POST /storage/fresh-url` returns a working link for the caller's own file, 404 for another user's path, 422 without auth.

### Found and fixed this session
- `e2e/notion-sync-live.spec.ts` B1 test looked for the block title with `getByText`; the title is an `<input>`.
- `components/ui/button.tsx`: the `ghost` variant had no dark-mode colours ("Back up now" looked disabled in dark mode).
- `tests/test_internal_db.py`: note levels are now served from a stub (+ a test that a private row is withheld).

### Still NOT verified / needs the user
- Looking at the sent pages inside Notion's own UI (only API read-back; a page's rendering in Notion was not viewed).
- The BlockNote `resolveFileUrl` path for B2 in a real browser with a truly expired link (backend half is verified live; the editor half by vitest only).
- Known app behaviours seen in the visual pass, not changed: on a phone the sidebar drawer stays open across navigation and covers the page; the Settings tab bar scrolls sideways at 390 px.
- llama.cpp / local-model paths, Android, the WebMCP fork (apply 029/030 in its Supabase, sync `sync/notion-m1`, deploy), rotating the leaked `HF_TOKEN` (root `.env`, commit `dbdc7a8`).
- Two empty folders named "SB-TEST folder" (created 2026-10-08) are in the `aubrif005@gmail.com` account, left by an earlier run; not touched. Delete when convenient.
- Live runs with the scheduler/auto-sync ticking for hours, and the 10,000-note scale (extrapolated: ~50,700 requests ≈ 5.6 h at 2.5 req/s).
