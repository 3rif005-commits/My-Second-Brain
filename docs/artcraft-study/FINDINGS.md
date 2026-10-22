# ArtCraft suite study — FINDINGS (Phase 1, read-only)

Started 2026-10-22. Source: github.com/storytold, shallow clones (HEAD of default branch,
2026-10-22) in a scratch folder outside this repo. Nothing from them is shipped, called or
embedded; ideas are rewritten in our stack.

Verdicts: **KEEP** = worth building, default-on, no setup · **HIDE** = useful but only behind
an existing surface (slash menu, AI request), never a new panel · **SKIP** = not for us.

## Repos and licenses

All checked from each repo's GitHub license field and its `LICENSE-*` files. Every repo studied is
**permissive** (MIT OR Apache-2.0 dual, or MIT) — no copyleft — so code *may* be adapted with
attribution. We still rewrite in our stack (Python/TypeScript); their code is Rust except ArtCraft's
frontend and Spark.

| Repo           | License            | Language        | What it clones / is            | Relevance to us |
|----------------|--------------------|-----------------|--------------------------------|-----------------|
| artcraft       | Apache-2.0 OR MIT  | Rust + React/TS/three.js | AI image/video "IDE"    | High (3D defaults, thumbnails) |
| craft-ai-integrations | MIT OR Apache-2.0 | Rust      | Shared AI provider layer       | Medium (design notes) |
| wordcraft      | MIT OR Apache-2.0  | Rust            | Microsoft Word                 | High (docx, OMML math) |
| deckcraft      | MIT OR Apache-2.0  | Rust            | PowerPoint                     | High (pptx, slideshow) |
| gridcraft      | MIT OR Apache-2.0  | Rust            | Excel                          | Medium (xlsx display values) |
| pdfcraft       | MIT OR Apache-2.0  | Rust            | Acrobat                        | High (page cache, structure headings) |
| filmcraft      | MIT OR Apache-2.0  | Rust            | Premiere                       | High (transcripts, captions) |
| cadcraft       | MIT OR Apache-2.0  | Rust            | AutoCAD (2D only today)        | Low (crash recovery, SVG fit) |
| vectorcraft    | MIT OR Apache-2.0  | Rust            | Illustrator                    | Low (plugin/script checking) |
| designcraft    | MIT OR Apache-2.0  | Rust            | InDesign                       | Low (small docx reader) |
| figcraft       | MIT OR Apache-2.0  | Rust            | Figma                          | Low (collab simulator test) |
| effectcraft    | MIT OR Apache-2.0  | Rust            | After Effects                  | Low (agent/MCP docs) |
| lightcraft     | MIT OR Apache-2.0  | Rust            | Lightroom                      | Low (procedural fixtures) |
| photocraft     | MIT OR Apache-2.0  | Rust            | Photoshop                      | Low (perf budgets, scorecard) |
| soundcraft     | MIT OR Apache-2.0  | Rust            | Pro Tools                      | None |
| craft-launcher | MIT OR Apache-2.0  | Rust            | Suite installer/updater        | None |
| craft-libs     | MIT OR Apache-2.0  | Rust            | Shared libs (settings, atomic, pdf) | Low |
| spark          | MIT                | TypeScript      | Gaussian-splat renderer for three.js | None for now |

Not studied: `artcraft-services` (license NOASSERTION — unclear → ideas only, and not needed),
Unreal/Unity plugins, ML training repos, forks of `egui`/`winit`.

## Our starting point (what already exists)

- `interactive` block (`frontend/components/editor/InteractiveBlock.tsx`, `InteractiveBlockCard.tsx`):
  the "live block" is half-built — props `{title, html}`, tabs Preview / Code / AI, sandboxed
  `srcDoc` iframe (`allow-scripts`), **fixed 300 px height**, plain textarea, AI writes raw HTML
  via `/api/agent` surface `interactive`. No auto-height, no export, no Mermaid/three.js helpers.
- `math` / `inlineMath` blocks (KaTeX), `callout`, `checkpoint` blocks.
- Workspace extraction: PDF elements + headings + tables spliced into `pages_text`; md/txt sections;
  websites (trafilatura); YouTube transcript; video via faster-whisper. docx/xlsx/pptx: see below.

## Ideas by repo

### artcraft (Tauri + React/Three.js/Zustand, Apache-2.0 OR MIT)

AI image/video "IDE for artists". The only repo with a TypeScript/React/three.js frontend, so the
only one whose code is directly portable to ours (with attribution, license permits).

| # | Idea | Where | Helps | Verdict |
|---|------|-------|-------|---------|
| A1 | **Auto-framed 3D with a fixed 5-light rig.** `fitModel()` scales any model to a 2-unit max dimension and stands it on the origin (min.y = 0); `frameCamera()` puts the camera on a 45° diagonal at `fitDistance*1.3` where `fitDistance = maxDim/2/tan(fov/2)`, looking at 40% of height. Lights: ambient 2 + hemisphere (white/grey) 1.2 + key (2,10,8) + fill (-6,6,-4) + front (0,4,10). Every model looks decent with zero tuning. | `frontend/apps/artcraft/app/src/pages/PageImageTo3DObject/captureModelThumbnail.ts` | Live block 3D, .glb/.stl drop viewer | **KEEP** — this is the "good default camera/lighting" the brief asks for; ~40 lines, no knobs. |
| A2 | **Offscreen thumbnail capture**: throwaway `WebGLRenderer({preserveDrawingBuffer})`, render one frame, `toDataURL`, then `dispose()` + `forceContextLoss()`, exactly-once `finish()` guarding load/error/timeout (30 s); `setCrossOrigin("anonymous")` or the canvas taints and export throws. | same file | Live block "export as image", 3D file card preview in source rail | **KEEP** — snapshot = a still image the note/Notion mirror/print can show when JS can't run. |
| A3 | **`disposeObject3D()`**: frees geometries, materials AND their textures (Material.dispose doesn't free maps), skeleton bone textures; with a spec test. | `frontend/libs/components/viewer-3d/src/lib/disposeObject3D.ts` (+ `.spec.ts`) | Any 3D viewer we add (notes with several 3D blocks leak WebGL contexts otherwise; Chrome caps ~16) | **KEEP** (inside the viewer, invisible). |
| A4 | Viewer: `OrbitControls` with damping 0.05, `ResizeObserver` sizing, faint grid (opacity 0.05) hidden while capturing a thumbnail, `AnimationMixer` auto-plays GLB animations. | `viewer-3d/src/lib/viewer-3d.tsx` | 3D viewer feel | **KEEP** damping + resize + auto-play animation; **SKIP** grid toggle (a setting). |
| A5 | Client-side video frame grab: seek → `seeked` once → `drawImage` to canvas → restore original time. | `pages/PageVideoFrameExtractor/VideoFrameExtractor.tsx:248-310` | Video note thumbnails without a server round trip (we use ffmpeg server-side, 30–128 s for YouTube) | **HIDE** — use only for *uploaded* video chapter thumbnails; YouTube iframes can't be drawn (cross-origin). |
| A6 | Image→3D, background removal, inpainting, posing, storyboards, moodboards. | `pages/*` | — | **SKIP** — creative-tool scope, not a knowledge app. |
| A7 | House style for agents: files read top-to-bottom (constants, types, public, then helpers below callers); space-padded markdown tables. | `AGENTS.md` | Our docs/CLAUDE.md | **SKIP** — taste; our CLAUDE.md is already explicit. |

### craft-ai-integrations (Rust, MIT OR Apache-2.0)

One AI connection shared by every Craft app.

| # | Idea | Where | Helps | Verdict |
|---|------|-------|-------|---------|
| AI1 | **Tool→model binding ("ToolDesk")**: each *tool* (e.g. "remove background") remembers which model runs it; set once, every app reuses it. | `crates/ai-client` (README) | Our switchboard already routes per task; equivalent exists | **SKIP** — we have it (routing switchboard); adding a per-tool picker = a settings panel. |
| AI2 | **Declarative provider adapter**: a ≤32 KiB JSON spec (base URL, auth header, request template with closed `{prompt}`/`{model}` substitutions, JSON-pointer result extraction, queue/poll flow mapped to 4 states). No code runs from the spec; prompt text can't change request structure. | `docs/design/declarative-adapter.md`, `crates/ai-declarative/` | "Any model" goal: odd providers without new Python | **SKIP** for now — openai-compatible covers nearly every text provider incl. local; worth revisiting only for image/video providers. Note the safety rules if ever built. |
| AI3 | **"What has and has not been verified" section** in README/STATUS: tested-against-mock vs run-for-real vs not verified, per provider. | `README.md`, `docs/STATUS.md` | Our STATUS.md honesty about live vs unit-tested | **KEEP** (docs habit, zero code) — we already half-do this in memory; put it in STATUS.md per feature. |
| AI4 | Model-files catalogue with size, SHA-256, source, license, "what this machine still needs". | `crates/ai-features` | Local-model setup (llama.cpp models in `llama.sh`) | **HIDE** — a checksum + "needs 1.2 GB" line in `llama.sh setup` output, no UI. |
| AI5 | Consent prompt before a job sends data to a hosted service; history file of jobs. | `crates/ai-client`, `ai-native` | We already have the privacy gate (fail-closed) | **SKIP** — covered by `services/privacy.py`. |

### Office formats — wordcraft / deckcraft / gridcraft (Rust, MIT OR Apache-2.0)

**Our gap, measured first:** Workspace accepts only `.pdf .md .txt` + video
(`SourceRail.tsx:232`, `ACCEPTED_WORKSPACE_FILES`). The classic ingest path
(`backend/services/file_extractor.py`) reads docx/pptx but: docx = paragraphs, then **every table
appended at the end** (order lost), no heading levels, no lists, no equations; pptx = text frames
only (no tables, no groups, no charts, no speaker notes, title not marked); **no xlsx at all**.
The PDF path learned to keep tables/headings (2026-09-04) — Office files never got the same care.

| # | Idea | Where | Helps | Verdict |
|---|------|-------|-------|---------|
| F1 | **Headings from the resolved outline level, walking the `basedOn` style chain** — not from the style's display name. Custom styles based on Heading 1 and localized Word (styleId `berschrift1`) still become headings; `Title` → h1. | wordcraft `crates/docx/src/read/props.rs:432`, `crates/doc/src/styles.rs`, `resolve.rs:263` | docx → Workspace/ingest: real `## ` headings → anchors, section chips, better synthesis | **KEEP** |
| F2 | **Body order preserved**: walk `w:body` children in order (paragraph, table, paragraph…) instead of `doc.paragraphs` then `doc.tables`. Lists from `w:numPr/w:ilvl` → indented `- `. | wordcraft `crates/docx/src/read/story.rs` | Same | **KEEP** — tables stay where the author put them, like the PDF fix. |
| F3 | **Office Math (OMML) → LaTeX**: walk `m:f`→`\frac`, `m:rad`→`\sqrt`, `m:sSup/sSub/sSubSup`→`^{}`/`_{}`, `m:nary`→`\sum/\int` with limits, `m:d`→`\left(…\right)`, `m:m`→matrix; depth-bounded. Their path is OMML→tree→linear→LaTeX. | wordcraft `crates/docx/src/read/math.rs`, `crates/formats/src/latex.rs:710` (`linear_to_latex`) | Students' .docx notes with equations become our KaTeX `math` blocks (today: equations vanish — python-docx `para.text` skips `m:oMath`) | **KEEP** — rewrite in Python (~120 lines), same output our PDF formula→LaTeX feeds. |
| F4 | **"No words lost" lenient import rule**: unknown commands dropped but their arguments kept as text; nesting depth-limited; input size capped; never crash on hostile files. | wordcraft `crates/formats/src/latex.rs` header, CLAUDE.md "Never crash" | Every extractor we have | **KEEP** as a test style: one "hostile file never raises, never loses text" test per extractor. |
| F5 | **pptx reading done right**: recurse `p:grpSp`; tables in `p:graphicFrame/a:tbl` → markdown table; title/ctrTitle placeholders → `## ` (inherit from layout); speaker notes via the slide's `notesSlide` rel; picture alt text (`descr`); order shapes top-to-bottom, left-to-right. | deckcraft `crates/pptx/src/read/shapes.rs`, `read/mod.rs:525` | pptx → Workspace. **Reading the .pptx avoids the PowerPoint→PDF mojibake entirely** (glyph-encoded subscripts) | **KEEP** |
| F6 | **Charts carry their data**: chart parts store cached series values (`c:numCache`/`c:strCache`) — the numbers behind every slide/sheet chart can be read without rendering. Turn each chart into "Chart: <title>" + a small markdown table. | deckcraft `crates/pptx/src/read/chart.rs`, gridcraft `crates/xlsx/src/chart.rs:207` | The model sees chart data it never sees from a PDF image; could later seed a live chart block | **KEEP** (part of F5/F7) |
| F7 | **xlsx as tables**: per visible sheet, render each cell as Excel *displays* it (apply the number format so dates/percent aren't serials), trim blank outer rows/columns (TRIMRANGE semantics), split islands separated by blank rows, use Excel Table names as headings. | gridcraft `crates/numfmt`, `crates/calc/src/trimrange.rs`, `crates/xlsx/src/tables.rs` | xlsx → Workspace source (new) | **KEEP** — openpyxl `data_only=True` gives cached values; format via `cell.number_format`. |
| F8 | Sheet block with formulas (GridCraft's full engine, 24k lines). | gridcraft `crates/formula`, `crates/calc` | — | **SKIP** — we already have a formula engine for databases (`backend/services/db/formula/`); a second formula language in notes is clutter. A database *is* our sheet. |
| F9 | Localized formula entry (Spanish `SUMA`, `;` separators) only at the editor boundary; storage stays canonical English. | gridcraft `docs/formula-input.md` | Database formulas | **SKIP** — nice principle, no user demand. |
| F10 | Export a note to standalone `.tex` (headings → `\section*`, tables → `tabular`, math kept). | wordcraft `crates/formats/src/latex.rs:41` | Study notes for LaTeX users | **HIDE** — a third item beside the note menu's existing Export Markdown / Export PDF (`NoteEditorPage.tsx:362-370`); low priority. |

### pdfcraft (Rust, MIT OR Apache-2.0)

| # | Idea | Where | Helps | Verdict |
|---|------|-------|-------|---------|
| P1 | **Render only what's on screen**: visible pages + a nearest-first prefetch window; whole-page rasters and text layers cached under a count/byte budget and evicted farthest-first; failures remembered (never re-requested every frame); during search keep everything. | `crates/ui-egui/src/canvas.rs:54-56, 1828-1946` | `PdfViewer.tsx:182` mounts **every** page's canvas + text layer at once — a 300-page textbook on the 4 GB laptop/tablet. We already store `page_sizes`, so off-screen pages can be exact-size empty boxes (scroll/anchors unchanged). | **KEEP** — invisible, pure speed/memory win. |
| P2 | **Headings from the document's own structure** before guessing: tagged-PDF `H1–H6` (a plain `H` takes its level from enclosing `Sect`s), and bookmarks/outline. | `crates/a11y/src/headings.rs` | `pdf_elements.py` only uses font-size heuristics (3→17 headings after the 2026-09 fix). PyMuPDF `doc.get_toc()` returns `[level, title, page]` — exact titles and levels for books/papers that have bookmarks. Use it when present, heuristics otherwise. | **KEEP** — ~30 lines, better chapters for long PDFs. |
| P3 | OCR → invisible text layer so a scanned page becomes searchable (ocrs engine; notes a model alphabet bug: `€` read as `E`). | `crates/ocr/src/lib.rs` | Scanned PDFs currently yield no text → nothing reaches synthesis. | **HIDE** — automatic only when a page has no text: send the page image to a vision-capable provider (we already crop formulas for vision); if none is configured, say so on the source card. No toggle. |
| P4 | Writing annotations/highlights into the PDF file (appearance streams, XFDF). | `crates/annot`, `crates/xfdf` | — | **SKIP** — we never modify the user's file; highlights belong in our DB. |
| P5 | Continuous page display without gaps; side-by-side compare; redaction; forms; signing; preflight. | `docs/page-display.md`, `crates/compare` … | — | **SKIP** — PDF-editor scope. |
| P6 | Hard input bounds on every parser (MAX_HEADINGS, MAX_VISITS, MAX_DEPTH, MAX_TITLE). | `crates/a11y/src/headings.rs:12-17` | Our extractors on hostile/huge files | **KEEP** as a habit (folded into F4). |

**Our "PDF highlight → quote" candidate, checked against our code:** `PdfViewer.tsx:255` "Send to
note" inserts the selected text as a plain paragraph — no link back; "Checkpoint" is a separate
button that inserts a page pill. The compact version is to **merge them**: Send to note inserts a
quote whose trailing page chip is the existing checkpoint anchor (click → jumps to the page), and
the viewer tints the quoted passage. No new button; one fewer decision.

### cadcraft (Rust, MIT OR Apache-2.0)

Effectively 2D (its ViewCube says rotation needs a view twist the plan view doesn't have yet), so
little for 3D. Two transferable ideas:

| # | Idea | Where | Helps | Verdict |
|---|------|-------|-------|---------|
| C1 | **Crash recovery by leftover file**: autosave writes a recovery copy; a normal save/close deletes it, so *a copy left behind means the app died* and the next start offers it. A lock file stops two running copies from claiming each other's files. Decision logic (`plan`) is pure and tested; I/O is separate. | `crates/engine/src/autosave.rs` | **Note editor.** `NoteEditorPage.tsx:266` `handleSaveContent` sets "Saved" even when the PATCH fails (`setLastSaved` runs regardless of `res.ok`), and if `fetch` throws (offline, server restarting) `setSaving(false)` never runs and the edits exist only in memory — closing the tab loses them. Compact version: on a failed save keep the blocks in `localStorage` keyed by note, show "Not saved — retrying", retry with backoff; on open, if a local copy is newer than the server's `updated_at`, apply it and say so in one toast. | **KEEP** — data-loss fix, no UI beyond the existing save label. |
| C2 | SVG export fitted to the drawing's extents with a 2% margin, white background, transparency as on screen. | `crates/io/src/svg.rs` | Live block "export as image" for diagrams: crop to content bbox + small margin | **KEEP** (folded into the live block). |
| C3 | Command line, object snaps, layers, AutoLISP, plot styles, DWG/DXF. | — | — | **SKIP** — CAD scope. |

### filmcraft (Rust, MIT OR Apache-2.0)

**Our state, checked:** uploaded video → faster-whisper *segments* (`video.py:56`, `vad_filter=True`),
6 evenly spaced keyframes as a vision fallback (`video.py:80`); YouTube → transcript snippets in
75 s chunks (`youtube.py:76`). The viewers (`YouTubePlayer.tsx`, `VideoPlayer.tsx`) show **no
transcript and no chapters**, and `youtube.fetch_metadata` ignores the creator's own chapters.

| # | Idea | Where | Helps | Verdict |
|---|------|-------|-------|---------|
| V1 | **Transcript as clickable text under the player**: words/segments carry media-time bounds; the line under the playhead highlights; click a line → seek; search a phrase → jump. Times are *media* time so they survive any edit. | `docs/transcripts.md`, `crates/edit/src/transcript.rs` | Video sources in Workspace: read along, click to jump, copy a quote with its timestamp (same "send to note" path as PDF) | **KEEP** — we already store `[mm:ss]` chunks; it's a list under the player, collapsed by default. |
| V2 | **Use the source's own structure first** (same principle as P2): YouTube creator chapters (`yt-dlp` info `chapters`: start/end/title) become the chapter anchors; only if absent let synthesis pick sections. | (principle across pdfcraft headings / filmcraft markers) | Video note chapters that match what the creator intended, zero model cost | **KEEP** |
| V3 | Chapter thumbnails: one frame per chapter start (uploaded video: ffmpeg `-ss`; or client-side canvas grab, A5). | ArtCraft `VideoFrameExtractor.tsx`; our `media.py` | Chapter list with pictures, click → jump | **KEEP** for uploaded video; **SKIP** YouTube (use YouTube's own `i.ytimg.com/vi/<id>/…` storyboard is not public API; avoid). |
| V4 | Filler-word removal before captions (`um, uh, erm…` list) and long-pause trimming. | `crates/edit/src/transcript.rs:194` | Strip fillers from transcript text before synthesis → fewer tokens, cleaner quotes | **KEEP** (invisible, 10 lines). |
| V5 | Speaker labels without a model: cluster per-chunk MFCC statistics; chunks split at pauses, short ones joined. Tested on synthetic two-voice audio. | `crates/speech/src/diarize.rs` | Lecture with Q&A, interviews: "Speaker 2 asked…" | **HIDE** — only if cheap in Python (librosa MFCC + k-means); show labels only when >1 speaker found. Low priority. |
| V6 | Word-level timestamps via cross-attention DTW; energy VAD tightening word bounds. | `crates/speech/src/whisper`, `vad.rs` | Precise click-to-word | **SKIP** — faster-whisper already has `word_timestamps=True`; segment level is enough for jumping. |
| V7 | Forgiving SRT/VTT readers (BOM, UTF-16, CP1252, CRLF, missing indexes, `,`/`.` ms, missing hours). | `docs/captions.md`, `crates/captions/src/srt.rs`, `vtt.rs` | Accept a `.srt/.vtt` dropped next to a video (or alone) as its transcript — skips minutes of whisper on the 4 GB machine | **HIDE** — accept the file type silently; no UI. |
| V8 | Every capability is a command (`transcript.search`, `transcript.select`…) shared by UI, CLI, MCP. | `docs/transcripts.md` | Our MCP/agent tools | see Method section. |

### vectorcraft (Rust, MIT OR Apache-2.0)

| # | Idea | Where | Helps | Verdict |
|---|------|-------|-------|---------|
| VC1 | 3D as a **live effect on 2D art** (extrude/bevel/inflate/revolve) evaluated to shaded vector faces, so SVG/PDF export and print use the same output as the screen. | `docs/three-d.md`, `docs/revolve.md`, `crates/three-d` | — | **SKIP** — option-heavy (twist, taper, bevel shapes, lights); our 3D need is "show a model", not "make 3D type". |
| VC2 | Plug-ins as sandboxed WebAssembly (wasmi interpreter), manifest + param schema → generated dialog; a plug-in **never touches a file** (host writes the bytes it returns). | `docs/plugins.md`, `crates/plugins` | Our Plugin API (`frontend/lib/plugins/api.ts`) | **SKIP** — our plugins are JS through a typed API; the "plugin returns data, host writes it" rule is already how ours work. |
| VC3 | Missing plug-in → the document keeps the effect record and draws without it until the plug-in returns. | `docs/plugins.md` ("Plug-ins are installed per process") | Notes | **SKIP** — we have exactly this (`components/editor/unknownBlocks.ts`, `UnknownBlockSpec`). Confirms the design. |
| VC4 | Static script checker: lexes a script without running it, linear time, capped stacks, never recurses. | `crates/scriptcheck/src/lib.rs` | Live block: pre-flight the AI's HTML (unclosed tags, `fetch(` to the network, `top.`/`parent.` access) before showing it | **HIDE** — a tiny check on AI output only; silent repair or a one-line "this block tried to reach the network" note. |
| VC5 | Image trace (bitmap → vector) with quality presets. | `crates/trace`, `docs/image-trace-quality.md` | Photo of a whiteboard diagram | **SKIP** as tracing; our own better idea: *photo of a diagram → the AI writes it as a Mermaid live block* (vision model; editable text, not traced curves). Folded into the live block. |

### deckcraft (Rust, MIT OR Apache-2.0)

| # | Idea | Where | Helps | Verdict |
|---|------|-------|-------|---------|
| D1 | **The show's keyboard set**: arrows/Space/PageUp-Down/Enter/Backspace; type a number + Enter to jump (digits show as "Go to slide…" for 3 s); **G** grid of all slides; **Z** zoom 2× into a point; **B/W** black/white screen; Esc leaves; one wheel flick = one slide. Only `http(s)`/`mailto` links open (`safe_url`). | `docs/slideshow-parity.md` | "Present any note as slides" — we have no present mode | **KEEP** the keys (no buttons needed), **SKIP** presenter window, rehearsal, ink, custom shows. |
| D2 | **Text auto-fit = shrink**: when content overflows the slide, scale font (clamped 0.1–1.0) and reduce line spacing, rather than clipping or asking. | `crates/text/src/lib.rs:1552` | Present mode: a heading with lots of bullets still fits | **KEEP** — CSS: measure, scale down to a floor, else split into a continued slide. |
| D3 | Reading the pptx (F5/F6 above). | `crates/pptx` | Workspace import | see F5. |
| D4 | Animations, transitions, media codecs (h264/hevc/av1 decoders in Rust). | `crates/anim`, `crates/h264` … | — | **SKIP** |

**Compact "present" design from D1+D2:** one item, *Present*, in the note's existing `⋯` menu.
Each `h1`/`h2` starts a slide; toggle headings open; callouts, math, images, live blocks render as
in the note; overflowing slides shrink, then continue. Keys from D1. Nothing to configure.

### The rest of the suite (quick pass)

| # | Idea | Where | Helps | Verdict |
|---|------|-------|-------|---------|
| R1 | **Procedural test fixtures**: demo/test photos generated in code from a seed — "no external assets: zero licensing or privacy risk". | lightcraft `crates/scenes/src/lib.rs` | Our extraction tests: generate small docx/pptx/xlsx fixtures in the test itself (python-docx/python-pptx/openpyxl can *write*) instead of committing binaries or touching real notes | **KEEP** for the F-items' tests. |
| R2 | But DeckCraft's own #1 gap: *"PPTX corpus is only decks we author (no PowerPoint reference renders)"* — self-made fixtures miss real-world files. | deckcraft `docs/gaps.md` #1 | Same | **KEEP** the caveat: one real file per format in the live pass (like Lecture 10 for PDF). |
| R3 | Collaboration core with a **simulator**: server + clients over in-memory links with random delays, dropped connections and an undo checker. | figcraft `crates/collab/src/lib.rs` (`sim`) | Pattern for testing C1 (save retry/recovery) — fake fetch that fails/delays at random, assert no edit is lost | **KEEP** as the C1 test style. Real-time collab itself: **SKIP**. |
| R4 | Settings that load without ever failing: damaged file moved aside, backup kept, schema migrations. | craft-libs `crates/settings` | `frontend/lib/preferences.ts` | **SKIP** — localStorage prefs are tiny; already try/catch. |
| R5 | MCP bridge: after a dropped connection only read-only queries are retried; state-changing calls report "unknown outcome" and are never resent. | effectcraft `docs/agents.md` | Our MCP client | **SKIP** — `services/agent/mcp_client.py` never retries, which is already safe. |
| R6 | Lottie import/export (animated vector JSON). | effectcraft `crates/lottie` | Live block animations | **SKIP** — an HTML live block can already animate; Lottie adds a format nobody asked for. |
| R7 | docx text import with numbering, in a **much smaller** reader than WordCraft's. | designcraft `crates/textimport/src/docx.rs`, `docx_numbering.rs` | Closest reference for F2 list numbering | **KEEP** as the reference to read when building F2. |
| R8 | Photo catalogue with smart albums (rule-based), faces, geocoding, keywords. | lightcraft `crates/catalog`, `faces`, `geocode` | Images in notes | **SKIP** — our search is semantic over text; not a photo app. |
| R9 | Perf budgets: stored baseline, "regression = p50 grows >15 % **and** >1 ms", `enforce=false` for targets not met yet, `not_measurable` instead of an invented number. | photocraft `perf/budgets.toml` | Our evals (study-guide quality guard, routing eval) and a note-open timing | **HIDE** — adopt the rule text in evals; no new tooling now. |
| R10 | Photo/raw editing, denoise, inpaint, HEIF, DAW/VST hosting, InDesign IDML, Figma-style prototyping. | photocraft, lightcraft, soundcraft, designcraft, figcraft | — | **SKIP** — creative-pro scope. |
| R11 | Gaussian-splat renderer for three.js. | spark (MIT, TypeScript) | 3D captures in notes | **SKIP** — niche; revisit only if users drop `.ply/.spz` files. |

No repo named **REA** exists under `github.com/storytold` (checked the full public list,
2026-10-22); `craftrules` (their shared agent rules, referenced from every AGENTS.md) is private (404).

## Method: how they built a suite of clones with Claude (reusable)

Read from every `CLAUDE.md` / `AGENTS.md` and their docs. What we can reuse:

| # | Practice | Their form | Our version | Verdict |
|---|----------|-----------|-------------|---------|
| M1 | **Everything is a command** with a stable id; menus, shortcuts, command search, CLI, control channel and MCP all dispatch by id; programmatic calls never open dialogs. | wordcraft `CLAUDE.md` "Architecture" | We have skills + brain tools + MCP; UI actions are separate code paths. Worth applying only where it pays: the editor's slash menu and the AI's tools could share one registry of block actions (insert live block, present, etc.). | **HIDE** — apply to new features from this study, not a refactor. |
| M2 | **Measured parity with a floor that only rises**: a catalogue of the target app's features → generated checklist → a test fails if the score drops. | wordcraft `crates/engine/src/catalog.rs`, `cargo xtask parity` | We have the 331-item Notion checklist (`project_notion_ui_reference`) but no test guarding it. | **KEEP** (cheap): a test that counts done items in a checklist file and fails below a stored floor. |
| M3 | **Hostile-params test**: run every command with junk params; must never crash. | wordcraft `crates/engine/src/tests.rs::hostile_params_never_panic`, photocraft REL-1 | One parametrized pytest that throws junk at every router/tool input schema. | **KEEP** (folded into F4). |
| M4 | **Behaviour doc pinned by tests**: "typing behaves like Word" lives in `docs/typing-parity.md` and `tests_typing.rs`; change behaviour, doc and tests together. | wordcraft `docs/typing-parity.md` | Editor feel (Enter in toggles/callouts, Backspace at block start) — we fix these one by one. | **HIDE** — start a short `docs/editor-behaviour.md` only when we next touch editor keys. |
| M5 | **Look at the result**: headless window screenshots compared side by side with the reference app. | `ui_shot` example, every AGENTS.md | We do live Chrome passes. | already done. |
| M6 | **Ranked gaps list with hour estimates** in agent wall-clock hours, "pick from the top", delete an entry when it closes; status line + revision history on each doc. | deckcraft `docs/gaps.md` | Our STATUS.md is a long dated log; no ranked list. | **KEEP** — a short ranked "Next" table at the top of STATUS.md. |
| M7 | **Clean room**: observe the reference app black-box; formats from public specs only; never copy GPL. | every AGENTS.md §2 | Exactly the rule this study follows. | already done. |
| M8 | **"What is and isn't verified"** stated per component (mock-tested / run for real / not verified). | craft-ai-integrations `README.md` | Same as AI3. | **KEEP** |
| M9 | Parallel agents with separate build dirs, each owning its crates. | wordcraft `CLAUDE.md` | — | **SKIP** — our memory says work inline. |

## Core idea: the "live block" — evaluation

**Verdict: KEEP — but as an upgrade of the existing `interactive` block, not a new block type.**
One block type already exists, is stored in the note (`{title, html}` props), syncs everywhere, and
has Preview / Code / AI tabs. What it lacks is what makes it lovable:

1. **Size to content.** Fixed `height: 300` (`InteractiveBlockCard.tsx`). A Mermaid diagram is 180 px,
   a quiz 600 px. The iframe posts its `scrollHeight` (`ResizeObserver` inside → `postMessage`) and
   the card follows, clamped (e.g. 120–900 px). Invisible.
2. **Kinds without settings.** The AI request decides the kind; the block stays one type. A tiny
   built-in "runtime" is injected into `srcDoc` based on what the code uses, so the AI writes short
   code and it renders well by default:
   - `mermaid` code → Mermaid render (diagrams, mind maps, timelines, sequence, gantt).
   - three.js scene → ArtCraft's **A1** frame-and-light rig + damped orbit controls + **A3**
     dispose, so "a 3D model of a cell" looks right with no tuning; `.glb/.stl` URLs auto-framed.
   - chart data → a chart lib with our palette.
   - LaTeX → KaTeX (we already ship it).
   - anything else → plain HTML/JS (quizzes, calculators, simulations).
   Libraries load from a pinned CDN *inside the sandbox* only; the note itself loads nothing.
3. **Export as image** (A2 + C2): one "⤓" in the card's title bar. SVG for Mermaid (cropped to the
   content bbox + 2 % margin), PNG for 3D/canvas (`preserveDrawingBuffer`). The same snapshot is
   stored as the block's **fallback image** so print and any surface that can't run scripts (Android
   note view, PDF export) show a picture. (The Notion mirror already uploads the block's HTML as an
   embedded file — `notion_sync/notion/writers/rich.py:234` — so it doesn't need this.)
4. **Keep the tabs, lose a step.** Today AI writes code then drops you in Code mode. Show the result
   (Preview) right away; Code is one click. A second AI request on a filled block *edits* the current
   code ("make the labels bigger") instead of starting over.
5. **Safety stays as is:** `sandbox="allow-scripts"` without `allow-same-origin` (no cookies, no
   parent DOM). Add a CSP `<meta>` in the injected head that allows only the pinned CDN, so a
   generated block can't phone home; **VC4** pre-flight check on AI output.
6. **Any model:** the AI only writes text (Mermaid/HTML/JS), so every provider including local
   llama.cpp can produce it; Mermaid is the best "small model" target because it's short. Prompt
   steers small models to Mermaid for diagrams.
7. **From a photo** (VC5, our own idea): "turn this whiteboard photo into a diagram" → vision model
   writes Mermaid into a live block. Only where a vision provider is configured.

**What not to build:** a code editor with tabs/themes/linters, a block gallery, per-block library
pickers, a 3D scene editor, lighting controls (A1's rig is fixed on purpose).

**Other candidates from the brief, verdicts:**
- Better extraction (tables/headings/slides from docx/xlsx/pptx/pdf) → **KEEP** (F1–F7, P2). Biggest
  quality win per hour, and Workspace currently refuses these files outright.
- PDF highlight → quote linked to the page → **KEEP** as the merge of "Send to note" + "Checkpoint" (see pdfcraft).
- Video note: transcript + chapters + thumbnails, click to jump → **KEEP** (V1–V4).
- Drop a .glb/.stl → 3D viewer → **KEEP, folded into the live block** (a dropped model becomes a live
  block with A1 framing) rather than a separate viewer.
- Sheet block with formulas → **SKIP** (F8): databases already have a formula engine.
- Present any note as slides → **KEEP** (D1–D2), one menu item.

## Ideas this survey surfaced that weren't on the brief

- **P1** PdfViewer renders every page at once → visible-window rendering.
- **C1** Failed saves show "Saved" and can lose edits → local copy + retry + recovery.
- **P2/V2** "Use the source's own structure first": PDF bookmarks, YouTube creator chapters.
- **F3** Word equations → KaTeX math blocks.
- **F6** Chart data inside pptx/xlsx reaches the model as a table.

