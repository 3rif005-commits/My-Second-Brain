# Second Brain — AI-Powered Personal Knowledge OS

A Notion-style block editor with an AI ingestion pipeline. Drop a PDF or paste a URL and the AI generates a structured mastery guide directly into the editor.

---

## Architecture

```
frontend/   Next.js 16 (App Router, Turbopack)
backend/    FastAPI + Python 3.12
database/   Supabase (PostgreSQL + pgvector + Auth)
llm/        OpenRouter → google/gemma-4-26b-a4b-it:free
```

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, TypeScript, Tailwind CSS |
| Editor | BlockNote 0.48 (`@blocknote/mantine`, `@blocknote/xl-ai`) |
| Auth | Supabase Auth (ES256 JWT) |
| Database | Supabase PostgreSQL + pgvector |
| Backend | FastAPI, Uvicorn, Python 3.12 |
| LLM | OpenRouter `google/gemma-4-26b-a4b-it:free` (temp) → Gemini (production) |
| PDF extraction | PyMuPDF (fitz) |
| URL extraction | trafilatura |
| Embeddings | Google `gemini-embedding-001` (768-dim, Phase 3) |
| Tests | Playwright (e2e) |

---

## Running Locally

### Prerequisites
- Node.js 18+
- Python 3.12
- A Supabase project (free tier works)
- An OpenRouter API key (free tier)

### 1. Clone & configure

```bash
git clone git@github.com:3rif005-commits/Second-brain.git
cd Second-brain
```

**Frontend** — copy and fill in `frontend/.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
FASTAPI_URL=http://localhost:8000
```

**Backend** — copy and fill in `backend/.env`:
```
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_JWT_SECRET=<jwt-secret>
GOOGLE_API_KEY=<gemini-key>        # for embeddings (Phase 3)
OPENROUTER_API_KEY=<openrouter-key>
LLM_PROVIDER=openrouter            # or "gemini" when key is ready
FRONTEND_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
```

### 2. Database migrations

Run these in order in the Supabase SQL editor (Dashboard → SQL Editor):

```
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_rls_policies.sql
supabase/migrations/003_fix_handle_new_user.sql
supabase/migrations/004_vector_index.sql   ← Phase 3 (pgvector)
```

### 3. Start

```bash
# Terminal 1 — Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000 --reload

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

---

## Features

### Phase 1 — Foundation ✅
- Email/password auth (signup, login, logout)
- Protected routes (`/brain/*`)
- Sidebar with note list, "+ New Note", delete
- BlockNote block editor with 2s debounce auto-save
- Content persistence (Supabase JSONB)
- Title editing

### Phase 2 — Ingestion Pipeline ✅
- Drag-and-drop PDF upload → text extraction (PyMuPDF)
- URL paste → article extraction (trafilatura)
- LLM generates a **structured mastery guide** (HTML) via OpenRouter
- HTML parsed into BlockNote blocks and saved automatically
- Progress bar: Uploading → Extracting → Generating → Done
- Notes saved with title, topics, source metadata

### Phase 3 — Context Protocol 🔧
- `note_index` table with `vector(768)` embeddings (migration ready)
- `POST /retrieval/index` — embed and store a note
- `POST /retrieval/retrieve` — semantic similarity search
- `match_notes()` PostgreSQL function (cosine distance via pgvector)
- Chat UI and context-augmented tutor: **next session**

---

## Mastery Guide Prompt

The LLM generates structured HTML following a **two-layer system**:

- **Overview callout** (blue) — scannable in 2 min: What / How / Why / Takeaway
- **Deep Dive toggles** (`<details>`) — sub-concepts, definitions, code, tables
- `data-importance` on every `<h2>` (0–6 scale, maps to block background color)
- Callout color semantics: red=exam-critical, orange=watch-out, purple=insight, etc.
- Inline `<span data-color>` for concept contrast
- Hidden `<div data-type="metadata">` block for Phase 3 indexer

See `backend/prompts/mastery_guide.py` for the full prompt.

---

## LLM Provider Switching

Controlled by `LLM_PROVIDER` in `backend/.env`. No code changes needed.

| Value | Model | Use case |
|---|---|---|
| `openrouter` | `google/gemma-4-26b-a4b-it:free` | Current (free) |
| `gemini` | `gemini-2.0-flash` | Production (requires billing) |

To switch to Gemini:
```bash
# backend/.env
LLM_PROVIDER=gemini
GOOGLE_API_KEY=<key-with-billing-enabled>
```

**Next session plan:** replace OpenRouter with a **local LLM** (Ollama + Gemma 3 or similar). Update `LLM_PROVIDER=local` and wire up `services/llm.py` accordingly.

---

## Known Issues

| Issue | Cause | Status |
|---|---|---|
| First ingest after model cold-start takes ~4 min | OpenRouter free-tier model loading | Acceptable — passes reliably once warm |
| YouTube URL ingest returns 400 | `trafilatura` can't extract YT transcripts | Phase 4: add `yt-dlp` + `faster-whisper` |
| Gemini embedding API needs billing | `gemini-embedding-001` requires paid key | Phase 3 blocked until key is ready |

---

## Tests

```bash
cd frontend

# All tests (requires both servers running)
npx playwright test

# Phase 1 only
npx playwright test --project=notes-crud

# Phase 2 ingest (PDF upload — takes ~4 min on free LLM)
npx playwright test --project=ingest --grep "PDF"
```
