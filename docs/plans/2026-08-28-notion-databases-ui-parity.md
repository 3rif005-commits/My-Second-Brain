# Notion Databases — UI Parity Implementation Plan

> **Status:** structure decided; per-milestone task lists are written as each surface spec
> lands (they cite spec rows, so they cannot be written first). See
> `docs/ui-specs/PROGRESS.md` for what is ready.
>
> **Goal:** a user who knows Notion sits down in front of our databases and does not notice
> they left Notion. Same affordances on hover, same menu from the same click, same rows in
> the same order, same sub-panels behind the same arrows, same keyboard, same empty states.
>
> **Specs:** `docs/ui-specs/` — one file per surface, and the source of truth for every row
> **Design:** `docs/superpowers/specs/2026-08-28-notion-databases-ui-parity-design.md`
> **Extends:** `docs/plans/2026-08-08-notion-databases.md` (M1–M14, the mechanics — done,
> not re-planned here)

---

## Context

The mechanics are built and correct: 22 property types, 10 view types, a filter→SQL
compiler, formulas, rollups, relations, templates, automations, CSV in/out. The UI on top
of them is not Notion, for one structural reason — **there is no interaction primitive
layer**, so every surface reinvented itself as an inline form. 40 native `<select>`
elements across 11 files; property creation as a trailing-column form; view creation as an
inline form with the group-by chosen up front.

The previous round failed on UI because "like Notion" was never written down in a checkable
form, so its exit criteria could only assert behavior — and the gap is in affordance and
shape, which behavior tests do not see. This plan's exit criteria therefore end in a live
visual diff, and its specs are exhaustive enough that an implementing agent invents nothing.

**Scope:** the primitive layer plus full parity for **Table view**. The other nine view
types are a named final phase — prove the pattern once before copying it nine times.

---

## Global constraints

- **No subagent-driven execution.** Every milestone runs inline in the main session. A
  subagent's output lives only in a transcript, and a session hitting its usage limit has
  destroyed completed work on this project more than once. Artifacts are written to disk as
  they are finished and committed per artifact; `docs/ui-specs/PROGRESS.md` is the resume
  point for a fresh session.
- **The API layer is done and does not change**, apart from the three endpoints scoped as
  Phase 0b. Any surface that seems to need more is a signal that scope drifted into
  mechanics — raise it, do not widen quietly.
- **No native `window.confirm/prompt/alert`** — they freeze the tab and kill browser
  automation. Use `components/ui/ConfirmDialog`, `PromptDialog`, `useToast()` from
  `app/providers.tsx`. Notion has no native dialogs either, so the constraint and the goal
  agree.
- **No new migrations.** This phase should need none; if one appears, scope drifted.
- **No invented visual values.** A spacing, width or colour with no screenshot behind it is
  `TBD` and blocks the milestone that needs it.
- **Per-view state goes in `view.config`**, an unvalidated JSONB pass-through
  (`ViewUpdate.config`). Property order, visibility, width and wrap are per-view in Notion
  too, so column reorder / hide / resize / insert-left / insert-right need **zero** backend
  change. Do not use schema-level `db_properties.position` for view-local ordering.
- Frontend: `cd frontend && npx tsc --noEmit && npm run test`; build `npm run build`;
  e2e `npx playwright test`.
- Backend: `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/ -p asyncio`.
  Two venvs — `.venv` is runtime, `venv` is the test venv. Do not mix them.
- Whole stack: `./app.sh start|stop|status|logs`.

---

## Milestone sequence

> **Reconciled 2026-08-31** against the 15 written specs. Eight entries in the previous
> version were stale — they described surfaces as the plan *assumed* them, before capture.
> Changes are called out inline.

| # | Milestone | Spec | Ships |
|---|---|---|---|
| **0** | Primitive layer + design tokens | design doc §3, §5 | Nothing user-visible — correct for this phase |
| **0b** | **Four** backend endpoints | — | Unblocks M1, M2, M7, M8 |
| **1** | Table column header menu **+ the Calculate sub-panel** | `table-column-header.md`, `calculations-row.md` | 14 rows, in-place rename, `Change type`, and the 3-level Calculate tree. *Decision 2026-08-31: M1 owns Calculate so no row is ever dead* |
| **2** | Property creation + edit panel | `property-create-edit.md` | Two-input creation flow, 2-column type grid, per-type config, scope disclaimer |
| **2b** | **The 11 additional property types** | `property-create-edit.md`, `cell-editing.md` | Person, URL, Email, Phone, ID, Place, Created/Last-edited time/by. *Decision 2026-08-31: adopt them; split from M2 so the picker rewrite and 11 new cell renderers are separately reviewable* |
| **3** | **View settings sidebar** *(was "view options `···` panel")* | `view-options-panel.md` | The whole toolbar (Filter · Sort · Automations · AI Autofill · Search · Settings), the 483px docked sidebar, Layout, Property visibility, Open pages in. **No "Load limit" — no such row exists** |
| — | **review checkpoint (M1–M3, M2b)** | | |
| **0c** | **Grouping engine** *(backend)* | `group-panel.md` §scope | Range/bucket grouping for Number and Date, boolean for Checkbox, value grouping for Text/URL/Person in `services/db/query/grouping.py`. *Decision 2026-08-31: engine first, so M6 can match Notion rather than disable 7 types* |
| **4** | Filter panel — quick picker, filter bar, advanced nested builder | `filter-panel.md` | First time a filter is settable from the UI at all. Operators **derived from `TYPE_OPERATORS`**, not hardcoded |
| **5** | Sort panel — multi-level, drag-reorder, type-aware direction labels | `sort-panel.md` | Same |
| **6** | Group panel — group by, group ordering, per-group visibility and order | `group-panel.md` | *Corrected: **no sub-group** and **no per-group counts** were found in a table view; both were plan assumptions* |
| — | **review checkpoint (0c, M4–M6)** | | |
| **7** | View tab bar — per-view menu, `+` type card grid, create-first-configure-after | `view-tab-bar.md` | Rename/duplicate/delete a view; fixes the header-chrome collision. *Corrected: **no view icon picker** was found — `Display as` is tab presentation (Text and icon / Text only / Icon only)* |
| **8** | Database header — creation modal, title, icon, description | `database-header.md` | A database can be renamed for the first time. **Entirely blocked on 0b/B2 — nothing here ships before it** |
| **9** | Row hover affordances + open-as | `row-affordances.md` | *Corrected: the trigger is the **drag handle**, not a separate `⋮⋮`. It carries three gestures: click opens the menu, drag reorders, click also selects* |
| **10** | Row peek internals | `row-peek.md` | Non-modal, URL-addressable (`?p=&pm=`), alphabetical property list, `+ Add a property`. *Corrected: the peek's `⋯` is the standard **page** menu — editor chrome, **out of scope**; comments deferred with it* |
| **11** | Calculations **footer row**, `+ New` split button, resize, drag-reorder, remaining cell editors, states | `calculations-row.md`, `new-row-button.md`, `table-drag-resize.md`, `cell-editing.md`, `states.md` | *Corrected: **context menus dropped** — right-click opens the existing §1/§9 menus. Calculations reduced to the footer, since M1 ships the function tree* |
| — | **review checkpoint (M7–M11), then whole-branch pass** | | |
| **12** | **Apply the pattern to the other nine views** | — | Named and sized below; gets its own prompt |

### Phase 0 — primitive layer

Six components under `frontend/components/ui/primitives/`: `Popover`, `MenuList`,
`SidePeek`, `HoverAffordance`, `IconPicker`, `DragHandle`. Three new packages
(`@radix-ui/react-popover`, `-dialog`, `-tooltip`) — see the design doc §2 for why
`-dropdown-menu` and Mantine are rejected.

Vitest coverage is required for **keyboard and dismissal**, since that is what a later
visual diff cannot check: ↑/↓ with focus retained in the search input, Enter, Esc popping
one sub-panel then closing, ← popping, Tab returning focus to the trigger, type-to-search,
outside-click, and `role="combobox"` + `aria-activedescendant` on the search input.

**The inline-database check moves to M1.** It was written as a Phase 0 exit criterion, but
Phase 0 ships nothing *rendered* — the primitives are not wired into any surface, so there
is no menu to open from inside an inline database and nothing to move a mouse over. Faking
it with a throwaway harness would prove less than M1 proves for free.

What Phase 0 *can* do, and has done, is prepare for it: `Popover` takes a `container` prop,
so when M1 renders the column header menu inside `DatabaseBlock` the fix is a one-line
change (portal into the wrapper) rather than re-adding ad-hoc listeners. The risk itself is
unchanged and still real — Radix portals to `document.body` by default, outside the
`stopPropagation` guard at `DatabaseBlock.tsx:188-199`.

**M1 exit criteria therefore gain:** open the column header menu on a database embedded in
a note, move the pointer across the menu and the table, and assert no
`Cannot read properties of undefined (reading 'rows')` in the console.

### Phase 0b — the four backend endpoints

No migration, no schema change, ~85 lines total.

| id | Endpoint | Unblocks |
|---|---|---|
| B1 | `DELETE /db/views/{view_id}` | M7 — view menu → `Delete view`. **Only reachable when view count > 1**; the last view cannot be deleted, so enforce that both sides |
| B2 | `PATCH` + `DELETE /db/databases/{database_id}` | **M8 entirely** — title, icon, description, delete |
| B3 | `PropertyUpdate.description` — the column exists on `PropertyResponse`, the patch model cannot write it | M2 — the `ⓘ` beside a property name is literally "Add property description" |
| **B5** | **`PropertyUpdate` must accept `type`** | **M1** — `Change type` is a row in the column header menu. Without this it is a dead row from the first milestone |

> **B5 is new (2026-08-31).** It was missed when Phase 0b was first scoped, because the
> column header menu had not been captured yet. Conversion legality is also a real rule
> Notion expresses (Text → Relation is greyed) and **we have no endpoint describing which
> conversions are legal** — either hardcode the matrix client-side or add a lookup. Decide
> during 0b.

**Not built, flagged:** duplicating a row cannot copy the page body without a new endpoint
(B4). Duplicating a view and duplicating a property are done client-side (POST + PATCH)
and are faithful. Deleting a row already works through the existing
`DELETE /api/notes/{noteId}` — it needs wiring, not an endpoint.

### Phase 0c — grouping engine (backend)

*Added 2026-08-31 by decision: mirror Notion's grouping rather than disabling seven types.*

Notion groups by at least ten property types; `GROUPABLE_PROPERTY_TYPES` is three. This is
engine work, not UI:

| Type | Group key derivation |
|---|---|
| Number | **Range buckets** — bucket size is a per-view setting |
| Date | **Day / week / month / year** — the unit is a per-view setting |
| Checkbox | Boolean — two groups |
| Text, URL, Person | Exact value, with a `No <Property>` bucket for empties |

Touches `services/db/query/grouping.py` (`GroupBySpec` gains a per-type key strategy) and
the compiler. It has its own pytest surface and **must land before M6**, but is independent
of M1–M5, so it can run in parallel with the M1–M3 batch.

> The `No <PropertyName>` empty bucket already exists conceptually — the backend produces
> the bucket, and `group-panel.md` fixes the naming convention as a UI concern.

---

## Definition of done, per milestone

In this order. A milestone is not done until step 4 passes.

1. **Implementation matches its spec file row for row.** Not "covers the same ground" —
   the rows, their order, their icons, their hints, their sub-panels.
2. `cd frontend && npx tsc --noEmit && npm run test` clean.
3. The spec's **Checklist** is run live in Chrome via `claude-in-chrome`, every step
   screenshotted into `docs/ui-specs/screenshots/actual/` **as it is taken**, so an
   interrupted run resumes at the next unshot step.
4. **The user diffs `screenshots/actual/` against `screenshots/` and says what is off.**
   Nothing ships as done before this. A code review structurally cannot catch this defect
   class: it is scoped to the diff it is handed, and the gap here is in affordance and
   shape, which passing tests do not measure.
5. Review pass over the accumulated diff, run inline, findings appended to
   `docs/ui-specs/REVIEW-LOG.md` one at a time as they are found. Batched at the three
   checkpoints above, plus one whole-branch pass at the end.
6. The milestone ends with the exact CLI commands for the user to run themselves:
   ```
   cd frontend && npx tsc --noEmit && npm run test
   cd frontend && npm run build
   ./app.sh start          # then click through the surface in the browser
   ```
   Backend milestones (0b) add:
   ```
   cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/ -p asyncio
   ```

---

## Phase 12 — the other nine views

Gets its own prompt once the pattern is proven on Table. The table below (2026-08-28) sized
each view by guessing how much of its surface was already-built mechanics versus net-new
UI, **before M1–M11 actually existed** — the task breakdown below (written 2026-09-02,
after M1–M11 shipped) confirms that guess against the real code instead of re-guessing.

| View | Size (original guess) | Why |
|---|---|---|
| Board | L | Group headers, card layout options, drag between columns, per-group `+` and `···` |
| Gallery | M | Card preview source, card size, fit-image; shares the property-visibility panel |
| List | S | Nearly all shared surface |
| Feed | S | Same |
| Calendar | L | Date-range bars, month/week, drag to reschedule, event peek |
| Timeline | L | Zoom levels, dependency arrows, drag to reschedule, the table/timeline split |
| Chart | M | Config panel is already dense; mostly a `<select>` → `MenuList` migration |
| Form | M | Field editor, logic, the public page |
| Dashboard | M | Widget grid, per-widget config |

Also deferred here, and inventoried so they are not lost: `DatabaseSettingsMenu`,
`TemplateManager`/`TemplateEditor`, `AutomationManager`/`AutomationEditor` (10 native
`<select>`), `ButtonActionChainEditor` (8), `RelationPicker`, `FormulaEditor`,
`DatabaseBlock`'s inline header, `ButtonBlock`/`ButtonCell`.

---

### What M1–M11 already ship for every view type, confirmed by reading the actual code
(2026-09-02) — not re-derived from the original sizing table's guesses

`DatabaseShell.tsx`'s `renderActiveView` is the ONLY place that switches on `activeView.type`.
Everything rendered ABOVE that switch — the view tab bar, the database header, the view
toolbar, the settings sidebar shell and most of its panels — mounts once, unconditionally,
regardless of which view is active. Confirmed by grepping every one of those files for
`view.type`/`viewType`/`activeView.type`: only `ViewLayoutPanel.tsx`'s 3×3 card grid (which
type is "selected") and the sidebar's own title string (`"${viewType} view"`) read it at
all — nothing gates a whole row or panel on type.

**Fully free, zero further work, for all nine remaining types, right now:**
- View tab bar (M7): create/rename/duplicate/delete/display-as, the `+` card grid, `?view=`.
- Database header (M8): title/icon/description, the page `⋯` menu.
- View toolbar (M3) + `QueryBar.tsx` chips: Filter, Sort, Automations, AI Autofill, Search,
  Settings — all six render and work identically.
- **Filter panel (M4) and Sort panel (M5) — including the DATA effect, not just the UI.**
  `useDatabaseView.loadRows` sends `filter`/`sorts` on `POST .../query` unconditionally for
  every view type (`getQueryExtras`, `types.ts:301`, only branches on type for `group_by`/
  `aggregations` — filter and sorts are outside that branch entirely). A user can already
  filter and sort a Gallery, a Calendar, a Form-backed data source today.
- Cell editing (M11): every view's own card/row renders values through the SAME
  `renderCellValue` dispatcher `TableView.tsx` uses (confirmed in `BoardCard`/`GalleryView`'s
  own code) — Select's create-on-type popover, Status's grouped editor, every M11 cell fix,
  are already live in Board and Gallery, not just Table.
- "Edit properties" (property CRUD: create/edit/change-type/delete) — per data source, not
  per view; already reachable from the settings sidebar and `DatabaseSettingsMenu` regardless
  of the active view's type.

**Partially wired — confirmed by grep, not assumed:**
- Property visibility's **hide** toggle (M3 §B): `GalleryView.tsx`/`FeedView.tsx` already
  read `config.hidden_properties`. `BoardView.tsx`/`CalendarView.tsx`/`TimelineView.tsx`/
  `ListView.tsx` do not — the panel's toggle is a silent no-op for those four today.
- Property visibility's **reorder** (drag, M3 §B): only `TableView.tsx` reads
  `config.property_order` (the M1-class dead-control bug M3 itself closed for Table) — every
  other view still ignores it, silent no-op.
- Group panel (M6): `getQueryExtras` only forwards `group_by` for `board`/`table`/`chart` —
  the panel renders for every type, but writing a group-by for Gallery/List/Feed/Calendar/
  Timeline/Form/Dashboard has no query-time effect yet (matches this table's own original
  per-view "Why" column — none of those six ever named grouping as their own scope, so this
  is a known limit, not a newly-discovered regression).

**Genuinely Table-rendering-specific, confirmed absent elsewhere:**
- Row hover affordances (M9 — `RowGutter`/`RowMenu`: `+`/drag-handle/checkbox gutter, bulk
  select bar, Favorites/Open in/Copy link/Move to Trash menu). Every other view still only
  renders a bare `OpenNoteButton` icon (`grep OpenNoteButton` across the view files — Board
  and Gallery have it, List/Feed/Calendar/Timeline effectively the same via their own row/
  card markup); none has the gutter, bulk bar, or row menu at all.
- Row peek internals (M10 — `?p=`/`?pm=` deep link, Alt+Click, the forced-side-peek row
  menu entry, the `»/⤢/★/⋯` header bar). Only `TableView.tsx` imports `RowPeek` — every
  other view opens a row via full navigation (`OpenNoteButton`) only, never the peek.
- Calculations footer (M11): a literal `<tfoot>` row over `TableView`'s own `<table>` — no
  natural equivalent in a card/board/calendar layout, and no other view was ever named in
  `calculations-row.md`'s own scope.
- Column resize/drag-reorder (M11): TanStack-table-specific; Board's own "drag between
  columns" (its L-sizing's own words) is a DIFFERENT drag (cards between kanban columns,
  already built) from this.
- The column header menu itself (M1): inherently a table-grid concept — Board/Gallery/
  Calendar/etc. have no per-column header at all to hang it from. What that menu offers
  PER PROPERTY (rename, change type, hide, delete) already has a type-agnostic home in
  "Edit properties" (see above), so nothing here is actually lost, just not reachable via a
  column header that doesn't exist in these layouts.

### Order (smallest-first, decided 2026-09-02) — prove the pattern transfers before the two L's

1. **List (S)** — nearly all shared surface per the original sizing; the real gap, per the
   code survey above, is row hover affordances + row peek (M9/M10's own scope, adapted to a
   List row) and wiring `hidden_properties`/`property_order` the same way Table already does.
2. **Feed (S)** — same shape as List; `hidden_properties` already wired, `property_order`
   is not, plus the same M9/M10 row-affordances gap.
3. **Gallery (M)** — List/Feed's own gaps (row affordances, peek, `property_order`) PLUS its
   own named net-new UI: card preview source, card size, fit-image (captured nowhere yet —
   needs its own live-Notion pass, `property-create-edit.md`-style, before building).
4. **Chart (M)** — the one already explicitly de-scoped by the M7 create-flow rewrite
   (`view-tab-bar.md`'s own new section): still needs a real POST-creation config surface
   (currently only reachable at creation time via `ChartCreateFields`) — "mostly a `<select>`
   → `MenuList` migration" per the original sizing, now a confirmed, scoped, concrete task
   rather than a guess.
5. **Form (M)** — field editor, logic, the public page; least overlap with anything M1-M11
   already built (Form has no `rows`/`properties` grid at all, per M12's own earlier "read
   only for row data" DatabaseShell comment) — expect this to need its own capture pass from
   scratch, closer to a new surface than a retrofit.
6. **Dashboard (M)** — widget grid, per-widget config; same "least overlap" reasoning as Form.
7. **Board (L)** — already has more built than the others (M6's grouped rendering, drag
   between columns, per-group `+`/`···`) — what's left, per the survey above: row hover
   affordances/peek (cards, not rows — needs its own capture of what a Notion Board card's
   own hover state shows, almost certainly different from a Table row's left-gutter shape),
   card layout options (cover/properties-shown, likely close to Gallery's own once that
   ships), `hidden_properties` wiring.
8. **Calendar (L)** — date-range bars (multi-day events), drag-to-reschedule refinement
   beyond the single-day drop `CalendarView.tsx` already has, event peek, row peek/hidden_
   properties wiring.
9. **Timeline (L)** — zoom-level refinement beyond what exists, dependency arrows, drag-to-
   reschedule, the table/timeline split view, row peek/hidden_properties wiring.

Each still follows this workstream's own established loop (`README.md`'s "Review loop"):
capture from live Notion where the existing raw-dom/screenshots don't already answer the
question (List/Feed's row-affordances shape almost certainly needs its own quick capture —
`row-affordances.md`'s own capture is table-shaped, with px-offsets tied to a table grid, not
yet confirmed to transfer to a List row), build, live-checklist, review checkpoint, write up
in `PROGRESS.md`/`REVIEW-LOG.md`, same discipline as every milestone before it.

**Not started** as of 2026-09-02 — this breakdown is the resume point. No List-view spec
capture, code, or tests exist yet for Phase 12.
