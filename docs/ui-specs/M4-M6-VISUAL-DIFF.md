# 0c / M4 / M5 / M6 — live run, for the visual diff

> **This is exit criterion 4** for this batch (0c, M4, M5, M6) — same rule M1's own
> file states: nothing ships as done until the screenshots below are compared against
> what "Notion-like" should look like and someone says what is off. Run 2026-09-01
> against `localhost:3000` via `claude-in-chrome`, on a throwaway local fixture
> database ("Untitled Database", view "V5" / later "Default view" — 8 properties:
> Title, Count(Number), Kind(Select), Topics(Multi-select), Mastery(Status), Due(Date),
> Done(Checkbox), Link(URL); 2 rows).
>
> **Known environment limitation, not a product defect (see below):** every top-level
> toolbar Popover (Filter/Sort buttons, and the floating sort/filter chips) rendered
> completely off-screen in this automation session — confirmed via DOM inspection
> (`getBoundingClientRect()` returned `y` values around `-256` to `-670`, i.e. hundreds
> of pixels above the viewport) even though the popover's own content was correct.
> Resizing the browser window didn't change `window.innerHeight` (stuck at 593px),
> suggesting the automation tool's own viewport reporting is what's off, not the app.
> Popovers docked or nested one level deeper (the Settings sidebar itself, and popovers
> opened *from inside* that sidebar, e.g. the group-order picker) positioned and
> screenshotted correctly. **Because of this, the toolbar's own Filter/Sort buttons
> could only be checked via DOM inspection, not screenshotted** — the settings
> sidebar's identical panel content (same `MenuPanel` data, different host) was used
> for the actual screenshots below. This needs a real browser check to confirm the
> toolbar buttons render on-screen normally outside this automation session.

## Screenshots

| Step | File |
|---|---|
| Settings sidebar root — Layout/Property visibility/Filter/Sort/Group/… row order | `actual/m6-01-settings-sidebar.jpg` |
| Group by picker — alphabetical, `None ✓`, nothing disabled (0c widened the list) | `actual/m6-02-group-by-picker.jpg` |
| Grouped table, live — repeated headers, `No Kind` empty bucket, `+ New group` | `actual/m6-03-grouped-table-live.jpg` |
| One group collapsed — header stays, rows hidden | `actual/m6-04-group-collapsed.jpg` |
| Group stage-2 panel — Group by/Sort/Hide empty groups/Groups+Hide all/per-group rows | `actual/m6-05-group-panel-stage2.jpg` |
| Per-group eye toggle — hides that group from the table, stays listed (greyed) in the panel | `actual/m6-06-per-group-hidden.jpg` |
| Group-order popover — Manual ✓ / Alphabetical / Reverse alphabetical | `actual/m6-07-group-order-popover.jpg` |
| Reverse-alphabetical applied — table order + panel order both flip | `actual/m6-08-group-order-reverse-alpha.jpg` |
| Remove grouping — table flattens back to the ordinary view | `actual/m6-09-remove-grouping-flattened.jpg` |
| Filter property picker — alphabetical, `+ Add advanced filter` | `actual/m4-01-filter-picker.jpg` |
| Filter builder — `Where Kind ▾ Is ▾ [Value]`, `+ Add filter rule ▾`, `Delete filter` | `actual/m4-02-filter-builder-where-kind-is.jpg` |
| Filter chip narrows the table live, combined with an active grouping | `actual/m4-03-filter-chip-narrows-and-grouped.jpg` |
| Sort "New sort" picker — alphabetical, no `None` row | `actual/m5-01-new-sort-picker.jpg` |
| Combined query bar — sort chip (`↑ Count`) before the filter chip (`1 rule`), then `+ Filter` | `actual/m5-02-sort-chip-before-filter-chip.jpg` |

## What the run confirmed

- **0c's widened `GROUPABLE_PROPERTY_TYPES` works end to end live**: the Group by
  picker offered all 8 fixture properties with none disabled (previously only
  Select/Status/Multi-select would have been enabled) — `m6-02`.
- **M6's grouped Table rendering is real**, not just a data shape: each group gets its
  own full repeated column header, its own `+ New page`, and there's a single
  `+ New group` at the bottom (offered because the grouped property, Kind, is
  select-typed) — `m6-03`.
- **The "No `<PropertyName>`" rename works** — the panel and the table both show
  "No Kind" for the implicit empty bucket, never the backend's raw "No value" — visible
  in `m6-02` (panel) and `m6-03`/`m6-08` (table).
- **Collapse, per-group hide, group ordering (Manual/Alphabetical/Reverse alphabetical),
  and Remove grouping all round-tripped correctly**, verified both visually and by
  reading `view.config.group_by` back from `GET /api/db/databases/{id}` after each
  action — `m6-04`, `m6-06`, `m6-07`, `m6-08`, `m6-09`.
- **M4's filter builder applies and narrows live**: picking `Kind` opened `Where Kind
  ▾ Is ▾`, typing `Article,` into the value field committed a chip (confirming the
  `str_or_list` chip-input value editor for Select), and the table narrowed to exactly
  the matching row — `m4-02`, `m4-03`.
- **M4's and M5's combined query bar renders in the documented order** — sort chip,
  then filter chip, then `+ Filter` — `m5-02`.
- **Sort's type-aware direction label is live-correct**: the sort chip's own popover
  (checked via DOM, off-screen per the limitation above) read `Sort ⠿ Count ▾ Sort low
  → high ▾` — the Number-specific label, not a generic "Ascending".
- **No console errors** observed at any point in this run (`read_console_messages`
  checked periodically, pattern `error|Error|exception`, and via `onlyErrors`).

## Not verified this run (flag, don't guess)

- **Drag-reorder itself** (dragging a sort row or a group row to a new position) —
  the affordance (`⠿` handle) is present and correctly wired per the unit tests, but
  simulating an actual pointer-drag through this automation session's off-screen-
  popover issue wasn't attempted; the pure reorder logic (`reorderSorts`,
  `reorderGroups`) is unit-tested and not in question, only the live drag gesture.
- **The nested `Add filter group` / AND-OR-selector flow and the empty-result state**
  — covered by `FilterBuilder.test.tsx`'s unit tests, not re-driven live here; time
  did not allow working through filter-panel.md's and sort-panel.md's full 20/18-step
  checklists item by item on top of the group panel's own 19.
- **Whether the toolbar's Filter/Sort buttons position correctly in a normal browser
  window** — see the limitation note above. This is the one open question that
  actually needs a human (or a differently-configured automation session) to answer;
  everything else in this file was confirmed against real rendered output.
