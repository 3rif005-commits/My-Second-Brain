# Workspace Feature — Research Findings & Chosen Stack

> Phase 1 deliverable. Date: 2026-07-12
> Governing constraint discovered during codebase review: the backend runs on a
> 4 GB-RAM i3-5005U laptop (see PLAN.md hardware budget — ~2.7 GB is already
> committed to llama.cpp + FastAPI + Next.js). Any solution requiring PyTorch or
> multi-GB vision models **cannot run locally**. Heavy understanding jobs must
> route to configured API providers and degrade gracefully — which the spec's
> provider-agnostic AI layer (§6) already demands.

---

## 1. PDF layout / element extraction

**Candidates compared:** Docling, Marker, MinerU, PyMuPDF, Surya, unstructured.

| Tool | Elements + bboxes | Formulas → LaTeX | Runtime cost | Fit |
|---|---|---|---|---|
| **Docling** (IBM) | Full provenance: page, bbox, element type per chunk; TableFormer best-in-class tables | Yes (formula enrichment model) | PyTorch, ~2–4 GB models, slow on CPU | ❌ can't run on 4 GB host |
| **Marker** (datalab) | JSON tree with block types (`Text`, `SectionHeader`, `Table`, `Equation`, `Figure`, `Picture`, `Code`…) + polygon bboxes; images base64 | Yes (Surya-based) | Surya model family, PyTorch, GPU-oriented | ❌ same |
| **MinerU** | Strong layout, best CJK | Yes | PDF-Extract-Kit models, heaviest | ❌ same |
| **Surya** / Texify / pix2tex | OCR/layout/formula primitives | pix2tex/Texify: yes | PyTorch each | ❌ same |
| **unstructured** | Coarse elements, OCR fallback | No | Medium (detectron for hi-res mode) | ❌/⚠️ |
| **PyMuPDF** | `get_text("dict")`: blocks → lines → spans with bboxes + font info; `find_tables()` with cell bboxes → markdown; `get_images`/`get_image_bbox` for figures; vector-drawing clusters for diagrams | No (but exposes math-font spans for detection) | **Already installed**, C engine, milliseconds/page, no ML | ✅ chosen baseline |

**Decision: PyMuPDF as the local extraction engine, vision-LLM escalation for formulas.**

- PyMuPDF is already a dependency (`services/pdf_extractor.py` uses it), is by far
  the fastest free extractor, and yields exactly what the viewer needs: per-page
  text blocks, images, and tables **with bounding boxes** — enough to render
  selectable element overlays on top of a pdf.js canvas.
- Element typing heuristics on top of `dict` output: heading detection by font
  size, table regions from `find_tables()`, figure regions from image xrefs +
  clustered vector drawings, **formula candidates** from math-font spans
  (CMMI/CMSY/*Math*/Symbol fonts) and isolated short blocks with high symbol density.
- **Formulas → LaTeX**: local formula OCR (pix2tex/Texify) needs PyTorch — infeasible
  here. Instead the formula region is rendered to PNG (PyMuPDF `get_pixmap(clip=bbox)`)
  and sent through the provider layer to any configured **vision-capable model**
  (Gemini Flash / GPT-4o / Claude) with a "transcribe to LaTeX" prompt. No vision
  model configured → the element is sent to the note as an image (graceful degrade,
  spec §6). This also matches the spec's "editable math (LaTeX) when possible".
- Docling remains the documented upgrade path if the backend ever moves to real
  hardware (its JSON provenance maps 1:1 onto our element model).

## 2. Formula recognition

Covered above: **provider-layer vision OCR → LaTeX**, image fallback. Rendered in
notes with **KaTeX** (already a frontend dependency; used by the markdown chat
renderer) inside a custom BlockNote `math` block — the community-standard pattern
(`createReactBlockSpec` + katex, cf. BlockNote issue #741 and the
`blocknote-latex-block` sandbox).

## 3. YouTube ingestion

- **Transcript**: `youtube-transcript-api` (already in requirements.txt) returns
  `{text, start, duration}` snippets — exactly the timestamp anchors the synced
  summary needs. Rate-limit risk (~100–200 req/h/IP) is irrelevant at personal scale.
  Fallback: `yt-dlp` auto-caption download (json3) when the API is blocked.
- **Metadata/thumbnail**: YouTube oEmbed endpoint (no key) for title/author/thumbnail;
  `yt-dlp --dump-json` as the richer fallback (duration, chapters).
- **Playback**: official YouTube IFrame Player API — gives `seekTo()`,
  `getCurrentTime()`, and a timer loop for sync. Cross-origin video means
  **client-side frame capture is impossible** for YouTube.
- **Frames/clips/audio**: server-side, on demand — `yt-dlp --download-sections "*START-END"`
  fetches only the byte range, then ffmpeg extracts the frame (`-frames:v 1`),
  clip, or audio (`-vn -acodec …`). Lazy (at capture time), not at import — imports
  stay fast.
- If a **video-native model** (Gemini) is configured, the summary job can pass the
  YouTube URL directly (Gemini supports YouTube URLs natively); otherwise summary
  is generated from the timestamped transcript — the spec's degradation path.

## 4. Uploaded video files

- **Storage**: Supabase Storage bucket (`workspace-resources`), same infra as rest of app.
- **Transcript**: `faster-whisper` (base/int8, CPU) — ~2× faster than whisper.cpp on
  this class of CPU, pip-installable, bundles ffmpeg decoding via PyAV, gives
  word/segment timestamps. It's an *optional* dependency: unavailable/slow →
  degrade to (a) API transcription if a capable provider is configured, else
  (b) no transcript → summary from extracted keyframes via vision model, else
  (c) resource stays usable as plain video with manual notes (worst case).
- **Frames/clips/audio**: `ffmpeg` subprocess (`-ss T -frames:v 1` for frames,
  `-ss A -to B -c copy` for clips, `-vn` for audio). For *uploaded* (same-origin)
  video the frontend can additionally capture the current frame instantly from the
  `<video>` element via canvas — zero server round-trip.

## 5. Website import

**trafilatura** (already in requirements, already wrapped in `services/url_extractor.py`).
Upgrade for workspaces: `bare_extraction(..., include_images=True, include_formatting=True,
include_links=True)` to keep images and structure, giving selectable
paragraph/image elements. Firecrawl-style SaaS adds a key + cost for no local gain;
readability-lxml is a strictly weaker extractor kept as fallback only.

## 6. Canvas library for the workspace surface

| | tldraw | React Flow (@xyflow/react) | Konva | custom |
|---|---|---|---|---|
| Live React/DOM in cards (PDF viewer, `<video>`, BlockNote) | ✅ (DOM canvas) | ✅ nodes *are* React components | ❌ raster canvas; DOM overlay hacks | possible, weeks of work |
| Drag / resize / stack | ✅ | ✅ drag + `<NodeResizer>` + zIndex | manual | manual |
| License | **$6,000/yr commercial** (SDK 4.0), watermark on free tier | **MIT** | MIT | — |
| Fit as "cards on a table" (no edges) | whiteboard-first, heavier | works fine with zero edges; pan/zoom/minimap built in | — | — |

**Decision: React Flow (`@xyflow/react` v12).** MIT-licensed, nodes are plain React
components (so a card can host the live PDF viewer, a YouTube iframe, or the real
BlockNote editor), built-in pan/zoom/drag/resize/selection, and position/size
persist as simple `{x, y, width, height, zIndex}` JSON. tldraw is the better pure
whiteboard but its 4.x license ($6k/yr or watermark) is unacceptable for this app.
Konva cannot host live DOM components. We use React Flow with zero edges — purely
as a spatial card manager (an established pattern; "canvas" apps like NotebookLM-style
boards do exactly this).

## 7. Source ↔ summary sync pattern

**Anchor-annotated summary blocks + a lightweight sync engine.**

- The (extended) mastery-guide prompt emits `data-anchor` attributes on each section
  heading: `data-anchor="t:83.5"` (seconds) for video, `data-anchor="p:4"` for
  documents/websites (page number; websites use element index).
- After BlockNote parses the HTML, an ingest step walks the parsed blocks, pairs them
  with the extracted anchors in document order, and stores `(note_id, block_id,
  anchor_type, anchor_start, anchor_end)` rows in `note_anchors`. Anchors survive
  editing because they reference stable BlockNote block ids; the note itself stays a
  100 % ordinary note.
- **Forward sync** (source → note): video `timeupdate` / PDF viewer `onPageChange`
  → binary-search the anchor list → highlight + `scrollIntoView` the block.
- **Reverse sync** (note → source): a gutter chip on anchored blocks → `seekTo(t)` /
  `scrollToPage(p)`.
- Checkpoints are the same mechanism materialized as content: a custom `checkpoint`
  BlockNote block `{resourceId, anchorType, value, label, thumbnail?}` that deep-links
  anywhere (even outside the workspace: `/brain/workspaces/{id}?resource={rid}&t=83`).

## 8. PDF viewer

**react-pdf (wojtekmaj, pdf.js)** — canvas + text layer per page, so text is natively
selectable; our element overlays (from PyMuPDF bboxes, scaled from PDF points to
rendered pixels) render as absolutely-positioned divs per page. Page visibility via
IntersectionObserver drives forward sync. `react-pdf-selection` exists but is
unmaintained; a thin custom overlay on react-pdf is simpler and matches our
server-known element boxes.

## 9. Provider-agnostic LLM layer

| | LiteLLM | Vercel AI SDK | thin custom adapter |
|---|---|---|---|
| Language fit | Python ✅ | TS only (backend is Python) ❌ | Python ✅ |
| Capability routing (video-native etc.) | partial; documented bugs dropping image/video parts on cross-provider fallback (GH #15803, #30501) | — | exactly as needed |
| Weight | large dep surface | — | ~200 lines |
| Existing code | — | — | `services/agent/model.py` already implements per-provider endpoint construction; `google-genai` already in requirements |

**Decision: thin custom adapter, extending the existing pattern.** A
`services/ai/` module with:
- a **capability registry**: each configured provider advertises
  `{text, vision, video_native, long_context}`;
- **job-type routing**: `summarize_video → video_native > vision > text(transcript)`,
  `formula_ocr → vision`, `summarize_text/chat → text`, always falling back to the
  local Gemma endpoint (SmartRouter) last;
- OpenAI-compatible chat-completions for OpenRouter/OpenAI/custom-base-URL providers
  (reusing the engine's SSE loop), **google-genai SDK** for Gemini (needed anyway for
  native video/PDF understanding, which OpenAI-compat endpoints can't express),
  Anthropic Messages API for Claude.
- Per-user provider keys stored in a new `ai_providers` table (encrypted at rest is
  out of scope for v1; keys already live in `.env` today — table mirrors that model
  per user with service-role-only access).

LiteLLM would duplicate what `model.py` does, add a heavy dependency to a 4 GB box,
and its multimodal cross-provider fallback is exactly the part that's still buggy.

## 10. Grounded RAG with citations

Pattern (per Tensorlake "Citation-Aware RAG" and NotebookLM behavior): **preserve
anchors at index time, force citation markers at generation time.**

- Ingest chunks every resource into `resource_chunks` with
  `{resource_id, chunk_index, text, anchor_type, anchor_start, anchor_end}`
  (timestamp ranges for video, page + block range for PDFs, section index for web),
  embedded with the existing nomic-embed pipeline (768-dim, llama.cpp :8081) into
  pgvector — same infra as `note_chunks`.
- Workspace chat retrieves top-K chunks **scoped to the workspace's resources** via a
  `match_resource_chunks(workspace_id)` RPC, numbers them `[1]..[K]` in the prompt,
  and instructs the model to cite with bracketed markers after every claim
  (the existing `cite-everything` skill establishes the same convention).
- The stream is post-processed: `[n]` → citation chip carrying
  `{resourceId, anchorType, anchorValue}`; click → opens split view at that
  page/timestamp. Uncited-marker hallucinations are dropped (only markers matching
  retrieved chunk ids render as chips — same anti-hallucination guard the tutor
  prompt already uses for note ids).

## Chosen stack — summary

| Concern | Choice | Why (one line) |
|---|---|---|
| PDF elements | PyMuPDF dict/tables/images + heuristics | already installed, ms/page on CPU, real bboxes |
| Formula → LaTeX | vision LLM via provider layer, image fallback | no PyTorch on a 4 GB host; spec's graceful-degrade |
| Math rendering | KaTeX custom BlockNote block | katex already a dep; standard pattern |
| YouTube | youtube-transcript-api + oEmbed + yt-dlp/ffmpeg on demand | timestamps for free; lazy heavy work |
| Uploaded video | Supabase Storage + ffmpeg + faster-whisper (optional) | local, cheap, degrades cleanly |
| Websites | trafilatura with images/formatting | already in repo, best-in-class F1 |
| Canvas | React Flow (@xyflow/react) | MIT; nodes are live React components; tldraw costs $6k/yr |
| PDF viewer | react-pdf + custom element overlay | text layer + our own bbox overlays |
| Sync | `data-anchor` in prompt → `note_anchors` table → sync engine | notes stay ordinary; anchors keyed to stable block ids |
| LLM layer | thin custom adapter + capability routing (`services/ai/`) | Python, ~200 lines, native Gemini video; LiteLLM buggy here |
| Grounded chat | workspace-scoped pgvector chunks with anchor metadata + `[n]` markers | reuses embed infra; citations map to exact spots |
| Summarization | extended `mastery_guide.py` prompt + per-type adaptations | spec §3 mandate |

### Sources

- [Marker vs MinerU vs MarkItDown (2026)](https://jimmysong.io/blog/pdf-to-markdown-open-source-deep-dive/) · [Marker vs Docling vs MinerU vs PyMuPDF4LLM](https://themenonlab.blog/blog/best-open-source-pdf-to-markdown-tools-2026) · [Docling vs Marker vs LlamaParse tables](https://codecut.ai/docling-vs-marker-vs-llamaparse/) · [Self-hosting Docling/Marker/MinerU](https://www.spheron.network/blog/self-host-document-intelligence-docling-marker-mineru-rag-guide/)
- [Marker JSON output & block types](https://github.com/datalab-to/marker)
- [PyMuPDF text extraction details](https://pymupdf.readthedocs.io/en/latest/app1.html) · [PyMuPDF tables/OCR guide](https://www.nutrient.io/blog/extract-text-from-pdf-pymupdf/) · [Page API (find_tables, get_pixmap)](https://pymupdf.readthedocs.io/en/latest/page.html)
- [youtube-transcript-api](https://pypi.org/project/youtube-transcript-api/) · [YouTube transcript developer guide](https://skipthewatch.com/blog/youtube-transcript-api-guide) · [yt-dlp](https://github.com/yt-dlp/yt-dlp) · [yt-dlp --download-sections + ffmpeg](https://www.aleksandrhovhannisyan.com/notes/video-cli-cheat-sheet/)
- [whisper.cpp vs faster-whisper 2026 benchmarks](https://www.promptquorum.com/power-local-llm/local-whisper-stt-comparison-2026) · [faster-whisper](https://github.com/SYSTRAN/faster-whisper) · [Whisper variants comparison](https://modal.com/blog/choosing-whisper-variants)
- [tldraw license](https://tldraw.dev/community/license) · [tldraw 4.0 licensing debate ($6k/yr)](https://biggo.com/news/202509190115_tldraw_SDK_4.0_Licensing_Debate) · [React Flow MIT confirmation](https://github.com/xyflow/xyflow/discussions/3397) · [React Flow NodeResizer](https://reactflow.dev/examples/nodes/node-resizer) · [tldraw repo](https://github.com/tldraw/tldraw)
- [PDF.js layers in React](https://www.react-pdf-kit.dev/blog/understanding-pdfjs-layers-and-how-to-use-them-in-reactjs) · [react-pdf-selection](https://github.com/MathiasMeuleman/react-pdf-selection)
- [LiteLLM multimodal fallback drops image data (#15803)](https://github.com/BerriAI/litellm/issues/15803) · [LiteLLM video_url for Gemini unsupported (#30501)](https://github.com/BerriAI/litellm/issues/30501) · [LiteLLM router guide](https://www.gingerlabs.ai/blog/litellm-router-setup-guide)
- [Citation-aware RAG (Tensorlake)](https://www.tensorlake.ai/blog/rag-citations) · [NotebookLM grounding behavior](https://atoms.dev/blog/notebooklm)
- [BlockNote custom blocks](https://www.blocknotejs.org/docs/features/custom-schemas/custom-blocks) · [BlockNote KaTeX block issue](https://github.com/TypeCellOS/BlockNote/issues/953/linked_closing_reference?reference_location=REPO_ISSUES_INDEX) · [blocknote-latex-block sandbox](https://codesandbox.io/s/blocknote-latex-block-txrgpg)
