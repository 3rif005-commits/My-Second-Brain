# Notion Databases — Authoritative Feature Inventory

> **Purpose.** This is the specification input for building Notion's database system
> natively on this app's stack (Supabase Postgres + FastAPI + Next.js). Notion is the
> *specification*, not a dependency — nothing here implies integrating with Notion's API.
>
> **Compiled:** 2026-08-08. **Method:** six parallel research agents against primary
> sources, then reconciled by hand. Every non-obvious claim carries an inline source link.
>
> **Companion documents**
> - Design/spec: `docs/superpowers/specs/2026-08-08-notion-databases-design.md`
> - Implementation plan: `docs/plans/2026-08-08-notion-databases.md`

---

## A. How this document was built, and how much to trust each claim

### A.1 Method

Six agents researched in parallel — property types, view types, the formula language,
querying (filters/sorts/grouping/aggregation), structure & automation, and architectural
prior art — each instructed to cite inline and to write `UNRESOLVED:` rather than guess.
Their findings were then cross-checked against each other; every contradiction found is
resolved in §C below, with the resolution verified against a primary source directly
rather than accepting either agent's word.

Two research techniques mattered enough to record:

1. **`developers.notion.com` serves a raw-markdown twin of every page at `<url>.md`.**
   This returns the underlying source rather than the rendered SPA, and is far more
   reliable to fetch and parse.
2. **The query endpoint embeds its full OpenAPI schema.** `POST /v1/data_sources/{id}/query`
   publishes a complete machine-readable enumeration of filter conditions. Where the
   surrounding prose and the schema disagree, the schema is correct — it corrected the
   prose in four places (§C.5).

### A.2 Source-authority ranking

Notion's own sources contradict each other repeatedly. Where they do, this document
follows this precedence, and says so at the point of conflict:

| Rank | Source | Why |
|---|---|---|
| 1 | Embedded **OpenAPI schemas** (query endpoint, view endpoints) | Machine-readable, generated from the implementation |
| 2 | **API reference** pages (`developers.notion.com/reference/*`) | Versioned, maintained, but prose drifts from schema |
| 3 | **API changelog** (`developers.notion.com/page/changelog`) | Dated and precise, but describes deltas not end-state |
| 4 | **Help Center** (`notion.com/help/*`) | Only source for UI-only surface; frequently stale, sometimes self-contradictory |
| 5 | **Release notes** (`notion.com/releases/*`) | Good for "when did this ship"; thin on semantics |
| 6 | Community write-ups | Cross-check only. Never the sole source for a behavioral claim. |

**The Help Center is the only source for a large and important part of the surface** —
Button property actions, Feed view, AI autofill, most view-level UX. That part of this
document is therefore less certain than the API-backed part, and is marked as such.

### A.3 What "UNRESOLVED" means here

`UNRESOLVED:` marks a behavior that **Notion has not documented anywhere we could find** —
not a gap in research effort. There are **186 of them**, consolidated in §L. They are not
failures; they are the precise list of places where the clone must make its own decision,
and the design document makes each one explicitly rather than by accident.

A crucial subclass: several unresolved items **cannot be closed by any amount of further
reading**, because Notion never published the behavior and we have no Notion workspace to
probe empirically. The most consequential is **empty/null sort placement**, which maps
directly onto a `NULLS FIRST` / `NULLS LAST` choice in every generated `ORDER BY`.

---

## B. Headline corrections — where the original brief and common knowledge are wrong

The task brief for this work was itself written from stale knowledge. These are the
corrections that change scope, listed before anything else because they change what
"parity" means.

| The brief / common knowledge says | Current reality (Aug 2026) | Source |
|---|---|---|
| The newest API version is `2025-09-03` | **`2026-03-11`** is current. It brought three breaking changes: `after` → `position` object, `archived` fully replaced by `in_trash`, `transcription` → `meeting_notes` | [changelog](https://developers.notion.com/page/changelog) |
| View configuration is UX-only and not exposed by the API | **False since 2026-03-19.** The **Views API** shipped 8 endpoints and publishes a complete, machine-readable `configuration` discriminated union per view type | [working with views](https://developers.notion.com/guides/data-apis/working-with-views) |
| There are 7 view types | **11 exist in the UI; 10 are addressable via the API.** The brief omitted Form, Map, Dashboard and Feed | [view object](https://developers.notion.com/reference/view), [feeds](https://www.notion.com/help/feeds) |
| "Last visited time" is a property type | **It does not exist.** Absent from the property enum and from the Help Center properties table | [property object](https://developers.notion.com/reference/property-object) |
| AI-backed properties are property types (summary / translation / custom autofill) | **AI autofill is not a property type.** It is a fill configuration layered onto an ordinary property | [AI autofill](https://www.notion.com/help/autofill) |
| Dependency date-shift modes are "avoid gaps" / "preserve overlaps" | Actual names: **`Shift only when dates overlap`**, **`Shift & maintain time between items`**, **`Do not automatically shift`**, plus an independent **`Avoid weekends`** toggle | [dependencies](https://www.notion.com/help/dependencies) |
| Table view has row-height, row-numbers, and a show-database-title toggle | **It has none of those** — those are Airtable features. Table has `wrap_cells`, `frozen_column_index` (an integer), `show_vertical_lines`, and per-property `width`/`wrap` | [working with views](https://developers.notion.com/guides/data-apis/working-with-views) |
| Status is read-only via the API | **Writable since 2026-06-22**, and status options now carry a `group` field | [changelog](https://developers.notion.com/page/changelog) |
| Sub-items are a database-level feature | Sub-item *display* is **table-view configuration** (`subtasks`), separate from the underlying self-relation | [working with views](https://developers.notion.com/guides/data-apis/working-with-views) |

### B.1 The single most useful architectural signal Notion has published

On **2026-08-05** Notion added an `"unsupported"` value type for formula and rollup
properties, returned when a value *"depends on excessive related pages or nested
formulas"* ([changelog](https://developers.notion.com/page/changelog)).

Notion — with vastly more engineering resource than this project — **declines to evaluate
deep formula/rollup chains and returns a sentinel instead**. That is direct precedent for
enforcing an explicit, low depth limit and surfacing a typed "too deep" value, rather than
attempting unbounded evaluation. The design adopts this.

Related published limits that corroborate it: **formula depth is capped at 15 layers**
(raised from 7 in Aug 2024, counted *across databases* via rollups), and queries are
capped at **10,000 results** with a `request_status` field signalling truncation.

---

## C. Contradictions found, and how each was resolved

Every one of these was a genuine conflict either between two Notion sources or between two
research agents. Each was resolved by fetching a primary source directly.

### C.1 Feed view — does it exist?
**Conflict:** the view-types agent reported 11 view types including `feed`; the View object
enum returned exactly 10, with no `feed`.
**Resolution — both are right.** Feed is a real, documented UI view type
([notion.com/help/feeds](https://www.notion.com/help/feeds): stacked cards, blog/social
style, per-post comments and view tracking), but `feed` appears nowhere in `create-view`'s
`viewTypeRequest` schema. **11 UI view types, 10 API-addressable.** Feed is the one view
type with *no published configuration schema at all* and must be designed from Help Center
prose alone.

### C.2 `last_visited_time` — does the property type exist?
**Conflict:** the querying agent listed it among non-filterable types (implying existence);
the property agent said it appears nowhere.
**Resolution — it does not exist.** Verified directly against
[property-object](https://developers.notion.com/reference/property-object): the documented
enum is 22 types and `last_visited_time` is not among them, nor is it in the Help Center
properties table. Recorded as *"present in the original brief; not present in Notion as of
August 2026."*

### C.3 Relation and formula as board grouping keys
**Conflict:** the Boards help page states relation grouping is unsupported ("Not currently
😓") *and* elsewhere lists relation as a grouping property — it contradicts itself
internally. The API's `group_by` union supports both relation and formula.
**Resolution:** follow the API (authority rank 1–2). The help page is stale. Recorded as a
documentation defect on Notion's side.

### C.4 Filter nesting depth — 2 or 3?
**Conflict:** API compound-filter grammar permits **2 levels**; the UI advertises **3 layers**
of filter groups.
**Resolution — both are true and they genuinely differ.** A 3-deep filter built in the UI is
**not expressible in the documented API grammar**. Our clone has no such constraint (we own
both ends), so the design supports arbitrary nesting and simply notes that Notion's API
would not round-trip it. Also schema-enforced but absent from the prose: **`maxItems: 100`**
per `and`/`or` array, and 100 sorts per view.

### C.5 Where the query endpoint's prose disagrees with its own schema
The embedded OpenAPI schema corrected the surrounding prose in four places. Notably
`this_month` appears in a prose *example* but is **absent from the schema** — date filters
have `this_week` but **no `this_month` / `this_year`**. Formula filtering nests by result
type under the key **`string`**, not `rich_text`. Rollup sub-filters use a *restricted*
condition union that excludes rollup and formula.

### C.6 "Show original" / "show unique" — aggregations or not?
**Resolution:** they are **rollup display modes, not calculation-row aggregations**, and must
be modelled separately. The calculations enum has **20** members; the rollup `function` enum
has **24** (and includes `count_per_group` / `percent_per_group`, which are missing from the
property-object page's list).

### C.7 Number `format` enum length
The property-object page's list is **truncated** ("and more"). The
[property-schema-object](https://developers.notion.com/reference/property-schema-object)
page is authoritative: **40 values**.

### C.8 Sub-item nesting depth — the "three levels" figure
**Do not transfer it.** The widely-repeated "three levels" limit belongs to database
*templates*, not sub-items. **Sub-item nesting depth is undocumented.** (§K)

---

## D. The parity surface, quantified

This is the size of the thing, measured from primary sources.

| Surface | Count | Notes |
|---|---|---|
| Property types | **22** API-backed | + Button (UI-only, zero API surface), Verification (page-value only, no schema entry), AI autofill (a fill config, not a type) → **25 inventory entries** |
| View types | **11** UI / **10** API | Feed has no published config schema |
| Filter operator keys | **24** distinct leaf operators | ~**140** (property type × operator) pairs |
| Filter condition schemas | **5** reusable shapes | `text` / `number` / `date` / `people` / `existence` — everything reduces to these. *The single most useful fact for building the compiler.* |
| Non-filterable property types | **3** | `button`, `place`, and (were it to exist) `last_visited_time` |
| Aggregations (calculations row) | **20** | Only `count` needs no `property_id` |
| Rollup functions | **24** | Superset of the 20 aggregations |
| Formula functions | **88** documented | ~**97** callable names incl. operator/reference forms and 4 community-only |
| Formula value types | **8** in the language | API exposes only **4** + `unsupported`; List/Person/Page do not cross the API boundary |
| Formula depth limit | **15** layers | Counted across databases via rollups |
| Query result cap | **10,000** | `request_status` signals truncation |
| Properties per database | **500** | |
| Group-by depth | **2** | Grouping is Table+Board only; sub-grouping Board-only |
| Date grouping buckets | `relative`/`day`/`week`/`month`/`year` | **No quarter.** `start_day_of_week` is 0 or 1 |

### D.1 Expanded parity checklist — items the original brief did not list

Research was instructed to *expand* the brief's checklist. These are the net additions:

**View types** — Form (with `is_form_closed`, `anonymous_submissions`,
`submission_permissions`), Map (with `map_by`, `height`), Dashboard (12-column widget grid
composing other views, with cross-source global filters), Feed.

**View configuration** — conditional/row colouring as a per-view setting (Table, Calendar,
Timeline, List, Board, Feed — notably *not* Gallery, and only Table can scope colour to a
single property); `frozen_column_index`; `show_vertical_lines`; per-property per-view
`date_format` and `time_format`; timeline `arrows_by` (dependency arrows) and `color_by`;
chart reference lines, `group_style` stacking control, `cumulative`, `smooth_line`,
`donut_labels`, `y_axis_min`/`max`, `legend_position`, `axis_labels`, `grid_lines`.

**Chart types** — `column`, `bar`, `line`, `donut`, **`number`** (a single-value KPI chart).

**Querying** — multi-value filters (arrays for `equals`/`does_not_equal` on select/status,
`contains`/`does_not_contain` on multi_select, shipped 2026-04-17); the `"me"` relative
value for people filters; relative date *values* (`today`, `tomorrow`, `yesterday`,
`one_week_ago`, `one_week_from_now`, …, shipped 2026-03-30) as distinct from relative date
*operators*; number range bucketing for grouping (`range_start`/`range_end`/`range_size`);
`alphabet_prefix` vs `exact` text grouping; `start_day_of_week`.

**Structure** — the Views API itself (views as first-class, addressable, webhook-emitting
resources); data-source templates; page `position` on create; the `is_locked` flag;
`in_trash` semantics; search over trash.

**Property detail** — Person 1-vs-unlimited cardinality; Status rendered *as a checkbox*;
Verification silently adding an Owner property; Unique ID counters consuming numbers for
deleted pages (permanent gaps); `description` being an API field.

---

## E. What cannot be reproduced — and the closest thing we can build

Stated explicitly, as required, rather than silently dropped. Each entry gives the reason
and the nearest buildable substitute.

| Notion feature | Why it cannot be reproduced as-is | Closest thing we can build |
|---|---|---|
| **Real-time multiplayer editing, presence, cursors** | Requires CRDT/OT infrastructure and a persistent socket fabric. This app is single-user per workspace, saves on a ~2s debounce, and has no presence layer anywhere. | Optimistic local updates + last-write-wins persistence. Supabase Realtime row broadcast is *possible* later but is explicitly deferred — see design Q9. |
| **Notion-account-scoped permissions** (teamspaces, guests, per-page member access, `submission_permissions` levels) | Depends on Notion's identity and org model. This app has one `profiles` row per user and RLS keyed to `auth.uid()`. There are no other users to grant access *to*. | Owner-only via RLS, plus the existing public share-link mechanism (`notes.is_public`) for read-only publishing. |
| **Person / Created by / Last edited by as multi-user properties** | Degenerate: the workspace has exactly one member. | Keep the property types and populate from `profiles`; they behave correctly but always resolve to a single person. Preserves schema parity and future multi-user capability. |
| **Slack / Teams / email notification actions** on buttons and automations | External SaaS integrations requiring OAuth apps we do not have. | In-app toast + a generic outbound webhook action. |
| **Notion Calendar app two-way sync** | A separate product. | Out of scope; `.ics` export is the plausible substitute. |
| **Map view geocoding** | Notion's geocoding/tile provider is undocumented, and any real provider is a keyed external dependency. | Store structured place data ourselves; make the tile/geocode provider pluggable and default to none. Map view is a candidate for deferral. |
| **Place property internals** | Genuinely undocumented — the API returns `null` for its values. | Define our own representation (label + lat/lng + optional provider place id). We are not bound by an unknown. |
| **Verification's "who can verify"** | Depends on workspace roles that do not exist here. | Keep the state machine (verified / expired, with an expiry date); the verifier is always the single user. |
| **Notion AI-hosted properties** | Notion's hosted models are not accessible to us. | **This one we can genuinely build, and better**: the app already has a provider-agnostic LLM layer (`backend/services/ai/`) and per-user keys (`ai_providers`). AI autofill becomes a fill config backed by our own substrate. Not a loss — a substitution. |
| **Dashboard cross-source global filters** | Buildable, but it is a Business/Enterprise-tier feature composing many views; large surface for low value in a single-user brain. | Deferred with reason; the widget/grid model is recorded should it be wanted. |
| **Row comments** | The app has no comment system at all — this would be a net-new subsystem, not a database feature. | Deferred explicitly. Rows are notes, so a future comment system would apply to both uniformly. |
| **Notion's `"unsupported"` bailout semantics** | We do not know Notion's exact threshold. | Mirror the *behavior* with our own explicit, documented depth cap and a typed "too deep" value. |

**Plan-gated in Notion, therefore free for us:** Dashboard views, some automation triggers,
AI autofill, and several sharing features are paid-tier in Notion. Our clone has no tiers,
so plan-gating is not a constraint — but it does explain why some Help Center pages are
thin, and why community documentation of those features is sparse and unreliable.

---

## F. Property types — full reference


**Research date:** 2026-08-08
**Purpose:** Formal specification input for a from-scratch clone of Notion databases. This is a pure Notion feature inventory — no implementation notes.
**API version referenced:** `2025-09-03` (current stable) with notes on `2026-03-11` and the June 2026 changelog additions.

---

### 0. Reading this document

Two independent sources of truth exist and they **disagree in coverage**:

| Source | What it tells you | What it omits |
|---|---|---|
| [developers.notion.com](https://developers.notion.com/reference/property-object) | Exact JSON for schema config + stored values, type keys, enums | Almost all display configuration; several property types are entirely absent |
| [notion.com/help](https://www.notion.com/help/database-properties) | UI configuration, display formats, view behavior | No JSON, no formal enums |

Throughout, claims are tagged **[API]** (exposed in the public REST API) or **[UI]** (exists in the product but has no API surface, or is API-invisible). Where a claim has no source I have written `UNRESOLVED:` rather than guessing.

#### 0.1 Critical structural change — `2025-09-03`

As of API version `2025-09-03` a **database is a container** and a **data source** holds the schema and the rows. One database can hold N data sources ([upgrade guide](https://developers.notion.com/docs/upgrade-guide-2025-09-03)).

- Property schemas now live on the **data source**, not the database. The object is `object: "data_source"` ([data source object](https://developers.notion.com/reference/data-source)).
- `/v1/databases/:id/query` → `/v1/data_sources/:id/query`.
- Update Database accepts only `parent`, `title`, `is_inline`, `icon`, `cover`, `in_trash`. Update Data Source accepts `properties` (the schema), `title`, `in_trash` ([upgrade guide](https://developers.notion.com/docs/upgrade-guide-2025-09-03)).
- Page creation parents are now `{"type": "data_source_id", "data_source_id": "..."}`.
- `database_id` and `data_source_id` are **not interchangeable** ([upgrade guide](https://developers.notion.com/docs/upgrade-guide-2025-09-03)).
- **Relation properties changed shape** — see §Relation below.
- New webhook events: `data_source.content_updated`, `data_source.schema_updated`, `data_source.created`, `.moved`, `.deleted`, `.undeleted` ([upgrade guide](https://developers.notion.com/docs/upgrade-guide-2025-09-03)).

**This directly affects a clone's data model:** the "table" identity and the "schema" identity are separate entities in current Notion. Multiple data sources under one database is the mechanism behind things like a database with several distinct schemas surfaced by one container.

#### 0.2 The universal property object envelope [API]

Every entry in a data source's `properties` map has this envelope:

```json
{
  "<Property name>": {
    "id": "fy:{",
    "name": "Property name",
    "description": "Free-text description of a property as it appears in Notion",
    "type": "<type key>",
    "<type key>": { /* type-specific configuration, often {} */ }
  }
}
```

- `id` is an opaque, URL-encoded short string (e.g. `"%5C%5E_"`, `"tqqd"`, `"Y]<y"`). The title property's id is always the literal string `"title"` ([page property values](https://developers.notion.com/reference/page-property-values)).
- `description` **is** part of the API property object: "The description of a property as it appears in Notion" ([property object](https://developers.notion.com/reference/property-object)). This is a genuinely under-documented field — it is the API surface of the UI's per-property description.
- The type-specific key is **always present** and is `{}` for types with no configuration.

A stored page property value has a parallel envelope:

```json
{
  "<Property name>": {
    "id": "ZI%40W",
    "type": "<type key>",
    "<type key>": <value>
  }
}
```

#### 0.3 Hard invariants

- **Exactly one `title` property** is required per data source ([property object](https://developers.notion.com/reference/property-object)).
- **500 properties maximum per database.** "To keep databases fast and reliable, each database can have up to 500 properties. If you reach this limit, you won't be able to add new properties until you remove some." ([database properties](https://www.notion.com/help/database-properties))
- Unsupported property types are returned with a `null` value and should be excluded from update payloads ([page property values](https://developers.notion.com/reference/page-property-values)).

---

### 1. Complete property type inventory

Merging the API list ([property object](https://developers.notion.com/reference/property-object)) with the UI list ([database properties](https://www.notion.com/help/database-properties)):

| # | UI name | API type key | In API schema docs? | Read-only / computed | Notes |
|---|---|---|---|---|---|
| 1 | Title / Name | `title` | Yes | No | Mandatory, exactly one |
| 2 | Text | `rich_text` | Yes | No | UI calls it "Text" |
| 3 | Number | `number` | Yes | No | |
| 4 | Select | `select` | Yes | No | |
| 5 | Multi-select | `multi_select` | Yes | No | |
| 6 | Status | `status` | Yes | No (writable since Jun 2026) | |
| 7 | Date | `date` | Yes | No | |
| 8 | Person | `people` | Yes | No | |
| 9 | Files & media | `files` | Yes | No | UI calls it "File" |
| 10 | Checkbox | `checkbox` | Yes | No | |
| 11 | URL | `url` | Yes | No | |
| 12 | Email | `email` | Yes | No | |
| 13 | Phone | `phone_number` | Yes | No | |
| 14 | Formula | `formula` | Yes | Yes (value) | Expression is writable |
| 15 | Relation | `relation` | Yes | No | |
| 16 | Rollup | `rollup` | Yes | Yes (value) | Config writable |
| 17 | Created time | `created_time` | Yes | Yes | |
| 18 | Created by | `created_by` | Yes | Yes | |
| 19 | Last edited time | `last_edited_time` | Yes | Yes | |
| 20 | Last edited by | `last_edited_by` | Yes | Yes | |
| 21 | ID | `unique_id` | Yes | Yes | Prefix writable |
| 22 | Place | `place` | Yes (schema only) | Value unreadable via API | |
| 23 | Verification | `verification` | **Value only, no schema doc** | Partially | |
| 24 | Button | *(no API type key documented)* | **No** | n/a | UI-only |
| 25 | *(AI autofill)* | *(not a type)* | **No** | n/a | Modifier on an existing property |

**Types NOT found despite searching:** there is no `last_visited_time` property type in current documentation. It is absent from both [the API property object reference](https://developers.notion.com/reference/property-object) and [the help center property table](https://www.notion.com/help/database-properties).

`UNRESOLVED: Does a "Last visited time" property type exist in Notion today? It appears in neither the API reference nor the help center property table. It may have been removed, renamed, or never existed as a database property (as opposed to a page-level concept).`

**AI-backed properties are NOT a property type.** They are a configuration layer applied to an existing property. See §26.

---

### 2. Title (`title`)

#### Schema [API]

```json
{
  "Project name": {
    "id": "title",
    "name": "Project name",
    "type": "title",
    "title": {}
  }
}
```

No configuration object ([property schema object](https://developers.notion.com/reference/property-schema-object)).

#### Value [API]

An array of rich text objects.

```json
{
  "Title": {
    "id": "title",
    "type": "title",
    "title": [
      {
        "type": "text",
        "text": { "content": "A better title for the page", "link": null },
        "annotations": {
          "bold": false, "italic": false, "strikethrough": false,
          "underline": false, "code": false, "color": "default"
        },
        "plain_text": "A better title for the page",
        "href": null
      }
    ]
  }
}
```

#### Configuration

| Option | Layer | Detail |
|---|---|---|
| Rename | UI + API | Property name is editable; the *type* is not |
| Description | UI + API | `description` field |
| Wrap text | UI | Per-column toggle |
| Delete | — | **Cannot be deleted.** Exactly one `title` is required ([property object](https://developers.notion.com/reference/property-object)) |
| Duplicate | — | `UNRESOLVED: can the title property be duplicated? Duplicating would violate the one-title invariant, so presumably not, but this is not documented.` |
| Comments | — | **Cannot be commented on.** "you can't comment in name, formula, rollup, button, and unique ID properties" ([database properties](https://www.notion.com/help/database-properties)) |

#### Semantics

- **Default value:** empty array (`[]`) — an untitled page.
- **Empty means:** zero rich text objects, or a single object with empty content. Displayed as "Untitled".
- **Sort:** alphabetical ([views, filters and sorts](https://www.notion.com/help/views-filters-and-sorts)).
- **Pagination:** title is a paginated property; the API returns a max of 25 inline references and you must use the property item endpoint for the rest ([page property values](https://developers.notion.com/reference/page-property-values)).
- **Limits:** each rich text `text.content` is capped at 2,000 characters; `text.link.url` at 2,000 characters ([request limits](https://developers.notion.com/reference/request-limits)).

#### Rendering

- Table: first (frozen-ish) column, click opens the page; hover reveals an "Open" affordance.
- Board / gallery / list / feed cards: the card's headline.
- Calendar / timeline: the label on the event bar.
- Conditional color: title **is** an allowed conditional-color source ([database properties](https://www.notion.com/help/database-properties)).

---

### 3. Text (`rich_text`)

#### Schema [API]

```json
{ "Description": { "id": "HbZT", "name": "Description", "type": "rich_text", "rich_text": {} } }
```

No configuration ([property schema object](https://developers.notion.com/reference/property-schema-object)).

#### Value [API]

```json
{
  "Description": {
    "id": "HbZT",
    "type": "rich_text",
    "rich_text": [
      {
        "type": "text",
        "text": { "content": "There is some ", "link": null },
        "annotations": {
          "bold": false, "italic": false, "strikethrough": false,
          "underline": false, "code": false, "color": "default"
        },
        "plain_text": "There is some ",
        "href": null
      }
    ]
  }
}
```

Rich text objects may be `text`, `mention`, or `equation`. Annotations carry bold / italic / strikethrough / underline / code / color.

#### Configuration

| Option | Layer | Detail |
|---|---|---|
| Wrap text | UI | "If your cells contain a lot of content, you can wrap the content to make it appear across multiple lines. To do this, click the name of a database property. In the menu that appears, select `Wrap text`." ([tables](https://www.notion.com/help/tables)) |
| Description | UI + API | |
| AI autofill | UI | A Text property can be converted to an AI-filled property — see §26 |

The help center explicitly names text wrapping as the canonical example of a per-property setting: "You can adjust settings that are specific to a property (for example, you can wrap a text property)" ([database properties](https://www.notion.com/help/database-properties)).

#### Semantics

- **Default:** `[]`.
- **Empty:** empty array.
- **Sort:** alphabetical ([views, filters and sorts](https://www.notion.com/help/views-filters-and-sorts)).
- **Filters [API]:** `contains`, `does_not_contain`, `does_not_equal`, `ends_with`, `equals`, `is_empty`, `is_not_empty`, `starts_with` ([filter reference](https://developers.notion.com/reference/post-database-query-filter)).
- **Limits:** 2,000 chars per rich text `content` segment; max 25 inline references returned per request ([request limits](https://developers.notion.com/reference/request-limits), [page property values](https://developers.notion.com/reference/page-property-values)).
- Paginated property.

#### Rendering

Table cell: single line unless Wrap text is on. Cards: plain text line under the title. Formatting (bold/links/mentions) is preserved in cells.

---

### 4. Number (`number`)

This is the property with the richest **UI-only** configuration and the thinnest API surface.

#### Schema [API]

```json
{
  "Price": {
    "id": "%7B%5D_P",
    "name": "Price",
    "type": "number",
    "number": { "format": "dollar" }
  }
}
```

#### `format` enum — complete [API]

From the [property schema object](https://developers.notion.com/reference/property-schema-object):

```
number, number_with_commas, percent,
dollar, canadian_dollar, singapore_dollar, hong_kong_dollar,
new_zealand_dollar, new_taiwan_dollar,
euro, pound, yen, yuan, won, ruble, rupee, rupiah, real, lira,
franc, krona, norwegian_krone, danish_krone,
mexican_peso, chilean_peso, philippine_peso, colombian_peso,
argentine_peso, uruguayan_peso,
rand, zloty, baht, forint, koruna, shekel, dirham, riyal,
ringgit, leu
```

That is 40 values. Note the [property object](https://developers.notion.com/reference/property-object) page gives a truncated list ("`number`, `number_with_commas`, `percent`, `dollar`, `euro`, `pound`, `yen`, `yuan`, `won`, `ruble`, `rupee`, `franc`, `real`, `lira`, `krona`, `ringgit`, and more") and links to the schema object page for the full set — the schema object page is the authoritative one.

`UNRESOLVED: Notion's UI number format menu also includes a "Percent" and separately a per-format decimal/precision control in some builds. No documentation confirms a precision or decimal-places setting on the number property. Treat precision as unconfigured.`

#### Value [API]

```json
{ "Number of subscribers": { "id": "WPj%5E", "type": "number", "number": 42 } }
```

A bare JSON number, or `null`.

#### "Show as" visualization [UI only]

Introduced 2022-08-11 ([release notes](https://www.notion.com/releases/2022-08-11)). Configured via clicking a number **or formula** property → `Edit property`.

| Setting | Values | Detail |
|---|---|---|
| Show as | `Number`, `Bar`, `Ring` | Number = plain value; Bar = horizontal progress bar; Ring = circular gauge |
| Divide by | any number | The denominator: the value at which the bar/ring reads as 100% |
| Color | Notion's standard color palette | Fill color of the bar / ring |
| Show number | on/off | Whether the numeric value is drawn alongside the graphic |

Source for the field names and behavior: [Notion 2022-08-11 release notes](https://www.notion.com/releases/2022-08-11) — "click on any of your number or formula properties and select Edit property … show the number as a bar or ring visualization, choose a color … and divide by a custom number, such as your monthly budget, or total engineering hours for a sprint."

**Important:** none of `show_as` / `divide_by` / `color` / `show_number` appear anywhere in the API. The API `number` config contains **only** `format`.

`UNRESOLVED: Are there explicit min/max fields for the bar/ring, or only "Divide by" (implying min = 0, max = divide-by)? All documentation I found describes only "Divide by". The brief mentions min/max — I could not corroborate min/max as separate controls.`

#### Semantics

- **Default:** empty (`null`), not `0`.
- **Empty:** `null`. `0` is a value, not empty.
- **Sort:** numerically ([views, filters and sorts](https://www.notion.com/help/views-filters-and-sorts)).
- **Filters [API]:** `equals`, `does_not_equal`, `greater_than`, `greater_than_or_equal_to`, `less_than`, `less_than_or_equal_to`, `is_empty`, `is_not_empty` ([filter reference](https://developers.notion.com/reference/post-database-query-filter)).
- Conditional color source: yes ([database properties](https://www.notion.com/help/database-properties)).
- Chart axis: yes (see §29).

---

### 5. Select (`select`)

#### Schema [API]

```json
{
  "Department": {
    "id": "Yc%3FJ",
    "name": "Department",
    "type": "select",
    "select": {
      "options": [
        { "id": "ou@_", "name": "jQuery", "color": "purple" }
      ]
    }
  }
}
```

Each option: `id` (opaque string or UUID), `name` (string), `color` (enum).

#### Option color enum — complete [API]

```
blue, brown, default, gray, green, orange, pink, purple, red, yellow
```

Ten values ([property object](https://developers.notion.com/reference/property-object)). Note `default` is a member — it is not the absence of a color.

#### Value [API]

```json
{
  "Department": {
    "id": "Yc%3FJ",
    "type": "select",
    "select": { "id": "ou@_", "name": "jQuery", "color": "purple" }
  }
}
```

A single option object, or `null`.

#### Configuration

| Option | Layer | Detail |
|---|---|---|
| Options list | UI + API | Options are **per-property**, stored in that property's schema. Not shared across properties. |
| Add option inline | UI | "you'll be prompted to add tags by typing what you want and pressing enter after each" ([database properties](https://www.notion.com/help/database-properties)) |
| Option color | UI + API | "Colors are randomly assigned" on creation ([database properties](https://www.notion.com/help/database-properties)); user-editable afterwards |
| Rename / delete option | UI | "Edit tag names and colors, or delete them by clicking on the property field (i.e. the table cell), then `•••` that appears to the right when you hover over any property" ([database properties](https://www.notion.com/help/database-properties)) |
| Reorder options | UI | "Reorder tags by grabbing the `⋮⋮` icon to their left and dragging" ([database properties](https://www.notion.com/help/database-properties)) — this manual order is the sort order |
| Description | UI + API | |

**Commas are not allowed in select option values** ([page property values](https://developers.notion.com/reference/page-property-values)).

**Option count:** "You can add as many unique tags to these menus as you want" ([database properties](https://www.notion.com/help/database-properties)) — no documented cap on the number of options in a select property (distinct from the 100-per-request array cap on multi-select values).

#### Semantics

- **Default:** `null`. There is no "default option" setting for select (unlike Status — see §7 caveat).
- **Empty:** `null`.
- **Sort:** by the **manual option order** the user set by dragging, not alphabetically. "Users can define custom sort order by dragging options up or down" ([views, filters and sorts](https://www.notion.com/help/views-filters-and-sorts)).
- **Filters [API]:** `equals`, `does_not_equal`, `is_empty`, `is_not_empty`. Since March 2026 `equals` / `does_not_equal` **accept an array of values** on select and status filters ([changelog](https://developers.notion.com/page/changelog)).
- Board grouping key: **yes** ([boards](https://www.notion.com/help/boards)).
- Conditional color source: yes.
- Chart axis / grouping: yes.

#### Rendering

Colored pill / tag in table cells and on cards. On a board grouped by this property, each option becomes a column, and the option color tints the column header.

---

### 6. Multi-select (`multi_select`)

#### Schema [API]

Identical shape to select:

```json
{
  "Programming language": {
    "id": "QyRn",
    "name": "Programming language",
    "type": "multi_select",
    "multi_select": {
      "options": [
        { "id": "tC;=", "name": "TypeScript", "color": "purple" },
        { "id": "e4413a91-9f84-4c4a-a13d-5b4b3ef870bb", "name": "JavaScript", "color": "red" }
      ]
    }
  }
}
```

#### Value [API]

```json
{
  "Programming language": {
    "id": "QyRn",
    "name": "Programming language",
    "type": "multi_select",
    "multi_select": [
      { "id": "tC;=", "name": "TypeScript", "color": "purple" },
      { "id": "e4413a91-9f84-4c4a-a13d-5b4b3ef870bb", "name": "JavaScript", "color": "red" }
    ]
  }
}
```

An **array** of option objects. Empty array when unset.

#### Configuration

Same as select (per-property options, ten colors, random color on create, drag to reorder, commas disallowed).

#### Semantics

- **Default:** `[]`.
- **Empty:** empty array.
- **Sort:** `UNRESOLVED: how does Notion order rows when sorting by a multi-select? The help center says only that "Different properties sort by different logic, depending on their value type" and does not specify multi-select. The plausible behavior is ordering by the first selected option's position in the manual option order, but this is undocumented.`
- **Filters [API]:** `contains`, `does_not_contain`, `is_empty`, `is_not_empty` ([filter reference](https://developers.notion.com/reference/post-database-query-filter)).
- **Limits:** max 100 options in a multi-select **array per request** ([request limits](https://developers.notion.com/reference/request-limits)).
- Board grouping key: **yes** — a page with N tags appears in N columns ([boards](https://www.notion.com/help/boards)).
- Conditional color source: yes.

#### Rendering

Row of colored pills; overflow truncated in narrow table cells.

---

### 7. Status (`status`)

The most structurally distinctive type: options are partitioned into **groups**, and the groups are a fixed, non-extensible taxonomy.

#### Schema [API]

```json
{
  "Status": {
    "id": "biOx",
    "name": "Status",
    "type": "status",
    "status": {
      "options": [
        { "id": "034ece9a-384d-4d1f-97f7-7f685b29ae9b", "name": "Not started", "color": "default" },
        { "id": "330aeafb-598c-4e1c-bc13-1148aa5963d3", "name": "In progress", "color": "blue" },
        { "id": "497e64fb-01e2-41ef-ae2d-8a87a3bb51da", "name": "Done", "color": "green" }
      ],
      "groups": [
        { "id": "b9d42483-e576-4858-a26f-ed940a5f678f", "name": "To-do", "color": "gray",
          "option_ids": ["034ece9a-384d-4d1f-97f7-7f685b29ae9b"] },
        { "id": "cf4952eb-1265-46ec-86ab-4bded4fa2e3b", "name": "In progress", "color": "blue",
          "option_ids": ["330aeafb-598c-4e1c-bc13-1148aa5963d3"] },
        { "id": "4fa7348e-ae74-46d9-9585-e773caca6f40", "name": "Complete", "color": "green",
          "option_ids": ["497e64fb-01e2-41ef-ae2d-8a87a3bb51da"] }
      ]
    }
  }
}
```

Note the schema has **two parallel arrays**: a flat `options` list, and a `groups` list whose members carry `option_ids` pointing into `options`. The group membership is therefore an explicit join, not nesting.

#### Group taxonomy — fixed [UI]

The three groups are `To-do`, `In progress`, `Complete`. **You cannot change them:** "you can't change the three main categories" ([status property guide](https://www.notion.com/help/guides/status-property-gives-clarity-on-tasks)). Users add custom **options** inside a group ("Add status underneath To-do, In Progress or Completed"), e.g. "In the Pipeline", "Blocked".

Group colors observed in the default schema: To-do = `gray`, In progress = `blue`, Complete = `green`.

`UNRESOLVED: Can group colors be changed in the UI? The API schema exposes a color on each group, but no help documentation describes a group-color picker.`

#### Writability [API] — this changed recently

Status was **read-only via the API for years**. That is no longer true:

- **June 22, 2026:** "You can now create and update status properties through the Notion API and Notion MCP. Previously, status properties were read-only." ([changelog](https://developers.notion.com/page/changelog))
- Status option objects now accept an optional `group` field when creating or updating a schema ([changelog](https://developers.notion.com/page/changelog)). On write you pass a `group` per option, valued `"To-do"`, `"In progress"`, or `"Complete"` ([property schema object](https://developers.notion.com/reference/property-schema-object)).
- Group fallback rules on update: "If `group` is omitted on update, existing options keep their current group, and new options use To-do when present or the first existing group otherwise." ([changelog](https://developers.notion.com/page/changelog))
- **Groups themselves remain UI-only:** "To rename, reorder, or otherwise reconfigure groups, use the Notion UI." ([changelog](https://developers.notion.com/page/changelog))
- Creating a status property without options yields defaults `Not started` / `In progress` / `Done` in groups `To-do` / `In progress` / `Complete` ([changelog](https://developers.notion.com/page/changelog)).

So the write model is: **options are API-writable and carry a group tag; the group set is a closed enum of three, managed only by the UI.**

#### Value [API]

```json
{
  "Status": {
    "id": "Z%3ClH",
    "type": "status",
    "status": {
      "id": "539f2705-6529-42d8-a215-61a7183a92c0",
      "name": "In progress",
      "color": "blue"
    }
  }
}
```

Note the value carries **no group** — group is resolved by looking the option id up in the schema.

#### Configuration

| Option | Layer | Detail |
|---|---|---|
| Options within groups | UI + API | |
| Option color | UI + API | Same ten-color enum |
| Group rename/reorder | UI only | ([changelog](https://developers.notion.com/page/changelog)) |
| Display as select vs checkbox | UI | "display status like a select property, or as a checkbox. The checkbox will show everything in 'To Do' as unchecked" ([status guide](https://www.notion.com/help/guides/status-property-gives-clarity-on-tasks)) — a genuinely unusual rendering toggle that collapses the three groups to a boolean |
| Default option for new pages | UI | `UNRESOLVED: Notion's status property editor is widely believed to have a "default" option marker for newly created rows. I could not find this documented in the help center or API. The API changelog only says newly created properties get "Not started" as the first To-do option.` |

#### Semantics

- **Default:** the property's default status option (in practice `Not started`), not `null` — because creating a status property auto-creates the three defaults ([changelog](https://developers.notion.com/page/changelog)).
- **Empty:** `null` is possible (the API filter set includes `is_empty` / `is_not_empty`), so status can be cleared.
- **Sort:** `UNRESOLVED: does status sort by group first then option order within group, or by flat option order? Notion's help center does not specify. Empirically the option order is a flat list that happens to be group-ordered, but this is not documented.` On a **board**, grouping by status and then `Sort → Manual` lets you drag the columns into any order ([status guide](https://www.notion.com/help/guides/status-property-gives-clarity-on-tasks)).
- **Filters [API]:** `equals`, `does_not_equal`, `is_empty`, `is_not_empty`; `equals` / `does_not_equal` accept arrays since March 2026 ([changelog](https://developers.notion.com/page/changelog)).
- Board grouping key: **yes**, and this is its primary use.
- Conditional color source: yes.

#### Rendering

A colored pill preceded by a progress glyph (an open circle for To-do, a partially-filled circle for In progress, a filled/checked circle for Complete). On a board, options become columns and can be collapsed by group.

---

### 8. Date (`date`)

#### Schema [API]

```json
{ "Due date": { "id": "M%3BBw", "name": "Due date", "type": "date", "date": {} } }
```

**Empty configuration.** Every display setting below is UI-only and API-invisible.

#### Value [API]

```json
{
  "Due date": {
    "id": "M%3BBw",
    "type": "date",
    "date": {
      "start": "2023-02-07",
      "end": null,
      "time_zone": null
    }
  }
}
```

| Field | Type | Meaning |
|---|---|---|
| `start` | ISO 8601 date or date-time, **required** | |
| `end` | ISO 8601 date or date-time, nullable | Presence makes it a range |
| `time_zone` | IANA tz string, nullable | |

The date/date-time distinction is encoded in the **string format itself** — `"2023-02-07"` is a whole-day date, `"2023-02-07T14:30:00.000Z"` is a timed instant. There is no separate `has_time` flag. That is the mechanism behind the UI's "Include time" toggle.

Date filters gained time and timezone support ([changelog entry](https://developers.notion.com/changelog/dates-with-times-and-timezones-are-now-supported-on-database-date-filters)).

#### Configuration [UI]

From the date picker ([database properties](https://www.notion.com/help/database-properties)), verbatim:

- "Click `Remind` to set a reminder in this property that will notify you on the given date and time."
- "Switch on `End date` to define a range of dates in this property."
- "Switch on `Include time` to choose an exact time, not just a day."
- "Click `Date format & timezone` to modify these settings."
- "Click `Clear` to remove any value in the date property."

Critically: **`End date`, `Include time`, reminder, and format are set per-value in the date picker**, i.e. they behave as per-cell state surfaced through a picker, and `Date format & timezone` is the shared display setting.

Time format (12h vs 24h) is a setting: "you can choose how you want the time to be formatted" between 12-hour and 24-hour ([Notion Calendar settings](https://www.notion.com/help/notion-calendar-settings)). Workspace-level time zone lives under Language & Time with an "Automatically update time zone" toggle ([time zones](https://www.notion.com/help/time-zones)).

`UNRESOLVED: The exact enumerated list of date display formats (e.g. "Full date", "Month/Day/Year", "Day/Month/Year", "Year/Month/Day", "Relative") is not published in the Notion help center. I searched for it directly and found only the instruction to click "Date format & timezone". A clone should treat the format list as needing empirical capture from the product UI.`

`UNRESOLVED: Reminder configuration options (e.g. "On the day of / 1 day before / 2 days before / 1 week before", and time-of-day for reminders on all-day dates) are not enumerated in the help center.`

#### Semantics

- **Default:** `null`.
- **Empty:** `null` (the whole `date` object is null, not just `start`).
- **Sort:** chronological. `UNRESOLVED: for a range, does the sort key use start or end? Undocumented.`
- **Filters [API], complete:** `after`, `before`, `equals`, `on_or_after`, `on_or_before`, `is_empty`, `is_not_empty`, `past_week`, `past_month`, `past_year`, `this_week`, `next_week`, `next_month`, `next_year` ([filter reference](https://developers.notion.com/reference/post-database-query-filter)). Note the asymmetry: there is `this_week` but **no `this_month` or `this_year`**.
- Conditional color source: yes.
- Calendar / timeline date source: **yes**, its primary role.

#### Rendering

Table cell: formatted date string, ranges shown as `start → end`. Calendar: an event chip on the day; multi-day ranges span cells and are drag-resizable — "Cards can span multiple days by hovering over its right or left edge, clicking and dragging to expand it in either direction" ([calendars](https://www.notion.com/help/calendars)). Timeline: a bar. Cards: a date line.

---

### 9. Person (`people`)

#### Schema [API]

```json
{ "Stakeholders": { "id": "%7BLUX", "name": "Stakeholders", "type": "people", "people": {} } }
```

Empty config ([property schema object](https://developers.notion.com/reference/property-schema-object)).

#### Value [API]

```json
{
  "Stakeholders": {
    "id": "%7BLUX",
    "type": "people",
    "people": [
      {
        "object": "user",
        "id": "c2f20311-9e54-4d11-8c79-7398424ae41e",
        "name": "Kimberlee Johnson",
        "avatar_url": null,
        "type": "person",
        "person": { "email": "kimberlee@example.com" }
      }
    ]
  }
}
```

An array of user objects. Users may be `type: "person"` or `type: "bot"`.

#### Who can be referenced

The UI description is "Tag a person **or group** from your Notion workspace" ([database properties](https://www.notion.com/help/database-properties)) and "In a `Person` property, you can tag other **members or guests** in your workspace" ([database properties](https://www.notion.com/help/database-properties)).

So: workspace **members**, **guests**, and **groups**. Not arbitrary email addresses.

`UNRESOLVED: How is a tagged group represented in the API people array? The user object documentation covers person and bot types only. Group references may be API-invisible.`

#### Configuration [UI]

| Option | Detail |
|---|---|
| **Limit** | "select `Limit` to decide if each database page should only have `1 Person` … or if there should be `No limit`" ([wikis & verified pages](https://www.notion.com/help/wikis-and-verified-pages)). This is a real, under-known config: person properties have a 1-vs-unlimited cardinality switch. Introduced in [Notion 2.17](https://www.notion.com/releases/2022-06-29) — "The person property now has an optional 1 person limit". |
| Permissions | "You can assign specific access levels to people mentioned in a person or created by property in a database page." ([database properties](https://www.notion.com/help/database-properties)) — a person property can **grant page access**, which is a security-relevant behavior a clone must decide on. |
| Description | Yes |

#### Semantics

- **Default:** `[]`. Notion's Owner property in wikis defaults to the page creator ([wikis & verified pages](https://www.notion.com/help/wikis-and-verified-pages)) — but that is a wiki-template behavior, not a generic person-property default. `UNRESOLVED: is there a generic "default to current user" setting on person properties?`
- **Empty:** empty array.
- **Sort:** `UNRESOLVED: alphabetical by name? by user id? undocumented.`
- **Filters [API]:** `contains`, `does_not_contain`, `is_empty`, `is_not_empty`.
- **Limits:** max **100 users** per request; max **25 returned** inline, then paginate via the property item endpoint ([request limits](https://developers.notion.com/reference/request-limits), [page property values](https://developers.notion.com/reference/page-property-values)).
- Paginated property.
- Board grouping key: **yes** ([boards](https://www.notion.com/help/boards)).
- Conditional color source: yes.

#### Rendering

Avatar chips with names. Truncated to avatars only in narrow cells.

---

### 10. Files & media (`files`)

#### Schema [API]

```json
{ "Blueprint": { "id": "tJPS", "name": "Blueprint", "type": "files", "files": {} } }
```

#### Value [API]

Array of file objects, each `external` or `file` (Notion-hosted):

```json
{
  "Blueprint": {
    "id": "tJPS",
    "type": "files",
    "files": [
      {
        "name": "Project blueprint",
        "type": "external",
        "external": {
          "url": "https://www.figma.com/file/g7eazMtXnqON4i280CcMhk/project-alpha-blueprint"
        }
      }
    ]
  }
}
```

A Notion-hosted file instead carries `{"type": "file", "file": {"url": "...", "expiry_time": "..."}}` — hosted file URLs are **signed and time-limited**. See [working with files and media](https://developers.notion.com/docs/working-with-files-and-media).

#### Configuration [UI]

Behavior, verbatim from [database properties](https://www.notion.com/help/database-properties):

- "clicking on the field provided will prompt you to upload a file, or paste a link to embed a file"
- "You can also drag a file from your computer into the property to upload it"
- "You can add multiple files into any field at once"
- "Click on the `•••` to the right of uploaded files to `Delete`, `Download`, `Full screen` or `View original`"
- "Use the `⋮⋮` to the left of uploaded files to drag and re-order them" — **file order within a cell is user-controlled and meaningful**

There is no format/display configuration on the property itself.

#### Limits

- **Free plan: 5 MB per file. Paid plans: 5 GB per file** ([images, files & media](https://www.notion.com/help/images-files-and-media)).
- `UNRESOLVED: is there a maximum number of files per cell? Not documented.`

#### Semantics

- **Default:** `[]`.
- **Empty:** empty array.
- **Sort:** `UNRESOLVED: sorting by a files property is not documented; it may not be sortable at all.`
- **Filters [API]:** only `is_empty` / `is_not_empty` ([filter reference](https://developers.notion.com/reference/post-database-query-filter)).
- Board grouping key: no.
- Chart axis: **explicitly excluded** — "Files and media" cannot be used on chart axes ([charts](https://www.notion.com/help/charts)).
- Conditional color source: **no** (not in the allowed list).

#### Rendering — special role

Files & media is the **card image source**. In gallery and board views the card preview can be set to a specific Files & media property: "If you have a `Files & media` property in your database, you'll see the name of those properties in this menu" ([galleries](https://www.notion.com/help/galleries), [boards](https://www.notion.com/help/boards)).

---

### 11. Checkbox (`checkbox`)

#### Schema [API]

```json
{ "Task completed": { "id": "ZI%40W", "name": "Task completed", "type": "checkbox", "checkbox": {} } }
```

#### Value [API]

```json
{ "Task completed": { "id": "ZI%40W", "type": "checkbox", "checkbox": true } }
```

A bare boolean.

#### Semantics

- **Default:** `false`.
- **Empty:** checkbox has **no empty state** — it is always `true` or `false`. This is reflected in the filter set: `equals` and `does_not_equal` only, with **no `is_empty` / `is_not_empty`** ([filter reference](https://developers.notion.com/reference/post-database-query-filter)). This is a genuine modeling constraint: a clone must make checkbox `NOT NULL DEFAULT false`.
- **Sort:** `UNRESOLVED: does ascending put unchecked or checked first? Undocumented.`
- Conditional color source: yes ([database properties](https://www.notion.com/help/database-properties)).
- Board grouping key: `UNRESOLVED: the boards help page names "select, person, multi-select, or relation" as grouping properties and says relation and formula grouping isn't supported — which is internally contradictory. Checkbox grouping is not confirmed.`
- **Commenting quirk:** "While you can comment on a checkbox property, you'll have to open the database page to do so — there won't be a way to do this from table view." ([database properties](https://www.notion.com/help/database-properties))

#### Rendering

A checkbox glyph in cells; on cards a checkbox with the property name.

---

### 12. URL (`url`)

#### Schema [API]

`{ "url": {} }` — no configuration.

#### Value [API]

```json
{ "Website": { "id": "bB%3D%5B", "type": "url", "url": "https://developers.notion.com/" } }
```

Plain string, or `null`.

#### Semantics

- **Default:** `null`. **Empty:** `null` or empty string.
- **Behavior:** "Accepts a link to a website and opens the link in a new tab when clicked" ([database properties](https://www.notion.com/help/database-properties)).
- **Sort:** alphabetical (string).
- **Filters [API]:** same as rich_text — `contains`, `does_not_contain`, `does_not_equal`, `ends_with`, `equals`, `is_empty`, `is_not_empty`, `starts_with`.
- **Limit:** 2,000 characters ([request limits](https://developers.notion.com/reference/request-limits)).
- Conditional color source: no.

---

### 13. Email (`email`)

`{ "email": {} }`. Value is a plain string:

```json
{ "Email": { "id": "y%5C%5E_", "type": "email", "email": "ada@makenotion.com" } }
```

- "Accepts an email address and launches your mail client when clicked" ([database properties](https://www.notion.com/help/database-properties)).
- **Limit: 200 characters** ([request limits](https://developers.notion.com/reference/request-limits)).
- Filters: same string set as rich_text.
- `UNRESOLVED: does Notion validate email syntax on input, or accept arbitrary text? Not documented.`

---

### 14. Phone (`phone_number`)

`{ "phone_number": {} }`. Value is a plain string:

```json
{ "Contact phone number": { "id": "%5DKhQ", "type": "phone_number", "phone_number": "415-202-4776" } }
```

- **No format is enforced** ([page property values](https://developers.notion.com/reference/page-property-values)) — it is free text.
- "Accepts a phone number and prompts your device to call it when clicked" ([database properties](https://www.notion.com/help/database-properties)).
- **Limit: 200 characters** ([request limits](https://developers.notion.com/reference/request-limits)).
- Filters: same string set as rich_text.

---

### 15. Formula (`formula`)

#### Schema [API]

```json
{
  "Days until launch": {
    "id": "CSoE",
    "name": "Days until launch",
    "type": "formula",
    "formula": { "expression": "dateBetween(prop(\"Launch\"), now(), \"days\")" }
  }
}
```

`expression` is a **string in Notion's formula language**. It is writable via the API; the *result* is not.

#### Value [API]

A tagged union — `type` names which key carries the result:

```json
{
  "Days until launch": {
    "id": "CSoE",
    "type": "formula",
    "formula": { "type": "number", "number": 56 }
  }
}
```

API-exposed result types: `boolean`, `date`, `number`, `string`, `unsupported` ([page property values](https://developers.notion.com/reference/page-property-values)).

#### Formula 2.0 type system [UI]

The **product** formula language has a richer type system than the API exposes ([formula syntax](https://www.notion.com/help/formula-syntax)):

| Formula type | Sourced from |
|---|---|
| Text | Title, Text, Select properties; string operations |
| Text (list) | Multi-select properties, list operations |
| Boolean | Checkbox properties, comparisons |
| Number | Number properties, math |
| Date | Date, Created time, Last edited time |
| Person | Created by, Last edited by, Person |
| Person (list) | Multi-person selections |
| Page (list) | Relations |

"formula types are different from property types" ([formula syntax](https://www.notion.com/help/formula-syntax)). Results display contextually: dates render with `@` notation (`@August 30, 2023`), lists render in brackets (`[1, 2, 3]`). Type coercion happens automatically (`toNumber(true)` → `1`).

**The API cannot represent list/person/page formula results** — those collapse to `unsupported`. This is a real fidelity gap between the product and its API.

Formulas 2.0 replaced the original formula language; see [Formulas 2.0: what's changed](https://www.notion.com/help/guides/new-formulas-whats-changed).

#### Configuration

| Option | Layer | Detail |
|---|---|---|
| Expression | UI + API | |
| "Show as" bar/ring | UI | **Formula properties that return numbers get the same Bar/Ring/Divide by/Color/Show number treatment as Number properties** — "click on any of your number **or formula** properties and select Edit property" ([release notes](https://www.notion.com/releases/2022-08-11)) |
| Description | UI + API | |

#### Semantics

- **Read-only value.** Cannot be written.
- **Default / empty:** derived from inputs; a formula over empty inputs typically yields the type's zero value or an error.
- **Sort:** by the result type's semantics.
- **Filters [API]:** you filter on the *result type*: `checkbox`, `date`, `number`, `string` ([filter reference](https://developers.notion.com/reference/post-database-query-filter)).
- **Pagination:** returns max 25 inline page/person references; use the property item endpoint for the complete data ([page property values](https://developers.notion.com/reference/page-property-values)).
- Board grouping: **not supported** — "grouping by relation or formula properties isn't currently supported" ([boards](https://www.notion.com/help/boards)).
- Chart axis: allowed **except** "Formulas resulting in a list of outputs" and complex formulas built on relations/rollups ([charts](https://www.notion.com/help/charts)).
- Conditional color source: **yes** ([database properties](https://www.notion.com/help/database-properties)).
- **Cannot be commented on** ([database properties](https://www.notion.com/help/database-properties)).
- **Limit:** equation expressions are capped at 1,000 characters ([request limits](https://developers.notion.com/reference/request-limits)) — this cap is documented for `equation.expression` in rich text; `UNRESOLVED: whether the same 1,000-char cap applies to formula property expressions.`

---

### 16. Relation (`relation`)

#### Schema [API] — changed in `2025-09-03`

**Two-way (dual property):**

```json
{
  "Projects": {
    "id": "~pex",
    "name": "Projects",
    "type": "relation",
    "relation": {
      "data_source_id": "6c4240a9-a3ce-413e-9fd0-8a51a4d0a49b",
      "dual_property": {
        "synced_property_name": "Tasks",
        "synced_property_id": "JU]K"
      }
    }
  }
}
```

**One-way (single property):** carries `"single_property": {}` instead — "Single property relation objects have no additional configuration" ([property schema object](https://developers.notion.com/reference/property-schema-object)).

**The 2025-09-03 change:** relations now target a **data source**, not a database. Responses include both ids for compatibility:

```json
"relation": {
  "database_id": "6c4240a9-a3ce-413e-9fd0-8a51a4d0a49b",
  "data_source_id": "a42a62ed-9b51-4b98-9dea-ea6d091bc508"
}
```

but "the *request* object must **only contain `data_source_id`**" ([upgrade guide](https://developers.notion.com/docs/upgrade-guide-2025-09-03)). Sending `database_id` on write is now invalid.

#### Value [API]

```json
{
  "Related tasks": {
    "id": "hgMz",
    "type": "relation",
    "relation": [ { "id": "dd456007-6c66-4bba-957e-ea501dcda3a6" } ],
    "has_more": false
  }
}
```

An array of `{id}` page references plus a `has_more` flag. The API returns max 25 and sets `has_more: true` beyond that ([page property values](https://developers.notion.com/reference/page-property-values)).

#### Configuration [UI]

From [relations & rollups](https://www.notion.com/help/relations-and-rollups):

| Option | Detail |
|---|---|
| Target database | The related database/data source |
| **Two-way relation** | Relations default to **one-way**. Toggling "Show on [related database]" creates the mirror property, which you then name. Two-way enables edits from either side. |
| **Self-relation** | A database can relate to itself. Notion's own advice: "we recommend toggling **off** `Two-way relation` as it essentially duplicate the property." |
| **Limit** | "limit the number of pages that can be included in your relations property – with the option to select `1 page` or to have `No limit`" |
| Description | Yes |

**What happens on the related side:** for a two-way relation, a *new relation property is materialized on the target data source* pointing back. Its name is user-chosen at creation and is recorded in the source's `dual_property.synced_property_name` / `synced_property_id`. Deleting either side's property `UNRESOLVED: does deleting one half of a two-way relation delete the mirror, or convert it to one-way? Not documented.`

#### Semantics

- **Default:** `[]`.
- **Empty:** empty array.
- **Sort:** `UNRESOLVED: how does Notion sort by a relation property? Undocumented; possibly by the first related page's title.`
- **Filters [API]:** `contains`, `does_not_contain`, `is_empty`, `is_not_empty`.
- **Limits:** max **100 related pages per request**; max **25 returned** inline ([request limits](https://developers.notion.com/reference/request-limits), [page property values](https://developers.notion.com/reference/page-property-values)). `UNRESOLVED: total stored relation cardinality cap, if any.`
- Paginated property.
- Board grouping: the [boards page](https://www.notion.com/help/boards) contradicts itself — it says grouping is by "a select, person, multi-select, or **relation** property" and then that "grouping by **relation** or formula properties isn't currently supported". `UNRESOLVED: is relation a legal board grouping key?`
- Chart axis: **excluded** for relations-based complex formulas; relations themselves `UNRESOLVED`.
- Conditional color source: **yes** ([database properties](https://www.notion.com/help/database-properties)).

#### Rendering

Chips showing the related pages' titles, each clickable to open a page peek.

---

### 17. Rollup (`rollup`)

#### Schema [API]

```json
{
  "Estimated total project time": {
    "id": "%5E%7Cy%3C",
    "name": "Estimated total project time",
    "type": "rollup",
    "rollup": {
      "rollup_property_name": "Days to complete",
      "relation_property_name": "Tasks",
      "rollup_property_id": "\\nyY",
      "relation_property_id": "Y]<y",
      "function": "sum"
    }
  }
}
```

Three inputs: **which relation property** to traverse, **which property on the target** to read, and **which aggregation function** to apply.

#### `function` enum — complete [API]

```
average, checked, count, count_per_group, count_values, date_range,
earliest_date, empty, latest_date, max, median, min, not_empty,
percent_checked, percent_empty, percent_not_empty, percent_per_group,
percent_unchecked, range, show_original, show_unique, sum, unchecked, unique
```

24 values ([page property values](https://developers.notion.com/reference/page-property-values)). Note the [property object](https://developers.notion.com/reference/property-object) page omits `count_per_group` and `percent_per_group` — the page-property-values page is the fuller list.

#### UI function names, grouped by legal source type

From [relations & rollups](https://www.notion.com/help/relations-and-rollups):

| Applies to | UI function names |
|---|---|
| **Any property type** | Show original, Show unique values, Count all, Count values, Count unique values, Count empty, Count not empty, Percent empty, Percent not empty |
| **Number properties only** | Sum, Average, Median, Min, Max, Range |
| **Date properties only** | Earliest date, Latest date, Date range |

The checkbox-specific API functions (`checked`, `unchecked`, `percent_checked`, `percent_unchecked`) map to a fourth implicit group — **checkbox properties only**.

`UNRESOLVED: the UI names for count_per_group / percent_per_group, and which contexts expose them. They appear in the API enum but not the help center's function list; they are likely tied to grouped views.`

#### Value [API]

A tagged union with the aggregation function echoed back:

```json
{
  "Number of units": {
    "id": "hgMz",
    "type": "rollup",
    "rollup": { "type": "number", "number": 2, "function": "count" }
  }
}
```

Result `type` is one of `array`, `date`, `incomplete`, `number`, `unsupported`. **`incomplete`** is a distinct state meaning the aggregation could not be fully computed — a clone needs an equivalent.

#### Configuration

| Option | Layer |
|---|---|
| Relation property, target property, function | UI + API |
| "Show as" bar/ring | `UNRESOLVED: numeric rollups presumably get the Bar/Ring treatment like numbers and formulas, but the release notes only name "number or formula properties".` |
| Description | UI + API |

#### Semantics

- **Read-only value.**
- **No rollups of rollups:** "this could create unintended loops" ([relations & rollups](https://www.notion.com/help/relations-and-rollups)).
- **Sort:** "Rollups can only be sorted when they output a numeric value" ([relations & rollups](https://www.notion.com/help/relations-and-rollups)). This is a hard, explicit constraint.
- **Filters [API]:** `any`, `every`, `none` for array results; `date` for date results; `number` for number results ([filter reference](https://developers.notion.com/reference/post-database-query-filter)).
- **Pagination:** use the property item endpoint for >25 references ([page property values](https://developers.notion.com/reference/page-property-values)).
- Chart axis: **explicitly excluded** — rollups cannot be used on chart axes or in donut charts ([charts](https://www.notion.com/help/charts)).
- Conditional color source: **yes** ([database properties](https://www.notion.com/help/database-properties)).
- **Cannot be commented on** ([database properties](https://www.notion.com/help/database-properties)).

---

### 18. Created time (`created_time`)

```json
{ "Created time": { "id": "eB_%7D", "name": "Created time", "type": "created_time", "created_time": {} } }
```

Value is a bare ISO 8601 string:

```json
{ "Created time": { "id": "eB_%7D", "type": "created_time", "created_time": "2022-10-24T22:54:00.000Z" } }
```

- **Read-only.** "Records the timestamp of an item's creation. Auto-generated and not editable." ([database properties](https://www.notion.com/help/database-properties))
- **Never empty** — every page has a creation time. No `is_empty` filter.
- **Default:** the row's creation instant.
- Filters [API]: available as a **timestamp filter** (`{"timestamp": "created_time", "created_time": {...}}`) as well as a property filter, using the full date condition set ([filter reference](https://developers.notion.com/reference/post-database-query-filter)).
- Timeline date source: yes — "time-tracking properties like `Last edited` or `Created time`" are usable ([timelines](https://www.notion.com/help/timelines)).
- Conditional color source: `UNRESOLVED — the allowed list says "Date"; whether created_time counts is unstated.`
- **Multiple created-time properties** on one data source are permitted (unlike title).

---

### 19. Created by (`created_by`)

```json
{ "Created by": { "id": "%5DR%3C%2A", "name": "Created by", "type": "created_by", "created_by": {} } }
```

Value is a user object:

```json
{
  "created_by": {
    "object": "user",
    "id": "c2f20311-9e54-4d11-8c79-7398424ae41e"
  }
}
```

- **Read-only.** "Automatically records the person who created the item." ([database properties](https://www.notion.com/help/database-properties))
- Never empty.
- **Can grant permissions:** "You can assign specific access levels to people mentioned in a person **or created by** property in a database page." ([database properties](https://www.notion.com/help/database-properties))
- Filters: people-style (`contains`, `does_not_contain`, `is_empty`, `is_not_empty`).

---

### 20. Last edited time (`last_edited_time`)

```json
{ "Last edited time": { "id": "%3Defk", "type": "last_edited_time", "last_edited_time": "2023-02-24T21:06:00.000Z" } }
```

- **Read-only, auto-updated.** "Records the timestamp of an item's last edit. Auto-updated and not editable." ([database properties](https://www.notion.com/help/database-properties))
- Never empty.
- Available as a **timestamp filter** ([filter reference](https://developers.notion.com/reference/post-database-query-filter)).
- `UNRESOLVED: exactly which mutations bump last_edited_time — property edits only, or also page body block edits? Notion's semantics here are widely misunderstood and not documented precisely.`

---

### 21. Last edited by (`last_edited_by`)

```json
{
  "Last edited by column name": {
    "id": "uGNN",
    "type": "last_edited_by",
    "last_edited_by": {
      "object": "user",
      "id": "9188c6a5-7381-452f-b3dc-d4865aa89bdf",
      "name": "Test Connection",
      "avatar_url": "https://s3-us-west-2.amazonaws.com/public.notion-static.com/.../leplane.jpeg",
      "type": "bot",
      "bot": {}
    }
  }
}
```

- **Read-only, auto-updated** ([database properties](https://www.notion.com/help/database-properties)).
- Note the example is a **bot** user — integrations and automations are recorded here, so the user object union must include bots.

---

### 22. ID / Unique ID (`unique_id`)

#### Schema [API]

```json
{
  "test-ID": {
    "id": "tqqd",
    "name": "test-ID",
    "type": "unique_id",
    "unique_id": { "prefix": "RL" }
  }
}
```

`prefix` is a nullable string. It is the only configuration.

#### Value [API]

```json
{
  "test-ID": {
    "id": "tqqd",
    "type": "unique_id",
    "unique_id": { "number": 3, "prefix": "RL" }
  }
}
```

The prefix is **denormalized into every value**, not just the schema.

#### Configuration & behavior [UI]

From [unique ID](https://www.notion.com/help/unique-id):

| Rule | Verbatim |
|---|---|
| Prefix default | "The prefix will be generated automatically based on the names of the teamspace and database, but you can change this anytime in the text box." |
| Numbering start | "Unique ID numbers always start at 1" |
| Gaps | "and are assigned to every page, **including deleted pages**" — deleting a row **does not** free its number; the counter is monotonic and gaps are permanent |
| Immutability | "ID numbers will never change" |
| Backfill | IDs apply to all existing items in the database automatically when the property is added |
| URL routing | Pages are reachable at `notion.so/<PREFIX>-<NUMBER>` (e.g. `notion.so/TASK-123`). "Unique ID URLs will only work if your unique ID has a prefix." |

So the model is: a **per-data-source monotonic counter**, never reused, immutable per row, with a mutable display prefix. A duplicated page gets a **new** number (it is a new page).

`UNRESOLVED: what happens to a row's unique ID when the page is moved to a different database? And can the same data source hold two unique_id properties with different counters?`

#### Semantics

- **Default:** next counter value, assigned at row creation. **Read-only.**
- **Never empty.**
- **Sort:** numeric on the `number` component. Prefix is display-only.
- **Filters [API]:** `equals`, `does_not_equal`, `greater_than`, `greater_than_or_equal_to`, `less_than`, `less_than_or_equal_to` — numeric conditions, **no is_empty** ([filter reference](https://developers.notion.com/reference/post-database-query-filter)).
- Chart axis: **explicitly excluded** ([charts](https://www.notion.com/help/charts)).
- Conditional color source: no.
- **Cannot be commented on** ([database properties](https://www.notion.com/help/database-properties)).

#### Rendering

`PREFIX-NUMBER` as a monospace-ish token in cells and on cards.

---

### 23. Place (`place`)

The newest property type — launched with map view in [Notion 3.1, November 17, 2025](https://www.notion.com/releases/2025-11-17).

#### Schema [API]

```json
{ "Place": { "id": "Xqz4", "name": "Place", "type": "place", "place": {} } }
```

No configuration.

#### Value [API] — **not readable**

```json
{ "Place": { "id": "%60%40Gq", "type": "place", "place": null } }
```

Verbatim warning from the [property object reference](https://developers.notion.com/reference/property-object):

> Place page property values are not fully supported via the API. Reading a place property returns `null`. See [Unsupported properties](https://developers.notion.com/reference/page-property-values#unsupported-properties).

**This is a significant gap:** the property type exists in the schema API but its values are opaque. A clone has no reference JSON for what Place actually stores.

#### What it stores [UI]

"Contains location values. Can be used with the Map view." ([property object](https://developers.notion.com/reference/property-object))

"Accepts a location via location services, a location name, or an address." ([database properties](https://www.notion.com/help/database-properties))

Three input methods ([maps](https://www.notion.com/help/maps)):
1. "granting access to your current location"
2. "entering the name of a location"
3. "entering an address"

Geocoding: "address search relies on a third-party provider" and "data quality and coverage may vary by region" ([maps](https://www.notion.com/help/maps)). The provider is not named.

`UNRESOLVED: does the Place property store latitude/longitude, a place-provider id, a formatted address string, or all three? Notion documents none of this and the API returns null. This is the single biggest documentation gap for a clone.`

`UNRESOLVED: which map tile/geocoding provider Notion uses.`

#### Configuration

None documented beyond the property name and description.

#### Semantics

- **Default:** empty.
- **Empty:** `null`.
- **Sort:** `UNRESOLVED — undocumented.`
- **Filters [API]:** none listed in the filter reference. `UNRESOLVED: is a place property filterable at all?`
- **Conversion:** you can convert a Text property to Place, but "you may need to clean up" the addresses so they resolve ([maps](https://www.notion.com/help/maps)).

#### Rendering

- **Map view:** a pin per row. "You can click a pin on your map to open the corresponding database page, and zoom in and out, or drag the map to explore." ([maps](https://www.notion.com/help/maps))
- **Map view is gated on this property:** "To create a map view of a database, your database must have a place property. If you don't already have a place property, one will be created for you when you create a map view." ([maps](https://www.notion.com/help/maps))
- **Multiple place properties:** switch which one drives the map via "the slider menu at the top of your map view, selecting `Layout`, then `Map by`" ([maps](https://www.notion.com/help/maps)).
- **Map view limit: 100 items.** "Up to 100 items can be shown in map view at one time." Mitigation: "try narrowing down your list using filters, or splitting items across additional views." ([maps](https://www.notion.com/help/maps))
- Table/board/gallery rendering: `UNRESOLVED — not documented.`
- AI: "You can also ask your Agent to add a place property and update an existing database with locations." ([Notion 3.1](https://www.notion.com/releases/2025-11-17))

---

### 24. Verification (`verification`)

Documented in the **page property values** reference but **absent from the property schema reference** — you can read verification values but there is no documented way to create the property via API.

#### Value [API]

Unverified:

```json
{
  "Verification": {
    "id": "fpVq",
    "type": "verification",
    "verification": { "state": "unverified", "verified_by": null, "date": null }
  }
}
```

Verified with an expiry window:

```json
{
  "Verification": {
    "id": "fpVq",
    "type": "verification",
    "verification": {
      "state": "verified",
      "verified_by": {
        "object": "user",
        "id": "01e46064-d5fb-4444-8ecc-ad47d076f804",
        "name": "User Name",
        "avatar_url": null,
        "type": "person",
        "person": {}
      },
      "date": { "start": "2023-08-01T04:00:00.000Z", "end": "2023-10-30T04:00:00.000Z", "time_zone": null }
    }
  }
}
```

#### States

`verified`, `unverified`, `expired` ([page property values](https://developers.notion.com/reference/page-property-values)).

Note `expired` is a **derived** state — the stored data is `state: verified` plus a `date.end` in the past; the system surfaces `expired` once that end passes.

#### Write semantics [API]

`verified_by` is read-only and "auto-set to acting connection"; the field is **ignored on write** ([page property values](https://developers.notion.com/reference/page-property-values)).

#### Configuration & behavior [UI]

From [wikis & verified pages](https://www.notion.com/help/wikis-and-verified-pages):

| Aspect | Detail |
|---|---|
| Where it comes from | Wikis ship with 4 default properties: **Owner** (person), **Last edited date**, **Tags** (multi-select), and **Verification** — "a Verification property which is unique to wikis" |
| Adding to any database | "Select `•••` at the top of the database → `Properties` → `New property`. Select `Verification`. **This will automatically also add an Owner property to the database.**" — Verification is the only property type that **implicitly creates a second property** |
| Who can verify | `Can edit` access or `Full access`; only page owners can initiate verification |
| Expiry | "You can choose whether you want to verify the page until a specific time or indefinitely" — i.e. `date.end` is nullable |
| Notification | "When a page's verification expires, its owner will be notified in their Notion inbox as well as via email" |
| Owner semantics | "By default, whoever creates a page in a wiki becomes the page's owner, but you can change the page owner at any time" |
| Owner limit | The Owner person property exposes the `1 Person` / `No limit` switch |
| Plan gating | Verification on individual database pages and standalone pages outside wikis is **Business/Enterprise only** |
| Workspace roll-up | Settings → `Verified pages` lists all verified pages; searchable and filterable by owner and teamspace |

Page verification for non-wiki databases shipped in [Notion 2.49, March 26, 2025](https://www.notion.com/releases/2025-03-26).

`UNRESOLVED: the exact preset expiry durations offered in the UI (e.g. 1 week / 1 month / 3 months / 6 months / 1 year / custom / never). The help center says only "until a specific time or indefinitely".`

#### Semantics

- **Default:** `{"state": "unverified", "verified_by": null, "date": null}`.
- **Empty:** the unverified state is the empty state.
- **Sort:** `UNRESOLVED.`
- **Filters [API]:** `status` ([filter reference](https://developers.notion.com/reference/post-database-query-filter)).

#### Rendering

Verified pages "display a blue check mark next to their name when they're @-mentioned, and when they're displayed in Notion search results" ([wikis & verified pages](https://www.notion.com/help/wikis-and-verified-pages)) — this is a rare case of a property affecting rendering **outside** the database entirely.

---

### 25. Button

**A UI-only property type. It has no documented API type key and appears nowhere in the API reference.**

#### Existence as a property

"Button — Automate specific actions with one click." ([database properties](https://www.notion.com/help/database-properties))

Button **blocks** and button **properties** are different things ([database button property guide](https://www.notion.com/help/guides/make-work-more-efficient-database-button-property)):
- Button *blocks* live on pages, inserted via `/`.
- Button *properties* are a database column; **each row gets its own button**, and the button's actions are scoped to that row.

#### Actions available to a database button property

Per the [database button property guide](https://www.notion.com/help/guides/make-work-more-efficient-database-button-property), a database button supports four action kinds:

1. **Add a new page to** a database — creates an entry in a chosen database and sets its properties
2. **Edit pages in** a database — modifies properties of specified pages
3. **Show a confirmation** — displays a confirmation dialog before the remaining actions run
4. **Open a page** — opens a specific page

**"This page"** in a button action refers to the current database row the button lives in, letting you edit that row's properties without selecting a target database or filter.

#### Full action list for button BLOCKS

The block form supports a superset ([buttons](https://www.notion.com/help/buttons)):

| Action | Config |
|---|---|
| **Insert blocks** | Blocks to insert; placement: `Above button`, `Below button`, `At top of page`, `At bottom of page` |
| **Add page to** | Target database + property values for the new page |
| **Edit pages in** | Target database, which pages (filter / "This page"), property edits |
| **Send notification to** | Up to **20 people**, or the people in a People property; custom message |
| **Send mail to** | Gmail account required, **paid plans only**. Config: recipient, CC, BCC, subject, message body, display name, reply-to |
| **Send webhook** | HTTP POST to a URL. **Paid plans only** |
| **Show confirmation** | Confirmation screen before executing |
| **Open page or URL** | A Notion page or an external link |
| **Send Slack notification to** | Slack channel + custom message. **Plus / Business / Enterprise only** |
| **Define variables** | Custom variables from mentions and formulas, consumable by later actions |

Constraints ([buttons](https://www.notion.com/help/buttons)):
- Formulas **cannot** be used in: block insertion, page/URL opening, Slack notifications.
- Mentions and formulas work in **actions**, not in triggers.

`UNRESOLVED: which of the 10 block-button actions are actually available on a database button PROPERTY. The dedicated guide names only 4 (add page, edit pages, show confirmation, open page); the buttons page describes 10 for blocks without stating which are property-eligible. This needs empirical verification.`

#### Semantics

- **Not a data-carrying property.** It stores no per-row value; it stores an action script in the schema.
- **Default / empty:** n/a — every row shows the same button.
- **Sort:** not sortable.
- **Filters:** none.
- Chart axis: **explicitly excluded** — buttons cannot be used on chart axes or donut charts ([charts](https://www.notion.com/help/charts)).
- Conditional color source: no.
- **Cannot be commented on** ([database properties](https://www.notion.com/help/database-properties)).
- API: invisible. It is presumably returned as an unsupported property (`null`), consistent with "Unsupported types will be returned with a `null` value" ([page property values](https://developers.notion.com/reference/page-property-values)). `UNRESOLVED: confirm the API representation of a button property in a data source schema.`

#### Rendering

A clickable button rendered in the cell in table view and on cards.

---

### 26. AI-backed properties (AI Autofill)

**This is not a property type.** It is a fill mechanism attached to an existing property.

Verbatim from the research: autofill "is a feature added to existing properties rather than a distinct property type. You access it by hovering over a property and selecting `AI Autofill` (or `Set up AI Autofill`)" ([AI autofill](https://www.notion.com/help/autofill)).

Setup path: "add a property with type `Text` and select `Set up fill with AI`" ([AI autofill](https://www.notion.com/help/autofill)).

#### Built-in autofill modes

- **AI summary** — "gives you an instant summary of each page"
- **AI key info** — "extract important information from pages"
- **AI translation**
- **Keywords**
- **AI custom autofill** — "design your own custom prompt"

([AI autofill](https://www.notion.com/help/autofill), [AI autofill property lesson](https://www.notion.com/help/notion-academy/lesson/ai-autofill-property))

#### Configuration

| Option | Detail |
|---|---|
| Engine | **Basic** or **Custom Agent** |
| Trigger | manual, on page creation, or on page edits |
| Search scope | workspace/web search — **Custom Agent only** |
| Fill scope | restrict to empty cells only. Notion's own prompt-engineering advice: add "Only fill this property if it is empty." |
| Plan / cost | "Basic Autofill is included on Business and Enterprise plans, and does not use Notion credits. Meanwhile, Custom Agent Autofill uses Notion credits because it runs with Custom Agent capabilities (like using richer context and more advanced reasoning)." |

`UNRESOLVED: the exact set of property types that can be AI-autofilled. Documentation demonstrates Text; select / multi-select / number / date / checkbox autofill is plausible and widely reported but I found no authoritative confirmation.`

`UNRESOLVED: whether an AI-filled property's value is stored (materialized) or recomputed, and what the API returns for it. Given it starts as a rich_text property, the stored value is presumably ordinary rich_text — but the "fill" configuration itself has no documented API surface.`

Notes:
- Effectiveness: "It works best when the answer can be generated from the content of the page." ([AI autofill](https://www.notion.com/help/autofill))
- Nothing in the API changelog through mid-2026 mentions AI autofill configuration being exposed.

---

### 27. Per-property universal options

| Option | Layer | Applies to | Source |
|---|---|---|---|
| **Name** | UI + API | all | |
| **Description** | UI + API (`description` string) | all | [property object](https://developers.notion.com/reference/property-object) |
| **Type change** | UI | all except `title` | "click the `⋮⋮` … change the `Property type`, rename it, `Duplicate` or `Delete` it" ([forms](https://www.notion.com/help/forms) / property menu) |
| **Duplicate** | UI | all except presumably `title` | ([database properties](https://www.notion.com/help/database-properties)) |
| **Delete** | UI | all except `title` | ([database properties](https://www.notion.com/help/database-properties)) |
| **Wrap text** | UI, per-property | text-bearing types | "click the name of a database property … select `Wrap text`" ([tables](https://www.notion.com/help/tables)) |
| **Column width** | UI, per-view | all | "hovering over their edges, and dragging right or left" ([tables](https://www.notion.com/help/tables)) |
| **Visibility (show/hide)** | UI, **per view** | all | Settings menu → `Property visibility` → toggle 👁️ per property ([database properties](https://www.notion.com/help/database-properties)) |
| **Order on cards** | UI, per view | all | "drag your properties in the order in which you want them to be displayed" ([boards](https://www.notion.com/help/boards)) |
| **Reorder in schema** | UI | all | Drag by `⋮⋮`, or table `Insert left` / `Insert right` ([database properties](https://www.notion.com/help/database-properties)) |
| **Group into sections** | UI | all | "You can now group, insert, or rename properties right from the property menu" ([Notion 2.52](https://www.notion.com/releases/2025-07-10)) |
| **Comments** | UI | all **except** Name/title, formula, rollup, button, unique ID | ([database properties](https://www.notion.com/help/database-properties)) |
| **Calculations footer** | UI, per view | all | Table footer aggregations |

#### Read-only / computed types

`formula`, `rollup`, `created_time`, `created_by`, `last_edited_time`, `last_edited_by`, `unique_id` are read-only values ([property object](https://developers.notion.com/reference/property-object)). `place` values are "not fully supported" and read as `null`. `verification.verified_by` is read-only within an otherwise-writable value.

#### Property descriptions vs. form descriptions

Note there are **two** description concepts: the property `description` on the schema, and a separate per-question `Description` in Notion Forms — "you can add a `Description` to your question so people can better understand what you're asking about" ([forms](https://www.notion.com/help/forms)). `UNRESOLVED: are these the same stored field or two independent fields?`

#### Table calculations (footer aggregations)

Available functions in the table calculation row ([tables](https://www.notion.com/help/tables)): Count all, Count values, Count unique values, Count empty, Count not empty, Percent empty, Percent not empty, Earliest date, Latest date, Date range, Sum, Average, Median, Min, Max, Range.

Note this is nearly identical to the rollup function list — the same aggregation vocabulary is reused for footer calculations and rollups.

---

### 28. Database page layout (how properties render on a page)

Separate from view rendering, Notion lets you configure how properties appear on the **database page itself** ([layouts](https://www.notion.com/help/layouts)):

- **Heading properties** and **pinned properties** — up to **15 properties** can be pinned/promoted.
- **Property groups and sections**.
- A **details panel**.
- Two structure types: **Simple** and **Tabbed**.
- Options for comment display and **property icon visibility**.

---

### 29. Property type → view capability matrix

#### Board grouping key

Per [boards](https://www.notion.com/help/boards): "your database items will be grouped by a select, person, multi-select, or relation property" — while the same page also states "grouping by relation or formula properties isn't currently supported."

Confirmed grouping keys: **Select, Multi-select, Person**. Status is grouping-capable in practice and is grouping's headline use case per the [status guide](https://www.notion.com/help/guides/status-property-gives-clarity-on-tasks) ("Group by Status").

Confirmed **not** groupable: **Formula**.

`UNRESOLVED: relation (contradictory docs), checkbox, date, number, and the computed timestamp types as board grouping keys.`

**Sub-groups** add a second grouping layer ([boards](https://www.notion.com/help/boards)). Boards support `Hide empty groups` and a `Sort → Manual` for group column order ([status guide](https://www.notion.com/help/guides/status-property-gives-clarity-on-tasks)).

#### Calendar date source

Requires a `Date` property ([calendars](https://www.notion.com/help/calendars)). With multiple date properties, switch via `Layout` → `Show calendar by`. Views: **Monthly** (default) and **Weekly**.

`UNRESOLVED: whether created_time / last_edited_time / formula-date properties are selectable as a calendar source. The calendars page says only "must contain a Date property".`
`UNRESOLVED: whether calendar cards show time-of-day.`

#### Timeline date source

Requires "at least one date property in your database containing a range of dates" ([timelines](https://www.notion.com/help/timelines)). Configured via `Layout` → `Show timeline by`.

Two modes, both toggled in the `Show timeline by` menu:
1. **Separate start and end properties** — "You can choose to have start and end dates as separate properties that dictate how your projects or plotted."
2. **A single date property carrying a range**.

Time-tracking properties like `Last edited` or `Created time` are usable ([timelines](https://www.notion.com/help/timelines)).

Timeline also offers a collapsible **table side-panel** (toggled with `>>` / `<<`) with independent property visibility and calculations, drag-resize of bars, and timeframe scaling from hours to years.

#### Chart axes

Chart types: **Vertical bar, Horizontal bar, Line, Donut, Number** ([charts](https://www.notion.com/help/charts)).

**Cannot be used on X/Y axes or for grouping:** Rollups, Buttons, Unique IDs, Files and media, "Formulas resulting in a list of outputs", and complex formulas built on relations or rollups ([charts](https://www.notion.com/help/charts)). Donut charts carry the same exclusions.

Y-axis supports a specific property, **Count**, or **Sum**, with a **Cumulative** toggle available when showing Count or Sum.

Chart limits: **200 groups and 50 subgroups** at a time. Charts are read-only — you cannot edit entries from chart view; drilldowns are table-only with restricted bulk actions ([charts](https://www.notion.com/help/charts)).

#### Card preview / cover source

Board and gallery cards offer three preview sources ([galleries](https://www.notion.com/help/galleries), [boards](https://www.notion.com/help/boards)):
1. **Page cover** — "Will show the image you chose as your page's cover on your card."
2. **Page content** — "Will show a preview of the first block of the page. If the first block is an image or video, the image or video will show in the preview."
3. **A Files & media property** — "If you have a `Files & media` property in your database, you'll see the name of those properties in this menu."

Plus **Card size** (large / medium / small) and **Fit image**: on = "the entirety of the image will fit within the frame of the card"; off = "the image will be cropped to fill the entire card frame."

#### Map source

Requires a Place property; `Layout` → `Map by` when there are several; 100-item render cap ([maps](https://www.notion.com/help/maps)).

#### Conditional color

Available on views: **Table, Calendar, Timeline, List, Board, Feed** ([database properties](https://www.notion.com/help/database-properties)).

Allowed source properties: **Select, Multi-select, Status, Title, Text, Number, Date, Person, Checkbox, Formulas, Relations, Rollups**.

Notably **excluded**: URL, Email, Phone, Files, Place, Button, Unique ID, and the created/last-edited types.

Behavior notes:
- Settings are **per view**; duplicating a view duplicates its color settings.
- Color applies to the **whole page background**, not individual properties — **except in table view**, where `Apply to` lets you choose the entire row or only the matching property.
- Defaults inherit the property value's own color (a red `P0` colors the page red).
- Requires `Can edit content`, `Can edit`, or `Full access`.

#### View types

Confirmed view types across the docs: **Table, Board, Timeline, Calendar, List, Gallery, Chart, Map, Feed, Form**.

**Feed** is the newest, from [Notion 2.52 (July 2025)](https://www.notion.com/releases/2025-07-10): "Like turning your database into a blog feed! Use it to scroll through status updates, user research, bug reports, and more—then add comments and emoji reactions."

---

### 30. Sort order semantics — consolidated

| Type | Ascending order | Source / status |
|---|---|---|
| Title, Text, URL, Email, Phone | Alphabetical | [views, filters and sorts](https://www.notion.com/help/views-filters-and-sorts) |
| Number, Unique ID | Numeric | [views, filters and sorts](https://www.notion.com/help/views-filters-and-sorts) |
| Select | **Manual option order** (drag to reorder) | [views, filters and sorts](https://www.notion.com/help/views-filters-and-sorts) |
| Multi-select | Manual option order, mechanism for multi-value rows | `UNRESOLVED` |
| Status | Group order + option order? | `UNRESOLVED` |
| Date, Created time, Last edited time | Chronological; range key start-or-end | Partially `UNRESOLVED` |
| Checkbox | Checked vs unchecked first | `UNRESOLVED` |
| Person, Created by, Last edited by | — | `UNRESOLVED` |
| Relation | — | `UNRESOLVED` |
| Rollup | **Only sortable when the result is numeric** | [relations & rollups](https://www.notion.com/help/relations-and-rollups) — explicit |
| Formula | By result type | Inferred |
| Files, Place, Button, Verification | — | `UNRESOLVED` / likely unsortable |

**Empty-value ordering is undocumented for every type.** The help center says only "Different properties sort by different logic, depending on their value type" ([views, filters and sorts](https://www.notion.com/help/views-filters-and-sorts)).

`UNRESOLVED: where do empty/null values land in ascending and descending sorts? This is one of the most consequential undocumented behaviors for a clone, since Postgres NULLS FIRST/LAST must be chosen deliberately.`

Multi-sort: multiple sorts apply in order and are reorderable by dragging ([views, filters and sorts](https://www.notion.com/help/views-filters-and-sorts)).

---

### 31. Consolidated limits table

| Limit | Value | Source |
|---|---|---|
| Properties per database | **500** | [database properties](https://www.notion.com/help/database-properties) |
| Title properties per data source | Exactly **1** | [property object](https://developers.notion.com/reference/property-object) |
| Rich text `text.content` | 2,000 chars | [request limits](https://developers.notion.com/reference/request-limits) |
| Rich text `text.link.url` | 2,000 chars | [request limits](https://developers.notion.com/reference/request-limits) |
| Equation expression | 1,000 chars | [request limits](https://developers.notion.com/reference/request-limits) |
| URL property | 2,000 chars | [request limits](https://developers.notion.com/reference/request-limits) |
| Email property | 200 chars | [request limits](https://developers.notion.com/reference/request-limits) |
| Phone property | 200 chars | [request limits](https://developers.notion.com/reference/request-limits) |
| Multi-select values per request | 100 | [request limits](https://developers.notion.com/reference/request-limits) |
| Relation pages per request | 100 | [request limits](https://developers.notion.com/reference/request-limits) |
| People per request | 100 | [request limits](https://developers.notion.com/reference/request-limits) |
| Inline references returned (title/rich_text/relation/people/formula/rollup) | 25, then paginate | [page property values](https://developers.notion.com/reference/page-property-values) |
| Block elements per payload | 1,000 | [request limits](https://developers.notion.com/reference/request-limits) |
| Payload size | 500 KB | [request limits](https://developers.notion.com/reference/request-limits) |
| File upload, free plan | 5 MB per file | [images, files & media](https://www.notion.com/help/images-files-and-media) |
| File upload, paid plans | 5 GB per file | [images, files & media](https://www.notion.com/help/images-files-and-media) |
| Map view items rendered | 100 | [maps](https://www.notion.com/help/maps) |
| Chart groups / subgroups | 200 / 50 | [charts](https://www.notion.com/help/charts) |
| Button "Send notification to" recipients | 20 | [buttons](https://www.notion.com/help/buttons) |
| Pinned/heading properties on a page layout | 15 | [layouts](https://www.notion.com/help/layouts) |
| Select/multi-select option count | **No documented cap** — "You can add as many unique tags to these menus as you want" | [database properties](https://www.notion.com/help/database-properties) |
| API rate limit | ~3 req/sec average per connection, with bursts | [request limits](https://developers.notion.com/reference/request-limits) |

---

### 32. Findings that contradict common assumptions

1. **Status is no longer API read-only.** As of 2026-06-22 status properties are creatable and updatable via the API, and status options accept a `group` field. Groups remain UI-only for rename/reorder. ([changelog](https://developers.notion.com/page/changelog))
2. **`description` is an API field on the property object**, not UI-only as often assumed. ([property object](https://developers.notion.com/reference/property-object))
3. **Place exists in the schema API but its values are unreadable** — reading returns `null`. What Place stores internally is undocumented. ([property object](https://developers.notion.com/reference/property-object))
4. **Button and AI-autofill have no API surface at all.** Button isn't in the API reference; AI autofill isn't a property type.
5. **AI properties are not a type.** They are a fill configuration on an ordinary (Text) property. ([AI autofill](https://www.notion.com/help/autofill))
6. **Person properties have a 1-vs-unlimited cardinality setting** — a real config option most people don't know about. ([wikis & verified pages](https://www.notion.com/help/wikis-and-verified-pages))
7. **Adding a Verification property silently adds an Owner property too.** ([wikis & verified pages](https://www.notion.com/help/wikis-and-verified-pages))
8. **Unique IDs consume numbers for deleted pages** — the counter is monotonic and gaps are permanent. ([unique ID](https://www.notion.com/help/unique-id))
9. **Checkbox has no null state** — no `is_empty` filter exists for it. ([filter reference](https://developers.notion.com/reference/post-database-query-filter))
10. **Date filters have `this_week` but no `this_month` / `this_year`.** ([filter reference](https://developers.notion.com/reference/post-database-query-filter))
11. **The Number `format` enum has 40 values**, and the shorter list on the property-object page is truncated — the property-schema-object page is authoritative.
12. **The rollup function enum has 24 values including `count_per_group` and `percent_per_group`**, which are missing from the property-object page's list.
13. **Status can be displayed as a checkbox**, collapsing three groups to a boolean where everything in To-do reads as unchecked. ([status guide](https://www.notion.com/help/guides/status-property-gives-clarity-on-tasks))
14. **No `last_visited_time` property type is documented** anywhere in current Notion docs.
15. **Formula 2.0's type system (8 types incl. lists, person, page) is strictly richer than the API's 5** (`boolean`, `date`, `number`, `string`, `unsupported`).
16. **The boards help page contradicts itself on relation grouping** — it both lists relation as a grouping property and says relation grouping is unsupported.
17. **Databases and data sources are separate entities** since API `2025-09-03`; property schemas belong to data sources.

---

### 33. UNRESOLVED list (consolidated)

**Highest impact for a clone:**

1. `UNRESOLVED: What does the Place property actually store — lat/lng, a provider place id, a formatted address, or all three? API returns null; no help doc specifies.`
2. `UNRESOLVED: Where do empty/null values sort in ascending and descending order, per property type? Completely undocumented and directly determines NULLS FIRST/LAST choices.`
3. `UNRESOLVED: How does Status sort — by group then option order within group, or by a flat option order?`
4. `UNRESOLVED: How does Multi-select sort a row with several selected options?`
5. `UNRESOLVED: Which board grouping keys are legal? The boards page contradicts itself on relation; checkbox, date, and number are unaddressed.`
6. `UNRESOLVED: Which button actions are available on a database button PROPERTY (guide names 4; the block form has 10)?`
7. `UNRESOLVED: The enumerated list of Date display formats and time formats in the property's "Date format & timezone" panel.`
8. `UNRESOLVED: Reminder configuration options for date properties (offsets, time-of-day for all-day dates).`

**Property-specific:**

9. `UNRESOLVED: Does a "Last visited time" property type exist today? Absent from both the API reference and the help center table.`
10. `UNRESOLVED: Does the number bar/ring have explicit min/max controls, or only "Divide by"?`
11. `UNRESOLVED: Does the number property have a precision / decimal-places setting?`
12. `UNRESOLVED: Can Status group colors be changed in the UI? The API exposes a group color but no help doc describes a picker.`
13. `UNRESOLVED: Is there a "default option" setting for a Status (or Select) property applied to newly created rows?`
14. `UNRESOLVED: Can the title property be duplicated? (Would violate the one-title invariant.)`
15. `UNRESOLVED: Maximum number of files per Files & media cell.`
16. `UNRESOLVED: Are Files & Place properties sortable at all? Is Place filterable at all?`
17. `UNRESOLVED: Does Notion validate email syntax on the Email property, or accept arbitrary text?`
18. `UNRESOLVED: How is a tagged workspace GROUP represented in the API people array? User objects document only person and bot.`
19. `UNRESOLVED: Is there a generic "default to current user" setting on Person properties (outside the wiki Owner template)?`
20. `UNRESOLVED: Total stored relation cardinality cap (the 100 is a per-request cap).`
21. `UNRESOLVED: Deleting one half of a two-way relation — does the mirror get deleted or converted to one-way?`
22. `UNRESOLVED: UI names for the rollup functions count_per_group / percent_per_group, and where they surface.`
23. `UNRESOLVED: Do numeric rollups get the Bar/Ring "Show as" treatment? Release notes name only number and formula properties.`
24. `UNRESOLVED: Does the 1,000-character equation cap apply to formula property expressions?`
25. `UNRESOLVED: What happens to a row's unique ID when the page moves to another database? Can one data source hold two unique_id properties with independent counters?`
26. `UNRESOLVED: The exact preset expiry durations offered by the Verification property UI.`
27. `UNRESOLVED: Which mutations bump last_edited_time — property edits only, or page body block edits too?`
28. `UNRESOLVED: Which property types can be AI-autofilled? Only Text is documented.`
29. `UNRESOLVED: Is an AI-autofilled value materialized or recomputed, and what does the API return for it?`
30. `UNRESOLVED: The API representation of a Button property in a data source schema (presumably an unsupported null).`
31. `UNRESOLVED: Which map/geocoding provider backs the Place property.`
32. `UNRESOLVED: How Place renders in table / board / gallery cells (as opposed to map view).`
33. `UNRESOLVED: Are calendar sources restricted to true Date properties, or can created_time / last_edited_time / formula-dates drive a calendar? (Timeline explicitly allows them.)`
34. `UNRESOLVED: Do calendar cards display time-of-day?`
35. `UNRESOLVED: Is the property "description" the same stored field as the Forms per-question "Description"?`
36. `UNRESOLVED: Is created_time eligible as a conditional-color source? The allowed list names "Date" generically.`

---

### 34. Source index

**API reference**
- [Data source properties (property object)](https://developers.notion.com/reference/property-object)
- [Page properties (property values)](https://developers.notion.com/reference/page-property-values)
- [Property schema object](https://developers.notion.com/reference/property-schema-object)
- [Data source object](https://developers.notion.com/reference/data-source)
- [Filter database entries](https://developers.notion.com/reference/post-database-query-filter)
- [Request limits](https://developers.notion.com/reference/request-limits)
- [Working with files and media](https://developers.notion.com/docs/working-with-files-and-media)
- [Upgrade guide 2025-09-03](https://developers.notion.com/docs/upgrade-guide-2025-09-03)
- [Upgrade FAQs 2025-09-03](https://developers.notion.com/docs/upgrade-faqs-2025-09-03)
- [API changelog](https://developers.notion.com/page/changelog)
- [Dates with times and timezones in date filters](https://developers.notion.com/changelog/dates-with-times-and-timezones-are-now-supported-on-database-date-filters)

**Help center**
- [Database properties](https://www.notion.com/help/database-properties)
- [Relations & rollups](https://www.notion.com/help/relations-and-rollups)
- [Unique ID property](https://www.notion.com/help/unique-id)
- [Wikis & verified pages](https://www.notion.com/help/wikis-and-verified-pages)
- [Buttons](https://www.notion.com/help/buttons)
- [Database button property guide](https://www.notion.com/help/guides/make-work-more-efficient-database-button-property)
- [AI autofill for databases](https://www.notion.com/help/autofill)
- [AI Autofill property (Notion Academy)](https://www.notion.com/help/notion-academy/lesson/ai-autofill-property)
- [Map view](https://www.notion.com/help/maps)
- [Board view (Kanban)](https://www.notion.com/help/boards)
- [Gallery view](https://www.notion.com/help/galleries)
- [Calendar view](https://www.notion.com/help/calendars)
- [Timeline view](https://www.notion.com/help/timelines)
- [Chart view](https://www.notion.com/help/charts)
- [Table view](https://www.notion.com/help/tables)
- [Views, filters, sorts & groups](https://www.notion.com/help/views-filters-and-sorts)
- [Customize database layouts](https://www.notion.com/help/layouts)
- [Customize your database settings](https://www.notion.com/help/customize-your-database)
- [Status property guide](https://www.notion.com/help/guides/status-property-gives-clarity-on-tasks)
- [Intro to formulas](https://www.notion.com/help/formulas)
- [Formula syntax & functions](https://www.notion.com/help/formula-syntax)
- [Formulas 2.0: what's changed](https://www.notion.com/help/guides/new-formulas-whats-changed)
- [Images, files & media](https://www.notion.com/help/images-files-and-media)
- [Forms](https://www.notion.com/help/forms)
- [Time zones](https://www.notion.com/help/time-zones)
- [Notion Calendar settings](https://www.notion.com/help/notion-calendar-settings)

**Release notes**
- [Notion 3.1 — Nov 17, 2025 (map view + place property)](https://www.notion.com/releases/2025-11-17)
- [Notion 2.52 — Jul 10, 2025 (feed view, property menu redesign)](https://www.notion.com/releases/2025-07-10)
- [Notion 2.49 — Mar 26, 2025 (page verification for non-wiki databases)](https://www.notion.com/releases/2025-03-26)
- [Aug 11, 2022 (number bar/ring progress)](https://www.notion.com/releases/2022-08-11)
- [Notion 2.17 — Jun 29, 2022 (status property, person 1-limit)](https://www.notion.com/releases/2022-06-29)
- [Notion 3.5 — May 13, 2026 (developer platform)](https://www.notion.com/releases/2026-05-13)

## G. View types and view configuration


**Research date:** 2026-08-08
**Purpose:** Formal specification source for a from-scratch clone of Notion databases. Pure feature inventory of Notion as it exists today. No implementation guidance.

**Primary sources used**
- Notion Help Center (`notion.com/help/*`) — the UX surface of view configuration.
- Notion Developer Docs, [Working with views](https://developers.notion.com/guides/data-apis/working-with-views) — **this is the single highest-value source in this document.** As of API version `2025-09-03`+ Notion exposes views as first-class API resources with a fully documented `configuration` discriminated union. It gives exact enum values for settings the Help Center describes only in prose (zoom levels, card layouts, chart sort modes, group-by variants). Where the Help Center and the API disagree in vocabulary, both are recorded.

> **Reading note on naming.** Notion's UI labels and its API field names are frequently different words for the same setting (UI "Card size" = API `cover_size`; UI "Fit image" = API `cover_aspect`). Both are given throughout. Where only one exists, that is stated.

---

### 0. Critical context: the database → data source → view model (changed 2025)

This is a **structural change from older Notion** and it governs everything below. Do not model views as children of a table.

- "Every database is made up of at least one data source. A data source is a set of pages in a database." ([Data sources & linked databases](https://www.notion.com/help/data-sources-and-linked-databases))
- A **database** is a container. It holds one or more **data sources**. A **view** is scoped to exactly **one** data source within a database. ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views))
- A single database can therefore display **multiple different data sources** through different view tabs. "For the first time, you can use views of different data sources inside one block." ([Databases reimagined](https://www.notion.com/help/guides/databases-reimagined-whats-changed))
- Data sources are classified inside a database as **Sources** (originating here) vs **Linked** (originating in another database). Managed via the slider icon → `Manage data sources` → `Add data source` / `Link existing data source`. ([Data sources & linked databases](https://www.notion.com/help/data-sources-and-linked-databases))
- Creating a database auto-provisions **one data source** and **one Table view named "Default view"**. ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views))
- **A database must always have at least one view.** Deleting the last remaining view is rejected with a `validation_error`. ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views))

The API view object:

```json
{
  "object": "view",
  "id": "uuid",
  "parent": { "type": "database_id", "database_id": "uuid" },
  "data_source_id": "uuid | null",
  "name": "High priority items",
  "type": "table",
  "filter": { ... } | null,
  "sorts": [ ... ] | null,
  "quick_filters": { "Status": { "status": { "equals": "In progress" } } } | null,
  "configuration": { "type": "table", ... } | null,
  "created_time": "...", "last_edited_time": "...",
  "created_by": { ... }, "last_edited_by": { ... },
  "url": "...",
  "dashboard_view_id": "uuid"
}
```
([Working with views](https://developers.notion.com/guides/data-apis/working-with-views))

`data_source_id` is `null` for dashboard views, "since dashboards contain multiple widget views, each with their own data source." `dashboard_view_id` is present only on widget views.

---

### 1. Complete list of view types

**There are 11.** The task's starting list of 7 was incomplete by four.

| # | View type | API `type` | Help doc | Notes |
|---|---|---|---|---|
| 1 | Table | `table` | [/help/tables](https://www.notion.com/help/tables) | Default view type |
| 2 | Board (Kanban) | `board` | [/help/boards](https://www.notion.com/help/boards) | |
| 3 | List | `list` | [/help/lists](https://www.notion.com/help/lists) | |
| 4 | Calendar | `calendar` | [/help/calendars](https://www.notion.com/help/calendars) | |
| 5 | Timeline | `timeline` | [/help/timelines](https://www.notion.com/help/timelines) | |
| 6 | Gallery | `gallery` | [/help/galleries](https://www.notion.com/help/galleries) | |
| 7 | **Chart** | `chart` | [/help/charts](https://www.notion.com/help/charts) | Free plan = 1 chart; paid = unlimited |
| 8 | **Feed** | *(not documented in the views API guide — see UNRESOLVED)* | [/help/feeds](https://www.notion.com/help/feeds) | Stacked-card social/blog feed |
| 9 | **Map** | `map` | [/help/maps](https://www.notion.com/help/maps) | Requires a `Place` property |
| 10 | **Form** | `form` | [/help/forms](https://www.notion.com/help/forms) | Not a data-display layout |
| 11 | **Dashboard** | `dashboard` | [/help/dashboards](https://www.notion.com/help/dashboards) | Business/Enterprise only; composes other views as widgets |

The API guide enumerates `type` as: `"table"`, `"board"`, `"list"`, `"calendar"`, `"timeline"`, `"gallery"`, `"form"`, `"chart"`, `"map"`, `"dashboard"` — **10 values, omitting `feed`.** Feed's existence is confirmed by its own Help Center article and by the conditional-color support list ("Table, Calendar, Timeline, List, Board, Feed" — [Database properties](https://www.notion.com/help/database-properties)).

#### 1.1 Notion's own "Feature support by view type" matrix

Reproduced verbatim from [Working with views](https://developers.notion.com/guides/data-apis/working-with-views). This is the closest thing to a formal spec Notion publishes.

| Feature | Table | Board | Calendar | Timeline | Gallery | List | Map | Form | Chart | Dashboard |
|---|---|---|---|---|---|---|---|---|---|---|
| `properties` | Yes | Yes | Yes | Yes | Yes | Yes | Optional | – | – | – |
| `group_by` | Optional | **Required** | – | – | – | – | – | – | – | – |
| `sub_group_by` | – | Optional | – | – | – | – | – | – | – | – |
| `subtasks` | Optional | – | – | – | – | – | – | – | – | – |
| `cover` | – | Optional | – | – | Optional | – | – | – | – | – |
| `cover_size` / `cover_aspect` | – | Optional | – | – | Optional | – | – | – | – | – |
| `card_layout` | – | Optional | – | – | Optional | – | – | – | – | – |
| `date_property_id` | – | – | **Required** | **Required** | – | – | – | – | – | – |
| `end_date_property_id` | – | – | – | Optional | – | – | – | – | – | – |
| `view_range` / `show_weekends` | – | – | Optional | – | – | – | – | – | – | – |
| `preference` / `arrows_by` | – | – | – | Optional | – | – | – | – | – | – |
| `show_table` / `table_properties` | – | – | – | Optional | – | – | – | – | – | – |
| `wrap_cells` / `frozen_column_index` | Optional | – | – | – | – | – | – | – | – | – |
| `show_vertical_lines` | Optional | – | – | – | – | – | – | – | – | – |
| `height` | – | – | – | – | – | – | Optional | – | Optional | – |
| `map_by` | – | – | – | – | – | – | Optional | – | – | – |
| `is_form_closed` | – | – | – | – | – | – | – | Optional | – | – |
| `anonymous_submissions` | – | – | – | – | – | – | – | Optional | – | – |
| `submission_permissions` | – | – | – | – | – | – | – | Optional | – | – |
| `chart_type` | – | – | – | – | – | – | – | – | **Required** | – |
| `x_axis` / `y_axis` | – | – | – | – | – | – | – | – | Optional | – |
| `value` | – | – | – | – | – | – | – | – | Optional | – |
| `rows` | – | – | – | – | – | – | – | – | – | Yes (read-only) |

**Note the negative space.** Board has **no** `hide_empty_groups` at the view-config level (it lives inside the `group_by` object). Board/Gallery have **no** "show count" toggle in the API. Table has **no** row-height field, no row-number toggle, no "show database title" toggle — see §12.

---

### 2. Options common to (nearly) all views

#### 2.1 View identity & tabs

| Option | Behaviour | Source |
|---|---|---|
| View name | Free text. API `name`. Click the view tab name to rename. | [views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts) |
| View icon | Views have an icon. Tab rendering is controlled by `Display as` → `Icon only`, `Text only`, or both. | [views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts) |
| **`Display as` is per-user, not per-view** | "Only you will see this change. It won't affect other people's views, and it only applies to the database where you made the update." | [views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts) |
| Reorder views | Drag view tabs. Overflow collapses into a `{#} more...` menu. API: `position` = `{ "type": "start" }` or `{ "type": "after_view", "view_id": "..." }`. | [views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts), [API](https://developers.notion.com/guides/data-apis/working-with-views) |
| Sidebar nesting | Views of a **full-page** database appear nested under it in the sidebar, prefixed with `•`. | [views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts) |
| View tab menu actions | rename, **duplicate**, delete, **copy its link**, edit its components. | [views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts) |
| `Copy link to view` | Under View settings. Produces a direct link to that view. API exposes `url` on the view object. | [views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts) |

#### 2.2 The View settings menu

Opened via the slider/settings icon at the top right of the database. Section header is literally **`View settings`** and contains: `Layout`, `Property visibility`, `Filter`, `Sort`, `Group`, `Sub-group`, `Conditional color`, `Copy link to view`. ([views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts), [Database properties](https://www.notion.com/help/database-properties))

**Per-view vs per-database is an explicit, documented boundary:**

> "Each database view has its own settings. Settings applied to one database view won't be applied across all other database views automatically." ([views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts))

> "Database settings apply to your entire database, not just particular views." ([Customize your database](https://www.notion.com/help/customize-your-database))

**`Database settings`** (whole-database, NOT per view):

| Setting | Behaviour |
|---|---|
| `Lock database` | "people can still enter data, but they can't change views or properties" |
| `Edit properties` | Search, `New property`, edit/duplicate/delete individual properties |
| `Automations` | Database automations |
| `Sub-items` or `Sub-tasks` | On/off (label depends on whether it is a Task database) |
| `Dependencies` | On/off |
| `Sprints` | Task databases only |
| `Connections` | Connect apps to the database |
| `Customize page layout` | A layout applied to **all** pages in the database |
| `Turn into Tasks` / `Undo Task database` | Convert to/from a Task database |
| `Manage data sources` | Sources / Linked management |

([Customize your database](https://www.notion.com/help/customize-your-database), [Data sources & linked databases](https://www.notion.com/help/data-sources-and-linked-databases))

Requires `Can edit` access or higher.

#### 2.3 `Open pages in`

Exactly three options, exact names:

| Option | Behaviour |
|---|---|
| `Side peek` | "Open pages on the right side of the database. The rest of the database view continues to be interactive on the left." |
| `Center peek` | "Open pages in a focused, center modal." |
| `Full page` | "Open pages as full pages directly." |

Defaults, verbatim: "**Table, Board, List & Timeline layouts will open pages in side peek by default. Gallery & Calendar layouts will open pages in center peek by default.**" ([views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts))

Path: settings menu → `Layout` → `Open pages in`.

> **Spec gap:** `open_pages_in` does **not** appear anywhere in the API view `configuration` schema. It is a UI-only setting. Defaults for Chart, Map, Feed, Form, Dashboard are undocumented (see UNRESOLVED).

#### 2.4 Filters

Two tiers plus quick filters.

**Simple filter** — settings menu → `Filter` under `View settings` → choose property → set criteria.

**`Save for everyone`** — the critical permission semantic:
> "You can choose to `Save for everyone` if you want the filter to be applied for everyone in the database view. If you want the filter to apply only for you, don't select this option." ([views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts))

So **every view has both a shared filter state and a per-user local filter state.** Unsaved filters are local to the viewer.

**Advanced filters (filter groups)**
- Combine `AND` and `OR` logic via filter groups.
- **"These can be nested up to three layers deep!"** — a hard, documented depth limit. ([views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts))
- Path: `Filter` → `Add advanced filter`.
- Promote a simple filter: click the filter → `•••` → `Add to advanced filter`.
- Delete: click the filter → `•••` → `Delete filter`.

**Quick filters** (introduced with the databases redesign)
- A map of property-level filters "that appear in the view's filter bar. Keys are property names or IDs, values are filter conditions (same shape as property filters, without the `property` field)." API field `quick_filters`. ([API](https://developers.notion.com/guides/data-apis/working-with-views))
- Design intent: "Instead of creating a new view for yourself to find that one small piece of information, you can add a 'quick filter' that is viewable only by you until you hit 'Save for everyone'." ([Databases reimagined](https://www.notion.com/help/guides/databases-reimagined-whats-changed))
- Consequence: "Filter groups… are no longer the default. These filter groups still exist under the 'advanced' filter option."

**Sub-item interaction:** "If you have sub-items turned on for your database, your visibility settings for sub-items will also impact your filtered results." The API models this as `subtasks.filter_scope` = `"parents"` | `"parents_and_subitems"` | `"subitems"`.

#### 2.5 Sorts

- Multiple sorts, applied in order; reorder by dragging `⋮⋮`.
- Ascending / descending. API `sorts` array uses `{ property, direction: "ascending" | "descending" }`.
- Also carries `Save for everyone`.
- Delete: `X` next to the sort.
- **Sort semantics differ by property type** — this is spec-relevant:
  - Text properties (`Name`, `Text`) sort **alphabetically**.
  - `Number` sorts **numerically**.
  - **`Select` and `Multi-select` sort by a user-defined option order**, not alphabetically: "you get to define what sorting order means. Click on the property, then drag options up or down to set the sort order."
  ([views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts))

#### 2.6 Group & Sub-group

`Group` and `Sub-group` are separate entries in `View settings`. Sub-group = "a second layer of grouping within your existing groups."

Group controls in the UI:
- `👁️` per group to hide/show it. Hidden groups list separately.
- Sort groups "manually or by the options provided (alphabetical, ascending, and more)".
- `Hide empty groups` toggle.
- `Remove grouping`.
([views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts))

**The API's group-by schema is a typed discriminated union — this is the most precise spec available:**

Common fields on every variant:

| Field | Type | Description |
|---|---|---|
| `type` | string | Required. The property type being grouped. |
| `property_id` | string | Required. |
| `sort` | object | Required. `{ "type": "manual" \| "ascending" \| "descending" }` |
| `hide_empty_groups` | boolean | Whether to hide groups with no items. |

Per-type extras:

| `type` value(s) | Extra required | Extra optional |
|---|---|---|
| `select`, `multi_select` | — | — |
| `status` | `group_by`: `"group"` (by status group: To Do/In Progress/Done) or `"option"` (by individual option) | — |
| `person`, `created_by`, `last_edited_by` | — | — |
| `relation` | — | — |
| `date`, `created_time`, `last_edited_time` | `group_by`: `"relative"` \| `"day"` \| `"week"` \| `"month"` \| `"year"` | `start_day_of_week`: `0` (Sunday) or `1` (Monday) |
| `text`, `title`, `url`, `email`, `phone_number` | `group_by`: `"exact"` or `"alphabet_prefix"` (first letter) | — |
| `number` | — | `range_start`, `range_end`, `range_size` (≥1) for bucket grouping |
| `checkbox` | — | — |
| `formula` | `group_by`: a **nested** group-by object typed by the formula's result type | — |

Formula nesting: the nested object omits `property_id` (inherited). Supported formula result types and their nested fields:

| Result type | Nested `group_by` fields |
|---|---|
| date | `type`, `group_by` (`"relative"`\|`"day"`\|`"week"`\|`"month"`\|`"year"`), `sort`, optional `start_day_of_week` |
| text | `type`, `group_by` (`"exact"`\|`"alphabet_prefix"`), `sort` |
| number | `type`, `sort`, optional `range_start`, `range_end`, `range_size` |
| checkbox | `type`, `sort` |

([Working with views](https://developers.notion.com/guides/data-apis/working-with-views))

> ⚠️ **Documented contradiction.** The board Help Center FAQ says: "Any way to group by a relation or formula property? **Not currently 😓** It's a legit use case though, and definitely something we want to support in the future." ([/help/boards](https://www.notion.com/help/boards)) — but the API group-by table explicitly supports `relation` and `formula`. The FAQ is almost certainly stale. Treat relation and formula grouping as **supported**, and treat that FAQ as out of date. Flagged in UNRESOLVED.

#### 2.7 Property visibility & ordering

Universal across Table, Board, Calendar, Timeline, Gallery, List, Feed, Map: settings → `Property visibility` → `👁️` to show/hide, `⋮⋮` to reorder. ([boards](https://www.notion.com/help/boards), [galleries](https://www.notion.com/help/galleries), [calendars](https://www.notion.com/help/calendars), [timelines](https://www.notion.com/help/timelines), [lists](https://www.notion.com/help/lists), [feeds](https://www.notion.com/help/feeds))

API `properties[]` entry — the per-property, per-view display record:

| Field | Type | Description |
|---|---|---|
| `property_id` | string | **Required.** Accepts a property ID *or* a property name; name is resolved to ID. "If the string matches both a property ID and a different property's name, the ID match takes priority." |
| `visible` | boolean | Visible in this view. |
| `width` | integer (≥0) | Column width in pixels. **Table views only.** |
| `wrap` | boolean | Wrap content in this cell/card. **Per-property.** |
| `status_show_as` | `"select"` \| `"checkbox"` | How to render status properties. |
| `card_property_width_mode` | `"full_line"` \| `"inline"` | Property width mode in **compact** card layouts (board/gallery). |
| `date_format` | `"full"` \| `"short"` \| `"month_day_year"` \| `"day_month_year"` \| `"year_month_day"` \| `"relative"` | Display format for date properties. |
| `time_format` | `"12_hour"` \| `"24_hour"` \| `"hidden"` | Time display for date properties. |

**Per-view date/time formatting is a real, per-property, per-view setting.** That is easy to miss and is not described anywhere in the Help Center.

**The title property cannot be hidden or deleted.** "You can't remove the `Name` property because that's the core information contained. You can, however, rename that property." ([timelines](https://www.notion.com/help/timelines), [tables](https://www.notion.com/help/tables))
Exception, gallery only: "You can also hide the name of any card in your gallery… In the `Properties` menu, switch off `Name`." ([galleries](https://www.notion.com/help/galleries)) — so gallery cards can suppress the title *display*.

#### 2.8 Calculations row

Available in **Table**, **Board** (per column header), and **Timeline** (when the table panel is open). Full menu, exact names:

| Calculation | Meaning |
|---|---|
| `Count all` | Total number of rows in the column |
| `Count values` | Number of property values contained |
| `Count unique values` | Unique values, omitting duplicates |
| `Count empty` | Rows without a value |
| `Count not empty` | Rows with the column filled |
| `Percent empty` | % of rows without the property filled |
| `Percent not empty` | % of rows with the property filled |
| `Earliest date` | Oldest date (for date-ish properties) |
| `Latest date` | Newest date |
| `Date range` | Time gap between oldest and newest |
| `Sum` | **Number properties only** |
| `Average` | Number properties only |
| `Median` | Number properties only |
| `Min` | Number properties only |
| `Max` | Number properties only |
| `Range` | Max minus min. Number properties only |

"Depending on the type of property you're running a calculation on, you'll see some or all of the following." Invoked by clicking a property → hover `Calculate`. ([tables](https://www.notion.com/help/tables), [boards](https://www.notion.com/help/boards), [timelines](https://www.notion.com/help/timelines))

Board default: the gray number beside each column heading defaults to **card count** and is switchable to any of the above.

Calculations are **not** exposed in the API view `configuration` schema — UI-only persistence. (UNRESOLVED.)

#### 2.9 Search within a view

"Databases that contain **at least three pages** will also be searchable… select `🔍` at the top of the database and enter a query. As you type, the database will only show pages that match your query. **Database search looks at database page titles and properties.**" ([views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts))

The three-page threshold is a real documented behaviour.

#### 2.10 `Load limit`

Per-view setting under `Layout`. "Depending on how many projects you have… you may want to only see 10 project pages at a time, or many more. Open the settings menu at the top right of your database → `Layout`. Select `Load limit` and select a number of pages." ([timelines](https://www.notion.com/help/timelines))

The Help Center does not enumerate the values. Third-party sources report the options as **10 / 25 / 50 / 100 pages** ([Gridfiti](https://gridfiti.com/notion-slow/)) — treat as unverified against a primary source.

API-side, view queries paginate with `page_size` (examples use `50`) and a `next_cursor`/`has_more` pair, with `total_count` returned on query creation. Cached query result sets expire "after a short TTL (approximately **15 minutes**)". ([API](https://developers.notion.com/guides/data-apis/working-with-views))

#### 2.11 Conditional color (per-view)

A `View settings` entry — **this is view-scoped presentation, not a property setting**, despite living in the properties help doc.

Setup: slider icon → `View settings` → `Conditional color` → `New color setting` → pick property → set a rule via the dropdown next to the property name → select a **Page background color**. `Add another` adds further conditions. `🗑️` deletes one. ([Database properties](https://www.notion.com/help/database-properties))

Semantics:
- "If applicable, your database pages will match the color of the property values associated with them by default." (e.g. P0 red / P1 orange from the select option colors.)
- **Table view only:** an `Apply to` menu chooses "the entire row or just the property that your rule applies to."
- "Conditional color applies at the **page level**; at this time, you can't have specific properties colored in a page or card. Color applies to a page's entire background." (Except the table `Apply to` case above.)
- "Conditional color settings are created **at the view level**… when you duplicate a view, its color settings will also be duplicated."
- Permission: requires `Can edit content`, `Can edit`, or `Full access`. Viewers/commenters see colors but cannot edit settings.

**Supported views:** Table, Calendar, Timeline, List, Board, Feed. (Notably **not** Gallery, Chart, Map, Form, Dashboard.)

**Supported properties:** Select, Multi-select, Status, Title, Text, Number, Date, Person, Checkbox, Formulas, Relations, Rollups.

#### 2.12 Sub-items / sub-tasks (affects table rendering)

Enabled at the **database** level (`Sub-items` / `Sub-tasks`), configured per **table view**:

```json
{ "property_id": "RELATION_PROPERTY_ID",
  "display_mode": "show",
  "filter_scope": "parents_and_subitems",
  "toggle_column_id": "title" }
```

| Field | Values |
|---|---|
| `display_mode` | `"show"` (hierarchical with toggles) · `"hidden"` (parents with a count) · `"flattened"` (sub-items with a parent indicator) · `"disabled"` (no sub-item rendering) |
| `filter_scope` | `"parents"` · `"parents_and_subitems"` · `"subitems"` |
| `toggle_column_id` | Property ID of the column showing the expand/collapse toggle |

The UI equivalent lives at settings → `More settings` → `Sub-items`/`Sub-tasks` → `Show as` → e.g. `Flattened list`. ([charts](https://www.notion.com/help/charts), [API](https://developers.notion.com/guides/data-apis/working-with-views))

Note `subtasks: null` **resets to defaults** (which may still show sub-items); `{ "display_mode": "disabled" }` is required to actually turn it off.

---

### 3. Table view

**What it is:** "A table is the classic database view… Each row opens up into its own page, and can contain whatever properties you want." Rows = pages, columns = properties. ([tables](https://www.notion.com/help/tables))

#### 3.1 Layout / configuration options

| Option | UI name | API field | Values | Notes |
|---|---|---|---|---|
| Wrap all cells | (via property menu `Wrap text`; global equivalent exists in API) | `wrap_cells` | boolean | View-wide wrap toggle |
| Wrap one column | `Wrap text` on the column menu | `properties[].wrap` | boolean | Per-property override |
| Freeze columns | `Freeze up to column` / `Unfreeze column` | `frozen_column_index` | integer ≥ 0 | "Number of columns frozen from the left." Frozen columns "stay visible on the left side no matter where you scroll" |
| Vertical grid lines | *(no documented UI label)* | `show_vertical_lines` | boolean | "Whether to show vertical grid lines between columns" |
| Column width | drag the column edge | `properties[].width` | integer px | Table views only |
| Column order | drag the heading, or `Properties` panel `⋮⋮` | order of `properties[]` | — | |
| Column visibility | `Property visibility` → `👁️` | `properties[].visible` | boolean | |
| Grouping | `Group` | `group_by` | object \| null | Table grouping is **optional** |
| Sub-items | database setting + view config | `subtasks` | object \| null | §2.12 |
| Open pages in | `Layout` → `Open pages in` | *(not in API)* | side/center/full | Defaults to **side peek** |
| Calculations | per-column `Calculate` | *(not in API)* | see §2.8 | |
| Conditional color `Apply to` | `Apply to` | *(not in API)* | entire row \| just the property | **Table-only capability** |
| Row reorder | drag `⋮⋮` on the row | — | — | Manual order |
| Load limit | `Layout` → `Load limit` | *(not in API)* | 10/25/50/100 (unverified) | |

#### 3.2 Table behaviours

- **Bulk edit:** hover a row → checkbox; hover the `Name` property → checkbox selects **all** rows; then edit any property across the selection. ([tables](https://www.notion.com/help/tables))
- **Row actions (right-click):** `Delete`, `Duplicate`, `Copy link`, `Rename`, `Move to`, `Edit property`. ([intro-to-databases](https://www.notion.com/help/intro-to-databases))
- **Opening rows:** "In tables, hover over your first column and click the `OPEN` button that appears."
- **Adding rows:** blue `New` button top-right, or `+ New` at the bottom.
- The title/`Name` column cannot be deleted but **can be dragged left or right** to reorder — Notion does **not** pin the title column to position 0. ([tables](https://www.notion.com/help/tables))
- **Simple tables** are a separate, non-database block type ("display plain text visually without database functionalities").

#### 3.3 What Table view does NOT have

Explicitly checked and **not found in any Notion source**: row-height presets (short/medium/tall), a "show row numbers" toggle, a "show database title" toggle within the view layout panel, or a horizontal/vertical scroll mode selector. These exist in Airtable, not Notion. See UNRESOLVED for the residual doubt.

---

### 4. Board view (Kanban)

**What it is:** "Boards are helpful for showing items in a database as they move through stages of a process, or grouped by property." Cards in columns. ([boards](https://www.notion.com/help/boards))

#### 4.1 Group-by — the required axis

- `group_by` is **Required** for board views (API matrix).
- **Auto-selection on creation:** "By default, your board will be grouped by a **status** property if your database has one. Otherwise, your database items will be grouped by a **select, person, multi-select, or relation** property that's in your database. **If none of these properties exist, a new status property will be created in your database for you.**" ([boards](https://www.notion.com/help/boards))

That last clause is important: **board view never fails for lack of a property — it mutates the schema to create one.**

- Legal group-by property types: per the API union — `select`, `multi_select`, `status`, `person`, `created_by`, `last_edited_by`, `relation`, `date`, `created_time`, `last_edited_time`, `text`, `title`, `url`, `email`, `phone_number`, `number` (bucketed), `checkbox`, `formula`. (See §2.6 and the stale-FAQ warning.)
- `status` grouping has a unique extra: `group_by: "group"` groups by the **status group** (To Do / In Progress / Done) vs `"option"` by individual option.

#### 4.2 Sub-groups

Settings → `Sub-groups` → pick property. "In board view, you can add a second layer of groups, called sub-groups. This lets you further organize your database items within a group." API `sub_group_by`, same shape as `group_by`, nullable. ([boards](https://www.notion.com/help/boards))

#### 4.3 Full board option matrix

| Option | UI name | API field | Values |
|---|---|---|---|
| Group by | `Group` | `group_by` | required; typed union §2.6 |
| Sub-group by | `Sub-groups` | `sub_group_by` | object \| null |
| Group order | drag column headings | `group_by.sort.type` | `manual` \| `ascending` \| `descending` |
| Hide empty groups | `Hide empty groups` | `group_by.hide_empty_groups` | boolean |
| Hide a specific group | `•••` on heading → `Hide group` | *(not in API)* | hidden groups listed under Group settings |
| Colour columns | `Group` → toggle **`Color columns`** | *(not in API)* | boolean; **on by default** |
| Card size | `Layout` → `Card size` | `cover_size` | `small` \| `medium` \| `large` |
| Card preview | `Layout` → `Card preview` | `cover` | `Page cover` / `Page content` / a named `Files & media` property → API `{"type": "page_cover" \| "page_content" \| "property", "property_id"}` |
| Fit image | `Fit image` toggle | `cover_aspect` | on = `"contain"` (whole image fits, `Reposition` on hover) · off = `"cover"` (cropped to fill) |
| Card layout density | *(no documented UI label)* | `card_layout` | `"list"` (full cards) \| `"compact"` (condensed) |
| Card property width | *(no documented UI label)* | `properties[].card_property_width_mode` | `"full_line"` \| `"inline"` — compact layouts only |
| Visible card properties | `Property visibility` | `properties[].visible` + order | |
| Column calculation | gray number beside heading | *(not in API)* | defaults to card count; any §2.8 calculation |
| Open pages in | `Layout` → `Open pages in` | — | defaults to **side peek** |

**Note:** `Card preview` explicitly differs between board and gallery. Board: "Will show a preview of **the page's content**. If you have images on your page, the card will display **whichever image comes first**." Gallery: "Will show a preview of **the first block of the page**. If the first block is an image or video, the image or video will show in the preview." ([boards](https://www.notion.com/help/boards) vs [galleries](https://www.notion.com/help/galleries))

#### 4.4 Drag semantics

- "To rearrange columns, click and hold on a heading, then drag left or right." → mutates the **group option order** on the property (or the view's manual group sort).
- "To move cards up and down or between columns, click, hold, and drag." → dragging a card into a column **sets the grouped property's value on that page**. Notion does not state this explicitly in prose, but it is the documented Kanban behaviour ("move tasks from one status to another as you make progress"). ([views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts))
- Dragging into a **hidden** column is supported: "You can drag any completed tasks into that hidden archive by clicking and dragging your cards into that tag under `Hidden Columns`." ([boards](https://www.notion.com/help/boards)) — so hidden groups remain valid drop targets.

#### 4.5 Backlog / uncategorized column

**UNRESOLVED.** No Notion documentation found describing an explicit "No Status"/"Uncategorized"/"Backlog" column for cards whose grouped property is empty. The `hide_empty_groups` flag implies empty-valued groups render by default, but the empty-*value* bucket is not documented.

#### 4.6 Adding cards

`+ New` at the bottom (same as table/list); blue `New` button top-right.

---

### 5. Timeline view

**What it is:** "For anyone who needs to visualize their projects plotted chronologically — whether it's hours, years, or anything in between." A Gantt-style bar chart over a date axis, with an optional table panel on the left. ([timelines](https://www.notion.com/help/timelines))

#### 5.1 Requirement

> "Timelines only work if you have **at least one date property** in your database containing a **range of dates**. Otherwise **nothing will be plotted**." ([timelines](https://www.notion.com/help/timelines))

Unlike board (which creates a property), timeline **silently renders empty**. `date_property_id` is **Required** in the API config.

#### 5.2 Date configuration — `Show timeline by`

Path: settings → `Layout` → `Show timeline by`.

Two mutually exclusive modes:
1. **Single date property carrying a range** — "the date range you want to plot exist in the same date property."
2. **Separate start and end properties** — "You can choose to have start and end dates as **separate properties** that dictate how your projects are plotted. You can turn that on in this menu."

API: `date_property_id` (start, required) + `end_date_property_id` (string | null; "Pass null to clear"). So mode 2 = `end_date_property_id` set; mode 1 = it is null.

If the database has multiple date properties, `Show timeline by` selects which one drives the plot.

#### 5.3 Zoom levels — the exact list

The Help Center only says "from hours all the way up to years." The API gives the enumeration, and it is **8 levels**:

`"hours"` · `"day"` · `"week"` · `"bi_week"` · `"month"` · `"quarter"` · `"year"` · `"5_years"`

Stored in `preference.zoom_level`. ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views))

Also in `preference`: `center_timestamp` (integer, ms) — "Timestamp in milliseconds to center the timeline on." So **scroll position is persisted state**, not ephemeral.

UI: "On the right side of your timeline, to the left of `Today`, you'll see a dropdown menu with a unit of time."

#### 5.4 Full timeline option matrix

| Option | UI name | API field | Values |
|---|---|---|---|
| Start date property | `Show timeline by` | `date_property_id` | **required** |
| End date property | `Show timeline by` → separate dates | `end_date_property_id` | string \| null |
| Zoom / timeframe | dropdown left of `Today` | `preference.zoom_level` | 8 values above |
| Scroll position | (implicit) | `preference.center_timestamp` | ms epoch |
| Show/hide table panel | `>>` / `<<` on the left | `show_table` | boolean \| null |
| Table panel columns | `Layout` → `Table properties` | `table_properties[]` | separate `properties[]` array from the bar labels |
| Bar properties | `Property visibility` | `properties[]` | what shows on the timeline items |
| Dependency arrows | *(no documented UI label)* | `arrows_by.property_id` | **a relation property ID**, or null to disable |
| Colour items by property | *(no documented UI label)* | `color_by` | boolean \| null |
| Load limit | `Layout` → `Load limit` | *(not in API)* | number of pages |
| Open pages in | `Layout` → `Open pages in` | — | defaults to **side peek** |
| Calculations | in the table panel | — | §2.8 |
| Conditional color | `View settings` → `Conditional color` | — | supported |

**Dependencies:** the timeline help doc never mentions dependency arrows, but the API `arrows_by` field does, and dependencies are a database-level toggle (`Database settings` → `Dependencies`, see [Customize your database](https://www.notion.com/help/customize-your-database) and [/help/tasks-and-dependencies](https://www.notion.com/help/tasks-and-dependencies)). The wiring is: enable `Dependencies` on the database → point `arrows_by.property_id` at the relation property → arrows render on the timeline.

#### 5.5 Timeline interactions

- **Resize a bar:** "Hover over the left or right edge of any project… drag and drop each edge." Date indicators appear as guides. This **writes back to the date property**.
- **Overflow arrows:** "small arrows appear on each row of your timeline to indicate that a project has occurred before or after your current view, or included scope before or after. You can click on these arrows to jump right to the project."
- **`Today` marker:** "you can jump to the current day on your timeline. Just click `Today` on the right side of the timeline."
- **Reordering:** "click and drag any timeline item up or down." If the table panel is open, "you can click and drag columns in that table to reorder them."
- **Grouping on timeline:** not documented. The API matrix shows `group_by` as unsupported for timeline (dash in the table). Treat timeline as **ungroupable**.

---

### 6. Calendar view

**What it is:** "Calendars let you visualize how database items connect to certain dates. Use one when you want a bird's-eye view for important launch dates, multi-day events, or even projects spanning multiple months." ([calendars](https://www.notion.com/help/calendars))

#### 6.1 Requirement

> "To use one, your database must contain a `Date` property."

`date_property_id` is **Required** in the API config. Behaviour when no Date property exists is **UNRESOLVED** (unlike board, no documented auto-creation).

#### 6.2 Option matrix

| Option | UI name | API field | Values |
|---|---|---|---|
| Which date drives it | `Layout` → **`Show calendar by`** | `date_property_id` | any date property; multiple date properties give "separate calendars for each of them" |
| Month vs week layout | `Layout` → **`Show calendar as`** → `Week` | `view_range` | `"week"` \| `"month"` \| null |
| Show weekends | *(no documented UI label)* | `show_weekends` | boolean \| null |
| Visible properties | `Property visibility` | `properties[]` | shows on the event cards |
| Open pages in | `Layout` → `Open pages in` | — | defaults to **center peek** |
| Load limit | `Layout` → `Load limit` | — | |
| Conditional color | `View settings` → `Conditional color` | — | supported |

Note the two similarly named settings: **`Show calendar by`** (which property) vs **`Show calendar as`** (month/week). Distinct menu items.

`show_weekends` is API-only in the sources found; no Help Center article names the UI toggle.

#### 6.3 Navigation & rendering

- Navigation: `<` / `>` arrows around `Today` at the top right.
- Infinite scroll **forward only**: "Scroll down infinitely and you'll see the months advance at the top left of your calendar. (**You can't scroll up to go back in time.**)"
- **Range persistence:** "Your calendar will remember which date range you were viewing last. Next time you open the page, that's the range you'll see." — per-user viewport persistence.
- **Multi-day events:** "Have your card span multiple days by hovering over its right or left edge, clicking and dragging to expand it in either direction." So a date range renders as a single spanning bar and is directly editable.
- **Drag to reschedule:** "Click and hold any card to drag and drop it to any other day."
- **Create on a day:** "Click the `+` icon that appears when you hover over any day. This creates a new event on that day." ([intro-to-databases](https://www.notion.com/help/intro-to-databases))
- **First day of week** is a **user/workspace preference**, not a view setting: `Settings` → `Preferences` → `Language & Time` → `Start week on Monday`. Default is region-derived. ([calendars](https://www.notion.com/help/calendars)) The API mirrors this only inside date group-by (`start_day_of_week`: 0/1).
- **No daily or yearly calendar layout on desktop.** "There's a daily view on **mobile** that you can access by tapping on any date in your calendar, or you can use our Timeline view." So: desktop calendar = month | week only.
- **Time display within a day:** not documented. UNRESOLVED.
- **Default date format:** "Any way to set a default date format for the date property? **Not at the moment.**" — but note §2.7: the API *does* carry per-view `date_format`/`time_format` on properties, so this FAQ may be stale.

#### 6.4 Notion Calendar integration

Databases can be surfaced in the separate **Notion Calendar** app, and "you can even update your database dates directly from Notion Calendar." ([calendars](https://www.notion.com/help/calendars), [timelines](https://www.notion.com/help/timelines))
Google Calendar: only a **view-only embed**, from the same email address as the Notion account.

---

### 7. List view

**What it is:** "Lists are simple and minimalist database views. They're ideal for storing notes, articles, and documents that don't need too many properties. Every item in a list is a page that can be opened with one click." ([lists](https://www.notion.com/help/lists))

The most configuration-poor layout. API config is just:

```json
{ "type": "list", "properties": [ ... ] }
```

| Option | UI name | Notes |
|---|---|---|
| Visible properties + order | `Property visibility` | "In lists, all the properties assigned to an item appear at the **far right**." Fixed right-alignment |
| Open pages in | `Layout` → `Open pages in` | defaults to **side peek** |
| Grouping | `Group` | not in the API list config, but list is in the conditional-color list and generally supports View settings — **UNRESOLVED whether list supports group_by** |
| Conditional color | supported | per [Database properties](https://www.notion.com/help/database-properties) |

Opening items: "In lists, just click on the title of the item." Adding: `+ New` at the bottom.

**What's minimal about it:** no cards, no covers, no card size, no image preview, no calculations documented, no layout variants. Title on the left, properties on the right, one row per page.

---

### 8. Gallery view

**What it is:** "Gallery view is the best way to display databases with visual components, like mood boards, office directories, virtual recipe boxes." ([galleries](https://www.notion.com/help/galleries))

Structurally identical to Board minus grouping. API config is Board's minus `group_by`/`sub_group_by`.

| Option | UI name | API field | Values |
|---|---|---|---|
| Card size | `Layout` → `Card size` | `cover_size` | `small` \| `medium` \| `large` |
| Card preview | `Layout` → `Card preview` | `cover` | `Page cover` · `Page content` ("a preview of **the first block** of the page. If the first block is an image or video, the image or video will show") · any `Files & media` property → `{"type": "page_cover"\|"page_content"\|"property"}` |
| Fit image | `Fit image` | `cover_aspect` | on = `"contain"` + hover `Reposition` to drag the crop · off = `"cover"` (cropped to fill the frame) |
| Card layout density | *(no documented UI label)* | `card_layout` | `"list"` \| `"compact"` |
| Card property width | — | `properties[].card_property_width_mode` | `"full_line"` \| `"inline"` |
| Visible properties + order | `Property visibility` | `properties[]` | |
| **Hide the title** | `Properties` → switch off `Name` | `properties[]` (title `visible: false`) | Gallery-specific affordance for pure image grids |
| Card order | drag left/right/up/down | — | manual |
| Open pages in | `Layout` → `Open pages in` | — | defaults to **center peek** |

Adding: "Click the `+ New` button in the empty card at the bottom of your gallery." ([intro-to-databases](https://www.notion.com/help/intro-to-databases))

**Gallery is NOT in the conditional-color supported list** — Table, Calendar, Timeline, List, Board, Feed only. That is a genuine asymmetry with Board.

---

### 9. Chart view

**What it is:** "Charts help visualize the vast amount of information in your database… You can even put charts from multiple databases into a Notion page to create a powerful dashboard." ([charts](https://www.notion.com/help/charts))

#### 9.1 Chart types

**Five**, exact UI names: `Vertical bar chart`, `Horizontal bar chart`, `Line chart`, `Donut chart`, `Number chart`.

API `chart_type` values map as: `"column"` (vertical bars) · `"bar"` (horizontal bars) · `"line"` · `"donut"` · `"number"` (single value display). **Required.**

> ⚠️ The API's `"bar"` means *horizontal* and `"column"` means *vertical* — the opposite of the intuitive reading.

Creation: `/chart` slash command → pick type → "Link an existing database, or select `New chart` to create a new database." Or `+` next to view tabs → `Chart`.

#### 9.2 Two data modes

The API documents a distinction the Help Center never mentions:

- **Grouped data** — aggregate values by grouping on a property. Uses `x_axis` (a group-by object) + `y_axis` (an aggregation object).
- **Results** — use raw property values directly. Uses `x_axis_property_id` + `y_axis_property_id`. `x_axis`/`y_axis` are null in this mode.

#### 9.3 X axis (bar & line)

| Option | UI name | Behaviour |
|---|---|---|
| Property | `What to show` | "Choose the property that should be associated with your X axis." Uses the same group-by shape as §2.6 |
| Sorting | `Sort by` | e.g. ascending status. API `sort`: `"manual"` \| `"x_ascending"` \| `"x_descending"` \| `"y_ascending"` \| `"y_descending"` |
| Group visibility | `👁️` under `Visible groups` | hidden entries move to `Hidden groups` |
| `Omit zero values` | toggle | Confusingly worded in Notion's own docs — see below |
| Hide empty groups | — | API `hide_empty_groups` boolean |

**On `Omit zero values`:** Notion's help text is self-contradictory. It says "you can toggle `Omit zero values` **off** if you don't want the paused status shown in your chart. If you toggle **on** `Omit zero values`, you'll see **all** of the status options in your chart, even if there are no tasks." That reads backwards from the option's name. Recorded verbatim; flagged in UNRESOLVED. The API's `hide_empty_groups` ("Whether to hide groups with no data on the x-axis") is the unambiguous form.

#### 9.4 Y axis (bar & line)

| Option | UI name | Behaviour |
|---|---|---|
| Value | `What to show` | "Choose the property… You can also choose to show `Count`" |
| Series / colour-by | `Group by` | "Choose the property that you want to group your Y axis by. You can also choose `None`." API: `stack_by` (a group-by object; column/bar/line only) |
| `Omit zero values` | toggle | as above |
| `Cumulative` | toggle | "You'll see this option **if your chart is showing `Count` or `Sum` and your X axis property is sorted in ascending order.**" Running total vs point-in-time |

#### 9.5 Y-axis aggregation functions

`y_axis` and `value` take an aggregation object `{ "aggregator": ..., "property_id": ... }`. `"count"` counts all rows and needs no `property_id`; **all other operators require one.**

Full list of 20:
`count` · `count_values` · `sum` · `average` · `median` · `min` · `max` · `range` · `unique` · `empty` · `not_empty` · `percent_empty` · `percent_not_empty` · `checked` · `unchecked` · `percent_checked` · `percent_unchecked` · `earliest_date` · `latest_date` · `date_range`

([Working with views](https://developers.notion.com/guides/data-apis/working-with-views))

Note this is a **superset** of the table calculations row (§2.8) — it adds the checkbox aggregators `checked`/`unchecked`/`percent_checked`/`percent_unchecked` and `unique`.

#### 9.6 Donut chart

| Option | UI name | API |
|---|---|---|
| Value | `Data` → `What to show` | `y_axis` aggregation |
| Slices | `Data` → **`Each slice represents`** | `x_axis` group-by |
| Sorting + visibility | `Sort by`, `👁️` on `Visible groups` / `Hidden groups` | `sort` |
| Slice labels | `Data labels` (donut: "select this to **choose how** you want your data points to be labeled") | `donut_labels`: `"none"` \| `"value"` \| `"name"` \| `"name_and_value"` |
| Centre value | `Show value in center` | *(mapped to donut style)* |
| Legend | `Legend` | `legend_position` |

#### 9.7 Style options (`Style` section)

| UI name | API field | Values |
|---|---|---|
| `Color` | `color_theme` | `gray` · `blue` · `yellow` · `green` · `purple` · `teal` · `orange` · `pink` · `red` · `auto` · `colorful` |
| `Height` | `height` | `small` · `medium` · `large` · `extra_large` ("Choose from `Small` to `Extra large`") |
| `Grid line` | `grid_lines` | `none` · `horizontal` · `vertical` · `both` |
| `Axis name` | `axis_labels` | `none` · `x_axis` · `y_axis` · `both` |
| `Data labels` | `show_data_labels` | boolean (bar/line); donut uses `donut_labels` |
| `Smooth line` | `smooth_line` | boolean — line only, "curved instead of angular" |
| `Gradient area` | `hide_line_fill_area` (inverted) | boolean — "fill the space under your line chart with a gradient" |
| `Show value in center` | *(donut)* | boolean |
| `Color by value` | `color_by_value` | boolean. **"Only visible for bar and donut charts whose color is not `Auto` or `Colorful`."** Gradient shading: higher value = darker |
| `Legend` | `legend_position` | `off` · `bottom` · `side` — line or donut |

**API-only style fields with no documented UI label:**

| Field | Values | Meaning |
|---|---|---|
| `group_style` | `"normal"` (stacks values) · `"percent"` (normalizes to 100%) · `"side_by_side"` | **This is the stacking control** — bar/column only |
| `y_axis_min` / `y_axis_max` | number \| null | Custom axis bounds |
| `reference_lines` | array \| null | Horizontal target lines |
| `caption` | string \| null | Text below the chart |
| `hide_title` | boolean | Number charts only |
| `cumulative` | boolean | Line |

**Reference line object:**

| Field | Type | Required |
|---|---|---|
| `id` | string | auto-generated if omitted |
| `value` | number | **yes** — y-axis value where the line is drawn |
| `label` | string | **yes** |
| `color` | `gray`·`lightgray`·`brown`·`yellow`·`orange`·`green`·`blue`·`purple`·`pink`·`red` | **yes** |
| `dash_style` | `"solid"` \| `"dash"` | **yes** |

#### 9.8 Interaction & filters

- Hover elements for labels.
- **Drilldown:** "click into a specific part of that chart to see the data points within it." Drilldowns "currently only appear as **table views**." Save one via `•••` → `Save as view in` → pick a page.
- **In a drilldown you cannot:** select multiple rows for bulk actions, freeze columns, "perform calculations or aggregations like `Count` and `Percent`", or add new database pages.
- **Legend click hides groups.**
- Filters/sorts apply as on any view; charts additionally have the axis-level `Visible groups`/`Hidden groups` mechanism which is *separate from* view filters.
- **Charts are read-only for data:** "At this time, you can't edit database entries from chart view. Use or create another view to edit your data."

#### 9.9 Export

`Save chart as...` → customize background → `Copy as PNG`, `Download PNG`, or `Download SVG`. Not available on Android. Paid plans can omit the background, which "will also remove the **Made with Notion** watermark."

#### 9.10 Chart limits

- **"Charts can only display up to 200 groups and 50 subgroups at a time (for example, 200 days on the X-axis)."**
- Axes "won't be able to show **rollups, buttons, unique IDs, files and media, or formulas resulting in a list of outputs**." Donut adds: "won't be able to show rollups, buttons, unique IDs, files and media, and certain formulas."
- Sub-items must be set to `Flattened list` to be reflected in a chart.
- **Free plan: one chart. Paid plans: unlimited.** Deleting the free chart frees the slot. A free-plan user downloading a multi-chart template sees only one chart.

---

### 10. Feed view

**What it is:** "Feed view displays database pages as a **linear, stacked cards** format, like a blog or social media site… great for team updates, project status sharing, or any other company communications." ([feeds](https://www.notion.com/help/feeds))

Capabilities called out:
- Scroll and browse content seamlessly.
- **Comment on any post directly.**
- **Track views on their posts.** (View-count tracking is unique to Feed among the layouts.)

Creation: `/Feed view`, or `+` at the **top left** of the database → `Feed`. (Note: the feed doc says "top left"; every other view doc says the `+` is next to the database/view name.)

| Option | UI name | Notes |
|---|---|---|
| Visible properties + order | `Property visibility` → `👁️` | The **only** documented configuration option |
| Conditional color | supported | per [Database properties](https://www.notion.com/help/database-properties) |

Feed has the thinnest documentation of any view type and **no API `configuration` schema at all**. Card size, preview image source, and open-pages-in behaviour are all UNRESOLVED.

---

### 11. Map view

**What it is:** "Map view lets you visualize database items on an **interactive map**." ([maps](https://www.notion.com/help/maps))

#### 11.1 Requirement — the `Place` property

- Map view requires a **`Place`** property (a distinct property type, added via `Add property` → `Place`).
- **Auto-creation:** "If you don't already have a place property, **one will be created for you** when you create a map view." (Same pattern as board's status property.)
- Place values come from "granting access to your current location, entering the name of a location, or entering an address."
- Geocoding is third-party: "address search relies on a third-party provider that processes your query. As a result, data quality and coverage may vary by region."
- Converting a text property to a place property "may need… clean up [of] those addresses."

#### 11.2 Option matrix

| Option | UI name | API field | Values |
|---|---|---|---|
| Which place property | `Layout` → **`Map by`** | `map_by` | place property ID, or null |
| Map height | *(no documented UI label)* | `height` | `small` · `medium` · `large` · `extra_large` |
| Visible properties | `Property visibility` | `properties[]` | "Property visibility on **map pin cards**" |

Read-only response field `map_by_property_name` carries the display name.

#### 11.3 Behaviour & limits

- **"Up to 100 items can be shown in map view at one time."** Hard cap. Notion's own workaround advice: "Try narrowing down your list using filters, or splitting items across additional views."
- Click a pin → opens the corresponding database page.
- Zoom and drag to explore.
- **Filtering/sorting place properties is text-based:** "You can filter by text contained in the place's name or address, and sort alphabetically."
- No distance calculation: "Can I calculate the distance between two places? **Not at this time.**"
- A common failure mode Notion documents: a database ends up with *two* place properties (one auto-created, one added later) and the map plots the wrong one.
- Map is **not** in the conditional-color supported list.

---

### 12. Form view

**What it is:** a data-*entry* surface, not a data-*display* layout. It is a view type (`type: "form"`) but has no `properties` array and cannot group/sort/filter data. ([forms](https://www.notion.com/help/forms))

#### 12.1 Configuration

| Option | API field | Values |
|---|---|---|
| Closed for submissions | `is_form_closed` | boolean \| null. UI: sharing setting `No access` — "which you can select if you'd like to close your form and stop accepting new responses" |
| Anonymous responses | `anonymous_submissions` | boolean \| null. UI: toggle `Anonymous responses`. Forms shared as "Anyone on the web with link" are **automatically anonymous** |
| Post-submit permission for the respondent | `submission_permissions` | `none` · `comment_only` · `reader` · `read_and_write` · `editor` \| null. UI: `Access to submission` → e.g. `Can view` (see responses), `Full access` (edit responses + update permissions on the page) |

Form builder settings (UI-only, no API schema found):
- `Form settings` → `Submit screen`: submit button `Color` and `Text`, `Confirmation title`, `Confirmation body`, and an option to receive an email copy of each submission.
- Per-question: "Show options as a **list view** or a **dropdown** if your question is multiple choice."
- `Preview` button.

#### 12.2 Form-specific constraints

- Auto-creates a `Respondent` property to capture respondent names. (Elsewhere the doc says to create a `Created by` property for this — both statements appear.)
- **"Forms can only be added to the original database that contains the data source."** If your database's data source appears under `Linked`, the `Form` view type will not be offered — you must add the form in the owning database. ([Data sources & linked databases](https://www.notion.com/help/data-sources-and-linked-databases))
- "By default, form responses will be stored in a **Table view** of your database named `Responses`."
- **"You can't export a Form view of a database."** Export from Table view instead.
- Changing sharing settings requires `Full access`; copying the URL requires `View` access.
- Workspace-level kill switch: `Settings` → `Security` disables web-published forms (and Notion Sites).

---

### 13. Dashboard view

**What it is:** "Dashboard views turn any database into an at-a-glance control center. Instead of switching between multiple views, you can arrange **widgets** like tables, boards, calendars, charts, and timelines into a single layout." ([dashboards](https://www.notion.com/help/dashboards))

**Availability: Business and Enterprise plans only.**

This is the only **composite** view type: it contains other views rather than rendering data itself. `data_source_id` is `null` on a dashboard view.

#### 13.1 Structure

```json
{ "type": "dashboard",
  "rows": [ { "id": "row-1",
              "widgets": [ { "id": "w1", "view_id": "VIEW_ID", "width": 6, "row_index": 0 } ],
              "height": 400 } ] }
```

| Field | Meaning |
|---|---|
| `rows[].height` | Fixed row height **in pixels** |
| `widgets[].view_id` | The collection view rendered by this widget |
| `widgets[].width` | Width in a **12-column grid** (1–12). 12 = full width |
| `widgets[].row_index` | 0-based row index; widgets in a row share it |

**Dashboard `configuration` is read-only via the API.** "The layout structure is managed by creating and deleting widget views via the `view_id` parameter on the create endpoint." Widget views carry `dashboard_view_id` pointing at their parent dashboard.

#### 13.2 Limits

- **Up to 4 widgets per row.**
- **Up to 12 widgets total.**
- **"Dashboard views cannot be nested — you cannot create a dashboard widget inside another dashboard."**
- Notion's own performance advice: "avoid adding multiple dashboard views to the same page."

#### 13.3 Two modes

| Mode | What you can do |
|---|---|
| `View mode` | Open pages from widgets · use visible filters, sorts, and groups inside a widget · interact with items based on permissions (update a status or date) |
| `Edit mode` | Add, remove, and rearrange widgets · adjust row heights · change which database view each widget displays |

You start in `Edit mode` when creating. Requires **edit access to the database** to change layout; view access allows `View mode` only.

#### 13.4 Global filters

A genuinely distinct concept:
- Filter icon → **`Filter multiple sources`** → select a property and criteria.
- "Global filters **only affect widgets whose underlying views include the property you're filtering**."
- Multiple global filters, on different properties, are allowed.
- They work **across multiple data sources**, provided widgets share the relevant properties.

#### 13.5 Widget management

- `+` on a row or at the bottom to add. Choose an **existing** view in the database or **create a new** view for this dashboard.
- Right-click a widget (or click its title) for its actions menu: `Duplicate` ("a copy with the same view settings and layout"), `Delete`.
- Resize: drag between two widgets (widths) or between two rows (heights).
- **Important coupling:** "Changes to the underlying view may also appear anywhere else that view is used, depending on your workspace settings." Widgets reference views; they do not own copies.
- Dashboard filters/sorts applied in `View mode` are **not saved by default** — "stored locally unless you select **'Save for everybody'** and have edit permissions."
- Creation: `+ Add a view` / `+ Add a new view` → `Dashboard`; or `/dash` slash command; or ask Notion Agent to generate one.

---

### 14. Linked views of a database

Two related-but-distinct mechanisms exist. Do not conflate them.

#### 14.1 "Linked view of database" block

Creation flows:
- "hit `/` and choose `Linked view of database`" or type `/linked` then Enter, then search for the database to link. ([optimize-database-load-times](https://www.notion.com/help/optimize-database-load-times-and-performance))
- "After selecting the database, you can either **copy an already existing view** of your database, or **create a brand new view**." ([Databases reimagined](https://www.notion.com/help/guides/databases-reimagined-whats-changed))

API equivalent — the `create_database` parameter on `POST /v1/views`:
> "creates a new database container on the target page with a single view over the specified data source — similar to inserting a 'linked view of database' in the Notion UI. This differs from `POST /v1/databases`, which creates a full standalone database with its own schema, data source, and default view. With `create_database`, **the view points to an existing data source owned by another database, so no new schema is created.**" ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views))

`create_database` accepts `parent` (required, must be `{ "type": "page_id", ... }`) and `position` (optional, `{ "type": "after_block", "block_id": "..." }`; the block must be a direct child of the parent page; defaults to appending at the end).

**All view types are supported with `create_database`, including form views and dashboard views.**

#### 14.2 What is shared vs per-linked-view

This is the load-bearing answer:

| Aspect | Shared with source? |
|---|---|
| **Views, filters, sorts, groups created in the linked instance** | **NO.** "When interacting with a linked data source, the views, filters, sorts, and groups you create and delete **will not affect the views on the original database**." |
| **Data source title, properties, pages** | **YES.** "when you edit the data source's title, properties, or pages those edits **will be reflected in the original data source**." |
| **Access level** | Inherited. "every linked data source in a database will respect the access level of the original database." |
| **Per-source permissions** | Not possible. "You can't set a different level of access for each source in your database." |

([Data sources & linked databases](https://www.notion.com/help/data-sources-and-linked-databases))

**So: schema and data are shared; view configuration is not.** Filters do NOT carry over from the source unless you explicitly chose to copy a view at creation time — and even then the copy is thereafter independent.

**Sharing caveat:** "I tried sharing a page that contains a database with a linked data source, but the recipient wasn't able to see it. → Make sure that the person you've shared with has access to the **original** database."

**Permission escape hatch worth noting:** users with only `Can edit content` on a database cannot add/edit views, properties, filters, or sorts there — but "Users with `Can edit content` access **will still be able to create linked databases and edit views, sorts, and filters in that linked database**." ([intro-to-databases](https://www.notion.com/help/intro-to-databases))

#### 14.3 Discovering linked views

API: `GET /v1/views?data_source_id=...` "lists all views that reference a given data source (collection), **including linked views on other pages across the workspace**." Results are permission-filtered: "Views on pages the connection cannot access are excluded."

#### 14.4 Moving a data source

When a data source is moved (`Manage data sources` → `•••` → `Move to`):
- Into another database → it becomes a data source of that database.
- Into a page → it becomes a database on that page.
- "You can choose to move all your views over to the new destination, or keep all of the existing views where they are. **Existing views that don't get moved along with the data source will become linked views.** In your destination, you'll have a new table view of the data source."
- Requires **`Full access`** (moving), while `Can edit` is enough to *manage* sources.

---

### 15. Inline vs full-page databases

| | Full-page database | Inline database |
|---|---|---|
| Sidebar | "appear just like any other page in your sidebar"; its **views appear nested beneath it** with a `•` prefix | "will appear as a **subpage** of the page it's in" |
| Chrome | Always visible | "Controls and menus for your inline database are **hidden until you hover over it**" |
| Expand | — | `⤡` (also written `⤢`) at the top right expands to full page |
| Block handle | — | `⋮⋮` on hover gives `Delete`, `Duplicate`, move, copy link, `Turn into inline` |
| Lock | `•••` at the top → `Lock database` | — |
| Duplicate | `•••` top right → `Duplicate` → `Duplicate with content` / `Duplicate without content` | hover → `⋮⋮` → `Duplicate` → same two options |

**Conversion, both directions** (identical text repeated across every view help doc):
- Full-page → inline: "Drag the full-page database from your sidebar into another page. It will become a sub-page of that page. Open the parent page, click the `⋮⋮` button next to the database sub-page, and select **`Turn into inline`**."
- Inline → full-page: "drag an inline database block into your sidebar as a top-level page."

([intro-to-databases](https://www.notion.com/help/intro-to-databases), [tables](https://www.notion.com/help/tables), [boards](https://www.notion.com/help/boards), et al.)

API: `is_inline` boolean on database creation. ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views))

**Performance guidance:** "avoid having lots of inline databases, like dashboards, in high-traffic pages… When using a single linked database, **only one database view is open at a time**, and therefore only that one database is listening for updates." ([optimize-database-load-times](https://www.notion.com/help/optimize-database-load-times-and-performance))

---

### 16. Locking

**There is exactly one lock, at the database level.** The Help Center calls it both `Lock database` and (in a different section) "Lock views" — same toggle.

| Aspect | Detail |
|---|---|
| Where | `•••` at the very top right → `Lock database` toggle. Also listed under `Database settings`. |
| Scope | Whole database, all views. **Not per-view.** |
| What it prevents | "prevent anyone from changing **properties and views** in your database" · "they can't change **views, properties, or values of `Select` and `Multi-select` properties**" |
| What it allows | "everyone on the page (including you) will only be able to **edit the data the database contains**" · "Anyone will be able to edit the pages in the database" |
| Indicator | "when a database is locked, you'll see **`Locked`** next to its title in the top breadcrumb menu" |
| Who can toggle | "**anyone with editing access can toggle this lock on or off at any time.** This is helpful as a quick safeguard against **accidental** edits" — it is a guardrail, not a security control |

([intro-to-databases](https://www.notion.com/help/intro-to-databases), [Customize your database](https://www.notion.com/help/customize-your-database))

**Note the odd inclusion of Select/Multi-select option values in the lock scope** — because option lists and their order are schema, and their order is what `manual` sorting reads.

#### 16.1 The `Can edit content` permission level

Distinct from locking, and **only exists on database pages**:

| Can | Cannot |
|---|---|
| Create, edit, delete pages within the database | Add, edit, or remove database **properties or views** |
| Edit property values for those pages | Change **filters or sorts** |
| Create linked databases and edit views/sorts/filters **there** | **Lock or unlock** the database |

([intro-to-databases](https://www.notion.com/help/intro-to-databases))

Other access gates found:
- Adjusting **database settings**: `Can edit` or higher.
- Building a **page layout**: at least `Can edit`.
- **Moving data sources**: `Full access`.
- **Conditional color** editing: `Can edit content`, `Can edit`, or `Full access`.
- **Dashboard layout** editing: edit access to the database.

---

### 17. Database title, icon, cover, description

**Title** — a database has a title; renaming the data source's title propagates to the original data source across linked instances (§14.2). API `title` (rich text array) on database creation.

**Icon / cover** — Notion databases are pages, and pages have icons and covers. **Card preview** options reference "the image you chose as your **page's cover**", confirming database *items* have covers. However, **no help article found documents a database-level icon or cover picker specifically**, nor a per-view icon picker beyond the view tab's `Display as` icon.

**Database description** — **UNRESOLVED.** No Help Center article was found documenting a database description field, and the API view/database docs surveyed did not surface one. My training data suggests a `description` exists on the database object (a rich-text caption below the title), and older Notion API versions exposed `description` on a database. **This could not be confirmed from a current primary source and must not be treated as verified.**

---

### 18. Property-type requirements per view

| View | Required property type | If absent |
|---|---|---|
| **Table** | none | — |
| **List** | none | — |
| **Gallery** | none | Cards render without an image unless a preview source is chosen |
| **Feed** | none | — |
| **Board** | a group-by property | **Notion auto-creates one.** Prefers an existing `status`; else `select`/`person`/`multi_select`/`relation`; "If none of these properties exist, **a new status property will be created** in your database for you" |
| **Calendar** | a `Date` property (`date_property_id` **Required**) | "your database must contain a `Date` property." No documented auto-creation → **UNRESOLVED** |
| **Timeline** | "at least one date property… containing a **range** of dates" (`date_property_id` **Required**) | "Otherwise **nothing will be plotted**" — renders empty, no error |
| **Map** | a `Place` property | **Notion auto-creates one:** "If you don't already have a place property, one will be created for you when you create a map view" |
| **Chart** | `chart_type` required; axes need chartable properties | Axes cannot use rollups, buttons, unique IDs, files & media, or list-returning formulas |
| **Form** | none, but the data source must be **owned** by this database, not linked | The `Form` option is not offered at all |
| **Dashboard** | none (composes other views) | Business/Enterprise plan required |

---

### 19. Limits

| Limit | Value | Source |
|---|---|---|
| Rows per database | **250,000**. Warning when approaching; hard stop at/over ("You won't be able to add new rows. Requests to add rows will return an error.") | [optimize-database-load-times](https://www.notion.com/help/optimize-database-load-times-and-performance) |
| Properties per database | **500** | same |
| All property data per page | **2.5 MB** total. Excludes the size of uploaded files in Files & media properties | same |
| Total size of all property definitions ("database structure") | **1.5 MB** | same |
| Deleted properties kept in trash | **1.5 MB** | same |
| Two-way relation references | "Once you've referenced the same page from Database A **10,000 times** in Database B as a relation, the next time you try to reference [it] in Database B, it won't reflect in Database A" | same |
| Filter group nesting | **3 layers deep** | [views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts) |
| Chart groups | **200 groups and 50 subgroups** at a time | [charts](https://www.notion.com/help/charts) |
| Map items shown | **100** at one time | [maps](https://www.notion.com/help/maps) |
| Dashboard widgets | **12 total, 4 per row** | [dashboards](https://www.notion.com/help/dashboards) |
| Dashboard nesting | not allowed | [Working with views](https://developers.notion.com/guides/data-apis/working-with-views) |
| Pinned properties in a page layout | **15** | [layouts](https://www.notion.com/help/layouts) |
| Charts on the Free plan | **1** | [charts](https://www.notion.com/help/charts) |
| Minimum views per database | **1** — deleting the last view is a `validation_error` | [Working with views](https://developers.notion.com/guides/data-apis/working-with-views) |
| Search availability threshold | database must contain **≥ 3 pages** | [views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts) |
| Load limit per view | 10 / 25 / 50 / 100 pages *(third-party; unverified)* | [Gridfiti](https://gridfiti.com/notion-slow/) |
| API view-query cache TTL | ~**15 minutes** | [Working with views](https://developers.notion.com/guides/data-apis/working-with-views) |
| Large-collection ordering quirk | "When a database contains more than **1,000 items**, new pages may appear in the middle of the collection instead of at the end. This is due to the way large collections are sorted and indexed." | [intro-to-databases](https://www.notion.com/help/intro-to-databases) |
| Max views per database | **not documented** — see UNRESOLVED | — |

---

### 20. Cross-view option matrix (summary)

Legend: ✅ documented · ➖ not applicable / not offered · ❓ undocumented

| Option | Table | Board | List | Calendar | Timeline | Gallery | Feed | Chart | Map | Form | Dashboard |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Name + icon + tab `Display as` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Filters | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❓ | ✅ | ✅ | ➖ | global filters |
| Sorts | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❓ | via axis `sort` | ✅ (alpha) | ➖ | per-widget |
| Group by | optional | **required** | ❓ | ➖ | ➖ | ❓ | ❓ | via `x_axis` | ➖ | ➖ | ➖ |
| Sub-group by | ➖ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | via `stack_by` | ➖ | ➖ | ➖ |
| Property visibility + order | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ➖ | ✅ | ➖ | ➖ |
| Per-property date/time format | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❓ | ➖ | ❓ | ➖ | ➖ |
| `Open pages in` | ✅ side | ✅ side | ✅ side | ✅ center | ✅ side | ✅ center | ❓ | ➖ | ➖ | ➖ | ➖ |
| Card size | ➖ | ✅ | ➖ | ➖ | ➖ | ✅ | ❓ | ➖ | ➖ | ➖ | ➖ |
| Card preview + fit image | ➖ | ✅ | ➖ | ➖ | ➖ | ✅ | ❓ | ➖ | ➖ | ➖ | ➖ |
| Calculations row | ✅ | ✅ (per column) | ➖ | ➖ | ✅ (table panel) | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Freeze columns | ✅ | ➖ | ➖ | ➖ | ❓ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Wrap cells | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Conditional color | ✅ (row or property) | ✅ (page) | ✅ | ✅ | ✅ | ➖ | ✅ | ➖ | ➖ | ➖ | ➖ |
| Load limit | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❓ | ➖ | ➖ | ➖ | ➖ |
| Height | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ | ✅ | ➖ | row px |
| Sub-items config | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Editable data in view | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **NO** | via pin → page | ➖ | per widget |

---

### 21. UNRESOLVED

Each of these was actively searched for and not found in a primary source. Do not guess these into the spec.

**View types & taxonomy**
1. **UNRESOLVED:** Feed view has no entry in the API `type` enum (`table`, `board`, `list`, `calendar`, `timeline`, `gallery`, `form`, `chart`, `map`, `dashboard`) despite having its own Help Center article and appearing in the conditional-color support list. Is Feed API-invisible, or is the API doc stale?
2. **UNRESOLVED:** What is the **maximum number of views** per database? No documented cap anywhere.
3. **UNRESOLVED:** Is there a **"default view"** concept — a designated view that opens first when someone navigates to the database? Views are ordered and the first tab presumably wins, but no doc names a default-view setting.

**Table**
4. **UNRESOLVED:** Does Notion table view have **row height** presets (short/medium/tall)? No Notion source mentions any. Strongly suspect **no** (this is an Airtable feature), but absence of evidence is not proof.
5. **UNRESOLVED:** Is there a **"show row numbers"** toggle? Not found in `/help/tables`, `/help/views-filters-and-sorts`, or the API table config.
6. **UNRESOLVED:** Is there a **"show database title"** toggle for inline databases? Not found. (My training data suggests inline databases once had `Show database title` / `Show database name` in the layout panel.)
7. **UNRESOLVED:** What is the **UI label** for the API's `show_vertical_lines` on table views?
8. **UNRESOLVED:** Is there a view-wide **"Wrap all cells"** UI toggle, or only the per-column `Wrap text`? The API has a view-wide `wrap_cells` boolean, implying a UI control exists, but no help doc names it.
9. **UNRESOLVED:** Can `frozen_column_index` exceed 1 in the UI? The UI says "freeze **one** column" but the API models an integer count.

**Board**
10. **UNRESOLVED:** Is there an explicit **uncategorized / "No Status" / backlog column** for cards whose grouped property is empty, and can it be hidden separately?
11. **UNRESOLVED:** Can the per-column **count/calculation be hidden entirely** (as opposed to switched to a different calculation)?
12. **UNRESOLVED (contradiction):** `/help/boards` FAQ states grouping by relation or formula is **not supported**; the API group-by union explicitly supports both `relation` and `formula`. Which is current? (Assume the API; the FAQ reads as legacy text.)
13. **UNRESOLVED:** What is the **UI label** for the API's `card_layout` (`"list"` vs `"compact"`) and `card_property_width_mode`?

**Timeline**
14. **UNRESOLVED:** The **exact UI label** of the separate-start/end-dates toggle inside `Show timeline by`. The mechanism is confirmed; the string is not.
15. **UNRESOLVED:** The **UI surface for dependency arrows** (`arrows_by`) on a timeline — the timeline help doc never mentions dependencies, and `/help/tasks-and-dependencies` was not fully mined for the timeline-rendering specifics.
16. **UNRESOLVED:** The **UI label** for the API's timeline `color_by` boolean, and which property it colours by.
17. **UNRESOLVED:** Can a timeline be **grouped**? The API matrix shows no `group_by` for timeline; no help text confirms or denies. Assume no.

**Calendar**
18. **UNRESOLVED:** What happens when you **add a calendar view to a database with no Date property**? Board and Map auto-create their required property; calendar's behaviour is undocumented.
19. **UNRESOLVED:** The **UI label and location** of `show_weekends`.
20. **UNRESOLVED:** **Time display within a day** — does month/week view show event times, and is there a setting? (Per-property `time_format` exists in the API, but its effect on calendar chips is undocumented.)
21. **UNRESOLVED:** How is a **date range spanning multiple weeks/months** rendered — continuous bar with wrap, or repeated chips?

**List / Feed**
22. **UNRESOLVED:** Does **List** view support grouping? It has View settings and conditional color, but the API list config carries only `properties`.
23. **UNRESOLVED:** **Feed** view has no API configuration schema at all. Card size, preview image source, `Open pages in`, load limit, filters and sorts are all undocumented for Feed.
24. **UNRESOLVED:** Feed's **"track views on their posts"** — where are view counts surfaced, and is there a setting?

**Chart**
25. **UNRESOLVED (contradiction):** The `Omit zero values` help text is internally inconsistent — it describes toggling it *on* as *showing* all options including zero-count ones, which inverts the option's name. Which polarity is real?
26. **UNRESOLVED:** The **UI labels** for `group_style` (`normal`/`percent`/`side_by_side` — i.e. the stacking control), `y_axis_min`/`y_axis_max`, `reference_lines`, and `caption`. These exist in the API but appear in no help article.
27. **UNRESOLVED:** Full configuration surface of the **Number chart** — the help doc lists it as a type but documents almost nothing (`value` aggregation and `hide_title` are the only API fields).

**Cross-cutting**
28. **UNRESOLVED:** The **exact `Load limit` option values** from a Notion primary source (10/25/50/100 is third-party only), and the exact **"Load more"** interaction at the bottom of a view.
29. **UNRESOLVED:** Whether a **database description** field exists (rich-text caption under the title). Not found in any current help article.
30. **UNRESOLVED:** Whether a **database-level icon and cover** picker is distinct from the standard page icon/cover, and whether a **view** can have its own emoji/icon set independently of the tab `Display as` toggle.
31. **UNRESOLVED:** Whether the **calculations row** state is persisted per-view server-side (it does not appear in the API `configuration` schema at all).
32. **UNRESOLVED:** How **`Open pages in`** defaults for Chart, Map, Feed, Form, and Dashboard, given the documented defaults cover only Table/Board/List/Timeline (side peek) and Gallery/Calendar (center peek).
33. **UNRESOLVED:** Whether **view-level sharing** exists (sharing one view without the whole database). `Copy link to view` produces a URL, but permissions are documented only at the database/page level.

---

### 22. Source index

| URL | What it covers |
|---|---|
| https://developers.notion.com/guides/data-apis/working-with-views | **Highest-value source.** Full view object + per-type `configuration` schemas, all enums, group-by union, feature matrix, linked-view creation, pagination |
| https://www.notion.com/help/views-filters-and-sorts | View creation/tabs, View settings menu, `Open pages in`, filters (+advanced, 3-layer nesting), sorts, groups, search, freeze column |
| https://www.notion.com/help/tables | Table specifics, bulk edit, wrap text, calculations list |
| https://www.notion.com/help/boards | Board grouping/auto-creation, sub-groups, card size/preview/fit image, colour columns, hide group, calculations |
| https://www.notion.com/help/lists | List view |
| https://www.notion.com/help/calendars | `Show calendar as`/`Show calendar by`, navigation, multi-day drag, start-week preference |
| https://www.notion.com/help/timelines | Zoom, table panel, `Table properties`, `Show timeline by`, `Load limit`, `Today` |
| https://www.notion.com/help/galleries | Card preview/size/fit image, hiding `Name` |
| https://www.notion.com/help/charts | 5 chart types, X/Y config, donut, style options, drilldowns, export, limits, plan gating |
| https://www.notion.com/help/feeds | Feed view (thin) |
| https://www.notion.com/help/maps | Place property, `Map by`, 100-item cap, text-based filtering |
| https://www.notion.com/help/forms | Form builder, sharing, submission permissions, `Responses` table |
| https://www.notion.com/help/dashboards | Widgets, 12/4 limits, View vs Edit mode, global filters, plan gating |
| https://www.notion.com/help/data-sources-and-linked-databases | Data source model, `Manage data sources`, what linked views share |
| https://www.notion.com/help/guides/databases-reimagined-whats-changed | Quick filters, `Save for everyone`, view tabs, multi-source blocks |
| https://www.notion.com/help/intro-to-databases | Inline vs full-page, duplication, item actions, `Can edit content`, lock views |
| https://www.notion.com/help/customize-your-database | `Database settings` enumeration |
| https://www.notion.com/help/database-properties | **Conditional color** (rules, supported views, supported properties) |
| https://www.notion.com/help/optimize-database-load-times-and-performance | All size limits |
| https://www.notion.com/help/layouts | Page layout builder, 15 pinned properties |
| https://www.notion.com/help/category/database-views | Section index (revealed Dashboards) |
| https://gridfiti.com/notion-slow/ | Third-party: `Load limit` values (unverified) |

## H. The formula language (formulas 2.0)


**Research date:** 2026-08-08
**Purpose:** Formal-spec-grade inventory of the Notion formula language, for building a from-scratch parser / type checker / evaluator. This is a *language inventory only* — no implementation design.

### Provenance & how to read this document

Sources are ranked. Where they conflict, the higher-ranked one wins and the conflict is called out.

| Rank | Source | URL |
|---|---|---|
| **P1 — Notion official, normative** | Formula syntax & functions (the complete function reference) | [notion.com/help/formula-syntax](https://www.notion.com/help/formula-syntax) |
| **P1** | Intro to formulas | [notion.com/help/formulas](https://www.notion.com/help/formulas) |
| **P1** | Fix common formula errors | [notion.com/help/common-formula-errors](https://www.notion.com/help/common-formula-errors) |
| **P1** | Formulas 2.0: what's changed | [notion.com/help/guides/new-formulas-whats-changed](https://www.notion.com/help/guides/new-formulas-whats-changed) |
| **P1 — API** | Page property values (formula result types) | [developers.notion.com/reference/page-property-values](https://developers.notion.com/reference/page-property-values) |
| **P1 — API** | Data source property object (`formula.expression`) | [developers.notion.com/reference/property-object](https://developers.notion.com/reference/property-object) |
| **P1 — API** | Filter data source entries (formula filters) | [developers.notion.com/reference/post-database-query-filter](https://developers.notion.com/reference/post-database-query-filter) |
| **P1 — API** | Changelog (Formulas 2.0 launch; `unsupported` values) | [developers.notion.com/page/changelog](https://developers.notion.com/page/changelog) |
| **P2 — community, cross-check only** | Thomas Frank Notion Formula Reference (per-function pages, deepest available) | [thomasjfrank.com/formulas/](https://thomasjfrank.com/formulas/notion-formula-reference/) |

**Notation used below**
- `T?` = optional argument of type `T`.
- `...T` = variadic rest of type `T`.
- `Any` = any of the seven value types.
- **[P1]** = confirmed on a Notion-official page. **[P2]** = only found on the community reference — treat as likely-true but verify before shipping a parser rule.
- `UNRESOLVED:` marks something I could not confirm from documentation. **Do not guess these.**

**Version anchor.** Formulas 2.0 shipped to the product and Public API on **September 6–7, 2023**; the API changelog notes that "the formatting of `formula.expression` … has changed" as part of that launch ([changelog](https://developers.notion.com/page/changelog)). Everything below reflects the language as documented in August 2026.

---

### 1. The type system

### 1.1 The value types

Notion formulas have **seven** value types. This count is stated explicitly by the community reference ([data types](https://thomasjfrank.com/formulas/data-types/), [reference properties in formulas](https://thomasjfrank.com/formulas/reference-properties-in-formulas/)) and is consistent with every type name that appears in the official property→formula-type table ([P1 formula-syntax](https://www.notion.com/help/formula-syntax)).

| Type | Official name used by Notion | Literal syntax | Notes |
|---|---|---|---|
| **String** | `Text` | `"abc"` | Rich text — can carry styling/link annotations (see `style`, `link`). |
| **Number** | `Number` | `42`, `3.14`, `-1` | IEEE-754 double, JS-like. Displayed in scientific notation above 21 digits **[P2]** ([number](https://thomasjfrank.com/formulas/data-types/number/)). |
| **Boolean** | `Boolean` (surfaces as `Checkbox`) | `true`, `false` | Also accepts `TRUE`/`True`? → see §2.1. |
| **Date** | `Date` | *no literal* | Constructed only by `now()`, `today()`, `parseDate()`, `fromTimestamp()`, `dateRange()`, or a date-typed property. |
| **List** | `List` (a.k.a. array) | `[a, b, c]` | Heterogeneous and nestable — see §1.5. |
| **Person** | `Person` | *no literal* | A workspace user. From `Person`/`Created by`/`Last edited by` properties. |
| **Page** | `Page` | *no literal* | A database row / Notion page. From `Relation`, `Rollup`, or context variables. |

There is **no** object/record/struct type, **no** null literal, **no** function type (you cannot define your own functions — [functions](https://thomasjfrank.com/formulas/functions/)), and **no** `random()` — Notion states outright that "Notion formulas don't have" a `random()` function [P1] ([intro to formulas](https://www.notion.com/help/formulas)).

### 1.2 Property type → formula type mapping [P1]

Verbatim from the official reference ([P1](https://www.notion.com/help/formula-syntax)):

| Database property type | Formula value type |
|---|---|
| Title | Text |
| Text | Text |
| Select | Text |
| Multi-Select | **Text (list)** |
| Status | Text **[P2]** ([ref props](https://thomasjfrank.com/formulas/reference-properties-in-formulas/)) — "returns a string even if displayed as a Checkbox" |
| Checkbox | Boolean |
| Email, URL, Phone Number | Text |
| Unique ID | Text |
| Created By, Edited By | **Person** (single, not a list) |
| Person | **Person (list)** |
| Date, Created Time, Last Edited Time | Date |
| Number | Number |
| Files & Media | **List of Text (URLs)** **[P2]** |
| Relation | **Page (list)** |
| Rollup | "Number, date, or list of any type. Depends on rollup configuration." |

Rollup subtlety **[P2]**: a rollup's formula type depends on *both* the rolled-up property's type *and* the rollup's Calculate setting. **`Show Original` always yields a string**, because it may display several rows' values at once ([ref props](https://thomasjfrank.com/formulas/reference-properties-in-formulas/)).

### 1.3 Date, date ranges, and duration

**There is no duration type.** Time differences are plain `Number`s produced by `dateBetween(a, b, unit)`.

**A date range is not a separate type — it is the `Date` type with an end component.** The underlying date value has three parts **[P2]** ([date data type](https://thomasjfrank.com/formulas/data-types/date-data-type/)):

1. Start date
2. **End date (optional)**
3. Time zone

`dateRange(start, end)` produces a `Date` whose end is populated; `dateStart()` / `dateEnd()` project it back out [P1]. The official function table labels `dateRange`'s output as "a date range constructed from the start and end dates" and displays it as `@September 7, 2022 → September 7, 2023` [P1].

Time-zone semantics **[P2]** ([date data type](https://thomasjfrank.com/formulas/data-types/date-data-type/)):
- A Date **property** with an explicit time always displays in the time zone it was *set in* — it does not re-render into the viewer's zone.
- Dates produced by `now()` and `fromTimestamp()` are **always** rendered in the viewer's local (system) time zone, and this cannot be overridden.
- `formatDate()` renders in the system time zone by default but accepts an explicit time-zone third argument (§3.6).

`UNRESOLVED:` whether a formula-produced Date carries a time-zone *tag* that survives into a Date property when written by an automation, or whether it is normalized to UTC/instant.

### 1.4 Empty / null semantics

There is no `null` literal. Instead:

- **`empty()` with zero arguments is the canonical "no value" expression.** Notion's own error guide instructs using it as an `if` branch to keep a formula single-typed: `if(Date, Date.dateAdd(1, "day"), empty())` [P1] ([common formula errors](https://www.notion.com/help/common-formula-errors)). The community reference states plainly that `empty()` returns an empty value and that the old `"".parseDate()` trick is obsolete ([return null/empty](https://thomasjfrank.com/formulas/return-null-empty-values-in-formulas/)).
- **`empty(value)` with one argument is a predicate.** Official definition: *"Returns true if the value is empty. `0`, `""`, and `[]` are considered empty."* [P1]. So `empty(0) == true` and `empty([]) == true` — **numeric zero is "empty"**, which is a genuine trap for a reimplementation.
- An **unset property** evaluates to the empty value of its declared type. `Created by` / `Created time` / `Last edited by` / `Last edited time` are **initially empty** at the instant a row is created, and any formula referencing them is therefore also initially empty **[P2]** ([formulas in database filters](https://thomasjfrank.com/formulas/formulas-in-database-filters/)) — this is the documented cause of the "new row disappears from a filtered view" behaviour.
- Failure sentinels rather than errors: `find([1,2,3], current > 100)` returns **Empty**, while `findIndex([1,2,3], current > 100)` returns **`-1`** [P1].
- In automations specifically, hitting an unexpected empty value (most often a date or person) **pauses the automation with an error** rather than propagating an empty [P1] ([common formula errors](https://www.notion.com/help/common-formula-errors)).

### 1.5 List typing

- Lists are written `[...]` with square brackets **[P2]** and are **heterogeneous** — `["Apples", 1, true, now(), ["Luffy","Zorro"]]` is legal ([list data type](https://thomasjfrank.com/formulas/data-types/list-array/)).
- **Nested lists are allowed.** `flat([[1,2],[3,4]])` → `[1,2,3,4]` [P1].
- `flat()` flattens **exactly one level** and, unlike JS, **does not take a depth argument** **[P2]** ([flat](https://thomasjfrank.com/formulas/functions/flat/)).
- Elements retain their own types when accessed by index; the *live preview* stringifies them for display **[P2]**.
- Indexing is **zero-based** [P1] (`at([1,2,3], 1) == 2`; `map([1,2,3], index) == [0,1,2]`).
- Type checking of lists is best described as `List` (unparameterised) at the surface, with element types checked at use site. Notion's error guide says formulas over relation/rollup/person properties "return a list of pages or people" and you must narrow with `.first()`, `.at(0)`, or iterate with `.map()/.filter()/.every()/.some()/.find()` [P1].

`UNRESOLVED:` whether the type checker tracks a parameterised element type (`List<Number>`) internally, or treats all lists as `List<Any>`. The editor's "Show types" toggle exists [P1] but its output format is undocumented in text form.

### 1.6 The `Page` type

A `Page` value supports:

| Operation | Syntax | Source |
|---|---|---|
| Read any property of that page | `page.prop("Created By")` / `prop("Relation").first().prop("Created Time")` | **[P2]** ([page data type](https://thomasjfrank.com/formulas/data-types/page/)) |
| Read a property via bare token | `current.Status`, `Trigger page.Parent item` | **[P1]** ([intro to formulas](https://www.notion.com/help/formulas)) |
| Get the page id | `id(page)` / `page.id()` | **[P1]** — `id(prop("Relation").first())` |
| Get the *current* page's id | `id()` with no argument | **[P1]** — *"If no page is provided, returns the id of the page the formula is on."* |

The id is returned **without dashes**, e.g. `c5d67d15854744869cc4a062fb7b1377` **[P2]** ([id](https://thomasjfrank.com/formulas/functions/id/)).

**There is no `.name()` on a Page.** `name()` is a *Person* function [P1]. To get a related page's title you read its title property: `prop("Relation").first().prop("Name")`. Comparing/sorting a list of Pages treats them "as strings" **[P2]** ([sort](https://thomasjfrank.com/formulas/functions/sort/)) — i.e. by rendered title.

`UNRESOLVED:` whether a bare `Page` value coerces to its title in string concatenation, and what `format(page)` returns.

### 1.7 The `Person` type

`name(person)`, `email(person)`, `id(person)` [P1] / **[P2]**. Because the `Person` *property* returns a **list**, `name()`/`email()` applied directly only work on single-person properties (`Created by`, `Last edited by`); otherwise use `.first()` or `.map(current.name())` **[P2]** ([person data type](https://thomasjfrank.com/formulas/data-types/person/)). `email()` returns plain text, not a link **[P2]**.

### 1.8 Type coercion rules

Notion is **strongly typed with very little implicit conversion**. The community reference states it bluntly: *"The formula editor will almost never do automatic type conversion, so you must pass the correct data types"* **[P2]** ([formatDate](https://thomasjfrank.com/formulas/functions/formatdate/)).

**Coercions that DO happen:**

| Rule | Evidence |
|---|---|
| `+` with a String operand concatenates and stringifies the other operand. `"There are " + prop("Members").length() + " members."` works. | **[P2]** ([number](https://thomasjfrank.com/formulas/data-types/number/)) |
| `join()` stringifies all elements. | **[P2]** |
| `replace`, `replaceAll`, and `test` auto-convert **Numbers and Booleans** (but **not Dates**) to strings. | **[P2]** ([converting data types](https://thomasjfrank.com/formulas/converting-data-types/)) |
| A number receiver on a string method: `1932.substring(0,2)` → `"19"`. | **[P2]** ([functions](https://thomasjfrank.com/formulas/functions/)) |
| Booleans in `>`/`<` comparisons behave as `1`/`0`: `true > false` is `true`. | **[P2]** ([greater-than](https://thomasjfrank.com/formulas/built-ins/greater-than/)) |
| Sorting a mixed-type list treats **everything** as a string; element types are preserved in the output. | **[P2]** ([sort](https://thomasjfrank.com/formulas/functions/sort/)) |

**Coercions that do NOT happen (these are type errors):**

| Non-rule | Evidence |
|---|---|
| `add(2, "2")` — arithmetic never parses a string. Use `toNumber`. | **[P2]** ([string](https://thomasjfrank.com/formulas/data-types/string/)) |
| `dateAdd(formatDate(now(), "MMMM DD YYYY"), 4, "months")` → *"Argument of type text does not satisfy function dateAdd."* | **[P2]** ([formatDate](https://thomasjfrank.com/formulas/functions/formatdate/)) |
| `==` is **strict** (JS `===`). `"1" == 1` is `false`; `"true" != true` is `true`. Cross-type comparison is allowed but always unequal. | **[P2]** ([string](https://thomasjfrank.com/formulas/data-types/string/)) |
| String comparison is **case-sensitive**. | **[P2]** |

**Explicit conversion functions** [P1] / **[P2]** ([converting data types](https://thomasjfrank.com/formulas/converting-data-types/)):

| From → To | Function |
|---|---|
| String → Number | `toNumber` |
| String → Date | `parseDate` (ISO 8601) |
| Number → String | `format`, `formatNumber` |
| Number → Date | `fromTimestamp` (must be a valid Unix ms timestamp) |
| Boolean → String | `format` |
| Boolean → Number | `toNumber(true) == 1` [P1] |
| Date → String | `format`, `formatDate` |
| Date → Number | `timestamp`, **and also `toNumber`** — `toNumber(now())` returns the Unix ms timestamp [P1] |
| Anything → Boolean | *no conversion exists*; write an `if`/comparison instead |

**Branch-type unification is enforced.** Notion documents that `if(Date, Date.dateAdd(1,"day"), "")` is an error because the return type "could either be date or text"; the fix is `empty()` as the else-branch [P1] ([common formula errors](https://www.notion.com/help/common-formula-errors)). So `if`/`ifs` require **all** result branches to unify to one type, with `empty()` acting as the polymorphic bottom value.

### 1.9 Error values and propagation

Notion does **not** have first-class error values that flow through expressions the way spreadsheet `#N/A` does. Instead:

- **Static (type/parse) errors** are reported by the editor before evaluation. A formula with errors **can still be saved**; the live preview shows the error list and the property "will display nothing" **[P2]** ([the formula editor](https://thomasjfrank.com/formulas/the-formula-editor/)).
- **Permission errors:** if the viewer lacks access to a referenced database, "formulas won't be able to compute reliably" [P1].
- **Depth errors:** exceeding 15 layers surfaces an explicit error message [P1] (§4.3).
- **In the API**, a formula whose value "depends on too many related pages or nested formulas and rollups" is returned as `{"type": "unsupported", "unsupported": {}}` with **no partial value** — added to the API on **August 5, 2026** ([changelog](https://developers.notion.com/page/changelog)).
- **In automations**, an unexpected empty value **pauses the automation** rather than yielding an error value [P1].

`UNRESOLVED:` the runtime behaviour of arithmetic edge cases — `divide(1, 0)`, `sqrt(-1)`, `ln(0)`, `toNumber("abc")`, `parseDate("garbage")`, `at(list, 99)`. Notion documents none of these. Do not guess; probe a live workspace.

---

### 2. Syntax

### 2.1 Operators

**Official built-ins list** [P1] ([formula-syntax](https://www.notion.com/help/formula-syntax)):

| Category | Operators |
|---|---|
| Math | `+` `-` `*` `/` `%` `^` |
| Boolean literals | `true` `false` |
| Comparison | `==` `>` `>=` `<` `<=` (and `!=` via `unequal`) |
| Logical | `and` / `&&` / `and(a,b)`; `or` / `\|\|` / `or(a,b)`; `not` / `!` / `not(x)` |
| Ternary | `X ? Y : Z` — official: *"is equivalent to `if(X, Y, Z)`"* |

Note the official page's "Math operators" row literally enumerates `+ , - , * , %`, but `/` and `^` are demonstrated in the `divide` and `pow` entries on the same page (`5 / 10 = 0.5`, `5 ^ 10 = 9765625`) [P1]. All six are real.

**Case-insensitive logical keywords [P2]:** *"Notion is no longer picky, so `&&`, `AND`, and `And` now also work"* ([and](https://thomasjfrank.com/formulas/built-ins/and/)). `UNRESOLVED:` whether `TRUE`/`True`, `OR`/`Or`, `NOT`/`Not` are likewise case-insensitive.

**String concatenation uses `+`** — same token as numeric addition [P1] (`"hello" + "world"`). There is no separate `&` or `..` operator.

### 2.2 Precedence and associativity

The only published precedence table is the community one **[P2]** ([operator precedence and associativity](https://thomasjfrank.com/formulas/operator-precedence-and-associativity/)). Higher number binds tighter.

| Prec | Operators | Associativity |
|---:|---|---|
| 10 | `()` grouping | n/a |
| 9 | `not` (`!`) | right-to-left |
| 8 | `^` (pow) | **right-to-left** — `2^3^2 == 512` |
| 7 | `*` `/` | left-to-right |
| 6 | `+` `-` | left-to-right |
| 5 | `>` `>=` `<` `<=` | **non-associative** |
| 4 | `==` `!=` | **non-associative** |
| 3 | `and` | left-to-right |
| 2 | `or` | left-to-right |
| 1 | `? :` (ternary) | right-to-left |

**Non-associativity is enforced, not just conventional.** `1 > prop("Number") > 5` is documented as **invalid**; you must write `1 > prop("Number") and prop("Number") < 5`. Likewise `1 == toNumber(true) == toNumber("1")` is invalid **[P2]**. A reimplementation must reject chained relational/equality operators at parse time.

`UNRESOLVED:` where `%` (mod) sits in the precedence table — it is omitted from the published table. Level 7 alongside `*` and `/` is the natural reading but is **not documented**.
`UNRESOLVED:` the precedence of **unary minus** (`-x`). It is absent from the table entirely. Note the interaction with `^` right-associativity and with the number-literal-then-dot lexing in §2.9.
`UNRESOLVED:` precedence of the `.` (method-call) operator — presumably tightest, above `not`, but undocumented.

### 2.3 Conditionals

```
if(condition, thenValue, elseValue)
ifs(cond1, value1, cond2, value2, ..., defaultValue)
condition ? thenValue : elseValue
```

- `if(true, 1, 2) = 1`; `if(false, 1, 2) = 2` [P1].
- `ifs` — *"Returns the value that corresponds to the first true condition. This can be used as an alternative to multiple nested `if()` statements."* `ifs(true, 1, true, 2, 3) = 1`; `ifs(false, 1, false, 2, 3) = 3` [P1]. So `ifs` takes an **odd** number of arguments: N condition/value pairs plus one trailing default.
- The ternary is exactly `if` [P1].
- **The `else` branch of `if` is not optional** in any documented example.
- All branches must unify to one type (§1.8).
- `if(Date, ...)` appears in official documentation with a **Date** in the condition slot [P1] ([common formula errors](https://www.notion.com/help/common-formula-errors)), and `Parent Task.Sub-item ? ... : false` uses a **list** as a condition [P1] ([intro to formulas](https://www.notion.com/help/formulas)). `UNRESOLVED:` the exact truthiness rule for non-Boolean conditions. Both examples come from *automation* formulas; whether property-formulas accept the same is unverified. Likely "non-empty ⇒ true", matching `empty()`.

### 2.4 `let` and `lets`

```
let(name, value, expression)
let(name1, value1, name2, value2, ..., expression)     // since April 2025
lets(name1, value1, name2, value2, ..., expression)
```

- Official examples [P1]: `let(person, "Alan", "Hello, " + person + "!") = "Hello, Alan!"`; `let(radius, 4, round(pi() * radius ^ 2)) = 50`; `lets(a, "Hello", b, "world", a + " " + b) = "Hello world"`; `lets(base, 3, height, 8, base * height / 2) = 12`.
- **As of April 2025 `let()` accepts multiple variables, making it functionally identical to `lets()`** **[P2]** ([let](https://thomasjfrank.com/formulas/functions/let/)). Both remain valid; `lets` is described as an "alias".
- **Scoping is lexical and parenthesis-bounded:** *"the resulting variable(s) can only be used between the parentheses of the original `let()` function, not outside of them"* **[P2]**.
- **Nesting works, inner sees outer, not vice versa:** *"you can use variables from an outer `lets()` within an inner `lets()` – but not the other way around."* Worked example **[P2]** ([lets](https://thomasjfrank.com/formulas/functions/lets/)):
  ```
  lets(
    var1, 2 + 2,
    var2, 3 + 3,
    var3, lets(var4, var1 * var2, var5, var4 / var1, var5),
    var3 - var1
  )
  ```
- Variable names are **bare identifiers**, unquoted, and may contain letters/digits (camelCase used throughout the docs).
- The primary documented use beyond readability: **capturing the outer `current` when nesting list functions** (e.g. `map(filter(...))`) **[P2]**.
- A dot form exists: `variable.lets(value, variable, value, ..., expression)` **[P2]** — signature listed on the `lets` page. `UNRESOLVED:` what this actually means semantically; it looks like the generic dot-notation rewrite applied mechanically and is probably a documentation artefact rather than a useful form.

`UNRESOLVED:` whether bindings within a single `lets(...)` are **sequential** (can `var2`'s value reference `var1`?). The nested example deliberately avoids the question. Notion's error guide documents a *related but different* restriction: variables defined in the **same automation action** cannot reference each other [P1] ([common formula errors](https://www.notion.com/help/common-formula-errors)) — that is about automation "Define variable" actions, not `lets`.
`UNRESOLVED:` whether shadowing an outer variable name in an inner `lets` is legal.

### 2.5 Dot notation vs function-call notation

Formulas 2.0 added method syntax [P1] ([what's changed](https://www.notion.com/help/guides/new-formulas-whats-changed)).

**General rule (inferred from every documented example, never stated as a rule):**

```
receiver.f(a, b)   ≡   f(receiver, a, b)
```

Confirmed instances:

| Dot form | Function form | Source |
|---|---|---|
| `prop("Title").length()` | `length(prop("Title"))` | [P1] |
| `prop("Created By").name()` | `name(prop("Created By"))` | [P1] |
| `Tasks.length()` | `length(Tasks)` | [P1] |
| `-20.abs()` | `abs(-20)` | **[P2]** |
| `"   notion   ".trim()` | `trim("   notion   ")` | [P1] |
| `prop("Tasks").filter(current.prop("Status") !== "Done")` | `filter(prop("Tasks"), ...)` | [P1] |
| `12345.67.formatNumber("usd")` | `formatNumber(12345.67, "usd")` | **[P2]** |
| `[1,2,3,4,5].splice(1, 1, "👀")` | `splice([1,2,3,4,5], 1, 1, "👀")` | **[P2]** |
| `now().formatDate("dddd", "GMT+5")` | `formatDate(now(), "dddd", "GMT+5")` | **[P2]** |
| `date.parseDate()`, `.toNumber()`, `.add(1)` chained | nested calls | **[P2]** |

**Which functions support it:** every function page in the community reference lists *both* forms, including zero-arg-receiver oddities like `let`. I found **no** documented function that is dot-only or function-only.

`UNRESOLVED:` whether nullary functions (`now()`, `today()`, `pi()`, `e()`, `id()` with no page) have any dot form — no example exists, and mechanically they have no receiver.
`UNRESOLVED:` whether `prop()` itself can be the *method* (i.e. is `page.prop("X")` the generic rewrite of a two-arg `prop(page, "X")`, and does that two-arg form parse?). Only the dot form is ever shown.

Note one oddity in the official docs: `prop("Tasks").filter(current.prop("Status") !== "Done")` uses **`!==`** [P1], while everywhere else the inequality operator is `!=`. `UNRESOLVED:` whether `!==` is a real accepted token or a typo in Notion's help page. A tolerant lexer should probably accept both.

### 2.6 Property references

Three surface forms, all denoting the same thing:

1. **`prop("Name")`** — the canonical, copy-pasteable form [P1]. Property name goes in **double quotes**.
2. **Bare token** — inside the live editor a property renders as a chip; typing its name inserts it. Notion's own help articles show bare tokens with **spaces in the identifier**: `dateAdd(Start Date, 2, "week")`, `now() > Due Date`, `Status != "Done"`, `length(Upvoted by)`, `Trigger page.Parent item.first()`, `Parent Task.Sub-item.every(current.Status == "Done")` [P1] ([intro to formulas](https://www.notion.com/help/formulas)).
3. **Dotted off a Page value** — `current.Status`, `page.prop("Created By")` [P1] / **[P2]**.

The editor↔text relationship is documented: *"property name 'tokens' will show up as `prop()` equivalents when you copy and paste a formula somewhere outside the formula editor"* **[P2]** ([the formula editor](https://thomasjfrank.com/formulas/the-formula-editor/), [ref props](https://thomasjfrank.com/formulas/reference-properties-in-formulas/)). The API's `formula.expression` is the **serialized `prop("…")` form** — e.g. `"prop(\"Price\") / 2"` ([property object](https://developers.notion.com/reference/property-object)).

**Practical takeaway for a parser:** `prop("...")` is the wire format and the only one you must parse. Bare tokens with embedded spaces are an *editor* affordance whose grammar is undocumented and ambiguous (how would `Start Date` parse without token metadata?). `UNRESOLVED:` the textual grammar of bare property tokens — I believe they are not textual at all but rich-text chips backed by property IDs.

**`context("...")`** is the automation-only analogue of `prop()` **[P2]** ([formulas in automations](https://thomasjfrank.com/formulas/formulas-in-automations/)). Documented context variables:

```
context("Whoever triggered")   -> Person
context("Page creator")        -> Person
context("Time triggered")      -> Date (with time)
context("Date triggered")      -> Date (no time)
context("Trigger page")        -> Page
```
(plus a "Page added" variable referencing a page created by a prior automation step). Example: `context("Trigger page").prop("Due").formatDate("dddd")`.

### 2.7 Comments and whitespace

- **Block comments only:** `/* This is a comment */` **[P2]** ([the formula editor](https://thomasjfrank.com/formulas/the-formula-editor/)). Every code sample across both the official and community docs uses this form.
- **Newlines and indentation are permitted** inside formulas (Shift+Enter / Tab in the editor) [P1] ([what's changed](https://www.notion.com/help/guides/new-formulas-whats-changed) — "multi-line editing with tabs and comments").
- Spaces between arguments are optional; commas are required **[P2]**.
- `UNRESOLVED:` whether `//` line comments are supported. Not a single example uses them.
- `UNRESOLVED:` whether comments may nest.

### 2.8 String literals and escaping

Strings are wrapped in **double quotes only**. *"If you wrap a string in single quotes, you'll get an invalid character error."* **[P2]** ([string data type](https://thomasjfrank.com/formulas/data-types/string/)).

| Character | Escape sequence |
|---|---|
| Double quote | `\"` |
| Backslash | `\\` |
| Newline | `\n` |
| Tab | `\t` |

Single quotes need no escaping. **[P2]**

**Regex arguments are strings first**, so a regex backslash must be doubled at the string level in some contexts — official examples show `test("Notion", "\\d")` and `match("Notion 123 Notion 456", "\\d+")` [P1], while the community reference writes single-backslash forms like `"\b[Cc]ats?\b"` and `"\d+"` **[P2]**. `UNRESOLVED:` the exact escaping rule at the string/regex boundary — the two sources are inconsistent, and this is a genuine hazard for a lexer. Notion's own page uses `\\d`; assume the string layer consumes one backslash and test empirically.
Additionally: hard-coding Unicode into a regex requires **double backslashes** (`\\uXXXX`) **[P2]** ([regex](https://thomasjfrank.com/formulas/regular-expressions-in-notion-formulas/)) — which corroborates the "string layer eats one backslash" reading.

### 2.9 Number literals

Decimal integers and decimals, with a leading `-` for negatives. No documented hex/binary/octal/exponent/underscore-separator literal forms.

**Lexing hazard [P2]:** the community reference shows `1932.substring(0, 2)` and `12345.67.formatNumber("usd")` — a numeric literal directly followed by `.method()`. A lexer must resolve `1932.substring` (member access on an integer) vs `12345.67` (decimal) vs `12345.67.formatNumber` (decimal then member access) with maximal-munch on the decimal part.

### 2.10 Date literals

**There are none.** The docs render dates with an `@` sigil in *output* (`@August 30, 2023 5:55 PM`, `@September 7, 2022 → September 7, 2023`) [P1], but that is display, not input syntax. Dates enter a formula only via `now()`, `today()`, `parseDate()`, `fromTimestamp()`, `dateRange()`, or a date-typed property **[P2]** ([now](https://thomasjfrank.com/formulas/functions/now/)).

### 2.11 List literals

`[expr, expr, ...]` — heterogeneous, nestable, zero-based. `[]` is the empty list and is `empty()`-true [P1].

### 2.12 Lambdas / anonymous functions

**There is no lambda syntax.** The higher-order list functions take a **bare expression** as their final argument, evaluated once per element with two implicitly-bound variables:

| Implicit variable | Meaning |
|---|---|
| **`current`** | The element being visited. Official: *"you can use the keyword `current` to refer to the row being evaluated."* [P1] |
| **`index`** | The **zero-based** position of the current element. Official: `map([1, 2, 3], current + index) = [1, 3, 5]` [P1] |

Official examples [P1]:
```
find(["a","b","c"], current == "b")        = "b"
findIndex(["a","b","c"], current == "b")   = 1
filter([1,2,3], current > 1)               = [2, 3]
some([1,2,3], current == 2)                = true
every([1,2,3], current > 0)                = true
map([1,2,3], current + 1)                  = [2, 3, 4]
map([1,2,3], index)                        = [0, 1, 2]     [P2]
prop("Tasks").filter(current.prop("Status") !== "Done")
Parent Task.Sub-item.every(current.Status == "Done")
```

Functions taking a `current`-expression: `map`, `filter`, `find`, `findIndex`, `some`, `every`, `count` **[P2]**, and `sort` (as a **comparator key**, see §3.7).

**Nesting shadows.** Because `current` is a single implicit name, nesting `map(filter(...))` shadows the outer binding; the documented workaround is to capture it with `let`/`lets` first **[P2]** ([let](https://thomasjfrank.com/formulas/functions/let/)).

`UNRESOLVED:` whether `index` is bound inside `filter`/`find`/`some`/`every`/`sort`/`count`, or only inside `map`. Only `map` has documented `index` examples.
`UNRESOLVED:` whether a third implicit variable exists for the source list (JS's third callback argument).

---

### 3. The complete function list

**Legend.** **Src** column: `P1` = listed on [notion.com/help/formula-syntax](https://www.notion.com/help/formula-syntax) (normative); `P2` = documented only on [thomasjfrank.com/formulas](https://thomasjfrank.com/formulas/functions/) — **real but officially undocumented; verify before relying on the signature.**

Count: **88 functions on the official reference**, plus **4** community-documented (`padStart`, `padEnd`, `count`, `splice`), plus the operator-function forms `and`/`or`/`not` and the reference forms `prop`/`context` — **≈97 callable names total**.

### 3.1 Conditional / logic (8)

| Name | Signature | Returns | Description | Src |
|---|---|---|---|---|
| `if` | `if(Boolean, Any, Any)` | Any (branches must unify) | Returns the first value if the condition is true; otherwise the second. | P1 |
| `ifs` | `ifs(Boolean, Any, ...pairs, Any)` | Any | Returns the value corresponding to the first true condition; trailing arg is the default. | P1 |
| `and` | `and(Boolean, Boolean)` / `a and b` / `a && b` | Boolean | Logical AND. Also `AND`, `And`. | P1 (built-ins) |
| `or` | `or(Boolean, Boolean)` / `a or b` / `a \|\| b` | Boolean | Logical OR. | P1 (built-ins) |
| `not` | `not(Boolean)` / `not b` / `!b` | Boolean | Logical NOT. | P1 (built-ins) |
| `equal` | `equal(Any, Any)` / `a == b` | Boolean | Strict equality (JS `===`). Cross-type compares are legal and always false. | P1 |
| `unequal` | `unequal(Any, Any)` / `a != b` | Boolean | Strict inequality. | P1 |
| `empty` | `empty(Any)` → Boolean; `empty()` → the empty value | Boolean / Empty | *"Returns true if the value is empty. `0`, `""`, and `[]` are considered empty."* Zero-arg form yields the polymorphic empty value. | P1 |

> **No `larger` / `largerEq` / `smaller` / `smallerEq` function forms appear anywhere in the current documentation.** Those were Formulas-1.0 names. Only the symbolic operators `>` `>=` `<` `<=` are documented in 2.0. `UNRESOLVED:` whether the 1.0 aliases still parse for backwards compatibility.

### 3.2 Numeric / math (25)

| Name | Signature | Returns | Description | Src |
|---|---|---|---|---|
| `add` | `add(Number, Number)` / `a + b` | Number | Sum of two numbers. `+` also concatenates strings. | P1 |
| `subtract` | `subtract(Number, Number)` / `a - b` | Number | Difference. | P1 |
| `multiply` | `multiply(Number, Number)` / `a * b` | Number | Product. | P1 |
| `divide` | `divide(Number, Number)` / `a / b` | Number | Quotient. `divide(5,10) = 0.5`. | P1 |
| `mod` | `mod(Number, Number)` / `a % b` | Number | First number modulo the second. | P1 |
| `pow` | `pow(Number, Number)` / `a ^ b` | Number | Base raised to exponent. Right-associative. | P1 |
| `abs` | `abs(Number)` | Number | Absolute value. | P1 |
| `round` | `round(Number, Number?)` | Number | Rounds to nearest integer; optional 2nd arg = decimal places. **Negative places work**: `round(1234, -2) = 1200`. | P1 |
| `ceil` | `ceil(Number)` | Number | Smallest integer ≥ input. `ceil(-0.6) = 0`. | P1 |
| `floor` | `floor(Number)` | Number | Largest integer ≤ input. `floor(-0.6) = -1`. | P1 |
| `sqrt` | `sqrt(Number)` | Number | Positive square root. | P1 |
| `cbrt` | `cbrt(Number)` | Number | Cube root. | P1 |
| `exp` | `exp(Number)` | Number | e^x. | P1 |
| `ln` | `ln(Number)` | Number | Natural logarithm. | P1 |
| `log10` | `log10(Number)` | Number | Base-10 logarithm. | P1 |
| `log2` | `log2(Number)` | Number | Base-2 logarithm. | P1 |
| `sign` | `sign(Number)` | Number | `1` / `-1` / `0`. | P1 |
| `min` | `min(...Number \| List<Number>)` | Number | Smallest of the arguments. **Accepts lists**: `min([1,2,3]) = 1`. | P1 |
| `max` | `max(...Number \| List<Number>)` | Number | Largest of the arguments. `max([1,2,3]) = 3`. | P1 |
| `sum` | `sum(...Number \| List<Number>)` | Number | Sum. **Mixes lists and scalars**: `sum([1,2,3], 4, 5) = 15`. | P1 |
| `median` | `median(...Number \| List<Number>)` | Number | Middle value. `median([1,2,3], 4) = 2.5`. | P1 |
| `mean` | `mean(...Number \| List<Number>)` | Number | Arithmetic average. `mean([1,2,3], 4, 5) = 3`. | P1 |
| `pi` | `pi()` | Number | 3.141592653589793 | P1 |
| `e` | `e()` | Number | 2.718281828459045 | P1 |
| `toNumber` | `toNumber(Any)` | Number | Parses a number from text; `toNumber(true) = 1`; **`toNumber(now())` returns the Unix ms timestamp**. | P1 |

> **`unaryMinus` / `unaryPlus` do not appear in the current documentation.** Formulas 1.0 had them. `UNRESOLVED:` whether they still parse.
> **No trigonometric functions** (`sin`, `cos`, `tan`, …) are documented anywhere. `UNRESOLVED:` whether they exist.
> **No `random()`** — explicitly confirmed absent [P1].

### 3.3 String (16)

| Name | Signature | Returns | Description | Src |
|---|---|---|---|---|
| `length` | `length(Text \| List)` | Number | Character count, or element count for a list. | P1 |
| `substring` | `substring(Text, Number, Number?)` | Text | Start index **inclusive**, end index **optional and exclusive**. `substring("Notion",0,3)="Not"`; `substring("Notion",3)="ion"`. | P1 |
| `contains` | `contains(Text, Text)` | Boolean | True if the search string is present. **Case-sensitive, plain substring** (not regex). | P1 |
| `lower` | `lower(Text)` | Text | Lowercase. | P1 |
| `upper` | `upper(Text)` | Text | Uppercase. | P1 |
| `repeat` | `repeat(Text, Number)` | Text | Repeats text N times. | P1 |
| `trim` | `trim(Text)` | Text | Removes whitespace from both ends. | P1 |
| `padStart` | `padStart(Text, Number, Text)` | Text | Pads the start to a target length. `padStart("hello",8,".")` → `"...hello"`. | **P2** |
| `padEnd` | `padEnd(Text, Number, Text)` | Text | Pads the end to a target length. | **P2** |
| `split` | `split(Text, Text)` | List\<Text\> | Splits text by a separator. | P1 |
| `join` | `join(List, Text)` | Text | Joins list values with a separator between each. | P1 |
| `format` | `format(Any)` | Text | Value formatted as text. `format(now())` → `"August 30, 2023 17:55"`. | P1 |
| `formatNumber` | `formatNumber(Number, Text?, Number?)` | Text | Number as a styled string. **The official page lists it with no description at all** — full semantics in §3.5. | P1 (name) / **P2** (semantics) |
| `link` | `link(Text, Text)` | Text (rich) | Creates a hyperlink from label + URL. `link("Notion","https://notion.so")`. | P1 |
| `style` | `style(Text, ...Text)` | Text (rich) | Adds styles and colours — §3.9. | P1 |
| `unstyle` | `unstyle(Text, ...Text?)` | Text (rich) | Removes formatting styles. *"If no styles are specified, all styles are removed."* | P1 |

### 3.4 Regex (4)

**All four take the regex as a plain string argument.**

| Name | Signature | Returns | Description | Src |
|---|---|---|---|---|
| `test` | `test(Text, Text)` | Boolean | True if the value matches the regular expression. `test("Notion","\\d") = false`. | P1 |
| `match` | `match(Text, Text)` | List\<Text\> | **All** matches as a list. `match("Notion 123 Notion 456","\\d+") = ["123","456"]`. | P1 |
| `replace` | `replace(Text, Text, Text)` | Text | Replaces the **first** match. | P1 |
| `replaceAll` | `replaceAll(Text, Text, Text)` | Text | Replaces **all** matches. | P1 |

#### Regex dialect

**ECMAScript / JavaScript `RegExp` flavour, with no flags.** Notion never names the engine, but the community reference exhaustively enumerates supported and unsupported constructs **[P2]** ([regular expressions in Notion formulas](https://thomasjfrank.com/formulas/regular-expressions-in-notion-formulas/)), and the feature set is exactly JS-without-flags:

**Supported:**
- Escapes: `\u0000`, `\000` (octal), `\x00` (hex), `\n`, and escaped metacharacters `\.` `\?` `\$` `\*` `\+` `\^` `\(` `\)` `\[` `\]` `\{` `\}` `\|` `\/` `\\` `\"`
  - *Note:* octal and hex references **only work inside the regex argument**, not in the input string or replacement string.
- Character classes: `\w` `\W` `\d` `\D` `\s` `\S`, `[...]`, `[^...]`, ranges. **Character class subtraction is NOT supported.**
- Quantifiers: `*` `+` `?` `{n}` `{n,}` `{n,m}` and lazy variants `*?` `+?` `??` `{n}?` `{n,}?` `{n,m}?`
- Anchors: `^` `$` `\b` `\B`
- Grouping: `(...)` capture, `(?<name>...)` **named capture**, `(?:...)` non-capturing
- Substitutions in the replacement string: `$n`, `` $` ``, `$'`, `$&`, `$<name>`
- Backreferences: `\1`, `\k<name>`
- Alternation: `|`
- Lookarounds: `(?=)` `(?!)` **and lookbehind** `(?<=)` `(?<!)`

**Not supported:** `\A` `\z` `\Z`, `\p{name}` / `\P{name}` (Unicode property escapes), `$+`, `$_`, atomic groups `(?>...)`, conditionals `(?(expr)yes|no)`.

**Flags/modifiers are not supported at all** — *"so use `lower` or `upper` when needed"* for case-insensitive matching **[P2]**. Word characters for `\b` are `A-Za-z0-9_` **[P2]**.

`UNRESOLVED:` whether `match` returns full matches only or includes capture groups, and its behaviour when the pattern has groups. The docs only show group-free patterns.
`UNRESOLVED:` whether `replace`/`replaceAll` treat the *replacement* string's `$` specially in all positions, and how to emit a literal `$`.

### 3.5 `formatNumber` format strings **[P2]**

`formatNumber(Number, format?, precision?)` — `precision` is decimal places **0–12**. **Defaults to `"commas"`** when no format is given. Returns a **string** (no further math possible). Source: [formatNumber](https://thomasjfrank.com/formulas/functions/formatnumber/).

Non-currency formats: `commas` (`12345`→`12,345`), `percent` (`0.856`→`85.6%`), `humanize` **or** `compact` (`1234567`→`1.2M`), `bytes_decimal` (`12345678`→`12.35 MB`), `bytes_binary` **or** `bytes` (`12345678`→`12.06 KiB`).

Currency formats (with aliases): `usd`/`dollar`, `eur`/`euro`, `jpy`/`yen`, `aud`, `cad`, `sgd`, `gbp`, `rub`, `inr`, `krw`, `cny`, `brl`, `try`, `idr`, `chf`, `hkd`, `nzd`, `sek`, `nok`, `mxn`, `zar`, `twd`, `dkk`, `pln`, `thb`, `huf`, `czk`, `ils`, `clp`, `php`, `aed`, `cop`, `sar`, `myr`, `ron`, `ars`, `uyu`, `pen`.

Quirks: `humanize` **ignores** `precision`; the `bytes_*` formats respect `precision` but do not pad insignificant decimals (`formatNumber(1, "bytes_decimal", 4)` → `1 B`, not `1.0000 B`).

### 3.6 Date & time (19)

| Name | Signature | Returns | Description | Src |
|---|---|---|---|---|
| `now` | `now()` | Date | Current date **and time**, in the viewer's local time zone. | P1 |
| `today` | `today()` | Date | Current date **without** the time. | P1 |
| `minute` | `minute(Date)` | Number | 0–59 | P1 |
| `hour` | `hour(Date)` | Number | 0–23 | P1 |
| `day` | `day(Date)` | Number | **Day of week, 1 = Monday … 7 = Sunday.** | P1 |
| `date` | `date(Date)` | Number | **Day of month, 1–31.** | P1 |
| `week` | `week(Date)` | Number | **ISO** week of year, 1–53. | P1 |
| `month` | `month(Date)` | Number | 1–12 | P1 |
| `year` | `year(Date)` | Number | Four-digit year. | P1 |
| `dateAdd` | `dateAdd(Date, Number, Text)` | Date | Adds time. Unit list below. | P1 |
| `dateSubtract` | `dateSubtract(Date, Number, Text)` | Date | Subtracts time. Same units. | P1 |
| `dateBetween` | `dateBetween(Date, Date, Text)` | Number | Difference between two dates. Same units. Sign: `dateBetween(a, b, u)` = a − b (see below). | P1 |
| `dateRange` | `dateRange(Date, Date)` | Date (with end) | Builds a date range from start and end. | P1 |
| `dateStart` | `dateStart(Date)` | Date | Start of the range. | P1 |
| `dateEnd` | `dateEnd(Date)` | Date | End of the range. | P1 |
| `timestamp` | `timestamp(Date)` | Number | Unix **milliseconds** since 1970-01-01. | P1 |
| `fromTimestamp` | `fromTimestamp(Number)` | Date | Date from Unix ms. **"the returned date will not retain the seconds & milliseconds."** | P1 |
| `formatDate` | `formatDate(Date, Text, Text?)` | Text | Formats a date. Third arg = time zone — §3.6.2. | P1 (2-arg) / **P2** (3rd arg) |
| `parseDate` | `parseDate(Text)` | Date | Parses **ISO 8601**. `parseDate("2022-01-01")` → `@January 1, 2022`. | P1 |

#### 3.6.1 Unit strings for `dateAdd` / `dateSubtract` / `dateBetween`

**Official, complete list** [P1] — identical for all three functions:

```
"years"  "quarters"  "months"  "weeks"  "days"  "hours"  "minutes"
```

**There is no `"seconds"` and no `"milliseconds"` unit.** This is a real limitation, not an omission in my research — the official reference enumerates the units three separate times (once per function) and stops at `"minutes"` [P1].

**Singular forms appear to be accepted too.** Notion's own documentation uses `dateAdd(Start Date, 2, "week")` [P1] ([intro to formulas](https://www.notion.com/help/formulas)) and `Date.dateAdd(1, "day")` [P1] ([common formula errors](https://www.notion.com/help/common-formula-errors)) — singular — while the reference page's normative list is plural. `UNRESOLVED:` whether singular units are officially supported or Notion's help pages contain a long-standing inconsistency. A tolerant parser should accept both; a strict one has no documented basis for choosing.

**Sign convention for `dateBetween`:** official examples [P1]:
- `dateBetween(now(), parseDate("2022-09-07"), "days") = 357` (now is *later*, result positive)
- `dateBetween(dateStart(range), dateEnd(range), "days") = -365`
- `dateBetween(dateEnd(range), dateStart(range), "days") = 365`

So `dateBetween(a, b, u)` measures **a − b** (first argument minus second). Note this is the *opposite* of the naïve "b − a" reading, and the second example is the authoritative one.

`UNRESOLVED:` rounding/truncation rule for `dateBetween` with coarse units (does `dateBetween` truncate toward zero, floor, or round?). `dateBetween(parseDate("2030-01-01"), now(), "years") = 6` in the 2023-dated docs is consistent with truncation but is not stated.

#### 3.6.2 `formatDate` tokens

**Notion uses [Luxon](https://moment.github.io/luxon/) internally but retains Moment.js-style tokens** **[P2]** ([formatDate](https://thomasjfrank.com/formulas/functions/formatdate/)). The official page names only five tokens (`YYYY`, `MM`, `DD`, `h`, `mm`) [P1] yet its own examples use `MMMM`, `D`, `Y`, and `A` — so the official list is incomplete. The full table below is **[P2]**.

**Time**

| Token | Meaning | Example |
|---|---|---|
| `A` / `a` | Meridiem upper/lower | `PM` / `pm` |
| `H` / `HH` | 24-hour, unpadded / padded to 2 | `4` / `04` |
| `h` / `hh` | 12-hour, unpadded / padded to 2 | `4` / `04` |
| `k` / `kk` | 1-based 24-hour, unpadded / padded | `4` / `04` |
| `m` / `mm` | Minute, unpadded / padded | `8` / `08` |
| `s` / `ss` | Second, unpadded / padded * | `0` / `00` |
| `S` / `SS` / `SSS` | Fractional seconds * | `0` / `00` / `000` |
| `LT` / `LTS` | Localized 12-hour time, without / with seconds * | `4:08 PM` / `4:08:00 PM` |

\* Parsed, but **Notion only stores time to the minute, so seconds always render as 0** **[P2]**.

**Days**

| Token | Meaning | Example |
|---|---|---|
| `D` / `Do` / `DD` | Day of month: plain / ordinal / padded | `21` / `21st` / `21` |
| `DDD` / `DDDo` / `DDDD` | Day of **year**: plain / ordinal / padded to 3 | `294` / `294th` / `294` |
| `d` / `do` | Zero-based day of week: plain / ordinal | `3` / `3rd` |
| `dd` / `ddd` / `dddd` | Localized weekday name: 2-letter / 3-letter / full | `We` / `Wed` / `Wednesday` |
| `E` | ISO day of week | `3` |
| `e` | Localized day of week | `3` |

**Weeks:** `w` / `wo` / `ww` (week of year: plain / ordinal / padded); `W` / `Wo` / `WW` (**ISO** week of year).

**Months:** `M` / `Mo` / `MM` (numeric); `MMM` / `MMMM` (localized name, 3-letter / full).

**Quarters:** `Q` / `Qo` / `QQ`.

**Years:** `Y` (ISO year), `YY` (2-digit), `YYYY` (4-digit), `YYYYYY` (expanded, `+002015`), `gg` / `gggg` (week year), `GG` / `GGGG` (ISO week year).

**Timestamp:** `X` (Unix seconds), `x` (Unix milliseconds).

**Time zone:** `Z` (`-07:00`), `ZZ` (`-0700`), `ZZZ` (`Pacific Daylight Time`).

**Composite:** `L` / `l`, `LL` / `ll`, `LLL` / `lll`, `LLLL` / `llll` (localized date, date+name, date+time, weekday+date+time — lowercase variants abbreviate).

**Escaping:** square brackets — `formatDate(now(), "[Month of] MMMM, YYYY")` → `Month of June, 2022`.

**Third argument — time zone [P2]:** `formatDate(prop("Date"), "YYYY-MM-DD HH:mm", "EST")`. Accepts IANA zones (`America/Chicago`), abbreviations (`EST`), and offsets (`GMT+1`, `UTC-5`) — *"any other format supported by the Luxon date library."* Default is the viewer's system time zone.

**Critical constraint [P2]:** `formatDate` returns a **string**, so its output cannot feed `dateAdd`/`dateSubtract`, cannot be compared with `<`/`>` meaningfully, and **cannot be used to build a date-based view filter**. The documented round-trip is `parseDate(formatDate(d, "YYYY-MM-DD"))`.

### 3.7 List (18 list-specific, plus `length`/`join`/`split`/`sum`/`min`/`max`/`median`/`mean` which also accept lists)

| Name | Signature | Returns | Description | Src |
|---|---|---|---|---|
| `at` | `at(List, Number)` | Any | Element at a **zero-based** index. `at([1,2,3],1)=2`. | P1 |
| `first` | `first(List)` | Any | First element. | P1 |
| `last` | `last(List)` | Any | Last element. | P1 |
| `slice` | `slice(List, Number, Number?)` | List | Start inclusive, end optional & exclusive. `slice([1,2,3],1,2)=[2]`. **Same name as no string `slice`** — see note. | P1 |
| `concat` | `concat(...List)` | List | Concatenation of multiple lists. | P1 |
| `sort` | `sort(List)` / `sort(List, expr)` | List | Sorted order. Optional `current`-expression acts as a **sort key/comparator**. | P1 / **P2** (2-arg) |
| `reverse` | `reverse(List)` | List | Reversed. | P1 |
| `unique` | `unique(List)` | List | Distinct values. `unique([1,1,2])=[1,2]`. | P1 |
| `includes` | `includes(List, Any)` | Boolean | True if the list contains the value. | P1 |
| `find` | `find(List, expr)` | Any | First element where the condition is true; **Empty** if none. | P1 |
| `findIndex` | `findIndex(List, expr)` | Number | Index of first match; **`-1`** if none. | P1 |
| `filter` | `filter(List, expr)` | List | Elements where the condition is true. | P1 |
| `some` | `some(List, expr)` | Boolean | Any element satisfies the condition. | P1 |
| `every` | `every(List, expr)` | Boolean | All elements satisfy the condition. | P1 |
| `map` | `map(List, expr)` | List | Result of the expression per element. `current` and `index` bound. | P1 |
| `flat` | `flat(List)` | List | Flattens **one** level. **No depth argument.** | P1 |
| `count` | `count(List)` / `count(List, expr)` | Number | Element count, or count of elements satisfying the condition. | **P2** |
| `splice` | `splice(List, Number, Number?, ...Any)` | List | Non-mutating remove-and/or-insert at an index. Mirrors JS `Array.prototype.toSpliced()`. | **P2** |

Notes:
- **`length` is the list-length function** [P1] (`length([1,2,3]) = 3`); `count` is the community-documented alias that additionally takes a predicate **[P2]**.
- `slice` is documented on lists [P1]; the *string* equivalent is `substring` [P1]. `UNRESOLVED:` whether `slice` also works on strings.
- `sort` default ordering **[P2]** ([sort](https://thomasjfrank.com/formulas/functions/sort/)): String A→Z; Number ascending; Boolean `false` then `true`; Date earlier→later; nested List compared as a comma-joined string; Page and Person compared as strings. **Mixed-type lists are compared entirely as strings**, but the returned elements keep their original types.
- `splice` **[P2]**: `startIndex` may be negative (counts from the end; `-1` is the last element, there is no `-0`). If `startIndex >= length` or `startIndex < -length`, any `deleteCount` is ignored and the call only inserts. Deletion starts **at** `startIndex`, not after it.
- **There is no `reduce`.** No fold/accumulate function is documented anywhere. Accumulation is done with `let`/`lets` plus `map`/`filter`/`sum` **[P2]**.
- **There is no `push`, `pop`, `indexOf`, `keys`, `values`, or `entries`.**

### 3.8 Page / Person / relation (3 + patterns)

| Name | Signature | Returns | Description | Src |
|---|---|---|---|---|
| `id` | `id()` / `id(Page)` / `id(Person)` | Text | Page id (current page if no argument), or a user id. Returned **without dashes**. | P1 / **P2** (Person overload) |
| `name` | `name(Person)` | Text | The person's name. | P1 |
| `email` | `email(Person)` | Text | The person's email, as plain text. | P1 |

**Documented traversal patterns** (these are the idioms, not separate functions):

```
prop("Relation").length()                                   -- count related pages           [P1]
prop("Relation").first().prop("Created By")                 -- one related page's property   [P2]
prop("Relation").map(current.prop("Created Time"))          -- list over related pages       [P2]
prop("Tasks").filter(current.prop("Status") !== "Done")     -- filter related pages          [P1]
prop("Relation").map(current.id())                          -- ids of related pages          [P2]
prop("Assignees").map(current.email())                      -- emails of a Person list       [P1]
prop("Pioneers").map(name(current)).join(", ")              -- "Grace Hopper, Ada Lovelace"  [P1]
prop("Task ID").split("-").first()                          -- Unique-ID prefix              [P1]
Parent Task.Sub-item.every(current.Status == "Done")        -- bare-token traversal          [P1]
```

Notion's error guide is explicit that relation/rollup/person properties yield **lists**, and that you must narrow with `.first()`/`.at(0)` or iterate — otherwise an automation pauses [P1] ([common formula errors](https://www.notion.com/help/common-formula-errors)).

### 3.9 Styled / rich return values

| Name | Signature | Src |
|---|---|---|
| `style` | `style(Text, ...Text)` — variadic style tokens, **order does not matter** | P1 / **P2** |
| `unstyle` | `unstyle(Text, ...Text?)` — no tokens ⇒ remove all styles | P1 |
| `link` | `link(label: Text, url: Text)` | P1 |
| `format` | `format(Any) -> Text` — plain, unstyled stringification | P1 |
| `formatNumber` | see §3.5 | P1 / **P2** |

**Accepted `style` arguments** [P1] ([formula-syntax](https://www.notion.com/help/formula-syntax), verbatim):

- Formatting: `"b"` (bold), `"u"` (underline), `"i"` (italics), `"c"` (code), `"s"` (strikethrough).
- Colours: `"gray"`, `"brown"`, `"orange"`, `"yellow"`, `"green"`, `"blue"`, `"purple"`, `"pink"`, `"red"`.
- Backgrounds: *"Add `_background` to colors to set background colors"* — i.e. `"gray_background"` … `"red_background"` (9 values).
- **[P2]** adds `"default"` as a text colour (no background counterpart), and states that **only one text colour and one background colour** may apply — *"If multiple text or background color arguments are added the last argument will be used."* ([style](https://thomasjfrank.com/formulas/functions/style/)).

Examples: `style("Notion", "b", "u")`, `style("Notion", "blue", "gray_background")`, `"Tony Tony Chopper".style("s", "yellow_background")`.

**These render as Notion rich text annotations** — bold/italic/underline/strikethrough/code flags plus colour and background colour, matching the `annotations` object of the API's [rich text object](https://developers.notion.com/reference/rich-text). `link()` produces a rich-text link annotation.

**There is no `mention()` function.** I searched the official reference, the intro guide, the errors guide, and the full community function index — no `mention` exists. `UNRESOLVED:` whether a page/person **mention** can be produced from a formula at all. (`link("Call", "tel:" + prop("Phone"))` [P1] shows the intended workaround shape for making clickable output.)

### 3.10 Variables and references

| Name | Signature | Src |
|---|---|---|
| `prop` | `prop(Text)` — property of the current page; `page.prop(Text)` — property of another page | P1 |
| `context` | `context(Text)` — automation context variable (§2.6) | **P2** |
| `let` | `let(name, value, ..., expr)` | P1 |
| `lets` | `lets(name, value, ..., expr)` | P1 |

---

### 4. Semantics that matter for reimplementation

### 4.1 Evaluation model and recomputation

- **Formula properties are strictly read-only.** *"You cannot click into a formula and directly change that formula's output on a per-database-row basis."* The value is determined **solely** by (a) the formula expression and (b) the properties it references **[P2]** ([formulas in database filters](https://thomasjfrank.com/formulas/formulas-in-database-filters/)). The API confirms: formula values "can't be updated directly" ([property object](https://developers.notion.com/reference/property-object)).
- **Formulas can reference other formulas**, in the same database or a different one, directly or through rollups [P1] (§4.3).
- Formula *expressions* are stored as a single string in `formula.expression`, e.g. `"prop(\"Price\") / 2"` ([property object](https://developers.notion.com/reference/property-object)) — the language has no separate AST wire format.

**`UNRESOLVED — and this is the biggest gap: when exactly `now()` / `today()` are re-evaluated.** Notion publishes nothing on this. What I could establish:
- `now()` and `today()` are documented as returning the current moment "in your local timezone", set automatically from the **system/OS time zone** **[P2]** ([now](https://thomasjfrank.com/formulas/functions/now/), [today](https://thomasjfrank.com/formulas/functions/today/)) — which strongly implies **client-side evaluation at render time**, since a server has no access to the viewer's OS zone.
- A secondary summary states `now()` "will recalculate the current time whenever the database is reloaded", but I could not trace this to a primary source and am **not** treating it as established.
- Counter-evidence that evaluation is *also* server-side: the Public API returns computed formula values without any client involved ([page property values](https://developers.notion.com/reference/page-property-values)), and view filters on date-typed formulas work server-side.
- The most likely real architecture is **dual evaluation** — client-side for display (local time zone), server-side for API/filter/sort — but **this is inference, not documentation.** Probe empirically before designing caching.

`UNRESOLVED:` whether Notion has any scheduled/background re-materialization of `now()`-dependent formulas, or whether a stale row simply shows a stale value until something reads it.

### 4.2 Can formulas reference rollups, and rollups reference formulas?

**Yes, both directions**, and each direction consumes depth budget.

- Formula → rollup: the official property table lists `Rollup` as referenceable, returning "Number, date, or list of any type" [P1].
- Rollup → formula: implied by the depth rule, which says *"Every time a formula references another formula **or rollup**, it adds a layer"* [P1], and demonstrated by the "Rollup Cascade" example where a rollup carries a formula's value into another row's formula **[P2]** ([property reference limits](https://thomasjfrank.com/formulas/property-reference-limits/)).
- Formulas 2.0 explicitly reduced the *need* for rollups: you can now "pinpoint the exact information you need in a related database, without having to first create a rollup" [P1] ([what's changed](https://www.notion.com/help/guides/new-formulas-whats-changed)).

### 4.3 Depth limits and cycles

**The one hard, officially-published number:**

> **"Notion formulas can only be 15 layers deep. Every time a formula references another formula or rollup, it adds a layer. This applies even if the formula is in a different database. When this limit is reached, Notion will show an error message."**
> — [P1] [Fix common formula errors](https://www.notion.com/help/common-formula-errors)

Supporting detail **[P2]** ([property reference limits](https://thomasjfrank.com/formulas/property-reference-limits/)):
- The limit was **raised from 7 to 15 in August 2024**.
- It applies **across databases**, including via rollups.
- Historically, exceeding it **failed silently** — the chain simply stopped producing correct values with no alert. (Notion's own page now says an error is shown, so this has been improved; treat the community note as historical.)
- The limit is on the **reference chain depth**, *not* on how many properties one formula may reference: *"This does not mean you can only reference seven properties in a single formula. You can reference many, many more if you want."*

**Cycles.** The depth limit is described as existing "to prevent both exponential calculations and to prevent circular logic". Notion also refuses self-reference — a property cannot reference itself.

`UNRESOLVED:` the exact behaviour on a genuine cycle — whether Notion performs static cycle detection at save time (rejecting the formula) or only relies on the depth cap at evaluation time, and the exact error text. I found no primary documentation for cycle handling specifically, only the depth cap.

### 4.4 Depth of related-page traversal

A formula can read properties of related pages directly (§3.8). Each such hop through a **formula or rollup** property costs a depth layer [P1]; reading a *plain* property of a related page appears not to. The 25-reference API cap (§4.6) constrains how much of a traversal is visible externally.

`UNRESOLVED:` whether there is a separate cap on relation-traversal *chain* length (e.g. `A.rel.first().rel.first().rel…`) independent of the 15-layer formula/rollup rule.

### 4.5 Other limits

| Limit | Value | Source |
|---|---|---|
| Formula/rollup reference chain depth | **15 layers** | [P1] |
| API: inline page or person references returned for a formula property by *Retrieve a page* | **25** (use *Retrieve a page property item* to paginate beyond) | [page property values](https://developers.notion.com/reference/page-property-values) |
| API: formula value becomes `"unsupported"` | when it "depends on too many related pages or nested formulas and rollups" — no threshold published | [changelog, 2026-08-05](https://developers.notion.com/page/changelog) |
| Rich-text `text.content` (a formula's string output written into a property) | 2000 characters | [request limits](https://developers.notion.com/reference/request-limits) |
| Number display | switches to scientific notation above **21 digits** in the property (full number shown in the editor) | **[P2]** |
| `formatNumber` precision | 0–12 decimal places | **[P2]** |

`UNRESOLVED:` **maximum formula source length in characters.** Nothing published. The 2000-character rich-text limit is about property *values*, not formula source.
`UNRESOLVED:` **maximum expression nesting depth within a single formula** (as opposed to across properties). Nothing published.
`UNRESOLVED:` **maximum list size** a formula may construct or process. Nothing published; the 25 is an API *serialization* cap, not an evaluation cap.

### 4.6 How formula results surface in the API

**Only four result types cross the API boundary**, plus an unavailable marker ([page property values](https://developers.notion.com/reference/page-property-values)):

```json
{
  "Days until launch": {
    "id": "CSoE",
    "type": "formula",
    "formula": { "type": "number", "number": 56 }
  }
}
```

`formula.type` ∈ `"boolean"` | `"date"` | `"number"` | `"string"` | `"unsupported"`.

**This is a lossy projection of the seven-type language.** `List`, `Person`, and `Page` have no dedicated API result type. A `"unsupported"` result is returned as `{"type":"unsupported","unsupported":{}}` with **no partial value** — added 2026-08-05 ([changelog](https://developers.notion.com/page/changelog)).

`UNRESOLVED:` exactly how a `List`/`Person`/`Page`-returning formula is serialized — whether it becomes `"string"` (rendered/joined), or `"unsupported"`, or something else. The 25-reference note ("a maximum of 25 inline page or person references for a `formula` property") proves such formulas *do* return something structured, but the docs never show its shape. This matters if you intend API parity.

### 4.7 Filtering and sorting a view by a formula

**Yes — and the available operators depend entirely on the formula's return type.**

**API** ([filter data source entries](https://developers.notion.com/reference/post-database-query-filter)): *"The primary field of the `formula` filter condition object matches the type of the formula's result."* The `formula` filter object accepts exactly one of four sub-objects, each reusing the corresponding scalar filter grammar:

| Field | Reuses | 
|---|---|
| `checkbox` | checkbox filter condition |
| `date` | date filter condition |
| `number` | number filter condition |
| `string` | **rich text** filter condition |

Note the mapping: a Boolean-returning formula filters as `checkbox`; a String-returning formula filters as `string`/rich text. There is **no** `formula.list`, `formula.people`, or `formula.relation` filter.

**UI operators by formula output type [P2]** ([formulas in database filters](https://thomasjfrank.com/formulas/formulas-in-database-filters/)):

| Output type | Available filter operators |
|---|---|
| **String** | Is, Is not, Contains, Does not contain, Starts with, Ends with, Is empty, Is not empty |
| **Number** | `=`, `≠`, `>`, `<`, `≥`, `≤`, Is empty, Is not empty |
| **Date** | Is, Is before, Is after, Is on or before, Is on or after, Is within, Is empty, Is not empty — with relative values Today, Tomorrow, Yesterday, One week ago, One week from now, One month ago, One month from now, Custom date |
| **Boolean/Checkbox** | Is / Is not × Checked / Unchecked |
| **List / Person / Page** | *"Information coming soon"* — **undocumented** |

**Sorting**: the API's sort object takes a property name with a direction, with no type restriction ([sort data source entries](https://developers.notion.com/reference/post-database-query-sort)) — so formula properties are sortable like any other.

**Two behavioural rules that fall out of read-only-ness [P2]:**
1. **A filter on a formula cannot act as a forcing function.** Filters set values on writable properties when you create a row in a filtered view; they cannot do this for a formula (or Rollup, Created by/time, Last edited by/time). If the filter doesn't match the formula's *default* output, new rows created in that view will not appear in it.
2. `Created by` / `Created time` / `Last edited by` / `Last edited time` are **momentarily empty** at row creation, so formulas depending on them are momentarily empty too — which interacts badly with rule 1.

`UNRESOLVED:` whether a `formatDate()`-produced string can be date-filtered — **[P2]** says explicitly it **cannot** ("it is also not possible to create date-based filters in a database view using a formula property that outputs a date string via `formatDate()`"), which is consistent with it being typed `String`. Confirmed enough to rely on.

---

### 5. Formulas 1.0 → 2.0: what changed (for migration awareness)

From [P1] ([Formulas 2.0: what's changed](https://www.notion.com/help/guides/new-formulas-whats-changed)):

- **Before 2.0, formulas "only supported text, numeric, and checkbox (boolean) outputs."** 2.0 added **Date, Person, Page, and List** outputs.
- **Dot notation** was introduced.
- **`let` / `lets`** local variables were introduced.
- **Direct related-database access** without an intermediate rollup.
- **New functions** including `match()` and `style()` (Notion names only these two explicitly and says "there's several new functions").
- **Editor**: multi-line editing, tabs, comments, inline type-checking, error highlighting.
- **Automatic migration was applied and is visible in existing formulas.** Notion rewrote 1.0 formulas that referenced rollup / person / file / multi-select properties in order to preserve the old text output — e.g. `prop("Person")` became **`prop("Person").map(current.format()).join(", ")`** [P1]. If you ingest real-world Notion formula strings, expect this shape.
- `formula.expression`'s serialization format changed at the 2023-09-06/07 API rollout ([changelog](https://developers.notion.com/page/changelog)).

`UNRESOLVED:` **the authoritative list of functions removed or renamed between 1.0 and 2.0.** Notion never published one. Names present in 1.0 but absent from the current reference: `larger`, `largerEq`, `smaller`, `smallerEq`, `unaryMinus`, `unaryPlus`, `start`, `end`, `toText`. The community reference's URLs for `/functions/start/` and `/functions/end/` now 404, and `and`/`or`/`not` survive only as operator built-ins with function forms. Whether any of these still *parse* for backwards compatibility is unknown — do not assume either way.

---

### 6. Consolidated UNRESOLVED list

**Type system**
1. Whether the type checker parameterises list element types (`List<Number>`) or treats all lists as `List<Any>`.
2. Whether a formula-produced Date carries a time-zone tag that survives into a Date property.
3. Whether a bare `Page` value coerces to its title in string concatenation; what `format(page)` returns.
4. Runtime behaviour of arithmetic/parse edge cases: `divide(1,0)`, `sqrt(-1)`, `ln(0)`, `toNumber("abc")`, `parseDate("garbage")`, `at(list, 99)`.

**Syntax**
5. Precedence of `%` (mod) — omitted from the only published precedence table.
6. Precedence/associativity of **unary minus** — entirely absent from documentation.
7. Precedence of the `.` method-call operator.
8. Whether `!==` (seen once in Notion's own docs) is a real token or a typo alongside `!=`.
9. Whether `TRUE`/`True`, `OR`/`Or`, `NOT`/`Not` are case-insensitive (only `AND`/`And` is documented as such).
10. Whether `//` line comments exist; whether block comments nest.
11. Exact backslash-escaping rule at the string↔regex boundary (`"\\d"` in Notion's docs vs `"\d"` in the community reference).
12. The textual grammar of bare property tokens (`Start Date` with an embedded space) — likely non-textual editor chips.
13. Whether bindings inside one `lets(...)` are sequential (can `var2` reference `var1`?).
14. Whether shadowing an outer `lets` variable in an inner one is legal.
15. What `variable.lets(...)` (the dot form listed for `lets`) actually means.
16. Truthiness rule for non-Boolean `if`/ternary conditions (`if(Date, …)`, `list ? … : …` appear in official examples).
17. Whether nullary functions (`now()`, `pi()`, `id()`) have any dot form.
18. Whether a two-argument `prop(page, "X")` parses, or only `page.prop("X")`.

**Functions**
19. Whether the 1.0 comparison-function aliases `larger` / `largerEq` / `smaller` / `smallerEq` still parse.
20. Whether `unaryMinus` / `unaryPlus` / `start` / `end` / `toText` still parse.
21. Whether trigonometric functions exist at all.
22. Whether `slice` works on strings as well as lists.
23. Whether `match` returns capture groups or full matches only when the pattern has groups.
24. Whether `$` in a `replace`/`replaceAll` replacement string can be emitted literally, and how.
25. Whether `index` is bound inside `filter`/`find`/`some`/`every`/`sort`/`count`, or only inside `map`.
26. Whether a third implicit lambda variable (the source list) exists.
27. Whether **singular** date units (`"day"`, `"week"`) are officially supported — Notion's own help pages use both singular and plural.
28. `dateBetween` rounding/truncation rule for coarse units.
29. Whether a page/person **mention** can be produced from a formula (no `mention()` function exists).
30. Confirmation that `padStart`, `padEnd`, `count`, `splice` are real — they are absent from Notion's official reference but fully documented with examples by the community reference.

**Semantics**
31. **When `now()` / `today()` are re-evaluated** — client-render vs server vs both; whether there is background re-materialization. *(Highest-value open question for a caching design.)*
32. Behaviour on a genuine reference cycle: static rejection at save time vs runtime depth-cap error; exact error text.
33. Whether relation-traversal chain length is capped independently of the 15-layer formula/rollup rule.
34. Maximum formula **source length** in characters.
35. Maximum expression **nesting depth within a single formula**.
36. Maximum **list size** a formula may construct or process (the API's 25 is a serialization cap, not an evaluation cap).
37. How `List` / `Person` / `Page`-returning formulas are **serialized in the API** (the 25-reference note proves something structured is returned, but no shape is documented).
38. UI filter operators available for `List`, `Person`, and `Page`-returning formulas (Notion/community both say "coming soon").
39. The authoritative list of functions removed/renamed from 1.0 → 2.0.

## I. Querying — filters, sorts, grouping, aggregations


**Primary-source reference compiled 2026-08-08.** Target: a from-scratch clone (filter AST → parameterized SQL compiler) on Postgres + FastAPI + Next.js. This is a pure Notion feature inventory — no implementation design.

### 0. Source landscape and API-version context

Notion's API went through a breaking change in version `2025-09-03`: databases were split into **databases** (containers) and **data sources** (the schema + rows). Query moved from `POST /v1/databases/{id}/query` to `POST /v1/data_sources/{id}/query`. Filter/sort JSON shapes were carried over unchanged ([FAQs: Version 2025-09-03](https://developers.notion.com/docs/upgrade-faqs-2025-09-03), [Working with views](https://developers.notion.com/guides/data-apis/working-with-views)).

The docs site is now Mintlify-hosted and every page has a raw-markdown twin at `<url>.md`, plus an index at [llms.txt](https://developers.notion.com/llms.txt). The current examples ship `Notion-Version: 2026-03-11`.

Three source tiers are used below, and they **disagree in places** (§8 lists every conflict):

| Tier | Source | Authority |
|---|---|---|
| A | The embedded OpenAPI schema inside [Query a data source](https://developers.notion.com/reference/query-a-data-source) (`.md` twin, `components.schemas.propertyFilter` et al.) | **Highest** — machine-readable, exhaustive, enumerates every operator |
| B | Prose reference: [Filter data source entries](https://developers.notion.com/reference/filter-data-source-entries), [Sort data source entries](https://developers.notion.com/reference/sort-data-source-entries), [Working with views](https://developers.notion.com/guides/data-apis/working-with-views) | High — but demonstrably incomplete vs. tier A |
| C | Help Center: [Views, filters, sorts & groups](https://www.notion.com/help/views-filters-and-sorts), [Tables](https://www.notion.com/help/tables), [Boards](https://www.notion.com/help/boards), [Relations & rollups](https://www.notion.com/help/relations-and-rollups) | UI surface only; partly stale |

A **major find**: as of the 2025-09-03+ line there is now a **public View API** (`POST /v1/views`, `PATCH /v1/views/{id}`, `GET /v1/views`) which exposes grouping, sub-grouping, and aggregation configuration that was previously UI-only. That is documented in [Working with views](https://developers.notion.com/guides/data-apis/working-with-views) and is the authoritative source for §4 and §5.

---

### 1. Filters — the complete operator matrix

#### 1.1 Which property types are filterable

Per the OpenAPI `propertyFilter` union ([Query a data source](https://developers.notion.com/reference/query-a-data-source)), exactly **22 property types** accept a filter, each keyed by its own type name:

`title`, `rich_text`, `number`, `checkbox`, `select`, `multi_select`, `status`, `date`, `people`, `files`, `url`, `email`, `phone_number`, `relation`, `created_by`, `created_time`, `last_edited_by`, `last_edited_time`, `formula`, `unique_id`, `rollup`, `verification`

Plus a property-less **`timestamp`** pseudo-filter (§1.9).

**Not filterable via the API:** `button`, `place`, `last_visited_time`. None of these appear in the `propertyFilter` union, though `button` and `place` do appear in the *response* value schemas (`buttonSimplePropertyValueResponse`, `placeSimplePropertyValueResponse`). `last_visited_time` does not appear at all.

> Note the prose page's own summary table ([Filter data source entries](https://developers.notion.com/reference/filter-data-source-entries)) lists only 15 keys and **omits `title`, `url`, `email`, `created_by`, `created_time`, `last_edited_by`, `last_edited_time`, `unique_id`** while listing `ID` as a separate thing. The OpenAPI union is correct; the prose table is a lossy summary.

#### 1.2 The five reusable condition shapes

Every property type reuses one of a small set of condition schemas. This is the single most useful structural fact for a compiler.

| Schema | Operators | Used by |
|---|---|---|
| `textPropertyFilter` | `equals`, `does_not_equal`, `contains`, `does_not_contain`, `starts_with`, `ends_with`, + `existencePropertyFilter` | `title`, `rich_text`, `url`, `email`, `phone_number`, `formula.string` |
| `numberPropertyFilter` | `equals`, `does_not_equal`, `greater_than`, `less_than`, `greater_than_or_equal_to`, `less_than_or_equal_to`, + `existencePropertyFilter` | `number`, `unique_id`, `formula.number`, `rollup.number` |
| `datePropertyFilter` | `equals`, `before`, `after`, `on_or_before`, `on_or_after`, `this_week`, `past_week`, `past_month`, `past_year`, `next_week`, `next_month`, `next_year`, + `existencePropertyFilter` | `date`, `created_time`, `last_edited_time`, `formula.date`, `rollup.date`, `timestamp` |
| `peoplePropertyFilter` | `contains`, `does_not_contain`, + `existencePropertyFilter` | `people`, `created_by`, `last_edited_by` |
| `existencePropertyFilter` | `is_empty`, `is_not_empty` (both `const: true`) | mixed into most of the above; **the entire condition set for `files`** |

Two schemas stand alone: `checkboxPropertyFilter` (`equals`, `does_not_equal` — **no existence operators**) and `verificationPropertyStatusFilter` (`status` only).

`select`, `multi_select`, `status`, `relation` each get a two-operator schema plus existence.

#### 1.3 Master operator matrix

Legend for argument type: `str` = string, `num` = number, `bool` = boolean, `T` = literal `true` (no other value accepted), `{}` = empty object (no argument), `uuid` = UUIDv4, `str|str[]` = string or array of strings, `date` = ISO 8601 or relative-date string, `cond` = nested condition object.

| Property type | API key | Operator | UI label (Help Center / observed) | Argument |
|---|---|---|---|---|
| **title** | `title` | `equals` | Is | `str` |
| | | `does_not_equal` | Is not | `str` |
| | | `contains` | Contains | `str` |
| | | `does_not_contain` | Does not contain | `str` |
| | | `starts_with` | Starts with | `str` |
| | | `ends_with` | Ends with | `str` |
| | | `is_empty` | Is empty | `T` |
| | | `is_not_empty` | Is not empty | `T` |
| **rich_text** | `rich_text` | *(identical 8 to title)* | *(identical)* | |
| **url** | `url` | *(identical 8 to title)* | *(identical)* | |
| **email** | `email` | *(identical 8 to title)* | *(identical)* | |
| **phone_number** | `phone_number` | *(identical 8 to title)* | *(identical)* | |
| **number** | `number` | `equals` | = | `num` |
| | | `does_not_equal` | ≠ | `num` |
| | | `greater_than` | > | `num` |
| | | `less_than` | < | `num` |
| | | `greater_than_or_equal_to` | ≥ | `num` |
| | | `less_than_or_equal_to` | ≤ | `num` |
| | | `is_empty` | Is empty | `T` |
| | | `is_not_empty` | Is not empty | `T` |
| **unique_id** | `unique_id` | *(same 6 numeric ops; existence — see §8.4)* | | `num` |
| **checkbox** | `checkbox` | `equals` | Is | `bool` |
| | | `does_not_equal` | Is not | `bool` |
| **select** | `select` | `equals` | Is | `str\|str[]` |
| | | `does_not_equal` | Is not | `str\|str[]` |
| | | `is_empty` | Is empty | `T` |
| | | `is_not_empty` | Is not empty | `T` |
| **multi_select** | `multi_select` | `contains` | Contains | `str\|str[]` |
| | | `does_not_contain` | Does not contain | `str\|str[]` |
| | | `is_empty` | Is empty | `T` |
| | | `is_not_empty` | Is not empty | `T` |
| **status** | `status` | `equals` | Is | `str\|str[]` (option **or group** name) |
| | | `does_not_equal` | Is not | `str\|str[]` |
| | | `is_empty` | Is empty | `T` |
| | | `is_not_empty` | Is not empty | `T` |
| **date** | `date` | `equals` | Is | `date` |
| | | `before` | Is before | `date` |
| | | `after` | Is after | `date` |
| | | `on_or_before` | Is on or before | `date` |
| | | `on_or_after` | Is on or after | `date` |
| | | `this_week` | This week | `{}` |
| | | `past_week` | Past week | `{}` |
| | | `past_month` | Past month | `{}` |
| | | `past_year` | Past year | `{}` |
| | | `next_week` | Next week | `{}` |
| | | `next_month` | Next month | `{}` |
| | | `next_year` | Next year | `{}` |
| | | `is_empty` | Is empty | `T` |
| | | `is_not_empty` | Is not empty | `T` |
| **created_time** | `created_time` | *(identical 14 to date)* | | |
| **last_edited_time** | `last_edited_time` | *(identical 14 to date)* | | |
| **people** | `people` | `contains` | Contains | `uuid` or `"me"` |
| | | `does_not_contain` | Does not contain | `uuid` or `"me"` |
| | | `is_empty` | Is empty | `T` |
| | | `is_not_empty` | Is not empty | `T` |
| **created_by** | `created_by` | *(identical 4 to people)* | | |
| **last_edited_by** | `last_edited_by` | *(identical 4 to people)* | | |
| **files** | `files` | `is_empty` | Is empty | `T` |
| | | `is_not_empty` | Is not empty | `T` |
| **relation** | `relation` | `contains` | Contains | `uuid` (**page id** of a related page) |
| | | `does_not_contain` | Does not contain | `uuid` |
| | | `is_empty` | Is empty | `T` |
| | | `is_not_empty` | Is not empty | `T` |
| **formula** | `formula` | `string` | — (UI dispatches on result type) | `textPropertyFilter` |
| | | `number` | — | `numberPropertyFilter` |
| | | `checkbox` | — | `checkboxPropertyFilter` |
| | | `date` | — | `datePropertyFilter` |
| **rollup** | `rollup` | `any` | — | `rollupSubfilterPropertyFilter` |
| | | `every` | — | `rollupSubfilterPropertyFilter` |
| | | `none` | — | `rollupSubfilterPropertyFilter` |
| | | `date` | — | `datePropertyFilter` |
| | | `number` | — | `numberPropertyFilter` |
| **verification** | `verification` | `status` | — | `"verified"` \| `"expired"` \| `"none"` |

**Counts.** 24 distinct leaf operator keys; ~140 concrete (property type × operator) pairs; plus 9 structural keys (`any`/`every`/`none`, the 4 formula result-type wrappers, `and`/`or`).

Leaf operator keys in full: `equals`, `does_not_equal`, `contains`, `does_not_contain`, `starts_with`, `ends_with`, `is_empty`, `is_not_empty`, `greater_than`, `less_than`, `greater_than_or_equal_to`, `less_than_or_equal_to`, `before`, `after`, `on_or_before`, `on_or_after`, `this_week`, `past_week`, `past_month`, `past_year`, `next_week`, `next_month`, `next_year`, `status`.

#### 1.4 Multi-select vs. select — the operator difference

This is a real semantic split, not cosmetic ([Filter data source entries](https://developers.notion.com/reference/filter-data-source-entries)):

- **select** uses `equals` / `does_not_equal` — the cell holds at most one option, so the test is identity.
- **multi_select** uses `contains` / `does_not_contain` — the cell holds a set, so the test is membership.

Both accept `string` **or `string[]`**. The array form is OR-semantics on the right-hand side: `"equals": ["Low","Medium"]` matches rows whose value is Low **or** Medium; `"does_not_contain": ["Engineering","QA"]` excludes rows matching **any** of them ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views)). The API validates each array element against the property's configured options and returns "a descriptive error listing the available values" on a miss.

#### 1.5 Status filters and group filtering

**Yes, you can filter by status group.** `status.equals` / `does_not_equal` accept either an individual option name or a **status group name** (`"To-do"`, `"In progress"`, `"Complete"`) ([Filter data source entries](https://developers.notion.com/reference/filter-data-source-entries), [Working with views](https://developers.notion.com/guides/data-apis/working-with-views)). There is no separate `status.group` key — group names are accepted in the same string slot as option names, so a clone must resolve the string against both namespaces.

#### 1.6 Date filters — exact semantics

**Precision and timezone** ([Filter data source entries](https://developers.notion.com/reference/filter-data-source-entries)):

> For the `after`, `before`, `equals`, `on_or_before`, and `on_or_after` fields, if a date string with a time is provided, then the comparison is done with millisecond precision. If no timezone is provided, then the timezone defaults to **UTC**.

**Relative date values** — accepted by `after`, `before`, `equals`, `on_or_after`, `on_or_before` only (not by the `{}`-style operators), "resolved at query time":

| Value | Documented meaning |
|---|---|
| `"today"` | The current date. |
| `"tomorrow"` | The day after the current date. |
| `"yesterday"` | The day before the current date. |
| `"one_week_ago"` | Seven days before the current date. |
| `"one_week_from_now"` | Seven days after the current date. |
| `"one_month_ago"` | One month before the current date. |
| `"one_month_from_now"` | One month after the current date. |

**The `{}`-argument relative operators** (`this_week`, `past_week`, `past_month`, `past_year`, `next_week`, `next_month`, `next_year`) are documented only as prose one-liners — e.g. `past_week`: "limits the results to data source entries where the `date` property value is within the past week"; `this_week`: "where the `date` property value is this week."

> `UNRESOLVED: What is the exact boundary of this_week — which day does the week start on (Sunday or Monday), and is it locale- or workspace-dependent?` The docs never define it. Notably, **group-by** configuration *does* expose an explicit `start_day_of_week` (`0` Sunday / `1` Monday), which proves Notion models a configurable week start for grouping — but no equivalent knob or statement exists for the `this_week`/`past_week`/`next_week` **filters**.
>
> `UNRESOLVED: In which timezone are this_week / past_week / next_week / past_month / past_year / next_month / next_year evaluated?` The UTC-default statement is scoped explicitly to the five string-argument comparison operators. Nothing states the timezone for the `{}` operators.
>
> `UNRESOLVED: Are past_week / next_week half-open or inclusive, and do they include today?` Not documented.
>
> `UNRESOLVED: Is past_month a calendar month or a rolling 30/31 days? Same for past_year / next_year.` Not documented.

**Operators the UI has that the API lacks.** Notion's UI date filter menu is widely observed to offer relative choices beyond the API set. The API schema has no `this_month`, `this_year`, no "in the last N days", and no explicit relative-range builder.

> `UNRESOLVED: Does the Notion UI offer a "One week from now"-style relative operator set, "this month"/"this year", or an "in the last N days" custom-count operator? ` The Help Center page on filters ([views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts)) documents only *how* to add a filter, and never enumerates per-property operator labels. No official page enumerates the UI's date operator list. The UI labels given in the matrix above for date/text/number are the conventional ones and should be treated as **unverified** — see §8.6.

**`this_month` anomaly:** an example in [Working with views](https://developers.notion.com/guides/data-apis/working-with-views) uses `"date": { "this_month": {} }`, but `this_month` is **absent from the OpenAPI `datePropertyFilter` schema** and absent from the prose filter reference. See §8.1.

#### 1.7 Formula filters — confirmed shape

Confirmed exactly as hypothesized. You **nest by result type**. The formula condition object's single key matches the formula's computed type, and its value is that type's ordinary condition object ([Filter data source entries](https://developers.notion.com/reference/filter-data-source-entries)):

> The primary field of the `formula` filter condition object matches the type of the formula's result.

Keys: `string` (takes a **rich-text** condition, note the key is `string` not `rich_text`), `number`, `checkbox`, `date`.

```json
{
  "filter": {
    "property": "One month deadline",
    "formula": {
      "date":{
          "after": "2021-05-10"
      }
    }
  }
}
```

So the forms are `formula.string.contains`, `formula.number.equals`, `formula.checkbox.equals`, `formula.date.after` — as expected, with `string` (not `.string.` → rich_text) being the only naming surprise.

> `UNRESOLVED: Notion's Formulas 2.0 can return types beyond string/number/checkbox/date (e.g. lists, page references). How are those filtered?` The schema offers only the four wrappers.

#### 1.8 Rollup filters

A rollup evaluates to an **array**, **date**, or **number**, and the filter shape depends on which ([Filter data source entries](https://developers.notion.com/reference/filter-data-source-entries)):

**Array rollups** — `any` / `every` / `none`, each taking a nested condition:

```json
{
  "filter": {
    "property": "Related tasks",
    "rollup": {
      "any": {
        "rich_text": {
          "contains": "Migrate data source"
        }
      }
    }
  }
}
```

The nested sub-filter is **not** the full property-filter union. The OpenAPI `rollupSubfilterPropertyFilter` restricts it to a keyed condition of exactly: `rich_text`, `number`, `checkbox`, `select`, `multi_select`, `relation`, `date`, `people`, `files`, `status`. Note it takes the **type key without a `property` field** — the property is implied by the rollup's target.

**Date rollups** — `rollup.date` taking a full date condition. Docs state a rollup is stored as a date "only if the *Earliest date*, *Latest date*, or *Date range* computation is selected for the property in the Notion UI."

```json
{ "filter": { "property": "Parent project due date", "rollup": { "date": { "on_or_before": "2023-02-08" } } } }
```

**Number rollups** — `rollup.number` taking a full number condition.

```json
{ "filter": { "property": "Total estimated working days", "rollup": { "number": { "does_not_equal": 42 } } } }
```

> `UNRESOLVED: Can rollup sub-filters nest another rollup or a formula?` `rollupSubfilterPropertyFilter` excludes both `rollup` and `formula`, implying no — but this is not stated in prose.

#### 1.9 Relation filters — what the value references

`relation.contains` / `does_not_contain` take a **UUIDv4 that is the page ID of a related page** ([Filter data source entries](https://developers.notion.com/reference/filter-data-source-entries)). Not a title, not a data-source ID.

```json
{ "filter": { "property": "✔️ Task List", "relation": { "contains": "0c1f7cb280904f18924ed92965055e32" } } }
```

Note the example uses the **unhyphenated** 32-char form, so both hyphenated and bare hex are accepted.

#### 1.10 People filters and the `"me"` token

`people` / `created_by` / `last_edited_by` share `peoplePropertyFilter`. The value is a user UUID **or the literal string `"me"`**. `"me"` resolution is token-dependent ([Filter data source entries](https://developers.notion.com/reference/filter-data-source-entries)):

> The `"me"` value resolves to the user associated with the token. For public connections, this is the user who completed the OAuth flow. For personal access tokens, this is the user who created the token. For internal connections, there is no associated user — `contains: "me"` returns no results and `does_not_contain: "me"` matches all entries.

That last clause is a precise, implementable null-identity semantic worth mirroring.

#### 1.11 Timestamp filters (property-less)

A `timestamp` filter targets page metadata without naming a property:

```json
{
  "filter": {
    "timestamp": "created_time",
    "created_time": {
      "on_or_before": "2022-10-13"
    }
  }
}
```

`timestamp` ∈ `{"created_time", "last_edited_time"}`, and the sibling key of the same name holds a date condition.

> **The `timestamp` filter condition does not require a property name. The API throws an error if you provide one.** ([Filter data source entries](https://developers.notion.com/reference/filter-data-source-entries))

This means `created_time` exists in **two** filter forms — as a named property filter (requires `property`) and as a timestamp filter (forbids `property`).

#### 1.12 Files, checkbox, people — the small sets

- **files**: `is_empty`, `is_not_empty` only. Two operators. No `contains`, no name matching.
- **checkbox**: `equals`, `does_not_equal` only. **No `is_empty`/`is_not_empty`** — a checkbox is always `true` or `false`, never null. This is the only type that omits existence operators.
- **people**: 4 operators (`contains`, `does_not_contain`, `is_empty`, `is_not_empty`). No `equals`.

---

### 2. Compound filters / filter groups

#### 2.1 API shape

A compound filter is an object with a single `and` or `or` key whose value is an array of filter objects **or nested compound filter objects** ([Filter data source entries](https://developers.notion.com/reference/filter-data-source-entries)).

```json
{
  "and": [
    { "property": "Done", "checkbox": { "equals": true } },
    {
      "or": [
        { "property": "Tags", "contains": "A" },
        { "property": "Tags", "contains": "B" }
      ]
    }
  ]
}
```

#### 2.2 Nesting depth limit — API

> A compound filter condition contains an `and` or `or` key with a value that is an array of filter objects or nested compound filter objects. **Nesting is supported up to two levels deep.** ([Filter data source entries](https://developers.notion.com/reference/filter-data-source-entries))

Confirmed structurally by the OpenAPI: the top-level `filter` accepts `{or|and: groupFilterOperatorArray}`, and `groupFilterOperatorArray`'s items are `anyOf: [propertyOrTimestampFilter, {or: propertyOrTimestampFilterArray} | {and: propertyOrTimestampFilterArray}]` — where `propertyOrTimestampFilterArray` items are **leaf filters only**. So the grammar hard-stops at group → group → leaf. **Two levels.**

#### 2.3 Breadth limit — 100 conditions per array

Both `groupFilterOperatorArray` and `propertyOrTimestampFilterArray` carry `maxItems: 100` in the OpenAPI. This is undocumented in prose but schema-enforced: **a single `and`/`or` array may hold at most 100 entries.**

#### 2.4 Nesting depth limit — UI

The UI allows **one level deeper than the API**:

> You can create more specific database views and combine `AND` and `OR` logic by using filter groups. **These can be nested up to three layers deep!** ([Views, filters, sorts & groups](https://www.notion.com/help/views-filters-and-sorts))

So: **API = 2 levels, UI = 3 levels.** A view built in the UI at three levels of nesting is therefore not round-trippable through the documented API filter grammar.

> `UNRESOLVED: What happens when the View API reads back a view whose UI filter is nested three levels deep?` [Working with views](https://developers.notion.com/guides/data-apis/working-with-views) states the view's `filter` field "uses the same shapes as the filter parameter in data source queries" — which caps at two. Behavior on a 3-deep UI filter (error, truncation, or an undocumented deeper schema) is not documented.

#### 2.5 Simple filter bar vs. advanced groups — can a view have both?

Yes, and there are effectively **two distinct filter surfaces on one view**.

**Simple filters** are added via settings → `Filter`, choosing a property. **Advanced filters** are added via settings → `Filter` → `Add advanced filter` ([Views, filters, sorts & groups](https://www.notion.com/help/views-filters-and-sorts)). A simple filter is promoted into the advanced builder via `•••` → `Add to advanced filter`.

In the API these are separate fields on the view object ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views)):

- **`filter`** — the full filter object (the advanced/structured filter).
- **`quick_filters`** — "a map where keys are property names or IDs, and values are filter conditions using the same shape as property filters **but without the `property` field**." These "appear in the view's filter bar and let users quickly toggle property-level filters without opening the full filter panel."

```json
{
  "quick_filters": {
    "Status":   { "status": { "equals": "In progress" } },
    "Priority": { "select": { "equals": "High" } }
  }
}
```

Quick-filter semantics: setting a key to `null` removes that one quick filter (others preserved); setting the whole `quick_filters` field to `null` clears all. People quick filters accept `"me"`.

> `UNRESOLVED: How do quick_filters combine with filter — implicit AND, and are quick filters personal-per-user or shared?` Not stated. The Help Center's separate concept of `Save for everyone` (a filter/sort applies to everyone vs. only you) suggests per-user scoping exists, but its relationship to `quick_filters` is undocumented.

#### 2.6 Filter scope interaction with sub-items

If sub-items are enabled, filtering is scoped by a view setting, not purely by the predicate. `subtasks.filter_scope` ∈ `"parents"` | `"parents_and_subitems"` | `"subitems"` ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views)). The Help Center corroborates: "If you have sub-items turned on for your database, your visibility settings for sub-items will also impact your filtered results."

---

### 3. Sorts

#### 3.1 Object shape

Two variants ([Sort data source entries](https://developers.notion.com/reference/sort-data-source-entries)):

**Property value sort** — `{ "property": <name>, "direction": "ascending"|"descending" }` (both required).

**Entry timestamp sort** — `{ "timestamp": "created_time"|"last_edited_time", "direction": ... }` (both required).

```json
{ "sorts": [ { "property": "created_time", "direction": "ascending" } ] }
```

Direction naming is exactly **`ascending`** / **`descending`** — not `asc`/`desc`.

#### 3.2 Multi-level sorts and precedence

> Data source queries can also be sorted by two or more properties, which is formally called a **nested sort**. **The sort object listed first in the nested sort list takes precedence.** ([Sort data source entries](https://developers.notion.com/reference/sort-data-source-entries))

```json
{
  "sorts": [
    { "property": "Food group", "direction": "descending" },
    { "property": "Name",       "direction": "ascending"  }
  ]
}
```

In the UI, precedence is reordered by dragging with the `⋮⋮` handle ([Views, filters, sorts & groups](https://www.notion.com/help/views-filters-and-sorts)).

**Limit:** the prose sort reference states no limit. However the View API's OpenAPI schema puts **`maxItems: 100`** on the view `sorts` array (both `viewSortRequest` and `viewSortResponse` arrays). 

> `UNRESOLVED: Is there a max sorts count on the query endpoint itself?` The `sorts` array in the `POST /v1/data_sources/{id}/query` request body carries no `maxItems` in the schema. The 100 cap is documented only for views.

**No sort at all:** "Notion doesn't guarantee any particular sort order when no sort parameters are provided." ([Query a data source](https://developers.notion.com/reference/query-a-data-source)) — i.e. result order is explicitly undefined without `sorts`.

#### 3.3 How each property type orders

Officially documented ([Views, filters, sorts & groups](https://www.notion.com/help/views-filters-and-sorts)):

> Different properties sort by different logic, depending on their value type.
> - Text properties such as `Name` and `Text` **sort alphabetically**.
> - Number properties **sort numerically**.
> - For `Select` and `Multi-select` properties, **you get to define what sorting order means. Click on the property, then drag options up or down to set the sort order.**

That third bullet is the important one: **select/multi-select sort by the author-defined option order, not alphabetically.** The option list is an ordered sequence, and sort ascending/descending walks that sequence. The same ordered-option model backs group ordering (§4.5).

Status is not mentioned, but by construction it has both an option order and a group order (To-do / In progress / Complete), so the same ordered-option principle applies.

> `UNRESOLVED: Where do empty/null values land in ascending vs. descending sorts?` Not documented anywhere — not in the sort reference, not in the Help Center. This is a genuine spec hole and one of the highest-risk items for a clone (Postgres defaults to `NULLS LAST` for ASC and `NULLS FIRST` for DESC, which may or may not match Notion).
>
> `UNRESOLVED: How does multi-select sort when a cell holds several options?` Presumably by first option in the defined order, but undocumented.
>
> `UNRESOLVED: How do people, relation, and files properties order?` Undocumented. No statement about sorting by user name vs. user id, by related-page title vs. id, or by file name vs. count.
>
> `UNRESOLVED: How does checkbox order — is checked before or after unchecked in ascending?` Undocumented.
>
> `UNRESOLVED: Is text sorting case-sensitive, and what collation/locale is used for non-ASCII?` "Alphabetically" is the only word given.

#### 3.4 Manual ordering vs. sorts

Manual ordering exists and is the **default** state. In table view, "For rows, hover, then click and hold the `⋮⋮` icon on the left to drag it up or down" ([Tables](https://www.notion.com/help/tables)). In board view, "To move cards up and down or between columns, click, hold, and drag" ([Boards](https://www.notion.com/help/boards)).

Group ordering also has an explicit manual mode in the API: group-by `sort` accepts `{ "type": "manual" }` alongside `"ascending"`/`"descending"` ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views)) — so manual order is a first-class, persisted ordering, not just an absence of sort.

> `UNRESOLVED: What exactly happens when you drag a row in a view that has an active sort?` No official Notion documentation addresses this. Community sources (not authoritative, not cited as fact here) report that drag-reordering is disabled while a sort is active and that removing the sort restores manual order. The Help Center documents how to delete a sort but never connects it to drag behavior.
>
> `UNRESOLVED: Is manual row order global to the data source or per-view?` The group-by `sort: {type: "manual"}` is per-view config, but row-level manual order scope is unstated.

#### 3.5 Sorting vs. grouping interaction

Group **order** and row **order within a group** are separate mechanisms:

- Groups are ordered by the group-by's own `sort` field: `{ "type": "manual" | "ascending" | "descending" }` — a *required* field on every group-by object ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views)). The Help Center matches: "`Sort` your groups manually or by the options provided (alphabetical, ascending, and more)."
- Rows inside each group are ordered by the view's top-level `sorts` array.

So **grouping does not consume the view's sorts** — it has an independent sort knob. This is a meaningful design fact for a clone: two orthogonal ORDER BY layers.

---

### 4. Grouping and sub-grouping

The View API's **group-by configuration** is now the authoritative spec ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views)).

#### 4.1 Common shape

Group-by is a discriminated union on `type` (the *property type*, not the property):

| Field | Type | Notes |
|---|---|---|
| `type` | string | **Required.** The property type being grouped. |
| `property_id` | string | **Required.** |
| `sort` | object | **Required.** `{ "type": "manual" \| "ascending" \| "descending" }` |
| `hide_empty_groups` | boolean | Whether to hide groups with no items. |

#### 4.2 Groupable property types and per-type behavior

| `type` value(s) | Extra required | Extra optional |
|---|---|---|
| `select`, `multi_select` | — | — |
| `status` | `group_by`: `"group"` (by status group: To Do/In Progress/Done) or `"option"` (by individual option) | — |
| `person`, `created_by`, `last_edited_by` | — | — |
| `relation` | — | — |
| `date`, `created_time`, `last_edited_time` | `group_by`: `"relative"` \| `"day"` \| `"week"` \| `"month"` \| `"year"` | `start_day_of_week`: `0` (Sunday) or `1` (Monday) |
| `text`, `title`, `url`, `email`, `phone_number` | `group_by`: `"exact"` or `"alphabet_prefix"` (first letter) | — |
| `number` | — | `range_start`, `range_end`, `range_size` (>= 1) for bucket grouping |
| `checkbox` | — | — |
| `formula` | `group_by`: a nested sub-group-by object | — |

**Not groupable:** `files`, `rollup`, `unique_id`, `verification`, `button`, `place`.

**Date grouping — the exact list is `relative`, `day`, `week`, `month`, `year`. There is no `quarter`.** And the week boundary *is* configurable here via `start_day_of_week` (0 = Sunday, 1 = Monday) — unlike the date *filters*, which expose no such control (§1.6).

**Number grouping does bucket into ranges, and the bucket size IS configurable**: `range_start`, `range_end`, `range_size` (minimum 1).

**Text grouping** offers two modes: `"exact"` (distinct value) and `"alphabet_prefix"` (first letter).

**Status grouping** can group by **status group** or by **individual option** — an explicit two-level model.

**Formula grouping** nests a sub-group-by describing how to group the formula's *result*. The nested object omits `property_id` (inherited):

| Result type | Nested `group_by` fields |
|---|---|
| `date` | `type`, `group_by` (`relative`\|`day`\|`week`\|`month`\|`year`), `sort`, optionally `start_day_of_week` |
| `text` | `type`, `group_by` (`exact`\|`alphabet_prefix`), `sort` |
| `number` | `type`, `sort`, optionally `range_start`, `range_end`, `range_size` |
| `checkbox` | `type`, `sort` |

Examples:

```json
{ "type": "select",  "property_id": "PRIORITY_PROPERTY_ID", "sort": { "type": "manual" }, "hide_empty_groups": true }
{ "type": "status",  "property_id": "STATUS_PROPERTY_ID", "group_by": "group", "sort": { "type": "ascending" } }
{ "type": "date",    "property_id": "DUE_DATE_PROPERTY_ID", "group_by": "week", "sort": { "type": "ascending" }, "start_day_of_week": 1 }
{ "type": "formula", "property_id": "FORMULA_PROPERTY_ID",
  "group_by": { "type": "number", "sort": { "type": "ascending" }, "range_start": 0, "range_end": 100, "range_size": 10 } }
```

#### 4.3 Which views support grouping and sub-grouping

From the "Feature support by view type" matrix ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views)):

| Feature | Table | Board | Calendar | Timeline | Gallery | List | Map | Form | Chart | Dashboard |
|---|---|---|---|---|---|---|---|---|---|---|
| `group_by` | Optional | **Required** | – | – | – | – | – | – | – | – |
| `sub_group_by` | – | Optional | – | – | – | – | – | – | – | – |

So: **grouping is Table + Board only** (optional on table, mandatory on board). **Sub-grouping is Board only.** Depth is therefore **exactly two levels** (group + sub-group); there is no third tier.

Chart views have their own parallel grouping mechanism (`x_axis`, `stack_by`) that reuses the same group-by object shape.

Help Center agrees on sub-grouping: "In board view, you can add a second layer of groups, called sub-groups." ([Boards](https://www.notion.com/help/boards))

#### 4.4 Per-group options

| Option | Where documented |
|---|---|
| **Hide empty groups** | API `hide_empty_groups` boolean; Help: "`Hide empty groups`" ([views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts)) |
| **Hide / show a specific group** | Help: "Hide or show groups by selecting 👁️"; Boards: click `•••` next to the column heading → `Hide`. Hidden board groups collect under a **`Hidden Columns`** section ([Boards](https://www.notion.com/help/boards)) |
| **Reorder groups** | Board: "To rearrange columns, click and hold on a heading, then drag left or right." Also `sort: {type:"manual"}` |
| **Sort groups** | API `sort` on group-by; Help: "`Sort` your groups manually or by the options provided (alphabetical, ascending, and more)" |
| **Group count / calculation** | Board: "To the immediate right of each column heading, you'll see a gray number. The default is for this to show the number of cards in each column, but you can change it" ([Boards](https://www.notion.com/help/boards)) |
| **Colour** | Board: "Board view columns are colored by default, but you can turn this off by clicking Group at the top right, and then toggling 'Color columns'" |
| **Remove grouping** | Help: settings → `Group` → `Remove grouping`. API: `configuration.group_by = null` |
| **Add a new group** | Board: adding a new group means adding a new option to the underlying property |

> `UNRESOLVED: Is there a per-group collapse/expand (as distinct from hide), and is collapse state persisted per view or per user?` Neither the API view configuration nor the Help Center documents a collapse toggle or a persisted collapsed-groups list. The Help Center for Boards documents only `Hide group`.

#### 4.5 Where groups come from

- **select / multi_select / status**: from the property's **configured option list**, in the **author-defined order** (the same drag-ordered list that drives sorting, §3.3). Group set is therefore static and known from the schema, which is why `hide_empty_groups` is needed at all — empty groups otherwise render.
- **person / created_by / last_edited_by / relation**: **dynamic** — derived from the values actually present in the rows. No schema-side option list exists.
- **date / created_time / last_edited_time**: computed buckets from the chosen granularity.
- **number**: computed buckets from `range_start`/`range_end`/`range_size`.
- **checkbox**: two fixed groups.
- **text-like**: dynamic (`exact`) or 26+ buckets (`alphabet_prefix`).

Board default grouping ([Boards](https://www.notion.com/help/boards)):

> By default, your board will be grouped by a status property if your database has one. Otherwise, your database items will be grouped by a select, person, multi-select, or relation property that's in your database. If none of these properties exist, a new status property will be created in your database for you.

> `UNRESOLVED: What is the uncategorized/null group called and can it be hidden?` Board's "No Status"-style bucket is not documented on any official page reviewed.

---

### 5. The calculations row (aggregations)

#### 5.1 The authoritative enumeration

The API's chart-aggregation enum is the only exhaustive machine-readable list ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views)):

> **Supported aggregation operators:** `count`, `count_values`, `sum`, `average`, `median`, `min`, `max`, `range`, `unique`, `empty`, `not_empty`, `percent_empty`, `percent_not_empty`, `checked`, `unchecked`, `percent_checked`, `percent_unchecked`, `earliest_date`, `latest_date`, `date_range`.

**20 operators.** Shape:

```json
{ "aggregator": "sum", "property_id": "AMOUNT_PROP_ID" }
```

> `"count"` counts all rows and **does not require a `property_id`**. All other operators require a `property_id`.

That is a clean and important rule: `count` is the only property-independent aggregate.

#### 5.2 Full table with UI names, definitions, and applicability

Definitions quoted verbatim from [Tables](https://www.notion.com/help/tables) (table calculations row) and [Relations & rollups](https://www.notion.com/help/relations-and-rollups) (rollup calculations), which use near-identical wording.

| API `aggregator` | UI name | Definition (verbatim where quoted) | Applies to | Empty-set result |
|---|---|---|---|---|
| `count` | **Count all** | "Gives you the total number of rows in the column." (rollup: "Counts the total number of values in the selected property for all related pages.") | All types; no property needed | `0` |
| `count_values` | **Count values** | "Counts the number of property values contained in the column." (rollup: "Counts the number of **non-empty** values…") | All types | `0` |
| `unique` | **Count unique values** | "Counts the number of unique property values contained in the column, **omitting duplicates**." | All types | `0` |
| `empty` | **Count empty** | "Counts the number of rows that do not have a value in the column." | All types | `0` |
| `not_empty` | **Count not empty** | "Counts the number of rows where the column is filled." | All types | `0` |
| `percent_empty` | **Percent empty** | "Gives you the percentage of rows that do not have the chosen property filled in." | All types | *see below* |
| `percent_not_empty` | **Percent not empty** | "Gives you the percentage of cards that do have the property filled in." | All types | *see below* |
| `sum` | **Sum** | "Shows the sum of the numbers in the column." | Number only | *see below* |
| `average` | **Average** | "Shows the average of the numbers in the column." | Number only | *see below* |
| `median` | **Median** | "Shows the median of the numbers in the column." | Number only | *see below* |
| `min` | **Min** | "Shows the lowest number in the column." | Number only | *see below* |
| `max` | **Max** | "Shows the highest number in the column." | Number only | *see below* |
| `range` | **Range** | "**Subtracts the lowest number from the highest.**" | Number only | *see below* |
| `earliest_date` | **Earliest date** | "…you can choose to show when the oldest row was edited or created." (rollup: "Finds the earliest date/time in the date property for all related pages.") | Date-ish types | *see below* |
| `latest_date` | **Latest date** | "Shows when the newest row was last edited or created." | Date-ish types | *see below* |
| `date_range` | **Date range** | "Shows you the time gap between the oldest and newest edit or creation time." (rollup: "Computes the span of time between the latest and earliest dates.") | Date-ish types | *see below* |
| `checked` | **Checked** | — | Checkbox | *see below* |
| `unchecked` | **Unchecked** | — | Checkbox | *see below* |
| `percent_checked` | **Percent checked** | — | Checkbox | *see below* |
| `percent_unchecked` | **Percent unchecked** | — | Checkbox | *see below* |

**Rollup-only display modes** (not in the aggregator enum — they are rollup *display* options, not calculations) ([Relations & rollups](https://www.notion.com/help/relations-and-rollups)):

| UI name | Definition |
|---|---|
| **Show original** | "This just shows all related pages in the same cell. It's the same as the relation property itself." |
| **Show unique values** | "This shows each unique value in the selected property for all related pages." |

These are why the request's starting list included "show original / show unique" — they belong to the **rollup property configuration** surface, not the calculations row. A clone should model them separately.

#### 5.3 `count all` vs `count values` — the multi-select question

This is the subtle one the brief asked about. The two definitions differ in *what is counted*:

- **Count all** — "the total number of **rows**" (table wording) / "the total number of **values** … for all related pages" (rollup wording).
- **Count values** — "the number of **property values** contained in the column" / "the number of **non-empty** values."

For a scalar property these coincide up to emptiness. For a **multi-select**, "property values" reads as individual tags rather than cells, which would make `count_values` count tags across all rows while `count` counts rows.

> `UNRESOLVED: For a multi-select property, does "Count values" count cells-with-a-value or individual tags across all rows?` The two help pages use different wordings for the same operator names ("total number of rows" vs "total number of values"), and neither states the multi-select case. This is a real ambiguity, not a gap in my search — the docs are genuinely underspecified here. Same question applies to `unique` (Count unique values) on multi-select: unique tag set, or unique tag-combination set?

#### 5.4 Empty-set behavior

> `UNRESOLVED: What does each aggregation return for an empty set?` Not documented for any operator. Specifically unknown: `sum` of no rows (0 or blank?), `average`/`median`/`min`/`max`/`range` of no rows, `percent_empty`/`percent_not_empty` when row count is 0 (0%, 100%, or blank — a division by zero), and `earliest_date`/`latest_date`/`date_range` of no dated rows. The Help Center never discusses the degenerate case.

#### 5.5 Where calculations appear

| Location | Evidence |
|---|---|
| **Table: bottom row, per column** | "For each column in your database, you can run calculations…" Invoked by "Click on a property in your table. In the menu that appears, hover over `Calculate`." ([Tables](https://www.notion.com/help/tables)) |
| **Board: per-column (per-group) header** | "To the immediate right of each column heading, you'll see a gray number. The default is for this to show the number of cards in each column, but you can change it to give you other information." ([Boards](https://www.notion.com/help/boards)) |
| **Chart views: as the y-axis / single value** | `y_axis` and `value` fields take an aggregation object ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views)) |
| **Rollup properties: per row** | Rollup `Calculate` menu ([Relations & rollups](https://www.notion.com/help/relations-and-rollups)) |

**Can each group have its own calculation?** On a **board**, each group column shows a calculation in its header — but the Help Center describes changing "it," singular, implying one calculation choice applied per-property across all columns, with each column computing its own value over its own cards.

> `UNRESOLVED: In a grouped TABLE view, is there a per-group footer calculation row, and can each group independently choose a different aggregation?` The Tables help page never mentions grouping or group footers, and the View API exposes no per-group aggregation field. The aggregation choice appears to be per-property-per-view, evaluated per group — but this is not stated.
>
> `UNRESOLVED: Where is the calculations-row selection stored in the View API?` The view `configuration` schema for table/board has `properties[]` entries with `visible`, `width`, `wrap`, `status_show_as`, `card_property_width_mode`, `date_format`, `time_format` — but **no aggregation/calculate field**. So the calculations row is not exposed or settable through the documented View API, only through charts.
>
> `UNRESOLVED: Do calendar views have calculations?` Not mentioned anywhere.
>
> `UNRESOLVED: Exact UI labels for the four checkbox aggregations.` The API enum confirms `checked`, `unchecked`, `percent_checked`, `percent_unchecked` exist. Neither [Tables](https://www.notion.com/help/tables) nor [Boards](https://www.notion.com/help/boards) nor [Relations & rollups](https://www.notion.com/help/relations-and-rollups) lists them — the Tables page enumerates only the 7 universal + 3 date + 6 number options. The names "Checked"/"Unchecked"/"Percent checked"/"Percent unchecked" are inferred from the API keys, not confirmed from a UI source.

---

### 6. Search, pagination, limits

#### 6.1 Search within a database view

> Databases that contain **at least three pages** will also be searchable… To search a database, select 🔍 at the top of the database and enter a query. As you type, the database will only show pages that match your query. **Database search looks at database page titles and properties.** ([Views, filters, sorts & groups](https://www.notion.com/help/views-filters-and-sorts))

So: title **and** property values; incremental/as-you-type; the search affordance only appears at ≥3 pages.

> `UNRESOLVED: Does in-view database search match page body content?` The statement says "titles and properties," which implies no, but it is not an explicit exclusion.
>
> `UNRESOLVED: Is in-view search substring, prefix, or token-based, and is it case/diacritic-insensitive?` Undocumented.
>
> `UNRESOLVED: Does in-view search compose with the view's filters (AND) or replace them?` Undocumented.

The separate API [Search by title](https://developers.notion.com/reference/post-search) endpoint is workspace-scoped and, as its name says, title-only — it is **not** the in-view search and does not search properties.

#### 6.2 API pagination

From [Introduction](https://developers.notion.com/reference/intro):

| Param | Value |
|---|---|
| `page_size` | **Default: `100`, Maximum: `100`** |
| `start_cursor` | "A `next_cursor` value returned in a previous response. **Treat this as an opaque value.**" Defaults to undefined (start of list). |

Response envelope: `has_more` (boolean), `next_cursor` (string, "Only available when `has_more` is true"), `results` (array). Cursor scheme is **opaque forward-only cursor** — no offset, no backward paging, no total count.

> Documentation inconsistency: the same page's prose says "By default, Notion returns **ten** items per API call," while its parameter table says **Default: 100**. See §8.5.

#### 6.3 The 10,000-result query cap

A significant and easily-missed limit ([Query a data source](https://developers.notion.com/reference/query-a-data-source)):

> This endpoint supports paginating through up to **10,000 results per query**. If a data source contains more matching entries than this limit, pagination stops at the 10,000th result: `has_more` becomes `false`, and every response page served from the capped result includes a `request_status` marking the result as incomplete.

```json
{ "request_status": { "type": "incomplete", "incomplete_reason": "query_result_limit_reached" } }
```

> Check `request_status.type === "incomplete"` on every response page… Any page with that status means the whole query result was capped. **The limit is per query (a query is defined by its filter and sort), not per data source.**

Critically, `has_more` goes **false** — so a naive paginator silently believes it finished. The documented workaround is partitioning the query into `created_time` windows ([Query large data sources](https://developers.notion.com/guides/data-apis/query-large-data-sources)).

`request_status.type` ∈ `{"complete", "incomplete"}`; `incomplete_reason` ∈ `{"query_result_limit_reached"}`.

#### 6.4 Other documented limits

| Limit | Value | Source |
|---|---|---|
| Conditions per `and`/`or` array | **100** (`maxItems`) | OpenAPI `groupFilterOperatorArray`, `propertyOrTimestampFilterArray` |
| Filter nesting depth (API) | **2 levels** | [Filter data source entries](https://developers.notion.com/reference/filter-data-source-entries) |
| Filter nesting depth (UI) | **3 layers** | [views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts) |
| Sorts per view | **100** (`maxItems`) | OpenAPI view sort arrays |
| Results per query | **10,000** | [Query a data source](https://developers.notion.com/reference/query-a-data-source) |
| `page_size` | default 100 / max 100 | [Introduction](https://developers.notion.com/reference/intro) |
| Properties per database | **500** | [Database properties](https://www.notion.com/help/database-properties) |
| Payload size | max 1000 block elements, **500KB** overall | [Request limits](https://developers.notion.com/reference/request-limits) |
| Rate limits | two tiers; 429 with `additional_data.rate_limit_reason` = `public_api_request_rate_limit` or `public_api_space_request_rate_limit` | [Request limits](https://developers.notion.com/reference/request-limits) |

Performance lever worth noting: `filter_properties[]` query param returns only listed properties — `?filter_properties[]=title`.

> `UNRESOLVED: Is there a documented maximum row count per database/data source?` No official number found. The 10,000 cap is explicitly *per query*, not per data source, and the docs describe techniques for reading data sources larger than it — implying no hard row cap.
>
> `UNRESOLVED: What is the UI's per-view row rendering limit / "Load more" page size?` Neither [Tables](https://www.notion.com/help/tables) nor [Boards](https://www.notion.com/help/boards) nor the views help page mentions a load-more control, a row cap, or a per-column card cap on boards.

#### 6.5 Non-filter query parameters

`POST /v1/data_sources/{id}/query` body also accepts:

| Param | Meaning |
|---|---|
| `is_archived` | boolean. "When omitted or false, returns non-archived pages. When true, returns archived pages." |
| `result_type` | `"page"` \| `"data_source"`. Filters results to pages or data sources; only relevant for wikis. Default returns both for wikis. |

Default behavior with no filter: "non-archived pages in the data source will be returned with pagination."

---

### 7. Full worked JSON examples (verbatim from docs)

**Checkbox:**
```json
{ "filter": { "property": "Task completed", "checkbox": { "equals": true } } }
```

**Date, absolute and relative:**
```json
{ "filter": { "property": "Due date", "date": { "on_or_after": "2023-02-08" } } }
{ "filter": { "property": "Due date", "date": { "on_or_after": "today" } } }
```

**Multi-select:**
```json
{ "filter": { "property": "Programming language", "multi_select": { "contains": "TypeScript" } } }
```

**Select, multi-value:**
```json
{ "filter": { "property": "Priority", "select": { "does_not_equal": ["Done", "Archive"] } } }
```

**People "me":**
```json
{ "filter": { "property": "Assignee", "people": { "contains": "me" } } }
```

**Verification:**
```json
{ "filter": { "property": "verification", "verification": { "status": "verified" } } }
```

**unique_id range (note: a compound filter is required to express a range):**
```json
{
  "filter": {
    "and": [
      { "property": "ID", "unique_id": { "greater_than": 1 } },
      { "property": "ID", "unique_id": { "less_than": 3 } }
    ]
  }
}
```

**Nested compound (the full 2-level form):**
```json
{
  "filter": {
    "or": [
      { "property": "Description", "rich_text": { "contains": "2023" } },
      {
        "and": [
          { "property": "Department", "select": { "equals": "Engineering" } },
          { "property": "Priority goal", "checkbox": { "equals": true } }
        ]
      }
    ]
  }
}
```

---

### 8. Documentation conflicts and anomalies

These are places where Notion's own sources disagree. Each is a decision point for a clone.

**8.1 `this_month` exists in an example but not in the schema.** [Working with views](https://developers.notion.com/guides/data-apis/working-with-views) shows `"date": { "this_month": {} }` in a `PATCH /v1/views` example. The OpenAPI `datePropertyFilter` enumerates 12 date operators and `this_month` is **not** among them; the prose [filter reference](https://developers.notion.com/reference/filter-data-source-entries) also omits it. Either the operator is real-but-undocumented, or the example is wrong. There is likewise no `this_month`/`this_year` anywhere in the schema.

**8.2 Boards help contradicts the View API on relation/formula grouping.** [Boards](https://www.notion.com/help/boards) FAQ: "Any way to group by a relation or formula property? — **Not currently** 😓". But the View API explicitly lists `relation` and `formula` as valid group-by `type` values, and gives a formula group-by example. The *same help page* also says boards fall back to grouping by "a select, person, multi-select, or **relation** property" — self-contradictory within one page. The Help Center FAQ is almost certainly stale.

**8.3 Prose filter type list is incomplete.** The [filter reference](https://developers.notion.com/reference/filter-data-source-entries) summary table lists 15 type keys and omits `title`, `url`, `email`, `created_by`, `created_time`, `last_edited_by`, `last_edited_time`, `unique_id`, all of which are present in the OpenAPI union. Trust the schema.

**8.4 `unique_id` existence operators.** The prose ID section lists only the 6 numeric comparison operators (no `is_empty`/`is_not_empty`). The OpenAPI maps `unique_id` → `numberPropertyFilter`, which *includes* `existencePropertyFilter`. Since a unique_id is auto-assigned and never null, the prose is probably behaviorally right while the schema is structurally permissive.

**8.5 `page_size` default: 10 vs 100.** [Introduction](https://developers.notion.com/reference/intro) prose says "By default, Notion returns ten items per API call"; its own parameter table says "Default: `100`". Unreconciled.

**8.6 No official enumeration of UI filter operator labels.** [views-filters-and-sorts](https://www.notion.com/help/views-filters-and-sorts) documents only the mechanics of adding/deleting filters and never lists per-property operator labels. The UI-label column in §1.3 is therefore **partly inferred** and should be treated as provisional; only the API keys are authoritative.

**8.7 Two different definitions for "Count all".** Tables: "total number of **rows**." Relations & rollups: "total number of **values** … for all related pages." See §5.3.

---

### 9. Consolidated UNRESOLVED list

**Date filter semantics (highest risk for a compiler)**
1. Exact boundary of `this_week` — which day starts the week; locale/workspace dependent?
2. Timezone in which `this_week`/`past_*`/`next_*` are evaluated (UTC default is stated only for the string-argument operators).
3. Are `past_week`/`next_week` inclusive of today? Half-open or closed intervals?
4. Is `past_month` a calendar month or rolling 30/31 days? Same for `past_year`/`next_year`.
5. Does `this_month`/`this_year` actually exist as an operator (§8.1)?
6. Does the UI offer relative operators the API lacks ("in the last N days", "this month")? No official enumeration exists.

**Sorting**
7. **Where do NULL/empty values land in ascending vs. descending?** Completely undocumented; highest-impact gap.
8. How does multi-select sort when a cell holds multiple options?
9. How do people, relation, and files properties order?
10. Checkbox ascending — checked first or unchecked first?
11. Text sort collation: case sensitivity, locale, non-ASCII handling.
12. Max sorts on the query endpoint (100 is documented for views only).
13. What happens when you drag a row in a view with an active sort? No official source.
14. Is manual row order per-view or per-data-source?

**Filters / compound**
15. Behavior when the View API reads back a UI filter nested 3 levels deep (API grammar caps at 2).
16. How do `quick_filters` combine with `filter` — implicit AND? Are they per-user or shared?
17. Can rollup sub-filters nest another rollup or formula? (Schema says no; prose silent.)
18. How are Formulas-2.0 result types beyond string/number/checkbox/date filtered?

**Grouping**
19. Is there a per-group collapse/expand distinct from hide, and is its state persisted per-view or per-user?
20. Name and behavior of the uncategorized/null group (board's "No Status" bucket); can it be hidden?

**Aggregations**
21. **For multi-select, does "Count values" count cells or individual tags?** Docs use conflicting wording. Same question for "Count unique values."
22. What does each aggregation return for an empty set (esp. `sum`, `average`, `percent_empty` at zero rows)?
23. In a grouped **table** view, is there a per-group footer calculation, and can each group pick a different aggregation independently?
24. Where is the calculations-row selection stored in the View API? The `properties[]` config has no aggregation field — it appears unexposed outside charts.
25. Do calendar views have calculations at all?
26. Exact UI labels for `checked` / `unchecked` / `percent_checked` / `percent_unchecked` — confirmed to exist via the API enum, but listed on no help page.

**Search / limits**
27. Does in-view database search match page body content, or only titles + properties?
28. Is in-view search substring/prefix/token-based? Case- and diacritic-insensitive?
29. Does in-view search AND with the view's filters or replace them?
30. Documented maximum row count per database/data source (none found; likely no hard cap).
31. UI per-view row rendering limit and "Load more" page size; per-column card cap on boards.

---

### 10. Source index

- [Filter data source entries](https://developers.notion.com/reference/filter-data-source-entries) — current prose filter reference
- [Query a data source](https://developers.notion.com/reference/query-a-data-source) — endpoint + **embedded OpenAPI schema** (the authoritative operator enumeration)
- [Sort data source entries](https://developers.notion.com/reference/sort-data-source-entries) — sort object reference
- [Working with views](https://developers.notion.com/guides/data-apis/working-with-views) — **view API: group-by, sub-group-by, aggregations, quick filters** (the key new source)
- [Create a view](https://developers.notion.com/reference/create-view) / [Update a view](https://developers.notion.com/reference/update-a-view) / [List views](https://developers.notion.com/reference/list-views) — view endpoint schemas
- [Query large data sources](https://developers.notion.com/guides/data-apis/query-large-data-sources) — 10,000-result cap workaround
- [Introduction](https://developers.notion.com/reference/intro) — pagination contract
- [Request limits](https://developers.notion.com/reference/request-limits) — size and rate limits
- [FAQs: Version 2025-09-03](https://developers.notion.com/docs/upgrade-faqs-2025-09-03) — databases → data sources migration
- [Filter database entries](https://developers.notion.com/reference/post-database-query-filter) — **deprecated** pre-2025-09-03 filter reference (retained for comparison)
- [Views, filters, sorts & groups](https://www.notion.com/help/views-filters-and-sorts) — UI filters/sorts/groups, 3-layer nesting, database search
- [Tables](https://www.notion.com/help/tables) — calculations row definitions
- [Boards](https://www.notion.com/help/boards) — group columns, sub-groups, per-column calculations
- [Relations & rollups](https://www.notion.com/help/relations-and-rollups) — rollup calculation definitions, Show original / Show unique values
- [Database properties](https://www.notion.com/help/database-properties) — property type inventory, 500-property limit
- [llms.txt](https://developers.notion.com/llms.txt) — full docs index (every page has a `.md` raw twin)

## J. Structure and automation


**Research date:** 2026-08-08
**Purpose:** Formal specification input for a from-scratch clone (Postgres + FastAPI + Next.js). This is a *feature inventory of Notion*, not an implementation design.
**Primary sources:** `developers.notion.com` (API reference, changelog, upgrade guides — fetched as canonical `.md` renderings) and `notion.com/help` (help center articles). Every non-obvious claim carries an inline source link.

**Conventions used below**
- `PLAN-GATED` — requires a paid tier; the tier is named.
- `AI-HOSTED` — depends on Notion AI / Notion-hosted intelligence.
- `EXTERNAL` — depends on a third-party service (Slack, Gmail, Jira…).
- `UNRESOLVED:` — I could not find documentation. **Not guessed.** Full list in §10.

---

### 0. Executive summary of what my training data got wrong

Three things a stale model would get wrong, all confirmed against current docs:

1. **`2025-09-03` split `database` into `database` + `data_source`.** A database is now a *container*; a data source is a *table* (schema + rows). One database can hold many data sources. ([Database object](https://developers.notion.com/reference/database.md), [Data source object](https://developers.notion.com/reference/data-source.md))
2. **There IS a newer API version: `2026-03-11`.** It is the current latest. ([Changes by version](https://developers.notion.com/reference/changes-by-version.md), [Upgrade guide 2026-03-11](https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11.md))
3. **Views are now a first-class API object** (`/v1/views`, launched 2026-03-19), including machine-readable configuration for sub-items and dependency arrows. ([Changelog, March 19 2026](https://developers.notion.com/page/changelog.md); [Working with views](https://developers.notion.com/guides/data-apis/working-with-views.md))

---

### 1. The database ↔ data-source split (`2025-09-03` and later)

#### 1.1 What exactly changed

Before `2025-09-03`, "database" was one conflated concept: container + schema + rows + permissions. The Notion app shipped multi-source databases on **September 3, 2025**, so the API had to split the concept. ([Upgrade FAQs](https://developers.notion.com/guides/get-started/upgrade-faqs-2025-09-03.md))

> "In September 2025, Notion is launching several features to improve what you can do with databases. This includes support for multiple **data sources** under a single **database**, each of which can have a different set of properties (schemas). The **database** becomes a *container* for one or more **data sources**." — [Upgrade FAQs](https://developers.notion.com/guides/get-started/upgrade-faqs-2025-09-03.md)

The authoritative one-line definitions:

- **Database** — "an object that contains one or more data sources. Databases can either be displayed inline in the parent page (`is_inline: true`) or as a full page (`is_inline: false`). The properties (schema) of each data source under a database can be maintained independently, and each data source has its own set of rows (pages)." ([Database object](https://developers.notion.com/reference/database.md))
- **Data source** — "the individual tables of data that live under a Notion database. Pages are the items (or children) in a data source. Page property values must conform to the property objects laid out in the parent data source object." ([Data source object](https://developers.notion.com/reference/data-source.md))

**Critical architectural fact — permissions live on the database, not the data source:**

> "Individual data sources don't have permissions settings, so the set of Notion users and bots that have access to data source children is managed through **databases**." — [Database object](https://developers.notion.com/reference/database.md)
>
> "User and bot permissions are managed at the **database** level, not per data source. This means that the level of access a Notion user or connection has (or doesn't have) is the same across all data sources in a database." — [Upgrade FAQs](https://developers.notion.com/guides/get-started/upgrade-faqs-2025-09-03.md)

The help center says the same thing user-facing: "You can't set a different level of access for each source in your database." ([Data sources](https://www.notion.com/help/data-sources-and-linked-databases))

#### 1.2 Why multiple data sources per database exist

Notion's stated use cases ([Data sources help](https://www.notion.com/help/data-sources-and-linked-databases), [Intro to databases](https://www.notion.com/help/intro-to-databases)):

- **CRM** — contacts, companies, deals, and activities in one database.
- **Project management** — team members, projects, tasks, and resources in one database.
- **Recruiting** — candidates, open roles, departments, and interview schedules through a single database.

The unifying idea: *one navigational/permission container, several heterogeneous schemas, one tab strip of views across all of them.*

#### 1.3 The full object model

```
Workspace
  └── Page  (parent: {type: "workspace", workspace: true})
        └── Database          parent: {type:"page_id", page_id: ...}
              ├── data_sources: [{id, name}, ...]
              ├── Data source  parent: {type:"database_id", database_id: ...}
              │                database_parent: {type:"page_id", page_id: ...}
              │     └── Page (row)  parent: {type:"data_source_id",
              │                              data_source_id: ..., database_id: ...}
              │           └── Blocks (page body)
              └── Data source (2nd, independent schema)
                    └── Page (row) ...
        └── View  parent: {type:"database_id", database_id: ...}
                  data_source_id: <scoped ds> | null (dashboards)
```

This mirrors the diagram and worked example in the [Upgrade FAQs](https://developers.notion.com/guides/get-started/upgrade-faqs-2025-09-03.md), which spells out each level's `parent` explicitly.

Parenting rules verbatim ([Parent object](https://developers.notion.com/reference/parent-object.md)):

- Pages can be parented by other pages, **data sources**, blocks, agents, or the workspace. *(Prior to `2025-09-03`, page parents were databases, not data sources.)*
- Blocks can be parented by pages, data sources, blocks, or agents.
- Databases can be parented by pages, blocks, or the workspace. *For wikis, databases can also have a data source parent.*
- **Data sources are parented by databases.** *Linked or externally synced external data sources may have data source parents, but aren't thoroughly supported in Notion's API.*

Parent variants: `database_id`, `data_source_id` (carries a convenience `database_id`), `page_id`, `workspace`, `block_id`, `agent_id`. ([Parent object](https://developers.notion.com/reference/parent-object.md))

##### 1.3.1 Database object — field by field

Source: [Database object](https://developers.notion.com/reference/database.md). Note: after upgrading to `2025-09-03` the database object **no longer carries `properties`**.

| Field | Type | Notes |
|---|---|---|
| `object` | string | Always `"database"` |
| `id` | UUID | |
| `data_sources` | array | `[{ "id": ..., "name": ... }]` — **only** id+name; call Retrieve a data source for the schema |
| `created_time` | ISO 8601 | |
| `created_by` | Partial User | |
| `last_edited_time` | ISO 8601 | |
| `last_edited_by` | Partial User | |
| `title` | rich text[] | |
| `description` | rich text[] | |
| `icon` | Emoji \| Icon \| Custom emoji \| File | "An icon set in the Notion UI is returned by both Retrieve a database and Retrieve a data source" |
| `cover` | File object | |
| `parent` | object | page / block / workspace |
| `url` | string | e.g. `https://app.notion.com/p/{id}` |
| `archived` | boolean | **Deprecated**, alias of `in_trash` |
| `in_trash` | boolean | |
| `is_inline` | boolean | `true` = inline block in a page; `false` = child page |
| `public_url` | string \| null | Published-to-web URL |

Example `data_sources` value: `[{"id": "c174b72c-d782-432f-8dc0-b647e1c96df6", "name": "Tasks data source"}]`.

##### 1.3.2 Data source object — field by field

Source: [Data source object](https://developers.notion.com/reference/data-source.md). Fields marked `*` are available to connections with *any* capabilities; the rest need read-content capability.

| Field | Type | Notes |
|---|---|---|
| `object`* | string | Always `"data_source"` |
| `id`* | UUID | |
| `properties`* | object | **The schema.** map of property name → [property object](https://developers.notion.com/reference/property-object.md) |
| `parent` | object | Usually `{type:"database_id", database_id}`. "Some externally synced data sources can be parented by another data source (`type: "data_source_id"`) and include the containing `database_id`." |
| `database_parent` | object | The *grandparent* — the containing database's parent |
| `created_time` / `created_by` | | |
| `last_edited_time` / `last_edited_by` | | |
| `title` | rich text[] | Data-source-level title (distinct from database title) |
| `description` | rich text[] | |
| `icon` | Emoji \| Icon \| Custom emoji \| File | |
| `archived` | boolean | **Deprecated**, alias of `in_trash` |
| `in_trash` | boolean | |

**Schema limits (documented, hard):**
> "Notion recommends a max property count of **500** or a max schema size of **50KB**. Updates to database schemas that are too large will be blocked to help maintain database performance." — [Data source object](https://developers.notion.com/reference/data-source.md)

When rejected: "the error response includes a `validation_error` code with a message identifying the largest property by name, ID, and byte size to help you reduce your schema size." ([Update a data source](https://developers.notion.com/reference/update-a-data-source.md))

The help center gives the user-facing figures, which differ slightly and are worth recording separately ([Optimize database load times & performance](https://www.notion.com/help/optimize-database-load-times-and-performance)):
- **500 properties** per database; at the cap you cannot add new properties until you remove some.
- **250,000 rows** per database, with warning signals approaching/over the limit; "Once these limits are hit, new changes to your database will not be saved."
- **2.5 MB** total property data per page (files/media property *contents* excluded).
- **1.5 MB** total size of all properties in the database (the schema — property count + select option counts).
- **10,000** references of the same page across a two-way relation, after which further references stop reflecting on the other side.

##### 1.3.3 Page (row) object — field by field

Source: [Page object](https://developers.notion.com/reference/page.md).

| Field | Type | Notes |
|---|---|---|
| `object`* | string | Always `"page"` |
| `id`* | UUIDv4 | |
| `created_time` / `created_by` | | |
| `last_edited_time` / `last_edited_by` | | |
| `archived` | boolean | **Deprecated**, alias of `in_trash` |
| `in_trash` | boolean | "Use this field to check trash status and as a body parameter in Update page to trash or restore a page." |
| `icon` | Emoji \| Icon \| Custom emoji \| File | |
| `cover` | File object (`external` or `file_upload`) | |
| `properties` | object | "If `parent.type` is `"page_id"` or `"workspace"`, then the only valid key is `title`. If `parent.type` is `"data_source_id"`, then the keys and values … are determined by the `properties` of the data source this page belongs to." |
| `parent` | object | For rows: `{type:"data_source_id", data_source_id, database_id}` |
| `url` | string | |
| `public_url` | string \| null | |

Page body content is **not** in the page object — it is the page's block children, addressed separately.

##### 1.3.4 View object — field by field

Views became an API object on 2026-03-19. Source: [View object](https://developers.notion.com/reference/view.md).

| Field | Type | Notes |
|---|---|---|
| `object` | `"view"` | |
| `id` | UUID | |
| `parent` | object | `{type:"database_id", database_id}` — **views hang off the database, not the data source** |
| `data_source_id` | string \| null | The data source this view is scoped to; `null` for dashboard views |
| `name` | string | |
| `type` | string | see below |
| `filter` | object \| null | |
| `sorts` | array \| null | |
| `configuration` | object \| null | Discriminated union on `type` |
| `created_time` / `created_by` | | |
| `last_edited_time` / `last_edited_by` | | |
| `url` | string | Deep link |
| `dashboard_view_id` | string | Only for widget views inside a dashboard |

**Supported view types** ([View object](https://developers.notion.com/reference/view.md)): `table`, `board`, `calendar`, `timeline`, `gallery`, `list`, `form`, `chart`, `map`, `dashboard`.
Dashboard views have no `configuration`; they use `rows` for widget layout.

This is a notable structural fact for a clone: **a view belongs to a database and points at one data source.** That is exactly how one tab strip spans several schemas.

#### 1.4 The endpoint surface

| Concern | `2022-06-28` | `2025-09-03`+ |
|---|---|---|
| Retrieve container | `GET /v1/databases/:id` (returned schema) | `GET /v1/databases/:id` (returns `data_sources` list; **no** schema) |
| Retrieve schema | — | `GET /v1/data_sources/:id` |
| Query rows | `POST /v1/databases/:id/query` | `POST /v1/data_sources/:id/query` |
| Create container + first table | `POST /v1/databases` with `properties` | `POST /v1/databases` with `initial_data_source[properties]` |
| Add a table to an existing container | — | `POST /v1/data_sources` |
| Update container attrs | `PATCH /v1/databases/:id` (mixed) | `PATCH /v1/databases/:id` — `parent`, `title`, `description`, `is_inline`, `icon`, `cover`, `in_trash`, `is_locked` |
| Update schema | `PATCH /v1/databases/:id` `properties` | `PATCH /v1/data_sources/:id` — `properties`, `title`, `in_trash`, `parent` |
| Create row | `POST /v1/pages` `parent.database_id` | `POST /v1/pages` `parent.data_source_id` |
| List row templates | — | `GET /v1/data_sources/:id/templates` |
| Views | — | `GET/POST /v1/views`, `GET/PATCH/DELETE /v1/views/:view_id`, `POST /v1/views/:view_id/queries`, `GET /v1/views/:view_id/queries/:query_id` |

Sources: [Upgrade guide 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03.md), [Create a data source](https://developers.notion.com/reference/create-a-data-source.md), [List data source templates](https://developers.notion.com/reference/list-data-source-templates.md), [Working with views](https://developers.notion.com/guides/data-apis/working-with-views.md), changelog entry for the Views API.

Explicit split of update responsibilities, verbatim ([Upgrade guide 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03.md)):

> "Continue to use the Update Database API for attributes that apply to the database: `parent`, `title`, `is_inline`, `icon`, `cover`, `in_trash`. … `cover` is not supported when `is_inline` is `true`."
> "Switch over to the Update *Data Source* API to modify attributes that apply to a specific data source: `properties` (to change database schema), `in_trash` …, `title`."
> "Changes to one data source's `properties` doesn't affect the schema for other data source, even if they share a common database."

Also new in that release: `parent` on Update Database "can be used to move an existing database to a different page, or (for public connections), to the workspace level as a private page. **This is a new feature in Notion's API.**"

Two IDs are **not** interchangeable: "You can't use a database ID with the retrieve data source API, or vice-versa."

Creating a data source requires a database parent (`{database_id}`); `page_id` was explicitly removed as a valid parent for `CreateDataSourceBodyParameters` in SDK v5.1.0 ([Changelog, Sept 13 2025](https://developers.notion.com/page/changelog.md)). Creating a data source also implicitly creates a view: "A standard 'table' view is created alongside the new data source." ([Create a data source](https://developers.notion.com/reference/create-a-data-source.md))

#### 1.5 What broke, and the upgrade guide

The blast radius, verbatim ([Upgrade guide 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03.md)):

> "If your connection is still using a previous API version and a user adds another data source to a database, **the following API actions will fail:**
> - Create page when using the database as the parent
> - Database read, write, or query
> - Writing relation properties that point to that database"

The failure mode is a 400 with a machine-readable escape hatch ([Upgrade FAQs](https://developers.notion.com/guides/get-started/upgrade-faqs-2025-09-03.md)):

```json
{
  "code": "validation_error",
  "status": 400,
  "message": "Databases with multiple data sources are not supported in this API version.",
  "object": "error",
  "additional_data": {
    "error_type": "multiple_data_sources_for_database",
    "database_id": "27a5d30a-1728-4a1e-a788-71341f22fb97",
    "child_data_source_ids": ["164b19c5-...", "25c104cd-..."],
    "minimum_api_version": "2025-09-03"
  }
}
```

Single-source databases keep working on `2022-06-28`; only the *addition of a second source* breaks old callers. Notion states no sunset process exists for old versions today, and that any future minimum-version program would come with ~6 months notice.

**The six migration steps** ([Upgrade guide 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03.md)):

1. **Discovery** — call `GET /v1/databases/:id` with `Notion-Version: 2025-09-03` to obtain `data_sources[]`, and store the `data_source_id`. (In-app, "Copy data source ID" lives under the database settings → *Manage data sources*.)
2. **Write path** — send `parent: {type:"data_source_id", data_source_id}` on Create Page, and `data_source_id` in relation property definitions. This is accepted on *any* API version, so it can be rolled out ahead of the version bump.
3. **Endpoint migration** — `/v1/databases/*` → `/v1/data_sources/*` for retrieve/query/update.
4. **Search** — `filter.value` becomes `"page" | "data_source"` (was `"page" | "database"`). Responses return `object: "data_source"` entries, **one per data source**, so a database with two sources yields two results. Search still matches against the *database* title, not the data source title.
5. **SDK** — `@notionhq/client` v5.0.0+; v5+ is incompatible with API versions older than `2025-09-03`. The deprecated *List databases* endpoint is gone from v5.
6. **Webhooks** — bump the subscription's API version and handle the new event shapes.

**Relation properties — the read/write asymmetry is a real trap.** Across *all* versions the response now contains both `database_id` and `data_source_id`; but on `2025-09-03` the *request* "must **only contain `data_source_id`**". ([Upgrade guide 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03.md)) The current relation property object documents only `data_source_id` + `dual_property` ([Property object](https://developers.notion.com/reference/property-object.md)):

```json
"Projects": {
  "id": "~pex",
  "name": "Projects",
  "type": "relation",
  "relation": {
    "data_source_id": "6c4240a9-a3ce-413e-9fd0-8a51a4d0a49b",
    "dual_property": { "synced_property_name": "Tasks", "synced_property_id": "JU]K" }
  }
}
```

**Database mentions still reference the database, not the data source.** ([Upgrade guide 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03.md))

**Webhook event renames** ([Upgrade guide 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03.md)):

| Old | New | Meaning |
|---|---|---|
| `database.content_updated` | `data_source.content_updated` | Data source's content updates |
| `database.schema_updated` | `data_source.schema_updated` | Data source's schema updates |
| — | `data_source.created` | New data source added to an existing database |
| — | `data_source.moved` | Data source moved to a different database |
| — | `data_source.deleted` | Data source deleted from a database |
| — | `data_source.undeleted` | |
| `database.created` | unchanged | New database created with a default data source |
| `database.moved` | unchanged | Database moved to a different parent page |
| `database.deleted` / `database.undeleted` | unchanged | |

Plus: all webhooks for entities that can have data-source parents gain `data.parent.data_source_id`. Applies to `page.*`, `data_source.*`, and — only for the rare wiki case where a database is parented by another database — `database.*`.

**Wikis are excluded:** "Unlike other databases, wikis won't support multiple data sources as part of the September 2025 launch. For this reason, and due to limited support in Notion's API, we recommend using alternative ways to structure your knowledge in Notion that don't involve wikis." ([Upgrade FAQs](https://developers.notion.com/guides/get-started/upgrade-faqs-2025-09-03.md))

**URLs did not change shape:** `https://notion.so/workspace/{database_id}?v={view_id}` — the database ID and *view* ID are in the URL; the data source ID is **not**, and is only exposed via a dropdown. ([Upgrade FAQs](https://developers.notion.com/guides/get-started/upgrade-faqs-2025-09-03.md))

#### 1.6 Is there anything newer than `2025-09-03`? — **Yes: `2026-03-11`**

`2026-03-11` is the current latest API version, released 2026-03-11. Three breaking changes ([Changes by version](https://developers.notion.com/reference/changes-by-version.md), [Upgrade guide 2026-03-11](https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11.md)):

| Change | Before (`2025-09-03`) | After (`2026-03-11`) |
|---|---|---|
| Block positioning | `after` string param on Append block children | `position` object: `after_block` \| `start` \| `end` (default `end`) |
| Trash status | `archived` field | `in_trash` field — **fully removed**, applies to pages, databases, blocks, and data sources |
| Block type rename | `transcription` | `meeting_notes` |

SDK: `@notionhq/client` v5.12.0+ with `notionVersion: "2026-03-11"`; old field names retained as `@deprecated` for the transition.

Relevant to automations: "If you use database automation webhooks (the 'Send webhook' action in Notion automations), Notion will display an upgrade banner in the automation editor when a webhook action uses an older API version. You can upgrade individual webhook actions to `2026-03-11` … or leave them on `2025-09-03` for backward compatibility. New webhook actions will default to `2026-03-11` going forward." ([Upgrade guide 2026-03-11](https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11.md))

Connection-webhook payloads are **identical** between `2025-09-03` and `2026-03-11` — the rename is REST-only. Upgrading the subscription version is a no-op done for consistency.

#### 1.7 Database-relevant changes since `2025-09-03` (not version-gated)

Worth knowing because a clone's feature checklist should reflect the *current* surface, not the Sept-2025 snapshot. All from the [changelog](https://developers.notion.com/page/changelog.md):

- **2026-01-15** — Move page API (`parent` change on an existing page); page `position` on create; **List data source templates**; `template` param on Create Page; `template` + `erase_content` params on Update Page.
- **2026-03-11** — Template **`timezone`** parameter (controls how `@now` / `@today` resolve).
- **2026-03-19** — **Views API** (8 endpoints) + `view.created` / `view.updated` / `view.deleted` webhooks (available on `2025-09-03`+). **Status property creation/update** finally supported (previously read-only).
- **2026-03-25** — Writable `verification` property on wiki database pages; native `type: "icon"` icons; List custom emojis endpoint.
- **2026-03-30** — `"me"` relative filter value for people properties; relative date filter values `today`, `tomorrow`, `yesterday`, `one_week_ago`, `one_week_from_now`, `one_month_ago`, `one_month_from_now`; view API fixes (percent-encoded property IDs; `width: 0` now rejected, min 1; partial `properties` list now correctly hides unlisted properties).
- **2026-04-17** — Multi-value filters: arrays for `equals`/`does_not_equal` on select+status, `contains`/`does_not_contain` on multi_select — "matching the multi-value conditions available in the Notion UI".
- **2026-04-20** — **Max pagination depth of 10,000 results per query** on Query a data source / view queries. Over-limit responses carry `request_status: {type: "incomplete", incomplete_reason: "query_result_limit_reached"}`.
- **2026-06-16** — Workspace-level rate limit added on top of the per-connection limit.
- **2026-06-22** — **Status option groups**: status options accept a `group` field (`To-do`, `In progress`, `Complete`).
- **2026-07-01** — `databases.retrieve` now returns the UI-set icon, matching `dataSources.retrieve`.
- **2026-07-15** — Notion links moved from `notion.so` to `https://app.notion.com/p/{page-id}`; Search accepts `filter.in_trash`; Query a data source accepts top-level `is_archived`.
- **2026-08-05** — Formula and rollup properties can return `type: "unsupported"` "when values depend on too many related pages".

**API request limits** ([Request limits](https://developers.notion.com/reference/request-limits.md)): ~3 req/s per connection average with bursts, plus a per-workspace limit scaled to plan; HTTP 429 with `additional_data.rate_limit_reason` (`public_api_request_rate_limit` / `public_api_space_request_rate_limit`); 529 = `service_overload`. Payload caps: **1000 block elements and 500KB overall**; rich text `content` and any URL 2000 chars; equation 1000 chars; block arrays 100 elements; email/phone 200 chars; multi-select 100 options; relation 100 related pages *per request*; people 100 users. Notion is explicit that these are *request* caps, not storage caps: "A relation property can contain far more than 100 related pages — the limit only governs how many you add or set in one request."

---

### 2. Databases as pages

#### 2.1 Every row is a full page — confirmed

> "**Every item is its own page:** Every item you enter into your database is a Notion page. Open a database item to add more information in the form of text, images, and more, as you would with any other Notion page!" — [Intro to databases](https://www.notion.com/help/intro-to-databases)

> "Every item in your database, whether it's a row in a table or a card on a board or calendar, is its own Notion page that you can build, format, and nest content in like any other page." — [Intro to databases](https://www.notion.com/help/intro-to-databases)

A consequence worth capturing: "Because database items are pages, any other type of content you drag into a database (like bullets or to-do items), will automatically turn into pages."

**What a row-page has** ([Intro to databases](https://www.notion.com/help/intro-to-databases), [Page object](https://developers.notion.com/reference/page.md)):

- **Property values** — displayed at the top of the page, one row per property (name / type / value).
- **Free page body** — "Underneath your properties is free page space, where you can add any type of content block, including sub-pages or an inline database."
- **Icon** and **cover** — page-level fields on the page object.
- **Comments** — "capture conversation between you and your teammates."
- **Backlinks** — "indicate all the pages that link to the current page."
- **Version history**, **trash semantics**, **permissions** — all the normal page machinery (see §8).

**Per-page customization of that header** — the `Customize page` menu (••• → Customize page):
- Properties: each can be `Always show` / `Hide when empty` / `Always hide`. Hidden ones aggregate into a single expandable menu item at the bottom.
- Backlinks: `Expanded` / `Show in popover` / `Off`.
- Comments: `Expanded` / `Off`.

There is also a **database-level** page layout: database settings → `Customize page layout` — "Set up a custom layout that applies to all pages in your database." ([Database settings](https://www.notion.com/help/customize-your-database))

**Row context menu** (right-click on an item) ([Intro to databases](https://www.notion.com/help/intro-to-databases)): `Delete`, `Duplicate`, `Copy link` (anchor link to that item), `Rename` (without opening), `Move to` (another workspace or page — "where it will show up as a subpage"), `Edit property`.

**Ordering quirk worth knowing:** "When a database contains more than 1,000 items, new pages may appear in the middle of the collection instead of at the end. This is due to the way large collections are sorted and indexed." ([Intro to databases](https://www.notion.com/help/intro-to-databases))

#### 2.2 Inline vs full-page databases

| | Full-page | Inline |
|---|---|---|
| Appearance | "appear just like any other page in your sidebar" | "Controls and menus … are hidden until you hover over it" |
| Sidebar | top-level / normal page | "appear as a subpage of the page it's in" |
| Cover | supported | **`cover` is not supported when `is_inline` is `true`** ([Upgrade guide 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03.md)) |
| Block handle | n/a | `⋮⋮` gives Delete / Duplicate / move / copy link |

**Conversions** ([Intro to databases](https://www.notion.com/help/intro-to-databases)):
- **Full-page → inline:** drag the database into another page in the sidebar (making it a subpage), then inside that page select `⋮⋮` → `Turn into inline`.
- **Inline → full-page:** click `⋮⋮` and drag it into the sidebar as a top-level page. (Also stated in [Board view](https://www.notion.com/help/boards) and [Timeline view](https://www.notion.com/help/timelines): "To change an inline database to a full-page database, drag an inline database block into your sidebar as a top-level page.")
- **Inline expand (view only, not a conversion):** `⤡` at the top expands an inline database to full-page presentation.

Via API: `is_inline` is a boolean on both Create database and Update database. ([Update a database](https://developers.notion.com/reference/update-database.md))

#### 2.3 Title, description, icon, cover

Both the **database** and each **data source** carry their own `title`, `description`, and `icon` (rich text arrays / icon objects). Only the **database** carries `cover`. ([Database object](https://developers.notion.com/reference/database.md), [Data source object](https://developers.notion.com/reference/data-source.md))

Update-database request body ([Update a database](https://developers.notion.com/reference/update-database.md)): `parent`, `title` (max 100 rich text items), `description` (max 100), `is_inline`, `icon`, `cover`, `in_trash`, `is_locked`. All optional; omitting a field leaves it unchanged.

Icon types: Emoji, native **Icon** (`type: "icon"` with `name` + optional `color`, default gray — added 2026-03-25; `name` also accepts icon-picker names as of 2026-07-01), Custom emoji, or File. ([Database object](https://developers.notion.com/reference/database.md), changelog)

Search behaviour note: the query "is matched against the *database* title, not the *data source* title." ([Upgrade guide 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03.md))

#### 2.4 Linked views / linked data sources — what's shared vs per-view

Terminology note: Notion uses **"linked data source"** for a data source from a *different* database surfaced inside this one. "Synced databases" is a **different** feature — one-way external sync from Jira/GitHub/Asana/GitLab (see §8.6). Do not conflate them.

**Creating one** ([Data sources](https://www.notion.com/help/data-sources-and-linked-databases)):
- New database → `Link to existing data source`.
- Existing database → settings slider → `Manage data sources` → `Add data source` (new) or `Link existing data source`.

**Manage data sources panel** shows two groups:
- **Sources** — data sources that originate from this database. Per-source `•••` offers `Move to` (elsewhere in the workspace) and `Move to Trash`. Plus `Add data source`.
- **Linked** — data sources coming from a different database. `X` removes the link from the current database.

**The shared-vs-local split — this is the load-bearing rule:**

> "When interacting with a linked data source, the views, filters, sorts, and groups you create and delete **will not affect** the views on the original database.
> However, when you edit the data source's **title, properties, or pages** those edits **will be reflected** in the original data source." — [Data sources](https://www.notion.com/help/data-sources-and-linked-databases)

So:

| Aspect | Scope |
|---|---|
| Views, filters, sorts, groups | **Per-linking-database (local)** |
| Title, properties (schema), pages (rows) | **Shared with the origin** |
| Permissions | **Inherited from the origin database** |

Permissions: "every linked data source in a database will respect the access level of the original database. For example, if you connect your team's task data source to your own database, you'll have the same level of access to that data that you have in the original team task database." And the FAQ: if a recipient can't see a shared page containing a linked data source, "Make sure that the person you've shared with has access to the original database."

**Restriction:** *Form* views can only be added to the original database that contains the data source. "If your data source appears under Linked, open the original database and add your form there." ([Data sources](https://www.notion.com/help/data-sources-and-linked-databases))

**Moving a data source** (requires `Full access`; moving them at all requires `Can edit`) ([Data sources](https://www.notion.com/help/data-sources-and-linked-databases)):
- Moved into another **database** → it becomes a data source of that database.
- Moved onto a **page** → it becomes a database on that page.
- "You can choose to move all your views over to the new destination, or keep all of the existing views where they are. **Existing views that don't get moved along with the data source will become linked views.** In your destination, you'll have a new table view of the data source."

Also relevant to `Can edit content` users: "Users with `Can edit content` access will still be able to create linked databases and edit views, sorts, and filters **in that linked database**." ([Intro to databases](https://www.notion.com/help/intro-to-databases)) — i.e. a linked view is an escape hatch from the structural lockdown.

#### 2.5 Locking

Notion has **two distinct locks**, and they are frequently confused.

**Lock database** — a *database setting*:
> "**Lock database**: When you turn this on, people can still enter data, but they can't change views or properties." — [Database settings](https://www.notion.com/help/customize-your-database)

> "You can lock a full page database so that other people can't change properties and value options by selecting `•••` at the top of your database → `Lock database`." — [Intro to databases](https://www.notion.com/help/intro-to-databases)

**Lock views** — found in the `•••` menu at the top right of the window:
> "Switch it on to prevent anyone from changing properties and views in your database. They'll still be able to edit the data it contains.
> Note that **anyone with editing access can toggle this lock on or off at any time.** This is helpful as a quick safeguard against accidental edits in a database that you'd like many people to be able to change structurally." — [Intro to databases](https://www.notion.com/help/intro-to-databases)

Key semantics to carry into a clone:
- A lock is a **guard rail, not a permission**. Anyone with edit access can unlock.
- Both locks protect **structure** (properties, views, sorts, filters), not **data** (rows and property values remain editable).
- Only `Full access` / `Can edit` users can lock or unlock. `Can edit content` users explicitly **cannot** "Lock or unlock the database." ([Intro to databases](https://www.notion.com/help/intro-to-databases))
- **A locked database silently kills automations:** among the reasons an automation isn't triggering — "The database is locked." ([Database automations](https://www.notion.com/help/database-automations))

**API:** `is_locked` is a boolean body parameter on **Update database** ("Whether the database should be locked from editing in the Notion app UI. If not provided, the locked state will not be updated") and on the page endpoints ("Whether the page is locked from editing in the Notion app UI"). Added in SDK v5.1.0. ([Update a database](https://developers.notion.com/reference/update-database.md), [Create a page](https://developers.notion.com/reference/post-page.md), [Changelog Sept 13 2025](https://developers.notion.com/page/changelog.md))

`UNRESOLVED:` The help center does not document a *per-individual-view* lock distinct from the database-wide "Lock views" toggle, nor whether "Lock views" and "Lock database" are the same underlying flag surfaced in two menus. The two descriptions overlap heavily but are worded differently ("can't change views or properties" vs "prevent anyone from changing properties and views"). See §10.

#### 2.6 Duplicate

**Duplicate with / without content** ([Intro to databases](https://www.notion.com/help/intro-to-databases)):

- **Inline:** hover the database → `⋮⋮` → `Duplicate` → choose `Duplicate with content` or `Duplicate without content`.
- **Full page:** `•••` top right → `Duplicate` → same two choices.

"`Duplicate without content`" is described as the way to "use the same database setup to organize other pages" — i.e. schema + views, no rows.

**Duplicating a row that has sub-items:** "When you duplicate an item with sub-items, the item and all its sub-items will be duplicated into new pages." ([Sub-items & dependencies](https://www.notion.com/help/tasks-and-dependencies))

**Duplication rate limit:** "you can only duplicate 20,000 blocks per hour." ([Delete & restore content](https://www.notion.com/help/duplicate-delete-and-restore-content))

**"Duplicate as template" is a different feature.** It is a **web-publishing** toggle, not a database duplicate mode: publishing a page to the web with "Allow duplicate as template" enabled lets any visitor copy the page into their own workspace. ([Duplicate public Notion pages](https://www.notion.com/help/duplicate-public-pages)) Do not model it as a database operation.

Database **row templates** have their own `•••` → Edit / Duplicate / Delete menu — see §5.4.

#### 2.7 Moving, deleting, restoring a database

**Moving:**
- In-app: drag in the sidebar (this is also the inline↔full-page conversion mechanism); or row-level `Move to`.
- API: `PATCH /v1/databases/:id` with `parent` — to a different page, or (public connections only) to the workspace level as a private page. ([Upgrade guide 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03.md))
- A **data source** can also be moved independently between databases / onto a page (§2.4).

**Deleting:** `in_trash: true` via Update database, or `Delete` in the UI. There is no separate "delete database" endpoint: "to remove the database entirely, set `in_trash` to true via the update database endpoint." A **single data source** can be trashed independently with `PATCH /v1/data_sources/:id` `in_trash`. ([Upgrade guide 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03.md))

`UNRESOLVED:` The help center does not state explicitly whether trashing a database also individually trashes each of its row-pages (i.e. whether rows appear as separate entries in Trash). See §10.

**Trash retention** ([Delete & restore content](https://www.notion.com/help/duplicate-delete-and-restore-content)):
- "By default, pages will remain in Trash for **30 days** before they are permanently deleted from Trash."
- "Once pages are permanently deleted from Trash, they are retained for **30 days** before they become inaccessible to all users, even workspace owners."
- Enterprise workspace owners can customize these settings. `PLAN-GATED (Enterprise)`
- Trash is filterable by `Last edited by`, `In` (the page it used to live in), and `Teamspace`.
- "you won't be able to edit a page that's in the trash unless you restore it."
- "There isn't a way to empty your trash all at once."

**Restoring a database from version history** — this behaviour is subtle and important:
> "If you're restoring a database, all of its pages and their properties will be restored. **However, any contents of the database pages, like text inside of the pages, won't be restored.** To restore database page contents, you'll have to restore an earlier version of every individual page.
> If you're restoring a page with an inline database …, you can choose to restore or not restore the database's pages and properties.
> Note: Restoring a database may affect existing database views, as well as how other people see the database." — [Delete & restore content](https://www.notion.com/help/duplicate-delete-and-restore-content)

**Deleted properties are separately recoverable:** database settings → `Edit Properties` → scroll to `Deleted Properties`. Arrow restores; trash-can permanently deletes. "Deleting a property from Deleted Properties is **permanent** and cannot be restored." There is a cap on how many deleted properties the trash holds. ([Delete & restore content](https://www.notion.com/help/duplicate-delete-and-restore-content), [Optimize database load times](https://www.notion.com/help/optimize-database-load-times-and-performance))

**Archive** (distinct from trash) `PLAN-GATED (Business, Enterprise)` — beta at time of writing ([Delete & restore content](https://www.notion.com/help/duplicate-delete-and-restore-content)):
- "Archiving a page allows you to mark pages as no longer current without deleting them."
- Yellow `Archived` banner with archiver name + date; `Unarchive` from the banner.
- Hidden from search by default; includable via search filter `Content status` → `All pages (including archived)`.
- Links still work.
- "If you archive a parent page, all Archive pages below are archived automatically."
- **"If you archive content in databases, the content will be filtered out of the view going forward. Archived pages can be viewed by going to the database's Settings → View archived pages."**
- API: Query a data source accepts a top-level `is_archived` body parameter to return archived pages instead of the default non-archived set. ([Changelog, July 15 2026](https://developers.notion.com/page/changelog.md))

---

### 3. Sub-items

Canonical source for this whole section: [Sub-items & dependencies](https://www.notion.com/help/tasks-and-dependencies), plus the API's [subtask configuration](https://developers.notion.com/guides/data-apis/working-with-views.md).

#### 3.1 What they are

> "Sub-items allow you to break tasks into smaller, distinct pieces of work, so that they can be easily scoped out, assigned, and tracked. **They are visible in all database views.**"

They are **parent/child rows within one database**, implemented as a **self-referencing relation**:

> "In the Sub-items window, you'll create a **self-relating property**. You can rename the properties to 'Sub-tasks' and 'Parent tasks'. … Now, you'll see **two new properties** in the database, one for 'Parent tasks' and one for 'Sub-tasks'." — [Break tasks into manageable steps](https://www.notion.com/help/guides/tasks-manageable-steps-sub-tasks-dependencies)

The API confirms the mechanism: "Subtask (sub-item) configuration controls how parent-child relationships are displayed in table views. **This uses a self-referencing relation property to establish hierarchy.**" ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views.md))

If the database is a **Task database**, the feature is labelled "Sub-tasks" instead of "Sub-items". ([Database settings](https://www.notion.com/help/customize-your-database))

#### 3.2 Enabling / configuring / disabling

- **Enable:** database settings menu → `Database settings` → `More settings` → `Sub-items` → `Turn on sub-items`.
- **Disable:** same path → `Turn off sub-items`.
- **Advanced settings:** `Sub-items` → `Advanced settings` → `Property`, then choose which item type — **`Sub-item`** or **`Parent item`** — is nested in the table. Critically: "**The same property will be used to display sub-items for all views of your database.**" There is also a `Show nesting toggle on title` switch.

So the *property choice* is database-global, while the *display mode* and *filter scope* are per-view (§3.4/§3.5).

Recursion is explicit: "Any task in your database can have sub-tasks, which can be further broken down into smaller sub-tasks." ([Break tasks into manageable steps](https://www.notion.com/help/guides/tasks-manageable-steps-sub-tasks-dependencies))

#### 3.3 Nesting depth limit

`UNRESOLVED:` **No documented maximum sub-item nesting depth.** The frequently-cited "three levels" figure comes from a *different* feature — **database templates**: "You can only have three levels of nesting per database **template**." ([Database templates](https://www.notion.com/help/database-templates)) Advanced *filters* also nest "up to three layers deep" ([Views, filters, sorts & groups](https://www.notion.com/help/views-filters-and-sorts)). Neither is a sub-item limit. Do not transfer the number. See §10.

#### 3.4 Rendering per view type — display options

Two families, with different option sets ([Sub-items & dependencies](https://www.notion.com/help/tasks-and-dependencies)). Path: settings menu → `Sub-items` → dropdown under **`Display options`**.

**Table, list, timeline:**
| Option | Behaviour |
|---|---|
| `Nested in toggle` | "allow you to open and close toggles in parent items to show or hide sub-items within them" — the expand/collapse triangles |
| `Flattened list` | "show all of your parent and sub-items in a flat list … sub-items won't be indented in the list to distinguish them from parent items" |

**Board, calendar, gallery:**
| Option | Behaviour |
|---|---|
| `Card property` | "show all your sub-items on the card for your parent item" |
| `Flattened list` | "show all of your parent and sub-items as separate items" |

Note: the help doc's display-option lists cover table/list/timeline and board/calendar/gallery. The API's `subtasks` configuration object is only offered on **table** views (see the feature-support matrix in [Working with views](https://developers.notion.com/guides/data-apis/working-with-views.md), where `subtasks` is "Optional" for Table and "-" for every other type).

The API models the same concept with a fourth state. The **`subtasks` configuration object**:

```json
{
  "property_id": "RELATION_PROPERTY_ID",
  "display_mode": "show",
  "filter_scope": "parents_and_subitems",
  "toggle_column_id": "title"
}
```

| Field | Values |
|---|---|
| `property_id` | Relation property ID used for parent-child nesting |
| `display_mode` | `"show"` (hierarchical with toggles) · `"hidden"` (parents with a count) · `"flattened"` (sub-items with a parent indicator) · `"disabled"` (no sub-item rendering) |
| `filter_scope` | `"parents"` · `"parents_and_subitems"` · `"subitems"` |
| `toggle_column_id` | Property ID of the column showing the expand/collapse toggle |

Passing `subtasks: null` resets to defaults; `{ "display_mode": "disabled" }` explicitly disables. ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views.md))

Note the UI/API mapping: UI `Nested in toggle` ↔ API `show`; UI `Flattened list` ↔ API `flattened`; UI "Parents only" display (implied by the `Include` dropdown) ↔ API `hidden` ("parents with a count").

**On a row's own page**, sub-items appear either as a relation at the top of the page or as a dedicated **page section**: "you can choose to show sub-items as a page section, so when you open up a task, it's immediately clear what all the subtasks are. In the sub-item section, you can click on the options menu … and select which corresponding properties you want to display (status, assignee, due date, etc.). Having sub-tasks show up as a separate page section also makes it easy to add new tasks to the page." ([Break tasks into manageable steps](https://www.notion.com/help/guides/tasks-manageable-steps-sub-tasks-dependencies))

#### 3.5 Interaction with filters — **the subtle one**

There **is** a separate filter-scope control, distinct from the display mode. Path: settings menu → `Sub-items` → dropdown under **`Filter options`** *or* **`Include`** — "(depending on your current display option)". ([Sub-items & dependencies](https://www.notion.com/help/tasks-and-dependencies))

**For table, list, and timeline views — three modes, verbatim:**

| Mode | Documented semantics |
|---|---|
| `Parents only` | "Parents that match your filters will display, **along with the number of sub-items they have**." |
| `Parents and sub-items` | "Parents and sub-items that match your filters will display." |
| `Sub-items only` | "Sub-items that match your filters will display." |

**For board, calendar, and gallery views:** "only the `Parents only` filter option is supported."

API equivalents: `filter_scope` = `"parents"` / `"parents_and_subitems"` / `"subitems"`. ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views.md))

Cross-reference from the filters doc: "If you have sub-items turned on for your database, **your visibility settings for sub-items will also impact your filtered results.**" ([Views, filters, sorts & groups](https://www.notion.com/help/views-filters-and-sorts))

**Answering the specific question "do children show when the parent is filtered out?"** — the documentation defines the modes but does not spell out the parent-filtered-out case for each mode. What *is* documented: under `Parents only`, only matching **parents** render (plus a sub-item count); under `Sub-items only`, only matching **sub-items** render — which necessarily means sub-items can appear without their parent. Under `Parents and sub-items`, both matching parents and matching sub-items display. `UNRESOLVED:` whether, in `Parents and sub-items` mode, a matching sub-item is rendered when its parent does *not* match — and if so, whether it is hoisted to top level or shown under a greyed parent. See §10.

**A documented adjacent behaviour** — restricted pages preserve structure: "`Nested in toggle` view will retain sub-item tree structure even if some pages are restricted." ([Sub-items & dependencies](https://www.notion.com/help/tasks-and-dependencies))

`UNRESOLVED:` Interaction of sub-items with **sorts** and **grouping** specifically (e.g. whether sorts apply within a parent's children, or whether grouping forces a flattened presentation) is not documented. See §10.

#### 3.6 Move / duplicate / delete semantics

Verbatim from [Sub-items & dependencies](https://www.notion.com/help/tasks-and-dependencies):

- **Move:** "When you move an item with sub-items, **sub-items will be turned on for the target database if they aren't already.**"
  - "If you don't have permission to turn on sub-items on the target database, **sub-items will be turned into parent items** once they're moved."
  - "If you don't have edit access for a particular sub-item, it won't be moved."
- **Duplicate:** "the item and all its sub-items will be duplicated into new pages."
- **Delete:** "**When you delete an item with sub-items, all of the sub-items will be deleted as well.** Make sure to move your sub-items out of the parent item if you want to keep them." — cascading delete.

#### 3.7 Rollups over sub-items

Because sub-items are an ordinary (self-)relation, ordinary rollups work over them. Rollups are configured against a relation property + a target property + a function. ([Relations & rollups](https://www.notion.com/help/relations-and-rollups))

Full documented function list ([Property object → Rollup](https://developers.notion.com/reference/property-object.md)):
`average`, `checked`, `count`, `count_values`, `date_range`, `earliest_date`, `empty`, `latest_date`, `max`, `median`, `min`, `not_empty`, `percent_checked`, `percent_empty`, `percent_not_empty`, `percent_unchecked`, `range`, `show_original`, `show_unique`, `sum`, `unchecked`, `unique`.

Rollup property object fields: `function`, `relation_property_id`, `relation_property_name`, `rollup_property_id`, `rollup_property_name`.

Constraints from the help center ([Relations & rollups](https://www.notion.com/help/relations-and-rollups)):
- "Rollups can only be sorted when they output a numeric value."
- Certain rollup calculations are only available for specific property types.
- Relations are **one-way by default**; two-way must be toggled on. When relating a database to itself "we recommend toggling **Two-way relation**" — which is exactly what sub-items do.
- Relations can be capped: `No limit` or limited to a specific number of related pages.
- Aggregate calculations (sums/ranges/averages) can be applied on top of a rollup column in tables and boards.

A concrete sub-item rollup pattern documented by Notion is in the automations doc, where a variable is defined as `Trigger page.Sub-item` and then used to bulk-edit children (§6.4).

`UNRESOLVED:` Whether rollups traverse the sub-item tree **recursively** (grandchildren included) or only direct children. Nothing in the docs addresses depth. Also `UNRESOLVED:` "Can I rollup a rollup?" is listed as an FAQ heading in the databases category index but the answer text was not retrievable from the static page. See §10.

---

### 4. Dependencies

Canonical source: [Sub-items & dependencies](https://www.notion.com/help/tasks-and-dependencies).

#### 4.1 What they are

> "Adding a dependency lets you connect tasks to each other in a **linear** way. Use a dependency when you want to communicate related tasks to your team."

> "You could use dependencies in a timeline view to flag tasks that need to be completed before you move on to the next. **This functions in much the same way as sub-items** and is just another way to visually connect your work." — [Break tasks into manageable steps](https://www.notion.com/help/guides/tasks-manageable-steps-sub-tasks-dependencies)

Like sub-items, dependencies are **built on relation properties**: "Sub-tasks and dependencies are built using Notion's **relations properties**." Turning dependencies on creates the blocking/blocked-by pair of relation properties.

`UNRESOLVED:` The help center does not name the two created properties in text. The commonly-seen labels are "Blocking" and "Blocked by", but I could not confirm this from a Notion-owned page. See §10.

#### 4.2 Enabling

Settings menu → `Database settings` → `More settings` → `Dependencies` → configure date-shifting + weekend option → `Turn on dependencies`. Also reachable from `Database settings` as a straightforward on/off ([Database settings](https://www.notion.com/help/customize-your-database)).

Changing settings later: same path → `Dependencies` → "Select a new option for automatic date shifting" and toggle `Avoid weekends`.

#### 4.3 Which views render them — **timeline only**

> "you can click on the arrow and drag it to connect one task with another to create a dependency **which will appear only in a timeline view**." — [Break tasks into manageable steps](https://www.notion.com/help/guides/tasks-manageable-steps-sub-tasks-dependencies)

Creation gesture: "When you hover over any database item in your timeline, an arrow will appear on the right side. You can click on the arrow and drag it to connect one task with another."

Also: "You can then choose whether to show dependencies by parent or sub-task."

**API model** — timeline views carry an `arrows_by` object ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views.md)):

```json
"arrows_by": { "property_id": "RELATION_PROPERTY_ID" }
```

> `property_id` — "Relation property ID for dependency arrows, or `null` to disable arrows."

The feature-support matrix marks `preference` / `arrows_by` as **Optional on Timeline only**, and `-` for every other view type — corroborating that dependency arrows are timeline-exclusive.

Full timeline configuration for reference:
```json
{
  "type": "timeline",
  "date_property_id": "START_DATE_PROPERTY_ID",
  "end_date_property_id": "END_DATE_PROPERTY_ID",
  "properties": [...],
  "show_table": true,
  "table_properties": [...],
  "preference": { "zoom_level": "month", "center_timestamp": 1706745600000 },
  "arrows_by": { "property_id": "RELATION_PROPERTY_ID" },
  "color_by": true
}
```
`zoom_level` ∈ `hours`, `day`, `week`, `bi_week`, `month`, `quarter`, `year`, `5_years`.

#### 4.4 Date shifting — **exact option names and semantics**

These are the three mutually-exclusive automatic-date-shifting settings, quoted verbatim from [Sub-items & dependencies](https://www.notion.com/help/tasks-and-dependencies):

| Option name (exact) | Documented semantics (exact) |
|---|---|
| **`Shift only when dates overlap`** | "Tasks will only be shifted when their dates start to overlap. **The distance between tasks may still be decreased.**" |
| **`Shift & maintain time between items`** | "If task A is blocking task B and the due date of task A is shifted forward one week, the due date of B will also shift forward one week." |
| **`Do not automatically shift`** | "Due dates are never automatically shifted." |

Read them as: *preserve-overlaps-only* (minimal correction, gaps may close), *preserve-gaps* (rigid translation of the whole downstream chain), and *off*.

Plus one independent boolean:

| Toggle (exact) | Documented semantics |
|---|---|
| **`Avoid weekends`** | Set at turn-on time as: "Choose whether you want to prevent shifted items from starting or ending on weekends." Later editable as "Toggle on or off `Avoid weekends`." |

Note the precise scope of `Avoid weekends`: it constrains **shifted** items' **start** and **end** dates. It is not documented as re-flowing durations or as applying to manually-set dates.

The task brief anticipated names like "shift dates" / "avoid gaps" / "preserve overlaps". Those are **not** Notion's strings. The real strings are the four above.

#### 4.5 Circular dependencies

`UNRESOLVED:` **No Notion-owned documentation of circular-dependency handling.** Nothing in the help center or API reference states whether a cycle is rejected at creation time, silently allowed, or allowed-but-not-shifted. Third-party blogs discuss "the circular dependency trap" as a practical concern but are not authoritative and are not cited here as fact. See §10.

#### 4.6 Cross-database dependencies

The help center only ever describes dependencies as a **database setting** applied to one database, created by dragging between items **within a timeline of that database**, and built on relation properties — the same framing as sub-items, which are explicitly self-relations.

The API's `arrows_by.property_id` is described generically as "Relation property ID for dependency arrows" — it does **not** say the relation must be self-referencing. That is suggestive but not dispositive.

`UNRESOLVED:` Whether dependencies can span two different databases. See §10.

---

### 5. Database templates (row templates)

Canonical source: [Database templates](https://www.notion.com/help/database-templates), plus the API-side [Creating pages from templates](https://developers.notion.com/guides/data-apis/creating-pages-from-templates.md) and [List data source templates](https://developers.notion.com/reference/list-data-source-templates.md).

#### 5.1 What a template is and what it captures

> "Most databases contain the same types of pages created over and over again. Think of weekly meeting notes, bug reports, or design specs. To make this easy, database templates let you define and replicate certain page structures with one click."

**Creation:** dropdown arrow next to `New` at the top right of the database → `+ New template`. While editing, a bar across the top indicates which database the template lives in. The page **title becomes the template's name**.

**What it captures:**
- **Property values** — "you can create a template for bug reports that automatically puts `P1` in the Priority property and assigns the user `Fig` to the Product Manager property."
- **Page body content** — "Templates can contain any type of content, including images, embeds, and **sub-pages**. Whatever you choose will show up identically on each page created with the template."

**Relation caveat (documented twice):** "If you add a relation property to a template, **do not fill it in** unless you want every page you create with that template to relate to the same existing page(s)."

`UNRESOLVED:` Whether a database template can capture **sub-items** (child rows) such that instantiating it creates the whole sub-tree. The docs say templates can contain "sub-pages" (body blocks), which is not the same as sub-item rows. See §10.

**Scope:** "they're only available in the specific database where you created them. For every new database you create, you can define new templates."
**Count:** "Is there a limit to the number of database templates I can make? **Nope!** You can make as many as you want."

**Using one:** create a new page in the database and pick from the grey menu; or use the dropdown next to the blue `New` button. "Once you've created a new page with a template, you can make any changes you want to the content that appeared."

#### 5.2 Default templates

Templates carry a **default** flag, exposed in the API:

`GET /v1/data_sources/{data_source_id}/templates` returns a `templates` array (up to 100 per page, cursor-paginated, with an optional case-insensitive substring `name` filter). Each entry:

| Field | Type | Description |
|---|---|---|
| `id` | UUIDv4 | The template ID |
| `name` | string | Display name |
| `is_default` | boolean | "Whether the template is the data source's default." |

([List data source templates](https://developers.notion.com/reference/list-data-source-templates.md))

> "The Notion app can be used to create and manage templates, and **designate one as the 'default' template**" — [Creating pages from templates](https://developers.notion.com/guides/data-apis/creating-pages-from-templates.md)

Note the scoping: `is_default` is **per data source** ("the data source's default"), reached through a data-source-scoped endpoint.

`UNRESOLVED:` Whether a **per-view** default template exists (distinct from the data-source default), and the exact UI path for marking a template default. Neither is documented on the pages I could retrieve. See §10.

**Templates are pages:** "Templates are also Notion pages. Use Retrieve a page to get a template's properties and content. You can also open a template in Notion and copy its URL to find its ID." Access follows the parent: "if a bot is connected to the data source's parent database, those permissions apply to all templates for the data source by default, since templates are represented as (special) pages under the data source."

**API application of templates** ([Creating pages from templates](https://developers.notion.com/guides/data-apis/creating-pages-from-templates.md)):

| `template[type]` | `template[template_id]` | Behaviour |
|---|---|---|
| `none` (or omitted) | N/A | No template; provided `children` and `properties` applied immediately |
| `default` | N/A | Applies the data source's default template. **`children` cannot be specified.** |
| `template_id` | template ID (dashes optional) | Applies that specific template. **`children` cannot be specified.** |

It is **asynchronous**: "the Create Page API request returns immediately with a Page object representing a blank page … Afterwards, Notion's systems quickly begin applying the chosen template in the background, replacing the page content and merging in the template's properties." Completion is signalled by `page.content_updated` — often aggregated into `page.created`. The recommended handler logic is spelled out in that guide.

"The key difference is that the API bot user (rather than a person) is set as the 'created by' user (i.e. author) of the new page."

**Applying a template to an existing page:** Update Page accepts the same `template` parameter. "the template's content is **appended** to any existing page content. There's another optional body parameter, **`erase_content`**, that can be set to `true` if you instead want the template's content to fully replace any existing page content. Use caution with this flag, as this is a destructive operation that cannot be reversed in the API!"

**Any page can act as a template** via `template_id`, "not necessarily a page officially designated as a 'template' in the same data source" — but it must be in the same workspace, the bot must have access, and "Using the ID of a page in a different data source is currently not recommended, because the schema may not match, causing some properties to fail to be merged."

#### 5.3 Repeating templates

> "Repeating database templates automatically create a copy of a template in your database however often you would like." — [Database templates](https://www.notion.com/help/database-templates)

**Setup:** dropdown next to `New` / `+` at the top of the database → `•••` next to the template → dropdown next to `Repeat`.

**Documented schedule options** ([Database templates](https://www.notion.com/help/database-templates)):
- Frequency: **daily, weekly, monthly, or yearly**.
- **Interval**: "Indicate how many weeks, months, or years you want in between repeats".
- **Start date**.
- **Time of day**: "the time you want your database template to be repeated".

The companion guide adds a **`Custom`** option ([Automate work with repeating database templates](https://www.notion.com/help/guides/automate-work-repeating-database-templates)):
> "Select 'Repeat', and choose how often you want an entry to be created from the template. You can choose every day, week, month or year, or go to '**Custom**'. Here, you can customize the repeating frequency further, and choose whether you want your repeating template to appear **every 3 days, on Tuesday and Thursday every week, or every 2 months**, for example."

So Custom supports: every-N-days, specific weekdays (multi-select) per week, and every-N-months.

**Stopping:** "If you ever want to stop a repeating template, you can either **delete the template entirely**, or go to the template options and **turn 'Repeat' off**."

`UNRESOLVED:` **End conditions.** Notion documents a start date but I found **no Notion-owned documentation of an end date / "after N occurrences" / "ends never" setting** for repeating database templates. The only end mechanism documented is turning Repeat off or deleting the template. (Contrast: *database automations* on an `Every {frequency}` trigger explicitly do have begin and end dates — see §6.5.) Do not assume parity. See §10.

**Authorship of generated rows:** "A repeating template will show as being '**Created By**' Notion automation — be sure to adjust views and filters accordingly when you start using these in your workspace!" ([Automate work with repeating database templates](https://www.notion.com/help/guides/automate-work-repeating-database-templates))

**Automation interaction — important:** "A recurring template automation will **not** trigger a database automation." ([Database automations](https://www.notion.com/help/database-automations))

**Nesting limits** ([Database templates](https://www.notion.com/help/database-templates)):
- "You **can't nest a template within a template that recurs daily.** You can only nest a template within a template that recurs weekly, monthly, or yearly."
- "You can only have **three levels of nesting** per database template."

#### 5.4 Template variables (date placeholders)

**Yes, Notion supports them.** Two independent confirmations:

1. API: "Template variables like **`@now`** and **`@today`** resolve using a timezone. By default, public connections and personal access tokens use the associated user's timezone, and internal connections use UTC. To override this, pass an IANA timezone string in `template[timezone]` (e.g. `America/New_York`, `Europe/London`, `Asia/Tokyo`)." ([Creating pages from templates](https://developers.notion.com/guides/data-apis/creating-pages-from-templates.md); `timezone` shipped 2026-03-11 per changelog)
2. API: "Any placeholder values (e.g. '**Current time when duplicating template**') are appropriately populated, the same way they would be when a Notion user applies a template in the app."
3. Help center FAQ: "Can I use an @-tag such as **@today** inside a template button? **Yes!** You'll be able to specify whether you want the @-mention to input a **fixed date or user**, or the **date or user upon duplication**." ([Buttons](https://www.notion.com/help/buttons))

That last quote also establishes the two-mode semantics: an `@`-mention in a template is either **frozen at authoring time** or **resolved at instantiation time**, and the author chooses.

`UNRESOLVED:` The complete list of template placeholder variables (beyond `@now`, `@today`, "Current time when duplicating template", and user mentions). See §10.

#### 5.5 Duplicating and editing templates

From the template dropdown (`+` / `New` → `•••` next to the template) ([Database templates](https://www.notion.com/help/database-templates)):
- `Edit` — "Make your changes in the editing view that pops up."
- `Duplicate`
- `Delete`
- `Repeat` (see §5.3)

Editing an existing template does **not** retroactively change pages already created from it (implied by "Once you've created a new page with a template, you can make any changes you want to the content that appeared" — instantiation is a copy). `UNRESOLVED:` whether template edits ever propagate to already-instantiated pages. See §10.

---

### 6. Buttons and automations

Notion has **three** distinct automation surfaces. Keeping them separate matters because their action lists differ:

| Surface | Where it lives | Trigger |
|---|---|---|
| **Button block** | A block on any page | User click |
| **Button property** | A database property (column) | User click on a row |
| **Database automation** | Database settings (⚡ menu) | Event or schedule |

#### 6.1 Button block — complete action list

Source: [Buttons](https://www.notion.com/help/buttons). Create: type `/` → `Button`; give it a name and emoji; `New action`; add more; `Done`.

| Action | Configuration | Gating |
|---|---|---|
| **Insert blocks** | "add blocks of your choice, like text, bullets, toggles, and more, into your page." Placement: **`Above button`**, **`Below button`**, **`At top of page`**, **`At bottom of page`** | — |
| **Add page to** | "add a page to a database of your choosing, and edit the properties of that page" | — |
| **Edit pages in** | "edit pages and properties in a database of your choosing" | — |
| **Send notification to** | "send a notification to specific people in your Notion workspace. Your recipient can be **up to 20 people** in your workspace, or people who are associated with a certain People property." Plus a message | — |
| **Send mail to** | Gmail send — full config below | `PLAN-GATED (paid)` `EXTERNAL (Gmail)` |
| **Send webhook** | "send an HTTP POST request to a specific URL" | `PLAN-GATED (paid)` |
| **Show confirmation** | "open a small confirmation screen anytime someone clicks the button. For example … a warning before a page or database is changed by the button" | — |
| **Open page or URL** | "open a selected page or link. If you choose to set the button to open a Notion page, this could be an **existing page or a page that's created within the button itself**" | — |
| **Send Slack notification to** | custom notification to a chosen Slack channel | `PLAN-GATED (Plus, Business, Enterprise)` `EXTERNAL (Slack)` |
| **Define variables** | "create a custom variable using mentions and formulas" for use in later actions | — |

**Chaining:** actions run as an ordered list built via `New action` / `Add action` / `Add another step`. Variables defined by `Define variables` are consumable by *subsequent* actions in the same button. There is no documented branching or conditional-step construct.

**Permissions** ([Buttons](https://www.notion.com/help/buttons)):
- Create/edit/click a page button: `Full access` or `Can edit` on that page.
- "If the button is adding a page to or editing a page in a database, the person who clicks the button must be an **editor of the target database**."
- "If the button is opening a page, the person who clicks the button must have access to view the page."

**Gotcha:** "Why is my button not naming a created page properly? … if you're using a template within a button to create a page. **The values from the template overwrite the values from the button.**"

#### 6.2 Button property (database button) — complete action list

Source: [Database buttons](https://www.notion.com/help/database-buttons). Create: settings slider → `Edit properties` → `New property` → `Button` → label → `Edit automation` → `New action`.

Same list as §6.1 **minus `Insert blocks`**, **plus** `Edit property`:

| Action | Notes | Gating |
|---|---|---|
| **Edit property** | "edit the properties of pages in the database you are currently in" | — |
| **Add page to** | + edit that page's properties | — |
| **Edit pages in** | pages and properties in a chosen database | — |
| **Send notification to** | up to 20 people, or a People property | — |
| **Send mail to** | Gmail | `PLAN-GATED (paid)` `EXTERNAL (Gmail)` |
| **Send webhook** | HTTP POST | `PLAN-GATED (paid)` |
| **Show confirmation** | | — |
| **Open page or URL** | | — |
| **Send Slack notification to** | | `PLAN-GATED (Plus, Business, Enterprise)` `EXTERNAL (Slack)` |
| **Define variables** | | — |

**Permissions** ([Database buttons](https://www.notion.com/help/database-buttons)):
- **Create/edit** a database button: `Full access` or `Can edit`.
- **Click** a database button: `Full access`, `Can edit`, **or `Can edit content`**.
- "Database buttons are available on all plans, but certain database button actions are only available on paid plans."

**Buttons can trigger database automations** — unlike automations themselves: "**Button actions**, however, can trigger database automations. For example: … A user clicking a button that creates a page **will** trigger a database automation." ([Database automations](https://www.notion.com/help/database-automations))

#### 6.3 `Send mail to` — full configuration (identical across all three surfaces)

Sources: [Buttons](https://www.notion.com/help/buttons), [Database buttons](https://www.notion.com/help/database-buttons), [Database automations](https://www.notion.com/help/database-automations).

Fields:
- **Send mail from** — the linked Gmail account; multiple accounts addable via `Add Gmail Account`.
- **To** — a person property (e.g. `Whoever triggered` / `Whoever clicked`, `Page creator`), a workspace person, or a literal email address. "This email address can be **external** — it doesn't have to belong to someone in your workspace or your organization."
- **CC/BCC** — optional.
- **Subject** — supports `@` mentions and `∑` formulas.
- **Message** — supports `@` mentions and `∑` formulas.
- **Send with display name** — optional; supports `@` and `∑`.
- **Send replies to** — optional; a person property or workspace person.

Constraints:
- Requires a Gmail account. `EXTERNAL`
- "Once someone has linked their Gmail account to an automation, **only they will be able to edit the automation.** Others will only be able to use the automation."
- "Emails sent using this automation may take up to **two minutes** to arrive."
- Gmail's own recipient/day limits apply.

#### 6.4 Mentions, formulas, and variables

- `@` inserts a mention: a date, person, page, group, or **a property from the trigger page**.
- `∑` opens a formula editor. In buttons, formulas can use "properties of your button, like **who clicked it, the date the button action was triggered**, and more."
- **"Mentions and formulas can only be used in … actions, not triggers."** (stated on all three surfaces)
- **Formulas cannot be used in:** `Insert blocks`, `Open page or URL`, `Send Slack notification to` (buttons); and `Send Slack notification to` (database automations). ([Buttons](https://www.notion.com/help/buttons), [Database buttons](https://www.notion.com/help/database-buttons), [Database automations](https://www.notion.com/help/database-automations))

**Define variables** — the mechanism that gives these automations a crude data flow. Notion's own worked example (mark all sub-items complete when the parent is) is instructive because it shows variables can hold **page collections**, not just scalars ([Database automations](https://www.notion.com/help/database-automations)):

1. Trigger: `Status set to Complete`.
2. Action `Define variables` → `∑` → build formula `Trigger page.Sub-item` (typing `Trigger page.` surfaces the trigger page's properties).
3. Action `Edit pages in...` → `Select database` dropdown → choose **`Variable 1`** (i.e. the variable stands in for a page set).
4. `Edit a property` → `Status` → `Complete`.

Variables can be renamed, have their formula edited, be duplicated, and multiple variables added (`Add variable`).

Notion AI can assist writing formulas. `AI-HOSTED`

#### 6.5 Database automations — triggers

Source: [Database automations](https://www.notion.com/help/database-automations). Create: `⚡` at the top of a database → `New automation` → name → `New trigger` / `Add trigger` → `New action` / `Add action` → `Create`.

**Multi-trigger combinator:** "you can decide whether the automation will take place **`When any of these occur`** or **`When all of these occur`**."

**Three trigger types:**

| Trigger | Semantics |
|---|---|
| **`Page added`** | "triggered when a new page is added to your database" |
| **`Property edited`** | "triggered when a specific property from your database is edited. For **name, person, number, text, select, and relation** properties, you can choose what kinds of edits made to that property will trigger an automation." (e.g. `is set to`, `contains`, "a phone number starting with 732") |
| **`Every {frequency}`** | "your automation will be recurring… repeat every day, week, month, and so on. You can also set **a time** that the automation will be triggered, **the date that the automation trigger will begin and end**, and the **timezone**." |

**Trigger rules:**
- "You can have more than one condition for your trigger so that two or more things must be true."
- "a **recurring trigger** … can't be paired with another type of trigger."
- "The `Every {frequency}` trigger works with **all** automation actions **except for `Edit property`**."
- Multi-`is edited` triggers under `When all of these occur` must fire "within a small window of about **three seconds**"; otherwise use separate automations or a more specific trigger.

**Scope:** "During the creation process, you can specify if the automation should run on pages in the **entire database**, or in a **specific view**. If any filters in that view change, the automation will then apply to the adjusted list of pages."

#### 6.6 Database automations — actions

| Action | Semantics | Gating |
|---|---|---|
| **Edit property** | "edit the properties of pages in the database you are currently in. For **multi-select, people, and relation** properties, you can **add or remove individual values** instead of adding or removing all values at once." | — |
| **Add page to** | "add a page to a database of your choosing, and edit the properties of that page" | — |
| **Edit pages in** | "edit pages and properties in a database of your choosing" | — |
| **Send notification to** | up to **20** workspace people, or people from a People property, + a message | — |
| **Send mail to** | Gmail (see §6.3) | `EXTERNAL (Gmail)` |
| **Send webhook** | "send an HTTP POST requests to the specified URL" | — |
| **Send Slack notification to** | custom notification to a Slack channel | `PLAN-GATED (Plus, Business, Enterprise)` `EXTERNAL (Slack)` |
| **Define variables** | custom variables from mentions/formulas, usable in later actions | — |

Note: there is **no** `Show confirmation` and no `Open page or URL` in database automations (those are button-only, since they need a clicking user), and no `Insert blocks` (button-block only).

There is **no documented "run a Notion AI step" action** in database automations. Notion AI appears only as an *assistant for writing formulas*. `UNRESOLVED:` whether an AI-powered automation action exists on any current plan. See §10.

#### 6.7 Automation limits, gating, and failure modes

**Plan gating** ([Database automations](https://www.notion.com/help/database-automations)):
- "Database automations are available on **paid plans** on all platforms." `PLAN-GATED`
- "Database automations can be created, edited, or deleted by **paid plan users who have full access to the database**."
- "**Slack automations can only be edited by the automation creator.**"
- "**Free Plan users can create Slack notification automations, but no other kinds of automations.**"
- "Free Plan users can use existing automations in templates, but they won't be able to edit them."
- "**Guests can't create database automations.**"

**No-automation-chaining rule:**
> "Database automations **can't be triggered by other automations.**
> - A recurring template automation will not trigger a database automation.
> - A database automation creating a page in another database will not trigger a database automation.
> - A user clicking a button that creates a page **will** trigger a database automation."

**Access rule:** "Automations won't take action on any pages whose access is restricted." Also: "make sure edited pages are … not `Private` or `Shared`. Otherwise, your automation won't work."

**Change-detection window:** "Database automations work over a **three second window**. For example, within this three second window, a user can remove a trigger and delete any changes, resulting in no property change to the automation."

**Errors and pausing:**
- Build-time errors block saving.
- "If your automation has **worked before but runs into an error, the automation will be paused.**"
- Notified for: missing database / missing property / invalid or unauthenticated Gmail or Slack connection.
- **Not** notified for: formula execution failures, webhook issues.
- Un-pausing is manual: database `•••` → `Automations` → hover → `•••` → toggle on `Active`.
- Known failure: "Automations may fail if they attempt to perform date calculations (such as `dateAdd`) on a field that is **empty or undefined** when the automation runs." Workaround: a filtered view excluding empties, and scope the automation to that view.
- "Automations may fail if they're applied to a database view that **filters out relevant entries**."
- "The page no longer matches a view's filters **after** it's edited. Automations only run if the page still matches the view when the trigger occurs."
- "The database is **locked**."

**Management:** `⚡` at the top of a database → hover an automation → `•••` → `Edit`, `Pause`, or `Delete`.

`UNRESOLVED:` **No documented cap on the number of automations per database**, nor a documented execution-count quota. See §10.

---

### 7. Import / export

#### 7.1 CSV import

Source: [Import data into Notion](https://www.notion.com/help/import-data-into-notion).

**Core mapping:** "CSV imports create a new Notion database (**rows → items/pages, columns → properties**)."

**Flow:**
1. `Settings` → `Import` → `CSV`, or type `/csv` in a page.
2. Upload the `.csv`.
3. **"Choose whether to create a new database or import data into an existing one."**
4. Select the import location.
5. **"Map each CSV column to the Notion property you want."**

**Merging into an existing database** — there is a dedicated entry point: "While in a full page database, click `••` at the top of a database → **`Merge with CSV`**. Set up the CSV columns by matching them to Notion properties."

**Type inference and its documented failure modes:**
- **"If a column has mixed data types, Notion may import it as text to avoid data loss."**
- "Dates import in **MM/DD/YYYY** format."
- "Values with commas not showing when mapped to **Select**: map that column to a **Text** property instead."
- "If numbers aren't importing correctly (like `$` amounts, `%`s, or negative values), map that column to **Text** instead."
- "Garbled characters: re-export your CSV as **UTF-8**."
- "make sure the **first row is headers**, and each data cell has a corresponding header."
- "The **Title property doesn't support formatting**."

Notably, the docs describe mapping as **explicit and user-driven** ("Map each CSV column to the Notion property you want") rather than fully automatic. `UNRESOLVED:` the precise auto-inference algorithm Notion pre-fills that mapping with. See §10.

**What can't be created by CSV import:**
- "A new CSV import **can't create new rollups or formulas** (you'll need to rebuild these in Notion after import)."
- "A new CSV import **can't create new relations.** If you add a CSV to an **existing** database, you can **map a CSV column to an existing relation property**."

**Merge semantics — append-only, no upsert:**
- "Imports **add rows. They don't update existing rows**, so watch for duplicates."
- "CSV merges add rows. They don't update existing rows."
- "If you're merging into an existing database, make sure your **CSV headers match the database's property names exactly**."

**Limits:**
- File size: **5 MB per file (Free)**, **50 MB per file (paid)**. `PLAN-GATED`
- "CSV and ZIP use different import options, so you won't be able to import multiple files at the same time." (Multi-file batching *is* available for PDF, HTML, Markdown, DOCX, TXT.)
- "If your spreadsheet is large, split it into multiple CSVs before importing to reduce errors and make property mapping easier."
- Excel: "first export it as a `.csv` file, then import it."

**ZIP import** (bulk): up to **5 GB per ZIP**; "10,000+ files are likely to fail or partially import"; hidden files (`.DS_Store`) can cause failures. Type mapping: "**CSV, XLSX, TSV/DSV, ODS import as Notion databases**"; DOCX/Text/Markdown/HTML/EPUB/OPML import as pages. PDFs and HWP do not import via ZIP.

**HTML / Markdown import limits:** 5 MB per file (Free) / 50 MB (paid); "Rate limit: about **120 file imports per 12 hours**."

#### 7.2 Export

Source: [Export your content](https://www.notion.com/help/export-your-content).

**Formats and what a database export contains:**

| Format | Database behaviour | Options |
|---|---|---|
| **Markdown & CSV** | "**Full page databases will be exported as a CSV file, with Markdown files for each subpage.**" "Any non-database Notion page can be exported as a Markdown file." "Callout blocks will be exported as HTML, as there is no Markdown equivalent." | `Include subpages` |
| **HTML** | "Any Notion page or database can be exported as an HTML file." Sub-pages become separate files in their own folders, with images/assets saved alongside. | `Include subpages`; **comments** — "you can also export comments at both the page and block levels. This includes **resolved and unresolved** comments and any files, pages, or users mentioned in them." |
| **PDF** | Any page or database. | `Include content`: **everything**, or **exclude files and images**; `Page format` (paper size); `Scale percent`; `Include subpages` `PLAN-GATED (Business, Enterprise)`. "**Custom emojis will not appear in PDF exports.**" "If a PDF export fails, Notion will instead export as HTML." |

**Which rows are exported — filtered view vs all:**
> "Can I export all of my database views? — **When exporting a database, you can only choose between the current view and the default view.** Exporting all views at once isn't supported."

That is the documented answer to "all rows or filtered view": the export is **view-scoped**, and you pick current-view or default-view. `UNRESOLVED:` whether the "current view" export applies that view's filters/sorts to the emitted rows, or only its property (column) selection. See §10.

**Form views cannot be exported:** "you can't export a Form view of a database. Try exporting your questions and responses from Table view instead."

**Sub-page folders:** exports create nested folders for subpages; there is a **`Create folders for subpages`** checkbox that can be unchecked (recommended workaround for Windows' 260-character path limit).

**Printing:** "You cannot print a full-page database this way [browser print]. You'll need to export it as a PDF first and then print the PDF file." No direct printing from the desktop app.

**Workspace export** ([Export your content](https://www.notion.com/help/export-your-content)):
- "export all your pages as HTML, Markdown, or CSV (for databases), along with any files you've uploaded."
- Workspace-to-PDF is `PLAN-GATED (Business, Enterprise)` **and being removed**: "The option to export workspace content as a PDF is going away. This change will be rolled out to workspaces gradually between now and **August 31, 2026**."
- "Pages that the exporter doesn't have access to, such as private pages of other users, will not be included."
- "A **sitemap (`index.html`)** is included in the export… locally linked to the exported pages in HTML and Markdown formats."
- Email link **expires after 7 days**; "Exports can take up to **30 hours** to process."
- Desktop/web only.
- "You **can't** instantly recreate your workspace by reuploading your exported workspace content." — export is not a round-trippable backup.

**Export can be disabled by admins** `PLAN-GATED (Enterprise)`: workspace owners via `Settings → Security → Disable export`; teamspace owners per-teamspace. Guests need `Full access` to see the export option.

---

### 8. Other structural surface

#### 8.1 Permission levels on databases

Full ladder ([Sharing & permissions](https://www.notion.com/help/sharing-and-permissions)):

| Level | Semantics |
|---|---|
| `Full access` | "edit any of the content it contains and **share the page with anyone**" |
| `Can edit` | "edit the content on the page, but **not share** the page with others" |
| **`Can edit content`** | **database pages only.** "create and edit pages within the database, and edit property values for those pages. However, they will **not** be able to change the structure of the database and its properties, views, sorts, or filters." |
| **`Can create`** | **database pages only**, `PLAN-GATED (Business, Enterprise)`. "create new pages within the database, but **can't view or edit existing pages** they haven't been individually granted access to. This is useful when you want contributors to submit entries (like IT tickets, task requests, or form responses) without being able to see or modify other people's entries." |
| `Can comment` | comment only |
| `Can view` | read only |

`Can edit content` explicitly **cannot** ([Intro to databases](https://www.notion.com/help/intro-to-databases)):
- Add, edit, or remove database properties or views
- Change filters or sorts
- Lock or unlock the database

…but **can** "create linked databases and edit views, sorts, and filters in that linked database."

Permission-change requests appear in the owner's Inbox for approve/reject.

#### 8.2 Peek behaviour

Per-view setting: settings menu → `Layout` → **`Open pages in`** ([Views, filters, sorts & groups](https://www.notion.com/help/views-filters-and-sorts)):

| Option | Behaviour |
|---|---|
| `Side peek` | "Open pages on the right side of the database. **The rest of the database view continues to be interactive on the left.**" |
| `Center peek` | "Open pages in a focused, center modal." |
| `Full page` | "Open pages as full pages directly." |

**Defaults:** "Table, Board, List & Timeline layouts will open pages in **side peek** by default. Gallery & Calendar layouts will open pages in **center peek** by default."

And generally: "Pages will always open in a peek preview. Click `⤡` at the top left to view in full page mode." ([Intro to databases](https://www.notion.com/help/intro-to-databases))

Opening gestures: tables — hover the first column, click `OPEN`; lists — click the title; boards/calendars/galleries — click anywhere on the card.

#### 8.3 Views, filters, sorts, groups (structural facts a clone needs)

From [Views, filters, sorts & groups](https://www.notion.com/help/views-filters-and-sorts) and [Working with views](https://developers.notion.com/guides/data-apis/working-with-views.md):

- "New databases are created as **tables**."
- **View settings are per-view**: "Settings applied to one database view won't be applied across all other database views automatically."
- View settings menu: `Layout`, `Property visibility`, `Filter`, `Sort`, `Group`, `Sub-group`, `Copy link to view`.
- **Personal vs shared filters/sorts:** "You can choose to **`Save for everyone`** if you want the filter to be applied for everyone in the database view. If you want the filter to apply only for you, don't select this option." Same for sorts. This is a real two-tier model.
- **Advanced filters** nest AND/OR groups "up to **three layers deep**." A simple filter can be promoted via `•••` → `Add to advanced filter`.
- **Sorting semantics:** text sorts alphabetically; numbers numerically; "For `Select` and `Multi-select` properties, **you get to define what sorting order means**" by dragging options — i.e. select ordering is a *schema* property, not a lexical rule.
- **Groups:** hide/show individual groups (👁️), sort groups (manual / alphabetical / ascending / …), `Hide empty groups`. `Sub-group` gives a second layer.
- **Database search:** "Databases that contain at least **three pages** will also be searchable… Database search looks at database page **titles and properties**."
- **Freeze column:** click a column name → `Freeze up to column` / `Unfreeze column`.
- **View tab display:** `Display as` → `Icon only` / `Text only` / both. "**Only you will see this change.**"
- Sidebar: views nest inside a full-page database, marked with a `•`.

**API group-by model** (useful because it enumerates every grouping strategy Notion supports) ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views.md)):

Shared fields: `type`, `property_id`, `sort` (`manual` / `ascending` / `descending`), `hide_empty_groups`.

| Property type | `group_by` values | Extra |
|---|---|---|
| `status` | `"group"` (To Do/In Progress/Done) or `"option"` | — |
| `date`, `created_time`, `last_edited_time` | `relative` \| `day` \| `week` \| `month` \| `year` | `start_day_of_week`: 0 (Sun) or 1 (Mon) |
| `text`, `title`, `url`, `email`, `phone_number` | `exact` \| `alphabet_prefix` | — |
| `number` | — | `range_start`, `range_end`, `range_size` (≥1) bucket grouping |
| `formula` | nested group-by object matching the formula's result type | — |

**Quick filters** — a distinct concept from view filters: "Quick filters appear in the view's filter bar and let users quickly toggle property-level filters without opening the full filter panel. In the API, `quick_filters` is a map where keys are property names or IDs, and values are filter conditions using the same shape as property filters but **without the `property` field**." Set a key to `null` to remove that one. ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views.md))

**Other per-view config worth cataloguing** (from the same guide): table `wrap_cells`, `frozen_column_index`, `show_vertical_lines`; board `card_layout` (`list`/`compact`), `cover` (`page_cover` / `page_content` / `property`), `cover_size` (`small`/`medium`/`large`), `cover_aspect` (`contain`/`cover`); calendar `view_range` (`week`/`month`), `show_weekends`; form `is_form_closed`, `anonymous_submissions`, `submission_permissions`; map `map_by`, `height`; chart `chart_type`, `x_axis`, `y_axis`, `stack_by`, `group_style` (`normal`/`percent`/`side_by_side`), `hide_empty_groups`; dashboard `rows` (read-only).

#### 8.4 Comments on rows

Rows are pages, so page/block comments apply ([Comments, mentions & reminders](https://www.notion.com/help/comments-mentions-and-reminders), [Intro to databases](https://www.notion.com/help/intro-to-databases)):
- Page-level comments appear in the row-page header; display is `Expanded` or `Off` per the Customize page menu.
- Block-level comments via the block handle or hover.
- "You can't comment on multiple blocks at a time. However, you can select text across multiple blocks and leave a comment via the menu that appears."
- Comments have resolved/unresolved states (both are included in HTML export).
- API: comments "can only have blocks or pages as parents, **not databases or data sources**" — which is why the Comments endpoints were unaffected by `2025-09-03`. ([Upgrade FAQs](https://developers.notion.com/guides/get-started/upgrade-faqs-2025-09-03.md)) Update/Delete comment endpoints went GA 2026-04-17; "Non-DLP integrations can only modify or delete comments they created."

#### 8.5 Mentions, links, backlinks

- **Database mentions in rich text reference the database, not the data source.** ([Upgrade guide 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03.md))
- "Every block in Notion has its own **anchor link**"; rows expose `Copy link` for a per-item anchor link. ([Create links & backlinks](https://www.notion.com/help/create-links-and-backlinks), [Intro to databases](https://www.notion.com/help/intro-to-databases))
- **Backlinks** on a row page: `Expanded` / `Show in popover` / `Off`.
- A `Link to page` block makes the linked page "show up in your sidebar under the page where you inserted the link, just like any other sub-page."
- As of early June 2026, generated URLs and mention `href`s point at `https://app.notion.com/p/{page-id}`; old `notion.so` links still resolve. ([Changelog, July 15 2026](https://developers.notion.com/page/changelog.md))

#### 8.6 Synced databases (external) — distinct feature

`PLAN-GATED (Business, Enterprise)` `EXTERNAL`. Source: [Synced databases](https://www.notion.com/help/synced-databases).

- "Synced databases allow you to sync data from other platforms as Notion databases. Syncs are continuous but **only go one direction**."
- Platforms: **Jira** (boards, projects), **GitHub** (PRs, issues), **Asana** (projects, tasks), **GitLab** (merge requests, issues).
- Creation (Asana example): copy the project link, paste into Notion, `Paste as database`. "The synced database will be created in a **table view**, with all Asana properties automatically added."
- "You can add any Notion property to a synced database." Two caveats:
  - "If a property is deleted on the third-party app …, the associated synced database **row and all properties will be deleted**. They will be accessible in the trash to view what was deleted, **but cannot be restored**."
  - "If an added Notion property **shares a name** with any third-party properties …, that property **will not sync**."
- People properties support **identity mapping** between GitHub/Jira identities and Notion profiles.

This is orthogonal to the `2025-09-03` "data source" concept despite the naming collision. Note however that the API's data source object does acknowledge externally-synced sources: "Some externally synced data sources can be parented by another data source." ([Data source object](https://developers.notion.com/reference/data-source.md))

#### 8.7 Version history

Source: [Delete & restore content](https://www.notion.com/help/duplicate-delete-and-restore-content).

- Snapshot cadence: "A new version of a particular page will be recorded **every 10 minutes** as you actively edit it. **Two minutes** after you've made your last edit on a page, we will record another version."
- Retention `PLAN-GATED`: **7 days (Free)**, **30 days (Plus)**, **90 days (Business)**, **unlimited (Enterprise)**.
- Enterprise additionally gets "the history of **all** changes made to a page, including who made those changes and when."
- Requires at least `Can edit` access to view.
- Diff highlights cover: text edits, added/deleted blocks, some non-text changes (images, to-dos, callouts, colors), "some simple table and database changes." "Version history shows the main highlights, but it won't capture every single change." No detailed comparison on mobile.
- Database restore caveat (repeated from §2.7): properties restore, page bodies do not.
- Notion support can restore a backup snapshot "in the past 30 days" for accidental permanent deletion.

#### 8.8 Forms

`Form` is a view type ([Views, filters, sorts & groups](https://www.notion.com/help/views-filters-and-sorts), [Forms](https://www.notion.com/help/forms)). API config fields: `is_form_closed`, `anonymous_submissions`, `submission_permissions` ([Working with views](https://developers.notion.com/guides/data-apis/working-with-views.md)). Two structural constraints already noted: forms can only be added to the database that *owns* the data source (not to a linked one), and form views cannot be exported.

#### 8.9 Task databases and sprints

A database can be converted to a **Task database** (`Turn into Tasks`) and back (`Undo Task database`). Task databases relabel "Sub-items" as "Sub-tasks" and unlock a **Sprints** toggle in database settings. ([Database settings](https://www.notion.com/help/customize-your-database)) Sprints have their own help article (`/help/sprints`) not analysed here.

#### 8.10 Notion AI touchpoints on databases

- "Build with AI" when creating a database — give Notion AI a prompt to generate a database. `AI-HOSTED` ([Intro to databases](https://www.notion.com/help/intro-to-databases))
- Notion AI can create/edit formulas and answer formula questions. `AI-HOSTED` ([Database automations](https://www.notion.com/help/database-automations))
- MCP/AI-assistant querying of databases: "Teams on a **Business** plan with Notion AI can now query a single database or view directly from their AI assistant. This previously required Enterprise + Notion AI. **Querying across multiple databases in a single query still requires Enterprise + Notion AI.**" `AI-HOSTED` `PLAN-GATED` ([Changelog, June 22 2026](https://developers.notion.com/page/changelog.md))

---

### 9. Plan-gating and external-dependency summary

Consolidated so a clone can scope quickly.

#### Plan-gated

| Feature | Gate |
|---|---|
| Database automations (all except Slack notifications) | Paid plans |
| Slack notification action (button + automation) | Plus, Business, Enterprise |
| `Send mail to` action (buttons) | Paid plans |
| `Send webhook` action (buttons) | Paid plans |
| `Can create` permission level | Business, Enterprise |
| Synced databases (Jira/GitHub/Asana/GitLab) | Business, Enterprise |
| Archive (beta) | Business, Enterprise |
| PDF export with `Include subpages` | Business, Enterprise |
| Workspace PDF export | Business, Enterprise (**being removed by 2026-08-31**) |
| Version history retention | 7d Free / 30d Plus / 90d Business / unlimited Enterprise |
| Trash retention customization | Enterprise |
| Disable export (admin control) | Enterprise |
| Import file size | 5 MB Free / 50 MB paid |
| Multi-database AI querying | Enterprise + Notion AI |
| Single-database AI querying | Business + Notion AI |

#### Notion-AI-hosted
Build database with AI; AI formula authoring/explanation; AI database querying via MCP. No AI *action* exists inside database automations as far as the documentation shows.

#### External-service dependent
Gmail (`Send mail to`), Slack (`Send Slack notification to`), Jira/GitHub/Asana/GitLab (synced databases), arbitrary HTTP endpoints (`Send webhook`).

#### Free of gating
Database buttons themselves (all plans, some actions paid); sub-items; dependencies; database templates including repeating; views/filters/sorts/groups; locking; CSV import; Markdown/CSV/HTML export.

---

### 10. UNRESOLVED list

Every item here is a question I could not answer from a Notion-owned page. **None of these has been guessed at above.**

**Sub-items**
1. `UNRESOLVED:` What is the maximum sub-item nesting depth? (The "three levels" figure that circulates applies to *database template* nesting and to *advanced filter* nesting, not to sub-items.)
2. `UNRESOLVED:` In `Parents and sub-items` filter mode, is a matching sub-item displayed when its parent does **not** match the filter? If so, is it hoisted to top level or shown beneath a non-matching/greyed parent?
3. `UNRESOLVED:` How do sub-items interact with **sorts** — are sorts applied globally across the flattened set, or within each parent's children?
4. `UNRESOLVED:` How do sub-items interact with **grouping** — does enabling a group-by force a flattened presentation, or is nesting preserved inside groups?
5. `UNRESOLVED:` Do rollups over the sub-item relation traverse **recursively** (grandchildren) or only direct children?
6. `UNRESOLVED:` Answer to Notion's own FAQ "Can I rollup a rollup?" — the heading is indexed on the Databases category page but the answer body was not retrievable from the static HTML.

**Dependencies**
7. `UNRESOLVED:` The exact **names of the two properties** created when dependencies are turned on. ("Blocking" / "Blocked by" is widely reported but I found no Notion-owned page stating it.)
8. `UNRESOLVED:` **Circular-dependency handling** — rejected at creation, allowed but not shifted, or allowed with undefined shifting? No Notion documentation exists on this.
9. `UNRESOLVED:` Can dependencies span **two different databases**, or only within one? (Help center only ever describes the single-database case; the API's `arrows_by.property_id` does not state that the relation must be self-referencing.)
10. `UNRESOLVED:` When `Shift & maintain time between items` is active and a shift is applied, does it propagate transitively through a whole downstream chain (A→B→C) or only one hop?
11. `UNRESOLVED:` Does `Avoid weekends` extend a task's duration or merely translate its start/end off the weekend?
12. `UNRESOLVED:` Whether dependency date shifting fires on API-driven date changes or only on in-app edits.

**Locking**
13. `UNRESOLVED:` Are "Lock database" (database settings) and "Lock views" (page `•••` menu) the same underlying flag surfaced twice, or two independent locks? Their descriptions overlap almost completely but are worded differently.
14. `UNRESOLVED:` Is there a lock scoped to a **single view** (as opposed to the whole database's views)?

**Templates**
15. `UNRESOLVED:` Does a database template capture **sub-items** (child rows), such that instantiating it materialises the sub-tree? Docs confirm sub-*pages* (body blocks) only.
16. `UNRESOLVED:` Do repeating database templates support **end conditions** (end date, "after N occurrences", "never")? Only a start date, time, frequency and interval are documented; the only documented stop mechanism is turning Repeat off or deleting the template. (Database *automations* with an `Every {frequency}` trigger explicitly do have begin/end dates — do not assume parity.)
17. `UNRESOLVED:` The **complete list of template placeholder variables** beyond `@now`, `@today`, "Current time when duplicating template", and user mentions.
18. `UNRESOLVED:` Is there a **per-view** default template distinct from the data-source-level default exposed as `is_default`?
19. `UNRESOLVED:` The exact UI path for marking a template as default.
20. `UNRESOLVED:` Do edits to a template ever propagate to pages already instantiated from it? (Strongly implied to be "no", but not stated.)

**Automations / buttons**
21. `UNRESOLVED:` Is there a **cap on the number of automations per database**, or an execution-count quota per plan?
22. `UNRESOLVED:` Does any current plan offer a **Notion AI action step** inside database automations? (Docs show AI only as a formula-authoring assistant.)
23. `UNRESOLVED:` Whether the `Every {frequency}` automation trigger supports weekday selection / day-of-month selection, or only a plain interval.

**Databases as pages**
24. `UNRESOLVED:` Does trashing a database also individually trash each row-page (i.e. do rows appear as separate Trash entries), or does the database trash as one unit?
25. `UNRESOLVED:` Restoring a database from Trash — does it restore rows that were individually trashed *before* the database was trashed?

**Import / export**
26. `UNRESOLVED:` The **auto-inference algorithm** Notion uses to pre-fill CSV column→property-type mapping. (Documented behaviour: mapping is user-confirmed, mixed-type columns fall back to text, dates parse as MM/DD/YYYY. The inference rules themselves are undocumented.)
27. `UNRESOLVED:` When exporting "the current view", are that view's **filters and sorts applied** to the emitted rows, or only its property selection?
28. `UNRESOLVED:` Whether database **file/media property attachments** are included in a Markdown & CSV export (HTML and PDF exports document asset folders; the Markdown & CSV path does not say).
29. `UNRESOLVED:` Whether CSV export emits **sub-item relationships** in any recoverable form.

---

### 11. Source index

**developers.notion.com** (canonical `.md` renderings; append `.md` to any of these URLs to get the raw doc)
- [Database object](https://developers.notion.com/reference/database)
- [Data source object](https://developers.notion.com/reference/data-source)
- [Page object](https://developers.notion.com/reference/page)
- [View object](https://developers.notion.com/reference/view)
- [Parent object](https://developers.notion.com/reference/parent-object)
- [Data source properties (property object)](https://developers.notion.com/reference/property-object)
- [Changes by version](https://developers.notion.com/reference/changes-by-version)
- [Changelog](https://developers.notion.com/page/changelog)
- [Upgrade guide 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03)
- [Upgrade FAQs 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-faqs-2025-09-03)
- [Upgrade guide 2026-03-11](https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11)
- [Working with views](https://developers.notion.com/guides/data-apis/working-with-views)
- [Working with databases](https://developers.notion.com/guides/data-apis/working-with-databases)
- [Creating pages from templates](https://developers.notion.com/guides/data-apis/creating-pages-from-templates)
- [List data source templates](https://developers.notion.com/reference/list-data-source-templates)
- [Create a data source](https://developers.notion.com/reference/create-a-data-source)
- [Update a data source](https://developers.notion.com/reference/update-a-data-source)
- [Create a database](https://developers.notion.com/reference/create-database)
- [Update a database](https://developers.notion.com/reference/update-database)
- [Request limits](https://developers.notion.com/reference/request-limits)
- [Filter data source entries](https://developers.notion.com/reference/filter-data-source-entries)
- Full doc index: [llms.txt](https://developers.notion.com/llms.txt)

**notion.com/help**
- [Intro to databases](https://www.notion.com/help/intro-to-databases)
- [Database settings](https://www.notion.com/help/customize-your-database)
- [Data sources](https://www.notion.com/help/data-sources-and-linked-databases)
- [Sub-items & dependencies](https://www.notion.com/help/tasks-and-dependencies)
- [Break tasks into manageable steps with sub-tasks and dependencies](https://www.notion.com/help/guides/tasks-manageable-steps-sub-tasks-dependencies)
- [Database templates](https://www.notion.com/help/database-templates)
- [Automate work with repeating database templates](https://www.notion.com/help/guides/automate-work-repeating-database-templates)
- [Database automations](https://www.notion.com/help/database-automations)
- [Database buttons](https://www.notion.com/help/database-buttons)
- [Buttons](https://www.notion.com/help/buttons)
- [Views, filters, sorts & groups](https://www.notion.com/help/views-filters-and-sorts)
- [Relations & rollups](https://www.notion.com/help/relations-and-rollups)
- [Import data into Notion](https://www.notion.com/help/import-data-into-notion)
- [Export your content](https://www.notion.com/help/export-your-content)
- [Delete & restore content](https://www.notion.com/help/duplicate-delete-and-restore-content)
- [Sharing & permissions](https://www.notion.com/help/sharing-and-permissions)
- [Comments, mentions & reminders](https://www.notion.com/help/comments-mentions-and-reminders)
- [Create links & backlinks](https://www.notion.com/help/create-links-and-backlinks)
- [Optimize database load times & performance](https://www.notion.com/help/optimize-database-load-times-and-performance)
- [Synced databases](https://www.notion.com/help/synced-databases)
- [Timeline view](https://www.notion.com/help/timelines)
- [Board view](https://www.notion.com/help/boards)
- [Duplicate public Notion pages](https://www.notion.com/help/duplicate-public-pages)
- Full slug index: [help sitemap](https://www.notion.com/help/sitemap.xml)

## K. Architectural prior art (storage, query, formula, frontend)


**Research date:** 2026-08-08
**Purpose:** Evidence base for irreversible storage-engine and query-engine decisions. Every claim below is linked. Where I could not substantiate something, it is marked `UNRESOLVED:`.
**Scope note:** This is a tradeoffs document, not a feature inventory. The final recommendation section is explicitly labelled as opinion.

---

### 0. TL;DR of the evidence

1. **Everybody who built a serious Airtable/Notion-grid clone on a relational DB and cared about scale ended up with real physical tables and dynamic DDL** — Teable, Baserow, NocoDB, undb, Directus. None of the mature ones filter user data out of a JSONB blob.
2. **Notion itself is the counter-example**, but Notion is not a relational query engine. Notion stores property values in a `properties` JSON on the block row, keyed by a 4-character random id, shards by `workspace_id` across 480 logical shards, and does its filtering/sorting largely outside plain Postgres index scans. Its public API caps at `page_size: 100` with opaque short-lived cursors — consistent with a design that cannot cheaply do arbitrary deep offsets.
3. **The single hardest Postgres constraint** for the JSONB design: a GIN index only accelerates `@>`, `?`, `?|`, `?&`, `@?`, `@@`. It does **not** accelerate `properties->>'x' = 'y'`, does **not** accelerate ranges, and **cannot serve `ORDER BY` at all** (only B-tree can). Every non-containment predicate and every sort needs a *per-property* B-tree expression index.
4. **The single hardest Postgres constraint** for the dynamic-physical-tables design: `MaxHeapAttributeNumber = 1600`, and **dropped columns permanently consume an attnum slot** that `VACUUM FULL` will not reclaim. A table that has had 1,600 cumulative field add/drops is bricked until you rebuild it.
5. **Formulas:** every mature implementation materialises formula results into a real stored column and recomputes them via an explicit dependency graph. Nobody computes formulas at query time when they need to sort by them.

---

### 1. Notion's own internal data model

#### 1.1 "Everything is a block"

Notion's own engineering post, [*Exploring Notion's Data Model: A Block-Based Architecture*](https://www.notion.com/blog/data-model-behind-notion), defines a block as having:

- **ID** — "randomly-generated UUIDs (UUID v4)"
- **Properties** — "a data structure containing custom attributes about a specific block"
- **Type** — "defines how the block's properties and content are displayed and interpreted"
- **Content** — "an array (or ordered set) of block IDs representing the content inside this block"
- **Parent** — used for *permission inheritance*, i.e. the upward pointer is a permissions device, not a rendering device.

Key structural consequence, stated in that post: the model is a graph with **downward pointers** (`content` array, ordered) and **upward pointers** (`parent`). Ordering of children is a property of the *parent*, not a `position` column on the child. That is a deliberate choice and it is why Notion reorder operations are a single-row write on the parent.

#### 1.2 `collection`, `collection_view`, and the schema keyed by short random ids

The reverse-engineering literature is consistent here.

[Stephen Ou, *The Beauty of Notion*](https://stephenou.com/beauty-of-notion) describes:

- **Collection**: `{ id, name, schema }` where "Schema: the definition of each property (unordered)".
- The critical line: **"Each property definition besides the title uses a randomly-generated 4-character key."** Each definition holds `name`, `type`, and type-specific config.
- **Collection view**: holds `sort`, `filter` (property-based rules combined with AND/OR), `aggregation` (COUNT/SUM/AVERAGE/MIN/MAX), `group by`, and type-specific config (table column widths, board group-by, calendar date property, gallery cover).

The `notion-py` client ([`notion/collection.py`](https://github.com/jamalex/notion-py/blob/master/notion/collection.py)) confirms the runtime shape independently:

- Schema is a dict **keyed by property id**; each entry has `id`, `name`, `type`, plus a derived `slug`.
- The title column is special-cased: lookups for the identifier `"title"` return the property whose `type == "title"`. This matches Notion's public API docs, which state **"all Title properties have an `id` of `"title"`"** ([Property object reference](https://developers.notion.com/reference/property-object)).
- Values are read as `block["properties"][property_id]`, and the encoding is a *rich-text array*: `val[0][0]` is the scalar for number/select/checkbox, checkbox is the literal string `"Yes"`, multi-select is a comma-joined string in `val[0][0]`, relations/people are marked with the `‣` sentinel character.

The public API docs describe the property id as **"An identifier for the property, usually a short string of random letters and symbols"** and show URL-encoded ids in examples like `"%7B%5D_P"`, `"fy:{"`, `"ULHa"` ([Property object](https://developers.notion.com/reference/property-object)).

#### 1.3 WHY key the schema by a random short id instead of by name

No Notion engineer has published a sentence saying "we did it for X". So this is inference from the artifacts, and I mark the strength of each inference:

- **Rename is a metadata-only edit (strong).** If values were keyed by name, renaming a property would require rewriting the `properties` JSON of every row-page in the collection. Keyed by id, a rename is a one-field update to a single `collection` record. This is the dominant reason and it is directly visible in the data shape.
- **Type change without data loss (strong; supported by Stephen Ou).** Ou notes properties "store values as strings, allowing property types to change without data loss." The id survives the type change; a name-keyed store would still survive a type change, but the id-keyed store means the *identity* of the column is orthogonal to both its name and its type.
- **Name collisions and non-identifier characters are a non-issue (strong).** Notion property names are free text — emoji, spaces, duplicates. A short opaque key sidesteps every uniqueness/escaping problem. Note that Notion allows two properties with the same display name; a name key could not.
- **Short keys keep the per-row JSON small (moderate).** Four characters per key × N properties × every row. At Notion's scale (200B+ blocks, see §1.4) this is not a rounding error, but I have no published statement that this was a motivation.
- **Why *random* rather than sequential (moderate).** Random 4-char keys avoid coordination when two clients add a property concurrently in an offline-capable, CRDT-ish client. Notion's client is offline-first (see §1.5), so a client must be able to mint a property id locally without asking the server. Sequential ids would collide.

`UNRESOLVED: Notion has never published the rationale for the 4-char random property key. The above is inference from the observable data model, not a cited statement.`

`UNRESOLVED: the exact collision behaviour when two offline clients mint the same 4-char key (~1.7M keyspace for [a-zA-Z0-9] at length 4 — birthday collision is plausible within a single large collection). No published source.`

#### 1.4 Sharding, scale, and what that implies

[*Herding elephants: lessons learned from sharding Postgres at Notion*](https://www.notion.com/blog/sharding-postgres-at-notion):

- Everything **reachable from the `block` table by foreign key** was sharded together: `block`, `collection`, `space`, `discussion`, `comment`. Note `collection` is a sibling of `block`, not a child of it.
- **Partition key: `workspace_id` (UUID)**, chosen because "each block belongs to exactly one workspace" — minimising cross-shard joins.
- **480 logical shards over 32 physical databases** (15 logical shards per host), implemented as **separate Postgres schemas** (`schema001.block`, `schema002.block`, …) rather than native declarative partitioning, so the app can route directly.
- 480 was chosen because it "is divisible by a lot of numbers", allowing 32 → 40 → 48 hosts without redistributing.
- Migration: double-write, ~3-day backfill, verification, then a **5-minute** maintenance window for cutover.

[*Building and scaling Notion's data lake*](https://www.notion.com/blog/building-and-scaling-notions-data-lake) adds the numbers that matter most for a storage decision:

- **>200 billion blocks** (2024), from ">20 billion block rows in Postgres" in 2021; **doubling every 6–12 months**; hundreds of TB compressed.
- Re-sharded to **96 physical instances × 5 logical shards = still 480 logical**.
- **"90% of Notion upserts are updates."** This is the crucial architectural fact: Notion's workload is update-dominated, not insert-dominated. Data warehouses "are optimized for insert-heavy workloads", which is why Snowflake broke for them.
- Permission inheritance requires "expensive tree traversal computation" that "would simply time out in Snowflake".

**Implication for our design:** an update-dominated workload is the worst case for a wide JSONB column, because Postgres MVCC rewrites the whole tuple on every update (see §3.4). Notion mitigates this with sharding + a huge caching layer, not with clever Postgres indexing.

#### 1.5 Caching layer

Notion has published two relevant client-side caching pieces:

- [*How we sped up Notion in the browser with WASM SQLite*](https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite) — page navigation **20% faster in all modern browsers**, and by region: **28% Australia, 31% China, 33% India**. They had already shipped SQLite caching on desktop/mobile three years earlier.
- The block data-model post describes the client architecture: a **RecordCache** ("LRU cache on top of SQLite or IndexedDB"), source-of-truth databases behind it, and a **TransactionQueue** for offline-safe writes.

**Implication:** Notion's perceived database-view speed is substantially a *client-side cache* story, not a server-side index story. A clone that expects Postgres alone to deliver Notion-feeling latency is comparing against the wrong system.

`UNRESOLVED: I could not find a Notion engineering post specifically about server-side memcached/Redis, or one specifically titled around "making database views fast". The quastor.org summary "How Notion Decreased Latency by 20% with Caching" failed to fetch (empty response); the underlying primary source appears to be the WASM SQLite post above.`

#### 1.6 What the public API's pagination implies about storage

From the [Notion API pagination docs](https://developers.notion.com/reference/intro) and community write-ups:

- All list endpoints are **cursor-based**: `results`, `has_more`, `next_cursor`.
- **`page_size` maxes at 100.** Requesting 200 silently returns 100 with `has_more: true`. Default is 10.
- Cursors are **opaque** and reportedly **expire within minutes** ([resumelens write-up](https://www.resumelens.org/blog/notion/notion-api-and-oauth)), so you cannot checkpoint a cursor across job runs.

**What this implies:**

- No `OFFSET`. A hard 100-row cap plus opaque cursors plus short expiry is the signature of **keyset/seek pagination over a shard-local ordering**, quite possibly with server-side state or a snapshot token. If they had a stable B-tree index over a materialised sort key, a much larger page size and long-lived cursors would be cheap.
- The short expiry in particular suggests the cursor references something ephemeral (a cached result set / snapshot), i.e. **the view result is computed and cached, then paged out of the cache** rather than re-queried per page.
- For our clone this argues: **decide your pagination contract before your storage layout**. Keyset pagination requires a total order over an indexed column. In the JSONB design, that means a per-sort-property B-tree expression index (§3.2); in the physical-table design it's a plain index.

`UNRESOLVED: whether Notion's cursor encodes a keyset position or a server-side result-set handle. Not published.`

---

### 2. Open-source clones — what their schemas actually do

#### 2.1 Teable — physical Postgres tables, schema-per-base, Knex-generated DDL

Teable is the most directly relevant prior art because it is Postgres-only and unapologetically DDL-driven.

**Metadata schema** — [`packages/db-main-prisma/prisma/postgres/schema.prisma`](https://github.com/teableio/teable/blob/develop/packages/db-main-prisma/prisma/postgres/schema.prisma):

| Model | Table | Notable columns |
|---|---|---|
| `TableMeta` | `table_meta` | `dbTableName` (the real Postgres table), `dbViewName`, `provisionState` (pending/ready/error/deleting), `order`, `deletedTime`. Indexed on `(dbTableName)` and `(baseId, deletedTime)`. |
| `Field` | `field` | `dbFieldName` (real column name), `dbFieldType` (real PG type), `type` (logical field type), `cellValueType`, `isMultipleCellValue`, `isComputed`, `isLookup`, `lookupLinkedFieldId`. Indexed on `(tableId, deletedTime)`. |
| `View` | `view` | `sort`, `filter`, `group` stored as **strings (JSON)**, plus `columnMeta`, `shareId`. |

Note `provisionState` — Teable has an explicit state machine for "the metadata row exists but the DDL hasn't landed yet". That is an admission that **DDL and metadata cannot be made atomic**, which is a first-class design problem for this approach.

**Naming.** [`apps/nestjs-backend/src/db-provider/postgres.provider.ts`](https://github.com/teableio/teable/blob/develop/apps/nestjs-backend/src/db-provider/postgres.provider.ts):

```ts
generateDbTableName(baseId: string, name: string) {
  return `${baseId}.${name}`;
}
createSchema(schemaName: string) {
  return [
    this.knex.raw(`create schema if not exists ??`, [schemaName]).toQuery(),
    this.knex.raw(`revoke all on schema ?? from public`, [schemaName]).toQuery(),
  ];
}
```

**One Postgres schema per base.** Every base gets `CREATE SCHEMA`, immediately followed by `REVOKE ALL … FROM public`. So the catalog footprint is `N_bases` schemas × `M_tables` tables × `K_columns` columns. Contrast with Baserow, which puts everything in one schema (§2.3).

**Column naming** — [`apps/nestjs-backend/src/features/field/field.service.ts`](https://github.com/teableio/teable/blob/develop/apps/nestjs-backend/src/features/field/field.service.ts):

```ts
async generateDbFieldName(tableId, name, routingOptions?) {
  let dbFieldName = convertNameToValidCharacter(name, 40);
  const query = this.dbProvider.columnInfo(await this.getDbTableName(tableId, routingOptions));
  const columns = await this.databaseRouter.queryDataPrismaForTable(tableId, query, routingOptions);
  if (columns.some((column) => column.name === dbFieldName)) {
    dbFieldName += new Date().getTime();   // collision fallback
  }
  return dbFieldName;
}
```

So Teable **derives the physical column name from the user-visible field name** (sanitised to 40 chars), with a timestamp suffix on collision, and stores the mapping in `field.dbFieldName`. This is a deliberate readability choice — you can `SELECT` from a Teable table in psql and understand it — and it is why they market "100% data ownership" ([Teable blog: *Data Reimagined: Postgres-Airtable Fusion*](https://blog.teable.io/blog/data-reimagined-postgres-airtable-fusion)). It costs them the timestamp-suffix ugliness and a `columnInfo()` round trip per field creation.

**Adding a field to a table with existing rows.** `field.service.ts` `alterTableAddField()` → `dbProvider.createColumnSchema()` → Knex `schema.alterTable()`. Critically:

```ts
if (notNull) {
  throw new BadRequestException(
    `Field type "${type}" does not support field validation when creating a new field`
  );
}
```

**Teable refuses to create a NOT NULL column on an existing table.** New columns are always nullable, so the `ALTER TABLE ADD COLUMN` is the cheap metadata-only path (§3.5). Order of operations is: (1) `ALTER TABLE`, (2) write field metadata, (3) emit the op to the realtime op log. DDL first.

**Type changes are destructive-and-repopulate.** From `postgres.provider.ts`:

```ts
modifyColumnSchema(tableName, oldFieldInstance, fieldInstance, tableDomain, linkContext) {
  const queries: string[] = [];
  // First, drop ALL columns associated with the field (including generated columns)
  queries.push(...this.dropColumn(tableName, oldFieldInstance, linkContext));
  ...
```

and

```ts
dropColumnAndIndex(tableName, columnName, _indexName) {
  return [ this.knex.raw('ALTER TABLE ?? DROP COLUMN IF EXISTS ?? CASCADE', [tableName, columnName]).toQuery() ];
}
```

They **DROP then ADD**, then repopulate from a converted source, rather than `ALTER COLUMN … TYPE … USING`. This is the single most important operational fact about Teable's approach and it is what burns the 1600-attnum budget (§3.6).

**Indexes.** Teable creates indexes on the metadata tables declaratively (Prisma `@@index`). For user tables, index creation is under `dropColumnAndIndex`/schema rules; there is a `SearchQueryPostgres` builder and a `searchVector.ts` using generated columns for full-text search. `UNRESOLVED: whether Teable auto-creates a B-tree index per user field, or only on explicit user request. I found the drop path but not an unconditional create path.`

**Generated columns** are used, but **only for system fields** — [`GeneratedColumnRule.ts`](https://github.com/teableio/teable/blob/develop/packages/v2/adapter-table-repository-postgres/src/schema/rules/field/GeneratedColumnRule.ts):

> "Used for CreatedTime, LastModifiedTime (when tracking all), CreatedBy, LastModifiedBy, AutoNumber."

with static factories `forCreatedTime('__created_time','timestamptz')`, `forAutoNumber('__auto_number','double precision')`, etc. User formulas do **not** use generated columns (see §5.2 for what they do instead).

**Performance claim.** Teable's blog claims: *"a table filled with one million rows of data … complex filtering or statistical queries can be completed in about 200 milliseconds"* without index optimisation, and contrasts against "Airtable's highest limit of 100,000 rows" ([blog.teable.io](https://blog.teable.io/blog/data-reimagined-postgres-airtable-fusion)). Treat this as vendor marketing — no query text, no hardware, no `EXPLAIN`. It is directionally consistent with a seq-scan of a 1M-row narrow table on modern hardware, which is roughly the right order of magnitude, so it is not obviously false.

#### 2.2 undb — hybrid: JSONB metadata, physical data tables

[`apps/backend/drizzle/postgres/0000_low_jimmy_woo.sql`](https://github.com/undb-io/undb/blob/main/apps/backend/drizzle/postgres/0000_low_jimmy_woo.sql):

```sql
CREATE TABLE "undb_table" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_id" text NOT NULL,
	"space_id" text NOT NULL,
	"schema" jsonb NOT NULL,
	"views" jsonb NOT NULL,
	"forms" jsonb,
	"rls" jsonb,
	"widgets" jsonb,
	...
);
```

The entire table **schema, views, forms, and RLS config are one JSONB document**. But the *records* are not: [`packages/persistence/src/underlying/underlying-table.service.ts`](https://github.com/undb-io/undb/blob/main/packages/persistence/src/underlying/underlying-table.service.ts) does real DDL via Kysely:

```ts
async create(table: TableDo) {
  const t = new UnderlyingTable(table)
  const trx = this.txContext.getCurrentTransaction()
  await trx.schema.createTable(t.name).ifNotExists().$call((tb) => {
    const visitor = new UnderlyingTableFieldVisitor(trx, t, tb, this.dbProvider, true)
    for (const field of table.schema) { field.accept(visitor) }
    ...
```

**This is the most instructive split in the whole survey**: JSONB for the *definition* (read once per request, never filtered on, changes atomically as a unit), physical columns for the *data* (filtered, sorted, aggregated, at volume). That is a hybrid worth taking seriously.

#### 2.3 Baserow — real tables named `database_table_{id}`, columns named `field_{id}`

[`backend/src/baserow/contrib/database/table/constants.py`](https://github.com/bram2w/baserow/blob/master/backend/src/baserow/contrib/database/table/constants.py):

```python
USER_TABLE_DATABASE_NAME_PREFIX = "database_table_"
MULTIPLE_COLLABORATOR_THROUGH_TABLE_PREFIX = "database_multiplecollaborators_"
LINK_ROW_THROUGH_TABLE_PREFIX = "database_relation_"
MULTIPLE_SELECT_THROUGH_TABLE_PREFIX = "database_multipleselect_"
ROW_NEEDS_BACKGROUND_UPDATE_COLUMN_NAME = "needs_background_update"
TSV_FIELD_PREFIX = "tsv_field"
```

[`backend/src/baserow/contrib/database/table/models.py`](https://github.com/bram2w/baserow/blob/master/backend/src/baserow/contrib/database/table/models.py):

```python
def get_database_table_name(self):
    return f"{USER_TABLE_DATABASE_NAME_PREFIX}{self.id}"
```

[`backend/src/baserow/contrib/database/fields/models.py`](https://github.com/bram2w/baserow/blob/master/backend/src/baserow/contrib/database/fields/models.py):

```python
@property
def db_column(self):
    return f"field_{self.id}"

@property
def tsv_db_column(self):
    return get_tsv_vector_field_name(self.id)   # f"tsv_field_{field_id}"
```

**Baserow's opposite choice from Teable:** column names are `field_{id}` — opaque, stable, collision-free, rename-free. A field rename is a metadata-only update, exactly like Notion's 4-char property key, just expressed as a real Postgres identifier instead of a JSON key. **This is the single most transferable idea in this document.** It gives you Notion's rename semantics *and* Postgres's index/planner machinery.

**Multi-valued fields get through-tables**, not arrays or JSON: `database_relation_*` for link-row, `database_multipleselect_*`, `database_multiplecollaborators_*`. So Baserow is fully normalised even for many-to-many property types.

**Dynamic models.** [*How Baserow lets users generate Django models on the fly*](https://baserow.io/blog/how-baserow-lets-users-generate-django-models):

> "Every Baserow table is supported by a real PostgreSQL table in the database."

Models are built at runtime with Python's `type()` rather than declared classes, and they are **not** permanently registered because "a single Baserow instance could potentially have millions of tables, registering all of them could quickly deplete our memory resources." Model attributes are cached in **Redis** because "some Baserow tables have over 100 fields and the model needs to be generated often."

**Trashed fields must stay in the model.** From `models.py`, they maintain `_field_objects` and `_trashed_field_objects` separately, with the comment: *"We need to include any trashed fields so the created model still has them present as the column is still actually there."* Soft-delete of a field does **not** drop the column. This is a deliberate mitigation of the attnum-burn problem (§3.6) — and of the "undo a field deletion" UX requirement.

**Filtering.** `TableModelQuerySet` exposes `filter_by_fields_object()` using the string form `filter__field_{id}__{view_filter_type}` with AND/OR, plus three search strategies: `pg_search()` (Postgres full-text over the `tsv_field_{id}` columns), `search_all_fields()`, and `compat_search()` (LIKE on each field). The filter type registry lives in [`views/view_filters.py`](https://github.com/bram2w/baserow/blob/master/backend/src/baserow/contrib/database/views/view_filters.py) and builds Django `Q`/`AnnotatedQ` objects — i.e. **an ORM expression tree, not string SQL**, which is their injection defence (§4).

**Published numbers.** [Baserow 1.17 release](https://baserow.io/blog/1-17-release-of-baserow):
- Automatic per-view indexes derived from the view's sorts → **"100x faster response time if you have 5 million rows in a single table."**
- Redis-backed SQL-level caching for slow queries such as **row counting**. (Counting is the classic killer: `COUNT(*)` with a filter is unavoidably a full index/heap scan.)
- Lazy loading of related table models for link-heavy databases.
- ~3x general improvement, 50% faster average response on baserow.io.

[Baserow 1.27](https://baserow.io/blog/1-27-release-of-baserow): **600% faster formulas**; loading/importing up to **6x faster** for tables with formula fields; some row create/modify/delete operations went **from over a minute to under a second**. That "over a minute" number is the honest measure of what an unoptimised formula-dependency recompute costs.

[Baserow field indexes user doc](https://baserow.io/user-docs/field-indexes): indexes are **opt-in per field**, supported on single-line text, long text, number, date, and computed (count/rollup/lookup) — and explicitly **not** supported on single select, email, URL, phone, multiple select, link-to-table, file, duration, boolean. Claimed **up to 80%** reduction in filter/search time on large tables; guidance is "your 3–5 most-queried fields first"; beneficial from ~10,000 rows; "indexes consume additional storage space and slightly slow down row creation and updates."

**Note the tension:** Baserow gives you real columns but still rations indexes to 3–5 per table. Even in the physical-table world, "index every property" is not free.

Also worth knowing: Baserow's Advanced plan row limit went **from 100,000 to 250,000** after the 1.17 perf work — i.e. even the physical-table vendors put product limits well below the theoretical Postgres ceiling.

#### 2.4 NocoDB — physical tables, but over *someone else's* database

[NocoDB architecture docs](https://docs.nocodb.com/engineering/architecture/) and the DeepWiki reconstruction ([Tables and Columns](https://deepwiki.com/nocodb/nocodb-1/3.4-tables-and-columns)):

- Metadata lives in its own DB in `nc_*` tables — notably **`nc_models_v2`** (tables) and **`nc_columns_v2`** (columns).
- Every column carries **both `column_name` (physical identifier) and `title` (user-facing alias)** — same decoupling as Teable/Baserow, third independent confirmation that this is the required shape.
- The decisive difference from Baserow/Teable: **NocoDB is designed to be pointed at a pre-existing database you don't control.** It introspects external Postgres/MySQL and builds an API over it. That forces the physical-table model — there is no option to invent a JSONB layout for tables it did not create.

**Filter compilation** — [`packages/nocodb/src/db/conditionV2.ts`](https://github.com/nocodb/nocodb/blob/develop/packages/nocodb/src/db/conditionV2.ts) — is a recursive Knex builder:

```ts
let _field = sanitize(
  column.getAlias?.() ? ... : alias ? `${alias}.${column.column_name}` : column.column_name
);
...
qb = qb.where(knex.raw('?? like ?', [field, pattern]));
qb = qb.where(knex.raw('??::text ilike ?', [field, pattern]));
```

Identifiers go through Knex's `??` placeholder (which emits `"quoted"."identifiers"`), values through `?` (real bind parameters). See §4 for the injection analysis and the real CVE-shaped bug they document in their own source.

#### 2.5 Grist — real SQLite tables + a Python formula engine

[`documentation/grist-data-format.md`](https://github.com/gristlabs/grist-core/blob/main/documentation/grist-data-format.md):

- User tables are **real SQLite tables**; metadata lives in `_grist_Tables` / `_grist_Tables_column`.
- **Identifiers are constrained to `[A-Za-z][A-Za-z0-9_]*`**, case-sensitive but unique case-insensitively; `id`, `manualSort`, and `gristHelper_*` are reserved. So Grist pushes the identifier constraint all the way up to the user — the opposite of Notion's "any string including emoji" policy. That is a product decision with a storage motivation.
- The SQL endpoint returns "storage representation rather than the API's JSON format": Bool as `0`/`1`, ChoiceList/RefList/Attachments as JSON arrays.

Architecture ([grist-core overview](https://github.com/gristlabs/grist-core/blob/main/documentation/overview.md)): a **Doc Worker** spawns a sandboxed **Python data engine** process per open document; on open, the whole document is read from SQLite into the engine. Formulas are arbitrary Python, hence the sandbox.

Grist's dependency engine is covered in §5.1.

#### 2.6 AppFlowy — CRDT documents, filtering in memory

[DeepWiki: Database Views (Filters, Sorts, Groups)](https://deepwiki.com/AppFlowy-IO/AppFlowy/7.2-database-views-(filters-sorts-groups)):

- Storage is **`collab-database`**, a CRDT (Yrs/Yjs-family) collaborative document — *not* SQL rows. Cell updates are applied to the CRDT.
- Three-tier: `DatabaseManager` → `DatabaseEditor` → `DatabaseViewEditor`, the last coordinating four controllers (filter, sort, group, calculation).
- **Filtering is performed in memory in Rust**, not in SQL: `FilterController` (`frontend/rust-lib/flowy-database2/src/services/filter/controller.rs`) uses "a task-based architecture for asynchronous processing via `TaskDispatcher`"; row changes `gen_task` a re-evaluation, emitting `FilterDidChanged`.

**Takeaway:** AppFlowy is the closest Notion clone in *feel* and it does **zero** of its filtering in a database. It is a local-first CRDT engine that holds the working set in memory. If you take AppFlowy as your model you are not building a query engine at all, you are building a sync engine — and you inherit a hard ceiling at "rows that fit in RAM on the client".

#### 2.7 Directus vs Strapi vs Mathesar — the dynamic-schema spectrum

- **Directus** "stores every collection as a real database table with modeling primitives like tables, columns, foreign keys, and junction tables" and *introspects an existing SQL database*. ([Directus vs Strapi comparison](https://directus.com/strapi), [DeepWiki: Database and Schema Management](https://deepwiki.com/directus/directus/3.2-database-and-schema-management))
- **Strapi** defines content types as JSON in the codebase and syncs them to the DB; "the underlying database schema is concealed" and other systems must go through Strapi's API. ([punits.dev comparison](https://punits.dev/blog/directus-vs-strapi/))
- **Mathesar** goes furthest: "a Django-based JSON-RPC backend that delegates core schema logic to **PL/pgSQL stored procedures inside your database**", working against real schemas/FKs/types with no migration. ([openapps.pro](https://openapps.pro/apps/mathesar))

The recurring tradeoff, stated well by the Directus/Strapi comparison: *real tables buy you interoperability* (BI tools, analytics, other services, ML pipelines can read the data without your API), *abstracted storage buys you developer ergonomics at the cost of database isolation*.

For a **second brain** where you will want to run your own SQL/embedding/AI jobs over the data, that interoperability argument is not decorative.

#### 2.8 Anyone who chose JSONB — what they say

I could not find a **production Notion/Airtable clone that filters user rows out of a JSONB column and published about it**. The closest data points are:

- **undb** (§2.2): JSONB for schema/views, physical tables for data. Explicit hybrid.
- **Notion itself**: `properties` JSON on `block`, but with 480 shards, a heavy client cache, and an API that caps at 100 rows/page.
- The **generic** EAV-vs-JSONB literature (§3.1), which is about "products with variable attributes", not about a user-defined query engine with arbitrary sorts.

`UNRESOLVED: no OSS Airtable/Notion clone found that stores row property values in JSONB and does server-side arbitrary filter+sort+aggregate on them at scale. Absence of evidence, but the absence is itself notable given how many such projects exist.`

---

### 3. Postgres storage-strategy tradeoffs — the evidence

#### 3.1 EAV vs JSONB: two real benchmarks that partly disagree

**Benchmark A — [coussej, *Replacing EAV with JSONB in PostgreSQL*](https://coussej.github.io/2016/01/14/Replacing-EAV-with-JSONB-in-PostgreSQL/)** (PG 9.5, DigitalOcean, **10 million entities**):

| Metric | EAV | JSONB |
|---|---|---|
| Storage | 3,068 MB tables + 3,427 MB indexes = **6.43 GB** | 1,817 MB table + 318 MB indexes = **2.08 GB** |
| Select by attribute value | baseline | `@>` containment: **0.153 ms** |
| `@>` vs `->>` on the same data | — | **`@>` ~25,000× faster than `->>`** |
| JSONB vs EAV, containment select | — | **~15,000× faster** |
| Update, no indexes | baseline | **>50,000× faster** |
| Update, with indexes | baseline | **1.3× faster** |

The `@>` vs `->>` gap is the whole ballgame: **same data, same column, same index — 25,000× difference purely because one operator can use the GIN index and the other cannot.**

**Benchmark B — [Evolveum midPoint, *Comparing JSONB and EAV model for extensions*](https://docs.evolveum.com/midpoint/projects/midscale/design/repo/repository-json-vs-eav/)** (15 million rows), which is *less* favourable to JSONB and therefore more useful:

Storage: JSONB table 1,927 MB vs EAV master 862 MB + detail 2,841 MB = 3,703 MB. Their summary: "JSON with index takes less space than EAV+ext table with their indexes (4GB vs 7GB)".

Counts (8 GB / 4 CPU):

| Operation | JSONB | EAV |
|---|---|---|
| Basic count | 440 ms | **337 ms** |
| Low-selectivity count ("video") | **1,388 ms** | 3,324 ms |
| High-selectivity count ("sleeping") | **63.4 ms** | 87 ms |
| Email LIKE search count | **758 ms** | 2,499 ms |

Selects:

| Operation | JSONB | EAV |
|---|---|---|
| Basic select with limit | 0.734 ms | **0.419 ms** |
| Email LIKE search | **1.93 ms** | 40.6 ms |
| Rare-value match | 41.82 ms | **2.736 ms** |

Their conclusions, which contradict the rosy version:

- "JSON was over 20x faster for 4 selects, all related to email LIKE searches"; ~2× faster overall.
- **"EAV's biggest win was finding any 500 rows with hobbies=sleeping (15x faster)."**
- **"index `ON tjson ext->>'email'` doesn't seem to help (not used, even after `ANALYZE`)"** — a real report of an expression index failing to be chosen by the planner.
- **"Counts are always much slower than limited select"**; **"Ordering slows things down"**; "avoid unlimited selects".
- **"The problem with JSONB type is that it is not efficient to update"** — the whole row is rewritten even for a minor change, "problematic for extension properties containing thousands of items."

Their recommendation: *"I'd start with JSON but added possibility to store extension attribute in a flexible way"* — i.e. **hybrid, with an escape hatch to promote hot attributes out of the blob.**

**Where the sources disagree:** coussej says JSONB dominates EAV on everything; Evolveum says JSONB wins on text search and storage, loses on basic count/select and on finding rare values, and its expression indexes were not picked up by the planner. The difference is almost entirely explained by *which operator the query uses*: coussej benchmarked `@>` (GIN-accelerated); Evolveum benchmarked realistic mixed predicates including ones that fall off the index. **Trust Evolveum for our use case**, because a Notion-databases clone generates arbitrary mixed predicates, not curated containment queries.

Neither benchmark measures **sorting by an arbitrary property at 1M rows**, which is our hardest query. `UNRESOLVED: I found no published benchmark of ORDER BY on a JSONB-extracted key at 1M+ rows versus a real column. This is the exact gap you should measure yourself before committing.`

#### 3.2 JSONB indexing: precisely what works and what does not

From the [PostgreSQL JSON types documentation](https://www.postgresql.org/docs/current/datatype-json.html):

> "The default GIN operator class for `jsonb` supports queries with the key-exists operators `?`, `?|` and `?&`, the containment operator `@>`, and the `jsonpath` match operators `@?` and `@@`."

> "The non-default GIN operator class `jsonb_path_ops` does not support the key-exists operators, but it does support `@>`, `@?` and `@@`."

> "`jsonb` also supports `btree` and `hash` indexes. These are usually useful only if it's important to check equality of complete JSON documents."

And for expression indexes, the docs' own example:

```sql
CREATE INDEX idxgintags ON api USING GIN ((jdoc -> 'tags'));
```

with the note that "with appropriate use of expression indexes, the above query can use an index."

**Consequences, stated bluntly:**

| Query shape | GIN (`jsonb_ops`) | GIN (`jsonb_path_ops`) | B-tree expression index on `(properties->>'k')` |
|---|---|---|---|
| `properties @> '{"k":"v"}'` | ✅ | ✅ (smaller/faster) | ❌ |
| `properties ? 'k'` (key exists) | ✅ | ❌ | ❌ (but `IS NOT NULL` on the expression works) |
| `properties->>'k' = 'v'` | ❌ | ❌ | ✅ |
| `(properties->>'k')::numeric > 100` | ❌ | ❌ | ✅ (needs the cast baked into the index, and the cast must be immutable) |
| `properties->>'k' ILIKE '%x%'` | ❌ | ❌ | only with `pg_trgm` GIN/GiST on the expression |
| `ORDER BY properties->>'k'` | ❌ | ❌ | ✅ |
| `ORDER BY (properties->>'k')::numeric` | ❌ | ❌ | ✅ if the index matches the exact expression |

**GIN cannot serve ORDER BY at all.** [PostgreSQL index types docs](https://www.postgresql.org/docs/current/indexes-types.html): B-tree "can also be used to retrieve data in sorted order"; the GIN section makes no such claim, and GIN's posting-list structure has no total order to walk. GiST/SP-GiST have only *nearest-neighbour* ordering. So **any sort on a JSONB property is either a full sort of the filtered set, or requires a per-property B-tree expression index.**

**Size/shape difference between the two GIN opclasses** (secondary sources, consistent with each other): `jsonb_ops` indexes typically **60–80% of table size**, `jsonb_path_ops` **20–30%** ([Machytka, *PostgreSQL JSONB Operator Classes of GIN Indexes*](https://medium.com/@josef.machytka/postgresql-jsonb-operator-classes-of-gin-indexes-and-their-usage-0bf399073a4c)). `jsonb_path_ops` hashes `(path, value)` pairs into one entry; `jsonb_ops` stores every key and every value separately, which is why it is bigger and why it can answer key-exists.

**The expression-index-per-property question — is it viable?**

Cost side, from the [PostgreSQL expression index docs](https://www.postgresql.org/docs/current/indexes-expressional.html):

> "Index expressions are relatively expensive to maintain, because the derived expression(s) must be computed for each row insertion and non-HOT update."

> "Thus, indexes on expressions are useful when retrieval speed is more important than insertion and update speed."

> "However, the index expressions are *not* recomputed during an indexed search, since they are already stored in the index."

Now do the arithmetic for a Notion clone:

- A user database with **20 properties** where you want filter+sort on all of them = **20 expression indexes on one table**.
- Each index adds work to **every** insert and **every non-HOT update**. A JSONB column update is *by definition* a change to the indexed expression's input, so **every JSONB write is a non-HOT update that touches every expression index on that column.** You do not get HOT updates. This is the killer that the marketing posts never mention.
- 1,000 user databases × 20 = **20,000 indexes** in `pg_class`, on one physical `rows` table, all of which the planner must consider (partial indexes with `WHERE database_id = …` help the planner prune but do not reduce catalog size).
- Every new property a user creates requires a `CREATE INDEX` — which is *itself DDL*. **You have not escaped dynamic DDL; you have just moved it from `ALTER TABLE` to `CREATE INDEX`, and made it worse**, because `CREATE INDEX` (even `CONCURRENTLY`) on a big shared `rows` table is far more expensive than `ALTER TABLE ADD COLUMN` on a small per-user table (which is O(1), §3.5).

Baserow's own product guidance — index "your 3–5 most-queried fields first" — is the empirical answer to "can I index every property?" from a team that ships this. The answer is no, in either design.

And Evolveum's report that `ON tjson ext->>'email'` "doesn't seem to help (not used, even after ANALYZE)" is a warning that even when you build the index, the planner may not use it, typically because of statistics on the expression or a type/collation mismatch between index expression and query expression.

#### 3.3 Typed extraction: `jsonb_populate_record` and lateral joins

`UNRESOLVED: I found no benchmark or engineering write-up of `jsonb_populate_record` / `jsonb_to_record` + LATERAL as a strategy for a user-defined-schema query engine, at any scale.`

What I can say from the docs (mechanism, not evidence): `jsonb_to_record`/`jsonb_populate_record` require a **static row type** at parse time (`AS t(a int, b text)`), which means you must generate the column list per query from your schema table. They are a *projection* convenience, not an *access-path* improvement — they cannot make an index apply. In a `LATERAL` they run per row, after the rows have already been selected. So they help you return typed values cleanly; they do nothing for the filter/sort problem, which is the problem you actually have.

**Do not choose the JSONB design on the belief that `jsonb_populate_record` makes it fast.** There is no evidence for that and the mechanism argues against it.

#### 3.4 TOAST: the wide-JSONB tax

[Evan Jones, *Postgres large JSON value query performance*](https://www.evanjones.ca/postgres-large-json-performance.html) — 1M rows, 10 key/value pairs, 96-byte keys, four storage variants. Time to count rows matching a key:

| Storage | HSTORE | JSONB | JSON | BYTEA prefix |
|---|---|---|---|---|
| Inline, uncompressed | 553 ms | **746 ms** | 10,797 ms | 380 ms |
| Inline, compressed | 1,080 ms | **1,178 ms** | 11,795 ms | 606 ms |
| TOAST, uncompressed | 3,437 ms | **3,393 ms** | 14,011 ms | 3,332 ms |
| TOAST, compressed | 7,454 ms | **7,624 ms** | 22,197 ms | 7,054 ms |

**JSONB inline-uncompressed → TOAST-compressed is 746 ms → 7,624 ms: a 10.2× penalty on the identical logical query.** Compression alone is ~2×; TOASTing alone is ~5×; together ~10×.

The threshold: Postgres targets ≥4 tuples per 8 kB page, so **a tuple over roughly 2,000 bytes gets TOASTed** ([pganalyze, *Postgres performance cliffs with large JSONB values and TOAST*](https://pganalyze.com/blog/5mins-postgres-jsonb-toast); Evan Jones puts it at ~2,032 bytes).

**And there is no partial detoast.** As the pganalyze piece and [Postgres Pro's JSONB talk](https://postgrespro.com/media/2022/03/24/jsonb-fosdem-2021%20(1).pdf) state: to read **one key** you must **detoast and decompress the entire JSONB value**. There is no "seek to key" in TOAST storage.

**What this means concretely for a Notion clone:** a row-page with 20 properties, several of them long text, a few multi-selects and relation arrays, easily exceeds 2 kB. So the *typical* row in a real user database is TOASTed. Every filter on a single property pays full detoast + decompress of the whole property bag, for **every row scanned**. That is precisely the query shape you run constantly.

The physical-table design does not have this problem for scalar columns: Postgres reads only the attributes the query needs from the (small) main tuple, and TOASTs only the individual long-text columns that are actually long. Reading `field_7` never detoasts `field_12`.

Mitigations if you go JSONB anyway: `ALTER TABLE … SET (toast_tuple_target = …)`, LZ4 compression (`default_toast_compression = lz4`, PG 14+, reported faster than pglz by both Evan Jones and [credativ's compression benchmark](https://www.credativ.de/en/blog/postgresql-en/toasted-jsonb-data-in-postgresql-performance-tests-of-different-compression-algorithms/)), and splitting long text out of the property bag into separate columns/rows. Note that the last mitigation is just "start moving toward the physical-table design".

#### 3.5 `ALTER TABLE ADD COLUMN`: when is it O(1)?

**PostgreSQL 11** is the version that made it fast, via commit "Fast ALTER TABLE ADD COLUMN with a non-NULL default" ([commit mail](https://www.postgresql.org/message-id/E1f0zNq-00064z-Sn%40gemulon.postgresql.org), [depesz](https://www.depesz.com/2018/04/04/waiting-for-postgresql-11-fast-alter-table-add-column-with-a-non-null-default/), [Data Egret](https://dataegret.com/2018/03/waiting-for-postgresql-11-pain-free-add-column-with-non-null-defaults/), [brandur](https://brandur.org/postgres-default)).

Mechanism: the default is evaluated once at `ALTER TABLE` time and stored in **`pg_attribute.attmissingval`**, with **`atthasmissing = true`**; existing rows are read back with the missing value substituted. No rewrite.

Numbers: dbi-services measured the PG 11 `ALTER TABLE ADD COLUMN … DEFAULT` at **5.064 ms with no sequential scan**, versus **over 1 second with a seq scan** pre-11 ([dbi-services](https://www.dbi-services.com/blog/postgresql-11-instant-add-column-with-a-non-null-default-value/)).

**The limits:**
- **A VOLATILE default still rewrites the table.** `now()`, `random()`, `gen_random_uuid()` → full rewrite under `ACCESS EXCLUSIVE`. ([Squawk linter: adding-field-with-default](https://squawkhq.com/docs/adding-field-with-default/))
- Adding a **nullable column with no default** has always been cheap (all versions).
- `ADD COLUMN` still takes an **`ACCESS EXCLUSIVE` lock**, briefly. On a busy table you still need a lock timeout and retry, because the lock request queues behind and in front of other queries.
- Adding a column with a **`UNIQUE`/`PRIMARY KEY`/`CHECK`** constraint, or a **STORED generated column**, does rewrite/scan.

Supabase runs PG 15/17 in current projects, so the fast path is available. Teable's refusal to create NOT NULL columns on existing tables (§2.1) keeps them permanently on the cheapest path.

**Verdict: "ALTER TABLE is slow" is a pre-2018 objection to the dynamic-physical-table design and it is no longer true**, provided you only ever add nullable columns without volatile defaults — which is exactly what Teable and Baserow do.

#### 3.6 The real limits of dynamic DDL: 1600 attnums, and catalog pressure

**The column limit is 1,600 and dropped columns count against it, forever.**

[data-bene, *Did you know? Tables in PostgreSQL are limited to 1,600 columns*](https://www.data-bene.io/en/blog/did-you-know-tables-in-postgresql-are-limited-to-1600-columns/) demonstrates it:

> "When dropping a column, the name becomes `'.' + 'pg.dropped.' + attnum + '.'`, the column becomes NULLable, the column is marked as dropped."

After 1,599 add/drop cycles the catalog holds 1,600 slots (1 live column, 1,599 tombstones) and the next add fails:

> `ERROR: tables can have at most 1600 columns`

And crucially:

> "The VACUUM command operates at the tuple level so even if you run a VACUUM FULL the table structure will not change."

Confirmed in the Postgres source as `#define MaxHeapAttributeNumber 1600` ([Stormatics](https://stormatics.tech/blogs/postgresql-column-limits)), with a separate hard limit of **1,664 columns for any query/view result set** — which matters if you ever `SELECT` a table joined to its lookups. The behaviour is a long-standing complaint: [BUG #17127: "drop column can't delete from pg_attribute, so it will up to 1600 limits soon"](https://postgresql.org/message-id/17127-f973fb9d41bae9ca%40postgresql.org).

**This is the sharpest "breaks when…" in the entire dynamic-DDL design**, and it is not a scale problem — it is a *usage* problem. A single power user who churns fields on one table (add a rollup, delete it, try again — 1,600 times over two years) bricks that table. The remedy is a table rebuild (`CREATE TABLE … AS SELECT`, or pg_dump/restore, or logical replication), which you must build as an operational tool *before* you need it.

Baserow's soft-delete of fields (keeping trashed columns in the model rather than dropping them) both mitigates and worsens this: it avoids the tombstone but consumes a live slot. Either way, the budget is 1,600 cumulative field operations per table.

**Catalog bloat from thousands of tables.** The best hard data point I found is [*What does occur when making a million tables on Amazon Aurora PostgreSQL*](https://dev.to/mierune/what-does-occur-when-making-a-million-tables-on-amazon-aurora-postgresql-7gg):

- **1,000,000 tables**, 10,000 rows each, PostGIS geometry column, Aurora PG 16 Serverless v2.
- **Creating them took approximately one week.**
- **Queries on individual tables stayed fast: ~1.3 ms execution, 0.675 ms planning.**
- **`information_schema.tables` count took 2,406 ms**, with a plan that scanned `pg_class` and filtered out ~1.6 million rows.
- Snapshot/restore worked.
- Author's conclusion: *"There is no critical problem even when a million tables in one database, on Aurora PostgreSQL"* — with the caveats that Aurora's storage architecture may be doing the heavy lifting, "normal PostgreSQL may show different results", and *"queries to system catalogs has bad performance with too many tables."*

Counterweight, though weaker sourcing: general guidance that "when there are hundreds of thousands of tables in a database, system catalogs (`pg_class`, `pg_attribute`) grow massive, and query planning and autovacuum slow down drastically" ([dev.to summary](https://dev.to/mangesh28/-the-hidden-limits-postgresql-tutorial-inside-postgresql-and-what-happens-when-you-hit-them-3p55)). Autovacuum has a per-database worker budget and must iterate the relation list; with 10⁵–10⁶ relations the "which table needs vacuuming" scan itself becomes work.

**Sources disagree here.** The Aurora experiment says a million tables is survivable; conventional wisdom says tens of thousands is where it hurts. Reconciliation: *data-path* queries stay fast (they hit a small relcache entry); *catalog-path* operations degrade badly (introspection, autovacuum scheduling, `pg_dump`, connection startup relcache priming, and any ORM that introspects). Note that Baserow's design **requires** catalog introspection at runtime (dynamic model generation) — and they explicitly cache it in Redis because of exactly this cost.

Practical scale estimate for our case: 1,000 users × 10 databases = 10,000 tables. That is comfortably in the "fine" region on both accounts. 100,000 users would not be.

**Teable's schema-per-base multiplies this**: N schemas + N×M tables. Baserow's flat `database_table_{id}` in one schema keeps `pg_namespace` small. Prefer Baserow's shape.

#### 3.7 Supabase RLS: how it interacts with each option

**Can you even have RLS on dynamically created tables?** Yes — RLS is a per-table property (`ALTER TABLE … ENABLE ROW LEVEL SECURITY` + `CREATE POLICY`), so your DDL path must issue three statements per table, not one. There is no "default RLS for new tables". You can approximate with `ALTER DEFAULT PRIVILEGES` for grants, but **not** for RLS policies — policies must be created per table. `UNRESOLVED: I found no Postgres mechanism for a template/default RLS policy applied to newly created tables. An event trigger on ddl_command_end is the usual workaround, but I found no published production write-up of doing this for a multi-tenant Airtable clone.`

**Exposure through the Data API.** Supabase's PostgREST only serves schemas listed in the authenticator role's `pgrst.db_schemas` ([Using Custom Schemas](https://supabase.com/docs/guides/api/using-custom-schemas), [PGRST106 troubleshooting](https://supabase.com/docs/guides/troubleshooting/pgrst106-the-schema-must-be-one-of-the-following-error-when-querying-an-exposed-schema)). Two live consequences:

- If you create user tables in a **non-exposed** schema, the anon/authenticated keys cannot reach them at all — the browser must go through your FastAPI backend. That is arguably a feature: it means your Postgres RLS is a *defence in depth* layer rather than the primary authz mechanism.
- Exposed-schema changes are **not** dynamic and have been a source of outages: [supabase/supabase#45904](https://github.com/supabase/supabase/issues/45904) documents PostgREST retaining non-existent schemas in `db-schemas` and breaking the whole Data API with SQLSTATE `3F000`. There is a long-standing request for wildcard/dynamic schema exposure ([discussion #12270](https://github.com/orgs/supabase/discussions/12270)) — still not supported.

**Cost of RLS on large scans.** Supabase's own benchmark ([RLS Performance and Best Practices, discussion #14576](https://github.com/orgs/supabase/discussions/14576), mirrored at [supabase.com/docs](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv)), on a **100,000-row** table (Test 2f on 1,000,000 rows with joins):

| Test | Change | Before | After | Speedup |
|---|---|---|---|---|
| 1 | Add index on the `user_id` column used by the policy | 171 ms | <0.1 ms | **1,710×** |
| 2a | Wrap `auth.uid()` in `(select auth.uid())` | 179 ms | 9 ms | **19.8×** |
| 2b | Wrap `is_admin()` (with a join) in a select | 11,000 ms | 7 ms | **1,571×** |
| 2c | Wrap both | 11,000 ms | 10 ms | 1,100× |
| 2d | Wrap `has_role()` SECURITY DEFINER in a select | **178,000 ms** | 12 ms | **14,833×** |
| 3 | Add an explicit client-side `.eq()` filter duplicating the policy | 171 ms | 9 ms | 19× |
| 5 | Reorder join logic (`col IN (...)` instead of `auth.uid() IN (...)`) | 9,000 ms | 20 ms | 450× |
| 6 | Add `TO authenticated` to the policy | 170 ms | <0.1 ms | **1,700×** |

The mechanism for 2a–2d: `(SELECT auth.uid())` is treated as a subquery returning one row, so the planner hoists it into an **InitPlan** evaluated once per query rather than once per row. Supabase ships a lint for it — **`auth_rls_initplan`** in the [database advisors](https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0003_auth_rls_initplan) — and one team reported [76 policies affected in a single codebase](https://dev.to/arvavit/76-rls-policies-rewritten-in-one-migration-the-authuid-init-plan-trap-in-supabase-4hg).

The deeper Postgres issue is **leakproof-ness**. [Dian M Fay, *fixing slow row-level security policies*](https://di.nmfay.com/rls-performance) walks a real case from 8,100 ms to 94 ms (vs a 50 ms admin baseline — the unoptimised version was ~150× slower than admin):

| Approach | Time | Issue |
|---|---|---|
| Baseline `item_reader` | 8,100 ms | seq scan, 1M subplan loops |
| `any()` instead of `@>` | 2,441 ms | still sequential |
| Function marked `stable` | 2,880 ms | post-scan filtering |
| `stable` + `parallel safe` | 1,009 ms | redundant plans |
| Partial InitPlan | 627 ms | — |
| Full InitPlan wrapping | **94 ms** | — |

Root causes she identifies: array containment `@>` blocking index use (use `= any()`); functions not declared `STABLE` so the planner assumes volatility; and **non-leakproof functions like `current_setting()` acting as security barriers**, forcing separate plan stages (six redundant plans for one query). Corroborated by [Bytebase's RLS limitations write-up](https://www.bytebase.com/blog/postgres-row-level-security-limitations-and-alternatives/): security quals must be evaluated before any user predicate that could leak row contents, and **only `LEAKPROOF` operators/functions may be pushed down ahead of them** — so a non-leakproof policy predicate can force a full scan even with a perfect index.

**How this lands on each storage design:**

- **(a) Physical tables.** The RLS predicate is a scalar comparison against an indexed column (or a constant per-table check, since the table *is* the tenant boundary). Cheapest possible. Policies are per table, so you issue 3 DDL statements per table and you own 10,000+ policies. Introspecting/auditing them is a real chore.
- **(b) EAV.** RLS must be applied to `rows` **and** `row_values`, or you leak values whose parent row you can't see. Every value-table scan carries the policy. Worst of the three.
- **(c) Single `rows` table + JSONB.** One table, one policy, easy to audit — the genuine RLS advantage of this design. But the policy is evaluated on the largest table in the system, so it must be an indexed scalar column (`workspace_id`) and it must be InitPlan-wrapped. And note: if the policy is on `workspace_id` and your filter is on a JSONB key, the planner has to combine an indexed RLS qual with a non-indexed JSONB qual — the RLS index prunes to the workspace, then the JSONB predicate is a filter over everything in that workspace.

---

### 4. Compiling a filter AST to safe, parameterised SQL

#### 4.1 The three-layer defence that everyone converges on

Reading the actual implementations, the pattern is identical across Teable, NocoDB, and Baserow:

**Layer 1 — allow-list the identifier against the schema table. Never take a name from the request.**

Teable, [`filter-query.abstract.ts`](https://github.com/teableio/teable/blob/develop/apps/nestjs-backend/src/db-provider/filter-query/filter-query.abstract.ts):

```ts
private parseFilter(queryBuilder, filterMeta: IFilterItem, conjunction, path) {
  const { fieldId, operator, value, isSymbol } = filterMeta;
  const field = this.fields && this.fields[fieldId];
  if (!field) { return queryBuilder; }        // <- unknown fieldId is silently dropped
  ...
  const validFilterOperators = Object.keys(getFilterOperatorMapping(field));
  if (!includes(validFilterOperators, convertOperator)) {
    this.logger.warn(`Skip filter item: field=${field.id}(${field.name}) operator='${convertOperator}' not in [...]`);
    return queryBuilder;
  }
```

The request only ever carries a **`fieldId`**, never a column name. The column name is looked up from the trusted `fields` map. **Unknown field → the clause is dropped, not errored.** (Debatable: silently dropping a filter can show a user more rows than they expected. Erroring is the safer default for a security-relevant filter.)

Note also the **operator allow-list per field type** — a `contains` operator is only reachable on fields whose type mapping includes it, so you cannot smuggle a `LIKE` onto a numeric column.

**Layer 2 — bind values as parameters, always.**

Teable, [`cell-value-filter.abstract.ts`](https://github.com/teableio/teable/blob/develop/apps/nestjs-backend/src/db-provider/filter-query/cell-value-filter.abstract.ts):

```ts
const parseValue = this.field.cellValueType === CellValueType.Number ? Number(value) : value;
builderClient.whereRaw(`${this.tableColumnRef} = ?`, [parseValue]);
...
builderClient.whereRaw(`${this.tableColumnRef} LIKE ? ESCAPE '\\'`, [`%${escapedValue}%`]);
```

Note the **type coercion before binding** (`Number(value)` for numeric cell types) and the **explicit `ESCAPE`** on LIKE so that user `%`/`_` are literal.

**Layer 3 — quote identifiers mechanically.**

NocoDB, [`conditionV2.ts`](https://github.com/nocodb/nocodb/blob/develop/packages/nocodb/src/db/conditionV2.ts):

```ts
qb = qb.where(knex.raw('?? like ?', [field, pattern]));
qb = qb.where(knex.raw('??::text ilike ?', [field, pattern]));
```

Knex's `??` is identifier binding (emits `"schema"."table"."column"` with internal quotes doubled); `?` is a value bind (emits `$1`). Teable's DDL layer uses the same convention:

```ts
this.knex.raw('ALTER TABLE ?? DROP COLUMN IF EXISTS ?? CASCADE', [tableName, columnName]).toQuery()
this.knex.raw(`create schema if not exists ??`, [schemaName]).toQuery()
```

**A gap worth noticing in Teable:** `tableColumnRef` is assigned as a **bare string** and interpolated with `${}` into `whereRaw`:

```ts
constructor(protected readonly field: FieldCore, readonly context?) {
  const { dbFieldName, id } = field;
  const selection = context?.selectionMap.get(id);
  this.tableColumnRef = selection ? (selection as string) : dbFieldName;
}
...
builderClient.whereRaw(`${this.tableColumnRef} = ?`, [parseValue]);
```

This is **not** identifier-quoted at query time. It is safe *only because* `dbFieldName` was sanitised at creation time by `convertNameToValidCharacter(name, 40)`. That is a **defence that lives in a different file, months earlier in the object's lifetime**. If you copy this pattern, you inherit a latent hazard: any code path that writes `field.dbFieldName` without the sanitiser becomes a stored SQL injection. Prefer quoting at use time *as well* as sanitising at creation time.

#### 4.2 A real injection bug, documented in NocoDB's own source

[`packages/nocodb/src/helpers/sqlSanitize.ts`](https://github.com/nocodb/nocodb/blob/develop/packages/nocodb/src/helpers/sqlSanitize.ts) is worth reading in full. Excerpts:

```ts
/**
 * Escape a string as a PostgreSQL string literal … Use when an inline literal must
 * be embedded directly in DDL (CREATE TYPE … AS ENUM, ALTER TYPE ADD/RENAME
 * VALUE, ALTER COLUMN SET DEFAULT, USING expressions in ALTER TABLE) — PG's
 * DDL parser rejects parameter placeholders for value literals, so knex's
 * `?` binding (which becomes `$N`) cannot be used in those positions.
 *
 * Identifiers should still go through knex's `??` placeholder.
 */
export function pgQuoteLiteral(value: string): string { ... }
```

```ts
/**
 * Validate a column precision/length value (`dtxp`) before it is interpolated
 * into DDL. Unlike the data type (`dt`, guarded by `KnexClient.sanitiseDataType`),
 * `dtxp` is not run through an allowlist anywhere in the column pipeline, so a
 * crafted value such as `1) CHECK(1=0` would otherwise inject a persistent
 * constraint — or, on SQLite, an arbitrary `;`-delimited statement — into the
 * live table schema.
 */
export function sanitiseDataTypePrecision(dtxp) { ... }
```

Three lessons, all directly applicable:

1. **DDL cannot use bind parameters for literals.** `CREATE TYPE … AS ENUM ('a','b')`, `ALTER COLUMN SET DEFAULT`, and `ALTER TABLE … USING` all reject `$1`. So the moment you do dynamic DDL you *must* hand-roll literal quoting (`quote_literal` / doubling single quotes / `format('%L')`). This is a real, unavoidable cost of design (a).
2. **The injection vector was not the obvious one.** It was `dtxp` — the *column length/precision* — a field nobody thinks of as attacker-controlled. `1) CHECK(1=0` injects a permanent constraint that makes the table unwritable. Enumerate *every* string that reaches DDL, not just names and values.
3. Their fix is an **allow-list regex per shape** (`^\d+(?:\s*,\s*\d+)?$`, `^max$/i`, a quoted-literal-list pattern), throwing on anything else. Allow-list, not deny-list.

#### 4.3 The Postgres-native tools

[PL/pgSQL: Executing Dynamic Commands](https://www.postgresql.org/docs/current/plpgsql-statements.html):

```sql
EXECUTE format('UPDATE tbl SET %I = $1 WHERE key = $2', colname)
   USING newvalue, keyvalue;
```

- `%I` = `quote_ident` (identifiers), `%L` = `quote_nullable` (literals).
- `USING` with `$1`/`$2` "avoids run-time overhead of converting the values to text and back, and it is much less prone to SQL-injection attacks since there is no need for quoting or escaping."
- "To safely quote text that is not known in advance, you *must* use `quote_literal`, `quote_nullable`, or `quote_ident`, as appropriate."
- Explicit warning against dollar-quoting dynamic values.
- Gotcha: for nullable comparisons use `IS NOT DISTINCT FROM` with `quote_nullable`, but "at present, `IS NOT DISTINCT FROM` is handled much less efficiently than `=`".

This is the Mathesar route (§2.7) — push schema logic into PL/pgSQL. It gives you transactional DDL+metadata in one statement, which solves Teable's `provisionState` problem. It costs you testability and observability from Python.

#### 4.4 SQLAlchemy Core as the compilation target

**Is it a good fit? Yes, and it is the closest Python analogue to what Teable does with Knex and Baserow does with Django `Q`.**

Mechanism (from the SQLAlchemy docs and API, not from a benchmark):

- `sqlalchemy.column("field_7")` / `sqlalchemy.table(...)` produce lightweight, **quoted** identifier constructs without needing an ORM model. `sqlalchemy.sql.quoted_name` forces quoting.
- `and_()`, `or_()`, `not_()` compose into a tree that maps 1:1 onto a JSON filter AST — a recursive descent over `{conjunction, filterSet[]}` is ~40 lines.
- All literals become **bind parameters** automatically; there is no code path where a Python value is string-interpolated unless you call `text()` yourself.
- `sqlalchemy.cast()`, `type_coerce()` let you attach the right type per property so `>` on a number field is numeric, not lexicographic.
- For JSONB, `Column.op('->>')`, `.op('@>')`, and the `JSONB` type's `.astext`, `.contains()`, `.has_key()` are all available — so **the same compiler can target both storage designs**, which is genuinely valuable if you want to keep the option open.

Prior art in the wild is thin and small-scale: `sqlalchemy-filtering` ([PyPI](https://pypi.org/project/sqlalchemy-filtering)) explicitly provides "a JSON format interface to the SQLAlchemy query API for querying on JSON SQL fields … used by front-end applications to generate automatically SQL filtering queries"; `sqla-filter` ([PyPI](https://pypi.org/project/sqla-filter)) is a typed filter helper; there is a well-known Flask-SQLAlchemy dynamic-filter pattern ([Mindee](https://www.mindee.com/blog/flask-sqlalchemy)) mapping operator strings (`eq`, `in`, `gte`, `like`, …) to SQLAlchemy operations.

`UNRESOLVED: I found no large production system publicly documented as compiling a user-facing filter AST to SQLAlchemy Core at Airtable-clone scale. The libraries above are small. You would be building this yourself — but the primitives are right, and Baserow proves the equivalent works in Django ORM at 5M rows.`

**Critical caveat if you use SQLAlchemy Core with a per-user-table design:** do **not** use `MetaData.reflect()` per request. That is exactly the catalog-introspection cost §3.6 warns about, and it is the reason Baserow caches generated models in Redis. Build `Table` objects from your *own* `fields` metadata table, never from the database catalog.

#### 4.5 Sorting and filtering by a computed formula

Three options and what the prior art actually does:

| Option | Who does it | Notes |
|---|---|---|
| **Materialised real column, recomputed on write via a dependency graph** | **Teable** (user formulas), **Baserow** (formula fields) | Sorting is a plain indexed column sort. Cost is recompute latency and correctness under concurrency. |
| **Postgres `GENERATED ALWAYS AS … STORED`** | **Teable — system fields only** (`__created_time`, `__auto_number`, …) | Blocked for real formulas: PG requires the expression to be **immutable**, forbids **subqueries**, forbids **referencing another generated column**, and PG 18 additionally forbids user-defined functions/types in *virtual* generated columns ([PG 18 Generated Columns](https://www.postgresql.org/docs/current/ddl-generated-columns.html)). A Notion formula referencing a rollup over a linked table violates all three. |
| **Compute in the application** | AppFlowy (in-memory Rust), Grist (Python engine holds the whole doc) | Only viable when the working set fits in memory. Cannot sort 1M server-side rows. |

Notes on generated columns, since they look tempting:

- PG 18 made **VIRTUAL the default** ("A generated column is by default of the virtual kind"). Virtual columns compute on read, occupy no storage — and **the docs say nothing about indexing them**, which for our purposes should be read as "do not plan on indexing a virtual generated column." `UNRESOLVED: whether PG 18 permits indexes on VIRTUAL generated columns; the documentation section on generated columns does not address it.` If you use generated columns for sorting, specify **`STORED` explicitly**.
- Adding a `STORED` generated column to an existing table **does** rewrite/scan it — so it is not on the O(1) `ADD COLUMN` fast path of §3.5.

**Teable's actual formula machinery** is the richest prior art here and it is worth studying directly:

- [`packages/v2/formula-sql-pg/src/FormulaSqlPgTranslator.ts`](https://github.com/teableio/teable/blob/develop/packages/v2/formula-sql-pg/src/FormulaSqlPgTranslator.ts) — walks the ANTLR parse tree and emits a Postgres `SqlExpr` with a `storageKind` ('scalar' | 'json') and a `valueType`. It carries a `IPgTypeValidationStrategy` injected by PG version: *"PG 16+: Use Pg16TypeValidationStrategy (uses native `pg_input_is_valid`); PG < 16: Use PgLegacyTypeValidationStrategy (uses polyfill function)."* That is the level of care required to make a user formula language not throw runtime cast errors mid-scan.
- It supports `skipFormulaExpansion` for *"CTE batch updates where formula fields at earlier levels are already computed and stored in CTE columns"* — i.e. recompute is a **layered CTE**, one level per dependency depth, writing results into real columns.
- [`packages/v2/adapter-table-repository-postgres/src/record/computed/`](https://github.com/teableio/teable/tree/develop/packages/v2/adapter-table-repository-postgres/src/record/computed) contains `FieldDependencyGraph.ts` (1,707 lines), `ComputedUpdatePlanner.ts`, `ComputedFieldUpdater.ts`, `ComputedUpdateLock.ts`, `UpdateFromSelectBuilder.ts`, `ComputedFieldBackfillService.ts`, an `outbox/` with a **dead-letter queue**, and `isPersistedAsGeneratedColumn.ts`.
- Their [`ARCHITECTURE.md`](https://github.com/teableio/teable/blob/develop/packages/v2/adapter-table-repository-postgres/src/record/computed/ARCHITECTURE.md) describes a **hybrid sync + async outbox** with plan hashes, run ids, retries, `computed_update_dead_letter`, and OTel instrumentation: *"When max attempts is reached, tasks are moved to `computed_update_dead_letter`."*
- Cycle detection lives in [`schema/helpers/detectCircularDependency.ts`](https://github.com/teableio/teable/blob/develop/packages/v2/adapter-table-repository-postgres/src/schema/helpers/detectCircularDependency.ts), and there is a `MAX_VISITED` safety budget in the graph traversal that logs `computed:dependency:max_visited_reached` and bails.

**Read this as a warning about scope.** "Formulas that you can sort by" is not a feature; it is a distributed job system with a DLQ.

---

### 5. Formula engine prior art

#### 5.1 Grist's Python engine — the reference implementation

[`sandbox/grist/depend.py`](https://github.com/gristlabs/grist-core/blob/main/sandbox/grist/depend.py) (164 lines — read it, it is the clearest exposition of this problem anywhere):

> "Conceptually, all dependency relationships are the Edges (Node1, Relation, Node2), meaning that Node1 depends on Node2. Each Node represents a column in a particular table … **The Relation determines the row mapping, i.e. which rows in Node1 column need to be recomputed when a row changes in Node2 column.**"

> "Note: this is partly inspired by the implementation of the ninja build system"

**The key modelling decision: nodes are `(table_id, col_id)` — COLUMNS, not CELLS.** Cell-level granularity is recovered via the `Relation` on each edge, which maps dirty input rows to affected output rows. This is what makes the graph small (O(columns)) while invalidation stays row-precise.

```python
class Node(namedtuple('Node', ('table_id', 'col_id'))):
  __slots__ = ()    # memory-saving device to keep these objects small

class Edge(namedtuple('Edge', ('out_node', 'in_node', 'relation'))):
  __slots__ = ()

class CircularRefError(RuntimeError): ...
```

The graph keeps three structures: `_all_edges`, `_in_node_map` (in_node → edges to dependents), `_out_node_map` (out_node → edges to dependencies).

Invalidation is **iterative, not recursive** — and the comment says why:

```python
def invalidate_deps(self, dirty_node, dirty_rows, recompute_map, include_self=True):
    to_invalidate = [(dirty_node, dirty_rows)]
    while to_invalidate:
      dirty_node, dirty_rows = to_invalidate.pop()
      if include_self:
        if recompute_map.get(dirty_node) == ALL_ROWS: continue
        if dirty_rows == ALL_ROWS:
          recompute_map[dirty_node] = ALL_ROWS
          self.clear_dependencies(dirty_node)
        else:
          out_rows = recompute_map.setdefault(dirty_node, SortedSet())
          prev_count = len(out_rows)
          out_rows.update(dirty_rows)
          # Don't bother recursing into dependencies if we didn't actually update anything.
          if len(out_rows) <= prev_count: continue
      for edge in self._in_node_map.get(dirty_node, ()):
        affected_rows = edge.relation.get_affected_rows(dirty_rows)
        # Previously this was: self.invalidate_deps(...) but that led to a recursion error
        to_invalidate.append((edge.out_node, affected_rows))
```

Three transferable techniques in that one function:
1. **`ALL_ROWS` sentinel** — a whole-column invalidation short-circuits per-row bookkeeping and propagates as whole-column downstream.
2. **Fixpoint pruning** — if adding the dirty rows didn't grow the set, stop; this is what stops the traversal terminating.
3. **Explicit stack** — Python recursion limits are a real production failure for deep dependency chains.

**Cycle detection is the subtle part**, and Grist does something clever. From [`sandbox/grist/engine.py`](https://github.com/gristlabs/grist-core/blob/main/sandbox/grist/engine.py), `_update_loop`'s docstring:

> "Maintain a stack of work item triplets… Until stack is empty, take a work item off the stack and attempt to `_recompute` the specified rows of the specified node.
> - If an OrderError is received, first check it is for a cell we requested (`_recompute` will opportunistically try to compute other cells we haven't asked for, and it is important **for the purposes of cycle detection** to discount that).
> - If so, **'lock' that cell**, push the current work item back on the stack (remembering which cell to unlock later), and add a new work item for the cell that threw the OrderError.
>   + **The 'lock' serves only for cycle detection.**
>   + The order of stack placement means that the cell that threw the OrderError will now be evaluated before the cell that depends on it."

```python
except OrderError as e:
  work_items.append(WorkItem(node, row_ids, locks))
  locks = []
  lock = (node, e.requiring_row_id)
  work_items.append(WorkItem(e.node, [e.row_id], [lock]))
  self._locked_cells.add(lock)
...
cycle = required and (node, row_id) in self._locked_cells
...
raise depend.CircularRefError("Circular Reference")
```

So Grist does **not** pre-validate the graph for cycles. It **discovers dependencies lazily by evaluating**, raises `OrderError` when it hits a not-yet-computed cell, reorders the work stack, and declares a cycle only when it re-enters a **locked cell** — i.e. a cell already on the current evaluation path. That is depth-first-search cycle detection where the "visiting" set is the lock set, but interleaved with actual evaluation.

**Why lazily?** Because in a spreadsheet language, dependencies are *data-dependent*: `IF(A, B, C)` may depend on B or C depending on A's value. You cannot know the true dependency edges without running the formula. This is the fundamental reason spreadsheet engines are not simple topological sorts.

Two more safety rails in `_update_loop`:

```python
if self._recompute_done_counter < self._expected_done_counter:
  raise Exception('data engine not making progress updating dependencies')
...
if self.recompute_map and self._recompute_done_counter == 0:
  raise Exception('data engine not making progress updating formulas')
```

**Liveness assertions.** If a full pass computes zero cells, the engine crashes loudly instead of spinning. Copy this.

Contrast with **Teable**, which does static cycle detection (`detectCircularDependency.ts`) plus a `MAX_VISITED` traversal budget — feasible because Teable's formula language is more restricted than "arbitrary Python".

`UNRESOLVED: no academic-quality write-up found on incremental cycle detection specifically for spreadsheet engines. The formal-methods literature exists ([Formal Proof and Analysis of an Incremental Cycle Detection Algorithm, ITP 2019](https://drops.dagstuhl.de/opus/volltexte/2019/11073/pdf/LIPIcs-ITP-2019-18.pdf); [Incremental Topological Ordering and Cycle Detection with Predictions, arXiv 2402.11028](https://arxiv.org/abs/2402.11028)) but is about maintaining a topological order under edge insertion, which is a different (easier) problem than Grist's data-dependent dependency discovery.`

#### 5.2 Parsers, and the one-grammar-two-runtimes question

**What Teable actually does — and it answers the question.**

[`packages/formula/package.json`](https://github.com/teableio/teable/blob/develop/packages/formula/package.json):

```json
"scripts": { "antlr4ts": "antlr4ts -visitor -no-listener src/parser/*.g4" },
"dependencies": { "antlr4ts": "0.5.0-alpha.4" },
"devDependencies": { "antlr4ts-cli": "0.5.0-alpha.4" }
```

The generated artifacts are `src/parser/Formula.ts`, `FormulaLexer.ts`, `FormulaVisitor.ts`, from a `.g4` grammar. **ANTLR4 is the answer to "share one grammar across two runtimes"**: a single `.g4` file has official code generators for **TypeScript, Python 3, Java, Go, C#, C++, JavaScript, Dart, Swift, PHP**. You commit one grammar and generate a lexer+parser+visitor for each target. This is the only mainstream option where the *grammar itself* — not just an intermediate AST — is genuinely shared.

Teable then builds several visitors over that one tree:

| Visitor | Purpose |
|---|---|
| `FormulaSqlPgVisitor` / `FormulaSqlPgTranslator` | emit Postgres SQL |
| `field-reference.visitor.ts` | extract which fields a formula depends on (feeds the dependency graph) |
| `function-call-collector.visitor.ts` | which functions are used (validation/feature-gating) |
| `conversion.visitor.ts` | rewrite field references when a field id changes |
| `datetime-format-pg.ts` | map formula date formats to PG format strings |

**That is the pattern to steal: one grammar, one parse tree, N visitors, each with a different backend.** Dependency extraction and SQL emission fall out of the same tree, so they can never disagree about what the formula references.

The alternatives, honestly assessed:

| Option | Cross-runtime | Notes |
|---|---|---|
| **ANTLR4** (`.g4`) | ✅ TS + Python from one file, official | Heaviest toolchain; generated code is verbose; `antlr4ts` is pinned at `0.5.0-alpha.4` (an alpha, since 2018 — see the risk note below). The modern alternative is `antlr4ng`. |
| **Lark** (Python) | ⚠️ partial | `lark.js` ports the *standalone LALR(1) generator* to JS ([lark-parser/lark](https://github.com/lark-parser/lark)), so a `.lark` grammar can be compiled to a standalone JS parser. Two different codebases implementing the same grammar format — divergence risk is real but the grammar file is shared. |
| **Chevrotain** (TS) | ❌ | "Grammars are written as pure JavaScript sources without a code generation phase" ([Chevrotain](https://github.com/Chevrotain/chevrotain)). Fast and excellent DX, but the grammar *is* JS — it cannot be shared with Python. Good [tutorial on a filtering-expression parser](https://dev.to/amplanetwork/writing-a-filtering-expression-parser-with-chevrotain-parsing-library-5cfk). |
| **Hand-written Pratt parser** | ✅ by discipline | For a formula language (~30 infix/prefix operators, function calls, literals, field refs) a Pratt parser is 200–400 lines in each language. Two implementations, one spec, shared conformance test suite. **This is what most teams actually do**, and it is defensible: the grammar is small enough that duplication is cheaper than an ANTLR toolchain in CI for two languages. |
| **PLY / pyparsing** | ❌ | Python-only. |

`UNRESOLVED: whether Teable's ANTLR grammar is also generated for a Python target anywhere. Their backend is TypeScript throughout, so they have never needed to. I found no project publicly sharing one .g4 between a Python backend and a TS frontend for a formula language.`

Risk note: `antlr4ts@0.5.0-alpha.4` has been the latest for years. If you go ANTLR, evaluate `antlr4ng` (the maintained fork) rather than copying Teable's pin.

#### 5.3 Evaluating the same expression on client and server

This is the part I could substantiate least from published sources, so I will be explicit about the boundary.

**What I can source:** nobody in this survey does it.

- **Grist** evaluates formulas **only** in the server-side sandboxed Python data engine. The browser never evaluates a formula. ([grist-core overview](https://github.com/gristlabs/grist-core/blob/main/documentation/overview.md))
- **AppFlowy** evaluates **only** in the local Rust engine (there is no server evaluation; the CRDT is the source of truth). ([DeepWiki 7.2](https://deepwiki.com/AppFlowy-IO/AppFlowy/7.2-database-views-(filters-sorts-groups)))
- **Teable** compiles to **SQL** and computes in Postgres. Its client-side [`packages/sdk/src/components/editor/formula/Editor.tsx`](https://github.com/teableio/teable/blob/develop/packages/sdk/src/components/editor/formula/Editor.tsx) uses the same parser for **editing, validation and autocomplete** — not for evaluation. `packages/core/src/formula/evaluate.ts` exists in core (shared TS), so a single TS implementation *can* run in both places — but that is TS-on-both-sides, not two runtimes.

**The structural divergence hazards** (mechanism, not citation — treat as reasoning to validate, not as evidence):

| Hazard | Why |
|---|---|
| Numeric type | JS `number` is IEEE-754 double; Postgres `numeric` is exact decimal. `0.1 + 0.2` differs. A sum of currency will disagree between optimistic UI and server. |
| Integer range | JS loses precision above 2^53; `bigint` does not. |
| String collation | JS `localeCompare` vs Postgres collation (`C` vs `en_US.UTF-8` vs ICU). Sorting text differs, especially for case and accents. |
| Timezone / DST | JS `Date` uses the *browser's* timezone; Postgres uses the session/server `TimeZone`. `TODAY()` genuinely differs for a user in UTC+13. |
| NULL semantics | SQL three-valued logic (`NULL = NULL` → NULL) vs JS `undefined == null` → true. Every comparison operator is a divergence site. |
| Rounding | `Math.round(-0.5)` → `-0` in JS; `round(-0.5)` → `-1` in Postgres (round-half-away-from-zero). |
| Division by zero | JS → `Infinity`; Postgres → error. |
| Aggregates over related rows | The client simply doesn't have the linked table's rows. |

**The practical resolutions** (my synthesis, since no source states this directly):

1. **Server is authoritative; client evaluation is a visual placeholder that is always overwritten** by the server's value when the write acknowledges. Never persist a client-computed value.
2. **Restrict optimistic evaluation to a safe subset** — no aggregates, no dates, no cross-row references — and render everything else as a spinner/`…` until the server responds.
3. **Golden test suite**: one JSON file of `{expression, inputs, expected}` executed by both runtimes in CI. This is the only mechanism that actually prevents drift, and it is cheap.
4. Ban the divergent primitives from the language surface where you can (e.g. define your own `ROUND` semantics and implement them explicitly on both sides rather than delegating to the host).

`UNRESOLVED: I found no published post-mortem or engineering write-up on client/server formula-evaluation divergence in a spreadsheet product. The hazards above are derived from language semantics, not from reported incidents.`

---

### 6. Frontend performance prior art

#### 6.1 Grid library landscape — checked against the npm registry on 2026-08-08

| Package | Latest | Published | React peer | Read |
|---|---|---|---|---|
| `@tanstack/react-table` | **9.1.0** | 2026-08-07 | `>=18` | Actively developed; v9 is current. |
| `@tanstack/react-virtual` | **3.14.9** | 2026-07-28 | `^16.8 \|\| ^17 \|\| ^18 \|\| ^19` | Actively developed, explicit React 19. |
| `ag-grid-react` | **36.1.0** | 2026-08-05 | `^16.8 \|\| ^17 \|\| ^18 \|\| ^19` | Actively developed, explicit React 19. |
| `react-window` | **2.3.0** | 2026-07-20 | `^18 \|\| ^19` | v2 is a rewrite; React 18/19 only. |
| `react-data-grid` | **7.0.0-beta.61** | 2026-07-14 | `^19.2` | **Still beta** after many betas; React 19.2+ only. |
| `@glideapps/glide-data-grid` | **6.0.3** | **2024-02-03** | `^16.12 \|\| 17.x \|\| 18.x` | **No release in ~2.5 years. No React 19 peer.** Repo not archived (last push 2026-01-21, 5,296 stars, 127 open issues) but npm is stale. |

**The glide-data-grid finding is the actionable one.** It is the library people reach for when they want "Notion/Airtable feel" (canvas-rendered, so it does not choke on wide grids), and its **npm release is 2.5 years old with no React 19 peer declaration**. The repo still receives pushes, so it is not dead, but shipping a Next.js 16 / React 19 app on a package whose published peer range excludes React 19 means `--legacy-peer-deps` forever and no upstream fix path. `UNRESOLVED: whether glide-data-grid works correctly under React 19 in practice despite the peer range — I did not test it, and found no maintainer statement.`

**Canvas vs DOM is the real axis**, not library brand:

- **glide-data-grid** renders to `<canvas>`. Cell count stops mattering; you can do 100 columns × 1M rows. Cost: you implement accessibility, text selection, and every cell editor yourself, and it is the stale package above.
- **TanStack Table + TanStack Virtual** is DOM, headless. TanStack Table is logic-only ("you're not fighting against any opinionated DOM structure"); you add `@tanstack/react-virtual` for row virtualisation ([TanStack's own AG Grid comparison page](https://tanstack.com/table/v8/docs/enterprise/ag-grid) — notable for being written by TanStack and still recommending AG Grid for enterprise needs). Column resize/reorder/pinning are **built into TanStack Table's feature set as state + APIs**, but *you* render them.
- **AG Grid** is DOM with built-in virtualisation ("requires no additional configuration"), and column pinning/resize/reorder/grouping are first-class. Community edition is MIT; row grouping, pivoting, and the master-detail features are **Enterprise (paid)**. That licensing boundary is the thing to check before adopting, because "group by property" is a core Notion-databases feature and grouping is exactly what sits behind AG Grid's paywall. `UNRESOLVED: whether AG Grid's *row grouping* specifically is Enterprise-only in v36 — the split has moved between versions and I did not verify against the v36 feature matrix.`

Secondary comparisons agree that both TanStack and AG Grid handle 100k+ rows with virtualisation and that "a well-virtualized TanStack table performs comparably" ([PkgPulse 2026 guide](https://www.pkgpulse.com/guides/tanstack-table-vs-ag-grid-vs-react-data-grid-2026), [Simple Table comparison](https://www.simple-table.com/blog/tanstack-table-vs-ag-grid-comparison)). These are content-marketing posts without reproducible benchmarks; treat the "comparable" claim as plausible-but-unmeasured.

`UNRESOLVED: I found no reproducible, independent benchmark (with methodology and hardware) of these libraries at 10k rows. Every "comparison" found was vendor or SEO content.`

**Note on 10k rows specifically:** at 10k rows, virtualisation makes the row count nearly irrelevant — the DOM holds ~30 rows. The costs that actually bite are (a) the initial JSON payload and parse, (b) re-render fan-out on a single cell edit, (c) column count × visible rows for cell components. Optimise for those, not for row count.

#### 6.2 Optimistic updates and Supabase Realtime

**Realtime hard limits** ([Supabase Realtime Limits](https://supabase.com/docs/guides/realtime/limits)):

| Limit | Free | Pro | Pro (no spend cap) / Team | Enterprise |
|---|---|---|---|---|
| Concurrent connections | 200 | 500 | 10,000 | 10,000+ |
| Messages / second | **100** | **500** | **2,500** | 2,500+ |
| Channel joins / second | 100 | 500 | 2,500 | 2,500+ |
| Broadcast payload | 256 KB | 3,000 KB | 3,000 KB | 3,000 KB |
| Postgres Changes payload | 1,024 KB | 1,024 KB | 1,024 KB | 1,024 KB |

And a nasty truncation rule: when the payload limit is hit, *"the `new` and `old` record payloads only include the fields with a value size of less than or equal to 64 bytes."* **A wide row silently degrades to a partial payload.** For a JSONB `properties` column holding a whole property bag, this is very likely to trigger — you would receive a change event with the `properties` field silently missing.

**The scaling model is the real problem** ([Postgres Changes docs](https://supabase.com/docs/guides/realtime/postgres-changes)):

> "Postgres Changes authorizes every event against each subscriber. When you make a single change to a table with 100 subscribed users, Realtime performs 100 authorization checks."

> "Changes are also processed on a single thread to preserve their order, which means larger compute add-ons don't meaningfully increase Postgres Changes throughput."

**Throughput scales with subscriber count, not write rate, and you cannot buy your way out with a bigger instance.** Their own published numbers (RLS enabled):

| Instance | Connected clients | Total changes/sec | Messages/client/sec | p95 latency |
|---|---|---|---|---|
| Micro | 500 | 30 | 6 | ~228 ms |
| Micro | 3,000 | 5 | 1 | ~616 ms |
| Large | 500 | 40 | 8 | ~618 ms |
| Large | 4,000 | 5 | 1 | ~918 ms |

**A Micro instance with 500 connected clients sustains 30 changes/second across the entire project.** For collaborative grid editing — where one user dragging a fill handle across 50 cells emits 50 changes — that is roughly *one user typing*.

Their own recommendations: use filters and column selection to shrink payloads; write **indexed** RLS policies (the §3.7 rules apply to realtime too, per-event); and *"If you expect more than ~3,000 concurrent subscribers on the same changes, use Broadcast instead"*, which fans out without per-subscriber authorization. Community reporting adds that *"subscribing to a table that receives 1,000+ inserts per second will overload the Realtime WAL processing"* and suggests a separate RLS-free public table for change streaming ([agilesoftlabs](https://www.agilesoftlabs.com/blog/2026/05/supabase-realtime-in-production-what)).

**Is Supabase Realtime a sane fit for row-level collaborative editing? Based on the published numbers: `postgres_changes` is not; Broadcast might be.**

The shape that follows from the evidence:
- Client applies the edit optimistically to local state.
- Write goes to **your FastAPI backend** (which owns validation, formula recompute, and the schema allow-list — none of which PostgREST can do).
- The backend publishes a **compact, already-authorized Broadcast message** on a per-table channel (`table:{table_id}`) containing `{row_id, field_id, value, version}` — not the whole row.
- Authorization happens once, in your backend, at publish time — not N times per subscriber.
- Conflict resolution is last-writer-wins per cell with a version counter, unless you want CRDTs (AppFlowy's answer), which is a much larger project.

Note this also removes the 64-byte truncation hazard, because you control the payload size.

`UNRESOLVED: I found no published account of anyone running a collaborative Airtable-style grid on Supabase Realtime Broadcast at scale, with numbers.`

---

### 7. The three designs: pros / cons / breaks when…

#### (a) Dynamic physical tables — one real Postgres table per user database

**Prior art:** Teable, Baserow, NocoDB, undb (records), Directus, Mathesar.

| | |
|---|---|
| **Pros** | Postgres does the work you would otherwise reimplement: B-tree indexes on any property, `ORDER BY` with an index, real types and constraints, planner statistics per column, aggregates, joins to other user tables for relations/rollups. Filtering and sorting are ordinary indexed queries with well-understood plans. `ALTER TABLE ADD COLUMN` (nullable, non-volatile default) is **O(1) since PG 11** — [5 ms, no seq scan](https://www.dbi-services.com/blog/postgresql-11-instant-add-column-with-a-non-null-default-value/). Row-level RLS is a trivial predicate; the table *is* the tenant boundary. Data is directly readable by BI tools, embeddings jobs, `pg_dump` — the Directus interoperability argument. No TOAST tax on unrelated properties. Formula columns can be real stored columns, therefore sortable and indexable. Proven to **5 million rows in a single table** ([Baserow 1.17](https://baserow.io/blog/1-17-release-of-baserow)). |
| **Cons** | DDL is not transactional with your metadata in practice — Teable needs a `provisionState` state machine for the window between them. Every `ALTER TABLE` takes a brief `ACCESS EXCLUSIVE` lock. DDL literals cannot use bind parameters, so you must hand-roll `quote_ident`/`quote_literal` (§4.2 — NocoDB shipped an injection bug in exactly this seam). Catalog grows with users: 10k users × 10 tables = 100k relations. Type changes are expensive: Teable literally does DROP + ADD + repopulate. Schema migrations to *your own* system have to be applied to N user tables. ORM introspection must be avoided or cached (Baserow uses Redis). RLS policies must be created per table — thousands of policy objects to audit. |
| **Breaks when…** | **① A single table accumulates 1,600 cumulative field add/drops.** `MaxHeapAttributeNumber = 1600`, dropped columns keep their attnum forever, and **`VACUUM FULL` does not reclaim them** ([data-bene](https://www.data-bene.io/en/blog/did-you-know-tables-in-postgresql-are-limited-to-1600-columns/), [BUG #17127](https://postgresql.org/message-id/17127-f973fb9d41bae9ca%40postgresql.org)). Requires a table-rebuild tool. ② **Catalog operations degrade** well before data queries do — `information_schema.tables` took **2,406 ms** at 1M tables even though per-table queries stayed at **1.3 ms** ([Aurora experiment](https://dev.to/mierune/what-does-occur-when-making-a-million-tables-on-amazon-aurora-postgresql-7gg)). Autovacuum scheduling and `pg_dump` are the first casualties. ③ You need to query **across** user databases (global search, "all my tasks") — that is now a `UNION ALL` over N tables, or a separate denormalised index. ④ A user creates 2,000 databases in a loop. Rate-limit DDL. |

#### (b) EAV — `row_values(row_id, property_id, value_text, value_number, value_date, …)`

**Prior art:** essentially nobody in this space. Evolveum evaluated it against JSONB for a different problem.

| | |
|---|---|
| **Pros** | Fully dynamic with zero DDL. One index per value type serves every property in the system. Sparse data costs nothing. Adding a property is an `INSERT` into the schema table. Cross-database queries are natural. **Wins on high-selectivity lookups of a rare value:** Evolveum found EAV **15× faster** at "find any 500 rows with hobbies=sleeping", and faster on basic count (337 vs 440 ms) and basic limited select (0.419 vs 0.734 ms). |
| **Cons** | Every additional filter condition is another self-join or `EXISTS`. A 4-condition filter is a 4-way self-join over the largest table in the system — the planner's row estimates for these are notoriously bad and it will pick nested loops at the wrong cardinality. **`ORDER BY` on property X requires joining to get X for every row in the filtered set before you can sort** — no index can give you sorted output of the *rows* by a *value* in another table without that join. Reading one row of 20 properties = 20 rows to fetch and pivot. Storage and index bloat: **6.43 GB vs 2.08 GB for the same 10M entities** ([coussej](https://coussej.github.io/2016/01/14/Replacing-EAV-with-JSONB-in-PostgreSQL/)). Writes are slow because "writing multiple attributes requires multiple index accesses". RLS must be duplicated onto the values table or you leak. |
| **Breaks when…** | ① **A filter has 3+ conditions on different properties at 1M rows.** This is the normal case in a Notion view, and it is EAV's worst case. ② You sort by one property and filter by another. ③ You need `GROUP BY` a property with aggregates over another. ④ Honestly: it breaks at the design review. The `row_values` table becomes `(rows × properties)` — a 1M-row database with 20 properties is a **20M-row** values table *per user database*. |

#### (c) Single `rows` table + `properties JSONB` + separate schema table

**Prior art:** Notion (at 480 shards with a heavy client cache); undb for *schema*, not for data.

| | |
|---|---|
| **Pros** | Zero DDL — property add/remove/rename/reorder is a metadata write. One table, one set of indexes, **one RLS policy** to write and audit. A whole row is one tuple: reading a row-page is a single fetch, no pivot, no join. Cross-database queries are trivial. Schema evolution of *your* system is a normal migration. Storage is compact vs EAV (**2.08 GB vs 6.43 GB** at 10M entities). Excellent for containment/tag queries: `@>` on a `jsonb_path_ops` GIN index measured at **0.153 ms** ([coussej](https://coussej.github.io/2016/01/14/Replacing-EAV-with-JSONB-in-PostgreSQL/)). Matches Notion's actual model, so the block/page/property unification is natural. Optimistic-concurrency and version columns are simple. |
| **Cons** | **GIN indexes only accelerate `@>`, `?`, `?\|`, `?&`, `@?`, `@@`** ([PG docs](https://www.postgresql.org/docs/current/datatype-json.html)). `properties->>'k' = 'v'` gets **no** GIN help — same data, same column, **25,000× slower than `@>`** in coussej's benchmark. **GIN cannot serve `ORDER BY` at all** ([index types](https://www.postgresql.org/docs/current/indexes-types.html)). Fixing this needs a **B-tree expression index per property**, each of which "must be computed for each row insertion and non-HOT update" ([expression index docs](https://www.postgresql.org/docs/current/indexes-expressional.html)) — and **every JSONB write is a non-HOT update**, so you never get HOT. Creating those indexes is itself DDL, on a huge shared table, which is *worse* than `ALTER TABLE ADD COLUMN`. Evolveum's expression index on `ext->>'email'` was **not used by the planner even after ANALYZE**. Range predicates, numeric comparisons, and case-insensitive search each need their own index expression with the exact matching cast. Everything is text unless cast, so `'9' > '10'` unless you cast — and a bad cast **errors mid-scan**. No per-column statistics: the planner's selectivity estimates for JSONB predicates are poor, which produces bad join orders. |
| **Breaks when…** | ① **Rows exceed ~2,000 bytes and get TOASTed.** Reading one key detoasts and decompresses the *entire* value; measured **746 ms → 7,624 ms, a 10.2× cliff**, on the identical query ([Evan Jones](https://www.evanjones.ca/postgres-large-json-performance.html)). A 20-property row with two long-text fields is over the threshold. ② **You `ORDER BY` an arbitrary property at 100k+ rows** — full sort of the filtered set, every time, unless you pre-built the exact expression index. ③ **Update-heavy workloads** — the entire row is rewritten on every cell edit ("the problem with JSONB type is that it is not efficient to update", [Evolveum](https://docs.evolveum.com/midpoint/projects/midscale/design/repo/repository-json-vs-eav/)) and every expression index is re-maintained. Recall Notion: **"90% of Notion upserts are updates."** ④ You want a **UNIQUE constraint**, `NOT NULL`, or a FK on a property. ⑤ Aggregates: `SUM((properties->>'amount')::numeric)` casts every row, and a single non-numeric value anywhere in the column **fails the whole query**. |

#### 7.1 Cross-cutting summary

| Dimension | (a) Physical tables | (b) EAV | (c) JSONB |
|---|---|---|---|
| Filter on 1 property, 1M rows | Index scan | Index scan + join | Seq scan unless `@>` or exact expression index |
| Filter on 4 properties | Composite/bitmap index | 4-way self-join ❌ | Multiple filters, mostly unindexed ❌ |
| `ORDER BY` arbitrary property | Index scan ✅ | Join then sort ❌ | Full sort, or per-property B-tree expression index |
| Aggregate over a property | Native, typed | Join + pivot | Cast per row; one bad value errors the query |
| Add property to 1M-row table | O(1) `ADD COLUMN` (PG 11+) | Metadata only ✅ | Metadata only ✅ — but the *index* you then need is expensive |
| Rename property | Metadata only if columns are `field_{id}` ✅ | Metadata only ✅ | Metadata only ✅ |
| Change property type | DROP+ADD+repopulate ❌ | Move between value columns | Rewrite the key in every row |
| Read one full row | 1 tuple ✅ | N rows + pivot ❌ | 1 tuple, but detoast the whole bag |
| Cell update write cost | Update 1 attribute; HOT possible ✅ | Update 1 small row ✅ | Rewrite whole tuple + all expression indexes ❌ |
| RLS | Trivial predicate; thousands of policies | Must be duplicated ❌ | One policy ✅ |
| Catalog pressure | Grows with user tables ❌ | None ✅ | None ✅ |
| Cross-database query | `UNION ALL` over N tables ❌ | Natural ✅ | Natural ✅ |
| Hard ceiling | 1,600 cumulative fields/table | Values table = rows × props | TOAST cliff + no indexed sort |
| Who ships it | Teable, Baserow, NocoDB, undb, Directus | — | Notion (with 480 shards + client cache) |

---

### 8. UNRESOLVED — things I could not substantiate

1. **Notion has never published the rationale for the 4-character random property key.** §1.3 is inference from the data model, not a citation.
2. **Notion's collision behaviour for concurrently-minted 4-char property keys** (~1.7M keyspace) is undocumented.
3. **Whether Notion's API cursor encodes a keyset position or a server-side result-set handle.** The short expiry hints at the latter; not published.
4. **No Notion engineering post found specifically about server-side caching (memcached/Redis) or "making database views fast."** The quastor.org secondary summary returned an empty response on fetch; the primary sources I could reach are about *client-side* SQLite/IndexedDB caching.
5. **No published benchmark of `ORDER BY` on a JSONB-extracted key at 1M+ rows vs. a real column.** This is the single most decision-relevant missing measurement and you should run it yourself.
6. **No benchmark or engineering write-up of `jsonb_populate_record`/`jsonb_to_record` + LATERAL** as a query strategy for a user-defined-schema engine, at any scale.
7. **Whether Teable auto-creates a B-tree index per user field**, or only on explicit request. I found the drop-index path but no unconditional create path.
8. **No OSS Airtable/Notion clone found that stores row property values in JSONB and does server-side arbitrary filter+sort+aggregate at scale.** Notable absence given how many such projects exist.
9. **Sources disagree on catalog scaling.** The Aurora experiment reports 1M tables as survivable (data queries 1.3 ms) while conventional guidance says 10⁵ tables degrades planning and autovacuum "drastically". Reconciliation offered in §3.6 (data path vs catalog path) is my reasoning, not a cited finding.
10. **No Postgres mechanism found for a template/default RLS policy on newly created tables.** DDL event triggers are the folklore answer; no production write-up found for this use case.
11. **Whether PG 18 permits indexes on VIRTUAL generated columns.** The generated-columns doc page does not address indexing at all.
12. **Whether glide-data-grid works under React 19** despite its peer range excluding it (latest npm release 2024-02-03). No maintainer statement found; I did not test.
13. **Whether AG Grid v36 row grouping specifically is Enterprise-only.** The Community/Enterprise split has moved across versions and I did not verify against v36's matrix.
14. **No reproducible independent benchmark of React grid libraries at 10k rows** with published methodology and hardware — every comparison found was vendor or SEO content.
15. **No project found publicly sharing one ANTLR `.g4` grammar between a Python backend and a TypeScript frontend** for a formula language. Teable is TS-only end to end.
16. **No published post-mortem on client/server formula-evaluation divergence** in a spreadsheet product. §5.3's hazard list is derived from language semantics, not reported incidents.
17. **No published account of running a collaborative Airtable-style grid on Supabase Realtime Broadcast at scale**, with numbers.
18. **No academic-quality treatment of incremental cycle detection for spreadsheet engines specifically** — the formal-methods literature addresses topological-order maintenance under edge insertion, which is a strictly easier problem than Grist's data-dependent discovery.

---

### 9. My opinion (clearly labelled — this is a recommendation, not a finding)

**Recommendation: a hybrid, with dynamic physical tables for row data — Baserow's naming scheme, Teable's Knex/SQLAlchemy discipline, undb's JSONB-for-metadata split.**

Concretely:

1. **Metadata in JSONB, data in physical tables.** Follow undb: `user_table(id, base_id, name, schema jsonb, views jsonb, ...)`. The schema and view configs are read whole, never filtered on, and change atomically. JSONB is exactly right there and exactly wrong for row data.
2. **Physical column names are `f_{field_id}`, never derived from the user's field name.** This is Baserow's `field_{id}` and it is the single most important detail in this document. It gives you Notion's rename semantics (metadata-only rename), removes every identifier-escaping and collision problem, and keeps identifiers inside `[A-Za-z0-9_]` so the §4.1 injection hazard in Teable's `tableColumnRef` cannot exist. You lose Teable's "readable in psql" property; a documented `field` table and a helper view buys most of it back.
3. **Flat namespace: `t_{table_id}` in one schema.** Baserow's shape, not Teable's schema-per-base. It keeps `pg_namespace` small and makes the catalog-pressure question one-dimensional.
4. **Never create a NOT NULL column, never use a volatile default.** Stay permanently on PG 11's O(1) `ADD COLUMN` path. Teable enforces this with an explicit exception; copy that.
5. **Build the table-rebuild tool before you launch.** The 1,600-attnum ceiling is not a scale problem, it is a *usage* problem that one enthusiastic user reaches on their own. `CREATE TABLE t_new AS SELECT …; ALTER TABLE … RENAME`, run under a lock, driven by a check on `count(*) FROM pg_attribute WHERE attrelid = …`. Alarm at 1,200.
6. **Filter AST → SQLAlchemy Core, with the three-layer defence.** Request carries `field_id` only; look up the column from your own `field` table (never from the DB catalog, never from the request); allow-list the operator against the field's type; bind every value as a parameter with a type coercion first. Build `Table`/`Column` objects from your metadata, and **never call `MetaData.reflect()` per request** — that is the mistake that makes catalog pressure bite. On unknown `field_id`, **error** rather than silently dropping the clause (I think Teable is wrong here).
7. **Formulas: materialise into a real stored column, recompute via an explicit dependency graph, sort on the column.** Not `GENERATED ALWAYS AS` — the immutability/no-subquery/no-chaining restrictions rule it out for anything referencing a linked table. Model the graph as **`(table_id, field_id)` nodes with a relation on each edge**, following Grist's `depend.py`; steal the `ALL_ROWS` sentinel, the fixpoint pruning, the explicit stack, and above all the **liveness assertion** (`raise if a full pass computed zero cells`). Start with a synchronous recompute inside the write transaction and a hard bound on graph size; move to Teable's outbox+DLQ only when you measure the need — and note Baserow's honest number: unoptimised formula recompute was "over a minute" per row operation.
8. **One grammar, one parse tree, N visitors.** Whether via ANTLR or a hand-written Pratt parser (I would start with Pratt — a formula language is 300 lines and you avoid a two-language codegen step in CI), derive **both** the SQL emitter **and** the dependency extractor from the same tree, so they cannot disagree about what a formula references. That is Teable's structure and it is right.
9. **Client-side formula evaluation: only as a disposable placeholder, only for a restricted subset, always with a shared golden test suite in CI.** Never persist a client-computed value.
10. **Frontend: TanStack Table + TanStack Virtual.** Both are actively released (Aug 2026) with React 19 support; glide-data-grid's npm is 2.5 years stale and does not declare React 19; AG Grid's grouping/pivot licensing is a business decision you should not make implicitly. Budget for building column resize/reorder/pinning UI yourself — TanStack gives you the state and APIs, not the pixels.
11. **Realtime: your FastAPI backend publishes compact, pre-authorized Broadcast messages. Do not use `postgres_changes` for grid collaboration.** The published numbers are unambiguous: a Micro instance with 500 clients sustains **30 changes/second project-wide**, throughput scales with *subscriber count* not write rate, it is single-threaded, and a bigger instance does not help. Broadcast also sidesteps the 64-byte payload-truncation rule.

**Why not (c) JSONB, despite it matching Notion's model and being far less work to build?**

Because the two things a Notion database view does constantly are **filter on an arbitrary property** and **sort by an arbitrary property**, and Postgres's JSONB indexing is structurally bad at both: GIN accelerates only containment-family operators and **cannot serve `ORDER BY` at any time**, while the B-tree expression indexes that would fix it must be created per property, are re-maintained on every write (with HOT permanently unavailable), and were observed by Evolveum to be **ignored by the planner even after ANALYZE**. Add the 10.2× TOAST cliff on rows over ~2 kB — which describes a *typical* 20-property row-page — and the fact that this is an update-dominated workload where the whole tuple is rewritten on every cell edit.

Notion makes it work at 200B blocks, but Notion pays for it with 480 shards, a per-client SQLite cache, and an API that caps at 100 rows per page with cursors that expire in minutes. **The JSONB design is only viable if you are also willing to build Notion's caching layer.** Every project in this survey that tried to serve arbitrary filter+sort from a relational database instead of a cache — Teable, Baserow, NocoDB, undb, Directus — arrived independently at real columns.

**Why not (b) EAV:** no serious prior art in this space, and its failure mode is precisely the common case (multi-condition filters and sorting by one property while filtering by another).

**The one thing I would validate before committing** — and it is cheap, a day's work: generate 1M rows with 20 properties in both layouts on a Supabase instance, then measure `WHERE prop = ? ORDER BY other_prop LIMIT 50 OFFSET 0` and `... OFFSET 10000`, plus a filtered `COUNT(*)`, with and without indexes, with RLS on and off. That is the exact query the product runs on every view load, it is UNRESOLVED #5 above, and no published benchmark answers it.

---

### Appendix: source index

**Notion**
- [Exploring Notion's Data Model: A Block-Based Architecture](https://www.notion.com/blog/data-model-behind-notion)
- [Herding elephants: lessons learned from sharding Postgres at Notion](https://www.notion.com/blog/sharding-postgres-at-notion)
- [Building and scaling Notion's data lake](https://www.notion.com/blog/building-and-scaling-notions-data-lake)
- [How we sped up Notion in the browser with WASM SQLite](https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite)
- [Stephen Ou — The Beauty of Notion](https://stephenou.com/beauty-of-notion)
- [Krzysztof Kowalczyk — How I reverse engineered Notion API](https://blog.kowalczyk.info/article/88aee8f43620471aa9dbcad28368174c/how-i-reverse-engineered-notion-api.html)
- [notion-py `notion/collection.py`](https://github.com/jamalex/notion-py/blob/master/notion/collection.py)
- [Notion API — Property object](https://developers.notion.com/reference/property-object) · [API intro/pagination](https://developers.notion.com/reference/intro)

**Teable** (all `develop` branch)
- [`prisma/postgres/schema.prisma`](https://github.com/teableio/teable/blob/develop/packages/db-main-prisma/prisma/postgres/schema.prisma)
- [`db-provider/postgres.provider.ts`](https://github.com/teableio/teable/blob/develop/apps/nestjs-backend/src/db-provider/postgres.provider.ts)
- [`features/field/field.service.ts`](https://github.com/teableio/teable/blob/develop/apps/nestjs-backend/src/features/field/field.service.ts)
- [`db-provider/filter-query/filter-query.abstract.ts`](https://github.com/teableio/teable/blob/develop/apps/nestjs-backend/src/db-provider/filter-query/filter-query.abstract.ts)
- [`db-provider/filter-query/cell-value-filter.abstract.ts`](https://github.com/teableio/teable/blob/develop/apps/nestjs-backend/src/db-provider/filter-query/cell-value-filter.abstract.ts)
- [`db-provider/filter-query/postgres/filter-query.postgres.ts`](https://github.com/teableio/teable/blob/develop/apps/nestjs-backend/src/db-provider/filter-query/postgres/filter-query.postgres.ts)
- [`v2/formula-sql-pg/src/FormulaSqlPgTranslator.ts`](https://github.com/teableio/teable/blob/develop/packages/v2/formula-sql-pg/src/FormulaSqlPgTranslator.ts)
- [`v2/.../schema/rules/field/GeneratedColumnRule.ts`](https://github.com/teableio/teable/blob/develop/packages/v2/adapter-table-repository-postgres/src/schema/rules/field/GeneratedColumnRule.ts)
- [`v2/.../record/computed/` (FieldDependencyGraph, ComputedUpdatePlanner, ARCHITECTURE.md)](https://github.com/teableio/teable/tree/develop/packages/v2/adapter-table-repository-postgres/src/record/computed)
- [`packages/formula/package.json` (ANTLR4)](https://github.com/teableio/teable/blob/develop/packages/formula/package.json)
- [Teable blog — Data Reimagined: Postgres-Airtable Fusion](https://blog.teable.io/blog/data-reimagined-postgres-airtable-fusion)

**Baserow**
- [`table/constants.py`](https://github.com/bram2w/baserow/blob/master/backend/src/baserow/contrib/database/table/constants.py) · [`table/models.py`](https://github.com/bram2w/baserow/blob/master/backend/src/baserow/contrib/database/table/models.py) · [`fields/models.py`](https://github.com/bram2w/baserow/blob/master/backend/src/baserow/contrib/database/fields/models.py) · [`views/view_filters.py`](https://github.com/bram2w/baserow/blob/master/backend/src/baserow/contrib/database/views/view_filters.py)
- [How Baserow lets users generate Django models on the fly](https://baserow.io/blog/how-baserow-lets-users-generate-django-models)
- [Baserow 1.17 release](https://baserow.io/blog/1-17-release-of-baserow) · [1.27 release](https://baserow.io/blog/1-27-release-of-baserow) · [Field indexes](https://baserow.io/user-docs/field-indexes) · [Database plugin docs](https://baserow.io/docs/technical/database-plugin)

**NocoDB / undb / Grist / AppFlowy / Directus / Mathesar**
- [NocoDB `db/conditionV2.ts`](https://github.com/nocodb/nocodb/blob/develop/packages/nocodb/src/db/conditionV2.ts) · [`helpers/sqlSanitize.ts`](https://github.com/nocodb/nocodb/blob/develop/packages/nocodb/src/helpers/sqlSanitize.ts) · [architecture docs](https://docs.nocodb.com/engineering/architecture/) · [DeepWiki: Tables and Columns](https://deepwiki.com/nocodb/nocodb-1/3.4-tables-and-columns)
- [undb postgres migration `0000_low_jimmy_woo.sql`](https://github.com/undb-io/undb/blob/main/apps/backend/drizzle/postgres/0000_low_jimmy_woo.sql) · [`underlying-table.service.ts`](https://github.com/undb-io/undb/blob/main/packages/persistence/src/underlying/underlying-table.service.ts)
- [Grist `sandbox/grist/depend.py`](https://github.com/gristlabs/grist-core/blob/main/sandbox/grist/depend.py) · [`sandbox/grist/engine.py`](https://github.com/gristlabs/grist-core/blob/main/sandbox/grist/engine.py) · [`documentation/grist-data-format.md`](https://github.com/gristlabs/grist-core/blob/main/documentation/grist-data-format.md) · [`documentation/overview.md`](https://github.com/gristlabs/grist-core/blob/main/documentation/overview.md)
- [AppFlowy DeepWiki: Database Views (Filters, Sorts, Groups)](https://deepwiki.com/AppFlowy-IO/AppFlowy/7.2-database-views-(filters-sorts-groups)) · [Database System](https://deepwiki.com/AppFlowy-IO/AppFlowy/7-database-system)
- [Directus vs Strapi](https://directus.com/strapi) · [punits.dev comparison](https://punits.dev/blog/directus-vs-strapi/) · [Directus DeepWiki: Database and Schema Management](https://deepwiki.com/directus/directus/3.2-database-and-schema-management) · [Mathesar overview](https://openapps.pro/apps/mathesar)

**Postgres**
- [JSON Types (jsonb indexing)](https://www.postgresql.org/docs/current/datatype-json.html) · [Index Types](https://www.postgresql.org/docs/current/indexes-types.html) · [Indexes on Expressions](https://www.postgresql.org/docs/current/indexes-expressional.html) · [GIN Indexes](https://www.postgresql.org/docs/current/gin.html) · [Generated Columns (PG 18)](https://www.postgresql.org/docs/current/ddl-generated-columns.html) · [PL/pgSQL Dynamic Commands](https://www.postgresql.org/docs/current/plpgsql-statements.html)
- [Fast ALTER TABLE ADD COLUMN commit (PG 11)](https://www.postgresql.org/message-id/E1f0zNq-00064z-Sn%40gemulon.postgresql.org) · [depesz](https://www.depesz.com/2018/04/04/waiting-for-postgresql-11-fast-alter-table-add-column-with-a-non-null-default/) · [Data Egret](https://dataegret.com/2018/03/waiting-for-postgresql-11-pain-free-add-column-with-non-null-defaults/) · [brandur](https://brandur.org/postgres-default) · [dbi-services](https://www.dbi-services.com/blog/postgresql-11-instant-add-column-with-a-non-null-default-value/) · [Squawk: adding-field-with-default](https://squawkhq.com/docs/adding-field-with-default/)
- [data-bene: 1,600 column limit](https://www.data-bene.io/en/blog/did-you-know-tables-in-postgresql-are-limited-to-1600-columns/) · [Stormatics: PostgreSQL Column Limits](https://stormatics.tech/blogs/postgresql-column-limits) · [BUG #17127](https://postgresql.org/message-id/17127-f973fb9d41bae9ca%40postgresql.org) · [nerderati](https://nerderati.com/postgresql-tables-can-have-at-most-1600-columns/)
- [Evan Jones: Postgres large JSON value query performance](https://www.evanjones.ca/postgres-large-json-performance.html) · [pganalyze: JSONB and TOAST](https://pganalyze.com/blog/5mins-postgres-jsonb-toast) · [credativ: TOASTed JSONB compression benchmarks](https://www.credativ.de/en/blog/postgresql-en/toasted-jsonb-data-in-postgresql-performance-tests-of-different-compression-algorithms/) · [Postgres Pro: Speed up the JSONB (FOSDEM 2021)](https://postgrespro.com/media/2022/03/24/jsonb-fosdem-2021%20(1).pdf)
- [coussej: Replacing EAV with JSONB](https://coussej.github.io/2016/01/14/Replacing-EAV-with-JSONB-in-PostgreSQL/) · [Evolveum: JSONB vs EAV](https://docs.evolveum.com/midpoint/projects/midscale/design/repo/repository-json-vs-eav/) · [Machytka: GIN operator classes](https://medium.com/@josef.machytka/postgresql-jsonb-operator-classes-of-gin-indexes-and-their-usage-0bf399073a4c)
- [1M tables on Aurora PostgreSQL](https://dev.to/mierune/what-does-occur-when-making-a-million-tables-on-amazon-aurora-postgresql-7gg)

**Supabase**
- [RLS Performance and Best Practices (discussion #14576)](https://github.com/orgs/supabase/discussions/14576) · [docs mirror](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv) · [Database Advisors: `auth_rls_initplan`](https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0003_auth_rls_initplan) · [76 policies rewritten](https://dev.to/arvavit/76-rls-policies-rewritten-in-one-migration-the-authuid-init-plan-trap-in-supabase-4hg)
- [Dian M Fay: fixing slow row-level security policies](https://di.nmfay.com/rls-performance) · [Bytebase: Postgres RLS Limitations and Alternatives](https://www.bytebase.com/blog/postgres-row-level-security-limitations-and-alternatives/)
- [Using Custom Schemas](https://supabase.com/docs/guides/api/using-custom-schemas) · [PGRST106 troubleshooting](https://supabase.com/docs/guides/troubleshooting/pgrst106-the-schema-must-be-one-of-the-following-error-when-querying-an-exposed-schema) · [supabase#45904](https://github.com/supabase/supabase/issues/45904) · [wildcard schemas discussion #12270](https://github.com/orgs/supabase/discussions/12270)
- [Realtime Limits](https://supabase.com/docs/guides/realtime/limits) · [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) · [Realtime Benchmarks](https://supabase.com/docs/guides/realtime/benchmarks)

**Parsers / frontend**
- [ANTLR4 / antlr4ts (via Teable's package.json)](https://github.com/teableio/teable/blob/develop/packages/formula/package.json) · [Lark](https://github.com/lark-parser/lark) · [Chevrotain](https://github.com/Chevrotain/chevrotain) · [Chevrotain filtering-expression parser tutorial](https://dev.to/amplanetwork/writing-a-filtering-expression-parser-with-chevrotain-parsing-library-5cfk)
- [TanStack Table's own AG Grid comparison](https://tanstack.com/table/v8/docs/enterprise/ag-grid) · [PkgPulse 2026 grid comparison](https://www.pkgpulse.com/guides/tanstack-table-vs-ag-grid-vs-react-data-grid-2026) · npm registry metadata queried 2026-08-08
- [sqlalchemy-filtering](https://pypi.org/project/sqlalchemy-filtering) · [sqla-filter](https://pypi.org/project/sqla-filter) · [Mindee: dynamic API filtering with Flask-SQLAlchemy](https://www.mindee.com/blog/flask-sqlalchemy)
---

## L. Consolidated UNRESOLVED index

`UNRESOLVED:` entries mark behavior **Notion has not documented anywhere findable**, not gaps
in research effort. Each area section carries its own fully-worded list; this is the index and
the count, so the design document can be checked against it exhaustively.

| Area | Section | Count | Where the list lives |
|---|---|---|---|
| Property types | §F | 36 | §F.33 |
| View types | §G | 33 | §G.21 |
| Formulas | §H | 39 | §H.6 |
| Querying (filters/sorts/groups/aggregations) | §I | 31 | §I.9 |
| Structure & automation | §J | 29 | §J.10 |
| Architecture prior art | §K | 18 | §K.8 |
| **Total** | | **186** | |

### L.1 The ones that actually block a decision

Most of the 186 are cosmetic (an unnamed enum, an unstated cap). These twelve change
behavior a user would notice, and the design document must decide each one explicitly:

1. **Empty/null sort placement, per property type.** Undocumented for *every* type. Maps
   directly onto `NULLS FIRST` / `NULLS LAST` in every generated `ORDER BY`. **Cannot be
   closed by research** — Notion never published it and we have no workspace to probe.
2. **Status sort order** — by group-then-option, or a flat option order?
3. **Multi-select sort** — how is a row with several options ordered against a row with one?
4. **When `now()` / `today()` re-evaluate.** Nothing published. Determines whether formula
   results can be cached at all, or need a volatility classification. The single most
   consequential unknown for the formula engine's caching design.
5. **Cycle-detection behavior in formulas** — what Notion does on a cycle is undocumented.
6. **Timezone and boundary semantics of the relative date operators** (`past_week`,
   `this_week`, …), including which day the week starts on. `start_day_of_week` exists for
   *grouping* but has no filter equivalent.
7. **Empty-set return value for every aggregation** (`sum` of nothing = 0 or null?).
8. **"Count values" on multi-select** — counts cells, or individual tags? Two Notion help
   pages word it inconsistently.
9. **Sub-item nesting depth.** Undocumented. (The widely-repeated "three levels" belongs to
   database *templates* — do not transfer it.)
10. **Circular-dependency handling** in the dependencies feature — entirely undocumented.
11. **Two-way relation deletion semantics** — does deleting one side delete the mirror, or
    convert it to one-way?
12. **`ORDER BY` on a JSONB-extracted key at scale vs. a real column.** No published
    benchmark exists (architecture §K.8 #5). Unlike the others this one *is* closable — by
    measuring it ourselves, which the plan schedules as a gate before the storage decision
    is locked in.

### L.2 How the design handles them

Every item in L.1 is resolved in the design document as a **stated product decision**,
labelled as ours rather than attributed to Notion. Where Notion's true behavior is later
discovered to differ, these are the places to look first.

---
