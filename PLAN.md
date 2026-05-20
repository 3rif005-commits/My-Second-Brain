# Second Brain — Research, Data Models & Build Plan

> LLM: **Gemma 4 E2B** via LiteRT/MediaPipe on tablet (primary) · **Nemotron 120B** via OpenRouter (fallback)  
> Embeddings: nomic-embed-text via llama.cpp on laptop CPU (always local)  
> Last updated: 2026-05-12

---

## Hackathon Sprint Plan — Kaggle "Gemma 4 Good" (deadline May 18, 2026)

> Prize targets: **LiteRT $10K** · **Cactus $10K** · **llama.cpp $10K** · **Main Track**  
> Architecture locked: tablet = LiteRT inference · laptop = server + embeddings · cloud = fallback only

### Infrastructure Decisions

| Decision | Chosen | Dropped | Reason |
|---|---|---|---|
| Tablet inference | LiteRT / MediaPipe (NPU) | llama.cpp Vulkan | NPU faster, native Android, broader device support |
| Laptop inference | llama.cpp embeddings only | Generation on laptop | i3-5005U at 3 tok/s unusable for demo |
| Local gen backend | LiteRT on tablet | Ollama | Ollama redundant with llama.cpp in our stack |
| Fine-tuning | Deferred (Unsloth) | — | Base Gemma 4 + good prompt sufficient; revisit if output quality insufficient |

### Final Infrastructure Map

```
TABLET (Snapdragon 7s Gen 2 · Adreno 710 · 6-8GB RAM)
  LiteRT Android app  →  Gemma 4 E2B  →  /v1/chat/completions :8082
  Chrome browser      →  Second Brain web app (PWA)

LAPTOP (i3-5005U · 4GB RAM — server only)
  FastAPI             →  orchestration, Supabase, routing
  Next.js             →  web app served to tablet browser
  llama.cpp :8081     →  nomic-embed-text (embeddings, always local)
  llama.cpp :8080     →  Gemma 4 E2B (slow demo only — llama.cpp prize)

CLOUD
  OpenRouter          →  Nemotron 120B (fallback when tablet offline)

SmartRouter (backend/services/router.py):
  embed / rerank  →  llama.cpp laptop :8081  (always)
  chat / generate →  LiteRT tablet :8082     (primary, health-checked)
                  →  OpenRouter cloud         (fallback)
```

---

### A — SmartRouter

**Goal:** Replace blunt `LLM_PROVIDER` env var with a service that routes per task and
health-checks the tablet before every generation call.

**Files to create / modify:**

```
backend/services/router.py          NEW — SmartRouter class
backend/core/config.py              ADD litert_url, tablet_health_timeout fields
backend/services/llm.py             MODIFY — call router.route(task) instead of settings.llm_provider
backend/routers/chat.py             MODIFY — use SmartRouter for generation
backend/.env                        ADD LITERT_URL=http://[tablet-ip]:8082
```

**SmartRouter logic:**
```python
class SmartRouter:
    TASK_MAP = {
        "embed":    "llamacpp",       # always laptop
        "generate": "litert",         # tablet primary
        "chat":     "litert",         # tablet primary
        "metadata": "litert",         # tablet primary
    }

    def route(self, task: str) -> str:
        target = self.TASK_MAP.get(task, "openrouter")
        if target == "litert" and not self._tablet_alive():
            return "openrouter"
        return target

    def _tablet_alive(self) -> bool:
        # HEAD /health on tablet, 2s timeout, cached 30s
```

**Definition of done:** Drop a question in chat → logs show `router → litert` or `router → openrouter`
depending on whether the tablet is online.

---

### B — Retrieval Quality

**Goal:** Fix the retrieval root cause. Current problem: the full note is embedded as one vector
from the first 500 chars of raw `content_text` — often the PDF title page. Replace with
per-section embeddings so retrieval finds the right *section*, not just the right note.

**New table:**
```sql
-- migration 007_note_chunks.sql
CREATE TABLE note_chunks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id     UUID        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  chunk_index INTEGER     NOT NULL,
  chunk_text  TEXT        NOT NULL,
  embedding   vector(768),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX note_chunks_user_idx ON note_chunks(user_id);
CREATE INDEX note_chunks_embedding_hnsw ON note_chunks
  USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);

-- RPC: returns best chunk per note, deduplicates
CREATE OR REPLACE FUNCTION match_chunks(...)
```

**Files to create / modify:**
```
supabase/migrations/007_note_chunks.sql   NEW
backend/services/chunker.py               NEW — split by \n## / \n# / double-newline after heading
backend/routers/ingest.py                 MODIFY — call chunk_and_embed() after note insert
backend/services/retriever.py             MODIFY — query note_chunks, threshold 0.70, top 8
```

**Chunking strategy:**
```python
def chunk_text(text: str) -> list[str]:
    # split on markdown/plain section headers: ## Title, # Title, or ALL-CAPS lines
    # minimum chunk size: 150 chars (skip title-only headers)
    # maximum chunk size: 800 chars (split long sections at paragraph boundaries)
```

**Definition of done:** Ask "explain chain rule" → retrieved chunk contains actual chain rule
explanation, not the PDF title page.

---

### C — Disco Blocks (Analyse Pillar)

**Goal:** When the LLM generates a mastery guide, it also generates self-contained HTML/CSS/JS
visualizations for concepts that benefit from interactivity. These render as sandboxed iframes
inside the BlockNote editor — live, interactive, offline.

**Design constraint:** LLM generates **vanilla JS + Canvas API only** — no CDN imports,
no external libraries. Must work inside `sandbox="allow-scripts"` iframe with no network.

**Files to create / modify:**
```
frontend/components/blocks/InteractiveBlock.tsx    NEW — custom BlockNote block
frontend/components/editor/BlockEditor.tsx         MODIFY — register InteractiveBlock in schema
frontend/components/editor/NoteEditorPage.tsx      MODIFY — parse data-type="interactive" → block
backend/prompts/mastery_guide.py                   MODIFY — add interactive block generation
```

**InteractiveBlock spec:**
```tsx
// Props: { html: string, title: string }
// Renders: <iframe sandbox="allow-scripts" srcDoc={html} />
// Stored: in BlockNote content JSONB as { type: "interactive", props: { html, title } }
```

**Prompt addition (for sections where visualization helps):**
```html
<!-- After the deep-dive toggle, for visual concepts: -->
<div data-type="interactive" data-title="[Concept Name] — Interactive">
<canvas id="c" width="640" height="360"></canvas>
<script>
// self-contained vanilla JS only — no imports, no fetch
// draws the concept on the canvas
</script>
</div>
```

**LLM guidance rule:** Only generate for: algorithms, physics, math functions, signal processing,
circuits, geometry. Never for: history, law, literature, purely conceptual text.

**Definition of done:** Ingest a calculus PDF → note contains a live function plotter that works
offline inside the editor.

---

### D — LiteRT Android App

**Goal:** Minimal Kotlin app on the tablet that runs Gemma 4 E2B via MediaPipe LLM Inference
and exposes an OpenAI-compatible HTTP endpoint. The laptop backend calls this endpoint;
the web app stays unchanged.

**Architecture:** headless Android service (no visible UI) + Ktor embedded HTTP server.

**Files:**
```
android/app/src/main/java/com/secondbrain/InferenceServer.kt    NEW
android/app/src/main/java/com/secondbrain/MainActivity.kt       NEW (minimal, just starts service)
android/app/build.gradle.kts                                    NEW
android/build.gradle.kts                                        NEW
```

**Key dependencies:**
```kotlin
// build.gradle.kts
implementation("com.google.mediapipe:tasks-genai:0.10.14")
implementation("io.ktor:ktor-server-netty:2.3.7")
```

**Endpoint exposed:**
```
POST http://[tablet-ip]:8082/v1/chat/completions
  body: { model, messages, stream, max_tokens }
  response: SSE stream (same format as llama.cpp and OpenRouter)
```

**Model file:** Gemma 4 E2B in `.task` format from Google AI Edge model hub.
Downloaded to `/sdcard/Download/gemma4_e2b.task` on tablet.

**Definition of done:** `curl http://[tablet-ip]:8082/v1/chat/completions` from laptop
→ streams a response generated by Gemma 4 on the tablet's NPU.

---

### E — PWA

**Goal:** Second Brain is installable on the tablet home screen. Works offline
(cached shell, assets). This is the mobile-first story for the Cactus prize.

**Files to create / modify:**
```
frontend/public/manifest.json        NEW — name, icons, theme_color, display: standalone
frontend/public/icons/               NEW — 192×192 and 512×512 app icons
frontend/app/layout.tsx              MODIFY — add <link rel="manifest"> and PWA meta tags
```

**Definition of done:** On tablet Chrome → menu → "Add to Home Screen" → app icon appears →
tap it → opens full-screen without browser chrome.

---

### F — MCP Deep Link Verification

**Goal:** Confirm the Link pillar works end-to-end. External AI (Claude Desktop) calls
`search_brain`, gets back notes with `/brain/note-id` deep links, user clicks → opens the note.

**Verification steps:**
1. Run `search_brain("calculus")` via Claude Desktop → check returned `deep_link` values
2. Click a returned deep link → confirm it opens the correct note in the browser
3. Verify `get_note(note_id)` returns full content
4. Fix any `undefined` or wrong URLs in `backend/mcp_server.py`

---

### Demo Script

Three-minute arc showing all three pillars:

```
0:00–0:40  ANALYSE
  Drop a PDF about sorting algorithms
  Watch Gemma 4 (on tablet NPU via LiteRT) generate the mastery guide
  Show the Interactive Block — a live animated sort comparison — inside the editor

0:40–1:20  STORE
  The note is in the block editor — show mastery status, topics, deep-dive toggles
  Show it works on the tablet browser (PWA installed on home screen)
  Show it works offline — airplane mode on, note still loads

1:20–2:00  LINK — Chat
  Ask "compare merge sort and quicksort" in the AI tutor
  SmartRouter routes to tablet LiteRT — show the routing log
  Tutor answers citing the specific note with a deep link — click it → goes to note

2:00–2:40  LINK — MCP
  Switch to Claude Desktop
  Type: search_brain("sorting algorithms")
  Show the returned note with deep link
  Click → opens Second Brain in browser at exactly that note

2:40–3:00  CLOSE
  Show the tablet running inference (htop or MediaPipe stats)
  "Runs on any Android 12+ device with 4GB RAM — no server, no cloud required"
```

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

## Notion UX Phase — Special Insert

> This phase was added after Phase 3 and before Phase 4 to close UX gaps between what we built
> and what Notion provides as baseline. It upgrades Phase 1's foundation (trash, search, icons,
> breadcrumbs, sidebar drag-reorder, properties panel) without adding new AI features.
> Full plan and task tracker → [`NOTION_PHASE.md`](./NOTION_PHASE.md)

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

## Phase 3 Plan — Context Protocol + MCP + Local LLM ✅ CODE COMPLETE

**Goal:** The AI tutor knows the user's entire knowledge base and references their
specific notes in responses. Any external AI (Claude Desktop, ChatGPT, Gemini) can
query the Second Brain via MCP or REST.

**Hackathon target:** Kaggle "Gemma 4 Good" hackathon (deadline May 18, 2026)
- **llama.cpp special prize** ($10K): Gemma 4 E2B/E4B on 4GB RAM constrained hardware
- **Future of Education impact prize** ($10K): personal AI tutor with adaptive knowledge retrieval

**Definition of done — ALL MET:**
1. ✅ User asks a question in the built-in chat → tutor responds citing their own notes with deep links
2. ✅ Claude Desktop connects via MCP → `search_brain` tool returns relevant notes from Second Brain
3. ✅ `LLM_PROVIDER=llamacpp` runs Gemma 4 E2B locally, fully replacing OpenRouter when desired

---

### LLM Provider Strategy

| `LLM_PROVIDER` value | Model | When to use |
|---|---|---|
| `openrouter` | Nemotron 120B (primary) / Gemma 4 (fallback) | Cloud fallback — free tier |
| `llamacpp` | Gemma 4 E2B Q4_K_M (local, port 8080) | Default — offline / hackathon demo |
| `gemini` | `gemini-2.0-flash` | Future — when billing enabled |

| `EMBEDDER_PROVIDER` value | Model | Notes |
|---|---|---|
| `llamacpp` | `nomic-embed-text` v1.5 GGUF (port 8081) | Default — free, offline, batch support |
| `gemini` | `gemini-embedding-001` (768-dim) | Future — when billing enabled |

---

### Hardware budget (4GB RAM, ~23GB disk)

| Component | RAM | Disk |
|---|---|---|
| Gemma 4 E2B Q4_K_M + KV q8_0 | ~1.8 GB | ~1.2 GB |
| nomic-embed-text v1.5 GGUF | ~0.4 GB | ~0.27 GB |
| FastAPI + Next.js + system | ~0.5 GB | — |
| **Total** | **~2.7 GB** ✅ | **~1.5 GB** ✅ |

Generation server flags: `--flash-attn --cache-type-k q8_0 --cache-type-v q8_0` — reduces RAM ~40%.

---

### All built ✅

| File | Description |
|---|---|
| `llama.sh` | `setup / start / stop / status / logs` — single entry point for llama.cpp stack |
| `backend/services/embedder.py` | llama.cpp embedder with `embed()` + `embed_batch()` |
| `backend/services/retriever.py` | Supabase RPC `match_notes()`, threshold 0.50, top 8 |
| `backend/routers/chat.py` | Streaming SSE chat, retrieves context before answering |
| `backend/routers/internal.py` | Key-authenticated internal API for MCP |
| `backend/routers/retrieval.py` | `POST /retrieval/index`, `POST /retrieval/retrieve` |
| `backend/mcp_server.py` | MCP server: `search_brain`, `get_note`, `list_notes` |
| `backend/prompts/tutor.py` | Tutor system prompt with XML knowledge context |
| `frontend/app/(brain)/brain/chat/page.tsx` | AI Tutor page |
| `frontend/app/api/chat/route.ts` | Next.js SSE proxy |
| `frontend/components/chat/ChatInterface.tsx` | Streaming chat UI |
| `frontend/components/chat/MessageBubble.tsx` | Message rendering |
| `frontend/components/chat/ContextPanel.tsx` | Retrieved notes sidebar |
| `supabase/migrations/004_vector_index.sql` | `note_index` table + HNSW + `match_notes()` ✅ RUN |

---

### To run end-to-end

```bash
./llama.sh setup    # first time — builds llama.cpp, downloads models (~1.5 GB)
./llama.sh start    # starts gen (8080) + embed (8081) servers
# set LLM_PROVIDER=llamacpp in backend/.env
# start backend + frontend
# ingest a PDF → auto-indexed
# open /brain/chat → tutor cites your notes
```

---

### New Files

```
backend/mcp_server.py                              ← MCP server (Claude Desktop integration)
frontend/app/(brain)/brain/chat/page.tsx
frontend/app/api/chat/route.ts
frontend/components/chat/ChatInterface.tsx
frontend/components/chat/MessageBubble.tsx
frontend/components/chat/ContextPanel.tsx
backend/prompts/tutor.py
```

---

### Milestone

1. `LLM_PROVIDER=llamacpp` — ingest a PDF → Gemma 4 E2B generates mastery guide locally
2. Open `/brain/chat` → ask a question → tutor answers citing 2+ of your own notes with deep links
3. Claude Desktop → `search_brain("calculus chain rule")` → returns your notes with summaries

---

### ⚠️ Future Iteration Note (for hackathon writeup)

**Offline-first mode** is the natural next step: replace Supabase with a local PostgreSQL +
pgvector instance (Docker or native). Combined with llama.cpp local inference and local embeddings,
the entire Second Brain runs with zero internet dependency — suitable for classrooms with
spotty internet, medical sites far from data centers, or privacy-critical environments.
This aligns directly with the hackathon's "Global Resilience" and "Digital Equity" tracks.

---

## Phase 4 Plan — Native Android App (Play Store)

**Goal:** Turn the existing LiteRT inference service into a full standalone Second Brain app —
auth, notes, editor, AI chat, PDF ingestion — all on the tablet, no laptop required, published on Google Play.

### What's already built

| Component | File | Status |
|---|---|---|
| LiteRT inference (Gemma 4 E2B, CPU) | `android/app/.../LlmService.kt` | ✅ working |
| Ktor HTTP server (port 8082) | `android/app/.../LlmService.kt` | ✅ working |
| Foreground service + notification | `android/app/.../LlmService.kt` | ✅ working |
| Supabase schema (notes, vectors, chunks) | `supabase/migrations/` | ✅ live |
| Mastery guide prompt | `backend/prompts/mastery_guide.py` | ✅ Python — needs Kotlin port |
| PDF ingestion logic | `backend/routers/ingest.py` | ✅ Python — needs Android port |
| Chunk + embed pipeline | `backend/services/chunker.py` | ✅ Python — needs Android port |

### What's missing (in build order)

| # | Feature | Implementation |
|---|---|---|
| 1 | **Supabase Kotlin SDK** | Add `io.github.jan-tennert.supabase:postgrest-kt`, `gotrue-kt`, `realtime-kt` to `build.gradle.kts` |
| 2 | **Auth screens** | Compose Login + Signup calling `supabase.auth.signInWith(Email)` |
| 3 | **Notes list screen** | Compose LazyColumn, `supabase.from("notes").select()` filtered by user |
| 4 | **Note editor** | WebView loading BlockNote bundled as static assets in APK — reuses all existing editor code |
| 5 | **Chat screen** | Compose UI calling LiteRT directly (no HTTP hop needed — same process) |
| 6 | **PDF ingestion** | Android file picker → `PdfRenderer` extracts text → Gemma generates note → saved to Supabase |
| 7 | **On-device embeddings** | `all-MiniLM-L6-v2` converted to LiteRT format (~22 MB) — replaces laptop llama.cpp dependency |
| 8 | **Semantic search** | Call Supabase `match_notes()` RPC from Android — same SQL, same vectors |
| 9 | **Play Store release** | Signing keystore + `release` build variant + Play Console listing |

### Key architecture decision: Note Editor

Use a **WebView** loading BlockNote as bundled static HTML/JS assets inside the APK:
- Build the editor as a standalone HTML page (BlockNote works without Next.js)
- Serve it from Ktor on `localhost` — already running inside the app
- WebView points to `http://localhost:8082/editor`
- Supabase calls go from JS directly to Supabase cloud — no backend proxy needed
- Zero extra infrastructure — reuses all existing editor code

### New Android files needed

```
android/app/src/main/java/com/secondbrain/tablet/
  auth/LoginActivity.kt          — Compose login/signup
  notes/NotesListActivity.kt     — Compose notes list
  notes/NoteEditorActivity.kt    — WebView wrapping BlockNote
  chat/ChatActivity.kt           — Compose chat UI, calls LlmService directly
  ingest/PdfIngestActivity.kt    — file picker + PdfRenderer + ingest flow
  data/SupabaseClient.kt         — singleton Supabase client
  data/NotesRepository.kt        — notes CRUD + search via Supabase
  embeddings/EmbeddingEngine.kt  — LiteRT MiniLM for on-device embeddings

android/app/src/main/assets/editor/
  index.html                     — standalone BlockNote editor page
  (bundled JS/CSS)
```

### Milestone

One APK on Google Play: open it on any Android 12+ tablet with 4 GB RAM,
log in with Supabase, ingest PDFs, write notes, chat with Gemma 4 — fully offline.

---

## Phase 5 Plan — Web App Polish & Expansion

**Goal:** Production-ready web app, full-featured.

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
8. Note backlinks — "Referenced by N notes" panel in the editor sidebar
9. Async indexing queue — Supabase Edge Functions for background embedding

### Milestone

Full production web app: ingest any media format, AI tutor with personal context,
knowledge graph, mastery dashboard, full-text search, export to Markdown/PDF.

---

## Phase 5 Plan — Offline-First (Local PostgreSQL)

**Goal:** Remove all cloud dependencies. The entire Second Brain runs on the local machine
with zero internet — suitable for classrooms with spotty connectivity, privacy-critical
environments, and the hackathon "Global Resilience" / "Digital Equity" tracks.

**Current dependency to remove:** Supabase (hosted PostgreSQL + Auth + Storage)

### What changes

| Component | Current | Phase 5 target |
|---|---|---|
| Database | Supabase PostgreSQL (cloud) | Local PostgreSQL + pgvector (Docker or native) |
| Auth | Supabase Auth (cloud JWT) | Local auth (e.g., NextAuth.js with local DB) |
| Storage | Supabase Storage | Local filesystem or MinIO |
| Embeddings | llama.cpp (already local) | No change |
| LLM | llama.cpp (already local) | No change |

### Migration steps (high level)

1. `docker-compose.yml` — run PostgreSQL + pgvector locally
2. Run all migrations against local DB (same SQL files)
3. Replace `@supabase/ssr` / `@supabase/supabase-js` with direct DB calls + NextAuth.js
4. Replace `services/database.py` Supabase client with `asyncpg` direct connection
5. Update all API routes to use direct DB instead of Supabase client
6. Remove `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc. from env

### ⚠️ This is a large refactor — do after Phase 4 is complete.

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
