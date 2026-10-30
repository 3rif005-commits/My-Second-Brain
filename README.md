# Second Brain — AI-Powered Personal Knowledge OS

## Nebius x NVIDIA Global AI Hackathon (Personal AI track)

**Second Brain is one home for everything you know** (lectures, PDFs, videos, links, plans) with an
AI that works on it, while you stay in control of what it sees. Every AI call in the demo runs on
**NVIDIA Nemotron on Nebius Token Factory**.

- Demo: https://second-brain-webmcp.vercel.app (demo account: see the Devpost page)
- Video (under 3 minutes): see the Devpost page

### How it uses Nemotron on Nebius

Two kinds of model, chosen per request by a switchboard (rules, then a small model, then a slot):

| Role | Model (Nebius Token Factory) | Used for |
|---|---|---|
| Brain + Fast | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | reads each request and decides where it runs; everyday answers |
| Strong | `nvidia/nemotron-3-super-120b-a12b` | study guides from sources, derivations, building interactive blocks |
| Private (by design) | a small Nemotron on your own machine or VM | the only model allowed to read notes marked Private |

Every answer shows which model ran and why (Settings → Routing → Activity logs each call).
Web research uses **Tavily**, and the exact query is shown for your OK before anything leaves.

Code: `backend/services/nebius.py` (provider, demo-account lock), `backend/services/web_research.py`
(Tavily). Every hackathon touchpoint is marked `HACKATHON-NEBIUS` / `HACKATHON-TAVILY`;
details and removal steps in `docs/hackathon/NEBIUS.md` and `docs/hackathon/TAVILY.md`.

### Run it

1. Supabase project: run `supabase/migrations/*.sql` in order in the SQL editor.
2. Backend: `cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt`,
   copy `.env.example` to `.env`, fill the Supabase values and:
   ```
   NEBIUS_API_KEY=...            # Nebius Token Factory key
   NEBIUS_ONLY_USERS=<user id>   # optional: lock an account to Nemotron only
   TAVILY_API_KEY=...            # optional: web research
   ```
   then `.venv/bin/uvicorn main:app --port 8000`.
3. Frontend: `cd frontend && npm ci`, copy `.env.local.example` to `.env.local`, `npm run dev`.
4. Or both at once: `./app.sh start`.

**Known limit:** YouTube refuses caption and media requests from many cloud servers (the hosted
backend on Render among them). There, a YouTube source gets its transcript from a subtitle file
added to the same session; frame and clip capture from YouTube need the app running on a home
connection (`./app.sh start`), which is how the demo video was recorded.

### The plan: from a notebook to a second brain

The app stands on three pillars. Everything it does serves one of them:

| Pillar | What it means | What the app does today |
|---|---|---|
| **Store** | Keep what you learn, in a structure that lasts | Blocks and databases; sources (PDF, web, video, audio) kept beside the notes made from them; a privacy level on every note; search over all of it |
| **Link** | Connect each new thing to what you already know | Links and backlinks between notes; database relations; every AI claim cites the exact page or moment it came from; hover a link to see the passage |
| **Analyse** | Turn what is stored and linked into understanding and action | Nemotron study guides from your sources; answers grounded in your own notes; interactive blocks built on request; web research; a small model that reads each request and decides where it runs |

One rule runs under all three: **you decide what the AI may see**, and private things stay on
hardware you own. Capture is the door into the pillars: the more the brain can take in, the more
it can store, link and analyse.

The plan grows the three pillars in five phases:

| Phase | Name | What it adds | Status |
|---|---|---|---|
| 1 | **Foundation**: the knowledge substrate | Blocks and databases: one structure that can hold any kind of knowledge and link it (pages, rows, properties, relations, backlinks) | Built |
| 2 | **Agency**: the agent layer | An AI that works on that substrate: the routing switchboard and privacy rules, skills, MCP tools, web research, and a learning loop (after Hermes Agent) that drafts new skills you approve before they are kept | Built (this hackathon) |
| 3 | **Reach**: universal capture | Everything digital you take in, not only what you upload. PDFs, web pages, YouTube, video and audio work today; next come social media, newsletters, messages, podcasts and bookmarks, captured as you consume them | Started |
| 4 | **Ownership**: a dedicated device | A small, portable box that runs the small Nemotron and keeps your private memory on it. Your second brain becomes something you own and carry; the cloud only does the heavy work you allow | Idea |
| 5 | **Presence**: the physical world | Real-life input from smart glasses, wearables and sensors: what you see, hear and do becomes notes, processed on your own device under the same privacy rules | Idea |

Phases 1 and 2 build the brain: where knowledge lives, and the mind that works on it. Phases 3 to 5
widen its senses: from the files you give it, to your whole digital life, to the physical world.
Phase 4 comes before phase 5 on purpose: before the brain sees your real life, it has to run on
hardware you own.

---


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

**Quick way — one command for everything:**

```bash
./app.sh start   # backend + frontend + local llama.cpp servers (if set up), all in the background
./app.sh status  # check what's running
./app.sh logs    # tail backend + frontend logs
./app.sh stop    # kill everything
```

**Manual way — one terminal per service:**

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
