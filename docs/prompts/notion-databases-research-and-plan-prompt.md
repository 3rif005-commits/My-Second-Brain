# Research + plan prompt — Notion-parity databases

Paste everything below the line into a **fresh session** (Opus 5, **not** Fable).
This session produces **research + spec + plan only — no implementation code.**
A later session executes the plan.

---

**Use ultrathink for every judgment call in this task.** Budget is not a concern —
depth is. Take as many turns, searches, and subagents as the work actually needs.
Do not shortcut to a plan; the whole value here is that the plan is *complete* and
*correct* before a line of code is written.

## The goal

Bring **Notion's database system into this app at full parity** — every property
type, every view type, every view configuration, filters, sorts, grouping,
relations, rollups, formulas, sub-items, dependencies, templates, aggregations —
implemented natively on our own stack (Supabase Postgres + FastAPI + Next.js),
**not** by integrating with Notion's API. Notion is the *specification*, not a
dependency. We are cloning the architecture and the feature surface.

Anything less than parity is a failure of this task. Where a feature genuinely
cannot be reproduced (real-time multiplayer cursor presence, Notion AI-hosted
properties, Notion-account-scoped permissions), say so explicitly with the reason
and propose the closest thing we *can* build — do not silently drop it.

## Deliverables (in this order, all committed to the repo)

1. `docs/research/notion-databases-research.md` — the authoritative feature
   inventory, from real research, not memory. Every property type, every view,
   every option on every view, every filter operator per property type, every
   aggregation function, the formula language surface. Cite sources inline.
2. `docs/superpowers/specs/<date>-notion-databases-design.md` — the approved
   design: data model, formula/rollup evaluation architecture, filter→SQL
   compilation, API surface, component tree, migration path for existing data.
3. `docs/plans/<date>-notion-databases.md` — the phased implementation plan,
   written with the **`superpowers:writing-plans`** skill, sequenced into
   independently shippable milestones with test cases per milestone.

Stop after these three. Do not start implementing.

## Process

1. **Research first.** Use WebSearch/WebFetch heavily. Your training data on
   Notion is stale and incomplete — Notion shipped Charts views, the Place
   property, the data-source/database split in API version `2025-09-03`, and
   formula 2.0 changes. **Assume you are missing things and go find them.**
   Primary sources, in rough priority order:
   - Notion API reference & changelog (`developers.notion.com`) — the property
     type schemas there are the closest thing to a formal spec of the data model.
   - Notion Help Center (`notion.com/help`) — the *UX* surface the API doesn't
     expose: view configs, filter groups, calculations row, board grouping
     options, sub-items, dependencies, templates, locked views.
   - Notion's formula reference — the full function list, types, and semantics.
   - Reverse-engineering write-ups of Notion's internal block/collection model
     (the "everything is a block" schema, `collection` / `collection_view` /
     `schema` shape) — useful architectural prior art for how *they* store this.
   Dispatch parallel subagents per research area if that speeds it up
   (`superpowers:dispatching-parallel-agents`), but you own the synthesis.
2. **Then brainstorm the architecture** with `superpowers:brainstorming` for the
   decisions listed under "Hard architectural questions" below. These are real
   forks with real trade-offs; do not pick the first option that comes to mind.
   Ask me the questions where my answer actually changes the design.
3. **Then write the spec, then the plan** (`superpowers:writing-plans`).

## Read first — the ground you're building on

- `PLAN.md` (architecture reference), `STATUS.md` (live task tracker — this work
  gets a section there), `NOTION_PHASE.md` (an *earlier, completed* phase that
  cloned Notion's **page/editor** UX — trash, Cmd+K, icons, breadcrumbs,
  favorites, properties panel, backlinks, share links. This new work is the
  **database** half that phase deliberately left out. Read it so you extend it
  rather than re-litigate it.)
- `supabase/migrations/001_initial_schema.sql` — the `notes`, `collections`,
  `profiles` tables you must integrate with. Note `notes` already carries
  `topics TEXT[]`, `mastery_status`, `source_type`, `source_url`, `icon`,
  `is_favorited`, `position` — i.e. **the app already has an ad-hoc, hardcoded
  property set that a real database schema should subsume.** Migrations run to
  `013_note_sources.sql`; yours start at `014_`.
- `supabase/migrations/002_rls_policies.sql` — every new table needs RLS in the
  same shape.
- `backend/main.py`, `backend/routers/notes.py`, `backend/models/note.py`,
  `backend/services/` — FastAPI conventions, router registration, Pydantic models.
- `frontend/app/(brain)/brain/`, `frontend/components/sidebar/Sidebar.tsx`,
  `frontend/components/editor/BlockEditor.tsx`, `customBlocks.tsx`,
  `NoteProperties.tsx` — Next.js 16 App Router, BlockNote 0.48, Tailwind 3,
  `@dnd-kit` (already installed — use it for board drag and column reorder).
- Auto-memories: `project_workspaces_feature`, `project_workspaces_redesign`,
  `project_backend_test_quirks`, `feedback_test_after_milestone`.

## Feature surface — the parity checklist

This is your **starting** checklist, deliberately non-exhaustive. Research must
*expand* it. Any item you cannot find documentation for, flag as unresolved
rather than guessing at its behavior.

**Database object model**
- Database as a collection of **pages** — every row is a full page with its own
  body content, icon, cover, and comments. This is the single most important
  structural fact; the design must honor it.
- Inline vs full-page databases · linked/synced views of a database elsewhere ·
  the `2025-09-03` database↔data-source split and whether we adopt it · locked
  databases and locked views · database description · duplicate-as-template.

**Property types** — for each: config options, default value, empty semantics,
sort order, filter operators, and how it's rendered in each view.
Title · Text · Number (all display formats incl. currencies, percent, and
bar/ring progress with divide-by) · Select · Multi-select · Status (with its
To-do/In-progress/Complete groups) · Date (time, ranges, time zone, reminders,
formats) · Person · Files & media · Checkbox · URL · Email · Phone · Formula ·
Relation (one-way, two-way synced, self-relation, limit) · Rollup · Created time ·
Created by · Last edited time · Last edited by · Last visited time · Unique ID
(with prefix) · Button (and its full action list) · Place · Verification ·
AI-backed properties (summary/translation/custom autofill — decide build vs
defer, we have our own LLM substrate in `backend/services/ai/`).
Plus per-property: description, wrap text, visibility, width, duplication.

**View types and their configs**
Table · Board · Timeline · Calendar · List · Gallery · Chart.
For each: which config options exist (grouping + sub-grouping, hidden/empty
groups, card size and preview source, row height, wrapped cells, visible
properties and their order, page-open mode — side peek / center / full page,
timeline zoom levels and date-range properties, calendar by-date/by-week, chart
axes and aggregation).

**Querying**
- Filters: simple and advanced, nested AND/OR filter groups, every operator per
  property type, filters on rollups and formulas.
- Sorts: multi-level, ascending/descending, per-view persistence.
- Grouping and sub-grouping, per-group collapse and counts.
- The calculations row: count all / values / unique / empty / not empty, percent
  empty / not empty, sum, average, median, min, max, range, earliest, latest,
  date range, checked / unchecked / percent checked.
- Search within a database, pagination / load-more, row limits.

**Structure and automation**
- Sub-items (parent/child rows inside one database) and dependencies
  (blocking / blocked-by, with timeline rendering and date shifting).
- Database templates (row templates), including repeating templates.
- Database automations (property-change triggers, button actions) — scope or
  defer explicitly.
- Import CSV · export CSV/Markdown.

**Formulas**
The full formula 2.0 language: type system (including lists and page
references), every built-in function, `let`/`lets`, `ifs`, dot notation, list
map/filter/find/sort, date arithmetic, regex, and the styled/linked/mention
return values. Decide the evaluation strategy — this is one of the hard
questions below.

## Hard architectural questions the spec must answer

Do not defer these to implementation. Each needs a decision, the alternatives
considered, and the reason.

1. **Row storage.** Dynamic per-database Postgres tables, an EAV table, or a
   single rows table with a `properties JSONB` column plus a schema table? What
   does each cost at filter/sort/aggregate time, with GIN indexes, at 10k rows?
   Which one survives adding a property to a database with existing rows?
2. **Rows are pages.** Does a database row reuse the existing `notes` table (row
   = note, so it gets BlockNote content, embeddings, backlinks, share links, and
   the whole existing feature set for free) or live in its own table with a
   separate optional page body? Argue it properly — this decision propagates
   everywhere, including into the RAG/agent layer and Android parity.
3. **Existing metadata migration.** `notes.topics`, `mastery_status`,
   `source_type`, `source_url` are today hardcoded columns surfaced by
   `NoteProperties.tsx`. Do they become properties of a built-in "Notes"
   database? What's the backfill migration, and what stays hardcoded?
4. **Formula engine.** Where does it run — Python on the backend, TypeScript on
   the client, or both (shared grammar, two evaluators)? Parser choice, type
   checker, dependency graph between formula/rollup properties, cycle detection,
   incremental recompute on write vs compute on read vs materialized cache with
   invalidation. How do formulas participate in filters and sorts *in SQL*?
5. **Rollups and relations.** Junction table shape, two-way sync semantics on
   create/delete, rollup evaluation (SQL aggregate vs application-level), rollups
   over rollups, and the depth limit we enforce.
6. **Filter → SQL compilation.** The filter AST, its JSON serialization, and a
   compiler to parameterized SQL. **Injection safety is a hard requirement** —
   no string interpolation of user-supplied property names or values.
   How do RLS policies interact with the generated queries?
7. **View persistence and sharing.** `db_views` table with JSONB config? Are
   views per-user or shared? What happens to a saved view when its property is
   deleted?
8. **Inline databases in BlockNote.** A custom block spec that hosts a full
   database view inside a note. Memory gotcha: `createReactBlockSpec` must be
   used as a factory function — see `project_workspaces_feature` and
   `customBlocks.tsx`.
9. **Frontend performance.** Virtualized table rendering, column resize/reorder,
   optimistic updates, and whether we use Supabase Realtime for row-level
   collaboration or stick with the existing debounced-save pattern.
10. **AI integration.** Rows are searchable knowledge — how do database rows
    enter the embedding/chunking pipeline (`backend/services/indexer.py`,
    `block_chunker.py`) and what agent tools does the substrate get for querying
    databases (`backend/services/agent/`)?
11. **Android parity.** `ANDROID_PARITY.md` gap #20 is already open for
    Workspaces. Note what this adds to the Android backlog; don't plan the
    Android work here.

## Environment constraints (all confirmed, don't rediscover them)

- **No direct DB access from this machine.** `DATABASE_URL` in `backend/.env` is
  a placeholder. Every migration must be written as a file and then **handed to
  me to run** in the Supabase SQL editor (project `esfhsdukyhyrlgzflsad`). The
  plan must therefore be sequenced so migration-dependent work is explicitly
  gated, and each gate is called out as a stop-and-ask point.
- Backend tests: two venvs and a ROS plugin conflict —
  `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/ -p asyncio`
- Frontend: `cd frontend && npx tsc --noEmit && npm run build`, unit tests via
  `npm run test` (vitest), e2e via Playwright in `frontend/e2e/`.
- Whole stack: `./app.sh start|stop|status|logs`.
- **No native `window.confirm/prompt/alert`** — they freeze the tab for browser
  automation. Use the existing `ConfirmDialog` / `PromptDialog` / `useToast()`.

## Plan requirements

- Phase it. This is a multi-week feature; the plan must have milestones that each
  ship something usable and testable on their own (a reasonable spine: schema +
  basic property types + table view → filters/sorts/grouping → remaining
  property types → relations/rollups → formulas → remaining views → sub-items,
  dependencies, templates → inline databases → AI integration).
- Every milestone lists its **test cases** up front (backend pytest, frontend
  vitest, Playwright e2e) — the implementation session works TDD per
  `superpowers:test-driven-development`.
- Every milestone lists the exact files it creates and modifies.
- Call out the migration gates explicitly.
- Per `feedback_test_after_milestone`, end each milestone with the CLI commands
  I run to verify it myself.
- Update `STATUS.md` with a section for this phase when the plan is done.

## Definition of done for *this* session

The research doc, the spec, and the plan exist; the parity checklist above has
been expanded and every item is either designed for or explicitly deferred with
a reason; all eleven architectural questions have a decided answer with
rationale; and you have asked me the questions whose answers would change the
design. Then stop and hand back for approval before implementation begins.
