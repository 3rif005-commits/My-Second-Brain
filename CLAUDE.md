# Second Brain: how to work in this repo

Read this before any git, deploy or database step. It exists so the three-repo mess
(second_brain / second_brain_clean / the WebMCP fork, ended 2026-10-22) never comes back.

## One repo, one branch

- **This folder (`~/projects/second_brain`) is the app.** GitHub: `3rif005-commits/My-Second-Brain`.
  Every app feature, fix, migration and doc goes here, and nowhere else.
- **Work on `main`.** Commit small, push to `main`. No long-lived branches; if one is truly
  needed, merge it back into `main` and delete it the same day.
- Never create a second clone or copy of the app to "start clean". Never force-push `main`.
- Push over SSH (`origin` is `git@github.com:3rif005-commits/My-Second-Brain.git`). The `gh`
  CLI may be signed in to a different GitHub account; check `gh api user -q .login` before
  any `gh` command that changes something.

## WebMCP is a separate plugin, not part of the app

- Repo `3rif005-commits/second-brain-webmcp` (local: `~/projects/second-brain-webmcp-plugin`,
  branch `plugin` tracking `origin/main`). It talks to the app **only** through the Plugin API
  (`frontend/lib/plugins/api.ts`, published to npm as `second-brain-plugin-api`).
- The live app does **not** need it and does not ship it. Don't add WebMCP code to this repo.
  An app feature discovered while working on WebMCP is built here, in the app.
- `~/projects/second-brain-webmcp` is the git store behind that worktree; don't delete it.
  The old full-app fork is frozen at tag `fork-final` / branch `legacy/fork`; never sync to it.

## Edit → commit → push → it deploys

1. `./app.sh status` (then `./app.sh start`); check status again right before any stop/start.
2. Make the change. Run the checks below that match what you touched.
3. `git add <files> && git commit -m "…" && git push`
4. The push deploys by itself:
   - **Frontend:** Vercel builds `main` (root dir `frontend`) → https://second-brain-webmcp.vercel.app
   - **Backend:** Render builds `main` (root dir `backend`, `render.yaml`) →
     https://second-brain-api-g9vd.onrender.com/health (free plan: asleep when idle, first
     request takes ~1 min).
   - A failed build leaves the previous version live, so a broken push is never an outage;
     fix and push again.

### The push check (`.githooks/pre-push`)

Runs on every `git push` and stops it if: an `.env` file or a private key is in the push;
frontend TypeScript has errors (`tsc`, ~45 s, the same check that would fail Vercel's build);
a changed backend `.py` file doesn't compile. It reminds you about new migrations.
After a fresh clone, enable it once: `git config core.hooksPath .githooks`.
`git push --no-verify` skips it; emergencies only.

If `tsc` reports errors inside `node_modules` (e.g. "is not a module"), the local install is
damaged, not the code: `cd frontend && npm ci`.

### Checks by hand (before a big push)

- Frontend: `cd frontend && npx tsc --noEmit && npx vitest run` (vitest ~4 min, 1,291 tests).
- Backend: `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/ -p asyncio -q`
  (~3 min). The ~450 errors from `asyncpg.connect(LOCAL_PGTEST_DSN)` mean no local test
  Postgres is running; they are not failures of your change.
- The e2e tests and anything driving the browser run on the user's **real** notes: read-only
  where possible, undo every change, delete what you create.

## Database migrations (Supabase)

- New file `supabase/migrations/NNN_name.sql`, next free number, safe to run twice
  (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`), RLS on, and end with
  `NOTIFY pgrst, 'reload schema';` or the API won't see a new table.
- Claude cannot reach the database. The user runs the file in the Supabase SQL editor of the
  live project **before** pushing code that uses it.

## Secrets and settings

- Never commit `.env` files; only `.env*.example` (with placeholder values) is tracked.
- Don't read, print or copy real keys. New env vars: add the name to `backend/.env.example`
  or `frontend/.env.local.example`, then the user sets the value in the Vercel / Render dashboard
  (backend vars are listed in `render.yaml`) and redeploys.

## Where things are written down

- `STATUS.md`: the live task tracker. `PLAN.md`: architecture.
- `docs/REPO_CONSOLIDATION_PLAN.md`: how the repos and deploys got to this shape.
- The `*_PROMPT.md` / `HANDOFF_*.md` files at the root are old session hand-offs, kept as
  history; they are not current instructions.
