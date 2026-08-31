# Sort panel

> **Milestone:** M5
> **Ground truth:** `raw-dom/group-and-sort-panels.txt` · `screenshots/32-sort-new-panel.jpg`,
> `32b-sort-from-toolbar-popover.jpg`, `33-sort-one-applied.jpg`, `34-sort-multi.jpg`
> **Today:** **does not exist.** `useDatabaseView.loadRows()` posts `activeView.sorts` and
> the backend sorts correctly — nothing in the UI can set it.
> **Binds to:** `ViewResponse.sorts`, `PATCH /db/views/{id}` `{sorts}`,
> `SortSpec {property, direction}` in `backend/services/db/query/ast.py`.
> **No backend change needed.**

---

## Trigger

Three entry points to the same panel:

1. The **`Sort`** button in the view toolbar → renders as an **anchored popover**
2. The **`Sort`** row in the view settings sidebar → renders as a **pushed panel** with a back arrow
3. The **sort chip** in the bar, once a sort exists → **anchored popover** under the chip

Panel content is identical in all three; the host decides the container.

---

## Anchor

| Host | Placement | Width |
|---|---|---|
| Toolbar button | Popover below, right-aligned | ≈290px |
| Settings sidebar | Pushed panel, back arrow | 483px |
| Sort chip | Popover below the chip, left-aligned | ≈345px (grows with content) |

---

## Rows — stage 1, no sort yet

| Element | Detail |
|---|---|
| Title | **"New sort"** — not "Sort". Sorts are a list, so the action is additive |
| Search | `Sort by…`, autofocused. Note: a **different placeholder** from Group's `Search for a property…` |
| List | Every sortable property, **alphabetically** |

Captured list: Name, Checkbox, Date, **Files**, Multi-select, Number, Person, Select,
Status, Text, URL.

> `Files` is present here but **absent from Group**. Each panel needs its own eligibility
> predicate — not one shared "supported types" list.

There is **no `None ✓` row**, unlike Group. Nothing is selected yet because nothing exists.

---

## The sort chip

Appears in the same bar as the filter chip, **before** it:

| State | Chip |
|---|---|
| One sort | `↑ Name ▾` — direction arrow + **property name** |
| Two or more | `⇅ 2 sorts ▾` — a **count** |

Singular is specific, plural is generic. Same pattern as the filter's `1 rule`.

---

## Rows — stage 2, the sort editor

```
⠿  [Aa Name   ▾]  [Sort A → Z      ▾]  [×]
⠿  [#  Number ▾]  [Sort low → high ▾]  [×]
+  Add sort
🗑  Delete sort
```

### Row anatomy

| Slot | Content |
|---|---|
| Drag handle `⠿` | Reorders. **Row order is sort precedence** |
| Property `▾` | Dropdown with the property's type icon + name |
| Direction `▾` | **Type-aware label** — see below |
| `×` | Removes **this one** sort |

### Footer rows

| Row | Effect |
|---|---|
| `+ Add sort` | Opens the property picker |
| `🗑 Delete sort` | Removes **all** sorts — distinct from the per-row `×` |

### Direction labels are type-aware

Proven with two data points:

| Property type | Ascending | Descending |
|---|---|---|
| Title / Text | `Sort A → Z` | `Sort Z → A` |
| Number | `Sort low → high` | `Sort high → low` |
| Date | *presumed* `Sort earliest → latest` | `TBD` — not captured |
| Checkbox, Select, … | `TBD` |

**Render the label from the property type. Never a generic "Ascending/Descending".**
`SortSpec` stays `{property, direction: "asc"|"desc"}` on the wire — this is presentation
only, and needs no backend change.

### "Add sort" excludes already-sorted properties

Once `Name` was sorted it **disappeared** from the Add-sort picker. The picker is filtered
against the current sort list, so the same property cannot be sorted twice.

`Status` rendered **greyed** in that picker. Cause not established — possibly because the
Status property has no options configured. **Observed, not explained**; re-test with
options present before the spec claims a rule.

---

## Keyboard

`TBD` throughout — not tested with real key events on this surface.

The property picker is autofocused, so it should follow the combobox model.

---

## States

| State | Behaviour |
|---|---|
| No sort | Panel titled **"New sort"**, no chip in the bar, no `None` row |
| One sort | Chip shows the property name and a direction arrow |
| Two or more | Chip shows a count; rows are drag-reorderable |
| All properties sorted | Add-sort picker would be empty. `TBD` — what renders |
| Locked view (`is_locked`) | `TBD` |
| Read-only source (`is_virtual`) | All Notes sorts fine server-side; keep enabled |
| Sort references a deleted property | Backend tolerates dangling refs at read. UI must render without crashing — `TBD` how Notion does it |

---

## Persistence

| Action | Writes | When |
|---|---|---|
| Add a sort | `PATCH /db/views/{id}` `{sorts}` | Immediately |
| Change property or direction | same | Immediately |
| Reorder (drag) | same, new array order | On drop |
| Remove one (`×`) | same, minus that entry | Immediately |
| `Delete sort` | `{sorts: []}` | Immediately |

`loadRows()` re-queries automatically — its effect is keyed on
`JSON.stringify(activeView.sorts)` (`useDatabaseView.ts:196-203`).

> `sorts` is a separate `ViewPatch` field from `config`, so `DatabaseShell`'s
> `patchViewConfig` queue (`:81-125`) does **not** cover it. Two rapid sort edits must not
> lose the first — widen the helper or add an equivalent queue for `sorts`. Same hazard as
> `filter`.

---

## Checklist

1. Open a database with at least a Text and a Number property and 3+ rows with differing values.
2. Click the toolbar `Sort` button. → assert a popover titled **"New sort"** with an autofocused input placeholdered `Sort by…`.
3. → assert properties are listed **alphabetically** and `Files` is present.
4. → assert there is **no `None` row**.
5. Pick `Name`. → assert the rows reorder and a chip `↑ Name` appears in the bar, **before** any filter chip.
6. → assert the editor shows one row: drag handle, `Name`, `Sort A → Z`, and an `×`.
7. Open the direction dropdown. → assert the labels read **`Sort A → Z` / `Sort Z → A`**, not Ascending/Descending.
8. Click `+ Add sort`. → assert `Name` is **absent** from the picker.
9. Pick `Number`. → assert a second row appears with the direction label **`Sort low → high`**.
10. → assert the bar's chip now reads **`2 sorts`**, a count rather than a name.
11. Drag the second row above the first. → assert the table re-sorts by Number first, and the order persists across reload.
12. Click one row's `×`. → assert only that sort is removed and the other remains.
13. Click `Delete sort`. → assert **all** sorts are removed and the chip disappears.
14. Open `Sort` from the **view settings sidebar**. → assert identical content rendered as a **pushed panel with a back arrow**.
15. Open `Sort` from the **chip**. → assert identical content in a popover anchored under the chip.
16. Apply a sort on a **Date** property. → assert the direction labels are date-appropriate, not `A → Z`.
17. Make two sort edits within ~200ms. → assert **both** persist after reload.
18. Sort a view, reload. → assert the sort survived and `view.sorts` holds `[{property, direction}]`.
