# One app, plugins on the side — repo consolidation plan

Status (2026-10-21): **A–F done.** The live site deploys from `My-Second-Brain` `main`. One push to the plugin repo is left (end of file).
See "Progress" at the end.

## The goal in one paragraph

There is **one app repo** (`My-Second-Brain`). Every app feature, fix and deploy setting
lives there, wherever the work started. WebMCP stops being a fork of the app and
becomes a **plugin**: a small separate repo that builds one `main.js` + `manifest.json`,
which a user installs from Settings → Plugins, exactly like an Obsidian community
plugin. The plugin only talks to the app through a published **Plugin API**, so the
two repos never need to be merged or synced again — the app can change freely as long
as the API contract holds.

```
My-Second-Brain (app)                     second-brain-webmcp (plugin)
├── backend/  frontend/  supabase/        ├── manifest.json   {id, version, minAppVersion}
├── frontend/lib/plugins/   ← host        ├── src/            registry, tools, AgentPanel
├── packages/plugin-api/    ← types ─────▶├── package.json    depends on @second-brain/plugin-api
└── deploys: Vercel + Render + Supabase   └── releases/       main.js attached to GitHub releases
```

Rule of thumb that decides where code goes: *would the app want this even if WebMCP
did not exist?* Yes → app repo. No → plugin repo.

## Where we are today (measured 2026-10-20)

| Folder | Remote | Problem |
|---|---|---|
| `second_brain` | My-Second-Brain | `.git` is corrupted (fsck: missing blobs) — `git fetch` errors. Tracks `backend/venv` (2,515 files). |
| `second_brain_clean` | My-Second-Brain | Fresh clone from 2026-10-17 made to dodge the corruption. Duplicate of the above. |
| `second-brain-webmcp` | second-brain-webmcp | The deployed app. Separate squashed history → every update is a hand-made per-file 3-way merge. |

Also: GitHub `main` is **604 commits behind** `feat/ai-harness` (last touched April);
`feat/ai-harness` is the real main line. Five stale `claude/*` branches on origin.

The fork differs from the app by only ~22 files:

- WebMCP-only (→ plugin): `lib/webmcp/{types,registry,project,useWebMcpTools}.ts`,
  `lib/webmcp/tools/{note,database}.ts`, `registry.test.ts`, `components/webmcp/AgentPanel.tsx`,
  `scripts/seed-demo.py`.
- Generic app improvements hiding in the fork (→ app repo):
  - `BlockEditor` handle: `getBlocks()` and `insertMarkdownAtEnd(markdown)`.
  - `backend/main_slim.py` + `requirements-slim.txt` (a lighter backend for small hosts).
  - `render.yaml` comments/env (`SECRETS_KEY`), `frontend/.vercelignore`.
- Hook-up lines that become plugin API calls instead: `NoteEditorPage` (note tools),
  `DatabaseShell` (database tools), `(brain)/layout.tsx` (AgentPanel).

## Part 1 — Plugin system in the app

### 1.1 Plugin API (v1) — exactly what WebMCP needs, nothing speculative

```ts
interface Plugin { onload(api: PluginAPI): void | Promise<void>; onunload?(): void }

interface PluginAPI {
  apiVersion: 1;
  appVersion: string;
  react: typeof import("react");          // host's React — plugins never bundle their own

  workspace: {
    /** Fires when a note page mounts; returned function runs when it unmounts. */
    onNoteOpen(cb: (note: NoteHandle) => void | (() => void)): Unsubscribe;
    onDatabaseOpen(cb: (db: DatabaseHandle) => void | (() => void)): Unsubscribe;
    navigate(path: string): void;
  };
  ui: {
    /** Floating panel rendered in the brain layout (AgentPanel uses this). */
    addPanel(id: string, render: () => React.ReactNode): Unsubscribe;
  };
  constants: { calloutPalette: ...; };      // what project.ts imports today
  storage: { get(key): unknown; set(key, value): void };  // per-plugin, per-user
}

interface NoteHandle {
  id; title; mastery; topics;
  getBlocks(): Block[] | null;               // live, includes unsaved edits
  appendMarkdown(md: string): Promise<void>;
  setMastery(status: string): Promise<void>;
}
interface DatabaseHandle {
  name; dataSourceId; properties; views; activeViewId; rows; groups;
  selectView(id); updateCell(rowId, key, value); updateView(id, patch); refetchRows();
  onChange(cb): Unsubscribe;                  // rows/views changed → plugin re-registers tools
}
```

These map 1:1 onto today's `NoteToolContext` / `DatabaseToolContext`, so the plugin's
tool code barely changes.

### 1.2 Host side (app repo)

- `frontend/lib/plugins/host.ts` — the event bus behind `workspace.*` and `ui.*`.
  `NoteEditorPage` and `DatabaseShell` publish their handles to it (a few lines each,
  generic — any plugin benefits). `(brain)/layout.tsx` renders `<PluginPanels />`.
- `frontend/lib/plugins/loader.ts` — fetch plugin code → `import()` from a blob URL →
  `default.onload(api)`; disable calls `onunload` and drops its panels/subscriptions.
  A plugin that throws is disabled and reported, never takes the app down.
- **Settings → Plugins page**: list installed, toggle on/off, "Install from URL"
  (a GitHub release URL that contains `manifest.json` + `main.js`), uninstall,
  update when the release version is newer. Warning on first install that plugins run
  with your account's access (same model as Obsidian's "community plugins" switch).
- **Storage**: migration `0xx_user_plugins.sql` — `user_plugins(user_id, plugin_id,
  manifest jsonb, source_url, code text, enabled, installed_at)` with RLS per user.
  Code is stored so an install keeps working if GitHub is down.
- Version gate: refuse to load when `manifest.minAppVersion > appVersion` or
  `apiVersion` unsupported.
- `packages/plugin-api/` — types only (`index.d.ts` + `package.json`), published to npm
  as `@second-brain/plugin-api`. Republish only when the API changes (bump `apiVersion`
  for breaking changes, keep the old one working for a release).
- Optional for the demo deploy: env `NEXT_PUBLIC_DEFAULT_PLUGINS=<release url>` pre-installs
  WebMCP for every user of that deployment, so judges see it without installing.

### 1.3 Plugin repo (`second-brain-webmcp`, rebuilt)

- New history on a fresh `main`: `manifest.json`, `src/` (the 9 WebMCP files, imports
  rewritten from `@/…` to `api.*`), `esbuild.config.mjs` (react external → `api.react`),
  vitest for `registry.test.ts`, `seed-demo.py`, README, MIT LICENSE.
- GitHub Action: on tag `v*` → build → attach `main.js` + `manifest.json` to the release.
- The current fork history is kept as tag `fork-final` (and branch `legacy/fork`) so the
  competition submission commit stays reachable. The fork's app code is deleted from `main`.

## Part 2 — Fix the local mess

1. **Healthy repo in place**: `second_brain_clean` has an intact `.git`. Move the corrupt
   `second_brain` to `~/projects/_archive/second_brain-corrupt-2026-10-20` (kept until
   you've confirmed nothing is missing), then rename the clean clone to `second_brain`.
2. **Carry over untracked state** from the old folder: `.env`, `backend/.env`,
   `frontend/.env.local`, `backend/venv` (or recreate), `frontend/node_modules`
   (or `npm ci`), model files used by `llama.sh`, `.claude/`, `.superpowers/`,
   `workspaces/`, `NOTION_SYNC_PROMPT.md`. Diff the two working trees first so no
   uncommitted work is lost.
3. **Stop tracking junk** (one commit): `backend/venv/`, `frontend/tsconfig.tsbuildinfo`,
   `frontend/next-env.d.ts` drift, `test-results/`; extend `.gitignore`.
   Recheck nothing secret is tracked (`git ls-files | grep -E '\.env|\.auth'`).
4. **One main line**: fast-forward GitHub `main` to `feat/ai-harness` (main has no
   commits of its own: 0 ahead / 604 behind). From then on: `main` = what is live,
   short-lived `feat/*` branches, PR → main. Delete the 5 stale `claude/*` branches
   and local `ui-audit/notion-reference` once merged/abandoned (you confirm the list).
5. Remove `second_brain_clean` (it *is* `second_brain` now) and the old fork checkout.

End state on disk: `~/projects/second_brain` (app) and `~/projects/second-brain-webmcp`
(plugin, a few hundred KB).

## Part 3 — One deploy, from the app repo

- **Vercel**: repoint the project from `second-brain-webmcp` to `My-Second-Brain`,
  root `frontend/`, production branch `main`.
- **Render**: repoint the blueprint to `My-Second-Brain`'s `render.yaml`, branch `main`.
  `main_slim.py` comes into the app; `render.yaml` picks full vs slim with one env var
  (`APP_PROFILE=slim|full`), so the small free host keeps working.
- **Supabase**: one production project = the one the live app uses today. Apply any
  migrations it is missing (029, 030 at least, then `user_plugins`). Local dev keeps
  its own project / pgtest — production keys never in the repo.
- Result: merge to `main` → Vercel + Render deploy automatically. No manual step,
  no second repo involved.

## Order of work and checkpoints

| Step | What | Checkpoint (you verify) |
|---|---|---|
| A | Part 2.1–2.3 (local fix + untrack junk) | app starts with `./app.sh start`, tests green |
| B | Port generic fork code into app (editor handle, slim backend, render/vercel bits) | tests green, nothing WebMCP in the app |
| C | Plugin host + Settings → Plugins + migration + `plugin-api` package | install a tiny "hello" plugin from a local URL |
| D | Rebuild WebMCP repo as a plugin, release v1.0.0 | install it from the release URL; 13 tools show in AgentPanel / Chrome |
| E | Part 2.4–2.5 (main line, branch cleanup) | you approve the branch delete list |
| F | Part 3 (repoint Vercel/Render, migrations) — **you click in the dashboards** | live site works, WebMCP via plugin |
| G | Archive leftovers, update memory/STATUS | — |

Nothing on GitHub or the servers is changed before step E, and nothing is deleted until
its checkpoint passes.

## Decisions (answered 2026-10-20)

1. **Competition**: judging is finished, so step F (moving the live site) can go ahead.
2. **Production Supabase**: the project the live site uses today (the fork's). Local dev keeps
   `esfhsdukyhyrlgzflsad`.
3. **Plugin API types**: public npm package `@second-brain/plugin-api`.
4. **Plugin trust**: both. Settings shows an approved list (a file in the app repo) by default,
   plus "Install from URL" behind an Obsidian-style warning.

## Original questions

1. **Competition**: is judging finished? If not, step F waits, and the live demo keeps
   running from the fork until it is (the plugin work can happen meanwhile).
2. **Which Supabase is production** — the fork's project (what the live site uses) or
   the one you develop against locally?
3. **npm**: OK to publish `@second-brain/plugin-api` publicly on npm? (Alternative:
   GitHub Packages, slightly more setup for plugin authors.)
4. **Plugin trust**: allow installing from any URL (Obsidian-style, with a warning), or
   only from a list of approved plugins you maintain?

## Progress (2026-10-20)

- **A** `second_brain/.git` replaced by the healthy clone (corrupt one in `~/projects/_archive/`);
  venv, root `.env`, build artefacts untracked.
- **B** fork's app-level pieces brought home (editor `insertMarkdownAtEnd`, `main_slim.py`,
  `render.yaml` with `APP_MODULE`/`REQUIREMENTS_FILE` and `SECRETS_KEY`).
- **C** plugin system: `frontend/lib/plugins/`, `/api/plugins`, Settings → Plugins, migration 031,
  `packages/plugin-api` (npm name `second-brain-plugin-api`, not yet published). Production
  build passes; tested live in Chrome: install from link, note tools (`note.read` ran), database
  tools (7, from the live schema), turning off removes panel + styles, uninstall.
- **D** `second-brain-webmcp` rebuilt as the plugin (branch `plugin`, release **v1.0.0**). The
  full-app fork is kept at tag `fork-final` and branch `legacy/fork`.
- **E** GitHub `main` fast-forwarded to today's work (`28494f6`); local checkout is on `main`.

## Step F — move the live site (you, in the dashboards)

Do these in order. Nothing in git needs to change for them.

1. **Supabase (the live site's project):** in the SQL editor run, in order, any of
   `029_privacy_routing.sql`, `030_notion_sync.sql`, `031_user_plugins.sql` that are missing.
   All three are safe to run twice.
2. **Render** → the `second-brain-api` service → Settings → Repository: switch to
   `3rif005-commits/My-Second-Brain`, branch `main`, root `backend`. Keep the env vars that are
   already set; add `SECRETS_KEY` if missing (`python -m services.secrets generate`). The free
   plan can't fit the full build? Set `APP_MODULE=main_slim`, `REQUIREMENTS_FILE=requirements-slim.txt`.
3. **Vercel** → the project → Settings → Git: connect `3rif005-commits/My-Second-Brain`,
   production branch `main`, Root Directory `frontend`. Env vars stay.
4. **Plugins from a private repo:** `second-brain-webmcp` is private, so add
   `PLUGINS_GITHUB_TOKEN` on Vercel: a fine-grained token with read-only *Contents* access
   to that one repo. (Or make that repo public; then no token is needed.)
5. Redeploy both, open the live site → Settings → Plugins → WebMCP → Install.
6. Tell Claude it's live. Then: `second-brain-webmcp`'s `main` is replaced by `plugin`
   (the old fork stays at `fork-final` / `legacy/fork`), and its CI starts releasing on tags.

## Small things left

- `npm login && cd packages/plugin-api && npm publish` (then the plugin repo can drop `vendor/`).
- Delete the old clone: `rm -rf ~/projects/second_brain_clean` (it is fully replaced).
- Stale branches on GitHub: all are fully contained in `main`; delete once you agree.

## Step F result (2026-10-21)

Checked in the dashboards: **Vercel** and **Render** were already building from
`My-Second-Brain` (since 2026-10-06); only the fork's CLI deploys used the fork. Vercel's
production branch was `feat/ai-harness` and is now `main`. Render moved itself to `main` when
that branch was deleted and is live on `28494f6` with all 13 env vars, `SECRETS_KEY` included.
The user applied migrations 029–031 to the live Supabase. The 11 merged branches on GitHub are
deleted, so only `main` is left.

Left for the user:
- `cd ~/projects/second-brain-webmcp-plugin && git push --force-with-lease=main:4b020e8 origin plugin:main`
  (replaces the fork's `main` with the plugin; the old fork stays at `fork-final` / `legacy/fork`).
- `PLUGINS_GITHUB_TOKEN` on Vercel (read-only Contents on `second-brain-webmcp`), or make that repo public.
- `npm publish` in `packages/plugin-api`; `rm -rf ~/projects/second_brain_clean`.
