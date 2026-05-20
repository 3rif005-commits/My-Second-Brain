# Handoff Prompt — Resume AI Substrate Phase 1 File-Level Merge

> Copy everything between the `=====` markers below into a fresh Claude Code session.
> The previous session was on Opus and used too many tokens. Use **Sonnet 4.6** for this.

=====

You are continuing work for solo developer 3rif005 on the **Second Brain** project at `/home/ayoub/projects/second_brain/`. The previous Opus session burned its context window. **Do NOT re-derive the design or re-plan** — the design and plan exist on disk. Just continue the merge that was in progress.

## Project at a glance

- **Second Brain** = personal AI knowledge OS. Backend FastAPI + Python + Supabase. Frontend Next.js 16 + React 19 + BlockNote editor.
- The full design spec lives at `docs/superpowers/specs/2026-05-17-ai-experience-redesign.md`
- The full implementation plan lives at `docs/superpowers/plans/2026-05-17-ai-substrate-phase-1.md`
- Read those two files first, then come back here.

## What was built — AI Substrate Phase 1 (COMPLETE, ready to merge)

The previous session implemented Phase 1 of an AI rework. It produced 24 commits on branch `worktree-ai-substrate-phase-1` inside a git worktree at `/home/ayoub/projects/second_brain/.claude/worktrees/ai-substrate-phase-1/`. **All 41 backend unit tests pass.** Phase 1 delivers:

- **Backend** (`backend/services/agent/`): Agent Engine, Skills loader, 10 Brain Tools (search/get/list/backlinks/create/update/set_mastery/move/link/delete), Permission gate (3 tiers), Model Router (Local/API toggle). New `POST /agent` SSE endpoint at `backend/routers/agent.py`. 3 bundled skills in `backend/skills/`.
- **Database** migration `supabase/migrations/009_ai_substrate.sql` — adds `notes.local_only`, `notes.deleted_at`, renames `chat_sessions` → `chat_threads`, creates `mcp_servers` and `note_links` tables.
- **Frontend** (`frontend/components/ai/`, `frontend/lib/markdown/`): new Chat component with SSE streaming, ThreadHistory sidebar, ModeToggle pill, custom markdown renderer with `:::callout` / `:::interactive` / `:::note-ref` fences, `/api/agent` SSE proxy, `/api/threads/*` CRUD, LocalOnlyBadge.
- **Removed**: old `backend/routers/chat.py`, `backend/prompts/tutor.py`, `frontend/components/chat/*`, `frontend/app/api/chat/`.

## The problem we hit

The user wants Phase 1 merged into their main branch — but with both versions preserved (so they can switch back to "WIP only" or "Phase 1 only" later).

Two complications blocked a normal `git merge`:

1. **Git repository corruption**: 53 loose `.git/objects/*` files are 0 bytes (empty). No pack files exist. `git checkout main` and `git merge` fail with `fatal: unable to read tree 39e1dbadd424d4dd082a64120cb59c32bce24b81`. Corruption likely happened during heavy concurrent subagent operations. The HEADs of all three branches are readable, but mid-history objects are damaged.

2. **WIP overlap**: The user's main working tree had ~230 dirty files at session start (Phase 4 Android scaffolding, Notion phase UX work, sidebar fixes, etc.) — substantial uncommitted improvements that overlap with Phase 1 on a few files.

## The solution being executed

Skip `git checkout` and `git merge` entirely. Do a **file-level merge** directly in the working folder:

```
                                            [where we want to end up]
                                                       ↓
bd0ac49 (origin/main + 5 user commits)  ───→ a28102a (wip commit) ───→ MERGE COMMIT
       (origin)                              wip/pre-ai-substrate-merge   ↑ created by this session
                                                                          |
worktree-ai-substrate-phase-1 (971f459) ─────────────────────────────────┘
       (Phase 1 work, fully tested)
```

After the merge commit is created, run `git update-ref refs/heads/main <merge-commit-sha>` to point `main` at the merged state. Branches `wip/pre-ai-substrate-merge` and `worktree-ai-substrate-phase-1` stay as-is for "return to that version" use.

## Current state — where we are right now

- **Working folder**: `/home/ayoub/projects/second_brain/` — on branch `wip/pre-ai-substrate-merge`, working tree has Phase 1 files partially copied in and partially merged.
- **Worktree (Phase 1 source)**: `/home/ayoub/projects/second_brain/.claude/worktrees/ai-substrate-phase-1/` — branch `worktree-ai-substrate-phase-1` at commit `971f459`.
- `.claude/worktrees/` and `.clone/` are now in `.gitignore` (so the worktree dir isn't accidentally staged).

## What's already done

The previous session completed these steps in the working folder (`/home/ayoub/projects/second_brain/`):

1. ✅ Created `wip/pre-ai-substrate-merge` branch at `a28102a` capturing **all** of the user's WIP (230 files, 61k insertions) so it's safely preserved.
2. ✅ Added `.claude/worktrees/` and `.clone/` to `.gitignore`.
3. ✅ Copied 30 NEW Phase 1 files into the working folder:
   - `backend/services/agent/{__init__,brain_tools,engine,model,permissions,skills}.py`
   - `backend/skills/{cite-everything,interactive-block-author,note-author}.md`
   - `backend/tests/{__init__,conftest,test_brain_tools,test_engine,test_model_router,test_models_agent,test_permissions,test_skills}.py`
   - `backend/models/agent.py`, `backend/routers/agent.py`, `backend/pytest.ini`
   - `frontend/components/ai/{Chat,MessageList,ModeToggle,SkillBadge,ThreadHistory,ToolEvent}.tsx`
   - `frontend/components/interactive/InteractiveFrame.tsx`
   - `frontend/components/editor/LocalOnlyBadge.tsx`
   - `frontend/lib/markdown/{Markdown.tsx,fences.ts,components/Callout.tsx,components/NoteRef.tsx}`
   - `frontend/app/api/threads/route.ts`, `frontend/app/api/threads/[id]/route.ts`
   - `frontend/app/api/agent/route.ts`, `frontend/app/(brain)/brain/chat/page.tsx`
   - `frontend/e2e/agent-chat.spec.ts`
   - `supabase/migrations/009_ai_substrate.sql`
4. ✅ Deleted 5 files Phase 1 removes:
   - `backend/routers/chat.py`, `backend/prompts/tutor.py`
   - `frontend/components/chat/` (whole dir), `frontend/app/api/chat/` (whole dir)
5. ✅ Overwrote with Phase 1 versions (clean supersets — WIP didn't actually modify these despite git status showing `M`):
   - `backend/core/config.py` (Phase 1 appended `api_provider`, `anthropic_api_key`, `openai_api_key`, `default_mode`, `api_model_*` fields)
   - `backend/main.py` (Phase 1 registered the agent router)
   - `backend/requirements.txt` (Phase 1 added pytest, pytest-asyncio, pytest-mock, PyYAML)
6. ✅ Hand-merged `backend/services/retriever.py`: kept user's WIP chunked retrieval, added Phase 1's `deleted_at` filter in BOTH the chunk path and the fallback note path.
7. ✅ Hand-merged `frontend/app/api/notes/[noteId]/route.ts`: kept user's WIP fields (`icon`, `is_favorited`, `last_viewed_at`, `is_public`, `position`), added Phase 1's `local_only` PATCH allowance.

## What's left to do (in order)

### Step 1 — Hand-merge `frontend/lib/types/database.ts`

The user's WIP has many Note type fields (`icon`, `is_favorited`, `last_viewed_at`, `is_public`, `position`, `deleted_at`, etc.). Phase 1 added `local_only: boolean` and `deleted_at: string | null`.

Read both versions:
```
Read /home/ayoub/projects/second_brain/frontend/lib/types/database.ts
Read /home/ayoub/projects/second_brain/.claude/worktrees/ai-substrate-phase-1/frontend/lib/types/database.ts
```

Add `local_only: boolean` to the WIP version's `Note` type and to the `NoteUpdate` partial type. If `deleted_at` is already present in the WIP version (it likely is), leave it.

### Step 2 — Hand-merge `frontend/package.json`

WIP added their own deps. Phase 1 added markdown deps: `react-markdown@^9`, `remark-gfm@^4`, `remark-math@^6`, `rehype-katex@^7`, `rehype-prism-plus@^2`, `katex@^0.16`, `unified@^11`, `unist-util-visit@^5`.

Easiest path: from `/home/ayoub/projects/second_brain/frontend/`, run:
```bash
npm install react-markdown@^9 remark-gfm@^4 remark-math@^6 rehype-katex@^7 rehype-prism-plus@^2 katex@^0.16 unified@^11 unist-util-visit@^5
```
That updates `package.json` and `package-lock.json` correctly without needing manual JSON merging.

### Step 3 — Hand-merge `frontend/components/editor/NoteProperties.tsx`

The user has their own version with their properties panel work; Phase 1's version is a simpler one that just wires in `<LocalOnlyBadge />`. Read both, take the user's WIP version, and add the `<LocalOnlyBadge noteId={note.id} initialValue={note.local_only ?? false} />` element near the top of the panel (or wherever feels natural). Add the import: `import { LocalOnlyBadge } from "./LocalOnlyBadge";`.

### Step 4 — Hand-merge `STATUS.md`

Phase 1's version appended a new section "AI Substrate — Phase 1 — CODE COMPLETE ✅" at an appropriate place. The user's WIP version has its own modifications. Take the WIP version and append the new section from Phase 1's version at the end, or right after the Phase 3 section. Get the section from `/home/ayoub/projects/second_brain/.claude/worktrees/ai-substrate-phase-1/STATUS.md` (it starts with `## AI Substrate — Phase 1 — CODE COMPLETE`).

### Step 5 — Verify `backend/services/router.py`

The user's WIP has this file (it was untracked at session start). Phase 1's implementer copied a working version into the worktree. Compare:
```bash
diff /home/ayoub/projects/second_brain/backend/services/router.py /home/ayoub/projects/second_brain/.claude/worktrees/ai-substrate-phase-1/backend/services/router.py
```
If they differ meaningfully, keep the user's version (it's their original).

### Step 6 — Run backend tests to confirm nothing broke

```bash
cd /home/ayoub/projects/second_brain/backend
source .venv/bin/activate
pytest tests/ -q
```
Expect 41 passed. If not, investigate (the most likely cause is an import path issue from merging).

If `.venv` doesn't exist in the main tree (might not — the venv was set up in the worktree), create it:
```bash
cd /home/ayoub/projects/second_brain/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Step 7 — Stage and commit the merge

```bash
cd /home/ayoub/projects/second_brain
git status --short    # sanity check — should show many modified/new files
git add -A
git commit -m "feat: merge AI substrate Phase 1 with in-flight WIP

Combines the 24-commit Phase 1 implementation (agent engine, brain
tools, permissions, model router, skills, new chat UI, markdown
renderer with fence directives, local_only flag) with the user's
in-flight work (Notion phase UX, Android scaffolding, mobile sidebar,
auth fixes).

Branches preserved for switching versions:
  wip/pre-ai-substrate-merge (a28102a)   — WIP only
  worktree-ai-substrate-phase-1 (971f459) — Phase 1 only

Migration 009_ai_substrate.sql must still be applied to Supabase
manually before the chat will function end-to-end."
```

### Step 8 — Move `main` to the merge commit

```bash
NEW_MAIN_SHA=$(git rev-parse HEAD)
git update-ref refs/heads/main "$NEW_MAIN_SHA"
git branch -av | head    # confirm main points at NEW_MAIN_SHA
```

`main` now reflects the merged state. The user's `wip/pre-ai-substrate-merge` and `worktree-ai-substrate-phase-1` branches are untouched — they can `git checkout` to either later (once the git corruption is repaired separately).

### Step 9 — Restart dev servers from the main tree, verify the chat works

```bash
cd /home/ayoub/projects/second_brain/backend
source .venv/bin/activate
uvicorn main:app --reload  # terminal 1
```
```bash
cd /home/ayoub/projects/second_brain/frontend
npm run dev    # terminal 2
```

The user can open `localhost:3000/brain/chat` and try the new streaming chat. **Remind them they must apply `supabase/migrations/009_ai_substrate.sql` in the Supabase SQL editor first** — the chat endpoint persists threads to `chat_threads`, which doesn't exist until the migration runs.

### Step 10 — Address the git corruption (optional, can be deferred)

53 empty `.git/objects/` files remain. Recovery options for later:
- `git fsck` lists all missing objects
- The HEAD commits and branch tips are readable; only deep history objects are damaged
- The 24 Phase 1 commits, the user's WIP commit, and the merge commit are all safe (they were created during this session)
- Suggest the user `git push -u origin main` once they're satisfied with the merge — pushing copies the readable commits to origin as backup

## Behavioral notes (carry forward)

- The user prefers **terse responses**, not long explanations.
- The user is a solo dev — no team workflows needed.
- Don't re-trigger the brainstorming or planning skills — both phases are complete and documented on disk.
- Don't dispatch subagents for this final merge — it's small, local, and easier inline. You already have the context.
- The user's `.env` files in `/home/ayoub/projects/second_brain/frontend/.env.local` and `/home/ayoub/projects/second_brain/backend/.env` contain real Supabase credentials. The worktree had copies. Do not touch the user's real .env.
- The user's Supabase project ref is `esfhsdukyhyrlgzflsad`. Email is `aubrif005@gmail.com`.

## Quick orientation commands when you start

```bash
cd /home/ayoub/projects/second_brain
git branch --show-current        # should show: wip/pre-ai-substrate-merge
git log --oneline -3             # should show a28102a and bd0ac49 at top
git status --short | wc -l       # gives sense of how much remains
diff -q frontend/lib/types/database.ts /home/ayoub/projects/second_brain/.claude/worktrees/ai-substrate-phase-1/frontend/lib/types/database.ts
diff -q frontend/components/editor/NoteProperties.tsx /home/ayoub/projects/second_brain/.claude/worktrees/ai-substrate-phase-1/frontend/components/editor/NoteProperties.tsx
diff -q STATUS.md /home/ayoub/projects/second_brain/.claude/worktrees/ai-substrate-phase-1/STATUS.md
```

If a file shown above says "Files differ" → it still needs hand-merging.
If a file says nothing (no output) → already merged.

=====
