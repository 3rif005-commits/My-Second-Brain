# Second Brain — Project Status

> Source of truth across all conversations. Read at session start, update at session end.
> Last updated: 2026-08-25

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
