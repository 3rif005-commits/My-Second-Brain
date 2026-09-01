# Progress — Notion Databases UI Parity

**This file is the resume point.** A fresh session reads it and knows exactly where to
pick up, with no need to reconstruct context. Update it immediately after every status
transition, before moving on.

Statuses: `not-started` → `dom-captured` → `screenshots-read` → `written` → `self-audited`

**Branch:** `feat/notion-databases-ui-parity` (from `feat/workspaces-compact-redesign` @ 25a08b4)

---

## Phase 0 — COMPLETE (2026-08-31)

| Item | State |
|---|---|
| `@radix-ui/react-popover`, `-dialog`, `-tooltip` | installed |
| Design tokens | **measured** from live Notion via `getComputedStyle`, in `globals.css` + `tailwind.config.ts` |
| `Popover`, `MenuList`, `SidePeek`, `HoverAffordance`, `IconPicker`, `DragHandle` | written, `components/ui/primitives/` |
| Keyboard + dismissal tests | 24 tests, 4 files |
| Full suite | **45 files / 599 tests green** (baseline was 41 / 575) |
| `npx tsc --noEmit` | clean |
| Inline-database crash check | **moved to M1** — Phase 0 renders nothing, so there is nothing to run it against. `Popover` gained a `container` prop so the fix is one line when M1 needs it |

Phase 0 ships nothing user-visible. That is the intended outcome.

## Phase 0b — COMPLETE (2026-08-31)

| id | Endpoint | State |
|---|---|---|
| B1 | `DELETE /db/views/{id}` | done — refuses to delete the last view, in a transaction |
| B2 | `PATCH` + `DELETE /db/databases/{id}` | done — delete is **soft** (`deleted_at`), rows deliberately not trashed |
| B3 | `PropertyUpdate.description` | done — explicit `null` clears, via `model_fields_set` |
| B5 | `PropertyUpdate.type` | done — **grew well past its estimate**, see below |

**Backend suite 1829 passed** (was 1797; +32).

### B5 was mis-scoped in the plan, and by how much

The plan called it "`PropertyUpdate` must accept `type`" — about five lines. It
became `services/db/properties/convert.py` (~180 lines) plus 32 tests, because a bare
type flip is not merely untidy: values are §3.3 discriminated wrappers and `rows.py`
rejects a wrapper whose tag does not match its property, so every stored value would
have been invalidated at once.

Chosen semantics: coerce a defined subset, refuse the rest with a 400. Nothing is
destroyed silently. `legal_targets()` serves the greying list the UI needs, so there is
no second copy to drift.

**Currently convertible:** text-family (`rich_text`/`url`/`email`/`phone_number`),
`select` ↔ `status` ↔ `multi_select`, and into `number` where the text parses.
**Refused:** relation, formula, rollup, title, date, and checkbox as a target.
The matrix is extensible — widening it is a change to one dict.

## M1 / M2 / M2b — COMPLETE (2026-08-31)

| Milestone | State |
|---|---|
| M1 — table column header menu | done, visual-diffed, 4 defects fixed |
| M2 — property creation popover | done, visual-diffed |
| M2b — the 5 held-back property types | done; one defect found (types sharing an icon) |
| **M2 completion — `Edit property`** | **done, visual-diffed, 4 defects fixed** |

**Frontend 50 files / 676 tests green. Backend 1385 passed, 0 failed** (448 errors
are all `ConnectionRefusedError` — no local Postgres on this machine; pre-existing).
`npx tsc --noEmit` clean.

### What `Edit property` settled

- **The row is conditional on the property type.** A Text column's menu opens
  straight onto `Change type`; Notion shows no `Edit property` row at all.
  `hasEditableConfig()` is the one place that rule lives: `number`, `select`,
  `multi_select`, `status`.
- `NumberConfig` gained `decimal_places` / `show_as` / `bar_color` / `divide_by` /
  `show_number`. No endpoint change was needed — `config` is an unvalidated
  pass-through for non-computed types — but the model is the written-down schema
  and would otherwise have gone stale against what the UI writes.
- `NumberCell` **formats** now (39 formats, decimal places, bar/ring). Without
  that, `Number format` would have been a control nothing reads.
- The select cells read the configured option **colour**, matched by name. They
  are still free-text; rebuilding them as option pickers is `cell-editing.md`.

### Primitive additions this needed

| Addition | Why |
|---|---|
| `MenuSection.action.label: ReactNode` | the `Options` header's action is a `+` icon, not text |
| `MenuSection.content` | the `Show as` cards and the scope disclaimer are not rows, and `footer` would draw a divider the captured panel does not have |
| `MenuPanel.width` | widths are per-panel: 248px menu, 299px `Edit property` flyout |
| `MenuRow.labelNode` | an option row renders as the option's own coloured pill; `label` still drives search |
| flyout side inheritance | a chain that flipped left must keep going left, or the third level covers the first |

### Deferred, tracked

- `formula` / `relation` / `rollup` are excluded from `hasEditableConfig` — their
  config is already reachable through the creation popover's push-panel, and two
  entry points with two shapes is how the old inline forms drifted. Unifying them
  is the one named follow-up in `property-create-edit.md`.
- Option drag-reorder (`⠿`) waits for M11's drag work.
- Whether Notion keeps its colour list open on select is **unverified** — see
  `M1-VISUAL-DIFF.md`.

---

## M3 — COMPLETE (2026-09-01)

| Milestone | State |
|---|---|
| M3 — the view settings sidebar | done, visual-diffed live, 2 defects fixed |

**Frontend 54 files / 724 tests green. Backend suite unchanged (no backend
files touched this milestone).** `npx tsc --noEmit` clean.

### What M3 built

- **`ViewSettingsSidebar.tsx`** — the docked 483px sidebar, `SidePeek`
  (`mode="side"`, `resizable={false}`) hosting `MenuList` in `nav="push"`
  mode. Root panel matches `view-options-panel.md` row for row across all
  three sections.
- **`ViewLayoutPanel.tsx`** — §A: the 3x3 view-type grid (only the current
  type enabled — `ViewUpdate` has no `type` field, and no-backend-change was
  this milestone's own constraint), three real display toggles
  (`show_vertical_lines`, `show_page_icon`, `wrap_all_content`), and Open
  pages in (a real popover — `side`/`center`/`full`, all three wired end to
  end: center opens a centered modal, full navigates to
  `/brain/workspace/{id}`).
- **`PropertyVisibilityPanel.tsx`** — §B: drag reorder (`@dnd-kit`, pure
  `reorderPropertyKeys` split out for testability) + per-row eye toggles +
  "Hide all". The title property's toggle is disabled — it's the only place
  `OpenNoteButton` and the sub-item tree render.
- **`ViewToolbar.tsx`** — the toolbar row the spec said didn't exist at all
  (Filter/Sort/Automations/AI Autofill/Search/Settings), threaded into
  `ViewTabs.tsx` via a new `trailing` prop. Filter and Sort reuse the exact
  same `MenuPanel` data the sidebar's own rows push.
- Group (§D) and Sort (§E) are real, working MVPs — not stubs — built on
  infrastructure that already existed (`GROUPABLE_PROPERTY_TYPES`, M1's
  `onSetSorts`): single group-by with per-type disabled reasons; multi-sort
  with per-row direction/remove, drag-reorder deferred to M5. Filter,
  Conditional color and Manage data sources push an honest "isn't available
  yet" panel — no compiler/backend support exists for any of them yet.
- Reused `EditPropertyPanel.tsx`'s `editPropertyPanel`/`hasEditableConfig`
  for "Edit properties" rather than a second copy; reused `AutomationManager`
  for "Automations" ("fold it in here", the spec's own instruction).
- **The M1-class defect, closed for real this time:** `TableView.tsx`'s
  `orderedProperties` was still a bare schema-position sort — M1's Hide/
  Insert-left/right rows had been writing `hidden_properties`/
  `property_order` since M1 shipped, and *nothing read either*. Now wired
  through the same `lib/database/viewConfig.ts` helpers Gallery/FeedView
  already used for their own `hidden_properties`.
- `RowPeek.tsx` gained a `mode` prop and is now genuinely non-modal in its
  default ("side") mode — it was unconditionally modal (`bg-black/30`
  backdrop over the whole viewport) before this, a gap `row-peek.md`'s own
  capture had already flagged as unverified.

### Primitive additions this needed

| Addition | Why |
|---|---|
| `MenuList.dismissible` | the persistent × every level of the sidebar carries, distinct from the back arrow's pop |
| `MenuRow.annotation` | Open pages in's "Default for Table" link, alongside `description` |
| `SidePeek.resizable` | 483px is a token, not a per-viewer preference the row peek's own drag remembers |
| `MenuList`'s push stack now stores row-id **paths**, not resolved panels | see the live-found defect below — a pushed panel must reflect the LIVE root, not a snapshot frozen at push time |

### Two defects found running the checklist live, both fixed

1. **A pushed panel didn't reflect its own live writes.** Dragging inside
   Property visibility wrote the new order correctly (table re-rendered),
   but the panel itself kept showing the pre-drag order until popped and
   re-pushed. Root cause and fix in `MenuList.tsx`'s `resolveStack` — a
   primitive-layer fix, not a one-panel patch. Full account in
   `M1-VISUAL-DIFF.md`'s M3 section.
2. **The toolbar's Sort button showed a property's raw key**
   (`"Sort: eNCdGzx4"`) instead of its name. Fixed, and the unit test that
   had enshrined the bug corrected.

### Deliberate, not defects

- **View type switching is disabled for every card but the current one** —
  `ViewUpdate` has no `type` field and this milestone's constraint is no
  backend change. Map's cut slot filled with Dashboard to keep the 3x3
  shape the checklist tests for.
- **The `New ▾` split button stays at the bottom of the table**, where
  M11's row-add already put it — the spec's own scope bullet lists only the
  six toolbar icons as new.
- **`?view=` deep links are written but not yet read on load** — Copy link
  to view produces a real, sensible URL; nothing in `DatabaseShell` parses
  `?view=` on mount yet. Recorded rather than silently left half-working;
  low risk since it is a clipboard action, not a persisted setting the UI
  must render.

---

## Phase 0c / M4 / M5 / M6 — COMPLETE (2026-09-01)

| Milestone | State |
|---|---|
| Phase 0c — grouping engine | already existed (task-13/15, pre-dates this plan) — only the UI-facing wiring was missing |
| M4 — Filter panel | done, built end to end, not yet visual-diffed live |
| M5 — Sort panel (drag-reorder) | done, built end to end, not yet visual-diffed live |
| M6 — Group panel + grouped Table rendering | done, built end to end, not yet visual-diffed live |

**Frontend 59 files / 805 tests green.** `npx tsc --noEmit` clean. Backend untouched —
34/34 grouping tests already green before this session (0c needed no backend work).
**Live Chrome checklist run and the user's visual diff are still outstanding for all
three milestones** — this batch was built and unit-tested inline across one long
session; the review checkpoint below covers code review only.

### The Phase 0c discovery

The plan's Phase 0c assumed the grouping engine needed new work (range-bucketed Number,
day/week/month/year Date, boolean Checkbox, exact-value Text/URL/Person). It didn't —
`services/db/query/grouping.py` already supported all of it, built for task-13/15 long
before this UI-parity plan existed. `GROUPABLE_PROPERTY_TYPES` (frontend) was just never
widened past `select`/`status`/`multi_select` to match. Fixed by widening it to mirror
the backend's real support (everything except `grouping._NOT_GROUPABLE` and `formula`,
deferred to M8) and adding `defaultGroupBySpec`/`defaultGroupMode` as the one place that
fills in each type's required `mode` — replacing three independent copies of
status-only mode logic in Board creation, the column header's "Group" row, and Chart's
axis builder that would otherwise 400 the moment Date/Text became pickable.

### M5 — sort panel

`SortRowsList.tsx`: drag-reorderable rows (row order is precedence) via `DragHandle`'s
`wrapper` render-prop + `DndContext`/`SortableContext` — the same whole-row-transform
fix `PropertyVisibilityPanel.tsx` already needed. Two independent per-row dropdowns
(property, direction), replacing the M3 MVP's one-combined-submenu shape.

### M4 — filter panel

New `filterAst.ts` (mirrors `ast.py`'s `FilterCondition`/`FilterGroup`, path-addressed
tree edits — no ids, matching the backend shape) and `filterOperators.ts` (hand-kept
mirror of `operators.py`'s `TYPE_OPERATORS` — no HTTP endpoint serves it, so "derive
from the backend" means keeping this file in step by hand). `FilterBuilder.tsx` is a
recursive tree editor: a lone condition ("Where …"), a group (first rule "Where", the
rest with an editable And/Or selector), nested groups indented with their own
conjunction + footer, per-type value editors dispatched off `FilterOperator.argType`.

**Resolved, not deferred, both of filter-panel.md's flagged AST questions:** our Date
family has no `between` operator and no generic "relative to today" builder, so the UI
offers our real 14 date operators, not Notion's captured 9 — which also means
`FilterCondition.value` never needs two values. The sub-property (start/end) question
has no answer: the compiler has no concept of it, so a date filter always targets the
property's single instant.

Wired into the toolbar (rule-count label, same pattern as Sort), the settings sidebar,
a column header's "Filter" row (M1, disabled since it shipped — now applies a default
filter on that column, replacing whatever existed), and a new `QueryBar.tsx` (the
persistent bar under the toolbar: sort chip(s), then filter chip, then "+ Filter" — a
synthesis of sort-panel.md's and filter-panel.md's two separate captures, disclosed as
such, since neither shows both chips at once). `DatabaseShell` gained
`queueFilterUpdate`, the same serialized-per-view-id queue `sorts` already has.

### M6 — group panel + grouped Table rendering

`GroupBuilder.tsx`: property picker (Files excluded outright, matching the capture;
everything else disabled-with-a-reason if ungroupable), stage-2 editor (Group by,
Sort — group ORDERING, distinct from row Sort, Manual/Alphabetical/Reverse alphabetical
— Hide empty groups, a Groups section with drag-reorder + per-group eye toggle + "Hide
all", Remove grouping, Learn about grouping). Three new UI-only `GroupBySpec` fields
(`group_order`, `group_order_manual`, `hidden_groups`) live on the SAME config object
group-panel.md's capture calls for — caught before it shipped: the backend's
`GroupBySpec` is a plain dataclass that 400s on any unknown kwarg, so
`backendGroupBySpec()` is now the one required stop between `config.group_by` and
`POST .../query`, and `getQueryExtras`'s new `table` branch (Table now sends
`group_by`, matching Board, but never `sub_group_by` — no sub-group control exists in
Table) routes through it.

`TableView.tsx` renders real grouped tables when `groups` is populated: one
`<table>` per visible group (each repeating the full column header), a collapse
toggle, the option's own coloured chip as the group header (or "No `<Property>`" for
the implicit empty bucket — a UI-only rename of the backend's "No value"), a per-group
"+ New page" (pre-fills the new row's grouped property when unambiguous — select/
status/multi_select/checkbox/exact-text; skipped for Number/Date buckets, which value
inside the bucket is genuinely ambiguous), and "+ New group" (creates a new select
option — offered only for select/status/multi_select, matching the capture).

### A second jsdom/testing-library environment quirk, found and worked around

`userEvent.click`/`waitFor` (not `fireEvent.click`, not a manual microtask flush) hang
indefinitely — not slow, unresolved past a 30s wall-clock kill — the moment two or more
grouped `<table>` sections exist as DOM siblings and either any click or any pending
promise inside one is awaited through them. Reproduced down to two minimal sibling
`<table>` elements with no other TableView machinery involved; `fireEvent.click` and a
manual `await Promise.resolve()` loop resolve the identical state update correctly and
instantly. Same class of jsdom-only artifact as the DndContext+Popover hang M5's own
session found (documented in `SortRowsList.test.tsx`) — not a real component bug, but
unverified beyond jsdom. `TableView.test.tsx`'s M6 describe block documents the
workaround inline; the live Chrome checklist is this surface's real cross-check.

### Also found: a Radix `asChild` trigger-prop-forwarding bug, twice

A custom component used as a `Popover` `trigger` that only destructures its own props
(no `forwardRef`, no `...rest` spread) silently drops the `onClick`/`aria-*` props
Radix's `Slot` injects when cloning it — the popover renders identically but never
opens, no error, no visual difference. Hit once in `SortRowsList.tsx`'s
`DropdownButton` (M5) and again in `FilterBuilder.tsx`'s `TriggerButton` (M4) before
the fix (forwardRef + spread `...rest`) became habitual for the rest of the session.
Caught both times by the component's own test suite, before either shipped broken.

---

## Session artifacts

| Artifact | Status |
|---|---|
| `README.md` | written |
| `PROGRESS.md` | written |
| `SCREENSHOT-CHECKLIST.md` | written — 101 shots (87 P1 / 14 P2), §0 fixture + §1–§17 |
| `docs/superpowers/specs/2026-08-28-notion-databases-ui-parity-design.md` | written except §5 tokens (all TBD until screenshots) |
| `docs/plans/2026-08-28-notion-databases-ui-parity.md` | structure written; per-milestone task lists pending their specs |

## Surface specs

| # | Spec | Status | Raw DOM | Screenshots read |
|---|---|---|---|---|
| 1 | `table-column-header.md` | **written** (Keyboard TBD) | `table-column-header-menu.txt` | 02, 05, 70, 71 |
| 2 | `property-create-edit.md` | **written** (Select/Status option editors TBD) | `property-type-picker.txt`, `relation-config-panel.txt` | 10, 12a, 12b, 13, 13b |
| 3 | `view-options-panel.md` | **written** (Keyboard TBD) | `view-settings-sidebar.txt`, `layout-and-open-pages-in.txt` | 18, 20, 21, 22 |
| 4 | `filter-panel.md` | **written** (Keyboard TBD) | `filter-entry.txt` | 24, 30, 31 |
| 5 | `sort-panel.md` | **written** (Keyboard TBD) | `group-and-sort-panels.txt` | 32, 32b, 33, 34 |
| 6 | `group-panel.md` | **written** (Keyboard TBD) | `group-and-sort-panels.txt` | 36, 37, 37b |
| 7 | `view-tab-bar.md` | **written** (Keyboard TBD) | `view-tab-bar.txt` | 44, 44b, 44c, 46, 46b |
| 8 | `database-header.md` | **written** (blocked on B2) | `database-header.txt`, `create-database-picker.txt`, `database-page-menu.txt` | 50, 51, 52, 53, 54 |
| 9 | `row-affordances.md` | **written** (Keyboard TBD) | `row-affordances-and-menu.txt` | 57, 58, 60 |
| 10 | `row-peek.md` | **written** (centre peek TBD) | `row-peek.txt` | 62, 64, 65 |
| 11 | `calculations-row.md` | **written** (footer hover, Percent, other types TBD) | `calculations.txt` | 70, 70b, 70c, 71, 72 |
| 12 | `new-row-button.md` | **written** (templates-present state TBD) | `new-button-and-context-menus.txt` | 74 |
| 13 | ~~`context-menus.md`~~ | **REMOVED** — no distinct context menus exist; folded into §1 and §9 as extra triggers | `new-button-and-context-menus.txt` | 77, 78 |
| 14 | `table-drag-resize.md` | **written** (reorder drags TBD) | `resize-and-states.txt` | 79, 80 |
| 15 | `cell-editing.md` | **written** (Select, Status, Date; 7 types TBD) | `cell-editing.txt` | 85a-d, 87, 88 |
| 16 | `states.md` | **written** (loading/error/empty-group TBD) | `resize-and-states.txt`, `empty-database-toolbar.txt` | 94 |

---

## Blocked on the user

- [x] **Notion tab** — done. `app.notion.com` (note: `notion.so` redirects there).
- [x] **`computer` permission** — granted mid-session, so real clicks/keys/screenshots work
      and the screenshots no longer have to be taken by hand.
- [x] **Light mode** — user authorised the theme switch; `Ctrl+Shift+L` toggles it.
      **RESTORED TO DARK 2026-08-29** at the end of the autonomous capture session, as
      found. Flip it back to light with `Ctrl+Shift+L` before resuming capture — every
      light-mode screenshot in `screenshots/` was taken that way, and token values must
      come from light.
- [ ] **Fixture database** — user created an empty "New database" and authorised me to
      build the §0 fixture into it. Not built yet. Needed for: §1 (header menus vary by
      property type), §15 (cell editing per type), and the per-type config panels in §2.
      Consider trimming §0's 21 properties to the ~12 that actually change a menu.
      **UPDATE 2026-08-29:** built 11 properties into the user's "New database"
      (Name, Text, Number, Select, Multi-select, Status, Date, Person, Checkbox,
      URL, Files) plus one row "Row one". Enough for every capture so far.
      Still missing: Formula, Relation, Rollup, Created time; option values on
      Select/Status; more rows; a second view; a template.

---

## Baseline (branch health before any implementation)

- `npx tsc --noEmit` — **clean** (exit 0), 2026-08-29.
- `npm run test` — **clean** (exit 0): 41 files, 575 tests passed, 83s. 2026-08-29.

## Decisions taken (2026-08-31)

| Decision | Choice | Effect on the plan |
|---|---|---|
| Property types (26 vs our 11) | **Adopt the 11 backend-supported natives** | New **M2b**; picker ships 22 types |
| Grouping (10 types vs our 3) | **Add engine support first** | New **Phase 0c** — backend grouping engine, before M6 |
| Calculate sub-panel placement | **M1 ships it** | M11 reduced to the footer row |

Plus one gap found while reconciling: **Phase 0b needs a fourth endpoint (B5)** —
`PropertyUpdate` must accept `type`, or M1's `Change type` row is dead from the first
milestone.

## Remaining TBDs, ranked

Everything below is marked `TBD` inside a written spec. None blocks starting Phase 0.

**Blocks a specific milestone if not closed first**
1. §15 — cell editors for Text, Number, Multi-select, Person, Files, URL, Checkbox.
   **Select, Status and Date are captured.** The three captured differ from each other in
   placeholder copy, option rendering, create-on-type and footer rows, so the rest must be
   captured rather than inferred. **Blocks M11.**
2. §4 — filter operator lists for Checkbox, Number, Person, Files, Multi-select, Status,
   URL. **Text (8), Date (9) and Select (4) are now captured**, which was enough to
   establish the derive-from-TYPE_OPERATORS rule and surface two AST questions. The
   remaining seven are lower risk. **Partially unblocks M4.**
3. §14 — the column-drag and row-drag drop indicators. **Blocks part of M11.**

**Wanted but not blocking**
4. §11 — the footer's hover "Calculate" affordance; the `Percent` branch; Checkbox/Date
   branches.
5. §16 — the loading state, the error state, a visible empty group.
6. §10 — centre peek (`pm=c`); whether prev/next row navigation exists at all.
7. §2 — the Select/Status option editors, Date format, Formula, Rollup config panels.
8. §8 — whether the inline `/database` slash command opens the same data-source picker.
9. Keyboard behaviour on every surface except the column header menu.
10. Several **observed-but-unexplained** disabled states — collected in `states.md`.

## Fixture state (in the user's Notion, database "New database")

Built by me, with the user's authorisation, 2026-08-29:
- **11 properties**: Name (title), Text, Number, Select, Multi-select, Status, Date,
  Person, Checkbox, URL, Files
- **1 row**: "Row one", all values empty
- **2 views**: `Table` and `Board` (Board auto-grouped by Status)
- **1 Select option**: `Alpha`, created via create-on-type, applied to Row one
- **1 calculation**: `Sum` on the Number column, so the footer row renders
- **TYPES CORRECTED 2026-08-31.** Four properties had been created with the wrong type
  during the build (Status was Select, Person was Status, Checkbox and URL were both
  Person; Date was Select). All fixed via Change type and verified by reading the header
  type icons. The fixture is now honestly typed.
- **Still missing** for full §0 coverage: Formula, Relation, Rollup, Created time;
  more rows; a row template

## Log

- **2026-09-01 (0c + M4–M6)** — Built the plan's next batch in one session: Phase 0c
  turned out to be already-done engine work, needing only the frontend wiring
  (`GROUPABLE_PROPERTY_TYPES` widened, `defaultGroupBySpec`/`defaultGroupMode` added);
  M5 (drag-reorderable sort rows), M4 (the full filter builder — AST tree, per-type
  operators, wired into toolbar/sidebar/column header/a new query bar), and M6 (the
  group panel plus real grouped Table rendering) all built end to end. Found and fixed
  two real defects along the way, both novel to this batch: a Radix `asChild`
  trigger-prop-forwarding bug (hit twice, in `SortRowsList.tsx` and
  `FilterBuilder.tsx`) and a debounce timer that fired on mount, not just on keystroke.
  Also found and worked around a second jsdom/testing-library environment quirk
  (`userEvent`/`waitFor` hanging against sibling grouped `<table>` elements — confirmed
  via `fireEvent` that the actual component behaviour is correct), documented the same
  way M5's DndContext+Popover hang already is. Frontend 805 tests green, `tsc` clean,
  backend untouched (0c needed none). Full write-up: this file's own "Phase 0c / M4 /
  M5 / M6" section above. **Live Chrome checklist + the user's visual diff, and a
  review checkpoint over this batch, are both still outstanding** — next up per the
  plan.
- **2026-09-01 (review checkpoint)** — Ran the plan's first review checkpoint
  (M1, M2, M2b, M3) via `/code-review high` over the whole branch diff,
  scoped to the database UI code. 10 candidate findings, each verified
  against the actual code before acting: 9 real and fixed (a hidden-column
  filter that had quietly become the ONE list every non-rendering lookup
  read too — breaking sub-item nesting, Button target resolution, and the
  rollup-source picker whenever their property happened to be hidden; a
  `sorts` staleness race matching `patchViewConfig`'s own bug one field
  over, now that M3 gave `sorts` three writers instead of one; `SidePeek`
  silently violating its own "non-modal, stays open" contract via a Radix
  default it never overrode, which in turn unmasked a stale-`draft` bug in
  the view rename field; two rename-field consistency gaps; one dead-key
  duplication). One (an option-rename desyncing a free-text cell's stored
  color) verified real but deliberately left for `cell-editing.md`'s own
  milestone rather than patched piecemeal. Full write-up:
  `docs/ui-specs/REVIEW-LOG.md`. Frontend 729 tests green, `tsc` clean.
- **2026-09-01** — Built M3 (the view settings sidebar) end to end and ran its
  checklist live in Chrome. Two real defects found and fixed: `MenuList`'s
  push stack was snapshotting resolved panels rather than re-deriving them
  from live `root`, so a pushed panel (Property visibility) didn't reflect
  its own drag-reorder until popped and re-pushed — fixed at the primitive
  level, benefiting every push-mode consumer; and the toolbar's Sort button
  displayed a property's raw key instead of its name. Also closed the M1
  dead-control gap: `TableView.tsx` now actually reads
  `hidden_properties`/`property_order`, which M1's header menu had been
  writing since it shipped. Frontend 724 tests green, `tsc` clean, backend
  untouched. Next up per the plan: a review checkpoint over M1–M3 + M2b.
- **2026-08-31 (second autonomous session)** — 13 more captures, 2 more specs (M7, and
  M1/M9/M3/M4 extended). Confirmed live: view creation is create-first-configure-after;
  Delete view is state-dependent on view count; the row context menu is the row menu with
  a third trigger (so §13 shrank); calculations are settable from the header menu, and
  Number's branches match `_NUMERIC_AGGREGATORS` exactly; cell editing is two-stage
  (select, then edit) where ours is one-stage; Select cells offer create-on-type with a
  coloured chip preview. Three self-corrections recorded rather than edited away: the
  bulk bar shows labels not icons; the header affordances ARE hover-revealed; and the
  a11y tree reports elements that are not visible, so hover states need screenshots.
  Theme restored to dark at the end.
- **2026-08-29 (autonomous session)** — Captured 13 surfaces live and wrote 4 specs.
  Screenshots: 24. Raw DOM captures: 9. See the log entries and git history.
  Key corrections to the plan and design doc, all committed with their evidence:
  view settings is a docked 483px sidebar not a popover; Filter/Sort are top-level
  toolbar buttons; sub-panels flyout from popovers but push from the sidebar; menus nest
  3 levels and flip mid-chain; the type picker is a 2-column grid with a separate hidden
  search; creating a database opens a data-source picker; the peek is URL-addressable and
  non-modal; the column header menu has no keyboard navigation at all; Notion groups by
  any property type where we support 3.
- **2026-08-29** — Wrote the implementation plan's structure: 12 milestones + Phase 0
  (primitives) + Phase 0b (three backend endpoints), three review checkpoints, and the
  per-milestone definition of done whose gate is the user's visual diff. Per-milestone task
  lists are deliberately absent — they cite spec rows.
- **2026-08-29** — Wrote the primitive-layer design doc. Decided: 3 Radix packages
  (popover, dialog, tooltip); `-dropdown-menu` rejected because Notion's menus are ARIA
  comboboxes, not menus, and its roving focus/typeahead fight the search input; Mantine
  rejected despite being installed. §5 token table is written but every value is TBD.
- **2026-08-29** — Wrote `SCREENSHOT-CHECKLIST.md`: §0 builds a `Parity Fixture` database
  with one property of every type, 8 rows with deliberate empty cells, sub-items,
  dependencies, 3 views and a template; §1–§17 are 101 numbered shots grouped by
  milestone, so §0–§3 (23 shots) alone unblocks M1–M3.
- **2026-08-29** — Branched from `feat/workspaces-compact-redesign` @ 25a08b4. Wrote
  `README.md` and this file. Surface inventory complete: 16 in-scope surfaces, 9 view
  types plus 8 sub-editors deferred to the later phase.
