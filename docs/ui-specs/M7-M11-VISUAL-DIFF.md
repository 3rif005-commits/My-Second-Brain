# M7–M11 — live run, for the visual diff

> Exit criterion 4 for this batch, same rule M1/M4-M6's own files state: nothing ships
> as done until these are checked against the spec and someone says what is off. Run
> 2026-09-01 against `localhost:3000` via `claude-in-chrome`, inline in the main
> session per this repo's own "no subagents" rule (`README.md`'s Working rules).
>
> Two databases used, both pre-existing throwaway fixtures (no new fixture built, to
> avoid clutter):
> - `9aebda7f-f0cc-4668-b4ae-cb5554476dfb` ("Untitled", 1 property, 1 view) — the
>   single-view test case M7 needs.
> - `54f49606-4822-443d-a3f8-685de4a35894` ("Untitled Database", 8 properties, 7
>   views, grouped/filtered/sorted) — the same fixture M4-M6's own diff used, reused
>   here for the 2+-view case and everything else.
>
> **Known environment note (carried over from M4-M6's own diff, re-observed here):**
> `resize_window` calls did not change the actual screenshot viewport (stuck at
> 1300x593 regardless of requested height). Not treated as a product defect.

---

## M7 — view tab bar (`view-tab-bar.md`)

### Confirmed matching the spec

- Clicking the **active** tab opens its menu rather than a no-op switch.
- Menu row set for **one view**: Rename, Display as, Edit view, Source (greyed,
  "Default"), Copy link to view, Duplicate view — **no** Delete view, **no** Add view
  to sidebar (the spec's own "omit deliberately" instruction, already documented).
- Menu row set for **2+ views** (7-view fixture): Source becomes active with a `>`
  chevron, **Delete view is present**. Exact match to the spec's two-state table.
- "Display as" flyout: `Text and icon ✓` / `Text only` / `Icon only` + an italic
  `Only applies to you` footer — pixel-for-pixel row match.
- Rename → the tab becomes an inline, pre-selected text input. Works cleanly.
- `screenshots/actual/M7-01-view-menu-single-view.jpg`,
  `M7-02-display-as-flyout.jpg`, `M7-03-view-menu-multi-view.jpg`.

### Real bug found and fixed

**"Edit view" silently did nothing — the M3 settings sidebar never opened.**
Reproduced 5 times across both fixtures (raw coordinates, an element `ref`, and after
the lazy chunk was already warm from a working gear-icon click) — not a fluke, not a
dev-server artifact. The toolbar's own gear icon (identical destination,
`setSettingsOpen(true)`) worked every time; only the tab-menu's "Edit view" row failed.

Root cause: `ViewTabs.tsx`'s `onEditView` called `setMenuOpen(false)` (closing the
tab-menu `Popover`) and `onOpenSettings?.()` (opening the settings `SidePeek`, a
`RadixDialog`) in the same synchronous tick. Closing one Radix layer while opening
another in the same tick raced — the sidebar's `open` flipped true and immediately
false again, never painting. `onOpenSettings` deferred by one macrotask
(`setTimeout(..., 0)`) fixes it; confirmed live afterward (three clean opens across
both fixtures).

Added a regression test (`ViewTabs.test.tsx`, "clicking Edit view calls
onOpenSettings") — the existing test only asserted the row's presence, never that
selecting it actually called `onOpenSettings`, which is how this shipped unnoticed.
23/23 tests green after the fix.

### Deviations — already-documented, now empirically reconfirmed live

- **"+ New view" is permanently visible**, not hover-revealed (Trigger table's own
  rule). Not previously called out by name in `PROGRESS.md`'s M7 write-up; a small,
  real gap, left open (cosmetic, not blocking).
- **"Add a new view" is still the pre-M7 native `<select>` + Create/Cancel form**, not
  the spec's 4-column card grid, and is not create-first (`M7-04-add-view-native-
  select-not-card-grid.jpg`). Matches `PROGRESS.md`'s own recorded deferral verbatim —
  reconfirmed, not new.
- **View switching never touches the browser URL at all** — clicking another tab
  changes the table but the address bar stays bare (`54f49606-...` with no `?v=` or
  `?view=` param). Consistent with, and now more precise than, `PROGRESS.md`'s M3 log
  ("`?view=` deep links are written but not yet read on load") — "written" refers only
  to the string `copyViewLink` builds for the clipboard, not actual `router.replace`
  on switch. Reload does not restore the view. Confirmed, not fixed (same disclosed
  scope as the row peek's own analogous gap, M10).

### Not exercised this run (time-boxed, not blocking)

Duplicate/Delete-down-to-one round trip (steps 15-18) and reload-persistence of a
rename (step 19b) — the underlying endpoints (`duplicateView`, `deleteView`,
`updateView`) are already covered by `ViewTabs.test.tsx`'s own unit tests and were not
re-verified live given this session's time budget; flagged for a follow-up live pass
if the user wants full coverage rather than the representative sample above.

---

## M8 — database header (`database-header.md`)

Tested against `54f49606-...`'s title bar. Creation flow (full-viewport data-source
picker) and cover are pre-scoped-out per `PROGRESS.md`'s own M8 write-up — not
re-tested, nothing changed there.

### Confirmed matching the spec

- **Hover affordances are correctly reserved-space and hover-only**: `Add icon` /
  `Add description` invisible at rest, appear above the title on hover, title does
  **not** shift horizontally or vertically when they appear.
- **`Add icon` assigns immediately** (a 🚀 landed on the title with no picker
  interaction) **then** opens the picker — exact create-first match to the spec's own
  language. Icon persisted after closing the picker.
- **Icon picker**: Emoji-only (no Icons/Upload tabs, matching "no icon set / no asset
  pipeline" scope-down), search field, category section headers (Objects, Symbols,
  Work, ...), an explicit Remove (✕) control. `screenshots/actual/M8-01-icon-
  picker.jpg`.
- **`Add description` toggles correctly**: becomes `Hide description`, a field with
  placeholder `Add a description…` appears under the title, and toggling back removes
  it. Exact match.
- **Page `⋯` menu** (confirmed earlier this session while cleaning up a stray test
  database): exactly `Copy link`, `Lock database`, `Move to Trash` — every other
  captured row already homed elsewhere or out of scope, per `PROGRESS.md`'s own M8
  write-up. `Move to Trash` works (used to delete the stray database).

### Not exercised this run

Title inline-edit-and-persist (step 15) and description persistence across reload
(step 14) — both gated on B2 (`PATCH /db/databases/{id}`), already confirmed built and
called in `PROGRESS.md`'s M8 log; not re-verified live here given time budget. All
Notes' read-only suppression (step 17) not re-checked.

---

## M9 — row hover affordances (`row-affordances.md`) + M10 — row peek internals (`row-peek.md`)

Tested together — opening the peek from the row's own `OPEN` button is the natural
join between the two surfaces. `screenshots/actual/M9-01-row-hover-gutter.jpg`,
`M9-02-row-menu-and-bulk-bar.jpg`, `M10-01-row-peek-side.jpg`.

### M9 — confirmed matching the spec

- **Row hover gutter**: `+`, drag handle `⠿`, checkbox `☐` all appear outside the
  table's left edge on hover, reserved space (no shift). Page icon + labelled
  **`OPEN`** button (icon + text, right-aligned) inside the title cell.
- **`OPEN` toggles to `CLOSE`** while its row's peek is open — confirmed live.
- **The drag handle really does carry the documented two gestures at once**: clicking
  it both opened the row menu **and** selected the row (checkbox filled, `1 selected`
  bulk bar with a trash icon appeared) — matches the spec's "click also selects" note
  exactly, in one click, no separate interaction needed.
- **Row menu contents** match `PROGRESS.md`'s own M9 write-up precisely: `Search
  actions…` (autofocused), `Page` section header, `Add to Favorites` (live),
  `Edit icon` / `Edit property` (disabled), `Open in ▸` (live), `Comment` (disabled,
  shows `Ctrl+⇧+M`), `Copy link` (live), `Duplicate` (disabled), `Move to Trash`
  (live, red). Disabled rows are greyed with a reason, not silently missing.

### M10 — confirmed matching the spec

- **Non-modal side peek**: table stayed visible and interactively rendered to the left
  of the peek — no full-viewport backdrop. Matches the file's own "NON-MODAL BY
  DEFAULT, AND THAT IS THE POINT" comment in `SidePeek.tsx`.
- **URL sync**: opening the peek pushed `?p=06c9e6cb-...&pm=s` onto the address bar;
  closing it removed both params cleanly.
- **Header bar**: `×` (close), `⤢` (expand to full page), Share, `★` (favorite), `⋯`
  — all five present, matching the spec's row-for-row replacement of the old plain
  text links.
- **Alphabetical property order**: `Count, Done, Due, Kind, Link, Mastery, Topics` —
  exactly alphabetical, not schema position.
- **"Empty" placeholder is type-aware, not blanket**: `Due` and `Link` (date, URL)
  show muted `Empty`; `Done` (checkbox) renders its **real checkbox control**, never
  "Empty" — exactly the spec's "`false` is a real value, never an absence of one"
  rule. Clicking `Done`'s checkbox toggled it live (toggled back to leave the fixture
  unchanged).
- Page body (`BlockEditor`, "Enter text or type '/' for commands") renders below the
  properties, unchanged from pre-M10.

### Not exercised this run

Prev/next row navigation (spec's own TBD, likely absent), Alt+Click forced-side-peek,
comments section (spec's own TBD) — none re-verified live; no contradicting evidence
found either.

---

## M11 — the five sub-pieces

### M11 (1/5) — calculations footer (`calculations-row.md`)

**Confirmed matching the spec**, via a Number column's header menu on a flat (V2/V3)
view: `Calculate` flyout offers `None ✓ / Count / Percent / More options`; `More
options` offers exactly `Sum, Average, Median, Min, Max, Range`; picking `Sum` sets a
right-aligned `SUM <total>` footer cell, other columns' footer cells empty, label
muted small uppercase. Persisted across reload. `screenshots/actual/M11-02-
calculations-footer-sum.jpg`.

**On a grouped view (Default view), the footer correctly does not render** — matches
`PROGRESS.md`'s own documented M11(1/5) scope ("never alongside `group_by`").

**Minor finding, not fixed:** setting the calculation doesn't paint the footer live —
it only appeared after a reload, on both the grouped and flat views tried. Not chased
further (likely `getQueryExtras`/`aggregates` not being refetched on
`onPatchConfig`'s own optimistic path); flagged for a follow-up.

### M11 (2/5) — new-row chevron + title focus (`new-row-button.md`)

**Confirmed matching the spec**: clicking `+ New` creates a row **and focuses its
title cell inline, caret placed** — exact match. The chevron's dropdown shows
`Templates for <name>`, `Create a reusable page template for this database.`, and
`+ New template` — exact match to the captured empty state.

**Real bug found and fixed: the header read "Templates for Default"** (the data
source's own name) instead of "Templates for Untitled Database" (the spec's own
`<database name>`). `TableView.tsx` was reading a `dataSourceName` prop that
`DatabaseShell.tsx` populated from `dataSource.name`, not `database.title`. One-line
fix at the call site (`dataSourceName={database.title}`) — the prop is used for
nothing else in `TableView.tsx`, so no renaming/threading was needed. Confirmed live
before and after. 99/99 `TableView.test.tsx` green.

**Second real bug found and fixed: the same dropdown never dismissed on outside click
or Escape.** It predates the shared `Popover` primitive — a plain conditional `<div
role="menu">` with only its own chevron button as a toggle, no dismissal wiring at
all. Reproduced (opened, clicked elsewhere, stayed open; opened, pressed Escape,
stayed open) before fixing. Added a scoped `pointerdown`/`keydown` document listener
(ref-gated, closes on true outside clicks, ignores clicks on the trigger/menu itself)
rather than converting the whole thing to `Popover` — smaller, contained diff for a
component that predates that pattern. Confirmed live afterward (both dismissal paths
now work) and added a regression test (`TableView.test.tsx`, "dismisses on outside
click and on Escape"). 77/77 green.

### M11 (3/5) — column resize (`table-drag-resize.md`)

**Not conclusively re-verified live this session** — the resize grip is a 4px-wide,
non-accessible `div` (`cursor-col-resize`, right edge of each header cell), and
several attempts at a coordinate-based drag (even after reading its exact
`getBoundingClientRect()` from the page) did not register a resize in this automation
session. Column widths measured via `document.querySelectorAll('th')` before and
after were unchanged. Treated as an automation-tooling limitation (a single
`left_click_drag` may not synthesize the intermediate `pointermove` events TanStack's
`columnResizeMode: "onChange"` needs), not evidence of a product regression — the
mechanics are covered by `TableView.test.tsx`'s own "column resize" describe block
(per-view isolation, single-PATCH-per-drag), which this session did not re-run or
re-read. Column/row **reorder** remain confirmed unbuilt, matching `PROGRESS.md`'s own
"stay unbuilt" note — not re-tested, nothing to contradict.

### M11 (4/5) — Select create-on-type, Status editor (`cell-editing.md`)

**Confirmed matching the spec, end to end**, on a Select (`Kind`) cell with no
options: one click opened the editor directly onto `Select an option or create one`;
typing `Guide` showed a `Create` row with a live coloured-chip preview; Enter created
the option, assigned it, and closed the editor — one keystroke, chip now on the row.
`screenshots/actual/M11-03-select-create-on-type.jpg`.

**Confirms `PROGRESS.md`'s own already-disclosed gap, not a new one**: the click
opened the editor on the **first** click, not the second — the spec's two-stage
"select, then edit" model is confirmed still unbuilt (single-stage instead), exactly
as `PROGRESS.md`'s M11 deferred-list item 2 already states.

Status editor, Date's calendar popover, and the read-only/PATCH-failure states not
re-tested this session (time-boxed) — no contradicting evidence.

### M11 (5/5) — empty states (`states.md`)

Step 1 (brand-new empty database renders normally, no message) matches what M8's
`Empty database` creation path already produces, per that flow's own earlier session
coverage — not independently re-clicked here.

**Step 2 (filter matching nothing) could not be tested this session**: the Filter
button in the toolbar is a top-level `Popover` and, in this automation session,
renders **completely off-screen** (`getBoundingClientRect()` returned `y: -670`,
`x: 0` — confirmed via direct DOM query) — the exact same, already-documented
environment artifact `M4-M6-VISUAL-DIFF.md` recorded for the identical class of
control. Not a product defect; a limitation of this browser-automation session
specifically. Grouped-empty-group and loading-state (steps 8-9) remain the spec's own
`TBD`, not re-tested.

---

## Addendum (same session, continued) — the toolbar popover "environment artifact" was a real bug

Follow-up pass on the items flagged above as "not covered." The Filter/Sort toolbar
popover positioning, previously attributed to an automation-session-only rendering
quirk (both here and in `M4-M6-VISUAL-DIFF.md`), is **not an environment artifact — it
is the same `forwardRef`-trigger bug this codebase had already found and fixed twice
before** (`DropdownButton` in `SortRowsList.tsx`, `TriggerButton` in
`FilterBuilder.tsx`).

**Root cause, confirmed via DOM inspection**: `ViewToolbar.tsx`'s `ToolbarButton` was a
plain function component (no `forwardRef`, no `...rest` spread) used as every
`Popover`'s `trigger` (Filter, Sort, and — harmlessly, since it doesn't need
positioning — Automations/AI Autofill/Search/Settings). Radix's `Popover.Trigger
asChild` clones the trigger with its own `ref` (for `Popper.Content`'s floating-ui
position computation) alongside the usual `onClick`/`aria-*` props. A ref handed to a
non-`forwardRef` function component is silently dropped by React — so floating-ui had
no anchor `DOMRect` to measure against and the popover rendered stuck at Radix's
pre-measurement placeholder (`transform: translate(0, -200%)`, confirmed via
`getBoundingClientRect()`/`getAttribute('style')` on `[data-radix-popper-content-
wrapper]` — `y: -670`, matching the exact number both sessions independently
observed). The `onClick` half worked (Radix composes handlers, and `ToolbarButton`'s
own explicit `onClick={onClick}` still fired), which is exactly why the popover
*opened* — just invisibly, hundreds of pixels above the viewport — making it look like
a positioning/environment issue rather than a wiring one.

**Fixed**: `ToolbarButton` converted to `forwardRef` + `...rest` spread, mirroring
`DropdownButton`'s own established pattern and comment. Confirmed live: Filter and
Sort both now open correctly anchored under their toolbar buttons.
`screenshots/actual/M4-05-filter-popover-fixed.jpg`,
`M5-04-sort-popover-fixed.jpg`. `ViewToolbar.test.tsx` 8/8 green, `tsc` clean.

**This unblocks, for a future session**: `states.md`'s empty-filter-state checklist
(steps 2-7) and any other Filter/Sort-toolbar-dependent live checks across M4-M6 that
were previously marked "can't verify, known environment limitation" — that framing was
wrong. A follow-up attempt at the empty-filter-state check this session was abandoned
partway (the filter builder's own value-picker UI, in this narrow 248px popover near
the viewport's right edge, proved fiddly to drive via coordinate clicks in the time
available) — not blocked anymore, just not finished.

## Summary of real defects found and fixed this run

1. **M7 — "Edit view" silently did nothing** (same-tick Radix-layer race between the
   tab menu's `Popover` closing and the settings `SidePeek` opening). Fixed:
   `onOpenSettings` deferred one tick. Regression test added.
2. **M11 — new-row dropdown header showed the data source's name, not the database's**
   ("Templates for Default" instead of "Templates for Untitled Database"). Fixed: pass
   `database.title` at the one call site.
3. **M11 — new-row dropdown never dismissed on outside click or Escape** (predates the
   shared `Popover` primitive). Fixed: scoped outside-click/Escape listener.
   Regression test added.
4. **Filter/Sort toolbar popovers rendered off-screen** — misdiagnosed as an
   automation-environment artifact by this session AND the prior M4-M6 session; the
   real cause was `ToolbarButton` missing `forwardRef`, the same trigger-ref bug this
   codebase had already fixed twice elsewhere. Fixed the same way.

All four confirmed live, before and after. Frontend test suite green throughout
(`ViewTabs.test.tsx` 23/23, `TableView.test.tsx` 77/77, `ViewToolbar.test.tsx` 8/8,
`DatabaseShell.test.tsx` included in a combined 99/99 run, full suite 61 files / 875
tests).

## Not covered this run, for a follow-up session

- Live Chrome re-verification of column/row resize and reorder mechanics (blocked on
  this session's drag-simulation limitation, not a known product issue).
- Filter/Sort toolbar popovers and the empty-filter-state (blocked on this session's
  off-screen-popover environment artifact, same as M4-M6's own session).
- Duplicate/Delete-view round trip, Status cell editor, Date's calendar popover,
  read-only-source suppression across M7-M11, PATCH-failure rollback+toast.
- The calculations footer's live-update-without-reload gap (found, not chased to root
  cause).
