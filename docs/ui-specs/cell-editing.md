# Cell editing

> **Milestone:** M11
> **Ground truth:** `raw-dom/cell-editing.txt` · `screenshots/85a`–`85d`, `88-cell-date.jpg`
> **Today:** `components/database/cells/` — 12 components, each opening its editor on the
> **first** click.
> **Binds to:** `PropertyValue` union (`lib/database/types.ts:279-317`), `updateCell`.

---

## Cell interaction is two-stage

| Gesture | Result |
|---|---|
| **1st click** | **Selects** the cell — a blue border, plus a small circle at the bottom-right corner. **No editor opens** |
| **2nd click** | Opens the editor **in place** |

Our cells open their editor on the first click. **This is a behavioural difference, not a
visual one** — Notion's first click is spreadsheet-style selection.

`Enter` on a selected cell did **not** open the editor in the one test run. `TBD` whether
Enter works for other types or a second click is the only route.

The **corner circle** appears on cell selection. Its behaviour is `TBD` — do **not** assume
it is Excel-style drag-fill without capturing it.

---

## Select

Opens **in place**: the cell itself becomes a search input, with a panel below.

| State | Content |
|---|---|
| No options exist | `[ Search for an option… ]` + muted `Select an option or create one` |
| Typing `Alpha` | Adds a row `Create  [Alpha]` where **`Alpha` renders as a coloured chip preview** |
| After Enter | Option created, assigned, editor closed — **one keystroke does all three** |

Notion **auto-assigns the colour**; the user does not pick it at creation time.

> We have **no create-on-type at all** — a select option can only be added by editing the
> property. This is the single biggest cell-editing gap.

---

## Date — the most complex editor

Popover anchored to the cell, ~250px.

```
[ Aug 31, 2026 ]  [ Aug 31, 2026 ]      ← start | end (second only when End date is on)
Aug 2026                Today   ‹  ›
Su  Mo  Tu  We  Th  Fr  Sa              ← week starts Sunday
26  27  28  29  30  31   1              ← adjacent-month days greyed
 …
30  (31)  1   2   3   4   5             ← today: filled blue circle
─────────────────────────────
End date              [toggle ON]
Date format      Full date       >
Include time          [toggle OFF]
Remind                 None      >
─────────────────────────────
Clear
?  Learn about reminders
```

| Element | Notes |
|---|---|
| Date inputs | **Two** when `End date` is on, **one** when off — the second appears with the toggle |
| `Today` | A text shortcut in the calendar header, not a row |
| `Clear` | A plain row, **not** danger-styled |
| `? Learn about reminders` | The same help-link idiom as `Learn about grouping` |

### Scope

| Feature | Ours |
|---|---|
| start / end / time | ✅ `DateValue` already models these |
| **Date format** | ❌ new — presentation, **schema-level** (per property) |
| **Remind** | ❌ **out of scope** — we have no notification feature. Note and skip |

`TBD` — the `Date format` and `Remind` sub-panels, and the time picker when `Include time`
is on.

---

## Status — and why it could not be inferred from Select

```
[ Search for an option ]        ← no ellipsis, unlike Select's "Search for an option…"
To-do
  ● Not started                 ← coloured DOT + label, not a filled chip
─────────────
In progress
  ● In progress
─────────────
Complete
  ● Done
─────────────
⚙  Edit property                ← a row inside the cell editor
```

**Four differences from Select**, three of which a "same as Select" spec would have got
wrong:

| | Select | Status |
|---|---|---|
| Grouping | flat list | **grouped** under To-do / In progress / Complete, with headers and dividers |
| Create-on-type | ✅ `Create [x]` | **❌ none** — options are managed on the property |
| Option rendering | filled **chip** | **coloured dot** + label |
| Footer | none | **`Edit property`** row linking to the property config |
| Search placeholder | `Search for an option…` | `Search for an option` — **copy differs per type** |

Our `StatusCell` renders a flat list. Our backend already models status groups
(`GroupBySpec.mode: "option" | "group"`), so the data exists.

## Other types

`TBD` — **capture before M11.** Text (expanded editor), Number, Multi-select (multiple
chips), Person, Files & media, URL, Checkbox.

**Do not write these from the Select, Status and Date patterns.** Three captured editors
have now differed from one another in placeholder copy, option rendering, create-on-type
and footer rows. Assume each type differs until captured.

---

## Keyboard

| Key | Behaviour | Status |
|---|---|---|
| 1st click | Selects | confirmed |
| 2nd click | Opens the editor | confirmed |
| Enter on a selected cell | Did **not** open the editor | confirmed, one type only |
| Enter in the Select editor | Creates + assigns + closes | confirmed |
| Escape | Commits and closes | confirmed |
| Arrow keys between cells | `TBD` — the two-stage model implies spreadsheet navigation |

---

## States

| State | Behaviour |
|---|---|
| Cell at rest | Value, or nothing |
| Cell selected | Blue border + corner circle |
| Cell editing | Editor in place or anchored |
| Empty in the **peek** | The literal muted word `Empty` |
| Empty in the **table** | Blank |
| Read-only source (`is_virtual`) | Editors must not open; ours already threads `editable` |

> Note the asymmetry: the **peek** writes `Empty`, the **table** leaves it blank. Both are
> deliberate; the spec must not unify them.

---

## Persistence

Every editor writes through the existing `updateCell` path — optimistic update, then
`PATCH /db/data-sources/{id}/rows/{noteId}`, rolling back and toasting on failure
(`useDatabaseView.ts:245-301`). **No backend change.**

Creating a select option from a cell also writes **schema**
(`PATCH /db/properties/{id}` `{config}`) — a second, different write from the same
interaction. Sequence them: create the option first, then assign it.

---

## Checklist

1. Click a Select cell once. → assert it is **selected** (blue border, corner circle) and **no editor opened**.
2. Click again. → assert the editor opens **in place**, the cell becoming a search input.
3. On a property with no options. → assert the copy `Select an option or create one`.
4. Type a new name. → assert a `Create` row appears with the name as a **coloured chip preview**.
5. Press Enter. → assert the option is created, assigned, and the editor closes — one keystroke.
6. → assert the option now exists on the property (visible in Edit property).
7. Click a Date cell twice. → assert a calendar popover with a month label, `Today`, and `‹ ›`.
8. → assert today is marked with a filled circle and adjacent-month days are greyed.
9. Toggle `End date` on. → assert a **second** date input appears.
10. Toggle it off. → assert the second input disappears.
11. → assert rows `Date format`, `Include time`, `Remind`, `Clear` are present.
12. Click `Clear`. → assert the cell empties.
13. Open the same row in the **peek**. → assert empty properties read the literal word `Empty`, while the **table** leaves them blank.
14. On a read-only source. → assert clicking a cell selects but never opens an editor.
15. Force the PATCH to fail. → assert the optimistic update rolls back and a toast appears.
