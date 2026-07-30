# Second Brain — Session Resume

## Project in one paragraph
AI-powered personal knowledge OS. Core app (auth, notes, editor, AI chat, MCP, Notion-grade UX) is fully built. The only active work is the **Kaggle "Gemma 4 Good" hackathon sprint** — deadline **May 18 2026**.

## Stack (memorised — do not read PLAN.md unless the task requires architecture detail)
| | |
|---|---|
| Frontend | Next.js 16 (Turbopack) · BlockNote 0.48 · Tailwind · `frontend/` |
| Backend | FastAPI · Python · `backend/` |
| DB / Auth | Supabase · JWT via `supabase.auth.get_user()` · middleware: `proxy.ts` |
| Ports | Frontend :3000 · Backend :8000 · llama.cpp gen :8080 · embed :8081 · LiteRT tablet :8082 |
| LLM routing | SmartRouter (not yet built): LiteRT tablet → OpenRouter fallback |
| Embedder | llama.cpp nomic-embed-text v1.5 · port 8081 |

## How to start
1. Read **only the Hackathon Sprint section** of `STATUS.md` — skip Phases 1–3 and Decisions Log
2. Identify the first ❌ task in each group (A → B → C → D → E → F → G)
3. Tell me in 3 bullets: what's ✅ done, what's ❌ next, what files you need
4. Wait for my confirmation before writing any code

## File exploration rules (token budget)
- **Locate before reading**: use `grep -n` or `find` to pinpoint the exact file and line range — never open a file just to see if it's relevant
- **Read with offset + limit**: once you know the location, read only that section (`offset`/`limit` params) — never read a full file when you need 20 lines
- **One read per file**: plan what you need from a file before opening it — don't read it twice
- **Never read files you won't edit**: use `grep` to confirm a symbol exists before opening the file that contains it
- **Imports and signatures only**: when you need to understand a module interface, grep for `export` / `def ` / `class ` instead of reading the whole file
- **No exploratory reads**: if you are not sure a file is relevant, grep first — open only on a hit

## Rules
- Update `STATUS.md` Hackathon Sprint table when a task moves to ✅
- Give `bash` CLI test commands after each completed task
- Read only the files the current task requires — nothing else
