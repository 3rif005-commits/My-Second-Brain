# Review log — Notion databases UI parity

Per the plan (`docs/plans/2026-08-28-notion-databases-ui-parity.md`, "Definition of
done, per milestone", step 5): a code-review pass over the accumulated diff, batched at
three checkpoints plus one whole-branch pass at the end. This complements the visual
diffs in `M1-VISUAL-DIFF.md` — that file catches affordance/shape gaps a review
structurally cannot see; this file catches correctness bugs a passing test suite and a
visual diff both miss because neither one reads the code.

Every finding here was verified by reading the actual code before being counted —
listed as CONFIRMED (real, in-scope, fixed) or DEFERRED (real, but not fixed here, with
the reason). Nothing is listed that turned out to be a false positive on inspection.

---

## Checkpoint 1 — M1, M2, M2b, M2-completion, M3 (2026-09-01)

Run via `/code-review high` over `25a08b4..HEAD` (the whole UI-parity branch to date),
scoped to `frontend/components/database`, `frontend/lib/database`,
`frontend/components/ui/primitives`. 10 candidate findings; 9 confirmed and fixed, 1
confirmed but deliberately deferred.

### Fixed

1. **`TableView.tsx`'s `orderedProperties` (hidden-filtered, M3) had become the ONE
   list every lookup read** — not just the column renderer it was built for. Hiding a
   sub-item relation's column silently disabled the entire nested row tree
   (`findSystemRelationProperty` came back `undefined`); hiding a Button property's
   configured target made it unresolvable in its own config popover
   (`ButtonPropertyConfigPopover`); hiding a relation excluded it from the
   rollup-source picker (`AddPropertyPopover`) and from the bulk relation-link
   pre-fetch. Split into `allOrderedProperties` (full schema, table order — every
   lookup) and `orderedProperties` (hidden-filtered — column rendering only).
   Regression test: hiding a sub-item relation's own column still nests correctly.

2. **`sorts` gained a second and third writer in M3** (the toolbar's Sort popover, the
   settings sidebar's Sort panel) alongside M1's column header menu — all three
   reachable in the same session now. Each computed its next array from a `sorts`
   closed over at its own last render; `sorts` is a whole-array REPLACE, not a
   mergeable object like `config`, so `patchViewConfig`'s merge trick doesn't apply —
   whichever stale array landed last would win outright regardless of request order.
   Generalized to an updater function (`SortsUpdater`, `lib/database/viewConfig.ts`)
   threaded from every sort-writing row through `DatabaseShell`'s existing per-view
   queue (`queueSortsUpdate`, sharing `pendingPatchByViewRef` with `patchViewConfig`).
   Regression test reproduces the race live: unresolved first write, second write
   queued behind it, resolve, assert both sorts survived.

3. **`SidePeek`'s `modal={!isSide}` never overrode Radix's own outside-pointerdown
   dismissal**, which fires regardless of `modal` — a separate Radix default this
   component's own "NON-MODAL BY DEFAULT" comment had missed. Side mode's whole point
   (and Notion's own copy for it, "Keeps the view behind interactive") is that
   clicking the table must not close the panel; it did. Fixed with
   `onPointerDownOutside` preventDefault in side mode only — center peek keeps the
   default backdrop-click-to-close. The existing non-modal test only asserted the
   click reached the button behind it, never that the peek survived — strengthened,
   plus a new test for center mode's own dismiss.

4. **That fix made a previously-masked bug reachable**: `ViewNameHeader`'s
   `useState(name)` only seeds its initial value. Switching view tabs without closing
   Settings — impossible before fix 3, since that click used to close the sidebar as
   a side effect of the same outside-click-dismiss bug — left `draft` holding the
   PREVIOUS view's name; any blur after that silently renamed the newly active view
   to the old one's name. Fixed with `key={view.id}`, forcing a fresh mount per view.

5. **`ViewNameHeader`'s input didn't stop `Tab` from bubbling** to `MenuList`'s own
   handler, which unconditionally closes the whole sidebar on Tab. `ColumnRenameHeader`
   and `OptionRenameHeader` already guard this, with a comment explaining why —
   `ViewNameHeader` copied the sibling pattern but missed this one line of it.

6. **`ColumnRenameHeader` (M1) was the one rename field with no trim/empty guard** —
   `OptionRenameHeader` and `ViewNameHeader` (both M2/M3) both require `name.trim()`
   before committing. Select-all + delete + blur PATCHed the property to a blank name
   with no fallback. Fixed to restore the original name on an empty blur instead.

7. **`show_page_icon` was read/written inline in `ColumnHeaderMenu.tsx`** instead of
   through `getShowPageIcon`/`patchShowPageIcon` — the exact two-entry-points-one-key
   situation those helpers' own doc comment names, with the M1 call site left on the
   pre-helper inline form. Routed through the shared helpers.

Each fix has its own commit with the full reasoning; see `git log` on
`feat/notion-databases-ui-parity` for:
`fix(db): review checkpoint (M1-M3, M2b) — three real defects, verified and fixed` and
`fix(db): review checkpoint (M1-M3, M2b) — four more verified defects, fixed`.

### Deferred, tracked (real, not fixed here)

8. **`pillStyleForOption` matches a cell's stored value against configured options by
   NAME; renaming an option desyncs any row still storing the old name from its
   color.** Confirmed real and reachable (rename a Select option → existing rows
   holding the old name silently fall back to a hashed color). Not fixed here: this is
   a direct consequence of an already-made, already-documented M2-completion decision
   — select/status/multi-select cells are free-text today (no stable id linking a
   stored value to an option), and rebuilding them as pickers (the actual fix) is
   explicitly `cell-editing.md`'s own milestone, not this one's. Fixing it piecemeal
   here would mean inventing a second, throwaway id-matching scheme for a surface
   that's getting rebuilt properly soon.

All 10 of the review's original findings are accounted for above — three of them
(the sub-item, Button-target and rollup/bulk-warm reports) shared one root cause and
one fix (item 1).

---

## Checkpoint 2 — M7, M8, M9, M10, M11 (2026-09-01)

Run per the session's own budget-first instruction: **not** `/code-review` at
`high`/`max`/`ultra` (the 0c/M4-M6 checkpoint's own attempt at that mostly hit the
account-level rate limit) and **not** a subagent (this project's own working rule).
A manual read-through instead, over `dffd372..HEAD` (`git diff --stat`: 31 files,
+3526/-291) — every file the M7-M11 batch touched or added, prioritized by size and by
which milestone's code I hadn't already had fresh eyes on this session (M7-M9's
`RowGutter.tsx`/`RowMenu.tsx`/`ViewTabMenu.tsx`/`ViewTabs.tsx`/`DatabasePageMenu.tsx`
were built in a prior session; M10/M11's own files I'd just written and had already
scrutinized while building them).

### Fixed

1. **`DatabaseHeader.tsx`'s `titleDraft`/`descriptionDraft` are `useState` INITIAL
   values, never resynced when the `database` prop changes to a DIFFERENT database —
   the exact same bug class the M1-M3 checkpoint's finding 4 already fixed once, in
   `ViewNameHeader`, for switching VIEWS rather than databases.** `Sidebar.tsx`
   navigates between databases client-side (`router.push`, no full reload;
   confirmed by reading it, not assumed), so `DatabaseShell` — and therefore
   `DatabaseHeader`, which carries no `key` — stays mounted across the switch, with
   only its props changing. Reachable and, worse than the original finding, silently
   destructive: switching from database A to B leaves the title input showing A's
   stale name over B's real data, and `commitTitle`'s own `trimmed === database.title`
   guard compares the stale draft against the WRONG (new) database — blurring without
   editing anything would `PATCH` database B's title to database A's old name.
   Fixed with `key={database.id}` on `DatabaseHeader` in `DatabaseShell.tsx`, the same
   proven fix as before. Regression test in `DatabaseShell.test.tsx` reproduces the
   switch live (mutates the mocked hook's `database`/`dataSource`/`views`, re-renders
   with a new `databaseId`, asserts the title input shows the NEW database's name) —
   which surfaced a second, smaller gap while writing it: `DatabaseShell.test.tsx`'s
   own `beforeEach` reset `properties`/`views`/`groups`/`aggregates` between tests but
   never `database`/`dataSource`/`rows`, so my own regression test's mutation leaked
   into a later, unrelated test until those three gained the same reset (now sourced
   from factory functions, not shared object literals, matching `properties`'s own
   already-established reset comment).

### Checked, not fixed (no defect found)

- `ViewTabs.tsx`'s own rename field (`renamingViewId`/`renameDraft`) does NOT have the
  same class of bug: `startRename(view)` sets `renameDraft` fresh from the CURRENT
  `view` at the moment the row is clicked, not once at mount — there is no stale-draft
  window to exploit.
- `RowGutter.tsx`, `RowMenu.tsx`, `ViewTabMenu.tsx`, `DatabasePageMenu.tsx` — all pure
  props-in, callbacks-out; no local draft state that could survive an identity change
  underneath it.
- `TableView.tsx`'s M11 additions (footer, resize, `newlyCreatedRowId`,
  `hasActiveFilter`/empty-filter-state) — read through end to end again with this
  checkpoint's own scrutiny, not just the sub-piece-by-sub-piece testing already done
  while building them. No new issues found beyond what was already caught (and fixed)
  during implementation itself (the column-resize ordering race and the
  `persistedWidths`-reference infinite-loop, both documented in their own commits).

No other candidates were raised — this was a narrower pass than Checkpoint 1's (one
finding vs. nine), consistent with M7-M11 reusing more already-reviewed primitives and
patterns than M1-M3 did while those patterns were still being established.

Frontend 873 tests green (was 872), `tsc` clean.

---

## Checkpoint 3 — Phase 0c, M4, M5, M6 (2026-09-01, deferred checkpoint run for real)

The plan's own review checkpoint for this batch (`a7e802f..dffd372`: Phase 0c's
grouping-engine wiring, M4's filter builder, M5's sort panel, M6's group panel +
grouped Table rendering) had been explicitly **deferred** — the same file's own log
records a `/code-review high` attempt that fanned into parallel subagents and mostly
hit the account's rate limit, producing only one usable finding (already applied: the
`tableData`/`peekRow` memoization). Run for real this time as a manual read-through,
same style as Checkpoint 2 — no subagents, no `/code-review high`/`max` — over
`git diff --stat a7e802f..dffd372` (24 files, +3476/-187) scoped to the code the four
milestones actually touched: `filterAst.ts`/`filterOperators.ts` (new), `FilterBuilder.tsx`/
`GroupBuilder.tsx`/`SortRowsList.tsx`/`QueryBar.tsx` (new), `ColumnHeaderMenu.tsx`,
`DatabaseShell.tsx`, `ViewSettingsSidebar.tsx`, `ViewToolbar.tsx`, `ViewTabs.tsx`,
`views/ChartView.tsx`, `views/TableView.tsx`, `types.ts`. One correction carried in per
this checkpoint's own briefing: `M4-M6-VISUAL-DIFF.md`'s "every top-level toolbar
Popover rendered off-screen" note is **not** a live-finding here — it was root-caused
and fixed in a later commit on this branch (`3b4a079`, missing `forwardRef` on
`ToolbarButton`/`Chip`), so it is not re-reported.

Every operator/type table this batch introduced was cross-checked byte-for-byte
against its backend mirror before trusting it (`filterOperators.ts`'s `TYPE_OPERATORS`
against `operators.py`'s `_FAMILIES`; `types.ts`'s widened `GROUPABLE_PROPERTY_TYPES`
against `grouping.py`'s `_NOT_GROUPABLE`/`REGISTRY`) — both matched exactly, no drift
found in either mirror.

### Fixed

1. **A filter tree can be, and routinely is, mid-edit — and this app has no separate
   "draft" for that: every `FilterBuilder.tsx` edit writes straight to `view.filter`
   via `DatabaseShell.queueFilterUpdate`'s immediate PATCH.** Two ordinary, easily
   reached mid-edit states are syntactically incomplete by the backend's own contract:
   - `FilterBuilder.tsx`'s "+ Add advanced filter" (stage 1) and "Add filter group"
     (stage 2) both write `{ type: "group", op: "and", children: [] }` **before any
     rule is ever added** — exactly what `FilterBuilder.test.tsx` already asserts
     (`"+ Add advanced filter starts an empty group builder"`, `"...nests an indented
     group"`). `ast.py`'s `FilterGroup.children` is `Field(min_length=1)`.
   - Picking a property from the stage-1 picker writes `defaultConditionFor(property)`
     immediately — a condition with the type's first operator and **no `value`** —
     before the user has typed anything into the value editor. `operators.py`'s
     `coerce_value` rejects a missing value for every `arg_type` except `"none"`.

   Neither is rejected at PATCH time — `routers/databases.py`'s `update_view` writes
   `filter`/`config`/etc. verbatim, with **no** `ast.parse_filter` call; that only runs
   inside `POST .../query`. So the write succeeds, `useDatabaseView`'s `loadRows`
   effect (keyed on `activeView.filter`) immediately re-fires the query, the backend
   400s, and the failure is **completely silent**: `loadRows().catch(e => setError(...))`
   sets the hook's `error` state, but `DatabaseShell.tsx` only ever renders it while
   `error && !database` — once the database has already loaded (true the instant this
   is reachable), the 400 has no toast, no banner, nothing. Rows/groups simply stop
   updating until the rule is completed or removed, with no indication anything broke.
   `M4-M6-VISUAL-DIFF.md`'s own live run likely hit this and didn't notice: it types a
   value fast enough after picking a property that the momentary 400 self-corrected
   before anyone looked, and its own "no console errors" check wouldn't have caught it
   either (`useDatabaseView.ts` never `console.error`s a failed query).

   Fixed with `sanitizeFilterForQuery` (new, `filterAst.ts`) — strips any condition
   whose operator needs a value it doesn't have (or an empty `str_or_list` array) and
   any group left with zero children after its own children are stripped, recursively.
   `useDatabaseView.loadRows` now runs `activeView.filter` through it (with `properties`
   in scope) before it ever reaches `POST .../query`, treating an incomplete rule as
   "not filtering yet" rather than an error. **Deliberately does not touch what's
   persisted** — `view.filter` keeps the in-progress node so the builder keeps showing
   it for editing; only the compiled request changes. Regression tests: 8 new cases in
   `filterAst.test.ts` (empty group, group whose only child is incomplete, group that
   keeps its complete children and drops its incomplete ones, a none-arg-type condition
   with no value staying intact, empty-array `str_or_list` treated as no value) plus 2
   end-to-end cases in `useDatabaseView.test.ts` asserting the actual `POST .../query`
   body sends `filter: null` for both mid-edit shapes above, not the raw persisted
   value.

### Checked, not fixed (no defect found)

- `filterOperators.ts`'s `TYPE_OPERATORS` mirrors `operators.py`'s `_FAMILIES` exactly,
  key for key, operator for operator (title/rich_text/url/email/phone_number → text;
  number/unique_id → number; select/status → the same select ops; multi_select;
  checkbox; date/created_time/last_edited_time; people/created_by/last_edited_by;
  files; relation; verification) — no drift in the hand-kept mirror.
- `types.ts`'s widened `GROUPABLE_PROPERTY_TYPES` (17 entries) is exactly
  `REGISTRY`'s 24 real type keys minus `grouping._NOT_GROUPABLE`'s 6
  (files/rollup/unique_id/verification/button/place) minus `formula` — verified by
  listing both sides, not just reading the comment's claim.
- `defaultGroupMode`/`defaultGroupBySpec` (types.ts) are the single place `status`
  (`mode: "option"`), the three date types (`mode: "month"`), and the five text types
  (`mode: "exact"`) get their required mode — checked all four call sites
  (`DatabaseShell.handleCreateView`, `ColumnHeaderMenu`'s Group row, `GroupBuilder.tsx`,
  `ChartView.buildChartViewConfig`) route through it rather than re-deriving their own
  copy; none do.
- `GroupBuilder.tsx`'s `group_by` writes go through `onPatchConfig` (a mergeable
  `config` patch), not `queueFilterUpdate`'s whole-value-replace path — a `GroupBySpec`
  is always built by `defaultGroupBySpec`/`patchGroupBy`, both of which only ever
  produce backend-legal shapes, so there is no equivalent "invalid state persisted"
  window for grouping the way there was for filtering.
- `TableView.tsx`'s `groupValueForNewRow` pre-fill values checked against their
  actual `PropertyValue` wrapper shapes (`TitleValue`/`SelectValue`/etc. in `types.ts`)
  and against the grouping
  engine's real bucket keys (`grouping.py`'s `_group_by_checkbox`'s `"true"`/`"false"`
  keys) — all correct. The text-family pre-fill (writing the group key back as the
  literal value) is only correct because `defaultGroupBySpec` always sets
  `mode: "exact"` for text types and no UI path ever sets `mode: "alphabet_prefix"`
  (group-panel.md's own noted gap) — if that mode ever becomes reachable, this
  pre-fill would need gating on it too; noted here since it isn't obvious from either
  file alone.
- `SortRowsList.tsx`/`GroupBuilder.tsx`'s drag-reorder writers (`reorderSorts`,
  `reorderGroups`) both compute their next value from `onSetSorts`/`onPatchGroupBy`'s
  own queue-latest semantics, not a render-time closure — no stale-write race.

Frontend 887 tests green (was 877 before this checkpoint's own regression tests;
+10: 8 in `filterAst.test.ts`, 2 in `useDatabaseView.test.ts`), `tsc` clean.

---

## Live Chrome checklist run — filter-panel.md, M4 (2026-09-02)

Follow-up to Checkpoint 3, run live in Chrome against a fresh throwaway fixture
database (`d0a95060-5ebc-483e-b3a2-1672e206ce8b`: Title, Count/Number, Kind/Select
with `Article`/`Note` options, Done/Checkbox, Due/Date, Status/Status with
To-do/In-progress/Complete groups; 4 rows). Working through `filter-panel.md`'s own
checklist (steps 1-9) to close out the one item Checkpoint 3 couldn't verify from
reading code alone — whether a freshly-picked filter actually narrows the table
correctly.

### Fixed

1. **A freshly-picked Text/Title filter condition defaults to the wrong operator,
   and it's not cosmetic — it silently returns zero rows instead of narrowing.**
   `filter-panel.md`'s own capture (line 84, `Where [Aa Name ▾] [Contains ▾]
   [Value]`) and its checklist step 6 are explicit that Notion's default operator
   for a fresh Text/Title pick is **Contains**. `filterAst.ts`'s
   `defaultOperatorFor` instead returned `operatorsForType(type)[0]` unconditionally
   — the first entry in `TEXT_OPS`, which is `equals` ("Is"), not `contains`.
   Caught live, not by inspection: clicking the toolbar's `Filter` button, picking
   `Title`, and typing `Article` against two rows titled "Article one"/"Article
   two" narrowed the table to **zero rows** — `equals "Article"` never matches
   either title. Root-caused via `read_network_requests`: the debounced
   `PATCH /db/views/{id}` fired exactly once (correct, unrelated to this bug) but
   the persisted condition read `operator: "equals"`.

   Fixed by giving `defaultOperatorFor` an explicit override for the five
   text-shaped types (`title`/`rich_text`/`url`/`email`/`phone_number`): `contains`
   if the type's operator list has it, falling back to `operators[0]` otherwise.
   Every other type's default is left as `operators[0]` — `filter-panel.md`'s own
   words call every other type's default `TBD`, so changing them now would be
   inventing behavior with no capture behind it, the one thing this workstream's
   own rules forbid ("no invented numbers").

   Three tests had already enshrined the wrong default (same failure class as
   M3's "Sort's raw key" and this file's own Checkpoint-1/2 rename-field findings —
   a green suite that asserts the bug is not a passing suite that's right):
   `filterAst.test.ts`'s `defaultConditionFor` test, `FilterBuilder.test.tsx`'s
   picker test, and `ViewToolbar.test.tsx`'s picker test. All three corrected to
   assert `contains`; a fourth test added to `filterAst.test.ts` confirming
   non-text types (`select`) are unaffected.

### Confirmed working, not re-litigated

- The toolbar's Filter/Sort popovers render on-screen correctly in a real (non-
  automation-viewport-limited) browser — closing the one open question
  `M4-M6-VISUAL-DIFF.md`'s own "Not verified this run" section left from the
  original 0c/M4-M6 live pass, now moot since `3b4a079` already fixed the
  underlying `forwardRef` bug on this branch.
- The Checkpoint-3 fix above (`sanitizeFilterForQuery`) confirmed live, not just
  by unit test: picking `Kind` from a column header's own `Filter` row (M4's
  `onFilter` wiring) persisted the same "operator with no value yet" mid-edit
  state my Checkpoint-3 fix targets — `POST .../query` came back **200** (rows
  unchanged, matching "not filtering yet"), not the pre-fix silent 400.
- Exactly one `PATCH /db/views/{id}` fires for the whole typed filter value (a
  debounced commit, not one per keystroke) — checklist step 8, confirmed via
  `read_network_requests`.

### Blocked, then resumed — a genuine environment limitation, not a product finding

This session's automation environment became memory-constrained partway through
(`free -h`: <650MB free RAM, ~3GB/3.7GB swap in use) — `Page.captureScreenshot`
started timing out on every call, and clicking the toolbar's `Filter`/`Sort`
buttons (confirmed via `read_page`'s accessibility tree, not screenshots) stopped
opening their popovers at all, reproducibly, across two fresh tabs, for both
buttons — ruling out a regression from the fix above and pointing at resource
exhaustion rather than the app. At the user's direction, all ~15 accumulated
Chrome renderer processes were killed to free memory (RAM: 567MB → 1.1GB free);
this also killed the `claude-in-chrome` extension's own background process,
requiring a full Chrome restart (with the user's help) before the browser
extension would reconnect. The checklist below was completed after that restart.

---

## Live Chrome checklist run — filter-panel.md / sort-panel.md / group-panel.md, M4/M5/M6 (2026-09-02, continued)

Resumed against the same fixture database after the environment recovered.
Completed `filter-panel.md` steps 5-18, `sort-panel.md` steps 2-13, and
`group-panel.md` steps 1-10/14/15/18 live — operator-list narrowing by type
(Text's 8, Checkbox's 2), `Add filter rule`/`Add filter group` (AND→OR, widening
the result set to the correct union), the settings-sidebar entry point rendering
identical content as a pushed panel with a back arrow, `Delete filter`, the
sort picker's alphabetical/no-`None` list, per-type direction labels (`Sort A →
Z`/`Sort low → high`), `+ Add sort` excluding the already-sorted property,
per-row remove vs. `Delete sort`, the group property picker, grouped-table
rendering (repeated headers, `+ New page` per group, `No Kind` implicit bucket
correctly renamed), the per-group eye toggle (hides from the table, stays
listed greyed in the panel), and `Remove grouping`. Two more real, live-only
defects found and fixed.

### Fixed

2. **A Checkbox (or Verification) filter condition looks complete the instant
   it's created, but silently never filters anything until the user manually
   toggles its value editor away and back.** `ValueEditor`'s `bool` and
   `verification_status` branches are `<select>`s whose DISPLAYED default
   (`Unchecked`, `None`) comes from a local `value == null` fallback — but a
   `<select>` only fires `onChange` on an actual change event, so that
   shown-but-never-chosen default was never written back into the condition.
   Combined with this file's own Checkpoint-3 fix (`sanitizeFilterForQuery`,
   which correctly treats a still-`undefined` value as incomplete and strips
   it from the compiled query), a fresh Checkbox condition looked fully
   specified in the UI yet contributed nothing to every query it was part of.
   Caught live, not by inspection: built `Done equals <shown as Unchecked> OR
   Count equals 5` expecting the union of "not done" (2 rows) and "count is
   5" (1 row) = 3 rows; got exactly 1 (only the Count match) — read
   `view.filter` directly and found the Done condition's `value` key
   genuinely absent, despite the dropdown showing "Unchecked" selected.

   Fixed with `defaultValueForOperator` (new, `filterOperators.ts`): `false`
   for `bool`, `"none"` for `verification_status` (itself a legal, distinct
   value in `_VERIFICATION_STATUSES`, not a placeholder), `undefined`
   everywhere else — every other `argType`'s empty state already displays
   honestly empty (a blank text/number/date input), so only these two needed
   it. Wired into every place a condition's operator gets set: fresh pick
   (`defaultConditionFor`), property switch, and operator switch (all three
   in `FilterBuilder.tsx`/`filterAst.ts`). Re-verified live after the fix:
   picking `Done` immediately persisted `value: false`; the same `Or` repro
   (once a fixture data gap — see below — was patched) returned exactly the
   expected 3-row union. Regression tests: `filterAst.test.ts` (Checkbox and
   Verification both default to an explicit value, not `undefined`),
   `FilterBuilder.test.tsx` (the "Add filter rule" wrap test now expects
   `value: false` on the fresh Checkbox condition it creates).

3. **A freshly-grouped table doesn't hide its own empty bucket by default,
   contradicting `group-panel.md`'s own capture.** The spec's Rows table
   (`Hide empty groups | toggle, **ON** by default`) and its checklist step 6
   both state Notion's default is ON; `defaultGroupBySpec` (types.ts) never
   set `hide_empty_groups` at all, so `GroupStageTwo`'s own `?? false`
   fallback rendered it OFF. Live-verified: grouping this fixture by `Kind`
   left the implicit `No Kind` bucket (0 rows) visible in the table and the
   panel's toggle reading `aria-checked="false"`; the spec calls for it
   hidden from the very first grouping action. Fixed by adding
   `hide_empty_groups: true` to `defaultGroupBySpec`'s returned spec (used by
   every entry point that first sets `group_by`: the column header's Group
   row, the group panel, and Board/Chart creation). Re-verified live:
   removing and re-adding the Kind grouping now shows `aria-checked="true"`
   and drops `No Kind` from the table immediately; toggling it back off
   brings the bucket back (checklist step 10). Four existing tests had
   asserted the old, spec-contradicting shape (`DatabaseShell.test.tsx` x2,
   `GroupBuilder.test.tsx`, `ViewSettingsSidebar.test.tsx`) and are corrected;
   a new `defaultGroupBySpec` test suite added to `types.test.ts`.

### A fixture-data gap, not a product bug

While reproducing finding 2's `Or` repro, one row ("Note one") returned only
2 of the expected 3 matches — traced to that row never receiving its
Done/Due/Status values from an earlier session's interrupted batch-PATCH loop
(a `Runtime.evaluate` timeout mid-loop, unrelated to app code). Its `Done`
property was genuinely **absent** from `properties`, not `false` — correct
SQL three-valued logic (`NULL = false` is `NULL`, not `TRUE`) excluded it from
`equals: false`, which is accurate behavior given the data, not a filter bug.
Patched the row directly via the API and re-confirmed the expected 3-row
union.

Frontend 61 files / 892 tests green (was 888 before this run's two fixes;
+2 in `filterAst.test.ts` for finding 2, +2 in `types.test.ts` for finding 3,
plus 4 existing tests corrected in place rather than counted as new), `tsc`
clean.

---

## Live Chrome checklist run — group-panel.md, M6 group-order steps (2026-09-02, continued)

Follow-up to close out the last unverified part of `group-panel.md`'s checklist:
steps 11-13 (the group-order popover, `Alphabetical` re-sort, and manual
drag-reorder's persistence). `computer` click/screenshot actions were
unreliable again this session (same class of resource pressure as the earlier
entries above — confirmed via `free -h`, ~230-290MB free); direct DOM
interaction via `javascript_tool` (`querySelector` + `.click()`) worked
reliably throughout and is now the established fallback for this environment.

### Confirmed working

- **Step 11**: the group-order popover shows exactly `Manual✓ / Alphabetical /
  Reverse alphabetical`, overlaying the panel.
- **Step 12 (reorder half)**: choosing `Alphabetical` re-sorts the Groups list
  correctly — `Article, No Kind, Note` (lexical order; `"No Kind"` sorts before
  `"Note"` since a space precedes `t`), confirmed in both the panel and the
  table.
- **Step 13**: PATCHed `group_order: "manual"` /
  `group_order_manual: ["__no_value__", "Note", "Article"]` directly (the
  literal pointer/keyboard drag gesture itself is not reliably simulable in
  this automation environment — the same documented limitation every prior
  session in this file has hit, not new) and reloaded: the table's group
  order, the panel's own Groups list order, and the `Sort` row (`Manual ›`)
  all correctly reflect the persisted order after a full page reload.

### Checked, not fixed — a real but minor, deliberately-undecided gap

**Step 12's second clause doesn't hold**: `group-panel.md`'s checklist asserts
per-group drag handles "become inert or hidden" once sorted `Alphabetical`/
`Reverse alphabetical` (dragging a group that's about to be re-sorted out
from under you doesn't make sense). Checked in code, not assumed:
`GroupsSection` (`GroupBuilder.tsx`) never reads `groupBy.group_order` at
all — its `DndContext`/`PointerSensor` and `handleDragEnd` are active
unconditionally, and confirmed live via the DOM: every `Reorder <Group>`
handle stays `tabIndex=0` with its `aria-label` unchanged regardless of the
current sort mode. The practical effect isn't silent data loss (unlike this
session's other findings) — dragging while sorted just switches `group_order`
back to `"manual"` with the dropped order, which is a defensible, even
arguably helpful, interaction, not obviously broken. Not fixed here because
the spec's own wording ("inert **or** hidden") is itself ambiguous about
which of the two Notion actually does, and no raw-DOM/screenshot evidence in
this workstream's `raw-dom/`/`screenshots/` settles it either way — matching
`group-panel.md`'s and this whole workstream's own "no invented numbers, TBD
until captured" rule. Left as a named, disclosed gap rather than guessed at.

---

## Live Chrome checklist run — group-panel.md, M6 steps 16/17/19 (2026-09-02, continued)

Closing out the last three unverified `group-panel.md` checklist steps. Same
fixture, same `javascript_tool` DOM-interaction fallback (`computer` clicks
remained unreliable this session too — `free -h` stayed under ~450MB free
throughout).

### Confirmed working

- **Step 17**: grouping by the `Status` property (`mode: "option"`) returns
  200, not a 400 — confirmed at both the raw `POST .../query` level (buckets:
  `In progress`/`To do`/`No value`, matching the fixture's actual data) and
  in the rendered table (`Collapse In progress`, `Collapse To do`,
  `Collapse No Status` — the M6 rename convention holding for a second
  property, not just `Kind`).

### A real, confirmed gap — disclosed, not fixed (architecture boundary, not a wiring bug)

**Step 16 doesn't fully hold**: clicking `+ New group` DOES create a new
option on the grouped property (confirmed: `Kind`'s `config.options` gained
`"Option 3"`) but that option does **not** appear in the panel's Groups list
afterward, contradicting the checklist's own "and appears in the panel's
Groups list" clause. Root-caused, not assumed: `GroupsSection`'s Groups list
is driven entirely by the `groups` prop (`useDatabaseView`'s live query
result), and the grouping engine's own `_group_by_values`
(`grouping.py`) only ever buckets by VALUES ACTUALLY PRESENT on a row — it
has no concept of a property's *configured* options, unlike the implicit
`__no_value__` bucket (which the engine always appends regardless of data).
A brand-new option with zero rows using it therefore produces no bucket at
all, by design of the engine as it exists today. Making the panel eagerly
show an empty group for it would need either a backend change to
`grouping.group_rows` (widen select/status bucketing to include every
*configured* option, similar to checkbox's fixed two-group set — a change to
the grouping engine's own data model) or client-side synthesis of a fake
zero-row group from `configuredOptions(property)`, neither of which is a
"wire the UI to the already-built engine" fix in the sense every other M6
gap in this file has been. This workstream's own Phase 0c discovery already
drew this exact boundary once (the engine's bucketing behavior itself was
explicitly out of scope; only its UI wiring was the plan's job) — so this is
recorded as a genuine, real gap rather than fixed unilaterally, consistent
with that established boundary.

### Fixed

4. **Two `group_by` sub-field writes fired close together silently clobber
   each other — the same "second write wins outright, first is lost" class
   Checkpoint 1 already fixed once for `sorts`, now recurring for
   `group_by`'s own internal fields.** Reproduced live for step 19 (`Make two
   group changes within ~200ms → assert both persist`): clicking `Hide all`
   (sets `hidden_groups`) then immediately toggling `Hide empty groups`
   (sets `hide_empty_groups`) left `hidden_groups` **entirely absent** from
   the persisted `group_by` — only the toggle survived. Root cause, verified
   in code: `GroupStageTwo.patchGroupBy` (`GroupBuilder.tsx`) built its next
   `group_by` object by spreading the CURRENT `groupBy` **prop** —
   `{ ...groupBy, ...patch }` — a value closed over at render time. Two
   calls fired before React re-renders (the two clicks landed in the same
   tick) both spread the identical stale snapshot; `patchViewConfig`'s own
   queue correctly serialized the OUTER `config` merge, but each caller's
   own `group_by` sub-object had already been computed wrong before it ever
   reached that queue, so the queue had no way to catch it — the whole
   `group_by` key was replaced wholesale by whichever call's PATCH resolved
   last, dropping the other's field outright.

   Fixed with a new `GroupByUpdater` type (`GroupBuilder.tsx`,
   `(current: GroupBySpec | undefined) => GroupBySpec | null`) — the same
   "defer computing the next value until the write's own turn in the queue,
   against the queue's own latest, never a stale prop" contract
   `SortsUpdater`/`FilterUpdater` already established for their own
   whole-value-replace fields. `patchGroupBy` now merges INSIDE the updater
   (`onSetGroupBy((latest) => ({ ...(latest ?? groupBy), ...patch }))`), and
   a new `queueGroupByUpdate` (`DatabaseShell.tsx`) resolves that updater
   against `patchViewConfig`'s own `latestConfigByViewRef` — sharing that
   ref (and `pendingPatchByViewRef`) rather than a separate one, so a
   `group_by` write and any OTHER config write for the same view (a layout
   toggle, the column header menu's own `group_by` replace) stay correctly
   serialized against each other too, not just against their own kind.
   Threaded `onSetGroupBy` through every `group_by` writer: `groupPanel`'s
   own property-pick/clear, `ViewSettingsSidebar`'s Group row, and the
   column header menu's "Group" row (`ColumnHeader.tsx`/
   `ColumnHeaderMenu.tsx`, optional there with a fallback to the old
   `onPatchConfig` replace — still correct for a full-value replace, just not
   race-protected, since no caller of that particular optional path exercises
   the merge-onto-current pattern this bug was about).

   Re-verified live after the fix, the identical `Hide all` + toggle
   sequence: both `hidden_groups: ["Article", "Note"]` and
   `hide_empty_groups: false` now persist together. Regression tests: five
   in `GroupBuilder.test.tsx` (each `patchGroupBy`-driven writer's updater
   asserted against an explicit "latest" argument, not the render-time prop,
   including one that merges onto a DIFFERENT latest than what was rendered
   — the exact scenario the bug required), plus a new
   `DatabaseShell.test.tsx` test mirroring the existing `sorts`-race
   regression test's own structure: a held-pending first `updateView` call,
   a second write queued behind it, and an assertion that the second
   PATCH's body contains BOTH fields once the first resolves.

Frontend 61 files / 893 tests green (was 892 before this run's fix; the 5
`GroupBuilder.test.tsx` tests affected were corrected in place, not counted
as new; +1 new race regression test in `DatabaseShell.test.tsx`), `tsc`
clean.

## view-tab-bar.md, M7 create-flow rewrite (2026-09-02)

The user reported real problems with view create/edit/delete — asked directly rather than
assuming the M7 spec's own disclosed gap (the create-first-configure-after flow never
built) was the whole story. Confirmed: just the create flow, plus a request to re-verify
rename/duplicate/delete hadn't regressed since the M7-M11 sessions last fixed them.

### Built

`ViewTabs.tsx`'s "+ New view" replaced the native `<select>` name/type/group-by form with
`AddViewGrid`: a 4-column, 10-card icon grid (Table/Board/Gallery/List/Chart/Dashboard/
Timeline/Feed/Calendar/Form — Map excluded, this app's own pre-existing deviation). One
click creates the view immediately for every type except Chart (a disclosed exception —
see view-tab-bar.md's own new section). `DatabaseShell.tsx`'s `handleCreateView` auto-
selects Board's group-by from an existing select/status/multi_select property and
Calendar/Timeline's date property from an existing `date` property (restricted families,
not the wider `GROUPABLE_PROPERTY_TYPES` list other surfaces use — see the spec's own
reasoning). `?view=<viewId>` is now read on load and written on every switch
(`DatabaseShell.tsx`'s new `selectView`, mirroring `TableView.tsx`'s existing `?p=`/`?pm=`
pattern) — previously write-only since M7.

### Settled by live-testing against real Notion, not guessed

**Both of the spec's own open questions, closed with real evidence:**

1. **No groupable property at all → Notion auto-creates a Status property, mutating the
   schema.** Built a throwaway Notion database with only a Title property, created a
   Board, watched a real `Status` property (Not started/In progress/Done) appear in the
   Table view too. This is a genuine product decision, not an implementation detail —
   surfaced to the user via `AskUserQuestion` rather than decided unilaterally (this
   workstream's own established precedent, M11's new-row-chevron IA question). **Decision:
   keep this app's refusal to auto-create one** — a Board with nothing to group by lands
   on `BoardView.tsx`'s existing placeholder, fixable afterward via the Group panel.
2. **An empty-string view name falls back to showing the type as the tab label** —
   confirmed live (an unnamed Board's tab read `Board`, not `New view`). `viewTabLabel`
   already handled this correctly; only `createView`'s call site needed to stop defaulting
   to the literal `"New view"`.

### A real functional gap this create-flow rewrite would otherwise have introduced, closed

Removing the pre-creation gate meant Calendar/Timeline could now be created with NO date
property configured — and unlike Board (which already has a real post-creation fix path,
M6's Group panel), there was **no surface anywhere** that could ever set
`config.date_property_id` after creation; the old pre-creation `<select>` was the only one.
Fixed by adding a real inline picker to `CalendarView.tsx`/`TimelineView.tsx`'s own "no
date property configured yet" placeholder (previously pure explanatory text), writing via
the `onConfigChange` prop both components already received but the placeholder branch
never used.

### One real bug found and fixed: Chart's settings sidebar silently never opened

Live-tested the new create flow (2026-09-02) — Board, Calendar, and Gallery all correctly
opened the M3 settings sidebar afterward ("opens the view settings sidebar for configuring
afterward", the spec's own words), but Chart never did, even though
`DatabaseShell.handleCreateView`'s `setSettingsOpen(true)` is unconditional and runs for
every type.

Root cause: `ViewTabs.tsx`'s `handleCreateChart` (the one type with its own two-step
follow-up form) closed its popover only AFTER awaiting `onCreateView(...)` — the ONE place
this create flow diverged from `handlePickViewType`'s own "close, THEN create" order, which
every other type already followed. Since `onCreateView`'s caller opens the settings sidebar
as its very last synchronous step, the old order meant that open happened while the Add-
view popover was STILL mounted — two Radix overlays alive in the same tick, and the
popover's own dismissal (triggered by `closeAddView()` a tick later) silently closed the
sidebar right back. The exact same class of bug as M7's own "Edit view" no-op fix (a
same-tick race between a popover closing and the settings SidePeek opening), not a new one
— and fixed the identical way, by deferring the sidebar's own `setSettingsOpen(true)` one
tick (`DatabaseShell.tsx`) to let the closing popover finish first, AND fixing
`handleCreateChart`'s own ordering to match every other type's (close first, read
`chartConfig` into a local before `closeAddView()` resets the draft, then create).

Caught by a new `DatabaseShell.test.tsx` regression test (`findByText("Layout")` after
creating a Chart through the real UI) — NOT caught by the live-Chrome manual click-then-
screenshot pass, which happened to give Radix enough real wall-clock time between actions
to settle the race before each screenshot. Re-verified live after the fix, both orderings:
Board/Calendar/Gallery still open the sidebar correctly, and Chart now does too.

### Rename / Duplicate / Delete re-verified live, unregressed

Ran fresh against the current branch tip (not reusing an old fixture, since these were
last confirmed working across several M7-M11 sessions and the user asked specifically
whether they'd broken again): Rename (tab → "Photos", persisted across reload), Duplicate
(new "Photos (copy)" tab appeared immediately, selected, config copied), Delete (confirm
dialog → tab removed → fell back to Default view). All three worked correctly — no
regression found.

### Tests

`ViewTabs.test.tsx`: the 14 old select-form creation tests replaced with a parametrized
"every non-Chart card creates immediately" test plus dedicated Chart-follow-up-step tests
(disabled-until-configured, Back returns to the grid without creating, a second Chart
creation isn't blocked by stale draft state). `DatabaseShell.test.tsx`: the two Board
group-by tests adapted to the new auto-select flow (plus a new "no groupable property
leaves it ungrouped" test), two new `?view=` URL-sync tests, and the two new
settings-sidebar-opens-afterward tests (Board and Chart) that caught the ordering bug
above. `CalendarView.test.tsx`/`TimelineView.test.tsx`: three new tests each for the
placeholder's picker (no-properties state, picking one, `onConfigChange` call shape).

Frontend 61 files / 905 tests green (was 903 mid-session, 893 at the top of this entry),
`tsc` clean. Full suite run, not just the affected files.

## row-affordances.md, M12 List build (2026-09-02)

Built List's row hover affordances from this session's own live capture
(`raw-dom/row-affordances-list-view.txt`, `row-affordances.md`'s new "List view"
section). See PROGRESS.md's own "M12 — List built" log entry for the full account;
this entry covers the one real bug found and fixed.

### Fixed

1. **The title input's own `onBlur` closed the whole editing row — including the
   revealed properties next to it — before a click meant for one of them could ever
   land.** `ListView.tsx`'s new per-row "Edit" toggle turns the title into an inline
   text input AND reveals the row's other visible properties as quick-fill chips on
   the same line. The title input's `onBlur` handler originally called
   `setEditingRowId(null)` directly — but a browser fires `blur` on `mousedown`, before
   the corresponding `click` reaches whatever the pointer landed on. Clicking one of the
   revealed properties (e.g. a Status chip reading "—") fired the title's blur FIRST,
   unmounting the entire "editing" block — the property the click was headed to no
   longer existed in the DOM by the time the click itself would have landed. Live-
   reproduced: typing a new title then immediately clicking the Status chip next to it
   silently did nothing; the row just collapsed back to read-only.

   Same root-cause SHAPE as two bugs M11's cell-editing session already found and fixed
   (`AddPropertyPopover.tsx`'s trigger-swap race, `SelectCell`/`StatusCell`'s own
   Radix-dismiss race) — "a component that swaps its own DOM structure mid-interaction
   loses a race against the very click that triggered the swap." Fixed the same class of
   way: moved the exit-edit decision from the title input's own blur to the ROW
   CONTAINER's blur, checking `e.relatedTarget` (the element about to receive focus) —
   if it's still inside the row (the property the user just clicked), editing stays
   open; only a genuine focus-leaves-the-row closes it. The title input's own `onBlur`
   now only commits the draft value, it no longer decides whether to exit edit mode.

   Regression tests: two in `ListView.test.tsx`, using `fireEvent.blur` with an explicit
   `relatedTarget` to reproduce the exact DOM event sequence a real click triggers
   (`userEvent`'s own focus/blur simulation doesn't reliably reproduce this particular
   race in jsdom — same class of jsdom-vs-real-browser gap this workstream has
   documented before, e.g. `SortRowsList.test.tsx`'s `DndContext`+`Popover` hang) —
   one asserting the row STAYS expanded when `relatedTarget` is still inside it, one
   asserting it correctly CLOSES when `relatedTarget` is genuinely outside (`document.body`).

**Live verification status:** confirmed live BEFORE this bug was found (resting state,
hover, the Edit toggle appearing, the row menu, `Open in → Side peek`, plain-click opens
the peek). The fix itself was NOT re-confirmed live — the automation session ran out of
memory mid-verification (`free -h`: 590MB free, 3.4GB/3.7GB swap, confirmed not guessed)
partway through re-testing. Freeing several stale Chrome renderer processes (leftover
from an earlier boot, `ps aux` start-time-filtered) did not reconnect the
`claude-in-chrome` extension; the known fix is a full Chrome restart, left for the user
rather than done unilaterally since it closes their open tabs and windows. The fix is
covered by the two regression tests above, which do reproduce the actual bug mechanism
(not a hypothetical), so this is disclosed as a real but bounded verification gap, not a
silent skip.

Frontend 61 files / 916 tests green (was 905), `tsc` clean.

## row-gutter mismatch — investigated, no bug found (2026-09-02)

Not a code-review checkpoint — a user-reported issue
(`ISSUE-row-gutter-mismatch.md`), investigated per that doc's own plan rather than
patched on assumption. The user reported (screenshot) that Table's row gutter
(`+`/`⠿`/`☐`, M9) didn't match their own real Notion.

### Investigated, found NOT a bug

Asked the user directly rather than guessing (full-page vs. embedded database, hovered
and waited, browser vs. desktop, fresh evidence). The user confirmed full-page/hovered/
browser and supplied two fresh screenshots — real Notion and our app, side by side, both
in the bulk-selected state. **Both show the identical `+`/`⠿`/`☑` gutter shape.** The
user's own words: "the same, only the notion are well render so i did not notice them
all this time" — real Notion does show this; it had rendered subtly enough that the user
hadn't consciously registered it, not an app defect.

Verified by reading the two screenshots closely (not taken at face value): the "Aa"
title-column icon in one confirms it as real Notion (Notion's own glyph convention,
distinct from our app's "T"); the bulk-bar showing only a trash icon in the other
confirms it as our app, consistent with `row-affordances.md`'s own already-documented
M9 scope-down ("the overflow ⋯ ... were not built").

**Resolution:** no code change. `RowGutter.tsx`'s existing implementation already
matches real Notion. `row-affordances.md`'s "Trigger" section was tightened to state
the full-page-database condition explicitly (previously implicit) and record this
second confirmation. `ISSUE-row-gutter-mismatch.md` gained a "Resolution" section.
`PROGRESS.md`'s OPEN ISSUE banner closed out, Log entry added.

**Live verification:** not completed — a sanity check of our app's own resting/hover
states was attempted (the user's screenshot only showed the bulk-selected state) but the
Chrome tab froze under this session's own memory exhaustion (`free -h`: 447Mi free,
3.2Gi/3.7Gi swap — same recurring class this workstream has hit before). Not forced:
this was a documentation-only resolution, and the user's own fresh screenshots already
settled the actual question in dispute (which icons appear in real Notion), independent
of our app's hover-gating logic, which M9 already tested and this issue never disputed.

## Gallery view — a real OPEN/CLOSE-toggle bug, found and fixed (2026-09-02)

Not a code-review checkpoint — found while building Gallery's own dedicated M12 work
(`row-affordances.md`'s new "Gallery view" section has the full account of that session;
this entry covers the one real bug in isolation, matching this file's own convention).

### Confirmed and fixed

**`GalleryView.tsx` had the identical OPEN/CLOSE-doesn't-actually-toggle bug M10 already
found and fixed once for `TableView.tsx`** (this file's own Checkpoint 2 doesn't list it
because M10 fixed it inline before any checkpoint ran — see `PROGRESS.md`'s own M10
section: "clicking CLOSE... fired the identical onOpen handler as OPEN — re-opening the
same row instead of closing it"). `GalleryCard` was wired `onOpenRow={openRow}` — plain
`openRow`, not `useRowPeek`'s own `toggleRow` — so clicking a second time on a row whose
peek was already open re-opened it (a no-op from the user's perspective, but not the
CLOSE the button's own label promised) instead of closing it.

**Root cause:** M10's fix pattern (a local `toggleRow` wrapper in `TableView.tsx`,
checking `peekRowId` before deciding whether to open or close) was never generalized
into `useRowPeek.ts` itself when M12 extracted that hook — the hook already exposed a
`toggleRow` control, but only `TableView.tsx` (its original owner) ever called it; every
other view built afterward (List, Feed, Board, Gallery) received `openRow` in their own
copy-paste and inherited the pre-M10 bug fresh, since `openRow`/`toggleRow` are both
valid-looking, same-shaped functions with no compiler signal distinguishing "the right
one for a toggle button."

**Confirmed present in `BoardView.tsx` too** (same `onOpenRow={openRow}` wiring, read
directly, not assumed) — **deliberately NOT fixed this session**, out of scope for
Gallery's own named milestone; tracked for Board's own upcoming M12 milestone instead,
same "flag, don't silently expand scope" discipline this workstream uses throughout.
`ListView.tsx`/`FeedView.tsx` were checked and do NOT have this bug (List has no
OPEN/CLOSE toggle at all — the whole row is the open-trigger; Feed's title-click always
opens, never toggles closed by clicking the title again — so neither one had a `toggleRow`
call to get wrong).

**Fix:** `GalleryView.tsx` now passes `useRowPeek`'s own `toggleRow` to `GalleryCard`'s
`onOpenRow`, the same one-line fix shape M10 already established for Table.

Regression test: `GalleryView.test.tsx`'s new "OPEN/CLOSE actually toggles" test reuses
the SAME button DOM element across both clicks (rather than re-querying by accessible
name) to sidestep the disambiguation `TableView.test.tsx`'s own "the Close button closes
the peek" test already documents (RowPeek's own close control also reads "Close" once
open) — asserts the exact `router.replace` URL after each click, not just "no crash."

Frontend 61 files / 935 tests green (was 928), `tsc` clean.

## Form view — a stale test's throw cascaded into 3 unrelated test failures (2026-09-02)

Not a code-review checkpoint — found finishing M12's Form rebuild (`form-view.md` has
the full account of that session; this entry covers the one real bug in isolation,
matching this file's own convention).

### Confirmed and fixed

Rebuilding `FormView.tsx` as a WYSIWYG surface (per a live Notion capture) moved
"Required" off a bare per-question checkbox and into each question card's own "···"
"Question options" popover. `DatabaseShell.test.tsx`'s own pre-existing "two config
PATCHes fired before the first's response lands do not clobber each other" test still
called `screen.getByLabelText("Question 1 required")` — a label that no longer exists —
which throws `TestingLibraryElementError` immediately.

**That throw alone would just fail its own test.** What actually happened: the throw
left `user-event`'s pointer/mock state in a condition that cascaded into 3 OTHER,
unrelated-looking tests failing later in the SAME file run — two `queueSortsUpdate`/
`queueGroupByUpdate` stale-write-race tests and one Board-view-creation test, all
failing on an unrelated `vi.waitFor(...)` timeout. Confirmed as real cross-test
pollution, not this machine's own recurring memory-pressure flakiness (a class this
workstream has hit often — row-affordances.md's Gallery/List sessions, for instance):
every one of the 4 failing tests passed cleanly in isolation (`-t` filter), and
reverting only `FormView.tsx` (keeping the stale test as-is) made all 35 pass — proving
the earlier test's throw, not system load, was the cause.

**Fix:** updated that one test to open the question's own "···" popover and click
"Required" inside it, matching every other test this milestone updated for the new UI.
No FormView.tsx change was needed — the component was correct; the test was stale.

Frontend 61 files / 953 tests green (was 947 pre-M12-Form), `tsc` clean.

---

## Checkpoint 4 — whole-branch pass, M12 all nine views + row-peek + M7 create-flow
(2026-09-03)

The workstream's own last review checkpoint (`README.md`'s "Review loop": batched after
M1-M3, M4-M6, M7-M11, "plus one whole-branch pass at the end" — this is that pass), run
per the same budget-first instruction every prior checkpoint used: **not**
`/code-review high`/`max`/`ultra` (Checkpoint 2's own attempt at that mostly hit the
account rate limit) and **not** a subagent (README.md's own "Working rules": "No
subagents. Every step runs inline in the main session"). A manual read-through instead,
over `d610476..HEAD` (`git diff --stat`, `frontend/` only, screenshots excluded: 48
files, +5421/-1233) — every M12 commit: all nine per-view sessions (List, Feed, Gallery,
Chart, Form, Dashboard, Board, Calendar, Timeline), the cross-cutting row-peek pass, and
the M7 create-flow rewrite. `d610476` is Checkpoint 2's own last-reviewed commit.

Prioritized by size and by the specific risk areas the hand-off named, given the
recurring pattern across M12's own nine sessions (documented in `PROGRESS.md`'s Log):
whether `RowMenuTrigger.tsx`'s new controlled `open`/`onOpenChange` mode (added for
Calendar) has edge cases with its other callers; whether the `resolveBarMove`/
`resolveDropDate`/`resolveBarResize` family stayed consistent across Calendar/Timeline/
Board; whether any view's own `onConfigChange`/`onCellChange` threading has the same
kind of prop-drilling gap the M1-M3 checkpoint found once (a hook value read from a
stale closure). Read `DatabaseShell.tsx`'s full diff first (the one file every view
threads through), then every view file, `RowGutter.tsx`/`RowMenuTrigger.tsx`/
`useRowPeek.ts` (the three cross-cutting M12 extractions), `ViewToolbar.tsx`/
`QueryBar.tsx`/`ColumnHeaderMenu.tsx`/`GroupBuilder.tsx`/`ViewSettingsSidebar.tsx`/
`ViewLayoutPanel.tsx` (the M3-era hosts M12 only lightly touched), and
`filterAst.ts`/`filterOperators.ts`/`types.ts`/`useDatabaseView.ts` (already reviewed
piece-by-piece in this file's own five "Live Chrome checklist run" entries above, each
with its own fix and regression test — re-read to confirm no further drift, not
re-litigated).

The three specifically-named risk areas turned out clean: `RowMenuTrigger`'s controlled
mode has exactly one caller (`CalendarEventBar`) and every existing uncontrolled caller
(`RowGutter.tsx`, Board/Gallery/Feed's own cards) is unaffected, confirmed by reading
`controlled = open !== undefined` — a per-render boolean, never a value that could go
stale across renders for a single call site. `resolveBarMove`/`resolveDropDate`/
`resolveBarResize` all correctly return `undefined` for a zero-delta/no-op case and all
three shift `end` only when it's non-null (a point marker stays a point marker) —
consistent by design, not by accident (`resolveBarMove`'s own doc comment says outright
it mirrors `resolveDropDate`). `hidden_properties`/`property_order` wiring is consistent
across all nine views (Calendar/Timeline's own deliberate non-wiring, reconfirmed
correct: no rendering path on either view ever reads either key).

### Fixed

1. **`DashboardView.tsx`'s own per-widget query (`useWidgetQuery`) never sanitized a
   widget's underlying view's `filter` before sending it to `POST .../query` — the
   exact 400-and-silently-stall bug `useDatabaseView.loadRows` was already fixed for,
   in an earlier session captured in this file's own "Live Chrome checklist run —
   filter-panel.md, M4" entry above (`sanitizeFilterForQuery`).** A filter tree can be,
   and routinely is, mid-edit (an empty "+ Add advanced filter" group, a freshly-picked
   property with no value typed yet) — this app persists the filter tree to
   `view.filter` on every edit, no separate draft — and any OTHER view that happens to
   also be a dashboard widget inherits that same in-progress state the instant it's
   being edited in its own regular tab. `useWidgetQuery` built its query body from
   `view.filter ?? null` directly, with no sanitize pass, so a widget showing a
   mid-edit view would 400 on `POST .../query` and its rows would silently stop
   updating (`loadError` is set but the earlier bug's own root cause — no toast, easy
   to miss — doesn't apply here since `loadError` IS rendered; the bug is the
   unnecessary 400 itself on an ordinary, non-erroneous editing state, not a fully
   silent failure). Pre-existing (this exact code predates M12 — `useWidgetQuery` was
   untouched by this diff until this fix), not introduced by M12, but never reviewed
   before either (Dashboard is M12-scoped; no earlier checkpoint's diff range included
   `DashboardView.tsx`). Fixed by importing `asFilterNode`/`sanitizeFilterForQuery`
   (`filterAst.ts`) into `useWidgetQuery`, threading `properties` into it (a new third
   argument) the same way `useDatabaseView.loadRows` already takes it, and running the
   widget's own `view.filter` through the identical sanitize pass before it reaches the
   query body. `DashboardView.test.tsx`'s existing 18 tests all still pass unchanged —
   none of them exercise a mid-edit filter, so this closes a real gap without touching
   any asserted behavior.

2. **Timeline's title-column `OpenNoteButton` (added this session, M12 Timeline) is
   LABELLED (`isOpen={peekRowId === event.rowId}` makes it show "Close" once that row's
   peek is open — `OpenNoteButton.tsx`'s own `isOpen` contract) but was wired
   `onOpen={openRow}`, not `toggleRow` — the identical OPEN/CLOSE-doesn't-actually-toggle
   bug class this file's own log already records fixing THREE times before (Table/M10,
   Gallery's own M12 session, Board's own M12 session).** A second click on the same
   button (now reading "Close") just called `openRow(event.rowId)` again — a no-op
   re-open, not a close, contradicting the button's own label. Reachable and real:
   Timeline's title column is the ONE place in this file that renders a labelled
   OPEN/CLOSE control at all (the bar itself has no hover affordance by design, per
   Calendar's own established "whole bar is the open-trigger, no toggle" pattern — the
   bar's own `onOpenRow={openRow}` is correct as-is and was left unchanged). Fixed by
   destructuring `toggleRow` from this component's own `useRowPeek(config)` call and
   wiring it as the title column's `onOpen`. Regression test added to
   `TimelineView.test.tsx` (mirroring `GalleryView.test.tsx`'s own identical regression
   test's structure exactly): clicks the same button twice, asserts the URL gains
   `p=row-1` after the first click and loses it after the second, and asserts the
   accessible name flips Open → Close → Open.

3. **`FormView.tsx`'s question-array writers (`saveQuestions`, reached by every
   add/patch/remove/move action) computed their next `config.questions` array by
   reading the CURRENT `questions` prop — a value closed over at render time, stale
   until the in-flight PATCH it came from resolves — the same "whole-value REPLACE,
   needs the queue's own latest, not a stale render-time closure" hazard this file's own
   Checkpoint 1 already fixed once for `sorts`, and the M6 group-panel session again for
   `group_by`.** Two question edits landing within the same in-flight-PATCH window (e.g.
   two quick "Required" toggles on two different questions, or a reorder immediately
   followed by an edit) would each compute against the SAME stale snapshot, so whichever
   PATCH resolves last silently drops the other's change. New this session (`FormView`
   was rebuilt from scratch in M12's own Form session — `readFormQuestions`/
   `saveQuestions` did not exist before this diff), not carried over from before.
   Fixed with `QuestionsUpdater` (`FormView.tsx`, mirrors `GroupByUpdater`'s own doc
   comment and shape exactly) and `queueQuestionsUpdate` (`DatabaseShell.tsx`, mirrors
   `queueGroupByUpdate`'s own shared-refs reasoning exactly — same
   `pendingPatchByViewRef`/`latestConfigByViewRef`). Also switched every question
   writer (`handlePatchQuestion`/`handleRemoveQuestion`/`handleMoveQuestion`) from
   identifying its target by array INDEX to the stable `property_key`: an index
   computed at render time can point at the WRONG question once the updater actually
   runs against the queue's own latest array (which may have a different order/length
   by then than what the user was looking at when they clicked) — `property_key` is
   unique per question (enforced by `selectedKeys`/`availableProperties`'s own filter)
   and stays correct regardless of which array snapshot it's found in.
   `onSetQuestions` is optional on FormView's own props, same "degrade gracefully"
   convention `onSetGroupBy`/`onFilter` already use (ColumnHeaderMenu.tsx) — omitted,
   `saveQuestions` falls back to the exact pre-fix `onConfigChange`-based plain replace,
   which is why all 20 pre-existing `FormView.test.tsx` tests pass completely unchanged
   (none of them pass `onSetQuestions`, so none of their assertions on `onConfigChange`
   needed touching). `DatabaseShell.tsx`'s own `case "form"` now threads
   `onSetQuestions={(updater) => queueQuestionsUpdate(activeView.id, activeView.config,
   updater)}` for the real, race-protected path. Regression test added to
   `DatabaseShell.test.tsx`, mirroring the file's own existing `group_by` race test's
   structure exactly: a held-pending first `updateView` call (toggle Required on
   question 1), a second write queued behind it (toggle Required on question 2), and an
   assertion that the second PATCH's body contains BOTH toggles once the first resolves.

### Checked, not fixed (no defect found)

- `RowMenuTrigger.tsx`'s controlled `open`/`onOpenChange` mode (added for Calendar) —
  exactly one caller (`CalendarEventBar`), every other caller stays uncontrolled;
  `controlled = open !== undefined` is recomputed fresh every render from a prop that
  never flips for a given call site, so there is no stale-mode window to hit.
- `resolveBarMove`/`resolveDropDate`/`resolveBarResize` (Timeline/Calendar) — consistent
  by design: all three return `undefined` for a zero-delta/no-op drag, all three shift
  `end` only when the value already has one (a point marker never gains a fake range).
- `hidden_properties`/`property_order` — wired consistently via the shared
  `viewConfig.ts` helpers (`getHiddenKeys`/`orderProperties`) across all nine M12 views;
  Calendar/Timeline's own deliberate non-wiring re-confirmed correct by reading both
  files fresh — neither the event bar nor `RowPeek.tsx` (M10's own established
  always-alphabetical behavior) ever consults either key on either view.
- `onOpenRow`/`toggleRow` wiring across all nine views — Board and Gallery both
  correctly use `toggleRow` (post their own M12 fixes); List/Feed/Calendar/Timeline's
  own bar-or-row body click correctly uses bare `openRow` (none of those renders a
  labelled OPEN/CLOSE control on that click target, so there is no toggle contract to
  violate) — Timeline's title-column button was the one exception, fixed above (item 2).
- `TimelineBar`'s own click-vs-drag threshold (`startBodyInteraction`) has one narrow,
  low-severity edge case: dragging the pointer out past the 5px threshold and back to
  the exact starting pixel sets `moved = true` (skipping the click-opens-the-peek
  branch) while also computing a final `deltaPx` of `0` (`resolveBarMove` then returns
  `undefined`, skipping the commit) — the row peek simply doesn't open on that
  particular gesture. Not counted as a bug: it requires an exact round-trip back to the
  starting pixel, which is a much narrower gesture than an ordinary click, and mirrors
  dnd-kit's own convention elsewhere in this codebase of not treating a
  past-threshold-then-cancelled drag as a click.
- `ViewToolbar.tsx`/`QueryBar.tsx`'s `forwardRef` fixes (already applied earlier this
  session per their own doc comments, same `3b4a079` root cause as `SortRowsList.tsx`/
  `FilterBuilder.tsx`'s identical fixes) — re-read fresh, both correctly forward the ref
  and spread `...rest` past `label`/`icon`, no drift from the established pattern.

### Deferred, tracked (real, not fixed here)

4. **`DashboardView.tsx`'s entire write surface (`saveRows`, the debounced row-height/
   widget-width commits, and — critically — `patchThisWidgetsView`, which every
   config-driven widget's `onConfigChange` now routes through, Board's own M12 addition
   included) bypasses `patchViewConfig`'s queue entirely: `DatabaseShell.tsx` wires
   `onUpdateView={updateView}` raw, not through the shared merge-safe queue every other
   config write in this app uses.** Every one of those writers computes its next
   `config` by spreading a render-time prop (`view.config` or the dashboard's own
   `config`) and calling `updateView` directly — the identical "second write clobbers
   the first" race class fixed three separate times elsewhere in this exact codebase
   now (`sorts`, `group_by`, and `questions` above). Confirmed reachable in principle,
   not live-verified: two rapid Layout-panel toggles on the SAME embedded Board widget
   (both racing `patchThisWidgetsView`, which targets that widget's own view id), or a
   dashboard-row resize immediately followed by a remove-widget click (both racing
   `saveRows`, which targets the dashboard's own view id), would each compute against
   the same stale snapshot. Real, but pre-existing (this wiring predates M12 entirely —
   the `case "dashboard"` block and `saveRows`/the debounced commits are untouched by
   this diff; M12 only added ONE more call site onto the SAME already-unprotected path,
   Board's `onConfigChange={patchThisWidgetsView}`) and never reviewed before (Dashboard
   is M12-scoped, outside every earlier checkpoint's own diff range). Not fixed here:
   unlike `sorts`/`group_by`/`questions` above (each a single field on the ONE active
   view, with a natural updater-function shape), `DashboardView` writes to MANY
   different view ids from ONE component (the dashboard's own view for `saveRows`/
   resize, plus a different id per widget for `patchThisWidgetsView`) across five
   separate call sites, all built around "caller computes the full merged config
   up front, then PATCHes it" rather than an updater function — bringing this in line
   would mean re-plumbing DashboardView's entire write interface (a new prop shape,
   five call sites), not a bounded one-writer fix like the three above. The natural fix
   is a direct, small one, though: `patchViewConfig`/`queueGroupByUpdate`/
   `queueQuestionsUpdate` are all already keyed by an arbitrary `viewId` in a shared
   `Map`, not just `activeView`'s own id, so reusing that exact queue for
   `DashboardView`'s writes (passing `patchViewConfig` itself, or an updater-shaped
   sibling, down as `onUpdateView`) is a bounded follow-up whenever Dashboard's own
   write surface gets its next dedicated look — just disproportionate to force inside
   this whole-branch pass.

Frontend 61 files / 975 → 977 tests green (2 new: `TimelineView.test.tsx`'s OPEN/CLOSE
regression, `DatabaseShell.test.tsx`'s `queueQuestionsUpdate` race regression), `tsc`
clean.

**The Notion-databases UI-parity workstream is now complete.** All 15 spec'd surfaces
(M1-M11), all nine M12 per-view sessions, the cross-cutting row-peek pass, the M7
create-flow rewrite, and all four review checkpoints (this one included) are done.
