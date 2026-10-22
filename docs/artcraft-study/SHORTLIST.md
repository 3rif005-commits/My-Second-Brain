# ArtCraft study — SHORTLIST (Phase 2: you pick)

2026-10-22. Ten items from `FINDINGS.md`, ranked by benefit ÷ effort (rank number = overall
order). Sizes: **S** ≈ one session, **M** ≈ two to three, **L** ≈ four or more.
Every item adds **no new setting and no new panel**; where an item touches the UI it says exactly
what changes on screen.

## Workspace

| Rank | Item | Size | What the user sees | Files touched | From |
|---:|---|:-:|---|---|---|
| 2 | **Fast big PDFs** | S | A 300-page textbook opens and scrolls smoothly; only the pages near the screen are drawn (others are blank boxes of the right size until reached). | `frontend/components/workspace/viewers/PdfViewer.tsx` (+ test) | P1 pdfcraft |
| 3 | **Chapters from PDF bookmarks** | S | PDFs that have a table of contents get the author's exact chapter titles as note sections and jump chips, instead of guessed ones. | `backend/services/workspace/pdf_elements.py` (+ tests) | P2 pdfcraft |
| 4 | **Word, PowerPoint and Excel files in Workspace** | M | You can drop `.docx` `.pptx` `.xlsx` into a workspace. Headings, lists and tables stay in place; slides keep titles, tables, speaker notes and the numbers behind charts; sheets arrive as clean tables with real dates. Fixes the same weaknesses in the classic ingest path. | `backend/services/file_extractor.py` (rewrite of docx/pptx, new xlsx), `backend/services/workspace/processor.py`, `backend/routers/note_sources.py` (`_DOC_EXTS`), `frontend/lib/workspace.ts` (`ACCEPTED_WORKSPACE_FILES`), `frontend/components/workspace/SourceRail.tsx:232`, `backend/requirements.txt` (openpyxl), new `backend/tests/test_office_extract.py` with fixtures generated in the test | F1 F2 F5 F6 F7 R1 |
| 5 | **"Send to note" keeps the page** | S | Selecting PDF text and pressing *Send to note* inserts a quote ending in a page chip; clicking it jumps back to that page. The passage stays tinted in the PDF. (One button does what two did.) | `frontend/components/workspace/viewers/PdfViewer.tsx`, `frontend/components/workspace/NotePane.tsx` | pdfcraft section |
| 8 | **Equations from Word documents** | S | Equations in a `.docx` become real math blocks in the note instead of disappearing. | `backend/services/file_extractor.py` (new `omml_to_latex`) + tests | F3 wordcraft |
| 9 | **Video transcript and chapters** | M | Under a YouTube or uploaded video, a collapsed *Transcript* list: the current line highlights, click any line to jump. YouTube videos with creator chapters use those chapters; uploaded videos get a thumbnail per chapter. Filler words (um, uh…) are dropped before the AI reads it. | `backend/services/workspace/youtube.py` (chapters via yt-dlp metadata, filler strip), `backend/services/workspace/video.py`, `frontend/components/workspace/viewers/YouTubePlayer.tsx`, `VideoPlayer.tsx`, new `viewers/TranscriptList.tsx` | V1 V2 V3 V4 |

## Rest of the app

| Rank | Item | Size | What the user sees | Files touched | From |
|---:|---|:-:|---|---|---|
| 1 | **Never lose an edit** | S | If a save fails (offline, server restarting) the note says "Not saved — retrying" instead of "Saved", keeps your text safe in the browser and retries; reopening the note after a crash restores the unsaved text with one toast. Today a failed save still says "Saved" and closing the tab loses the edits. | `frontend/components/editor/NoteEditorPage.tsx` (`handleSaveContent`), new `frontend/lib/unsavedCopy.ts` (+ test with a fake fetch that fails/delays at random) | C1 cadcraft, R3 figcraft |
| 6 | **Live block: basics** | S | The existing interactive block grows to fit what it shows (no more fixed 300 px box with scrollbars); after the AI writes it you see the result straight away; asking the AI again changes the current block ("make the labels bigger") instead of starting over. | `frontend/components/editor/InteractiveBlockCard.tsx`, `frontend/components/interactive/InteractiveFrame.tsx`, `backend/skills/interactive-block-author.md`, `backend/services/agent/engine.py:611` (`run_interactive_turn`) | live-block evaluation 1, 4 |
| 7 | **Live block: diagrams, 3D and image export** | M | "Diagram this process" gives a clean Mermaid diagram; "a 3D model of a cell" (or dropping a `.glb`/`.stl` file) gives a 3D view that is already well lit and framed, rotate/zoom with the mouse; one ⤓ button saves the block as SVG/PNG, and that picture is what prints. Blocks can't reach the internet except the pinned library CDN. | `InteractiveBlockCard.tsx`, new `frontend/lib/liveBlockRuntime.ts` (injects Mermaid / three.js rig A1+A3 / KaTeX + CSP + resize), `InteractiveBlock.tsx` (fallback image prop), `backend/skills/interactive-block-author.md`, drop handler in `BlockEditor.tsx` | A1 A2 A3 A4 C2 VC4 |
| 10 | **Present a note** | M | *Present* in the note's `⋯` menu turns the note into full-screen slides: each big heading starts a slide, long slides shrink to fit or continue. Arrows/Space to move, a number + Enter to jump, G for all slides, B for black screen, Esc to leave. | new `frontend/components/editor/PresentMode.tsx`, `frontend/components/shell/PageMenu.tsx` (one item), `NoteEditorPage.tsx` | D1 D2 deckcraft |

## Not on the list, but free (docs/test habits, no user-visible change)

Adopt as we go, no separate work item: a ranked "Next" table at the top of `STATUS.md` (M6);
"what is and isn't verified" per feature (AI3/M8); one "hostile input never raises, never loses
text" test per extractor (F4/M3/P6); procedural fixtures plus one real file per format in the live
pass (R1/R2).

## Considered and cut

Sheet block with formulas (we have database formulas), declarative AI provider adapter, model
picker per tool, 3D-as-vector effects, image tracing, Lottie, real-time collaboration, presenter
view, OCR engine (only a no-text-page → vision fallback survives, as a possible later item).
LaTeX export is not cut: it fits the note menu's existing Export Markdown / Export PDF items (see FINDINGS F10).

## Build list (user decision 2026-10-22)

The ten above was only the review's size cap. The user chose to build the ten **plus** the extra
user-facing ideas from FINDINGS, in this order:

| # | Feature | Size | Status |
|---:|---|:-:|---|
| 1 | Never lose an edit (rank 1) | S | code + unit tests done; live check not passed yet |
| 2 | Fast big PDFs (rank 2) | S | code + unit tests done; no live check |
| 3 | Chapters from PDF bookmarks (rank 3) | S | done; verified on a real PDF (Labs-2.pdf: 10 bookmarks → 10 headings) |
| 4 | Word, PowerPoint and Excel files in Workspace (rank 4) | M | done; 14 tests; checked on 6 real files (FR/AR docx, xlsx, pptx). Live upload not checked (Supabase bucket MIME rules unverifiable from here) |
| 5 | "Send to note" keeps the page link (rank 5) | S | done (unit tests); the selection bar's separate Checkpoint button is gone. Not done: tinting the quoted passage (needs stored highlights, more than S). No live check |
| 6 | Live block: basics (rank 6) | S | done (unit tests): auto-height, result shown + saved after AI, AI edits a filled block. No live check |
| 7 | Live block: diagrams, 3D, image export, safety check (rank 7 + VC4) | M | done (unit tests; every generated script parsed): Mermaid / model-URL / HTML+`sbScene` kinds, CSP to pinned CDN, ⤓ export + print snapshot, warnings. No live check — CDN loading and WebGL unverified in a browser |
| 7b | Drop a `.glb`/`.stl` file into a note → 3D live block | S | done (unit + route tests): `POST /notes/{id}/model-asset` (≤50 MB, glb magic checked, long-lived link) + drop handler. Not checked in a browser (drop events, storage MIME) |
| 8 | Equations from Word documents (rank 8) | S | done; 19 tests; real lab sheet: 20 of 20 equations → LaTeX (12 were inside tables) |
| 9 | Video transcript and chapters (rank 9) | M | done (unit tests): collapsed transcript under YouTube/uploaded video, click to jump, creator chapters (yt-dlp) as headings for the list and the model, fillers stripped. Not done: chapter thumbnails for uploaded video (no chapters to hang them on). Only sources processed from now on get the list. No live check |
| 10 | Present a note as slides (rank 10) | M | done (unit tests): one *Present* menu item; title slide + one slide per h1/h2 from the note's own rendered blocks; toggles open; shrink-to-fit (floor 0.5, then scroll); keys from DeckCraft. Not done: splitting an overlong slide into a continued one. No live check |
| 11 | Photo of a whiteboard → Mermaid diagram (VC5) | S | done (unit + route tests): paste/drop a photo in the live block's AI box → vision task (switchboard + note privacy) → Mermaid. Needs a vision-capable provider; local text models can't. No live check |
| 12 | `.srt`/`.vtt` subtitle files as a video's transcript (V7) | S | done (unit tests): forgiving reader; alone = readable timed source; with a same-name uploaded video = its transcript (no Whisper), the subtitle source then leaves synthesis/chat. No live check |
| 13 | Scanned PDF page → vision model reads it (P3) | M | done (unit tests): pages with no text and a page-sized image go to the vision task (≤40 per file); all-scanned + no vision provider = clear failure message. Real PDFs: no false positives. No live check with a real scan |
| 14 | Export note as LaTeX, beside Export Markdown/PDF (F10) | S | done (unit tests): standalone .tex (sections, lists, tables, math kept, pictures as caption + link). Not compiled with a real TeX here (none installed) |
| 15 | Speaker labels in transcripts (V5) | M | done (unit tests on synthetic voices): uploaded video only, MFCC fingerprints + k-means, labels only when silhouette ≥ 0.25 and every speaker ≥ 12 % of speech; first 60 min; skipped without numpy/ffmpeg (numpy isn't in requirements.txt → off on Render). Never run on a real recording |

Done inside the items above, not as separate work: ranked "Next" table in STATUS.md (M6),
"verified / not verified" per feature (AI3/M8), hostile-input tests per extractor (F4/M3),
model size + checksum in `llama.sh setup` (AI4). A deeper second survey pass (PhotoCraft/LightCraft
AI tools, DesignCraft EPUB, craft-i18n, ArtCraft's other frontend libs) comes after #15 unless
moved up.

## Original pick prompt

Tell me which ranks to build (e.g. "1, 2, 4, 6, 7"). Phase 3 then takes them one at a time:
small plan → tests → code → live browser check → STATUS.md → CLI test commands → commit, and a
final "did we add a setting or panel?" check on each.
