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
