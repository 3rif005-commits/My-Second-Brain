# Send to Notion — Design (architecture + UX)

> Status: **proposal, awaiting approval** (no feature code written). 2026-10-07.
> Reads with: `RESEARCH.md` (facts), `FIDELITY_MATRIX.md` (per-type mapping),
> `DIVERGENCE_LEDGER.md`, `ROBUSTNESS.md` (ADRs, failure modes, tests).
> Mockups: `mockups/index.html` (open in a browser; every surface, every alternative).
> Policy decided by you: **PUSH ONLY.** Second Brain is the source of truth; Notion is a mirror.
> Nothing is ever read back into Second Brain except *metadata needed to protect your Notion
> edits* (ids, `last_edited_*` times, and a markdown preview for the conflict screen).

---

## 1. One-paragraph summary

You connect Notion once by pasting an *internal connection* token and picking one Notion page
as the mirror's root. From then on any note, collection, database, row, view, or the whole
brain can be **sent**. Every send starts with a **dry run**: a preview listing what is new,
changed, unchanged, changed in Notion since the last send, blocked by privacy, or too large,
and for each item what will be exact, approximated or lost. Confirming queues a background
**sync run**. The run is idempotent, resumable after a crash, rate-limit aware, and ordered so
mentions and relations resolve. A small badge on every item shows its mirror state. Notion-side
edits are never overwritten without your per-item choice. Deletions move pages to a
"Deleted in Second Brain" archive page, never to Notion's trash. All Notion-specific code sits
behind one adapter, and a separate portable model (the IR) sits between the app and Notion, so
either side can change while the other stays the same.

## 2. Decisions you need to make (D1–D6; recommendations given)

**D1 — How notes land in Notion (the biggest one).** Notion gives properties only to database
rows; our notes have properties (topics, mastery, source…) *and* live in a folder tree.
| Option | Shape in Notion | Hierarchy | Note properties | Cost |
|---|---|---|---|---|
| A. Sidebar mirror | Collection = page, note = child page | exact | LOSSY: a "Properties" block at the top of each page | simplest |
| C. One Notes database | One "Notes" database (all notes = rows) + a "Collections" database with a self-relation | relation, not a tree (Notion sidebar shows a flat DB) | exact | queries in Notion are great; tree feel lost |
| **D. Tree of databases (recommended)** | Collection = page; inside it, an inline database "Notes" whose rows are that collection's notes; sub-collections are child pages | exact (Notion's sidebar shows page → database → rows) | exact | one data source per collection, same schema kept in step by the engine; moving a note = move page between data sources (supported) |
Why D: it is the only option that keeps both your hierarchy and your properties exact. Rows
also carry a hidden "SB ID" property, which makes crash recovery exact (ROBUSTNESS §4). The
schema-in-step cost falls on the engine, not on you. Notes with no collection go into the
root page's own "Notes" database.

**D2 — Deletes.** Recommended: a note you trash here is listed in the next dry run as
"Deleted in Second Brain", **unchecked** (Obsidian Publish's safety rule). If you tick it,
the page is *moved* to `🗄 Deleted in Second Brain` under the root. Never `in_trash`, because
Notion purges its trash after 30 days. Alternative: auto-propagate on auto-sync.

**D3 — Formulas & rollups.** Recommended: push the live Notion formula/rollup **and** a hidden
"<name> (SB value)" snapshot property, so the backup holds our computed value even when
Notion computes differently or refuses the expression. Alternative: formula only (cleaner, less
safe) or snapshot only (always exact, not live).

**D4 — Privacy ceiling for Notion.** Recommended: Notion is treated like a trusted cloud
provider: `open` + `personal` notes may go; `private` notes are blocked and need a
per-send "Send once anyway" (the existing `released` channel). Auto-sync never releases.
Alternative: treat Notion as untrusted (`open` only).

**D5 — What "whole brain" includes.** Recommended default ON: collections, notes, databases
(rows, views), files embedded in notes. Default OFF: workspace source files (large), chat
threads, skills. Each is a toggle in Settings.

**D6 — Fix-first divergences** (ledger B1–B3): see §11.

## 3. Architecture overview

```
                 ┌────────────────────────── Second Brain (source of truth) ───────────────────────────┐
                 │ notes · collections · db_* · files (Supabase storage) · threads · skills            │
                 └───────────────┬──────────────────────────────────────────────────────────────────────┘
                                 │ read-only queries (service role, user-scoped)
                 ┌───────────────▼───────────────┐
  READERS        │ services/notion_sync/readers/  │  one module per SOURCE kind:
  (ours → IR)    │  blocknote/<block>.py          │  BlockNote block → IR node
                 │  objects/<kind>.py             │  note / collection / database / view / thread …
                 └───────────────┬───────────────┘
                                 │  IR  (services/portable/ir.py — no BlockNote, no Notion shapes)
                 ┌───────────────▼───────────────┐
  PLANNER        │ plan(scope) → Plan             │  hash IR, diff vs mapping, classify, privacy gate,
  (dry run)      │                                 │  losses from mappers, cheap Notion-side-edit check
                 └───────────────┬───────────────┘
                                 │  confirmed Plan → notion_runs + notion_run_items
                 ┌───────────────▼───────────────┐
  ENGINE         │ engine/ (FROZEN CORE)          │  queue, phases, dependencies, CAS state machine,
  (generic)      │  identity map · retries · rate │  crash reconcile, kill switch, events
                 └───────────────┬───────────────┘
                                 │  IR + resolved ids
                 ┌───────────────▼───────────────┐
  WRITERS        │ notion/writers/<ir_type>.py    │  one module per IR node type: IR → Notion payload,
  (IR → Notion)  │                                 │  declares its losses + version
                 └───────────────┬───────────────┘
                                 │  plain dict payloads
                 ┌───────────────▼───────────────┐
  ADAPTER (ACL)  │ notion/adapter.py              │  the ONLY code that knows HTTP, Notion-Version,
                 │  client · limits · chunker ·   │  limits, error codes; token bucket; 429/5xx policy;
                 │  uploads · errors              │  splitting by 2-level / 100 / 500 KB / 2,000 chars
                 └───────────────┬───────────────┘
                                 ▼
                         api.notion.com (Notion-Version: 2026-03-11, pinned)
```

Package layout (proposal):
```
backend/services/portable/          # the IR: shared by Notion sync AND the local backup archive
  ir.py  canonical.py (stable JSON + hash)  losses.py
backend/services/notion_sync/
  readers/blocknote/{paragraph,heading,list,code,table,media,callout,math,checkpoint,database,button,columns,unknown}.py
  readers/objects/{note,collection,database,data_source,property,view,row,thread,skill}.py
  planner.py   engine/{queue,phases,state,reconcile,ratelimit}.py
  notion/{adapter,client,limits,chunker,uploads,errors,version}.py
  notion/writers/{page,block_*,database,property_*,view,file,mention}.py
  registry.py  (maps type → reader/writer; adding a type = one entry)
backend/routers/notion_sync.py
frontend/components/notion/*  (badge, send dialog, preview, conflict, settings)
```

## 4. The intermediate representation (IR)

Stable, versioned (`ir_version: 1`), JSON-serialisable, owned by us. It knows neither
BlockNote prop names nor Notion payload shapes.

```python
Obj   = { kind: "page"|"database"|"data_source"|"view"|"file"|"collection",
          ref: Ref, parent: Ref|None, order: float, title: Inline[], icon: Icon|None,
          cover: FileRef|None, props: {key: Value}, body: Block[], meta: {...}, losses: Loss[] }
Ref   = { kind, id, sub? }            # e.g. ("note", uuid), ("property", ds_id, key)
Block = { type: "paragraph"|"heading"|"list_item"|"todo"|"toggle"|"quote"|"code"|"equation"
                |"divider"|"table"|"media"|"callout"|"columns"|"column"|"embed"|"bookmark"
                |"db_embed"|"anchor"|"action"|"opaque",
          attrs: {...},   # level, checked, language, color, list_style, start, width_ratio …
          inline: Inline[], children: Block[], src_id: str, losses: Loss[] }
Inline = Text{text, marks:{bold,italic,underline,strike,code,color,bg}, link?}
       | Mention{target: Ref, label} | Equation{latex}
Value  = { type: <one of 24 + "unknown">, value: ... }   # our §3.3 value shape, already Notion-like
Loss   = { level: "approximated"|"lossy"|"impossible", what: str, fallback: str, code: str }
FileRef = { sha256, size, mime, name, source: "storage:<path>"|"url:<https>"|"unavailable" }
```
- `opaque` is the "never drop" node: any unknown source type becomes `opaque` with its
  plain text and raw JSON, so a writer can always produce *something* plus a marker.
- `anchor` (checkpoint) and `action` (button) are IR concepts Notion lacks. Their writers
  produce the fallback. If Notion ever adds buttons, only the `action` writer changes.
- The **same IR feeds the local backup archive** (ROBUSTNESS §8), so the backup and the
  mirror can't drift into two different ideas of what a note is.

## 5. Identity, state, and the data model

New migration `030_notion_sync.sql` (ends with a proof `SELECT`, per project rule):

```sql
notion_connections (id, user_id, workspace_id, workspace_name, bot_user_id, owner_notion_user_id,
  token_ciphertext bytea, token_key_id text, root_page_id, archive_page_id, notes_db_template jsonb,
  api_version text default '2026-03-11', mapper_set_version int,
  status text check (status in ('active','paused','revoked','error')),   -- paused = KILL SWITCH
  privacy_ceiling text default 'personal', created_at, last_ok_at)
  -- RLS: no policy for `authenticated` => PostgREST cannot read it at all; backend service role only.

notion_mappings (id, connection_id, local_kind, local_id, local_sub default '',
  notion_kind, notion_id, notion_parent_id,
  state text check (state in ('creating','synced','failed','archived','detached','orphaned')),
  local_hash, pushed_hash, mapper_set_version int, ir_version int,
  notion_last_edited_time, notion_last_edited_by, last_pushed_at,
  paused bool default false,                 -- per-item pause
  block_index jsonb default '{}',            -- our block id -> {notion_id, hash, parent, pos}
  losses jsonb default '[]', error_class, error_code, error_message,
  UNIQUE (connection_id, local_kind, local_id, local_sub))

notion_runs (id, connection_id, trigger text check (trigger in ('manual','auto','retry','canary')),
  scope jsonb, status text check (status in ('planned','queued','running','paused','succeeded',
  'partial','failed','cancelled')), plan jsonb, counts jsonb, created_at, started_at, finished_at)

notion_run_items (id, run_id, mapping_id, local_kind, local_id, local_sub, phase int,
  action text check (action in ('create','update','move','archive','restore','noop','copy')),
  depends_on uuid[], status text check (status in ('queued','running','done','failed',
  'needs_you','skipped','blocked')), cursor jsonb, attempts int, run_after timestamptz,
  error_class text check (error_class in ('retryable','permanent','needs_user')),
  error_code, message, updated_at)

notion_file_uploads (connection_id, sha256, notion_upload_id, size, mime, status, created_at,
  attached_at, PRIMARY KEY (connection_id, sha256))

notion_rules (id, connection_id, scope_kind text check (scope_kind in ('note','collection','database','all')),
  scope_id uuid, mode text check (mode in ('manual','on_change','daily')), include jsonb, created_at)
```

**Hashes.** `local_hash = sha256(canonical(IR) ‖ mapper_set_version ‖ destination-config)`.
Unchanged hash ⇒ the planner emits `noop` ⇒ **zero API writes** (idempotency acceptance).
A mapper improvement bumps `mapper_set_version`. The planner then shows those items as
"Improved mapping available" (a separate category, unchecked by default), so a mapper upgrade
never re-sends silently. (ADR-08.)

**Block-level identity.** `block_index` maps each BlockNote block id to its Notion block id
plus a hash. An update becomes: PATCH changed blocks in place; delete removed blocks; insert new
blocks with `position: after_block`; delete + recreate a block only when its *type* changed (Notion
can't change type) or for a table whose width changed. If the diff touches > 60 % of
blocks, rebuild the page body instead (fewer calls). (ADR-06.)

## 6. Sync engine

### 6.1 Phases (ordering so references resolve)
| Phase | Work | Why here |
|---|---|---|
| 0 | Ensure root page + `🗄 Deleted in Second Brain` + per-collection containers (D1-D) | everything parents to these |
| 1 | Database + data-source **shells** (scalar properties only) | relations need target ids |
| 2 | Relation properties (dual/single) → then rollups → then formulas | rollup needs relation property id; formula may reference both |
| 3 | Page/row **shells**: title, icon, parent, "SB ID" (rows) — in our order | mentions & relation values need page ids; creation order = Notion order |
| 4 | File uploads (dedup by sha256; attach in the same item to beat the 1-h expiry) | covers, media blocks, files properties |
| 5 | Page bodies (blocks, chunked) + property values incl. relations | everything they point to now exists |
| 6 | Views | need property ids; the last view = the default |
| 7 | Moves, archives, restores | after content, so a failed move never loses content |
Each run item has `depends_on`; the worker takes the next `queued` item whose deps are `done`.
A failed item blocks only its dependents. **Everything else keeps going.** A mention to a page
whose shell failed falls back to text, and the item is flagged to fix itself on the next run.

### 6.2 Worker
Reuses the project's proven patterns from `services/jobs` (compare-and-set `transition`,
`recover_stuck`, the APScheduler tick in `services/db/scheduler.py`) but has **its own tables**:
`ai_jobs` is skill-shaped (`skill NOT NULL`, apply/discard states), and bending it would couple
two features. One worker per connection (serial), because the rate limit is per connection and
ordering matters. Throughput is set by the token bucket, not by concurrency.

### 6.3 Rate limiting and retries (all in the adapter)
Token bucket at **2.5 req/s, burst 3** (Free/Plus limit is 180/min ≈ 3/s; the workspace limit is
shared with your other tools). 429 → sleep `Retry-After` (or `additional_data.retry_after`), then
exponential backoff with jitter, max 6 attempts. 529/503/502/504 → retry GET/PATCH/DELETE. A
**POST create is never blindly retried**: the item goes to `reconcile` (§ROBUSTNESS 4), which
finds out whether the create landed before retrying. `public_api_request_blocked` → permanent,
needs you.

### 6.4 Policies
| Policy | Default | Rationale |
|---|---|---|
| Direction | **push only** | decided by you |
| Notion-side edit | detect; **never overwrite silently**; per-item: Overwrite / Skip / Push as copy | §7.5 |
| Delete here | listed, unchecked; if chosen → move to `🗄 Deleted in Second Brain` | Notion trash purges in 30 days |
| Restore here | move back to its parent | mirror follows source |
| Permanent delete here | stays in the archive page; mapping `orphaned` | never destructive on Notion |
| Rename | update title in place | — |
| Move between collections | Move-page API to the new data source/page | supported for pages; databases: [T11] else re-parent by recreate-with-confirm |
| Large file | over the plan cap → link-out fallback + marker; > 20 MB → multi-part | free plan = 5 MiB |
| Auto-sync | off by default; rules per note/collection/database/all; `on_change` debounced 10 min after last edit, plus a daily sweep | avoids pushing every keystroke |
| Kill switch | `notion_connections.status = 'paused'` stops the worker within one tick; Settings has a big "Pause all syncing" | you asked for it; also used automatically when the token is revoked |
| Per-item pause | `notion_mappings.paused` | e.g. a page you're curating by hand in Notion |

### 6.5 Security and privacy
- **Token:** internal connection, capabilities *Read content, Update content, Insert content*
  only (no user emails, no comments). Encrypted with Fernet (`services/secrets.py`, key
  `SECRETS_KEY` in `backend/.env`, **never** in the DB). Stored in `notion_connections`, which has
  **no RLS policy for `authenticated`**, so the browser can't read it through PostgREST even by
  accident. The API returns only `…last4`. Disconnect = wipe ciphertext + tell you to also remove
  the connection in Notion.
- **Scope:** the connection is shared with ONE page, the mirror root. It cannot see or change
  anything else in your workspace. (Least privilege; also limits the damage of a bug.)
- **Privacy gate:** every item passes `privacy.filter_rows` with the Notion ceiling (D4).
  Blocked items show in the dry run as "🔒 Private: not sent" with "Send once anyway" (adds the
  id to `released` for that run only). A mention of a withheld note renders as "🔒 a private
  note" (its title may itself be sensitive). Files inherit their note's level. Threads are gated
  by every note they cite. **Hard deny-list** in code: `ai_providers`, `mcp_servers`,
  `mcp_grants`, `profiles.preferences` can never be read by any reader (unit test).
- **Logs:** error messages never include note content; only ids and titles.

### 6.6 Observability
- `notion_runs` + `notion_run_items` *are* the history. Settings → Notion → Activity lists runs;
  each expands to items with a plain-language message and a recovery button.
- "Retry failed" = a new run with only the failed/needs-you items (`trigger='retry'`).
- Health card: last success, items failing, rate-limit waits in the last 24 h, canary status
  (ROBUSTNESS §7), token status.
- Events go to the existing notifications bell (failures and conflicts only, never successes).

## 7. UI / UX

Design rules: native next to Notion (menus use the app's existing `--menu-*` tokens, which
were taken from Notion's own menus); compose from existing primitives (`ConfirmDialog`,
`useToast`, the `.ws-*` design system); **no native dialogs**; keyboard reachable (every
surface has a focus order and Esc behaviour); dark and light mode via the existing CSS vars.
I didn't find `ui-ux-pro-max` or `design-system` skills available in this session, so these
specs follow the repo's own design system and the Notion-parity method in `docs/ui-specs/README.md`.

Mockups for everything below: **`docs/notion-sync/mockups/index.html`** (click-through,
light/dark toggle, every alternative side by side).

### 7.1 Entry points
| Where | Affordance | Behaviour |
|---|---|---|
| Note header | **Mirror chip** right of the title bar: `◻ Not in Notion` / `✓ In Notion` / `● Changed` / `⚠ Failed` / `🔒 Private` | Click → Send dialog for this note (or "Open in Notion" when in sync, with a ▾ for Send now). |
| Note "•••" menu | `Send to Notion…` (⌘⇧N), `Open in Notion`, `Pause mirroring` | same dialog |
| Sidebar right-click / "•••" on note, collection, database | `Send to Notion…` | scope pre-filled (collection = with everything inside) |
| Sidebar multi-select (⌘/Shift-click) | floating action bar "3 selected · Send to Notion" | one dialog, union scope |
| Database view tab "•••" / row menu | `Send this database / view / row to Notion` | |
| Cmd+K | "Send to Notion: current page", "Send whole brain to Notion", "Open Notion activity" | |
**Alternatives:** (a) chip + menus (recommended: always visible, zero clicks to know the state);
(b) menus only (quieter but the state is invisible); (c) a dedicated "Mirror" sidebar section
listing all mirrored items (good overview, heavy). The sidebar *badge* (§7.3) makes (c) unnecessary.

### 7.2 Send flow (dialog → dry-run preview → progress)
Layout, recommended **"Review panel" (alternative B)**: a right-side panel (483 px, the existing
`--config-sidebar-width`) that slides over the page, three steps on one surface:
1. **Where & what**: destination (pre-filled: mirror root › collection path, "Change…" opens a
   Notion page picker limited to pages shared with the connection); scope radio *Just this page /
   With everything inside / With linked notes & databases* (Obsidian's "Add linked").
2. **Preview** (auto-runs the dry run, ~1–3 s, skeleton rows meanwhile): tabs **New 12 · Changed 3 ·
   Unchanged 40 · Needs you 2 · Not sent 4**. Each row: icon, title, path, fidelity pills
   (`Exact` / `3 approximated` / `1 lossy`); expanding a row lists the exact losses in plain
   words ("Table on line 14 has merged cells: Notion can't merge cells, text goes to the first
   cell"). "Needs you" = changed in Notion (§7.5) and over-size files. "Not sent" = private,
   paused, deleted (unchecked by default). Checkbox per row; "Select all new & changed".
   Footer: `Estimated 214 requests · about 2 min` + **Send 15 items**.
3. **Progress**: the same panel turns into a live list (✓ / ↻ / ⚠ per item), a progress bar by
   requests, "You can close this; it runs in the background", then a summary: *"15 sent ·
   2 with approximations · Open in Notion ↗"*. Partial: *"13 sent · 2 failed: Retry failed ·
   See why"*.
States: empty scope ("Nothing to send: everything here is already in sync ✓"), not connected
(panel shows the 2-step connect inline), kill switch on ("Syncing is paused: Resume"), offline.
**Alternatives:** A, a centred modal wizard (3 pages, familiar, but hides the page you're
sending); B, a side review panel (recommended: keeps context, matches our view-settings sidebar,
preview can be long); C, a one-click send with an undo toast and the preview only when
something is lossy (fastest, but you asked to be told *before* sending, so C is only offered as
the **auto-sync** behaviour).

### 7.3 Status everywhere
- **Sidebar badge**: a 6-px dot right of the item title, only when it carries information: none
  for never-sent (avoid noise), green-hollow ring for in sync (shown only while hovering the
  item), amber dot = changed since last send, red dot = failed, violet dot = changed *in Notion*,
  lock = private/blocked. Folders roll up the worst child state. Tooltip says it in words.
- **Note header chip** (§7.1) with "Last sent 2 h ago · Open in Notion ↗ · Send now".
- **Database**: chip in the database header; per-row state as a hidden-by-default column
  "Notion" (toggle in the view's property visibility).
**Alternatives:** dots (recommended, Dropbox-like, quiet); full icons per item (louder); only
the header chip (no overview).

### 7.4 Settings → Notion (new tab in the existing settings tab bar)
Sections top-down: **Connection** (workspace name + icon, root page link, "Change root",
Disconnect, token `…a91f`, capabilities check ✓) · **Mirror status** (counts: 1,204 in sync ·
12 changed · 2 failed · 3 need you · Send all changes) · **Auto-sync rules** (table: scope ·
mode · includes; "+ Add rule"; whole-brain toggle with D5 includes) · **Activity** (run list:
when, trigger, result, duration; expand → items; "Retry failed") · **Health** (last success,
rate-limit waits, canary ✓/✗, API version pinned `2026-03-11`) · **Danger zone** (Pause all
syncing [kill switch], Forget mapping for… (re-link), Disconnect).
Connect flow (empty state): 2 steps with screenshots inline. ① "Create an internal connection
in Notion → copy the token" (link to notion.so/profile/integrations), ② "Paste token" + "Share
one page with it, then pick it here" (we list pages the token can see; if none: "Share a page
with the connection in Notion (••• → Connections) and click Refresh").
**Alternatives:** single long page (recommended, matches the other settings pages); sub-tabs
(Connection / Rules / Activity); activity as a separate page linked from a sidebar badge.

### 7.5 Changed-in-Notion UX
Detected at plan time (cheap: `last_edited_by ≠ our bot` or `last_edited_time` later than the
time recorded after our push; deep check per [T2]). The item lands in **Needs you** with a violet
"Edited in Notion 3 h ago by Ayoub" pill. Expanding it shows a **side-by-side diff**: left
*Notion now* (from `GET /pages/:id/markdown`, one call), right *what we'd send* (our IR
rendered to the same markdown dialect), with changed lines highlighted. Three buttons:
**Overwrite with Second Brain** (danger-styled, needs a second click) · **Skip this time** (keeps
asking next time) · **Keep both: send as a copy** (creates "<title> (from Second Brain, Oct 7)"
next to it; the mapping moves to the copy; the edited original is *detached*, never touched
again, shown in Activity). A fourth, quiet link: **Stop mirroring this page** (per-item pause).
Dismissing the dialog = Skip, the safe option (lesson from the Workspaces review: "Dismissal must
pick the safe option").
**Alternatives:** diff side-by-side (recommended); inline diff (compact on mobile → used below
768 px); no diff, just the three buttons (fast, but blind).

### 7.6 Failure and edge cases (copy)
| Case | Where shown | Message | Recovery |
|---|---|---|---|
| Rate limited | progress panel, Activity | "Notion asked us to slow down. Continuing automatically in 40 s." | automatic |
| Notion down / 5xx | same | "Notion isn't responding. We'll retry; nothing is lost." | automatic, then needs-you after 6 tries |
| Token revoked / 401 | global banner + Settings | "Notion disconnected this app. Reconnect to resume. Your notes are safe." | Reconnect (kill switch auto-on) |
| Page unshared / 404 on a mapped page | item | "This page is no longer reachable in Notion (deleted or unshared)." | Re-create here · Forget mapping |
| Item too large (file > cap) | preview "Needs you" | "‘Lecture 10.pdf’ is 18 MB; your Notion plan accepts 5 MB per file. It will be linked, not copied." | accept link-out · skip file |
| Unsupported block | preview pill | "1 block Notion can't show (Button). It'll appear as a note in the page." | none needed |
| Edited in Notion | §7.5 | | |
| Private | preview "Not sent" | "Private: stays on this device." | Send once anyway |
| Schema mismatch (someone edited the database schema in Notion) | needs-you | "The ‘Mastery’ property was changed in Notion." | Restore schema · Skip |

### 7.7 Responsive, keyboard, Android
- < 1024 px: the review panel becomes a full-height sheet; < 768 px: preview rows stack, diff is
  inline. Sidebar dots unchanged.
- Keyboard: ⌘⇧N opens Send for the current page; in the panel ↑↓ moves rows, Space toggles,
  →/← expands, ⌘↵ sends, Esc closes (=cancel, never send).
- Android parity (new gap **#22** in ANDROID_PARITY.md): only the chip + "Send to Notion" menu
  item + read-only status. The engine is server-side, so the tablet needs no sync code.

## 8. Worked example: what happens when you send one collection
`Physics/` with 3 notes (one mentions another, one has a PDF, one is private), plus an inline
database.
1. Planner reads 3 notes + 1 DB → IR → hashes; all `new`; private note → *Not sent*; PDF 3 MB OK.
2. You confirm 2 notes + DB. Items: P0 ensure `Physics` page + its Notes DB; P1 inline DB shell;
   P3 two row shells (we write mapping `creating` first, then create, then store the id); P4 PDF
   upload + attach; P5 bodies (mention → real page mention, since the target's shell exists);
   P6 views.
3. Crash after P3's first create: on restart, `reconcile` finds mapping `creating`, queries the
   data source for `SB ID = <note id>` → found → adopts it (no duplicate) → continues.
4. Send again with no changes → planner: all `noop` → "Nothing to send" → 0 writes.

## 9. What is reused vs new
Reused: privacy gate (`privacy.py`), scheduler tick, CAS-transition pattern, notifications bell,
ConfirmDialog/useToast/`.ws-*`, `--menu-*` tokens, `notionBlocks.ts` (as a test oracle), CSV
export code (database snapshots in the backup). New: `services/portable` (IR), `services/notion_sync`,
`services/secrets.py`, migration 030, `routers/notion_sync.py`, `components/notion/*`.

## 10. Out of scope (stated, so nobody builds it by accident)
Pull or merge from Notion; two-way conflict resolution; syncing to more than one Notion
workspace at once; public OAuth (only if the app goes multi-user); real-time push on every
keystroke; Notion comments.

## 11. Divergence bugs to fix first (recommendation)
1. **B1** (interactive blocks in localStorage): the only case where data is invisible to the
   server; fix before claiming "the whole brain".
2. **B3** (silent deletion of unknown blocks): S effort, protects every future block type and
   matches the "never drop" rule the sync follows.
3. **B2** (24-h capture URLs): your own notes are already broken after a day; the sync can work
   around it, but you can't.
