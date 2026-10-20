# One app, plugins on the side — repo consolidation plan

Status: **draft for review** (2026-10-20). Nothing below has been executed yet.

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
