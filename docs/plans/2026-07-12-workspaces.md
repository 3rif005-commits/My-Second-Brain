# Workspaces — Implementation Plan

> Phase 2 deliverable. Stack decisions and their rationale: `docs/research/workspace-research.md`.
> Scope: web only. Android gets a tracker entry in `ANDROID_PARITY.md`, no build.

## 0. Concept map

A **workspace** = canvas of cards. Two card kinds: **resources** (pdf/document,
youtube, uploaded video, website) and **note pages** (ordinary `notes` rows).
Importing a resource auto-processes it in the background (extract → chunk+embed →
AI summary) and creates its **output note** (the summary), which appears as a card
and opens beside the source in split view. Anchors (`t:` seconds / `p:` page)
link summary blocks to source positions in both directions. A workspace chat
answers grounded in the workspace's chunks with clickable anchored citations.

---

## 1. Data model — `supabase/migrations/012_workspaces.sql`

```sql
workspaces            id, user_id→profiles, name, icon, viewport jsonb ({x,y,zoom}),
                      created_at, updated_at, deleted_at
workspace_resources   id, workspace_id→workspaces, user_id, kind CHECK ('pdf','document',
                      'youtube','video','website'), title, source_url, storage_path,
                      mime_type, status CHECK ('queued','processing','ready','failed'),
                      error text, meta jsonb (pages/duration/thumbnail/author…),
                      summary_html text, note_id→notes (the output note),
                      pos_x,pos_y,width,height,z_index (canvas card),
                      created_at, updated_at
workspace_pages       id, workspace_id, user_id, note_id→notes UNIQUE-with-workspace,
                      pos_x,pos_y,width,height,z_index, created_at
resource_elements     id, resource_id, user_id, page int, element_type CHECK
                      ('text','heading','image','table','formula'), order_index int,
                      bbox jsonb ([x0,y0,x1,y1] PDF points), content text
                      (text / markdown table / latex), image_path text
resource_chunks       id, resource_id, workspace_id, user_id, chunk_index int,
                      chunk_text text, anchor_type CHECK ('time','page','section'),
                      anchor_start float, anchor_end float, embedding vector(768)
                      + HNSW index; RPC match_workspace_chunks(query_embedding,
                      match_user_id, target_workspace_id, match_count) → chunks+resource_id
note_anchors          id, note_id→notes, user_id, resource_id, block_id text,
                      anchor_type, anchor_start float, anchor_end float,
                      UNIQUE(note_id, block_id)
ai_providers          id, user_id, provider CHECK ('gemini','anthropic','openai',
                      'openai_compatible'), label, base_url, api_key, chat_model,
                      enabled bool, created_at
```

RLS owner-only policies on every table (same pattern as `note_links`). Storage
bucket `workspace-resources` (private) created via migration insert into
`storage.buckets`. All processing/back-end access uses the service-role key
(bypasses RLS), consistent with the rest of the backend.

## 2. Provider-agnostic AI layer — `backend/services/ai/`

- **`providers.py`** — `ProviderConfig` (from `ai_providers` rows + `.env` fallbacks:
  `google_api_key`→gemini, `anthropic_api_key`, `openai_api_key`,
  `openrouter_api_key`→openai_compatible). Capability map:
  gemini `{text, vision, video_native, long_context}`; openai/anthropic/openrouter
  `{text, vision*}` (vision flagged per model heuristic); local Gemma `{text}`.
- **`router.py`** — `pick(job, user_id) → ProviderChoice`. Job preference chains:
  - `summarize_video`: video_native → text (transcript input)
  - `summarize_text` / `chat`: any text provider → local
  - `formula_ocr` / `frame_description`: vision → None (caller degrades to image)
  - `transcribe`: (a) local faster-whisper if importable, (b) none
- **`client.py`** — `complete(choice, messages, stream=False)`:
  OpenAI-compatible HTTP for openai/openrouter/compatible (reuse httpx pattern from
  `agent/engine.py`), Anthropic Messages mapping, google-genai SDK for Gemini —
  including `Part.from_uri` (YouTube URL) and `Part.from_bytes` (PDF/image) inputs.
- Local fallback = existing `smart_router.get_endpoint()`.

## 3. Summarization — reuse & extend `mastery_guide.py`

`backend/prompts/workspace_summary.py`:
- imports `SYSTEM_PROMPT` from `prompts/mastery_guide.py` verbatim and appends a
  **workspace extension block**: every `<h2>` MUST carry `data-anchor="t:SECONDS"`
  (video, from transcript timestamps) or `data-anchor="p:PAGE"` (pdf/document) or
  `data-anchor="s:INDEX"` (website sections); skip Quick-Nav duplication rules
  unchanged; per-type input framing (transcript with `[mm:ss]` prefixes, page-tagged
  text `[page N]`, section-tagged web text).
- Output = same BlockNote-compatible HTML the editor already parses.

Anchor persistence: split view hands `summary_html` to `BlockEditor` via the
existing `ingestHtml` path; a new `onAnchors` callback (mirrors
`onInteractiveBlocks`) collects `data-anchor` values in document order **before**
parsing, matches them to heading blocks in order **after** parsing, and POSTs
`{block_id, anchor}` rows to the anchors endpoint.

## 4. Ingestion / processing pipeline — `backend/services/workspace/`

`processor.py` — `process_resource(resource_id)` run via FastAPI `BackgroundTasks`
at import time (and `/reprocess`). Status transitions on the row; failures write
`status=failed, error=…`. Steps per kind:

| kind | extract | elements | chunks (anchored) | summary input |
|---|---|---|---|---|
| pdf/document | `pdf_elements.py`: PyMuPDF `get_text("dict")` blocks, `find_tables()`→markdown+bbox, images→storage+bbox, formula candidates (math-font/symbol-density heuristic)→clip PNG | ✅ | per page/section, `page` anchors | `[page N]`-tagged text (or native PDF via Gemini) |
| youtube | `youtube.py`: oEmbed meta + `youtube-transcript-api` | — | 75-second transcript windows, `time` anchors | timestamped transcript, or URL direct to Gemini |
| video (upload) | `video.py`: store in bucket, ffprobe meta, faster-whisper transcript (optional import) | — | transcript windows, `time` anchors | timestamped transcript; degrade: keyframes→vision, else title-only stub note |
| website | `website.py`: trafilatura `bare_extraction(include_images/formatting/links)` | ✅ text/image sections | per section, `section` anchors | section-tagged text |

Then for all kinds: `embed_batch` chunks → `resource_chunks`; call summary job →
`summary_html`; create the output `notes` row (title = resource title, source_type
mapped, `content=[]`, `content_text=` plain text of summary) + `workspace_pages`
card next to the resource card; mark `ready`. Notes get indexed by the existing
note indexing on first save.

`media.py` — on-demand capture: `frame(resource, t)`, `clip(resource, a, b)`,
`audio(resource, a, b)`. Uploaded video: ffmpeg on the stored file. YouTube:
`yt-dlp --download-sections "*a-b"` to temp, then ffmpeg. Results land in the
bucket; returns signed URL. `formula_latex(element_id)`: element PNG → vision
provider → LaTeX (400 if no vision provider).

## 5. Grounded chat — `backend/services/workspace/chat.py`

`POST /workspaces/{id}/chat` (SSE, same event grammar as `/agent`): embed query →
`match_workspace_chunks` top-10 → system prompt (persona + numbered
`<sources>` block with anchor labels + hard rule: *every claim cites `[n]`; if
sources don't cover it, say so*) → stream via AI router (`chat` job). Final SSE
event `citations`: `[{n, resource_id, title, anchor_type, anchor_start, anchor_end}]`
for markers actually retrieved (unknown `[n]` never becomes a chip). Thread
persistence reuses `chat_threads` with a `workspace_id` metadata field in v1
(stored in `model_mode`-style column? no — keep threads ephemeral per session in v1;
messages held client-side).

## 6. Backend endpoints — `backend/routers/workspaces.py` (+ `ai_providers` in same file)

```
GET/POST           /workspaces                      list (with counts) / create
GET/PATCH/DELETE   /workspaces/{id}                 detail incl. resources+pages / rename+viewport / soft-delete
POST               /workspaces/{id}/resources       multipart file OR {url} (kind auto-detect) → row(queued) + background task
GET                /workspaces/{id}/resources       status polling (id, status, error, meta)
GET/PATCH/DELETE   /resources/{rid}                 detail incl. elements+summary_html / position,title / delete(+note keeps)
GET                /resources/{rid}/file            signed URL for viewer
POST               /resources/{rid}/reprocess
POST               /resources/{rid}/capture         {type: frame|clip|audio, start, end?} → {url}
POST               /resources/{rid}/formula-latex   {element_id} → {latex}
POST               /workspaces/{id}/pages           {note_id?|title?} add/create note card
PATCH/DELETE       /pages/{pageId}                  position / remove card
PUT                /notes/{noteId}/anchors          replace note_anchors for note (body: [{block_id, anchor_type, start, end, resource_id}])
GET                /notes/{noteId}/anchors
POST               /workspaces/{id}/chat            SSE grounded chat
GET/POST/PATCH/DELETE /ai-providers                 user provider keys
```

Auth: same `get_user_id(authorization)` JWT pattern as `routers/ingest.py`.
Register router in `main.py`.

## 7. Frontend

**Deps**: `@xyflow/react`, `react-pdf` (+`pdfjs-dist` worker config in next.config).

**Proxy routes** (`frontend/app/api/workspaces/...`) mirroring §6, same
JWT-forwarding pattern as `app/api/agent/route.ts` (SSE passthrough for chat,
multipart passthrough for upload).

**Pages**
- `app/(brain)/brain/workspaces/page.tsx` — workspace grid + create.
- `app/(brain)/brain/workspaces/[workspaceId]/page.tsx` — client canvas page.
- Sidebar (`Sidebar.tsx`): "Workspaces" nav entry.

**Components — `components/workspace/`**
- `WorkspaceCanvas.tsx` — React Flow instance, no edges; nodeTypes
  `{resource: ResourceCard, page: NotePageCard}`; `<NodeResizer>`; drag/resize →
  debounced PATCH; click-to-front z-index; toolbar (add source, add page, chat);
  double-click resource card → `SplitView`. Status polling (2 s) while any
  resource is queued/processing.
- `ResourceCard.tsx` — kind icon, thumbnail, status pill (queued/processing/ready/failed+retry).
- `NotePageCard.tsx` — note title + snippet preview; open in split (with its
  source if it has one) or navigate `/brain/{noteId}`.
- `SplitView.tsx` — overlay: left = viewer per kind, right = existing
  `NoteEditorPage`-style editor host for the output note (first open passes
  `summary_html` as `ingestHtml` + registers anchors); resizable divider; close → canvas.
- `viewers/PdfViewer.tsx` — react-pdf continuous scroll; per-page absolutely-
  positioned element overlays scaled from PDF points; hover/click element →
  action bar (Copy, Send to note, →LaTeX for formulas); text-layer selection →
  same bar; current-page tracking (IntersectionObserver) feeds sync; "Checkpoint"
  button (current page).
- `viewers/VideoPlayer.tsx` — uploaded: `<video>` with signed URL; frame capture
  client-side via canvas → upload; clip/audio via `/capture`; checkpoint at
  currentTime.
- `viewers/YouTubePlayer.tsx` — IFrame Player API wrapper; 500 ms `getCurrentTime()`
  poll feeds sync; frame/clip/audio via `/capture`; checkpoint.
- `viewers/WebsiteViewer.tsx` — rendered sections (text/images) as selectable
  elements with the same action bar.
- `useSourceSync.ts` — loads anchors; source position → active block (highlight +
  scrollIntoView, suppressed while user edits); block gutter click → seek/scroll source.
- `WorkspaceChat.tsx` + `CitationChip.tsx` — docked chat panel; SSE stream;
  `[n]` markers → chips from the `citations` event; chip click → open split view
  at anchor (seek / scroll to page).
- `useSendToNote.ts` — insertion bus into the open editor: text→paragraph,
  image/frame→image block (storage URL), table→parsed table blocks,
  latex→`math` block, checkpoint→`checkpoint` block, clip/audio→embed/link block.

**Custom BlockNote blocks** (registered in `BlockEditor.tsx` schema so every note
can render them):
- `math` — props `{latex}`, KaTeX render, click-to-edit LaTeX textarea.
- `checkpoint` — props `{resourceId, workspaceId, anchorType, value, label}`;
  renders pill; click → `/brain/workspaces/{workspaceId}?resource={rid}&t=…`/`&p=…`
  (canvas page opens split view and seeks — deep-link works from any note).

**Settings** — `app/(brain)/brain/settings/ai-providers/page.tsx`: provider list,
add key, test button.

## 8. Reuse of existing note/block system

Output notes are plain `notes` rows: same editor, same auto-save, same block
indexing (`/internal/reindex-note` path), searchable/linkable/@-mentionable.
Workspace only adds `workspace_pages` (canvas placement) and `note_anchors`
(sync). Deleting a workspace never deletes notes (cards removed; notes survive).
`sanitizeBlocks` in BlockEditor derives its whitelist from the schema, so new
custom blocks are automatically preserved.

## 9. Build order (Phase 3)

1. Migration 012 + `ANDROID_PARITY.md` entry
2. `services/ai/` (providers, router, client) + `prompts/workspace_summary.py`
3. `services/workspace/` extractors (pdf_elements, youtube, video, website) + processor + media + chat
4. `routers/workspaces.py` + register in `main.py` + requirements.txt additions (`yt-dlp`; `faster-whisper` optional)
5. Frontend proxy routes
6. Custom blocks (math, checkpoint) in BlockEditor schema
7. Canvas page + cards
8. SplitView + viewers + element overlay + send-to-note + sync
9. Workspace chat + citations
10. Settings page + sidebar nav

## 10. Test plan (Phase 4)

- **Backend pytest** (mocked Supabase/httpx, fixture PDF): pdf element extraction
  (blocks/tables/formula candidates + bboxes), youtube transcript chunking,
  website section extraction, AI router capability routing + degradation chains,
  summary prompt anchor injection, citation mapping (`[n]`→chunk, unknown marker
  dropped), workspace CRUD + resource import state machine, anchors endpoint.
- **Frontend**: `tsc --noEmit` + `next build` clean.
- **E2E manual checklist** (deliverable): start commands + click-path per flow
  (import each type → auto-process → split view → sync → element/frame/checkpoint
  extraction → deep link back → grounded chat citation click).
