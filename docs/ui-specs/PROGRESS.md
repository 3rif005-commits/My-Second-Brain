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
- **`?view=` deep links: written since M7, read on load since 2026-09-02** —
  `DatabaseShell` now parses `?view=` on mount (this file's own Log entry,
  "M7 create-flow rewrite") and writes it on every switch, not just Copy
  link to view.

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

## M7 / M8 / M9 — COMPLETE (2026-09-01)

| Milestone | State |
|---|---|
| M7 — view tab bar's per-view menu | **visual-diffed live 2026-09-01** — 1 defect fixed |
| M8 — database header (title/icon/description), gated on B2 | **visual-diffed live 2026-09-01** |
| M9 — row hover affordances + open-as | **visual-diffed live 2026-09-01** |

**Frontend 812 → 823 tests green** across the three milestones (59 → 62 files). `npx tsc --noEmit`
clean after each. Backend untouched — B1/B2 were already built in Phase 0b; nothing else needed a
backend change. Built in one session, back to back, per the user's own budget-first instructions
for this run: **no subagents, no `/code-review`, live-Chrome checklist deferred** (same deferral
class as the 0c/M4-M6 session already recorded above) — commits per milestone, tsc+vitest as the
gate instead.

### M7 — view tab bar

New `ViewTabMenu.tsx` (`buildViewTabMenu`) + wiring in `ViewTabs.tsx`: clicking the ACTIVE tab now
opens its own menu (Rename → inline tab edit, Display as → per-user `localStorage` pref kept
deliberately out of shared `view.config`, Edit view → opens the M3 sidebar, Source →
informational, Copy link to view, Duplicate view, Delete view gated on `views.length > 1` and
wired to B1's `DELETE /db/views/{id}`, already built and previously unused). "Add view to
sidebar" is omitted outright (no per-view sidebar entries exist), matching the spec's own
hidden-not-disabled instruction for a genuinely inapplicable row.

**Deferred at the time, since closed (2026-09-02):** the "+ New view" trigger kept its existing
native-`<select>` creation form instead of the spec's 4-column create-first card grid — this
session's own budget-first call. Built for real in the 2026-09-02 session (this file's own Log
entry, "M7 create-flow rewrite") once the user asked for it directly. `useDatabaseView` gained
`deleteView`/`updateDatabase`/`deleteDatabase`, mirroring `updateView`'s existing shape.

### M8 — database header

New `DatabaseHeader.tsx` (title always-editable in place, icon assigns a random emoji immediately
on "Add icon" then opens the picker to refine — same create-first spirit as M7 — description is a
hover-revealed toggle) and `DatabasePageMenu.tsx` (the page-level `⋯`: Copy link, Lock database,
Move to Trash). Both gated on Phase 0b's B2, already built and previously uncalled.

**Deliberately scoped down, both files say so in their own top comment:**
- The creation flow (full-viewport data-source picker with LIVE mini-previews of existing
  sources) is **not built** — the spec itself flags the previews as "a real build cost, flag
  before committing," and Sidebar's existing "New database" → empty table path already covers
  the one card that matters functionally (`Empty database`).
- Cover is not built at all (spec's own call — no upload pipeline).
- The `⋯` menu ships only Copy link / Lock database / Move to Trash — every other captured row
  (Export, Merge with CSV, Duplicate, Customize layout, …) already has a home in the existing
  gear-icon `DatabaseSettingsMenu` or is explicitly out of scope in the spec; duplicating those
  into a second menu would be a second copy to drift, not new capability.

### M9 — row hover affordances

New `RowGutter.tsx` (the `+`/drag-handle/checkbox gutter, reserved-space hover-revealed, added as
a leading `<td>`/`<th>` across all three of `TableView.tsx`'s row-render sites — grouped, sub-item
tree, flat) and `RowMenu.tsx` (`buildRowMenu`: Add to Favorites — wired for real against
`notes.is_favorited` — Open in → New tab / Side peek, Copy link, Move to Trash — all wired; Edit
icon / Edit property / Comment / Duplicate disabled-with-a-reason, each a real, named gap rather
than a silent placeholder). `OpenNoteButton` gained an optional `isOpen` prop so TableView's own
usage renders the spec's labelled "OPEN"/"CLOSE" toggle while every other caller (Board/Gallery)
keeps its pre-M9 icon-only rendering unchanged. Bulk selection (checkbox per row, a floating
count + trash + clear bar) is real; the header select-all checkbox, the overflow `⋯`, shift-click
range selection and the per-property-type bulk-edit icons are the spec's own captured-but-TBD
parts and were not built.

**Two gaps found in the "row-affordances is UI-only" assumption, matching M8's own creation-modal
discovery — both disclosed via `disabledReason`, not silently half-wired:**
- **Edit icon** needs `notes.icon` on the rows query, which `DatabaseRow` doesn't carry — wiring
  the write with nothing to render the result back as would look broken, not shipped.
- **Duplicate** needs a new backend endpoint (gap **B4** — copying a row's page body isn't
  possible client-side) that was never part of Phase 0b's four. Left disabled and named, same as
  M1 already established for other genuine-gap rows (e.g. the header menu's `Filter` row before
  M4 existed).

**Real drag-reorder is out of scope here, on purpose, not an oversight.** The plan's own milestone
table gives row-drag mechanics to **M11** (`table-drag-resize.md`), and there is no row-position
storage anywhere in this schema regardless (`view.config` has no such field, unlike
`sorts`/`filter`/`group_by`). The drag handle here is a plain button carrying only "click opens
the menu and selects the row" — the gesture the spec itself calls "the most easily-missed detail
on this surface" — not a `dnd-kit` `useSortable` handle.

### Review checkpoint (M7-M11) — also deferred

Per the plan, a review checkpoint covers M7-M11 together, once M10/M11 exist. Not started — M10/
M11 aren't built yet. Resume point: **M10 (row peek internals) is next** per the plan's milestone
table, unstarted.

---

## M10 — COMPLETE (2026-09-01)

| Milestone | State |
|---|---|
| M10 — row peek internals | **visual-diffed live 2026-09-01** |

**Frontend 832 → 846 tests green** (61 → 61 files — no new test file; RowPeek.test.tsx,
TableView.test.tsx and AddPropertyPopover.tsx itself grew instead). `npx tsc --noEmit` clean.
`npm run build` (a full production build, not just `tsc`) run once this milestone specifically to
settle the `useSearchParams`-without-Suspense question below — clean, no warnings. Backend
untouched — row-peek.md's whole surface is a frontend routing/rendering change, confirmed before
relying on that (see below), same discipline M7-M9 already established for their own "no backend
change" assumptions.

### Verified before assuming scope, per this session's own instructions

- **The URL sync IS frontend-only, but not free** — `?p=<noteId>&pm=s|c` needed
  `useSearchParams`/`usePathname`/`router.replace`, none of which TableView.tsx used before.
  Checked concretely (not assumed) whether this breaks the OTHER place `TableView` renders —
  inline inside a note via `DatabaseBlock.tsx`'s `InlineDatabaseTable`, on `/brain/[noteId]`, a
  **Server Component** page with no `<Suspense>` around `NoteEditorPage` (unlike
  `/brain/db/[databaseId]/page.tsx`, which already wraps `DatabaseShell` in `Suspense` for this
  exact class of reason). Ran a real `npm run build` (not just `tsc`) to settle it rather than
  guessing — clean, no Suspense-boundary warning anywhere in the output. `DatabaseBlock.test.tsx`
  also mocks `TableView` out entirely, so it never exercised this at the unit level either.
- **The peek's own `⋯` menu had nothing to reuse.** row-peek.md's own instruction was "the ⋯ menu
  reuses whatever our note page already has" — checked `NoteEditorPage.tsx` directly: no page-level
  menu exists there at all. Shipped disabled-with-a-reason, same convention M8/M9 already
  established for a real, named gap, not silently omitted or half-built.

### What M10 built

- **URL sync**, owned by `TableView.tsx` (not `RowPeek.tsx`, which stays presentational —
  row/mode in, `onClose` out, unchanged shape): `peekRowId`/`peekMode` are local state seeded from
  `useSearchParams()` at mount (a lazy initializer — a genuine reload/shared-link restores the
  same row in the same mode) and written via `router.replace` on every open/close, preserving
  every other param (`?view=` included). Deliberately **not** fully URL-driven (no reactive
  re-sync on browser back/forward while mounted) — disclosed, same TBD class as `?view=`'s own
  still-write-only status (M3).
- **Forced side peek, actually forced.** Before M10, the row menu's "Open in → Side peek" and the
  row's own `onOpenSidePeek` both routed through the SAME `openRow` the plain OPEN button used —
  so a view whose "Open pages in" default was `center` or `full` silently overrode the menu's own
  explicit choice. `openRow(noteId, forcedMode?)` now takes an optional force; the row menu and a
  new `Alt+Click` handler (bound on every row's `<tr>`, checking `e.altKey` so a plain click is
  untouched) both pass `"side"`, bypassing the view default entirely, per row-peek.md's Trigger
  table.
- **OPEN/CLOSE actually toggles.** Before M10, clicking CLOSE (the label OpenNoteButton already
  showed while its row's peek was open, since M9) fired the identical `onOpen` handler as OPEN —
  re-opening the same row instead of closing it. `toggleRow` now checks `peekRowId` first.
- **Alphabetical property ordering** (`otherProperties.sort` by `name`, not `position`) — a
  scan surface, not a reorder surface, per the spec's own Notion-uses-both-orderings-deliberately
  note.
- **The literal "Empty" placeholder** for a genuinely unset value, refined per the 9
  `PropertyValue` wrapper types (title/rich_text/number/select/status/multi_select/date/url/
  email/phone_number — checkbox is deliberately excluded, `false` is a real value, never an
  absence of one). Types outside that union (files, people, relation, formula, rollup, unique_id,
  button, created/last-edited time/by) are left alone, not silently reinterpreted. Clicking
  "Empty" hands off to the real `renderCellValue` control for that property — which may itself
  have its own separate click-to-edit affordance (e.g. `TextCell`'s own "—"), unchanged by this.
- **The `»/⤢/Share/★/⋯` header bar**, replacing the old plain-text "Open as full page"/"Open in
  Workspace" pair. `»` closes (same accessible name "Close" the row's own toggle now also
  carries — tests disambiguate via `within(table)`), `⤢` expands to the full page (same
  navigation "Open as full page" used to do). `★` favorites, reusing M9's own
  fire-and-forget-only pattern (`DatabaseRow` still has no `is_favorited` to read a real
  toggle state back from). Share and `⋯` are disabled-with-a-reason. "Open in Workspace" has no
  Notion equivalent at all and stays as an explicit additive control, not a parity gap.
- **`+ Add a property`**, reusing `AddPropertyPopover` rather than a second copy — it gained
  `columns` (1 for the peek, 2 unchanged for the table header — "one shared copy string" per the
  spec, only the grid width differs by host), `scopeNote` (renders `EditPropertyPanel.tsx`'s own
  now-exported `SCOPE_NOTE`, so the disclaimer text has one source), and `triggerLabel` (a
  full-width text row instead of the header's bare "+" icon). Suppressed for a read-only source or
  when no `dataSourceId` was threaded through (`TableView`'s own, same value the table header's
  own popover already used) — same States-table rule as the table's own version.

### Deferred, tracked

- Centre-peek's own capture is `TBD` in the spec itself — unaffected by this milestone,
  `mode="center"` already existed pre-M10 (M3) and is untouched.
- Prev/next row navigation — spec's own `TBD`, "not observed" in the capture.
- Keyboard beyond Escape (already worked pre-M10) and `Alt+Click` — `Ctrl+⇧+↵` "opens in a new
  tab" is exposed only as the row menu's hint text, not bound as a real shortcut, matching every
  other surface's keyboard TBD status per PROGRESS.md's own ranked list.
- Row-deleted-while-open — spec's own `TBD`.
- Comments section / page body below the properties — spec's own `TBD`; the peek already embeds
  `BlockEditor` for the body, unchanged.

---

## M11 — COMPLETE (2026-09-01)

| Milestone | State |
|---|---|
| M11 — calculations footer, always-visible New-row chevron, column resize, Select/Status cell editors, the two captured empty states | **visual-diffed live 2026-09-01** (partial — see below), 2 defects fixed |

**Frontend 846 → 872 tests green** (61 → 61 files — no new test file; existing files grew).
`npx tsc --noEmit` clean after every sub-piece. Backend untouched — all five sub-pieces are
frontend-only (calculations-row.md/new-row-button.md/table-drag-resize.md/cell-editing.md/
states.md all confirm "no backend change" or reuse endpoints Phase 0b/M1 already built).
Built as five separately-tested, separately-committed sub-pieces per the session's own
instruction that M11 was "the big one" — cheaper to review and safer if budget ran out
mid-milestone.

### M11 (1/5) — calculations footer row

`getQueryExtras`'s table branch now sends one `AggregationSpec` per column with a
`config.calculations` entry (M1 already wrote this; nothing had read it) — keyed by the
column's own property key, and **never** alongside `group_by` (a grouped query computes
PER-GROUP aggregates the footer doesn't render this milestone, disclosed below). TableView
renders the resulting `aggregates` as a right-aligned `LABEL value` `tfoot` row;
`calculationLabel` (`ColumnHeaderMenu.tsx`) reuses M1's own menu label strings uppercased,
not a second copy.

### M11 (2/5) — always-visible New-row chevron, new-row title focus

**User decision, 2026-09-01** (the spec's own explicitly-flagged IA question): the `+ New ▾`
split button's chevron is now unconditional, matching Notion's own IA — the dropdown is the
entry point for *authoring* a template, not merely picking one — rather than staying hidden
until a template already exists (the pre-M11 behaviour). Its empty state (`Templates for
<name>` header + `?` icon + the captured description + `+ New template`) opens the existing
`TemplateManager` modal, a second mount of the same component/handlers
`DatabaseSettingsMenu.tsx`'s "Manage templates" already uses — not a second template-CRUD
implementation. Also fixed a real, spec-named gap: "Focus the new row's title cell after
creation" — `handleAddRow`/`handleAddRowToGroup` now capture the created row's id, and
`TitleCell` gained an `autoEdit` prop (threaded through `renderCellValue`'s existing
optional-arg convention) so the new row mounts straight into inline edit, caret placed.

### M11 (3/5) — column resize

Per-view column widths (`view.config.column_widths`, JSONB pass-through — table-drag-
resize.md's own "not a schema-level field" reasoning), a drag grip on each header border,
live reflow, exactly one `PATCH` per drag (fired on `columnSizingInfo.isResizingColumn`'s
`false` transition, not per mouse-move). `columnSizing` itself stays **uncontrolled**
(TanStack's own default) — a controlled first attempt broke, because `columnResizeMode:
"onChange"`'s live-drag math mutates a variable as a side effect inside the very
`setColumnSizingInfo` updater React queues for the same render pass, and a synchronous
caller-supplied `onColumnSizingChange` observes it before React has actually run that
updater. The fix instead only imperatively re-seeds `columnSizing`
(`table.setColumnSizing(persistedWidths)`) when the view's own persisted widths change
under it — this `TableView` instance is reused across a database's own table views, not
remounted on a tab switch.

**Column/row drag-REORDER stay unbuilt** — table-drag-resize.md's own "not captured by
dragging a header" / "not captured" TBDs. The Property visibility panel's own drag-reorder
(M3) already covers column order through a captured path; there is still no row-position
field anywhere in this schema (M9 already established this).

### M11 (4/5) — Select create-on-type, Status's real editor

cell-editing.md's own words: create-on-type is "the single biggest cell-editing gap."
`SelectCell` now opens a `Popover`+`MenuList` panel in place of the cell (the same
trigger-is-the-input pattern `AddPropertyPopover.tsx` already established), listing
matching options plus a `Create [x]` row; Enter creates the option
(`PATCH /api/db/properties/{id}`, sequenced before assigning, per the spec's own
persistence note), assigns it, and closes — one keystroke. Falls back to the pre-M11
bare-input editor for any caller that doesn't supply `onCreateOption` (`RowPeek`,
Board/Gallery/List/Feed — none of them were threaded through, a disclosed scope-down, not
an oversight).

`StatusCell` gets the four differences cell-editing.md calls out from Select's own editor:
options grouped under `To-do`/`In progress`/`Complete` section headers, a coloured **dot**
instead of a filled chip, **no** create-on-type (options are managed on the property only),
and different placeholder copy (`"Search for an option"`, no ellipsis). **The `Edit
property` footer row stays unbuilt** — reaching it from a cell would need
`EditPropertyPanel`'s panel-building function threaded all the way through
`renderCellValue`, judged disproportionate to what was left of this milestone's budget.

**A real, novel bug found and fixed along the way, not specific to Select/Status:** the
"trigger swaps between a `<button>` and an `<input>` depending on state" pattern this
codebase's Popover-based editors already used (`AddPropertyPopover.tsx` included) has a
latent race — Radix's non-modal `onInteractOutside` check
(`context.triggerRef.current?.contains(target)`) can catch the newly-mounted, newly-
`autoFocus`ed input in a stale-ref window (the swap unmounts/remounts the DOM node the ref
tracks) and dismiss the popover before a single keystroke lands. Never manifested in
`AddPropertyPopover`'s own tests because its trigger-input flow was never exercised with
`user.type()` while its own MenuList panel was simultaneously open below it. Fixed here by
wrapping the trigger in one stable element instead of swapping its type; `AddPropertyPopover`
itself was left alone (out of scope for this milestone, its own tests are green, and the bug
is latent rather than currently manifesting there).

### M11 (5/5) — the two captured empty states

states.md: a brand-new, unfiltered, empty database now renders the table **normally**
(header row + the `+ New` row) with **no** `No rows yet.` message — "the empty state IS the
affordance to fill it." A filter matching nothing is a *different*, separate state: the
entire flat table disappears (headers, footer, the `+New` row) for two centred buttons,
`Edit filters` (opens the same `filterPanel()` the toolbar's own filter chip already uses)
and `+ New page` — no text message, matching the capture's own "two buttons, no text."

**Deliberately not touched:** the grouped-view case (states.md's own "an empty group" TBD,
not captured), the "`+ New page` clears/matches the active filter" behaviour (checklist's
own "capture Notion's behaviour first" — the row is created, but the filter itself is
neither cleared nor auto-matched), and loading/error states (both explicitly `TBD` in the
spec — "do not guess"). The empty-filter-state's `+ New page` button is present-but-
disabled (not absent) for a read-only source, a minor deviation from states.md's own
"New split button: Suppress" table entry — accepted given how rare "All Notes, filtered,
zero results" is in practice.

### Deferred across all of M11, ranked by what's missing

1. **Cell editors for Text, Number, Multi-select, Person, Files, URL, Checkbox, and Date's
   fuller calendar** — cell-editing.md's own "assume each type differs until captured";
   these seven (plus Date's End-date toggle/Clear/Today/calendar-grid richness) have zero or
   partial capture. Only Select and Status were fully specified.
2. **The two-stage click-to-select-then-edit interaction model** — "the single biggest
   *behavioural* difference," per the spec's own words, left entirely unbuilt: several of
   its own details (the corner-circle's behaviour, arrow-key cell navigation, whether Enter
   opens a selected cell) are themselves `TBD`, and retrofitting it would touch every cell
   component's click handling at once.
3. Column/row drag-reorder (table-drag-resize.md) — both `TBD`, "capture before
   implementing."
4. Status's `Edit property` footer row, and the "+ New page" filter-interaction semantics.
5. Grouped-view empty states and loading/error states — all explicitly `TBD` for Notion's
   own behaviour.

---

## M12 — the other nine views

| Milestone | State |
|---|---|
| M12 — List | **row hover affordances built, unit-tested, and fully live-verified incl. the blur-race fix (2026-09-02)** |
| M12 — row peek (Feed, Board, Gallery, Calendar, Timeline) | **wired to every remaining view, unit-tested, and live-verified against all five (2026-09-02)** |
| M12 — Feed | **DONE (2026-09-02): row hover affordances (top-right "···" menu) and center-peek default built, unit-tested, and live-verified; byline/comments deliberately deferred (missing prerequisites, user's own call)** |
| M12 — Open pages in defaults (Gallery, Calendar) | **DONE (2026-09-02): both now default to Center peek at creation, matching real Notion, live-verified; checked systematically across every view type, not just Feed** |
| M12 — Gallery's own dedicated work (card preview source, card size/fit — beyond the peek-default fix above), Chart/Form/Dashboard/Board/Calendar/Timeline's own dedicated per-view work | not started |

`docs/plans/2026-08-28-notion-databases-ui-parity.md`'s own "Phase 12" section now carries:
a code-verified survey of what M1-M11 already ship for free across every view type (view
tab bar, database header, toolbar, Filter/Sort panels — data effect included, not just UI —
and cell editing, all confirmed working for Board/Gallery/etc. already, by reading the
actual code rather than re-guessing the 2026-08-28 sizing table), what's partially wired
(Property visibility's hide/reorder, Group panel's data effect), and what's genuinely
Table-specific and still needs real per-view work (row hover affordances, row peek, the
calculations footer, column resize). Decided order: List → Feed → Gallery → Chart → Form →
Dashboard → Board → Calendar → Timeline (smallest-first, per the prompt's own instruction
to prove the pattern transfers cheaply before the two L-sized views).

**List's row-affordances live capture done (2026-09-02).** Confirmed against a real List
view added to the fixture database: the left gutter's `+`/drag-handle transfer unchanged,
but List has no checkbox (bulk-select mechanism `TBD`), no separate `OPEN` button (the
whole row is itself the open-trigger — a plain click opens the side peek via the same
`p=`/`pm=s` URL shape Table already uses), and one genuinely new per-row affordance with
no Table equivalent: an "Edit" pencil button that turns the title inline-editable and
reveals the row's other visible properties as quick-fill prompts. The row menu itself
(triggered by the drag handle or right-click) is byte-identical to Table's. Full capture:
`row-affordances.md`'s new "List view (M12)" section, `raw-dom/row-affordances-list-view.txt`,
5 screenshots in `screenshots/list-row-*.jpg`. Fixture grew by one row and one view (see
"Fixture state" above). **No code changes yet** — this was capture only. Resume point:
build List's row hover affordances (RowGutter without a checkbox, no OPEN button since the
row link already handles it, the new Edit-toggle inline-property affordance) against
`ListView.tsx`, wire `hidden_properties`/`property_order` the same way Table already reads
them, then live-checklist and write up, same discipline as every milestone before it.

**List built (2026-09-02).** `ListView.tsx` rebuilt on the capture above: `RowGutter` gained
a `showCheckbox` prop (`false` for List), the row peek's URL-sync logic was extracted out of
`TableView.tsx` into a new shared `lib/database/useRowPeek.ts` hook (every future M12 view
reuses this instead of a fourth copy), and `hidden_properties`/`property_order` are now read
via the same `viewConfig.ts` helpers Table uses. The title-inline-edit-plus-revealed-
properties "Edit" toggle is genuinely new UI, built from scratch. One real bug found live and
fixed: the title input's own blur closed the whole editing row before a click to one of the
revealed properties could land (the same "trigger swaps mid-interaction" race class M11 hit
twice) — fixed by moving the exit-edit decision to the row's own blur, checking
`relatedTarget` stayed inside. Full write-up: `row-affordances.md`'s new "Built" subsection.
Frontend 61 files / 916 tests green (was 905), `tsc` clean.

**Live verification incomplete — environment exhaustion, not a code concern.** Confirmed
live before the bug was found: resting state, hover (gutter + Edit, no layout shift), Edit
toggle, the row menu (identical to Table's), `Open in → Side peek`, plain-click-opens-peek
via `?p=&pm=s`. The automation session then ran out of memory (`free -h`: 590MB free,
3.4/3.7GB swap — confirmed, not guessed, same class this workstream has hit before) partway
through re-verifying the blur-race FIX; freeing several stale Chrome renderer processes
didn't reconnect the extension, and a full Chrome restart (the known fix) was left for the
user rather than done unilaterally, since it closes their open tabs. The fix itself has two
new jsdom regression tests reproducing the exact blur/`relatedTarget` sequence, not just an
assertion it "should" work.

**Live verification completed (2026-09-02), after the user approved a Chrome restart.**
Killing stale renderer processes freed memory but didn't reconnect the extension; the user
was asked directly and approved a full restart, which did. Re-verified live: List's
blur-race fix (clicking "Status: —" right after Edit opens the dropdown without the row
collapsing). Then, since the fixture had no date property, added a "Due Date" property and
set it on the fixture's one row, and live-verified the row-peek wiring on all five remaining
views: Board and Gallery (created via the AddViewGrid, clicked each card's OPEN button),
Calendar and Timeline (clicked OPEN on the Sep 2 event bar), and Feed (clicked the card
title). All six views write the identical `&p=<rowId>&pm=s` URL and open the same non-modal
side peek. Full write-up: `row-affordances.md`'s "Row peek rolled out to every remaining
view" section. The browser environment kept hitting intermittent memory-pressure freezes
throughout (many background renderer processes survived from the restored session); routed
around each one with reload/retry rather than restarting again, per the user's explicit
choice when asked. **List and the cross-cutting row-peek wiring are now fully done, live
and unit-tested. Resume point: Feed's own dedicated row-hover-affordance capture** (next in
the decided build order — needs its own live Notion capture, since Feed's card shape
differs from List's row shape).

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
- **2 rows**: "Row one" (all values empty), "Row two" (added 2026-09-02 for M12's List
  capture — also all values empty)
- **3 views**: `Table`, `Board` (Board auto-grouped by Status), `List` (added 2026-09-02
  for M12's row-affordances capture, `row-affordances.md`'s new "List view" section)
- **1 Select option**: `Alpha`, created via create-on-type, applied to Row one
- **1 calculation**: `Sum` on the Number column, so the footer row renders
- **TYPES CORRECTED 2026-08-31.** Four properties had been created with the wrong type
  during the build (Status was Select, Person was Status, Checkbox and URL were both
  Person; Date was Select). All fixed via Change type and verified by reading the header
  type icons. The fixture is now honestly typed.
- **Still missing** for full §0 coverage: Formula, Relation, Rollup, Created time;
  more rows; a row template

## Log

- **2026-09-02 (M12 — "Open pages in" defaults checked across every view type; Gallery
  and Calendar fixed)** — After Feed's own capture turned up a real default (Center peek,
  not Side), checked every OTHER creatable view type's own fresh "Open pages in" setting
  live rather than assuming Feed was a one-off: Table/Board/List/Timeline all read Side
  peek (matching this app's existing global fallback already); Gallery and Calendar BOTH
  also read Center peek, the same as Feed. Genuinely per-type — not a "date views default
  center" pattern (Calendar and Timeline diverge from each other) or a "card-grid views
  default center" pattern (Board and Gallery diverge from each other). Fixed the same way
  as Feed: `DatabaseShell.tsx`'s `handleCreateView` now sets `open_pages_in: "center"` for
  fresh Gallery and Calendar views too; Calendar's branch merges this into the SAME
  `updateView` call as its existing date-property auto-select (one write, not two).
  Live-verified: a fresh Gallery view's OPEN button writes `&pm=c`; a fresh Calendar view
  (auto-date-select still working) does too. Three new `DatabaseShell.test.tsx` tests
  (Gallery's write, Calendar's single merged write, a Timeline regression proving its own
  branch stayed untouched). Frontend 928 tests green (was 925), `tsc` clean. Full write-up:
  `row-affordances.md`'s "Open pages in defaults" section (has the full per-type table).
  Environment note: mid-session the whole dev stack (not just Chrome) hit severe memory
  exhaustion — the frontend dev server itself crashed and needed `./app.sh start` to
  recover, and the backend's own `/api/db/databases` route intermittently 401'd under load
  (confirmed in backend logs, not guessed). Flagged to the user, who chose to keep
  retrying rather than pause; verification completed successfully once memory pressure
  eased. **Resume point: Gallery's own dedicated per-view work** (card preview source —
  real Notion lets you pick a property as the cover image, this app only ever uses the
  row's fixed `cover_image_url` — plus card size/fit, both need their own live capture).
- **2026-09-02 (M12 — Feed's own real-Notion capture, build, and live verification)** —
  Live Notion has a genuine, distinct native "Feed" view type (resolving the plan's own
  open question — "if Notion's real Feed even has one"), but its actual shape is a
  social/activity-feed post (avatar + editor name + relative timestamp, title, an
  always-visible "Add a comment…" box, 0 visible properties by default, hover reveals only
  a reaction icon + "···" row-menu top-right, no left gutter/checkbox, and — the one
  genuinely load-bearing default difference from every other view built so far — a plain
  title click opens a CENTER peek, not side), not the Gallery-card-shaped grid our own
  `FeedView.tsx` had. Two real prerequisite gaps block full parity: the author byline needs
  `last_edited_by`/`people`, already deliberately held back elsewhere pending a user-name
  lookup (`AddPropertyPopover.tsx`'s own comment, not a new discovery); the comment
  composer needs a comments feature that doesn't exist anywhere in this app's backend
  (checked this session). Put to the user rather than guessed: **build the rest of Feed's
  real shape, skip the byline and comments.** Built: `RowMenuTrigger.tsx` (new — the
  favorite/copyLink/moveToTrash handlers + Popover/MenuList wiring pulled out of
  `RowGutter.tsx`, which now delegates to it, so Feed's differently-positioned trigger
  reuses the same menu instead of a second copy); `FeedView.tsx`'s card gained a
  hover-revealed top-right "···" trigger (no left gutter, no checkbox); `DatabaseShell.tsx`
  writes `open_pages_in: "center"` into a fresh Feed view's config at creation time, the
  same pattern as Board's auto-group-by/Calendar's auto-date-property, rather than teaching
  the shared `useRowPeek` hook about view types. Live-verified: hovering reveals only the
  "···" trigger, clicking it opens the identical row menu, and a fresh Feed view's title
  click writes `&pm=c` (confirmed against the real Notion default). Also fixed a pre-existing
  `tsc` error in `GalleryView.test.tsx` (unrelated to this build — a `status`/`number` pair
  spread onto the wrong level of a test fixture) while getting back to a clean baseline.
  Frontend 925 tests green (was 922), `tsc` clean. Full write-up:
  `row-affordances.md`'s "Feed view — real Notion capture" and "Feed built" sections.
  **Resume point: Gallery's own dedicated per-view work** (card preview source, card size,
  fit-image — next in the decided build order, needs its own live-Notion capture first).
- **2026-09-02 (M12 — List's post-fix behavior and all five remaining views' row peek,
  live-verified)** — Picked up the two "not yet live-verified" resume points below after
  the user approved a full Chrome restart (killing stale renderer processes alone hadn't
  reconnected the extension). Re-verified List's blur-race fix live: clicking "Status: —"
  right after clicking Edit now opens the dropdown without the row collapsing, confirming
  the fix from the entry below. Then, since the "Untitled Database" fixture had no date
  property (blocking Calendar/Timeline), added a "Due Date" property and set it on the
  fixture's one row. With that, live-verified the row-peek wiring on all five remaining
  views from the entry below: Board and Gallery (created via the AddViewGrid, clicked
  each card's OPEN button), Calendar and Timeline (created a dedicated view for each,
  clicked OPEN on the Sep 2 event bar — Timeline's own view also confirmed the M7
  create-flow's date-property auto-select works end to end), and Feed (created a
  dedicated view, clicked the card title, since Feed has no separate Open button). All six
  write the identical `&p=<rowId>&pm=s` URL, open the same non-modal side peek, and flip
  their trigger to "CLOSE" while open. The browser environment kept hitting intermittent
  memory-pressure freezes throughout the session (many renderer processes survived from
  the restored Chrome session) — routed around each with reload/retry rather than
  restarting Chrome again, per the user's explicit choice when asked mid-session. No code
  changes this pass — verification only. Full write-up: `row-affordances.md`'s "Row peek
  rolled out to every remaining view" section. **Resume point: Feed's own dedicated
  row-hover-affordance capture** (next in the decided build order — Feed's card shape
  differs from List's row shape, so this needs its own live Notion capture before any
  code, per this workstream's "no invented numbers" rule).
- **2026-09-02 (M12 — List built)** — Built List's row hover affordances from the
  session's own live capture (below): `RowGutter` gained a `showCheckbox` prop (List's
  own gutter has no checkbox), the row peek's `?p=`/`?pm=` URL-sync logic was pulled out
  of `TableView.tsx` into a new shared `lib/database/useRowPeek.ts` hook (every future
  M12 view reuses it instead of a fourth copy — Table's own behavior is unchanged, it
  just delegates now via nothing, TableView itself was left as-is to avoid risking a
  regression in already-working, heavily-tested code, only NEW views were pointed at the
  hook), `hidden_properties`/`property_order` now read through the same `viewConfig.ts`
  helpers Table uses (a real silent-no-op gap this view had, confirmed by the M12 code
  survey), and a genuinely new "Edit" toggle (inline title edit + reveals other visible
  properties as quick-fill chips) built from scratch — no Table equivalent existed to
  reuse. One real bug found live and fixed: the title input's own blur closed the whole
  editing row (unmounting the revealed properties with it) before a click meant for one
  of them could land — the identical "trigger swaps mid-interaction, dismiss logic wins
  the race" class M11's cell-editing session already hit twice. Fixed by moving the
  exit-edit decision to the ROW's own blur (checking `e.relatedTarget` stayed inside),
  covered by two new jsdom tests reproducing the exact event sequence rather than just
  asserting it "should" work. Live-verified before the bug was found: resting state,
  hover, the Edit toggle, the row menu, `Open in → Side peek`, plain-click-opens-peek.
  **Not re-verified live after the fix** — the automation session ran out of memory
  mid-verification (`free -h` confirmed: 590MB free, 3.4/3.7GB swap, the same class of
  exhaustion several prior sessions here have hit); freeing stale Chrome renderer
  processes didn't reconnect the extension, and a full Chrome restart (the known fix)
  was left for the user rather than done unilaterally, since it would close their open
  tabs. Full write-up: `row-affordances.md`'s new "Built" subsection. Frontend 61 files
  / 916 tests green (was 905), `tsc` clean. Resume point: re-verify the post-fix
  behavior live once the browser environment recovers, then move to Feed.
- **2026-09-02 (M12 — row peek wired to every remaining view)** — Continued past List
  while the browser environment stayed down (see above): Feed's card title now opens the
  peek instead of a bare `useOpenNote` navigation, and Board/Gallery/Calendar/Timeline's
  own existing `OpenNoteButton` controls (M9's own `onOpen`/`isOpen` props, built for
  exactly this and never used by any caller but Table until now) all now pass
  `onOpen={openRow}` from the same shared `useRowPeek` hook List's own build extracted.
  This closes a gap the M12 code survey itself flagged ("only TableView.tsx imports
  RowPeek... every other view opens a row via full navigation only") across every
  remaining view type in one pass — deliberately scoped to ONLY the peek trigger
  (something already fully specified by M10, capture-independent): no new hover-affordance
  UI was invented for Feed/Board/Gallery/Calendar/Timeline, since none of that has a live
  capture yet and this workstream doesn't guess shapes. `hidden_properties`/
  `property_order` were left untouched on Gallery (its own deliberate title-hiding
  difference) and on Board/Calendar/Timeline (unconfirmed whether they read Property
  Visibility at all — a question for their own in-order M12 passes, not this one). Five
  view test files updated (each view's own "navigates to workspace" test replaced with a
  "writes `?p=&pm=s`" one, matching List/Table's own pattern) plus two new tests
  (Calendar/Timeline's own Open-button peek assertions — Board/Gallery/Feed's existing
  navigation tests were adapted in place, not additionally covered). Full write-up:
  `row-affordances.md`'s new "Row peek rolled out to every remaining view" section.
  **Not live-verified** — same environment-exhaustion reason as List's own fix above; the
  Chrome extension never reconnected this session despite repeated attempts. Frontend 61
  files / 919 tests green (was 916), `tsc` clean. Resume point: live-verify all of this
  (List's post-fix behavior AND the new peek wiring) once the browser recovers, then
  proceed with Feed's own dedicated row-hover-affordance capture (its card shape turned
  out to be Gallery-like, not List-like, contradicting the original plan's "Same [as
  List]" sizing note — confirm live before building anything there).
- **2026-09-02 (M12 — Board/Gallery's own Property Visibility gap, found while wiring the
  peek)** — Noticed while touching `BoardCard`/`GalleryCard` for the row-peek fix above:
  both cards computed their own "other properties" list locally, sorted by schema
  `position`, never reading `config.property_order` — and Board never read
  `hidden_properties` at all. The identical "Property Visibility panel writes a key,
  nothing reads it" class Table's own `orderedProperties` already had once, before M3's
  review checkpoint fixed it (Checkpoint 1, finding 1). Fixed by computing the
  hidden/ordered list ONCE per view (via `viewConfig.ts`'s `orderProperties`/
  `getHiddenKeys`, the same helpers List's own build already uses) and passing it down as
  a precomputed `otherProps` prop, rather than each card re-deriving its own — every card
  now agrees on the same order/visibility instead of each computing it independently.
  Gallery's own deliberate difference (its `hidden_properties` may include the title key,
  hiding it) was left untouched; only its missing `property_order` support was added.
  Two new regression tests (`BoardView.test.tsx`, `GalleryView.test.tsx`). Full write-up:
  `row-affordances.md`'s same "Row peek rolled out to every remaining view" section (a
  second, closely-related fix noted inline, not a separate section). **Not live-verified**
  — same reason as everything else this session past List's own live capture. Frontend 61
  files / 921 tests green (was 919), `tsc` clean.
- **2026-09-02 (M12 — List row-affordances live capture)** — Started M12's first real
  build unit (List, per the decided smallest-first order) with a live-Notion capture,
  per this workstream's own "raw evidence before prose" rule — `row-affordances.md`'s
  existing capture is Table-grid-shaped and had never been confirmed to transfer. Added
  a throwaway List view to the fixture database (plus a second row, "Row two", to have
  something to hover/select) and captured its row-hover behaviour directly: opened the
  accessibility tree and cross-checked with `javascript_tool` DOM queries rather than
  trusting screenshots alone, since this row's hover-tied controls didn't reliably
  survive a `zoom` capture (mouse-position state, not a real bug). Four confirmed deltas
  vs Table: no checkbox in the gutter (bulk-select mechanism unconfirmed), no separate
  `OPEN` button (the whole row is itself a real `<a>` — a plain click opens the side peek
  via the identical `p=`/`pm=s` URL shape Table already uses, confirmed by inspecting the
  URL before/after), a new "Edit" pencil affordance with no Table equivalent (turns the
  title inline-editable and reveals other visible properties as quick-fill prompts — List's
  one-line layout has nowhere to show untitled properties at rest the way a Table cell
  can), and a byte-identical row menu (confirmed row-for-row against the drag handle
  click AND right-click, including the `Open in` flyout). Full write-up:
  `row-affordances.md`'s new "List view (M12)" section, `raw-dom/row-affordances-list-view.txt`,
  5 screenshots (`screenshots/list-row-*.jpg`). **Findings and fixture growth only — no
  application code changed.** Resume point: build List's own row hover affordances against
  `ListView.tsx` from this capture, then live-checklist.
- **2026-09-02 (M12 task breakdown, Part 2 of the same prompt)** — Wrote the task
  breakdown the plan's own Phase 12 section had been missing since 2026-08-29. First
  read the actual code (not the 2026-08-28 sizing table's own guesses) to establish
  which M1-M11 surfaces are already view-type-agnostic: confirmed, by grepping every
  file `DatabaseShell.tsx` renders ABOVE its `activeView.type` switch, that the view
  tab bar, database header, toolbar, and — the one non-obvious finding — Filter and
  Sort panels' actual DATA effect (`getQueryExtras`/`loadRows` apply `filter`/`sorts`
  unconditionally for every view type, only `group_by`/`aggregations` branch on type)
  and cell editing (every view already renders through the same `renderCellValue`
  dispatcher Table uses) all already work for Board/Gallery/Calendar/etc. today, zero
  further work needed. Also found two partially-wired gaps by grep (Property
  visibility's hide toggle works for Gallery/Feed but not Board/Calendar/Timeline/
  List; nothing but Table reads `property_order` for reorder) and confirmed which
  surfaces are genuinely Table-rendering-specific (row hover affordances/M9, row
  peek/M10, the calculations footer, column resize — none has any equivalent
  anywhere else). Decided and wrote down the execution order: List → Feed → Gallery
  → Chart → Form → Dashboard → Board → Calendar → Timeline (smallest-first). Full
  write-up in the plan doc's own expanded Phase 12 section. **Findings-only, no code
  changes** — the plan doc and this file are the only diffs. Resume point: start
  List's own live-Notion capture for row hover affordances (its existing capture,
  `row-affordances.md`, is table-grid-shaped — not yet confirmed to transfer to a
  List row) before building anything.
- **2026-09-02 (M7 create-flow rewrite: view create/edit/delete parity, Part 1 of the
  next prompt)** — The user reported real problems with view create/edit/delete; asked
  directly what they'd seen rather than assuming M7's own disclosed gap (the create-
  first-configure-after flow never built) was the whole story — confirmed it was that
  plus a request to re-verify rename/duplicate/delete hadn't regressed. Replaced
  `ViewTabs.tsx`'s native-`<select>` name/type/group-by creation form with a real
  create-first-configure-after popover (`AddViewGrid`: 4-column, 10-card icon grid, Map
  excluded) — one click creates every type immediately except Chart, a disclosed
  exception (no post-creation surface exists yet to set its axes, matching M12's own
  "Chart config panel already dense" sizing note). `DatabaseShell.handleCreateView` now
  auto-selects Board's group-by and Calendar/Timeline's date property from an existing
  eligible property, opens the M3 settings sidebar afterward either way. Both of the
  spec's own open questions closed by testing against real Notion, not guessed: Notion
  DOES auto-create a Status property when none exists (confirmed live) — surfaced as a
  genuine product decision via `AskUserQuestion` rather than decided alone (this
  workstream's own established precedent), user chose to KEEP this app's refusal to
  auto-invent one; and an empty-string name does fall back to the type as the tab label
  (confirmed live, `viewTabLabel` already handled it). Also built: `?view=<viewId>` now
  read on load and written on every switch (previously write-only since M7, mirroring
  `TableView.tsx`'s own `?p=`/`?pm=` pattern), and a real inline date-property picker in
  `CalendarView.tsx`/`TimelineView.tsx`'s own placeholder — a genuine gap this rewrite
  would otherwise have introduced (removing the pre-creation gate left no other way to
  ever set `date_property_id` post-creation). One real bug found and fixed along the
  way: Chart's own settings-sidebar-open silently never fired — a same-tick race between
  its follow-up popover closing and the sidebar opening, the identical class M7's own
  "Edit view" no-op bug already was, fixed the same way (a one-tick defer) plus
  correcting `handleCreateChart`'s close-before-create ordering to match every other
  type. Caught by a new test, not the live-Chrome pass (real wall-clock pacing between
  manual actions happened to avoid the race there). Rename/Duplicate/Delete re-verified
  live against the current branch tip, fresh (not reused fixtures) — all three still
  work correctly, no regression. Full write-up: `REVIEW-LOG.md`'s new "view-tab-bar.md,
  M7 create-flow rewrite" section. Frontend 61 files / 905 tests green (was 893), `tsc`
  clean. **Part 2 (M12: apply the pattern to the other nine view types) is not started —
  no task breakdown written yet, per the prompt's own instruction that this is the next
  session's first job.**
- **2026-09-02 (M6 checklist steps 16/17/19)** — Closed out `group-panel.md`'s last
  three unverified checklist steps. Step 17 (Status grouping, mode='option')
  confirmed working. Step 16 (`+ New group`) has a real, disclosed-not-fixed gap:
  the new option IS created on the property, but doesn't appear in the panel's
  Groups list, because the grouping engine's own bucketing (`grouping.py`) only
  ever groups by values ACTUALLY PRESENT on a row, with no concept of a property's
  configured-but-unused options — fixing this would mean changing the grouping
  engine's own data model, out of scope for this UI-wiring workstream (the same
  boundary Phase 0c already drew once). Step 19 (two rapid group changes both
  persisting) exposed and fixed a real, confirmed bug: `GroupStageTwo.patchGroupBy`
  built its next `group_by` by spreading the render-time `groupBy` PROP, so two
  writes fired close together (`Hide all` then toggling `Hide empty groups`)
  silently dropped whichever one's PATCH resolved first — the exact "second write
  clobbers the first" class Checkpoint 1 already fixed once for `sorts`, now
  recurring for `group_by`'s own sub-fields. Fixed with a new `GroupByUpdater`
  type and `queueGroupByUpdate` (mirroring `SortsUpdater`/`queueSortsUpdate`,
  sharing `patchViewConfig`'s own refs so it stays serialized against other config
  writes too), threaded through every `group_by` writer. Re-verified live: the
  identical repro now persists both fields correctly. Full write-up:
  `REVIEW-LOG.md`'s new "group-panel.md, M6 steps 16/17/19" section. Frontend 61
  files / 893 tests green (was 892), `tsc` clean. This closes out every item this
  workstream's own M4/M5/M6 checklist review has ever flagged as unverified.
- **2026-09-02 (M6 group-order checklist steps)** — Closed out `group-panel.md`'s
  last unverified checklist steps (11-13: the group-order popover, `Alphabetical`
  re-sort, manual drag-reorder's persistence), against the same fixture database.
  `computer` click actions were unreliable again (same memory-pressure class as the
  entries below); direct DOM interaction via `javascript_tool` worked reliably and
  is now this environment's established fallback. Confirmed: the group-order
  popover's exact row set, `Alphabetical` correctly re-sorting the Groups list
  lexically in both panel and table, and (since the literal drag gesture isn't
  reliably simulable here, a documented limitation from every prior session in this
  file) a directly-PATCHed manual order surviving a full reload in the table, the
  panel, and the `Sort` row's own label. One real but minor, deliberately-undecided
  gap found and disclosed, not fixed: drag handles stay fully live (not "inert or
  hidden" as the spec's own checklist asserts) while sorted Alphabetical/Reverse —
  not silently harmful (dragging just switches back to Manual with the dropped
  order) and the spec's own wording is ambiguous about which of "inert"/"hidden"
  Notion actually does, so left as a named gap rather than guessed at. Full
  write-up: `REVIEW-LOG.md`'s new "group-panel.md, M6 group-order steps" section.
  No code changes this session — findings-only. This closes out every item this
  workstream's own M4/M5/M6 checklist review had left unverified.
- **2026-09-02 (M4/M5/M6 live Chrome checklist, completed)** — Resumed the partial
  run below after the automation environment's memory exhaustion was cleared (at the
  user's direction: killed ~15 accumulated Chrome renderer processes, which also
  killed the `claude-in-chrome` extension's own background process and required a
  full Chrome restart before it reconnected). Completed `filter-panel.md` steps
  5-18, `sort-panel.md` steps 2-13, and `group-panel.md` steps 1-10/14/15/18 live.
  Found and fixed two more real, live-only-visible defects: (1) a Checkbox or
  Verification filter condition's value editor shows a real option selected
  ("Unchecked"/"None") from the moment it's created, but a `<select>` only fires
  `onChange` on an actual change, so that default was never written — reproduced by
  building `Done equals <shown Unchecked> OR Count equals 5` and getting only 1 row
  back (the Count match) instead of the expected 3-row union, since the Checkbox
  condition's `value` was genuinely absent. Fixed with `defaultValueForOperator`
  (filterOperators.ts), wired into every place a condition's operator gets set. (2)
  `defaultGroupBySpec` never set `hide_empty_groups`, defaulting it OFF — but
  `group-panel.md`'s own capture is explicit that Notion defaults it ON; grouping by
  `Kind` left an empty `No Kind` bucket visible in the table when it should have
  been hidden from the first click. Fixed by adding `hide_empty_groups: true` to
  the spec every "first group by this property" entry point builds. Along the way,
  traced an apparent third failure (an incomplete-looking Or repro) to a genuine
  fixture-data gap from an earlier interrupted batch-PATCH loop, not a product bug
  — SQL's `NULL = false` correctly evaluates to not-true. Full write-up:
  `REVIEW-LOG.md`'s new "Live Chrome checklist run" section (continued). Frontend
  61 files / 892 tests green (was 888), `tsc` clean. This closes out the M4/M5/M6
  live-checklist item that Checkpoint 3's own review had left as a resume point —
  no further live verification outstanding for this batch.
- **2026-09-02 (M4 live Chrome checklist, partial)** — Followed up on the review
  checkpoint below by actually running `filter-panel.md`'s checklist live, against a
  fresh throwaway fixture database (Title/Count/Kind-select/Done-checkbox/Due-date/
  Status, 4 rows). Found and fixed a second real, live-only-visible defect:
  `defaultOperatorFor` (filterAst.ts) picked the first entry in a type's operator
  list unconditionally, defaulting a fresh Text/Title filter to `equals` — but
  `filter-panel.md`'s own capture is explicit that Notion defaults a text filter to
  `Contains`. Live-reproduced: picking `Title` and typing `Article` against two rows
  titled "Article one"/"Article two" matched **zero** rows instead of narrowing,
  since `equals "Article"` never matches either title. Fixed with an explicit
  `Contains`-first override for the five text-shaped types; every other type's
  default stays list-order (the spec's own `TBD` for those). Three tests had
  enshrined the wrong default (`filterAst.test.ts`, `FilterBuilder.test.tsx`,
  `ViewToolbar.test.tsx`) and were corrected. Also confirmed live: the toolbar
  Filter/Sort popovers render on-screen correctly in a real browser (closing the
  M4-M6-VISUAL-DIFF.md open question, since `3b4a079` already fixed the underlying
  bug), and the prior entry's `sanitizeFilterForQuery` fix works live (an
  incomplete column-header filter came back `200`, not a silent `400`). **Not
  completed**: the rest of `filter-panel.md`'s checklist (steps 10-20) plus all of
  `sort-panel.md`/`group-panel.md` — the automation session became memory-
  constrained partway through (confirmed via `free -h`, not guessed: <650MB free,
  ~3GB/3.7GB swap) and stopped opening ANY toolbar popover (Filter and Sort both,
  confirmed via the accessibility tree, not screenshots), ruling out a regression
  from the fix itself. Full write-up: `REVIEW-LOG.md`'s new "Live Chrome checklist
  run — filter-panel.md, M4" section. Frontend 61 files / 888 tests green (was
  887), `tsc` clean. Resume point: re-run the remaining M4/M5/M6 checklist steps
  live in a less memory-constrained session.
- **2026-09-01 (Phase 0c/M4/M5/M6 review checkpoint, run for real)** — The plan's own
  review checkpoint for this batch had been explicitly deferred (see the log entry
  below, "a `/code-review high` attempt... hit the account's rate limit"). Run this
  time as a manual read-through (no subagents, no `/code-review high`/`max`), per this
  workstream's own working rules and the same style Checkpoint 2 (M7-M11) already
  used successfully — scoped to the code the four milestones actually touched
  (`filterAst.ts`/`filterOperators.ts`/`GroupBuilder.tsx`/`SortRowsList.tsx`/
  `QueryBar.tsx`/`FilterBuilder.tsx` plus the wiring in `DatabaseShell.tsx`/
  `ColumnHeaderMenu.tsx`/`ViewSettingsSidebar.tsx`/`ViewToolbar.tsx`/`ChartView.tsx`/
  `TableView.tsx`/`types.ts`). One real, reachable, silently-broken defect found and
  fixed: `view.filter` is written straight from `FilterBuilder.tsx` on every edit (no
  separate draft state), so two ordinary mid-edit states — "+ Add advanced filter"'s
  intentionally-empty group, and picking a property before its value is typed — are
  syntactically incomplete by the backend's own contract (`ast.py`'s
  `Field(min_length=1)`, `operators.py`'s `coerce_value` rejecting a missing value).
  The write itself succeeds (`PATCH /db/views/{id}` never validates `filter`), but the
  very next `POST .../query` 400s on it, and `useDatabaseView`'s own error surfacing
  only renders while `!database` — so once the database has loaded, rows/groups just
  silently stop updating with no toast, no banner, nothing. `M4-M6-VISUAL-DIFF.md`'s
  own live run likely hit this without noticing (it typed a filter value fast enough
  after picking a property that the momentary 400 self-corrected before anyone
  looked). Fixed with a new `sanitizeFilterForQuery` (`filterAst.ts`), run inside
  `useDatabaseView.loadRows` before the filter ever reaches the query endpoint —
  strips incomplete conditions/empty groups from the COMPILED request only, leaving
  what's persisted (and what the builder shows for editing) untouched. Also
  cross-checked, and confirmed correct (no drift): `filterOperators.ts`'s
  `TYPE_OPERATORS` against the backend's `operators.py` `_FAMILIES` table, byte for
  byte; `types.ts`'s widened `GROUPABLE_PROPERTY_TYPES` (17 types) against
  `grouping.py`'s real support (`REGISTRY` minus `_NOT_GROUPABLE` minus `formula`).
  Full write-up: `REVIEW-LOG.md`'s "Checkpoint 3". Frontend 61 files / 887 tests green
  (was 877; +10 regression tests), `tsc` clean. This closes out the last open item
  from the 0c/M4-M6 batch — the milestone table above can now read the review
  checkpoint as done, not deferred.

- **2026-09-01 (M7-M11 live visual-diff, fourth addendum — close-out)** — Two final
  items from the outstanding list. First, a correction: the earlier-recorded
  "calculations footer doesn't update live without reload" finding was re-tested more
  carefully (toggling Sum → Average → None, checking the DOM immediately after each
  change and again ~2s later) and turned out to be this session's own testing outrunning
  a normal two-request async chain (`PATCH` the config, then `POST .../query` for the
  refetched aggregate) — not a bug. `M7-M11-VISUAL-DIFF.md` corrected in place rather
  than left standing. Second, PATCH-failure rollback+toast (`cell-editing.md`'s own
  step 15) — not induced live, but confirmed in code: `useDatabaseView.ts`'s
  `updateCell` does exactly the required optimistic-update/rollback/toast shape. This
  closes out every item this session's own "not covered" list had flagged, except the
  column/row drag mechanics (blocked on a drag-simulation limitation in this
  automation session, not a known product issue) and read-only-source suppression
  beyond M7 (checked and fixed for the view tab bar; M8-M11's own write affordances on
  All Notes not independently re-checked).
- **2026-09-01 (M7-M11 live visual-diff, third addendum)** — Finished M7's own
  Duplicate/Delete-view checklist items. Delete worked correctly on the first try.
  Duplicate did not: the backend really did create the copy (confirmed via a direct DB
  query), but the frontend never showed the new tab until reload — `ViewTabs.tsx`'s
  `duplicateView` called `fetch()` directly instead of going through the hook's own
  `createView`/`updateView` (the only two functions that call `setViews`). Fixed by
  adding an `onCreateViewRaw` prop (the hook's bare `createView`) and routing through
  it + the existing `onUpdateView`; confirmed live twice in a row (each duplicate
  showing immediately, correctly selected, no reload) and added a regression test —
  same coverage gap class as the "Edit view" bug two addenda back. `ViewTabs.test.tsx`
  24/24, full suite 61 files / 877 tests green, `tsc` clean. Full write-up:
  `M7-M11-VISUAL-DIFF.md`.
- **2026-09-01 (M7-M11 live visual-diff, second addendum)** — Continued working
  through the items flagged as outstanding. Found and fixed one more real bug: the
  view tab bar was never actually suppressed for the read-only All Notes source
  (`view-tab-bar.md`'s own States table says "Suppress the whole bar" — only the
  toolbar's `trailing` was gated on `editable`, not `<ViewTabs>` itself, so Rename/Edit
  view/Duplicate view all rendered against a synthesized view id
  (`"all-notes-table"`) that has no real `db_views` row backing it). Fixed by wrapping
  the whole tab bar in the same `editable` gate the settings sidebar already uses;
  confirmed live, regression test added, `DatabaseShell.test.tsx` 24/24. Also verified
  live: Status cell editor matches `cell-editing.md` exactly (placeholder copy, section
  headers, no create-on-type), and confirmed (not new) that the Date cell is still a
  bare native `<input type="date">`, matching the already-recorded deferred-list gap.
  Finished `states.md`'s empty-filter-state checklist (steps 1-7) end to end now that
  the toolbar popover fix unblocked it — exact match, table disappears entirely,
  `Edit filters` + `+ New page` centred, confirmed the grouped-view case correctly
  falls through to the spec's own separate (and still-TBD) empty-group state instead.
  Full suite 61 files / 876 tests green, `tsc` clean. Full write-up:
  `M7-M11-VISUAL-DIFF.md`'s new "Second addendum" section.
- **2026-09-01 (M7-M11 live visual-diff, addendum)** — Followed up on the items the
  entry below flagged as "not covered." Root-caused what both this session and the
  earlier M4-M6 session had written off as an "automation-environment rendering
  artifact": the Filter/Sort toolbar popovers rendering hundreds of pixels off-screen.
  It was a real, reproducible bug — `ViewToolbar.tsx`'s `ToolbarButton` was missing
  `forwardRef`, the same Radix `Popover.Trigger asChild` ref-dropping bug this
  codebase had already found and fixed twice elsewhere (`SortRowsList.tsx`,
  `FilterBuilder.tsx`), confirmed via `getBoundingClientRect()`/inline-style
  inspection on the stuck popover (`transform: translate(0, -200%)`, no anchor rect to
  measure against). Fixed the same way; confirmed live for both Filter and Sort.
  `ViewToolbar.test.tsx` 8/8, full suite 61/875 green, `tsc` clean. This retroactively
  unblocks `states.md`'s empty-filter-state checklist and anything else gated on the
  Filter/Sort toolbar across M4-M6 — that gate was never real. A follow-up attempt at
  the empty-filter-state check itself was started but not finished (the filter
  builder's own narrow value-picker UI proved fiddly to drive via coordinate clicks in
  the time available) — still open for a future session. Full write-up:
  `M7-M11-VISUAL-DIFF.md`'s new "Addendum" section.
- **2026-09-01 (M7-M11 live visual-diff)** — Ran the live Chrome checklist for M7-M11
  inline in the main session, per this file's own "no subagents" rule — reused the
  existing throwaway fixture databases (`9aebda7f...` for M7's single-view case,
  `54f49606-...`, the same one M4-M6's own diff used, for everything else) rather than
  building a new fixture. Three real, reproducible defects found and fixed: (1) M7's
  tab-menu "Edit view" row silently did nothing — a same-tick race between the tab
  menu's `Popover` closing and the M3 settings `SidePeek` opening, fixed by deferring
  `onOpenSettings` one tick; (2) M11's new-row dropdown header read "Templates for
  Default" (the data source's name) instead of the database's own title — a one-line
  fix at the `DatabaseShell.tsx` call site; (3) the same dropdown never dismissed on
  outside click or Escape (it predates the shared `Popover` primitive) — fixed with a
  scoped outside-click/Escape listener. All three confirmed live before and after, with
  regression tests added for (1) and (3). One accidental stray database was created
  early in the session (clicking the sidebar's "New Database" create button, mistaken
  for a nav link) and trashed via the app's own UI once noticed. Full write-up,
  including what was NOT re-verified live (column/row resize and reorder — a drag-
  simulation limitation, not a known product issue — and the Filter/Sort toolbar
  popovers, which reproduced the exact same off-screen-render environment artifact
  M4-M6's own session already documented) in `M7-M11-VISUAL-DIFF.md`. Frontend 61
  files / 875 tests green, `tsc` clean. Review checkpoint (M7-M11 code review) was
  already run in the prior session per the entry below; not repeated here.
- **2026-09-01 (M10, M11, review checkpoint)** — Built M10 (row peek internals) and M11
  (calculations footer, always-visible New-row chevron + new-row title focus, column
  resize, Select/Status cell editors, the two captured empty states) end to end,
  M11 sub-batched into five separately-tested, separately-committed pieces per this
  session's own instructions. Then ran the plan's M7-M11 review checkpoint as a manual
  read-through (no `/code-review` at high/max/ultra, no subagents) — one real,
  reachable, silently-destructive bug found and fixed: `DatabaseHeader.tsx`'s title/
  description draft state wasn't keyed per database, so switching databases via the
  sidebar (client-side nav, no remount) could silently rename the new database to the
  old one's name on blur — the same bug class the M1-M3 checkpoint had already fixed
  once elsewhere (`ViewNameHeader`). Two real, novel bugs found and fixed along the way
  during M11 itself, not at the checkpoint: an infinite render loop in the column-resize
  effect (a fresh `{}` object literal every render when `view` was absent), and a Radix
  Popover ordering race where a controlled `columnSizing`/`onColumnSizingChange` observes
  a same-render-pass side effect before React has actually run the updater that produces
  it (column resize), and separately a trigger-element-type-swap race that let Radix's
  own non-modal dismiss logic close a cell's Select/Status editor before a single
  keystroke landed (root-caused and fixed for both cells, not patched around). One
  real, user-facing IA decision was explicitly punted to the user rather than decided
  unilaterally (new-row-button.md's own "this is the user's call, not silently
  restructured" flag) — resolved via `AskUserQuestion`: always show the New-row
  chevron, Notion's own IA. Frontend 61 files / 873 tests green (was 61/846 at M9's own
  end), `tsc` clean throughout every sub-piece. Full write-ups: this file's own "M10"
  and "M11" sections above, `REVIEW-LOG.md`'s "Checkpoint 2". Per the plan, M12 ("apply
  the pattern to the other nine views") is explicitly **not started** — it has no task
  breakdown written yet and gets its own future prompt, per the plan document's own
  words and this session's own instructions.
- **2026-09-01 (M7/M8/M9)** — Built the plan's next batch (view tab bar's per-view menu,
  database header, row hover affordances) end to end in one session, commits per
  milestone, per the user's explicit budget-first instructions: no subagents, no
  `/code-review`, live-Chrome checklist deferred. All three milestones' backend
  endpoints (B1, B2) were already built in Phase 0b and previously uncalled — verified
  against the actual router code before relying on that assumption, per the session's
  own instructions, rather than trusting the prior summary blindly. Two real scope gaps
  found and disclosed via `disabledReason` rather than silently half-wired, same class
  as M8's own creation-modal discovery: row-level Edit icon (no per-row icon on the
  rows query) and row Duplicate (needs a new endpoint, gap B4, not built this session).
  Frontend 61 files / 832 tests green (was 59/812), `tsc` clean throughout. Full
  write-up: this file's own "M7 / M8 / M9" section above. Resume point: M10 (row peek
  internals) is next per the plan's milestone table, unstarted.
- **2026-09-01 (live checklist + deferred review checkpoint)** — Ran the live Chrome
  checklist for 0c/M4/M5/M6 against a throwaway fixture database, inline (no
  subagent) — see `M4-M6-VISUAL-DIFF.md` for the 14 screenshots and findings.
  Confirmed live: 0c's widened groupable-types list, M6's grouped Table rendering
  (collapse, per-group hide, group ordering, Remove grouping — each cross-checked
  against the persisted `view.config` after the UI action), M4's filter builder
  narrowing the table live, M5's type-aware sort label and the combined query bar's
  chip order. One environment-scoped finding (not a product bug): every top-level
  toolbar Popover rendered off-screen in this automation session specifically —
  flagged as the one open question needing a real browser to answer. Applied one
  concrete perf fix that surfaced along the way (`tableData`/`peekRow` in
  `TableView.tsx` were unmemoized re-derives). **The plan's own "review checkpoint
  (0c, M4–M6)" step is explicitly DEFERRED, not done** — a `/code-review high` attempt
  this session fanned out into several parallel subagents that mostly hit the user's
  own account-level rate limit and produced only one partial, useful finding (the
  perf fix above) before failing; given real token constraints, a full review pass
  was judged not worth its cost right now and is left for a session with more budget
  to spend on it. Resume point: M7 (view tab bar) is next per the plan's milestone
  table, unstarted.
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
