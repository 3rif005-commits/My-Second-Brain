# Column resize and drag-reorder

> **Milestone:** M11
> **Ground truth:** `raw-dom/resize-and-states.txt` · `screenshots/79-resize-hover-grip.png`,
> `80-resize-applied.jpg`
> **Today:** neither exists. `TableView.tsx:22-26` says so.
> **Binds to:** `view.config` — per-view column width and order. **No backend change.**

---

## Column resize

### Trigger

Hovering the **border between two column headers**.

| Affordance | Detail |
|---|---|
| Grip | A **blue vertical bar** at the border, within the header row |
| Guide | A faint **vertical line** extending down through the table body |
| Cursor | Horizontal-resize |

### Drag

The column resizes **live**; every column to its right shifts accordingly. Verified by
dragging a column from x≈653 to x≈780.

`TBD` — minimum width, double-click-to-autofit, and whether the guide persists for the
whole drag or only on press.

### Persistence

Width is **per-view** → `view.config`, JSONB pass-through. **Do not** use a schema-level
field: the same property can be a different width in different views, exactly as with
order and visibility.

---

## Column reorder

`TBD` — **not captured by dragging a header.** But the mechanism is already known from
`view-options-panel.md`: the **Property visibility** panel lists properties in **table
order** with **drag handles**, and that is where per-view order is set.

So there are likely two ways to reorder: dragging a header directly, and dragging in the
panel. **Capture the header drag before implementing**; the panel path is already specced.

`Insert left` / `Insert right` in the column header menu also affect order — see
`table-column-header.md`.

---

## Row reorder

`TBD` — not captured. The drag handle in the row gutter is the trigger
(`row-affordances.md` documents it as one of its three gestures). Capture the drop
indicator before implementing.

> Row order is **per-view** too, when the view is unsorted. Note the interaction with
> sorting: a sorted view cannot be manually reordered. `TBD` how Notion handles a drag
> attempt on a sorted view — it likely blocks it or offers to clear the sort.

---

## Keyboard

`TBD` throughout. Resize and reorder are pointer gestures; a keyboard-accessible
equivalent (e.g. resizing from the header menu) does **not** appear to exist in Notion.

> **We should provide one.** `@dnd-kit` supports keyboard sensors, and the Property
> visibility panel gives a keyboard-reachable path to reordering. Note this as a
> deliberate accessibility improvement, consistent with the arrow-navigation deviation in
> `table-column-header.md`.

---

## States

| State | Behaviour |
|---|---|
| Hover a border | Grip + guide appear |
| Mid-resize | Column resizes live |
| Sorted view, row drag | `TBD` — likely blocked |
| Grouped view, row drag | `TBD` — dragging between groups presumably sets the group property |
| Read-only source | Resize should still work (it is view state); reorder too |

---

## Persistence

| Action | Writes |
|---|---|
| Resize | `PATCH /db/views/{id}` `{config}` — column width, **debounced** so a drag is one write |
| Column reorder | `PATCH /db/views/{id}` `{config}` — property order |
| Row reorder | `PATCH /db/views/{id}` `{config}` — row order |

All three are `config`, so route through `patchViewConfig` (`DatabaseShell.tsx:81-125`).
A resize drag must **not** fire a PATCH per mouse-move.

---

## Checklist

1. Hover the border between two column headers. → assert a **blue vertical grip** appears in the header and a **guide line** runs down the body.
2. → assert the cursor becomes a horizontal-resize cursor.
3. Drag it right by ~100px. → assert the column widens live and columns to its right shift.
4. Release. → assert **exactly one** `PATCH /db/views/{id}` fired for the whole drag, not one per mouse-move.
5. Reload. → assert the width persisted.
6. Open the same database in a **different view**. → assert that view's width is **unchanged** — width is per-view.
7. Drag a column header sideways. → assert a drop indicator and that the order changes (capture Notion's indicator first).
8. Open Settings → Property visibility. → assert the order there matches the table's new order.
9. Reorder in that panel instead. → assert the table matches.
10. Drag a row by its gutter handle. → assert a drop indicator and that the new order persists.
11. Apply a sort, then try to drag a row. → assert the documented behaviour (capture first).
12. Group the view, drag a row into another group. → assert its group property value changes.
13. With keyboard only, reorder a property via the Property visibility panel. → assert it works (our deliberate addition).
