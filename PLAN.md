# Second Brain — Research, Data Models & Build Plan

> LLM: **Nemotron 120B** (primary) + **Gemma 4 26B** (fallback) via OpenRouter free tier  
> Next session: migrate to local LLM via Ollama  
> Last updated: 2026-04-17

---

## Research Summary

### Q1 — BlockNote + `@blocknote/xl-ai` Streaming Integration

The `@blocknote/xl-ai` package is built on top of the **Vercel AI SDK** as its transport layer.
The editor does not receive raw text — it receives a stream of **tool calls** that the LLM makes
to add, update, or delete blocks in the document.

**Wire format — `aiDocumentFormats.html`:**  
BlockNote serializes the current document to HTML and sends it along with the user's message to
the backend. The backend injects this HTML state into the message history via
`injectDocumentStateMessages()`, giving the LLM a structured view of the document. The LLM then
issues tool calls (`add_paragraph`, `update_block`, `delete_block`, etc.) that the client applies live.

**Backend route (Next.js App Router, using Gemma 4 via Google AI SDK):**
```typescript
// app/api/ai/route.ts
import { google } from "@ai-sdk/google";
import { convertToModelMessages, streamText } from "ai";
import {
  aiDocumentFormats,
  injectDocumentStateMessages,
  toolDefinitionsToToolSet,
} from "@blocknote/xl-ai/api";

export async function POST(req: Request) {
  const { messages, toolDefinitions } = await req.json();
  const result = streamText({
    model: google("gemma-4"),          // Gemma 4 via Google AI
    system: aiDocumentFormats.html.systemPrompt,
    messages: convertToModelMessages(injectDocumentStateMessages(messages)),
    tools: toolDefinitionsToToolSet(toolDefinitions),
    toolChoice: "required",
    maxSteps: 10,
  });
  return result.toUIMessageStreamResponse();
}
```

**Client-side setup:**
```tsx
import { AIExtension, createBlockNoteAIClient, aiDocumentFormats } from "@blocknote/xl-ai";
const aiClient = createBlockNoteAIClient({ baseURL: "/api/ai" });
const editor = useCreateBlockNote({
  extensions: [
    AIExtension({ model: aiClient, dataFormat: aiDocumentFormats.html }),
  ],
});
```

**System prompt:** `aiDocumentFormats.html.systemPrompt` is BlockNote's built-in prompt.
You prepend your custom instructions (e.g., "Generate a mastery guide with H2 headers") before
this prompt.

**Packages needed:** `@blocknote/xl-ai`, `@ai-sdk/google`, `ai` (Vercel AI SDK v6+).

**License caveat:** `@blocknote/xl-ai` is GPL-3.0. Commercial use requires a BlockNote Business license.

---

### Q2 — BlockNote Custom Block API

Use `createReactBlockSpec` from `@blocknote/react`:

```typescript
import { createReactBlockSpec } from "@blocknote/react";
import { BlockNoteSchema } from "@blocknote/core";

const PrerequisiteLink = createReactBlockSpec(
  {
    type: "prerequisiteLink",
    propSchema: {
      noteId:    { default: "" },
      noteTitle: { default: "Prerequisite" },
      href:      { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block }) => (
      <a href={block.props.href} className="prerequisite-link">
        🔗 {block.props.noteTitle}
      </a>
    ),
  }
);

const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...BlockNoteSchema.create().blockSpecs, // keep built-ins
    prerequisiteLink: PrerequisiteLink,
    knowledgeRef:     KnowledgeRef,
    masteryBadge:     MasteryBadge,
  },
});

const editor = useCreateBlockNote({ schema });
```

Custom blocks are registered at schema-creation time, must be present on every editor instance
that may load documents containing them, and are fully serializable in the JSON document.

---

### Q3 — BlockNote JSON Persistence

A BlockNote document is a `Block[]` array. Each block:
```typescript
{
  id:       "abc123",        // stable UUID
  type:     "heading",       // built-in or custom type
  props:    { level: 2, textColor: "default", backgroundColor: "default" },
  content:  [{ type: "text", text: "Introduction", styles: { bold: true } }],
  children: []               // nested blocks
}
```

**PostgreSQL JSONB:** Store as a `jsonb` column. No transformation needed —
`JSON.stringify(editor.document)` round-trips perfectly through PostgreSQL `jsonb`.

```sql
content JSONB NOT NULL DEFAULT '[]'::jsonb
```

**Restore on page load:**
```typescript
const editor = useCreateBlockNote({
  initialContent: note.content?.length > 0
    ? (note.content as PartialBlock[])
    : undefined,
  schema,
});
```

**GIN index** for full-text search on content (Phase 4):
```sql
CREATE INDEX notes_content_gin ON notes USING GIN (content);
```

---

### Q4 — pgvector Semantic Indexing

**Embedding model:** `gemini-embedding-001` (Google, 768 dimensions) — correct SDK name is `models/gemini-embedding-001` in google-genai SDK. Requires Gemini billing.
Local alternative: `nomic-embed-text` via Ollama (768-dim, free, offline).
Fallback: `text-embedding-3-small` (OpenAI, 1536 dims).

**Column definition:**
```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE note_index ADD COLUMN embedding vector(768); -- Google text-embedding-004
```

**Index strategy:**
| Dataset size   | Recommended index | Rationale                                      |
|----------------|-------------------|------------------------------------------------|
| < 50K notes    | None (seq scan)   | Fast enough, no index overhead                 |
| 50K–500K       | IVFFlat           | Fast build, adequate recall                    |
| > 500K         | HNSW              | Best query speed, stable recall at scale       |

```sql
-- HNSW (recommended for production):
CREATE INDEX note_index_embedding_hnsw ON note_index
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

**Top-K retrieval query:**
```sql
SELECT
  n.id, n.title, n.content_text,
  ni.deep_link, ni.summary, ni.topics,
  1 - (ni.embedding <=> $1::vector) AS similarity
FROM note_index ni
JOIN notes n ON n.id = ni.note_id
WHERE ni.user_id = $2
  AND 1 - (ni.embedding <=> $1::vector) > 0.72
ORDER BY ni.embedding <=> $1::vector
LIMIT 8;
```

(`<=>` = cosine distance; `1 - distance = similarity`)

---

### Q5 — Context Protocol System Prompt Injection

**Safe size:** Gemma 4 has a large context window (128K tokens). Keep the injected knowledge
block under **~12K tokens** to leave room for conversation history and the response. At ~400
tokens per note summary, that's ~30 notes max. In practice inject the **top 5–8 semantically
similar notes** — enough context, minimal noise.

**Format (structured XML):**
```xml
<knowledge_context>
  <note id="uuid-1" title="Derivatives & Chain Rule" deep_link="/brain/uuid-1" mastery="mastered">
    User has fully mastered: power rule, chain rule, product rule, quotient rule.
    Key insight noted: "chain rule is function composition in reverse."
  </note>
  <note id="uuid-2" title="Integration by Parts" deep_link="/brain/uuid-2" mastery="learning">
    User is actively learning. Struggling with choosing u and dv. Has seen 3 examples.
  </note>
</knowledge_context>
```

**System prompt injection pattern:**
```python
TUTOR_SYSTEM = """You are a personalized AI tutor. The user's existing knowledge base:

{knowledge_context}

Rules:
- Reference their notes as markdown links: [Note Title](/brain/NOTE_ID)
- Build on mastered concepts without re-explaining them
- Focus on "learning" and "not_started" concepts
- Never hallucinate note IDs — only reference IDs present in <knowledge_context>
"""
```

**Anti-hallucination guard:** Only reference note IDs that are explicitly present in
`<knowledge_context>`. Validate all deep links server-side before streaming them to the client.

---

### Q6 — PDF + Video Ingestion Pipeline

**PDF — structure-preserving extraction:**

| Library       | Use case                     | Notes                                    |
|---------------|------------------------------|------------------------------------------|
| `pymupdf`     | Primary — text + layout      | Fastest, handles most PDFs               |
| `pdfplumber`  | Tables and columnar text     | More accurate for tables                 |
| `unstructured`| Mixed/scanned PDFs           | Uses OCR fallback                        |

```python
import fitz  # pymupdf

def extract_pdf(path: str) -> str:
    doc = fitz.open(path)
    pages = [page.get_text("blocks") for page in doc]
    return "\n\n".join(
        "\n".join(b[4] for b in page if b[6] == 0)
        for page in pages
    )
```

**Known failure modes:** Password-protected PDFs, image-only scanned PDFs (needs OCR),
multi-column academic papers (column ordering may break).

**Video/Audio transcription:**
```python
import yt_dlp
from faster_whisper import WhisperModel

def download_audio(url: str, output_path: str) -> str:
    ydl_opts = {"format": "bestaudio", "outtmpl": output_path, "quiet": True}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])
    return output_path

def transcribe(audio_path: str) -> str:
    model = WhisperModel("base.en", device="cpu", compute_type="int8")
    segments, _ = model.transcribe(audio_path, beam_size=5)
    return " ".join(s.text for s in segments)
```

**Versions:** `pymupdf>=1.24.0`, `yt-dlp>=2024.11.0`, `faster-whisper>=1.0.3`

**Known failure modes:** YouTube geo-restricted videos, videos >2hrs (chunk audio),
private videos.

---

### Q7 — Next.js ↔ FastAPI Communication

**Architecture decision:** For Phase 1–2, use **Next.js API routes as a proxy** to FastAPI.
This keeps CORS simple and allows automatic JWT forwarding.

**Next.js proxy route:**
```typescript
// app/api/ingest/route.ts
export async function POST(req: Request) {
  const supabase = createServerClient(/* ... */);
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${process.env.FASTAPI_URL}/ingest`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${session?.access_token}`,
      "Content-Type": req.headers.get("Content-Type") ?? "application/json",
    },
    body: req.body,
  });
  return new Response(res.body, { status: res.status });
}
```

**FastAPI JWT verification:**
```python
import jwt

async def get_current_user(authorization: str = Header()):
    token = authorization.replace("Bearer ", "")
    payload = jwt.decode(token, SUPABASE_JWT_SECRET,
                         algorithms=["HS256"], audience="authenticated")
    return payload["sub"]  # user_id
```

**CORS config:**
```python
app.add_middleware(CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_URL", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## Data Models

### PostgreSQL Table Schemas

```sql
-- auth.users managed by Supabase Auth

CREATE TABLE profiles (
  id                UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email             TEXT        NOT NULL,
  full_name         TEXT,
  avatar_url        TEXT,
  preferences       JSONB       NOT NULL DEFAULT '{}',
  subscription_tier TEXT        NOT NULL DEFAULT 'free'
                    CHECK (subscription_tier IN ('free','pro','enterprise')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE collections (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  parent_id   UUID        REFERENCES collections(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  icon        TEXT        NOT NULL DEFAULT '📁',
  color       TEXT        NOT NULL DEFAULT '#6366f1',
  position    INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  collection_id   UUID        REFERENCES collections(id) ON DELETE SET NULL,
  title           TEXT        NOT NULL DEFAULT 'Untitled',
  content         JSONB       NOT NULL DEFAULT '[]',
  content_text    TEXT,
  source_type     TEXT        CHECK (source_type IN ('manual','pdf','video','audio','url','text')),
  source_url      TEXT,
  source_filename TEXT,
  topics          TEXT[]      NOT NULL DEFAULT '{}',
  mastery_status  TEXT        NOT NULL DEFAULT 'not_started'
                  CHECK (mastery_status IN ('not_started','learning','reviewing','mastered')),
  is_indexed      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE note_index (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id       UUID        NOT NULL UNIQUE REFERENCES notes(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  embedding     vector(768),               -- Google text-embedding-004
  summary       TEXT        NOT NULL DEFAULT '',
  topics        TEXT[]      NOT NULL DEFAULT '{}',
  prerequisites TEXT[]      NOT NULL DEFAULT '{}',
  deep_link     TEXT        NOT NULL DEFAULT '',
  indexed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE chat_sessions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title            TEXT,
  messages         JSONB       NOT NULL DEFAULT '[]',
  context_note_ids UUID[]      NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## Phase 1 Plan — Foundation

**Goal:** A working authenticated app with a Notion-style block editor that saves and
restores notes from PostgreSQL.

**Definition of done:** User signs up → sees sidebar → opens a note → types in the block
editor → content auto-saves → refreshes page → content is still there.

### Features (in implementation order)

1. Supabase project setup — enable pgvector, run migrations, configure RLS, Storage bucket
2. TypeScript database types — `lib/types/database.ts` mirroring all table schemas
3. Supabase client helpers — browser client, server client (SSR-safe), middleware helper
4. Auth middleware — protect `/brain/*`, redirect authenticated users away from `/login`
5. Auth pages — `/login` (email + password), `/signup`
6. Root layout + globals — Tailwind CSS variables, BlockNote CSS imports
7. App shell layout — sidebar + main content area
8. Collections API — `GET/POST /api/collections`, `PUT/DELETE /api/collections/[id]`
9. Notes API — full CRUD at `/api/notes` and `/api/notes/[noteId]`
10. Sidebar + NoteTree — collection tree, "New Note" button, active note highlight
11. BlockEditor component — `useCreateBlockNote` + `BlockNoteView`, 2-second debounced auto-save
12. Note page — `/brain/[noteId]` — server fetch → pass to client editor
13. New note flow — `/brain/new` server component creates note, redirects to its page
14. Title editing — editable h1 above editor, saved on blur
15. Note deletion — delete button with confirmation

### Files to Create

```
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_rls_policies.sql
frontend/package.json
frontend/tsconfig.json
frontend/next.config.ts
frontend/tailwind.config.ts
frontend/postcss.config.mjs
frontend/.env.local.example
frontend/middleware.ts
frontend/app/layout.tsx
frontend/app/globals.css
frontend/app/page.tsx
frontend/app/(auth)/login/page.tsx
frontend/app/(auth)/signup/page.tsx
frontend/app/(brain)/layout.tsx
frontend/app/(brain)/brain/new/page.tsx
frontend/app/(brain)/brain/[noteId]/page.tsx
frontend/app/api/notes/route.ts
frontend/app/api/notes/[noteId]/route.ts
frontend/app/api/collections/route.ts
frontend/app/api/collections/[collectionId]/route.ts
frontend/components/editor/BlockEditor.tsx
frontend/components/editor/NoteEditorPage.tsx
frontend/components/sidebar/Sidebar.tsx
frontend/components/sidebar/NoteTree.tsx
frontend/components/ui/button.tsx
frontend/components/ui/input.tsx
frontend/lib/supabase/client.ts
frontend/lib/supabase/server.ts
frontend/lib/hooks/useNotes.ts
frontend/lib/hooks/useCollections.ts
frontend/lib/types/database.ts
backend/main.py
backend/requirements.txt
backend/.env.example
backend/core/config.py
backend/models/note.py
backend/routers/notes.py
backend/services/database.py
```

### Dependency Order

```
Migrations → TS types → Supabase clients → Middleware
→ Auth pages → Root layout → App shell
→ API routes → Hooks → Components → Pages
```

### Milestone

User can: sign up → see empty sidebar → click "New Note" → editor opens →
type content → auto-saves → refresh → content restored.

---

## Phase 2 Plan — Ingestion Pipeline ✅ COMPLETE

**Goal:** User drops a PDF or pastes a URL → LLM generates a structured mastery guide →
parsed into BlockNote blocks and saved automatically.

**Definition of done:** Drop a PDF → structured note with H2 sections, callouts, and
deep-dive toggles appears in the editor → content saved → persists after reload.

### What was built

- `frontend/app/(brain)/brain/ingest/page.tsx` — model selector UI (Nemotron default / Gemma fallback) + dropzone + progress steps
- `frontend/app/api/ingest/route.ts` — Next.js proxy to FastAPI, forwards JWT + `X-LLM-Model` header
- `frontend/components/ingestion/IngestDropzone.tsx` — drag-drop PDF + URL input
- `frontend/components/ingestion/IngestionProgress.tsx` — Uploading → Extracting → Generating → Done
- `backend/routers/ingest.py` — `/ingest/pdf`, `/ingest/url`, `/ingest/` (auto-dispatch), reads `x_llm_model` header
- `backend/services/pdf_extractor.py` — PyMuPDF text extraction
- `backend/services/url_extractor.py` — trafilatura article extraction
- `backend/services/llm.py` — OpenRouter client (streaming), `generate_mastery_guide(model_override)`, `extract_metadata()`
- `backend/prompts/mastery_guide.py` — two-layer HTML prompt: overview callout + deep-dive toggles

### LLM Provider

| Value | Model | Notes |
|-------|-------|-------|
| `openrouter` (current) | `nvidia/nemotron-3-super-120b-a12b:free` (primary) | Fast, best quality |
| `openrouter` (fallback) | `google/gemma-4-26b-a4b-it:free` | Selectable in UI |
| `gemini` (future) | `gemini-2.0-flash` | Needs billing enabled |
| `local` (next session) | Ollama + Nemotron/Gemma3 | Fully offline, no rate limits |

Controlled by `LLM_PROVIDER` in `backend/.env`. No code changes needed to switch.

### Known limitations
- YouTube URL returns 400 — trafilatura can't extract YT transcripts (Phase 4: yt-dlp + whisper)
- Nemotron 120B free tier: cold-start ~3–5 min after idle; warm requests are fast

---

## Phase 3 Plan — Context Protocol 🔧 IN PROGRESS

**Goal:** The AI tutor knows the user's entire knowledge base and references their
specific notes in responses.

**Definition of done:** User asks "explain chain rule" → tutor responds with a personalized
explanation that links to `/brain/[noteId]` and says "as you noted in your Derivatives guide..."

### Already scaffolded (code exists)

- `supabase/migrations/004_vector_index.sql` — `note_index` table + HNSW index + `match_notes()` RPC + RLS — **needs to be run in Supabase SQL editor**
- `backend/services/embedder.py` — `gemini-embedding-001` (768-dim) — **blocked on Gemini billing**
- `backend/services/retriever.py` — semantic search via `match_notes()` Supabase RPC
- `backend/routers/retrieval.py` — `POST /retrieval/index`, `POST /retrieval/retrieve`

### Still to build (next session)

1. **Local LLM** — replace OpenRouter with Ollama (`LLM_PROVIDER=local`); wire `services/llm.py`
2. **Local embeddings** — `nomic-embed-text` via Ollama (or enable Gemini billing)
3. **Run migration 004** in Supabase SQL editor
4. Chat UI at `frontend/app/(brain)/brain/chat/page.tsx`
5. `/api/chat` Next.js route — context-augmented system prompt injection
6. `backend/prompts/tutor.py` — tutor system prompt with `{knowledge_context}` placeholder
7. Context panel — sidebar showing which notes were retrieved

### New Files Still Needed

```
frontend/app/(brain)/brain/chat/page.tsx
frontend/app/api/chat/route.ts
frontend/components/chat/ChatInterface.tsx
frontend/components/chat/MessageBubble.tsx
frontend/components/chat/ContextPanel.tsx
backend/prompts/tutor.py
```

### Milestone

Open chat, ask a question, receive a response citing two of your own notes with
working deep links back into the editor.

---

## Phase 4 Plan — Polish & Expansion

**Goal:** Production-ready, full-featured.

### Features (in implementation order)

1. Video/audio ingestion — `yt-dlp` + `faster-whisper` transcription, chunked for long content
2. URL scraping — `trafilatura` + `readability-lxml` for clean article extraction
3. Custom BlockNote blocks:
   - `PrerequisiteLink` — links to another note, shows mastery status badge
   - `KnowledgeRef` — inline citation with popover note summary on hover
   - `MasteryBadge` — per-section status, clickable to cycle through states
4. Knowledge graph view — D3.js force-directed graph of notes and prerequisite links
5. Mastery tracking — per-section status, aggregate score, dashboard with progress rings
6. Full-text search — PostgreSQL `tsvector` + GIN index across `content_text`
7. Export — Markdown, HTML, PDF via `@react-pdf/renderer`
8. Mobile-responsive UI — collapsible sidebar, touch-friendly block handles
9. Note backlinks — "Referenced by N notes" panel in the editor sidebar
10. Async indexing queue — Supabase Edge Functions for background embedding

### New Files

```
frontend/components/blocks/PrerequisiteLink.tsx
frontend/components/blocks/KnowledgeRef.tsx
frontend/components/blocks/MasteryBadge.tsx
frontend/components/graph/KnowledgeGraph.tsx
frontend/app/(brain)/brain/graph/page.tsx
frontend/app/(brain)/brain/search/page.tsx
frontend/app/(brain)/brain/dashboard/page.tsx
backend/routers/search.py
backend/services/video_extractor.py
backend/services/export_service.py
supabase/migrations/004_full_text_search.sql
supabase/migrations/005_backlinks.sql
```

### Milestone

Full production app: ingest any media format, AI tutor with personal context,
knowledge graph, mastery dashboard, full-text search, export to Markdown/PDF.

---

## Key Package Versions

### Frontend
```json
{
  "@ai-sdk/google": "^1.2.0",
  "@blocknote/core": "^0.20.0",
  "@blocknote/mantine": "^0.20.0",
  "@blocknote/react": "^0.20.0",
  "@blocknote/xl-ai": "^0.20.0",
  "@mantine/core": "^7.16.0",
  "@supabase/ssr": "^0.6.1",
  "@supabase/supabase-js": "^2.49.0",
  "ai": "^6.0.0",
  "next": "14.2.29",
  "react": "^18"
}
```

### Backend (Python)
```
fastapi>=0.115.0
uvicorn>=0.32.0
python-multipart>=0.0.12
supabase>=2.10.0
pymupdf>=1.24.0
yt-dlp>=2024.11.0
faster-whisper>=1.0.3
google-generativeai>=0.8.0
pgvector>=0.3.6
asyncpg>=0.30.0
pydantic>=2.9.0
pydantic-settings>=2.6.0
python-jose[cryptography]>=3.3.0
trafilatura>=2.0.0
```

---

## Environment Variables

### Frontend (`.env.local`)
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
FASTAPI_URL=http://localhost:8000
```

### Backend (`.env`)
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret
GOOGLE_API_KEY=your-google-ai-key        # for embeddings (Phase 3, needs billing)
OPENROUTER_API_KEY=your-openrouter-key   # current LLM provider
LLM_PROVIDER=openrouter                  # "openrouter" | "gemini" | "local"
FRONTEND_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres
```

### LLM_PROVIDER values

| Value | Model used | When to use |
|-------|-----------|-------------|
| `openrouter` | Nemotron 120B (primary) / Gemma 4 (fallback) | Current — free tier |
| `gemini` | `gemini-2.0-flash` | When Gemini billing is enabled |
| `local` | Ollama (next session) | Fully offline development |
