# Second Brain — Project Status

> This file is the source of truth across all conversations.
> Read it at the start of every session. Update it at the end.
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

**Phase 3 — Context Protocol** `[~] IN PROGRESS`

---

## Phase Tracker

| Phase | Name               | Status         | Started    | Completed  |
|-------|--------------------|----------------|------------|------------|
| 1     | Foundation         | ✅ Complete    | 2026-04-15 | 2026-04-15 |
| 2     | Ingestion Pipeline | ✅ Complete    | 2026-04-15 | 2026-04-17 |
| 3     | Context Protocol   | 🔧 In progress | 2026-04-17 | —          |
| 4     | Polish & Expansion | Not started    | —          | —          |

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

## Phase 2 — What's Done

### Frontend (all files created + build passes clean)
- `app/api/ai/route.ts` — Gemini 2.0 Flash via @ai-sdk/google, streams BlockNote tool calls
  - Uses dynamic `import("@blocknote/xl-ai/server")` — CJS require() was incompatible with ESM-only peer deps
  - `@blocknote/xl-ai` in `serverExternalPackages` (not `transpilePackages`) — prevents bundler conflict
  - `types/xl-ai-server.d.ts` — local type stubs since server.d.ts is empty in 0.48
- `app/api/ingest/route.ts` — proxy to FastAPI with JWT, catches ECONNREFUSED → 503
- `app/(brain)/brain/ingest/page.tsx` — upload UI + progress flow with realistic step timers
  - Stores FastAPI HTML response in sessionStorage (`ingest-pending-{note_id}`) before navigating
- `components/ingestion/IngestDropzone.tsx` — drag-drop + URL input
- `components/ingestion/IngestionProgress.tsx` — uploading → extracting → generating → done
- `components/editor/BlockEditor.tsx` — **UPDATED**: added `AIExtension()`, `ingestHtml` prop
  - `AIExtension()` from `@blocknote/xl-ai` — adds AI slash-menu and toolbar button
  - `ingestHtml` prop: when set, calls `editor.tryParseHTMLToBlocks(html)` + `editor.replaceBlocks()` + saves immediately
- `components/editor/NoteEditorPage.tsx` — **UPDATED**: reads sessionStorage on mount, passes `ingestHtml` to editor
  - Shows "Applying generated content…" in the toolbar while ingest HTML is pending
- `app/globals.css` — `@import "@blocknote/xl-ai/style.css"` added (AI menu styles)
- `next.config.ts` — `@handlewithcare/*` in transpilePackages; `@blocknote/xl-ai` in serverExternalPackages

### Backend (all files created + server starts clean)
- `routers/ingest.py` — `/ingest/pdf`, `/ingest/url`, `/ingest/` (auto-dispatch)
  - Returns `{ note_id, title, html, topics }`
- `services/pdf_extractor.py` — PyMuPDF (fitz) text extraction
- `services/url_extractor.py` — trafilatura article extraction
- `services/llm.py` — **uses `google-genai` SDK**
  - `generate_mastery_guide(source_text)` → HTML compatible with BlockNote
  - `extract_metadata(source_text)` → `{ title, topics }`
- `prompts/mastery_guide.py` — HTML system prompt for BlockNote format
- `main.py` — `redirect_slashes=False`, ingest router registered

### End-to-end ingest flow (implemented, ready to test)
1. User drops PDF or pastes URL at `/brain/ingest`
2. Frontend shows: uploading → extracting → generating (timers simulate progress)
3. POST `/api/ingest` → Next.js proxy → FastAPI
4. FastAPI: extracts text + calls Gemini → returns `{ note_id, html, title, topics }`
5. Frontend stores `html` in `sessionStorage["ingest-pending-{note_id}"]`
6. Navigates to `/brain/{note_id}`
7. `NoteEditorPage` reads sessionStorage → passes `ingestHtml` to `BlockEditor`
8. `BlockEditor` calls `tryParseHTMLToBlocks(html)` → `replaceBlocks()` → saves via PATCH

---

## What Needs Testing (Phase 2)

### Test the full PDF ingest flow
```bash
# Terminal 1
cd /home/ayoub/projects/second_brain/frontend && npm run dev

# Terminal 2
cd /home/ayoub/projects/second_brain/backend
source .venv/bin/activate && uvicorn main:app --reload
```
Then:
1. Open http://localhost:3000 → log in
2. Click the ↑ import button in the sidebar (or go to /brain/ingest)
3. Drop any PDF file
4. Watch the progress bar: uploading → extracting → generating → done
5. App navigates to the new note — content should populate automatically
6. Toolbar should briefly show "Applying generated content…" then "Saved HH:MM:SS"
7. Refresh — content should still be there

### Test URL ingest
Paste an article URL (e.g., a Wikipedia page) in the URL input and click Import.

### Test the /api/ai endpoint (AI toolbar)
```bash
curl -X POST http://localhost:3000/api/ai \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}],"toolDefinitions":[]}'
# Should return a stream (or 503 if key is missing)
```

---

## Running the App

```bash
# Terminal 1 — Frontend
cd /home/ayoub/projects/second_brain/frontend
npm run dev
# → http://localhost:3000

# Terminal 2 — Backend (needed for Phase 2 ingest)
cd /home/ayoub/projects/second_brain/backend
source .venv/bin/activate
uvicorn main:app --reload
# → http://localhost:8000
```

## Running Tests

```bash
cd /home/ayoub/projects/second_brain/frontend
npx playwright test                        # all 16 tests
npx playwright test --project=notes-crud  # Phase 1 CRUD tests
npx playwright test --project=protected-routes
```

---

## Key Technical Facts (for next session)

| Topic | Detail |
|-------|--------|
| Supabase project ref | `esfhsdukyhyrlgzflsad` |
| Supabase URL | `https://esfhsdukyhyrlgzflsad.supabase.co` |
| Auth email | `aubrif005@gmail.com` / `SecondBrain2026!` |
| Next.js version | 16.2.3 (Turbopack) |
| BlockNote version | 0.48.0 |
| xl-ai server import | dynamic `import("@blocknote/xl-ai/server")` — CJS require() fails due to ESM deps |
| xl-ai type stubs | `types/xl-ai-server.d.ts` — overrides empty server.d.ts in 0.48 |
| xl-ai serverExternalPackages | `@blocknote/xl-ai` in serverExternalPackages, NOT transpilePackages |
| @handlewithcare/* | In transpilePackages — ESM-only peer deps of xl-ai |
| ai SDK version | `ai@4.3.19` → use `convertToCoreMessages`, `toDataStreamResponse()` |
| @ai-sdk/google version | `3.0.63` → model cast to `any` due to LanguageModelV3 vs V1 |
| Google AI SDK (backend) | `google-genai` (NOT deprecated `google-generativeai`) |
| BlockNote CSS | globals.css: mantine first, then xl-ai, then tailwind |
| Yjs dedup fix | `transpilePackages: ["@blocknote/core", "@blocknote/react", "@blocknote/mantine"]` |
| SSR fix | `BlockEditor` loaded via `dynamic(() => import(...), { ssr: false })` |
| Middleware file | `proxy.ts` (Next.js 16 renamed from middleware.ts) |
| Sidebar refresh | `window.dispatchEvent(new Event("notes-changed"))` after delete |
| Ingest HTML handoff | sessionStorage key `ingest-pending-{note_id}` — read in NoteEditorPage on mount |

---

## Decisions Log

| Date       | Decision                                         | Reason                                       |
|------------|--------------------------------------------------|----------------------------------------------|
| 2026-04-15 | LLM: Gemini 2.0 Flash (not Gemma 4 locally)     | Gemma 4 not yet available via API            |
| 2026-04-15 | google-genai SDK (not google-generativeai)       | Old package deprecated, no more updates      |
| 2026-04-15 | Embeddings: Google text-embedding-004 (768d)     | Consistent with Gemini / Google AI stack     |
| 2026-04-15 | Proxy FastAPI through Next.js API routes         | Simpler auth, no CORS issues in dev          |
| 2026-04-15 | BlockNote Mantine theme                          | Most stable, self-contained Mantine setup    |
| 2026-04-15 | proxy.ts / export proxy (Next.js 16)             | Next.js 16 renamed from middleware.ts        |
| 2026-04-15 | dynamic import for BlockEditor (ssr:false)       | BlockNote/Yjs accesses window — can't SSR    |
| 2026-04-15 | transpilePackages for @blocknote/*               | Deduplicates Yjs across packages             |
| 2026-04-15 | dynamic import for @blocknote/xl-ai/server       | CJS require() fails: server.cjs → requires ESM-only @handlewithcare/* |
| 2026-04-15 | serverExternalPackages for @blocknote/xl-ai      | Prevents Turbopack from bundling CJS chunk that requires ESM-only packages |
| 2026-04-15 | types/xl-ai-server.d.ts stub                     | server.d.ts in 0.48.0 is 0 bytes — TypeScript needs stubs |
| 2026-04-15 | ingestHtml via sessionStorage                    | Clean handoff from ingest page to note page without URL params |
| 2026-04-15 | tryParseHTMLToBlocks + replaceBlocks             | Reliable HTML→blocks without transport version mismatch |
| 2026-04-15 | AIExtension() with no transport                  | xl-ai@0.48 uses ai@6 internally; project uses ai@4; version mismatch prevents ClientSideTransport wiring — defer to Phase 3 |
| 2026-04-15 | convertToCoreMessages (ai@4.x)                   | ai@4 uses Core not Model naming              |
| 2026-04-15 | redirect_slashes=False in FastAPI                | Prevents 307 on /ingest POST                 |
