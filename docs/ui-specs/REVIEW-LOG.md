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

### Not completed this run — an environment limitation, not a product finding

This session's automation environment became memory-constrained partway through
(`free -h`: <650MB free RAM, ~3GB/3.7GB swap in use) — `Page.captureScreenshot`
started timing out on EVERY call, and clicking the toolbar's `Filter`/`Sort`
buttons (confirmed via `read_page`'s accessibility tree, not screenshots) stopped
opening their popovers at all, reproducibly, across two fresh tabs, for BOTH
buttons — ruling out a regression from the fix above and pointing at resource
exhaustion rather than the app. This closed the window on live-verifying the fix
itself (steps 10-20 of `filter-panel.md`'s checklist: operator-list narrowing by
type, `Add filter rule`/`Add filter group`, the settings-sidebar entry point,
`Delete filter`, concurrent-edit ordering, the empty-result state) plus all of
`sort-panel.md` and `group-panel.md`'s own checklists. The fix itself is
unit-tested (`filterAst.test.ts`) and was live-confirmed for the specific
`Article`-narrows-to-zero repro before the environment degraded — not merely
inferred from reading the code. Resume point for a future session: re-run
`filter-panel.md` steps 10-20, `sort-panel.md`, and `group-panel.md` live once a
less memory-constrained session is available.
