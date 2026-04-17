# Second Brain — Project Status

> Source of truth across all conversations. Read at session start, update at session end.
> Last updated: 2026-04-17

---

## How to Resume a Conversation

```
Read /home/ayoub/projects/second_brain/STATUS.md and
/home/ayoub/projects/second_brain/PLAN.md, then continue
from where we left off.
```

---

## Current Phase

**Phase 3 — Context Protocol** `[~] SCAFFOLDED — blocked on Gemini billing for embeddings`

---

## Phase Tracker

| Phase | Name               | Status          | Started    | Completed  |
|-------|--------------------|-----------------|------------|------------|
| 1     | Foundation         | ✅ Complete     | 2026-04-15 | 2026-04-15 |
| 2     | Ingestion Pipeline | ✅ Complete     | 2026-04-15 | 2026-04-17 |
| 3     | Context Protocol   | 🔧 In progress  | 2026-04-17 | —          |
| 4     | Polish & Expansion | Not started     | —          | —          |

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

### Model selector wire-up
- `X-LLM-Model` header flows: ingest page → Next.js proxy (`route.ts`) → FastAPI (`ingest.py`) → `llm.py` `model_override` param
- `ingest_auto`, `ingest_pdf`, `ingest_url` all accept `x_llm_model: str | None = Header(default=None)`

### Known limitations
- YouTube URL returns 400 — trafilatura can't extract YT transcripts (Phase 4: yt-dlp + whisper)
- Nemotron 120B cold-start on first request after model idle: ~3–5 min (acceptable, passes reliably once warm)
- Gemini embeddings blocked until billing is enabled on Google AI key

---

## Phase 3 — SCAFFOLDED 🔧

### What's built (code exists, not yet live)
- `supabase/migrations/004_vector_index.sql` — `note_index` table, `vector(768)` column, HNSW index, `match_notes()` RPC function, RLS policies
- `backend/services/embedder.py` — calls `gemini-embedding-001` (768-dim) via google-genai SDK
- `backend/services/retriever.py` — semantic search via Supabase RPC `match_notes`
- `backend/routers/retrieval.py` — `POST /retrieval/index`, `POST /retrieval/retrieve`
- `backend/main.py` — retrieval router registered

### What's blocked
- **Migration 004** not yet run in Supabase SQL editor (user needs to run it)
- **Gemini billing** not enabled → `gemini-embedding-001` returns 429 quota error
- Chat UI not built yet (next session)

### Next session plan
1. Replace OpenRouter with **local LLM (Ollama + Nemotron or Gemma 3)** — `LLM_PROVIDER=local`, wire `services/llm.py`
2. Switch embeddings to a free local alternative (e.g., `nomic-embed-text` via Ollama) or enable Gemini billing
3. Run migration 004 in Supabase SQL editor
4. Build chat UI at `/brain/chat`
5. Update PLAN.md phases to reflect local LLM direction

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
| LLM provider | OpenRouter (free tier) |
| Primary model | `nvidia/nemotron-3-super-120b-a12b:free` — faster, better quality |
| Fallback model | `google/gemma-4-26b-a4b-it:free` |
| Model selector | `X-LLM-Model` header: frontend → proxy → FastAPI → llm.py `model_override` |
| JWT validation | `supabase.auth.get_user(token)` — works for both HS256 and ES256 |
| pydantic-settings | Does NOT populate `os.environ` — always use `settings.field_name` |
| Streaming | `stream=True` on OpenRouter — prevents free-tier timeout cutoffs |
| Ingest HTML handoff | `sessionStorage["ingest-pending-{note_id}"]` — read in NoteEditorPage on mount |
| Embeddings | `gemini-embedding-001` (768-dim) — blocked until Gemini billing enabled |
| Retrieval | Supabase RPC `match_notes()` — no direct DB connection needed |
| xl-ai server import | dynamic `import("@blocknote/xl-ai/server")` — CJS require() fails |
| SSR fix | `BlockEditor` loaded via `dynamic(() => import(...), { ssr: false })` |
| Middleware file | `proxy.ts` (Next.js 16 renamed from middleware.ts) |

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
| Next       | Replace OpenRouter with local Ollama LLM              | Free, no rate limits, fully offline, better for development  |
