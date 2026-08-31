# Table column header menu

> **Milestone:** M1 — the first surface after the primitive layer, and the biggest single win.
> **Ground truth:** `raw-dom/table-column-header-menu.txt` · `screenshots/02-header-menu-text.jpg`,
> `05-header-change-type-flyout.jpg`, `70-calculate-flyout-l2.jpg`, `71-calculate-count-flyout-l3.jpg`
> **Today:** `views/TableView.tsx:326-331` renders `property.name` as a plain string for every
> type except `button`. This entire surface is missing.
> **Binds to:** `PropertyResponse` (`lib/database/types.ts:35`), `view.config` for per-view
> state (visibility, width, wrap, order), `PATCH /db/properties/{id}`, `DELETE /db/properties/{id}`.

---

## Trigger

The column header cell itself. A plain **left-click anywhere on the header cell** opens the
menu — there is no separate chevron or `⋮` affordance to aim at, and none appears on hover.

Hover state of the header cell itself: `TBD` — needs a light-mode hover screenshot of a
header cell with nothing open (checklist shot 01).

**Right-click on a header opens the same menu**, anchored to the header cell exactly as
left-click does. There is no separate context menu. (Confirmed 2026-08-31.)

---

## Anchor

| Property | Value |
|---|---|
| Placement | Below the header cell, left edges aligned |
| Width | **245px** (measured at a 1300px viewport) |
| Max height | Constrained to the viewport; the list scrolls — "Delete property" was below the fold at 593px viewport height |
| Scroll | Vertical, inside the menu, with a visible scrollbar track |
| Flip / shift | `TBD` for the root menu. **Confirmed for sub-panels** — see Sub-panels |
| Offset from trigger | `TBD` — needs a measured light-mode screenshot |

---

## Header of the menu — not a row

Above the first row, the menu carries an **editable name field**:

```
[ type icon ]  [ text input, value = the property name ]  [ ⓘ ]
```

- The property is **renamed in place, here**. There is no "Rename" row anywhere in the menu.
- The leading icon shows the property's current type.
- The trailing `ⓘ` is **"Add property description"** (confirmed from its tooltip). It adds a
  description to the property. Our `PropertyResponse` already has a `description` field, but
  `PropertyUpdate` cannot write it — **plan gap B3, confirmed needed**.

This is a repeated Notion pattern, not a one-off: the view settings sidebar names a view the
same way. Adopt it as the general "name an entity in its own config panel" shape.

---

## Rows

Fourteen rows, in three divider-separated groups, in this exact order.

| # | Icon | Label | Right side | Sub-panel | Effect |
|---|---|---|---|---|---|
| 1 | type-change | **Change type** | — | ✅ flyout | Opens the type list. See Sub-panels §A |
| 2 | sparkle | **AI Autofill** | badge `Now with agents` | ✅ flyout | `TBD` — not captured. Out of scope for us (no equivalent), spec as omitted |
| — | | *divider* | | | |
| 3 | filter | **Filter** | — | ❌ | Adds a filter on this property and opens the filter surface. Exact behaviour `TBD` |
| 4 | sort | **Sort** | — | ✅ flyout | Two rows: **Sort A → Z** / **Sort Z → A**. Labels are **type-aware** — render from the property type, not a generic asc/desc |
| 5 | group | **Group** | — | ❌ | Groups the view by this property immediately |
| 6 | sigma | **Calculate** | — | ✅ flyout | Sets this column's calculation. See Sub-panels §B |
| 7 | pin | **Freeze** | — | ❌ | Freezes columns up to and including this one |
| 8 | eye-off | **Hide** | — | ❌ | Hides this property in this view |
| 9 | arrow | **Unwrap content** | — | ❌ | **State-dependent label.** Content is currently wrapped, so the offered action is to unwrap. Render from state; never hardcode "Wrap" |
| — | | *divider* | | | |
| 10 | insert-left | **Insert left** | — | ❌ | Creates a new property immediately left of this one |
| 11 | insert-right | **Insert right** | — | ❌ | Creates a new property immediately right of this one |
| 12 | copy | **Duplicate property** | — | ❌ | Duplicates the property and its values. **Rendered greyed in the capture** — reason not established; see States |
| 13 | trash | **Delete property** | — | ❌ | Deletes the property. Below the fold in the capture; confirm whether it is `danger`-styled |

> Row 13 is the 14th item counting the divider groups as authored; the capture's verbatim
> list is 14 labels. Re-verify the exact count on the title column, which differs.

### What our current UI has

None of it. For comparison, the closest existing thing is
`ButtonPropertyConfigPopover.tsx`, which is a single anchored popover on button-typed
columns only.

### The row set is a function of property type

Not a constant with rows hidden. At least three shapes to model:

| Property | Rows |
|---|---|
| **Title** | 11 — no Change type / Hide / Duplicate / Delete; adds a `Show page icon` toggle |
| **Ordinary** (Text, Number, Select, …) | 14, as tabled above |
| **Computed** (Formula, Rollup) | `TBD` — checklist shot 08 |

Derive the list from the property. Do not ship one static array.

### Rows this surface implies we cannot yet build

- **Freeze** — needs sticky columns in the table. No equivalent exists.
- **Duplicate property** — no backend endpoint. Client-side POST with the same
  `type` + `config` is faithful *except for relation properties*, which must be created
  through `POST .../relations` (`TableView.tsx:482-489`). Spec as: enabled for
  non-relation types, disabled with a reason for relations.
- **Change type** — conversion legality is a real rule (see §A). Our backend has no
  endpoint describing which conversions are legal. **Flagged as a backend sub-task.**

---

## Sub-panels

Sub-panels here are **adjacent flyouts**: a second panel opens beside the menu and the
parent stays fully visible. There is no back arrow, because nothing is hidden.

> This differs from the config sidebar, which pushes/pops with a back arrow. Both models
> exist in Notion. `MenuList` must support both; this surface uses flyout mode.

### §A — "Change type"

- Opens to the **right** of the parent menu, top-aligned near the viewport top.
- **Single column** — note this differs from the "+ Add property" type picker, which is a
  two-column grid of the same types. Column count is per-panel.

| Row | Right side | Notes |
|---|---|---|
| Text | ✓ | The current type carries a trailing checkmark |
| Number | | |
| Select | | |
| Multi-select | | |
| Status | | |
| Date | | |
| Person | | |
| Files & media | | |
| Checkbox | | |
| URL | | |
| Email | | |
| Phone | | |
| Formula | | |
| Relation | | **Disabled/greyed** — a Text property cannot convert to a Relation |
| … | | List scrolls; rows below the fold `TBD` |

`disabled` here is **semantic**: conversion legality varies by source type. The list is a
filtered, annotated view of the type set — not the same list as "add property".

### §B — "Calculate" → "Count"

Three levels of nesting: menu → `Calculate` → `Count` → the functions.

**Level 2 — `Calculate`** (opens right):

| Row | Right side | Sub-panel |
|---|---|---|
| None | ✓ | ❌ |
| Count | | ✅ |
| Percent | | ✅ — contents `TBD` |

**Level 3 — `Count`** — **opens to the LEFT.** There was no room on the right; level 2
already ran to x≈1077 in a 1300px viewport. Each level makes its own flip decision.

| Row | Kind | Notes |
|---|---|---|
| Show large counts as 99+ | **toggle** | Carries a description line: *"This improves performance for large databases."* Currently off |
| *divider* | | |
| Count all | row | |
| Count values | row | |
| Count unique values | row | |
| Count empty | row | |
| Count not empty | row | |

> This function set is the same one `calculations-row.md` (§11) needs. Captured on a **Text**
> property; numeric and date properties will offer more branches (Sum, Average, …).
> `TBD` — re-capture on the Number and Date columns.
>
> **Sequencing consequence for the plan:** calculations are reachable from this menu at M1,
> not only from the footer row at M11. Either M1 ships the Calculate sub-panel, or M1 ships
> a row that does nothing. Decide before M1 starts.

Our engine already implements every function seen — `services/db/query/aggregations.py`
covers count, count_values, unique, empty, not_empty, percent_empty, percent_checked, sum,
average, median, min, max, range, earliest_date, latest_date, date_range, checked,
unchecked. Only the UI is missing.

---

## Keyboard

Established with real key events, 2026-08-29.

**Notion's version of this menu is not keyboard-navigable as a menu.**

| Key | Notion's actual behaviour | Our spec |
|---|---|---|
| ↑ / ↓ | **Nothing.** Focus stays in the name input; arrows move the text caret. No active row, no roving selection | **Deviate:** move the active row |
| → | Not observed | Open the active row's flyout |
| ← | Not observed | Close the current flyout |
| Enter | Not observed | Activate the active row |
| Esc | **Closes.** One press from the name input; two when a tooltip is showing, because the first press dismisses the tooltip | Closes, returns focus to the header cell |
| Tab | Plain DOM focus order — name input → ⓘ → … Does not enter the list as a menu | Keep DOM order, but arrows also work |
| typing | No search field in this menu (confirmed absent, not merely uncaptured) | Same — no search |

### A deliberate deviation, and why

Notion's keyboard model is **per-panel**, tied to whether the panel has a search field:
panels *with* search (the type picker, the row menu, the sidebar panels) use the combobox
model — input focused, ↑/↓ moving an active row. Panels *without* search, like this one,
fall back to plain DOM focus order with no arrow navigation.

**We implement arrow navigation on every panel, search or not.** A 14-row menu that cannot
be driven from the keyboard is an accessibility regression against the native `<select>`
elements this work replaces. This is one of the few places where matching Notion exactly
would make our product worse, so we match its *shape* and not its *keyboard*.

---

## States

| State | Behaviour |
|---|---|
| Title column | **Captured.** Eleven rows, not fourteen. `Change type`, `Hide`, `Duplicate property` and `Delete property` are all **absent**; a `Show page icon` **toggle** is present instead (also settable at view level in Layout — the two must stay in sync). See shot 07 |
| Formula column | `TBD`, checklist shot 08 |
| Button column | Ours currently shows `ButtonPropertyConfigPopover`. Must be folded into this menu, not left as a parallel surface |
| Empty database (0 rows) | Menu renders identically — captured in exactly this state |
| `Duplicate property` greyed | Observed greyed on a fresh Text property. **Unverified why.** Re-check on a populated property before claiming a disabled state |
| Read-only source (All Notes, `is_virtual`) | Our own case, no Notion equivalent. The whole menu should be suppressed, matching `DatabaseShell.tsx:400`'s existing "hidden rather than shown-disabled" rule |
| Loading | Not applicable — the menu is built from already-loaded `properties` |
| Error | A failed `PATCH`/`DELETE` surfaces via `useToast()`. No inline error region in Notion's menu |

---

## Persistence

| Action | Writes | When |
|---|---|---|
| Rename (header field) | `PATCH /db/properties/{id}` `{name}` | On blur, and on Enter |
| Change type | `PATCH /db/properties/{id}` `{type}` — **note:** our `PropertyUpdate` accepts only `name` and `config`, **not `type`**. Backend sub-task, or the conversion is a delete+create | Immediately on pick |
| Filter / Sort / Group / Calculate / Freeze / Hide / Unwrap / order | `PATCH /db/views/{id}` `{config}` — all per-view, all JSONB pass-through, **no backend change needed** | Immediately |
| Insert left / right | `POST /db/data-sources/{id}/properties`, then a view-config write to position it | Immediately |
| Duplicate property | Client-side `POST .../properties` with the same type+config. Disabled for relations | Immediately |
| Delete property | `DELETE /db/properties/{id}` | Immediately. Confirm whether Notion asks first — `TBD` |

Nothing here saves on menu close. Every row applies immediately.

---

## Checklist

Run in Chrome against our app with `./app.sh start`. One assertion per step. Screenshot each
step into `screenshots/actual/` as it is taken.

1. Open a database with at least one Text property and one row. → the table renders.
2. Hover a non-title column header. → assert the header's hover state matches shot 01.
3. Click the header cell anywhere. → assert a menu opens, anchored below-left, **245px wide**.
4. → assert the menu's first element is a **text input** containing the property name, with a leading type icon and a trailing ⓘ.
5. → assert the rows are exactly, in order: Change type, AI Autofill*, Filter, Sort, Group, Calculate, Freeze, Hide, Unwrap content, Insert left, Insert right, Duplicate property, Delete property. (*if AI Autofill is scoped out, assert its absence deliberately.)
6. → assert dividers fall after "AI Autofill" and after "Unwrap content".
7. → assert `Change type`, `Sort` and `Calculate` show a chevron; `Filter`, `Group`, `Freeze`, `Hide`, `Unwrap content`, `Insert left`, `Insert right`, `Duplicate property`, `Delete property` do not.
8. Type a new name into the header field and blur. → assert the column header text updates and a `PATCH /db/properties/{id}` fired.
9. Click `Change type`. → assert a flyout opens **to the right** and **the parent menu is still visible**.
10. → assert the flyout is **single-column** and the current type carries a ✓.
11. → assert at least one illegal conversion is rendered disabled with a reason on hover.
12. Reopen the menu, click `Calculate`. → assert a flyout opens with None ✓ / Count / Percent.
13. Click `Count`. → assert a third-level flyout opens, and that it **flips to the left** when there is no room on the right.
14. → assert its first row is a **toggle** labelled "Show large counts as 99+" with the description "This improves performance for large databases." beneath it.
15. → assert the function rows are Count all, Count values, Count unique values, Count empty, Count not empty.
16. Pick `Count all`. → assert the column footer shows the count and the choice persisted to `view.config`.
17. Click `Hide`. → assert the column disappears and reappears in view settings → Property visibility as hidden.
18. Click `Unwrap content` on a wrapped column. → assert the label reads "Wrap content" next time the menu is opened.
19. Press Escape with the menu open. → assert it closes and focus returns to the header cell.
20. Open the menu on the **title** column. → assert the reduced row set of shot 07, and that Delete/Change type are absent or disabled.
