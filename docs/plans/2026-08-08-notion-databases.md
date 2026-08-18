# Notion Databases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Notion's database system natively — every property type, view type, filter, sort, group, relation, rollup, formula, template and automation — on Supabase Postgres + FastAPI + Next.js.

**Architecture:** A database row **is** a `notes` row, so rows inherit the editor, embeddings, RAG, backlinks, trash and share links. Property *values* live in a narrow companion table `db_row_props` as JSONB keyed by short opaque property ids. A Python filter-AST→SQL compiler runs over asyncpg with fully parameterised queries. Formulas and rollups are materialised into a separate `computed` JSONB by a dependency-graph engine, which is what lets them filter and sort in SQL like ordinary values.

**Tech Stack:** FastAPI · asyncpg · Pydantic v2 · Postgres 16 (Supabase) · Next.js 16 App Router · React 18 · TanStack Table + TanStack Virtual · @dnd-kit · BlockNote 0.48 · Tailwind 3 · pytest · vitest · Playwright

**Spec:** `docs/superpowers/specs/2026-08-08-notion-databases-design.md`
**Research:** `docs/research/notion-databases-research.md`

---

## Global Constraints

- **No direct DB access.** `DATABASE_URL` in `backend/.env` is a placeholder for *migrations*. Every migration is a file **handed to the user** to run in the Supabase SQL editor (project `esfhsdukyhyrlgzflsad`). Migration-dependent work is gated — see **Migration Gates** below.
- **A real `DATABASE_URL` is required at runtime** for the query engine (approved decision). Supabase pooler connection string, port 6543, added to `backend/.env`.
- Backend tests: `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/ -p asyncio`
- Two venvs: `backend/.venv` = runtime (uvicorn), `backend/venv` = test venv with heavy deps stubbed by `conftest.py`. Do not mix them.
- Frontend: `cd frontend && npx tsc --noEmit && npm run build`; unit `npm run test` (vitest); e2e `npx playwright test` from `frontend/`.
- Whole stack: `./app.sh start|stop|status|logs`
- **No native `window.confirm/prompt/alert`** — they freeze the tab for browser automation. Use `components/ui/ConfirmDialog`, `PromptDialog`, `useToast()` from `app/providers.tsx`.
- **`createReactBlockSpec` returns a factory** — register as `database: DatabaseBlockSpec()`, invoked. Uninvoked crashes schema creation.
- Every migration: wrapped in `BEGIN`/`COMMIT`, uses `IF NOT EXISTS`, ends with a proof `SELECT`, and sets `SET LOCAL search_path = public, extensions;` if it mentions `vector`.
- Migrations start at **`014_`** (013 is the highest applied).
- New tables get RLS `FOR ALL TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()))` — the `(SELECT …)` form is required for the InitPlan optimisation.
- **Tenancy is enforced in the query builder, not by RLS** (asyncpg uses the service role). `_scope()` is mandatory on every generated query.
- Property keys are **8-char base62, immutable**. Never derive a SQL identifier from user input.

---

## Migration Gates

Work stops at each gate until the user confirms the migration is applied. Each gate has a **local pre-verification** step (Docker Postgres) so the SQL is known-good before it is handed over.

| Gate | Migration | Blocks | Proof query |
|---|---|---|---|
| **G1** | `014_databases_core.sql` — 5 tables, indexes, RLS | M2 onward | `SELECT count(*) FROM db_databases;` |
| **G2** | `015_relations.sql` — `db_relation_links`, sub-item/dependency system properties | M7 onward | `SELECT count(*) FROM db_relation_links;` |
| **G3** | `016_computed.sql` — `computed` column, expression indexes for hot properties | M8 onward | `SELECT count(*) FROM db_row_props WHERE computed <> '{}';` |
| **G4** | `017_templates_automations.sql` — `db_row_templates`, `db_automations` | M12 onward | `SELECT count(*) FROM db_automations;` |
| **G5** | `018_forms.sql` — public form submission policy + rate limit table | M13 (Form view) | `SELECT policyname FROM pg_policies WHERE tablename='db_row_props';` |

---

## Pre-existing bugs found while building the harness

Not caused by this work; recorded so they are not rediscovered. **Fixing them is not part of this plan** — raise with the user.

1. `supabase/migrations/005_notion_phase.sql:24` uses `CREATE POLICY IF NOT EXISTS`, which **Postgres supports in no version**. Verified: `ERROR: syntax error at or near "NOT"`. The `anon_read_public_notes` policy has therefore never been created, so `/share/[noteId]` likely returns nothing for signed-out visitors. Check with `SELECT policyname FROM pg_policies WHERE tablename='notes';`
2. `010_mcp_servers.sql` creates `mcp_servers` without `IF NOT EXISTS`; `009_ai_substrate.sql` creates it with. **The migration set is not replayable from 001 in order.** New migrations must be independently applicable.

---

## File Structure

**Backend — new**

```
backend/services/db/
  connection.py        asyncpg pool lifecycle
  keys.py              base62 property-key minting
  properties/
    base.py            PropertyType protocol, registry
    scalar.py          title, rich_text, number, url, email, phone, checkbox
    choice.py          select, multi_select, status
    temporal.py        date, created_time, last_edited_time
    people.py          people, created_by, last_edited_by
    files.py           files, place, verification, button
    computed.py        formula, rollup, unique_id
    columns.py         COLUMN_BACKED allow-list (§6 of spec)
  query/
    ast.py             Pydantic filter/sort/group AST models
    compiler.py        AST → parameterised SQL
    operators.py       operator → SQL fragment, per property type
    aggregations.py    the 20 calculation functions
    builder.py         QueryBuilder + mandatory _scope()
  formula/
    lexer.py  parser.py  ast.py     Pratt parser
    typecheck.py                     type inference
    functions/ …                     93 builtins, by category
    evaluator.py                     tree-walking evaluator
    deps.py                          dependency graph, cycle detection
  rollup.py            rollup evaluation
  recompute.py         materialisation orchestration + liveness assertion
  relations.py         link CRUD, two-way pair semantics
  views.py             view CRUD, config validation, dangling-ref sweep
  templates.py         row templates + repeating schedules
  automations.py       triggers + action chain execution
  csv_io.py            import/export

backend/routers/databases.py   backend/models/database.py
```

**Frontend — new**

```
frontend/app/(brain)/brain/db/[databaseId]/page.tsx
frontend/components/database/
  DatabaseShell.tsx  ViewToolbar.tsx  RowPeek.tsx
  FilterBuilder.tsx  SortBuilder.tsx  GroupBuilder.tsx  PropertyMenu.tsx
  views/  TableView · BoardView · GalleryView · ListView · FeedView
          CalendarView · TimelineView · ChartView · MapView · FormView · DashboardView
  cells/  one editor per property type (24 files)
  DatabaseBlock.tsx
frontend/lib/database/  types.ts  useDatabaseView.ts  filterAst.ts
```

**Modified**

`backend/main.py` (register router) · `backend/core/config.py` (`database_url` becomes required) · `backend/services/indexer.py` (property preamble chunk) · `backend/services/agent/brain_tools.py` + `backend/mcp_server.py` (5 tools) · `frontend/components/editor/BlockEditor.tsx` (register `database` block) · `frontend/lib/hooks/useNotes.ts`, `components/sidebar/Sidebar.tsx`, `components/search/*`, `app/api/notes/route.ts`, `app/api/notes/search/route.ts`, `app/api/notes/trash/route.ts` (exclude database rows) · `STATUS.md` · `ANDROID_PARITY.md`

---

## Milestone Sequence

| M | Deliverable | Ships | Gate |
|---|---|---|---|
| 0 | Local PG harness + storage benchmark | Go/no-go evidence for the storage decision | — |
| 1 | asyncpg layer, property registry, key minting, notes-row exclusion sweep | Backend foundation; sidebar unaffected by future rows | — |
| 2 | Migration 014 + database/data-source/property CRUD + **"All Notes" virtual source** | **Table view over the entire existing brain** | G1 |
| 3 | Filter→SQL compiler + sorts + pagination | Filter and sort any view | — |
| 4 | Grouping, sub-grouping, the 20 aggregations | Board-ready querying, calculations row | — |
| 5 | Remaining property types + cell editors | All 24 types editable | — |
| 6 | Board · Gallery · List · Feed views | Four more view surfaces | — |
| 7 | Relations, two-way pairs, sub-items, dependencies | Linked databases, hierarchy | G2 |
| 8 | Formula engine + rollups + materialisation | Formulas filterable/sortable in SQL | G3 |
| 9 | Calendar · Timeline (dependency arrows, date shifting) | Date-driven views | — |
| 10 | Chart view | 5 chart types | — |
| 11 | Inline databases in BlockNote | Databases inside notes | — |
| 12 | Row templates (incl. repeating), buttons, automations | Structure + automation | G4 |
| 13 | Form · Map · Dashboard views | Remaining surfaces | G5 |
| 14 | CSV import/export, AI integration, agent + MCP tools | Rows enter the RAG/agent layer | — |

Each milestone is independently shippable and independently testable.

---

## Milestone 0 — Local harness and the storage benchmark

**Why first:** research §K.8 #5 records that **no published benchmark** compares `ORDER BY` on a JSONB-extracted key against a real column for this workload. The spec's storage decision (§4) rests on an assumption this milestone converts into a measurement. It also builds the harness every later migration is verified against.

**Files**
- Create: `scripts/pgtest/supabase_shim.sql`, `scripts/pgtest/up.sh`, `scripts/pgtest/apply.sh`, `scripts/bench/storage_bench.py`, `docs/research/storage-benchmark-results.md`

**Test cases**
- `up.sh` starts `pgvector/pgvector:pg16`, applies the shim, and applies migrations 001–013 with **11 of 13 succeeding** — two fail on the pre-existing, out-of-scope bugs listed above, and `apply.sh` treats both as expected (it exits 0): **005** (`CREATE POLICY IF NOT EXISTS`, a clause Postgres has in no version) and **010** (duplicate `CREATE TABLE mcp_servers`, already created by 009). Any *other* failure is a real one and exits non-zero.
- Benchmark reports p50/p95 for: filtered `ORDER BY … LIMIT 50` at offset 0 and offset 10 000, and a filtered `COUNT(*)`, at 10k and 50k rows, with and without expression indexes.

- [ ] **Step 1: Write the Supabase shim**

`scripts/pgtest/supabase_shim.sql` — mirrors only what migrations 001–013 touch:

```sql
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, public BOOLEAN NOT NULL DEFAULT FALSE);
CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT REFERENCES storage.buckets(id), name TEXT NOT NULL, owner UUID);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[]
LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/'); $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon;          END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS vector SCHEMA extensions;
```

- [ ] **Step 2: Write `up.sh`**

Supabase puts pgvector in `extensions` and adds it to the role search_path. Without mirroring that, **every migration mentioning `vector` fails** — this is the exact trap that made migration 013 silently apply nothing twice.

```bash
#!/usr/bin/env bash
set -euo pipefail
docker rm -f sb-pgtest >/dev/null 2>&1 || true
docker run -d --name sb-pgtest -e POSTGRES_PASSWORD=pw -p 55432:5432 \
  pgvector/pgvector:pg16 >/dev/null
until docker exec sb-pgtest pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
docker exec sb-pgtest psql -U postgres -q \
  -c "ALTER DATABASE postgres SET search_path = public, extensions;"
docker cp scripts/pgtest/supabase_shim.sql sb-pgtest:/tmp/
docker exec sb-pgtest psql -U postgres -q -v ON_ERROR_STOP=1 -f /tmp/supabase_shim.sql
echo "ready on localhost:55432"
```

- [ ] **Step 3: Run it and confirm the expected 11/13**

Run: `./scripts/pgtest/up.sh && ./scripts/pgtest/apply.sh 001 013`
Expected: `OK` for all but the two pre-existing bugs above — `005_notion_phase` (`syntax error at or near "NOT"`) and `010_mcp_servers` (`relation "mcp_servers" already exists`). Both are in `apply.sh`'s `KNOWN_FAILURES` map, so the script prints `11 OK, 2 expected failure(s)` and **exits 0**; a non-zero exit means something genuinely broke.

- [ ] **Step 4: Write the benchmark**

`scripts/bench/storage_bench.py` generates 50 000 rows × 20 properties into both layouts (JSONB companion table, and a physical table with `f_<key>` columns) and times the product's actual view-load query.

- [ ] **Step 5: Run it and record results**

Run: `cd backend && .venv/bin/python ../scripts/bench/storage_bench.py --rows 10000,50000`
Write findings to `docs/research/storage-benchmark-results.md`.

**Decision gate.** If p95 for `WHERE <prop> = ? ORDER BY <other> LIMIT 50` exceeds **200 ms at 50 000 rows with expression indexes present**, stop and escalate: the spec §4.3 escape hatch applies and the storage decision must be revisited *before* M2 builds UI on it.

- [ ] **Step 6: Commit**

```bash
git add scripts/pgtest scripts/bench docs/research/storage-benchmark-results.md
git commit -m "test: local Postgres harness + storage layout benchmark"
```

**Test it now**

```bash
./scripts/pgtest/up.sh
./scripts/pgtest/apply.sh 001 013
cd backend && .venv/bin/python ../scripts/bench/storage_bench.py --rows 10000,50000
cat docs/research/storage-benchmark-results.md
```

---

## Milestone 1 — asyncpg layer, property registry, notes-row exclusion

**Ships:** backend foundation, and every existing notes surface hardened against database rows *before* any exist. No user-visible change.

**Files**
- Create: `backend/services/db/connection.py`, `keys.py`, `properties/base.py`, `properties/columns.py`, `backend/tests/test_db_keys.py`, `test_db_property_registry.py`, `test_db_connection.py`
- Modify: `backend/core/config.py`, `backend/main.py`, `frontend/lib/hooks/useNotes.ts`, `frontend/app/api/notes/route.ts`, `frontend/app/api/notes/search/route.ts`, `frontend/app/api/notes/trash/route.ts`, `frontend/components/sidebar/Sidebar.tsx`

**Interfaces**
- Produces: `get_pool() -> asyncpg.Pool`, `mint_key() -> str`, `PropertyType` protocol, `REGISTRY: dict[str, PropertyType]`, `COLUMN_BACKED: dict[str, ColumnProp]`

**Test cases**
- `mint_key()` returns 8 chars from `[0-9A-Za-z]`; 10 000 calls yield 10 000 distinct keys.
- `REGISTRY` contains all 24 type keys; every entry satisfies the `PropertyType` protocol.
- `COLUMN_BACKED` contains only names that exist as real `notes` columns (asserted against a hardcoded list of the 25 known columns).
- Every existing notes query excludes rows belonging to a data source.

- [ ] **Step 1: Write the failing key test**

```python
# backend/tests/test_db_keys.py
import re
from services.db.keys import mint_key

def test_mint_key_shape():
    k = mint_key()
    assert len(k) == 8
    assert re.fullmatch(r"[0-9A-Za-z]{8}", k)

def test_mint_key_unique():
    assert len({mint_key() for _ in range(10_000)}) == 10_000
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/test_db_keys.py -p asyncio -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.db.keys'`

- [ ] **Step 3: Implement**

```python
# backend/services/db/keys.py
import secrets

_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

def mint_key(length: int = 8) -> str:
    """Short opaque JSONB key for a property. Immutable once assigned."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Write the failing column allow-list test**

```python
# backend/tests/test_db_property_registry.py
from services.db.properties.columns import COLUMN_BACKED

NOTES_COLUMNS = {
    "id","user_id","collection_id","title","content","content_text","source_type",
    "source_url","source_filename","topics","mastery_status","is_indexed","created_at",
    "updated_at","deleted_at","icon","is_favorited","last_viewed_at","position",
    "cover_image_url","is_public","fts","local_only","descriptor","descriptor_embedding",
}

def test_column_backed_names_are_real_columns():
    for prop in COLUMN_BACKED.values():
        assert prop.column in NOTES_COLUMNS, f"{prop.column} is not a notes column"

def test_column_backed_identifiers_are_safe():
    import re
    for prop in COLUMN_BACKED.values():
        assert re.fullmatch(r"[a-z_]+", prop.column)
```

- [ ] **Step 6: Run it, verify it fails, then implement `columns.py` and `base.py`**

Implement `COLUMN_BACKED` exactly as spec §6, and the `PropertyType` protocol as spec §5.

- [ ] **Step 7: Add the asyncpg pool**

```python
# backend/services/db/connection.py
import asyncpg
from core.config import settings

_pool: asyncpg.Pool | None = None

async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        if not settings.database_url:
            raise RuntimeError(
                "DATABASE_URL is required for the database query engine. "
                "Use the Supabase pooler connection string (port 6543)."
            )
        _pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=10)
    return _pool
```

Add `asyncpg` to the test venv: `backend/venv/bin/pip install asyncpg`

- [ ] **Step 8: Exclude database rows from every notes surface**

Each of these queries must gain a `NOT EXISTS (SELECT 1 FROM db_row_props p WHERE p.note_id = notes.id)` equivalent. Until migration 014 is applied the table does not exist, so this step **ships behind the `database_rows_enabled` flag** in `core/config.py`, default `False`, flipped in M2.

Modify, in this order: `frontend/app/api/notes/route.ts` (list), `search/route.ts`, `trash/route.ts`, then `useNotes.ts` and `Sidebar.tsx` consume the unchanged shape.

- [ ] **Step 9: Run the full suites**

Run:
```bash
cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/ -p asyncio
cd ../frontend && npx tsc --noEmit && npm run test
```
Expected: all green, no behavioural change.

- [ ] **Step 10: Commit**

```bash
git add backend/services/db backend/tests/test_db_*.py backend/core/config.py frontend/
git commit -m "feat(db): asyncpg pool, property registry, column allow-list"
```

**Test it now**

```bash
cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/test_db_keys.py tests/test_db_property_registry.py -p asyncio -v
cd ../frontend && npx tsc --noEmit && npm run test
./app.sh start && open http://localhost:3000/brain   # sidebar unchanged
```

---

## Milestone 2 — Migration 014, CRUD, and the "All Notes" virtual source

**Ships: a table view over the user's entire existing brain**, with mastery as a Status property and topics as a Multi-select — with **zero rows migrated**, because the source is virtual (spec §6).

**Files**
- Create: `supabase/migrations/014_databases_core.sql`, `backend/models/database.py`, `backend/routers/databases.py`, `backend/services/db/views.py`, `frontend/app/(brain)/brain/db/[databaseId]/page.tsx`, `frontend/components/database/DatabaseShell.tsx`, `views/TableView.tsx`, `cells/{Title,Text,Number,Select,MultiSelect,Status,Date,Checkbox}Cell.tsx`, `frontend/lib/database/{types.ts,useDatabaseView.ts}`
- Modify: `backend/main.py`, `frontend/components/sidebar/Sidebar.tsx`

**Test cases (backend)**
- Creating a database creates exactly one data source and one default table view.
- Creating a property mints a unique 8-char key; a second property with the *same name* succeeds with a different key.
- Renaming a property changes `name` and **leaves `key` and every row untouched** (assert row JSONB byte-identical).
- Deleting a property sweeps its id from every view's `filter`, `sorts` and `config.properties[]`.
- The "All Notes" source lists the user's notes and **excludes** other users' notes and trashed notes.
- Every generated query contains the `user_id` scope predicate (the guard test).

**Test cases (frontend)**
- `TableView` renders 8 property types read-only, then editable.
- Optimistic edit rolls back and toasts on a 500.

- [ ] **Step 1: Write migration 014**

Full DDL per spec §3.2 — 5 tables, indexes, RLS with `(SELECT auth.uid())`, ending with:

```sql
SELECT 'migration 014 applied' AS status,
       (SELECT count(*) FROM information_schema.tables
        WHERE table_name LIKE 'db\_%') AS db_tables_created;
```

- [ ] **Step 2: Verify it locally BEFORE handing it over**

Run: `./scripts/pgtest/up.sh && ./scripts/pgtest/apply.sh 001 014`
Expected: `014` applies cleanly and the proof row reports `db_tables_created = 5`.

- [ ] **Step 3: 🚦 GATE G1 — hand the migration to the user**

Stop. Give the user `supabase/migrations/014_databases_core.sql` to run in the Supabase SQL editor (project `esfhsdukyhyrlgzflsad`), and the proof query to paste back. **Do not proceed until they confirm.**

- [ ] **Step 4–N: TDD the CRUD layer, then the table view**

Write each failing test from the list above, run it, implement minimally, run again, commit. Order: models → router → views service → virtual source → frontend hook → `TableView` → cells.

**Test it now**

```bash
cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/test_databases_*.py -p asyncio -v
cd ../frontend && npx tsc --noEmit && npm run build
./app.sh start
# → http://localhost:3000/brain/db/all-notes  — your whole brain as a table
```

---

## Milestones 3–14

Each follows the same shape: failing test → run → minimal implementation → run → commit; migration-bearing milestones pre-verify locally then stop at their gate. The task-level breakdown for each is expanded by the executing session from the spec section named below — the spec is written to task granularity, so no design decisions are deferred to implementation.

### M3 — Filter→SQL compiler, sorts, pagination · spec §8
**Files:** `services/db/query/{ast,operators,compiler,builder}.py`, `tests/test_db_compiler.py`, `test_db_operators.py`, `test_db_injection.py`
**Test cases:** all ~140 (type × operator) pairs compile to expected SQL + params; nested AND/OR to depth 10; **unknown property key → HTTP 400, never a dropped clause**; `ASC NULLS LAST` / `DESC NULLS FIRST` on every sortable type; **injection suite** — property keys and values containing `'; DROP TABLE notes; --` appear only as bound parameters and never in the SQL string; the `_scope()` guard test asserts every compiled query in the suite carries `user_id`.
**Verify:** `pytest tests/test_db_compiler.py tests/test_db_injection.py -p asyncio -v`

### M4 — Grouping, sub-grouping, aggregations · spec §5.1, research §I.4–5
**Test cases:** the 20 aggregations against a fixture with nulls, including the **decided empty-set results** (`sum`→0, `average`/`median`/`min`/`max`/`range`→null, `percent_*`→null); "count values" on multi_select counts **tags not cells**; date grouping `relative|day|week|month|year` with **Monday** week start; number range bucketing; group counts and collapse state.

### M5 — Remaining property types + cell editors · spec §5
**Test cases:** per type — default, `is_empty`, `coerce_write` rejects malformed input, sort order, and its operator set. 40 number formats; status groups; date ranges + timezone; unique_id counters **consume numbers for deleted rows** (gaps permanent).

### M6 — Board · Gallery · List · Feed · spec §10, research §G
**Test cases:** board drag sets the group property; `hide_empty_groups`; `card_layout`/`cover`/`cover_size`/`cover_aspect`; sub-grouping (Board only); Feed built from Help Center prose — **flag any behaviour not derivable from a source rather than inventing it**.

### M7 — Relations, two-way pairs, sub-items, dependencies · spec §9 · 🚦 **GATE G2**
**Test cases:** creating a link from either side produces **exactly one** `db_relation_links` row; deleting one side deletes the pair; self-relations; sub-item depth capped at **10**; dependency cycles **rejected with the cycle path**; the three date-shift modes by their real names — `Shift only when dates overlap`, `Shift & maintain time between items`, `Do not automatically shift` — plus `Avoid weekends`.

### M8 — Formula engine + rollups · spec §7 · 🚦 **GATE G3**
**Test cases:** parser — `^` right-associative, comparisons **non-associative** (`1 > x > 5` is a parse error), `not` at precedence 9; semantics — `empty(0)` is `true`, `empty()` is the null literal, `dateBetween(a,b,u)` is **a − b**, no `"seconds"` unit; all 93 functions with a golden-value table; type checker rejects `add(2,"2")` while `+` concatenates; cycles rejected at save; depth 15 and relation depth 3 yield `{"type":"unsupported"}`; **volatile formulas are never materialised**; Grist's **liveness assertion** fires when a pass computes zero cells.

### M9 — Calendar · Timeline · research §G.5–6
**Test cases:** `view_range` week/month; `show_weekends`; timeline `zoom_level` across all **8** levels (`hours|day|week|bi_week|month|quarter|year|5_years`); `arrows_by` renders dependency arrows; date shifting honours the M7 modes.

### M10 — Chart view · research §G.9
**Test cases:** all 5 `chart_type`s (`column|bar|line|donut|number`); y-axis aggregator; `stack_by` + `group_style`; reference lines; `hide_empty_groups`. Charts are rendered as inline SVG — no charting dependency.

### M11 — Inline databases in BlockNote · spec §11.3
**Test cases:** `DatabaseBlockSpec()` **invoked** in the schema (a test asserts the schema builds — uninvoked throws `Cannot read properties of undefined (reading 'node')`); round-trips through save/load; `/database` slash command; nested virtualiser does not capture editor scroll.

### M12 — Templates, buttons, automations · research §J.5–6 · 🚦 **GATE G4**
**Test cases:** template captures properties + page body; repeating schedules; button action chains (all documented actions); automation triggers on property change; **Slack/Teams actions are absent by design** (spec §1) and the UI says so rather than offering a dead control.

### M13 — Form · Map · Dashboard · 🚦 **GATE G5**
**Blocked on a user decision:** Map needs a geocoding/tile provider (none configured; spec §15.2). Ask before starting M13.
**Test cases:** form public submission is rate-limited and writes only to its own data source; anonymous submission cannot read existing rows; `submission_permissions` levels degrade to what our identity model supports; dashboard 12-column widget grid.

### M14 — CSV import/export, AI integration · spec §12
**Test cases:** CSV import infers property types and reports per-column inference; export honours the current view's filters and sorts; the **property preamble chunk** appears as chunk 0 in `note_chunks`; the 5 agent tools; `brain.query_database` goes through the **same compiler** and therefore inherits tenancy scoping (asserted).

---

## Self-Review

**Spec coverage.** §1 scope → M2–M14. §3 data model → M2/M7/M8/M12/M13 migrations. §4 storage → M0 gate + M1/M2. §5 properties → M5. §6 column-backed → M2. §7 formulas → M8. §8 compiler → M3. §9 relations → M7. §10 views → M2/M6/M9/M10/M13. §11 frontend → M2/M6/M11. §12 AI → M14. §13 gates → G1–G5. §14 Android → below. §15 risks → M8 tranches, M13 gate, M1 sweep.

**Gap found and closed:** the spec's §15.4 risk (existing notes queries must exclude database rows) had no home; it is now M1 Step 8, deliberately *before* any rows exist.

**Type consistency:** `mint_key()`, `get_pool()`, `PropertyType`, `COLUMN_BACKED`, `_scope()` are used with the same names and signatures in M1 and every later milestone.

---

## Final task — update project trackers

- [ ] Add to `STATUS.md` a "Notion Databases" section: phase, milestone table, current gate.
- [ ] Add gap **#21** to `ANDROID_PARITY.md`: "Databases — property types, views, filters, formulas, relations." Note that because rows are notes, Android already syncs row *bodies*; what is missing is the property/view/query layer.
