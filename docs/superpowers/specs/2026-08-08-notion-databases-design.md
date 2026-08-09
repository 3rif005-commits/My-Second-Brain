# Notion Databases — Design

> **Status:** approved design, pending implementation.
> **Date:** 2026-08-08
> **Research:** `docs/research/notion-databases-research.md` (7,497 lines, 186 catalogued unknowns)
> **Plan:** `docs/plans/2026-08-08-notion-databases.md`
>
> Builds Notion's database system natively on Supabase Postgres + FastAPI + Next.js.
> Notion is the specification, not a dependency. This extends the earlier
> `NOTION_PHASE.md` (page/editor UX) with the database half it deliberately left out.

---

## 1. Scope

**In scope — everything.** All 22 API property types plus Button, Verification and AI
autofill. All 11 view types including Chart, Form, Map, Feed and Dashboard. Filters with
arbitrary nesting, multi-level sorts, grouping and sub-grouping, the 20-function
calculations row, relations, rollups, the 88-function formula language, sub-items,
dependencies, row templates (incl. repeating), buttons, database automations, CSV
import/export, inline databases, and AI-backed properties.

**Non-goals**, with reasons — the full table is research §E. Summarised:

| Not building | Why | What we build instead |
|---|---|---|
| Real-time multiplayer presence/cursors | Needs CRDT + socket fabric; app is single-user, saves on a 2s debounce | Optimistic updates, last-write-wins. Realtime deferred (§11.4) |
| Notion-account permissions (teamspaces, guests, per-page grants) | One `profiles` row per user; nobody to grant to | Owner-only RLS + existing public share links |
| Slack/Teams/email automation actions | External OAuth apps we don't have | In-app toast + generic outbound webhook |
| Notion Calendar two-way sync | Separate product | `.ics` export |
| Notion-hosted AI models | Not accessible | Our own `services/ai/` substrate + per-user `ai_providers` keys — strictly better, we control the model |

Person / Created by / Last edited by are built and correct, but degenerate: they always
resolve to the single workspace member. Schema parity is preserved for future multi-user.

---

## 2. Decisions summary

The eleven architectural questions, answered. Rationale follows in the numbered sections.

| # | Question | Decision |
|---|---|---|
| 1 | Row storage | **JSONB** in a narrow companion table, keyed by short opaque property ids. Not dynamic physical tables — see §4.1 for why the prior art's recommendation doesn't transfer |
| 2 | Rows are pages | **Row = `notes` row.** Property values in `db_row_props(note_id PK)`. Rows inherit body, embeddings, RAG, backlinks, trash, share links, Android sync |
| 3 | Existing metadata | **Column-backed properties.** `topics`/`mastery_status`/`source_type`/`source_url` become properties of a *virtual* "All Notes" data source. **Zero backfill** |
| 4 | Formula engine | **Backend-only.** Hand-written Pratt parser → one AST → three visitors (eval, typecheck, dependency-extract). Results materialised into a separate `computed` JSONB |
| 5 | Relations/rollups | Single `db_relation_links` table keyed by *relation pair*, not per-side — two-way sync is structural, not synchronised. Rollups materialise like formulas |
| 6 | Filter → SQL | Filter AST → parameterised SQL via asyncpg, three-layer defence. Property keys are **bound parameters**, never interpolated |
| 7 | View persistence | `db_views` with JSONB config, shared (single-user). Dangling property refs tolerated at read, swept on delete |
| 8 | Inline databases | `createReactBlockSpec` **factory — must be invoked**. Props `{dataSourceId, viewId}`, `content: "none"` |
| 9 | Frontend | TanStack Table + TanStack Virtual. Hand-rolled optimistic data layer matching existing hooks. @dnd-kit (installed) for board/column drag |
| 10 | AI integration | Rows are notes → already indexed. Add a property preamble chunk + 5 new agent/MCP tools including filter-AST querying |
| 11 | Android parity | New gap #21 in `ANDROID_PARITY.md`. Not planned here |

---

## 3. Data model

Eight new tables across the whole feature, landing over four gated migrations: five in
`014_databases_core.sql` (`db_databases`, `db_data_sources`, `db_properties`,
`db_row_props`, `db_views`), one in `015_relations.sql` (`db_relation_links`), and two in
`017_templates_automations.sql` (`db_row_templates`, `db_automations`) — see the plan's
Migration Gates table. `018_forms.sql` adds a further table for form-submission rate
limiting, outside this original architecture count. All follow existing conventions:
`BEGIN`/`COMMIT`, `IF NOT EXISTS`, `user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE
CASCADE`, RLS `FOR ALL TO authenticated`, and a proof `SELECT` at the end of each migration.

```
db_databases        container (Notion's post-2025-09-03 "database")
  └─ db_data_sources   schema + row set (Notion's "data source")
       ├─ db_properties   property registry (the schema)
       ├─ db_views        saved views, JSONB config
       └─ db_row_props    ─1:1─ notes    ← the rows
db_relation_links   junction, keyed by relation PAIR
db_row_templates    row templates incl. repeating schedules
db_automations      triggers + action chains
```

### 3.1 Why the database ↔ data-source split is adopted now

Notion split these in API `2025-09-03`: a *database* is a container, a *data source* is a
schema plus rows, and one database may hold several data sources
([upgrade guide](https://developers.notion.com/docs/upgrade-guide-2025-09-03)).

Adopting it now costs one table and one FK hop. Retrofitting it later means rewriting
every foreign key, every view config, every API path and every stored filter — Notion's own
migration broke integrations badly enough to need a machine-readable
`multiple_data_sources_for_database` error. We take the cheap version of that pain now.

The UI initially creates exactly one data source per database and hides the concept
entirely, which is also Notion's default presentation.

### 3.2 Core DDL (abridged — full text in migration `014`)

```sql
CREATE TABLE db_databases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'Untitled',
  description JSONB NOT NULL DEFAULT '[]',   -- rich text
  icon        TEXT,
  cover_url   TEXT,
  is_inline   BOOLEAN NOT NULL DEFAULT FALSE,
  parent_note_id UUID REFERENCES notes(id) ON DELETE CASCADE,  -- inline host
  is_locked   BOOLEAN NOT NULL DEFAULT FALSE,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE TABLE db_data_sources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  database_id UUID NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Default',
  -- NULL for ordinary sources; 'notes' marks the built-in virtual source (§6)
  system_kind TEXT CHECK (system_kind IN ('notes')),
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE db_properties (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id UUID NOT NULL REFERENCES db_data_sources(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- The JSONB key. Short, opaque, immutable. Notion's lesson (§4.2).
  key            TEXT NOT NULL,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,
  config         JSONB NOT NULL DEFAULT '{}',   -- per-type; see §5
  description    TEXT,
  -- 'jsonb' → db_row_props.properties->key ; 'column' → a notes column (§6)
  storage        TEXT NOT NULL DEFAULT 'jsonb'
                 CHECK (storage IN ('jsonb','column')),
  column_name    TEXT,                          -- allow-listed, storage='column' only
  -- Materialised formula/rollup result type, set by the type checker
  result_type    TEXT,
  is_volatile    BOOLEAN NOT NULL DEFAULT FALSE, -- references now()/today()
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (data_source_id, key)
);

CREATE TABLE db_row_props (
  note_id        UUID PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  data_source_id UUID NOT NULL REFERENCES db_data_sources(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  properties     JSONB NOT NULL DEFAULT '{}',  -- user-authored values
  computed       JSONB NOT NULL DEFAULT '{}',  -- formula/rollup results (§7)
  position       DOUBLE PRECISION NOT NULL DEFAULT 0,  -- manual drag order
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX db_row_props_ds_pos_idx ON db_row_props (data_source_id, position);
CREATE INDEX db_row_props_props_gin  ON db_row_props USING gin (properties jsonb_path_ops);
CREATE INDEX db_row_props_comp_gin   ON db_row_props USING gin (computed  jsonb_path_ops);
```

`jsonb_path_ops` is chosen over the default GIN opclass: smaller and faster for the `@>`
containment queries that select/multi-select/status/checkbox filters compile to, at the
cost of the key-existence operators we do not use
([PG docs](https://www.postgresql.org/docs/current/datatype-json.html)).

### 3.3 Value encoding

`properties` mirrors Notion's page-property-values shape — a discriminated object per
property, keyed by the property's short `key`:

```json
{
  "a7Kd9x": { "type": "number",       "number": 42 },
  "p2Lm4q": { "type": "multi_select", "multi_select": ["opt_a1", "opt_c9"] },
  "z8Rt0v": { "type": "date",         "date": { "start": "2026-08-08",
                                                "end": null, "time_zone": null } }
}
```

Two properties of this shape matter:

- **`@>` containment works directly** for select/multi-select/status/checkbox/relation:
  `properties @> '{"p2Lm4q":{"multi_select":["opt_a1"]}}'` is GIN-indexed.
- **It is self-describing**, so a row round-trips without consulting the schema — which
  matters for the agent tools and CSV export.

Absent key ≡ empty. **Adding a property to a data source with existing rows is a metadata
insert and touches no rows at all.**

---

## 4. Q1 — Row storage

### 4.1 Why JSONB, against the prior art's recommendation

Research §K surveyed every mature OSS clone and found near-unanimity: Teable, Baserow,
NocoDB, undb and Directus all use **dynamic physical Postgres tables**, and its labelled
recommendation was to follow them. That recommendation is correct for the systems it was
drawn from and wrong here, because four of its load-bearing assumptions invert:

1. **We cannot run DDL.** Those projects own their Postgres connection. This project's
   `DATABASE_URL` reaches a pooler; schema changes are hand-run by the user in the Supabase
   SQL editor. Runtime `CREATE TABLE`/`ALTER TABLE` would require a `SECURITY DEFINER`
   function executing dynamic DDL as service role, plus a PostgREST schema-cache reload
   (`NOTIFY pgrst, 'reload schema'`) after every property add — for a schema that the
   Next.js routes also read through PostgREST. That is a large, fragile, permanently-hot
   code path in exchange for performance we do not need.
2. **RLS becomes unauditable.** Physical tables need a policy *per table*, created at
   runtime. Research §K found no Postgres mechanism for default/template policies on new
   tables. One missed policy is a silent data leak. The JSONB design has **one policy per
   table, written once, reviewable in a diff.**
3. **The 1,600-attnum ceiling is a usage problem, not a scale problem.** Dropped columns
   permanently consume an attnum and `VACUUM FULL` will not reclaim them. This app has
   exactly one enthusiastic user who will add and delete properties freely — precisely the
   profile that reaches 1,600 cumulative field operations on a single table without ever
   having many rows. The prior art's own mitigation is "build a table-rebuild tool before
   you launch."
4. **Cross-database query is the product.** This is a second brain: unified semantic search
   and agent tools must span every database and every loose note. On physical tables that is
   a `UNION ALL` over N tables built at runtime. On the JSONB design it is one predicate.
   Combined with decision Q2 — a row *is* a note — physical per-database tables are not even
   expressible, since the row must simultaneously live in `notes`.

**The evidence against JSONB is real and we accept it with mitigations, not by ignoring it:**

| JSONB weakness (research §K.7) | Why it is survivable here | Mitigation |
|---|---|---|
| GIN cannot serve `ORDER BY`; no index for range/text predicates | At 10k rows a full scan + sort of a ~200-byte-per-row table is single-digit ms | Narrow companion table (§4.3); **B-tree expression indexes per hot property, added by migration** — we control migrations, so this is not runtime DDL |
| 10.2× TOAST cliff above ~2 kB rows | Only bites because Notion-style rows mix long text with properties. **Ours don't** — body text lives in `notes.content`, a different table entirely | Structural: `db_row_props` holds scalars only |
| Whole tuple rewritten on every cell edit | True, and irrelevant at our write volume (a human typing) | Formula results in a separate `computed` column so recompute doesn't rewrite user data |
| Planner has no per-column statistics | Bad plans need large tables to hurt | Scale envelope below |

### 4.2 Short opaque property keys

`db_properties.key` is 8 random base62 characters, minted server-side, unique per data
source, **immutable for the life of the property**. This is Notion's 4-character key
generalised, and research §K.1.3 identifies why it matters:

- **Rename is metadata-only.** Keying by name would rewrite every row's JSONB on rename.
- **Type change preserves identity.** The key survives; only `type` and the value encoding change.
- **Free-text names are safe.** Notion permits duplicate names, emoji and spaces. An opaque
  key sidesteps every escaping and uniqueness problem — and, critically for §8, means **no
  user-controlled string ever reaches SQL as an identifier.**

8 characters (~2.2 × 10¹⁴ keyspace) rather than Notion's 4 (~1.7 × 10⁶), because Notion's
size is a rounding error only at 200-billion-block scale, and 4 characters has a plausible
birthday collision within one large collection (research §K, UNRESOLVED #2).

### 4.3 Scale envelope, and the escape hatch

This design is specified to hold to **50,000 rows per data source**, which is 5× the
brief's benchmark and far beyond a personal knowledge base. Milestone 0 measures it (§13)
and the plan gates the storage decision on that measurement — research §K.8 #5 records that
no published benchmark answers this, so we generate our own rather than assume.

If a data source ever exceeds the envelope, the escape hatch is documented but not built:
promote that one data source to a physical table with `f_{key}` columns, behind the same
compiler interface. The compiler's storage abstraction (§6) already has two backends;
adding a third is contained.

---

## 5. The property system

`db_properties.type` drives everything through a per-type descriptor registered in
`backend/services/db/properties/`. Each descriptor declares:

```python
class PropertyType(Protocol):
    key: str                                  # 'number', 'multi_select', …
    config_model: type[BaseModel]             # validated config (40 number formats, …)
    def default(self) -> Any: ...
    def is_empty(self, value) -> bool: ...
    def sql_extract(self, ctx) -> SqlFragment # how to read it in SQL
    def sql_order(self, ctx, dir) -> SqlFragment
    def operators(self) -> dict[str, Operator]  # filter operators + arg types
    def aggregations(self) -> set[str]          # which of the 20 apply
    def coerce_write(self, raw) -> Any          # validation on write
```

Adding a property type is one file plus its registration — the 24 real, addressable
types (research §F.1, items 1-24; item 25, AI autofill, is explicitly not a property
type — a configuration layer on an existing property, never a schema entry) are 24
implementations of one interface, not 24 special cases scattered through the compiler.

Per-property universal options (`description`, per-view `visible`/`width`/`wrap`,
`date_format`, `time_format`) live in the **view** config, not the property, matching
Notion's Views API where these are entries in `configuration.properties[]`.

### 5.1 Decided unknowns

Research §L.1 lists twelve behaviours Notion never documented. Each is decided here as
**our** behaviour, not attributed to Notion:

| Unknown | Decision | Rationale |
|---|---|---|
| Empty/null sort placement | **Empties always at the bottom**: `ASC NULLS LAST`, `DESC NULLS FIRST` | Users scan from the top; blanks are noise. Consistent across every type, so it's learnable |
| Status sort order | **Group order, then option order within group** | Status exists to express progression; flat option order would scramble it |
| Multi-select sort | By the **first option** in the property's option order, then by count | Deterministic and cheap |
| `now()`/`today()` re-evaluation | Volatile formulas are **never cached**; recomputed per read (§7.4) | Correctness over speed; the alternative is silently stale dates |
| Formula cycles | **Rejected at save** with the cycle path in the error | Notion's behaviour unknown; failing loudly beats a wrong number |
| Relative date boundaries | Week starts **Monday**; all relative windows evaluated in the **user's timezone** | ISO-8601 default; timezone from the browser, stored per user |
| Empty-set aggregations | `sum`→0, `average`/`median`/`min`/`max`/`range`→null, `count*`→0, `percent_*`→null | Sum has an identity; the others don't |
| "Count values" on multi-select | Counts **individual tags**, not cells | Matches "values"; `count_not_empty` already counts cells |
| Sub-item nesting depth | **10 levels**, enforced on write | Deep enough to never bind in practice, shallow enough to bound recursive CTEs |
| Circular dependencies | **Rejected at write** with the cycle path | Same reasoning as formula cycles |
| Two-way relation deletion | Deleting one side **deletes the pair** (§9) | Structural consequence of pair-keyed links; no desync possible |
| JSONB `ORDER BY` at scale | **Measured**, not assumed — Milestone 0 gate | The one closable unknown |

---

## 6. Q3 — Existing metadata, and column-backed properties

`notes.topics`, `mastery_status`, `source_type` and `source_url` are read today by
`brain_tools.py`, `mcp_server.py`, `retriever.py`, the Android app and `NoteProperties.tsx`.
Moving them into generic property storage would break all of it for no user-visible gain.

**They stay exactly where they are and become `storage='column'` properties.**

`db_properties.column_name` is validated against a **fixed Python allow-list** — never
against the request, never against the database catalogue:

```python
COLUMN_BACKED = {
    "title":          ColumnProp("title",          "title"),
    "icon":           ColumnProp("icon",           "text"),
    "topics":         ColumnProp("topics",         "multi_select_array"),
    "mastery_status": ColumnProp("mastery_status", "status"),
    "source_type":    ColumnProp("source_type",    "select"),
    "source_url":     ColumnProp("source_url",     "url"),
    "is_favorited":   ColumnProp("is_favorited",   "checkbox"),
    "created_at":     ColumnProp("created_at",     "created_time"),
    "updated_at":     ColumnProp("updated_at",     "last_edited_time"),
}
```

This yields a **built-in "All Notes" data source** (`system_kind='notes'`) whose row set is
`notes WHERE user_id = $1 AND deleted_at IS NULL` and whose properties are entirely
column-backed. It is **virtual**: no `db_row_props` rows, **no backfill migration at all**.

The payoff is immediate: on day one of Milestone 2 the user gets table, board and gallery
views over their entire existing brain, with mastery as a real Status property and topics
as a real Multi-select — without a single row being migrated.

What stays hardcoded: `content`, `content_text`, `fts`, `descriptor_embedding`,
`local_only`, `is_public`, `position`, `collection_id`. These are engine state, not
user-facing properties.

---

## 7. Q4 — The formula engine

### 7.1 Where it runs: backend only

One evaluator, in Python. The frontend gets **no evaluator** — a `POST /db/formulas/validate`
endpoint returns parse errors, the inferred result type and referenced properties for the
formula editor.

Rejecting a dual TS/Python implementation: the language has 88 functions, an 8-type system,
lambdas, and Luxon-token date formatting. Two implementations means two sets of edge-case
semantics for `empty(0)`, timezone boundaries and numeric coercion. Research §K.8 #16 found
no published post-mortem on client/server formula divergence, but the hazard is structural.
The cost of backend-only is one round trip per cell edit (~50 ms) — the write already goes
to the server, and the response carries the recomputed values.

### 7.2 One tree, three visitors

Hand-written **Pratt parser** (~600 lines), no dependency. Research §K.9 #8 makes the key
structural point: derive the evaluator, the type checker **and the dependency extractor**
from the same AST, so they cannot disagree about what a formula references.

Parser specifics fixed by research §H: `^` is right-associative; comparison operators are
**non-associative** (`1 > x > 5` is a parse error); `not` binds at precedence 9;
`empty()` with no arguments is the null literal and `empty(0)` is `true`;
`dateBetween(a,b,u)` computes **a − b**; there is no `"seconds"` unit.

### 7.3 Materialisation and the dependency graph

Formula and rollup results are written into `db_row_props.computed`, a **separate column
from user data** — so recompute never rewrites `properties`, and invalidation is explicit.

Because results are materialised, **formulas and rollups filter and sort in SQL exactly like
stored values**, which is what makes §8 uniform. This is research §K.0 #5: every mature
implementation materialises; nobody computes formulas at query time when they need to sort.

Dependency graph nodes are `(data_source_id, property_key)`, edges from the AST's reference
set and from rollup definitions. On property save: topological sort, reject cycles with the
path. On row write: recompute that row topologically, then propagate to rows referencing it
through `db_relation_links`.

Limits, following Notion: **formula depth 15**, **relation traversal depth 3**,
**propagation fan-out 10,000 rows**. Beyond any limit the value becomes the typed sentinel
`{"type":"unsupported"}` — mirroring exactly what Notion shipped on 2026-08-05 for values
that "depend on excessive related pages or nested formulas" (research §B.1).

Grist's `depend.py` contributes one detail worth stealing outright: a **liveness assertion**
— raise if a full recompute pass computed zero cells, which catches a stalled graph instead
of silently returning stale data.

### 7.4 Volatile formulas

A formula referencing `now()` or `today()` is marked `is_volatile` at parse time and is
**never materialised**. It is evaluated in Python over the rows being returned.

Consequence, stated plainly as a limitation: filtering or sorting by a volatile formula
cannot use an index. Those queries take a compute-then-filter path, capped at the 10,000-row
query limit, and the API returns `request_status: "incomplete"` past it — the same contract
Notion adopted. Research §L.1 #4 records that Notion's own behaviour here is undocumented.

---

## 8. Q6 — Filter → SQL compilation

### 8.1 The AST

```json
{ "type": "group", "op": "and", "children": [
    { "type": "condition", "property": "a7Kd9x",
      "operator": "greater_than", "value": 10 },
    { "type": "group", "op": "or", "children": [
        { "type": "condition", "property": "p2Lm4q",
          "operator": "contains", "value": "opt_a1" },
        { "type": "condition", "property": "z8Rt0v",
          "operator": "past_week", "value": {} } ] } ] }
```

Arbitrary nesting depth is supported. Research §C.4 established that Notion's API grammar
caps at 2 levels while its UI offers 3 — we own both ends, so we impose no limit beyond a
sanity cap of 10 to bound recursion.

### 8.2 The three-layer defence

Injection safety is a hard requirement. Research §K.4 records that NocoDB shipped a real
injection bug in exactly this seam, and that Teable silently drops unknown field ids.

1. **The request carries a property `key` only** — never a name, never a column, never SQL.
2. **The key is resolved against `db_properties`** for that data source. Unknown key →
   **HTTP 400**, never a silently dropped clause. A dropped filter clause shows the user
   rows they filtered out, which is a correctness bug that looks like a UI glitch.
3. **The operator is allow-listed against the resolved property's type descriptor**
   (§5), and the value is coerced to that operator's declared argument type before binding.

Then: **every value and every property key is a bound parameter.**

```sql
-- jsonb-backed number > 10
(r.properties -> $3 ->> 'number')::numeric > $4
-- jsonb-backed multi_select contains  (GIN-indexed)
r.properties @> $5
-- column-backed status equals
n.mastery_status = $6
```

The property key appears as `$3`, not as `'a7Kd9x'`. **No user-supplied string is ever
concatenated into SQL**, so the identifier-escaping class of bug cannot occur. Column-backed
properties resolve through the `COLUMN_BACKED` dict (§6) — a Python constant, so their
identifiers are compile-time literals.

The `::numeric` cast carries one real hazard from research §K.7: a single non-numeric value
in the column fails the whole query. Writes are validated by `coerce_write`, and the cast
uses a guarded form so a bad legacy value yields NULL rather than an error.

### 8.3 Tenancy, and why RLS is not the enforcement boundary

asyncpg connects with the service role, so **RLS does not apply** — the same model the
existing FastAPI code already uses with `.eq("user_id", user_id)`.

Enforcement is therefore structural: a single `QueryBuilder._scope()` appends
`user_id = $1 AND data_source_id = $2` (and `deleted_at IS NULL`) to **every** generated
query. It is not optional and not a parameter. A test asserts that every compiled query in
the suite contains the scope predicate, so omitting it fails CI rather than leaking data.

RLS policies are still created on every one of these tables — nine in total once
`018_forms.sql` lands (§3) — because the Next.js routes reach them through PostgREST with
the user's JWT, and defence in depth is free. Following Supabase's published guidance,
policies use `(SELECT auth.uid())` rather than bare `auth.uid()` so the planner hoists it to
an InitPlan instead of re-evaluating per row.

---

## 9. Q5 — Relations and rollups

```sql
CREATE TABLE db_relation_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- the relation PAIR, not one side of it
  relation_id UUID NOT NULL,
  from_row_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  to_row_id   UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  position    DOUBLE PRECISION NOT NULL DEFAULT 0,
  UNIQUE (relation_id, from_row_id, to_row_id)
);
```

**One row per link, keyed by the relation pair.** Each `db_properties` row for a relation
stores `config.relation_id` plus `config.side` (`forward`/`reverse`). Reading the forward
side queries `from_row_id`; the reverse side queries `to_row_id`.

This makes two-way sync **structural rather than synchronised**: there is no second copy to
keep in step, so create/delete cannot desync, and research §L.1 #11 (two-way deletion
semantics, undocumented in Notion) resolves trivially — deleting either side deletes the
pair, because there is only one.

One-way relations use the same table with no reverse property. Self-relations set both sides
to the same data source. **Sub-items and dependencies are built-in self-relations**, not
separate mechanisms — which is why they inherit rollups, filters and the cycle checker for
free.

Rollups materialise into `computed` alongside formulas (§7.3), share the dependency graph,
and are capped by the same depth limits. Rollups over rollups are permitted within depth 3.

---

## 10. Q7 — Views

```sql
CREATE TABLE db_views (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id UUID NOT NULL REFERENCES db_data_sources(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name           TEXT NOT NULL DEFAULT 'Default view',
  icon           TEXT,
  type           TEXT NOT NULL,       -- table|board|list|calendar|timeline|gallery
                                      -- |chart|form|map|feed|dashboard
  config         JSONB NOT NULL DEFAULT '{}',
  filter         JSONB,
  sorts          JSONB NOT NULL DEFAULT '[]',
  is_locked      BOOLEAN NOT NULL DEFAULT FALSE,
  position       INTEGER NOT NULL DEFAULT 0
);
```

`config` follows **Notion's own Views API discriminated union verbatim** (research §G) —
`frozen_column_index`, `wrap_cells`, `show_vertical_lines` for table; `card_layout`/
`cover`/`cover_size`/`cover_aspect` for board and gallery; `zoom_level`/`arrows_by`/
`color_by` for timeline; the full chart config including reference lines and `group_style`.
Using Notion's field names verbatim means the research doc *is* the schema documentation.

**Views are shared, not per-user** — the app has one user, so per-user views would be
complexity with no consumer.

**Deleted-property handling, both halves:** on property delete, a sweep strips references
from every view's `filter`, `sorts`, `config.properties[]` and `group_by`. Independently,
view hydration **tolerates unknown property keys and drops them at read**. The sweep keeps
data clean; the tolerance means a missed sweep degrades a view instead of breaking it.

---

## 11. Frontend

### 11.1 Component tree

```
app/(brain)/brain/db/[databaseId]/page.tsx
  DatabaseShell                     ← view tabs, title, description, lock
    ViewToolbar                     ← search, filter, sort, group, properties, new
      FilterBuilder                 ← recursive; renders nested AND/OR groups
      SortBuilder · GroupBuilder · PropertyVisibilityMenu
    <view switch>
      TableView    ← TanStack Table + Virtual, resize/reorder/freeze, calc row
      BoardView    ← @dnd-kit columns + cards, sub-group, collapse
      GalleryView · ListView · FeedView
      CalendarView · TimelineView   ← dependency arrows, date shifting
      ChartView · MapView · FormView · DashboardView
    RowPeek                         ← side/centre peek, full NoteEditorPage inside
components/database/cells/*.tsx     ← one editor per property type (24)
components/database/DatabaseBlock.tsx  ← inline DB (BlockNote block)
```

### 11.2 Data layer

Hand-rolled `useDatabaseView(viewId)`, matching the existing `useNotes`/`useCollections`
style: fetch → `useState` → optimistic patch with rollback on failure → `window` event for
cross-component invalidation. TanStack Table supplies column sizing/ordering/visibility
state; TanStack Virtual supplies row windowing. We write all the pixels in Tailwind.

### 11.3 Q8 — Inline databases in BlockNote

```tsx
export const DatabaseBlockSpec = createReactBlockSpec(
  { type: "database",
    propSchema: { dataSourceId: { default: "" }, viewId: { default: "" } },
    content: "none" },
  { render: ({ block }) => (
      <div contentEditable={false} className="my-2">
        <InlineDatabaseView {...block.props} />
      </div>) }
);
```

Registered in `BlockEditor.tsx` as **`database: DatabaseBlockSpec()`** — invoked, because
`createReactBlockSpec` in BlockNote 0.48 returns a factory, not a BlockSpec. Registering it
uninvoked crashes schema creation with `Cannot read properties of undefined (reading 'node')`
(memory: `project_workspaces_feature` gotcha #1; the existing `math`/`checkpoint`/`callout`
specs at `customBlocks.tsx` show the correct call form).

Inline views virtualise inside a bounded-height container so the editor's own scroll is
never nested inside a virtualiser.

### 11.4 Realtime — deferred, with the reason

Not built. If it is ever wanted, research §K.9 #11 is unambiguous: use **Broadcast published
by FastAPI**, never `postgres_changes` — a Micro instance with 500 clients sustains only
~30 changes/second project-wide, throughput scales with subscriber count rather than write
rate, and it is single-threaded.

---

## 12. Q10 — AI integration

Because a row is a note (Q2), rows already flow through `indexer.py` → `block_chunker.py` →
`note_chunks` and are already semantically searchable. Two additions:

1. **A property preamble chunk.** On index, prepend a rendered `"Status: In progress ·
   Topics: rust, async · Due: 2026-09-01"` line as chunk 0, so a query like *"what's blocked
   on the compiler"* can match on property values, not just body prose.
2. **Five agent tools** in `brain_tools.py`, mirrored into `mcp_server.py`:
   `brain.list_databases`, `brain.get_database_schema`, `brain.query_database`
   (takes the §8.1 filter AST — the LLM emits it directly), `brain.create_row`,
   `brain.update_row`.

`brain.query_database` runs through the *same compiler* as the UI, so the agent inherits the
tenancy scope and the allow-listing automatically. The LLM never sees SQL.

---

## 13. Migration path and gating

Every migration is a file handed to the user to run in the Supabase SQL editor
(project `esfhsdukyhyrlgzflsad`) — `DATABASE_URL` on the dev machine is a placeholder.
Migrations `014`–`018`, each ending with a proof `SELECT`, each wrapped in `BEGIN`/`COMMIT`,
each setting `SET LOCAL search_path = public, extensions` if it so much as mentions `vector`
(migration 013 silently applied nothing twice for exactly this reason).

**Local verification harness.** Docker is available on this machine. Migrations are applied
to `pgvector/pgvector:pg16` behind a small Supabase shim (`auth.users`, `auth.uid()`,
`storage.*`, the `extensions` search_path) **before** being handed over. This converts the
no-DB-access constraint from a testing blocker into a deployment gate. The shim is in the
plan's Milestone 0.

**Two pre-existing bugs found while building that harness**, unrelated to this work but
recorded so they aren't rediscovered:

- `005_notion_phase.sql` uses `CREATE POLICY IF NOT EXISTS`, which **Postgres does not
  support in any version**. That statement has never applied, so `anon_read_public_notes`
  is probably absent and public share links likely fail for signed-out visitors. Verify with
  `SELECT policyname FROM pg_policies WHERE tablename='notes';`
- `010_mcp_servers.sql` creates `mcp_servers` without `IF NOT EXISTS` while `009` creates it
  with. The migration set is **not replayable from 001 in order**. New migrations are
  therefore written to be independently applicable rather than assuming a clean replay.

**Milestone 0 measurement gate.** Before the storage decision is locked, generate 50k rows ×
20 properties locally and measure the exact query the product runs on every view load:
`WHERE <property> = ? ORDER BY <other property> LIMIT 50`, at offset 0 and offset 10,000,
plus a filtered `COUNT(*)`, with and without expression indexes. Research §K.8 #5 records
that no published benchmark answers this. If p95 exceeds 200 ms at 50k rows, the escape
hatch in §4.3 is taken for that data source before any UI is built on the assumption.

---

## 14. Q11 — Android parity

Adds **gap #21** to `ANDROID_PARITY.md`: "Databases — property types, views, filters,
formulas, relations." Not planned here. Note for whoever picks it up: because rows are
notes, the Android app's existing note sync carries row *bodies* already; what it lacks is
the property/view/query layer.

---

## 15. Open risks

1. **Formula engine size.** 88 functions is the largest single piece of work. Mitigated by
   the type descriptor pattern and by shipping functions in tranches (Milestone 6a/6b), with
   the parser and graph landing first.
2. **Map view needs an external geocoder.** No provider is configured today. The provider is
   pluggable and defaults to none; the milestone is explicitly gated on choosing one, and
   Place data is stored in our own representation since Notion's is undocumented.
3. **Form view needs unauthenticated submission.** Built on the existing `is_public` share
   infrastructure, but it is the only place in this design where an anonymous writer touches
   the database — it gets its own RLS policy and a rate limit.
4. **`notes` grows a second identity.** Every existing query that lists notes must exclude
   database rows. The sweep is mechanical (`useNotes`, sidebar, search, trash, Cmd+K) and is
   Milestone 1 work, but missing one shows database rows in the sidebar.
