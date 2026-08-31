# Calculations row

> **Milestone:** M11
> **Ground truth:** `raw-dom/calculations.txt`, `table-column-header-menu.txt` ·
> `screenshots/70-calculate-flyout-l2.jpg`, `70b`, `70c`, `71`, `72-calc-applied-sum.jpg`
> **Today:** **does not exist.** `TableView.tsx:22-26` says so explicitly.
> **Binds to:** `view.config` per-column calculation, and
> `backend/services/db/query/aggregations.py` — **already complete**.

---

## Trigger — two entry points, and one of them is M1

| Entry point | Milestone |
|---|---|
| Column header menu → **`Calculate`** | **M1** — already specced in `table-column-header.md` |
| The footer row beneath the table, per column | M11 |

> **DECIDED 2026-08-31: M1 ships the `Calculate` sub-panel** (the function tree, its
> nesting and its flip behaviour). **M11 owns only the footer row's presentation and its
> hover entry point.** The function-tree sections below are therefore M1's contract; the
> "applied footer row" section is M11's.

The footer's hover affordance was **not** captured — hovering the band under `+ New page`
at two positions revealed nothing. `TBD`: find the exact hover target. The header-menu path
is the primary route and is fully specced.

---

## Anchor

| Panel | Placement |
|---|---|
| `Calculate` (level 2) | Flyout **right** of the header menu |
| `Count` / `Percent` / `More options` (level 3) | Flyout — **flips left** when there is no room right |

Three levels of nesting, each making its own flip decision. Observed flipping twice.

---

## Rows — the function tree

### Level 2 — `Calculate`

| Row | Text property | Number property |
|---|---|---|
| `None` ✓ | ✅ | ✅ |
| `Count` ✅ sub | ✅ | ✅ |
| `Percent` ✅ sub | ✅ | ✅ |
| **`More options`** ✅ sub | ❌ | ✅ |

**The branch set is type-dependent.** Number has a fourth branch that Text does not.

### Level 3 — `Count`

| Row | Kind |
|---|---|
| **Show large counts as 99+** | **toggle**, with the description *"This improves performance for large databases."* |
| *divider* | |
| Count all | row |
| Count values | row |
| Count unique values | row |
| Count empty | row |
| Count not empty | row |

### Level 3 — `More options` (Number only)

`Sum` · `Average` · `Median` · `Min` · `Max` · `Range`

**Exactly our `_NUMERIC_AGGREGATORS`** (`aggregations.py:31`) — same six, same names.

### Level 3 — `Percent`

`TBD` — not captured.

### Other property types

`TBD`. Our backend has `_CHECKBOX_AGGREGATORS` (checked, unchecked, percent_checked) and
`_DATE_AGGREGATORS` (earliest_date, latest_date, date_range). **Do not assume** Notion's
branches map onto them — capture Checkbox and Date before implementing.

---

## The applied footer row

```
                                        SUM  0
```

| Aspect | Detail |
|---|---|
| Position | A row beneath `+ New page`, one cell per column |
| Alignment | **Right-aligned** within the column |
| Label | The function name in **muted small uppercase** (`SUM`) |
| Value | Normal weight, after the label |
| Columns with `None` | Render **nothing** |

---

## Our engine already covers this

`aggregations.py` implements count, count_values, unique, empty, not_empty, percent_empty,
percent_checked, sum, average, median, min, max, range, earliest_date, latest_date,
date_range, checked, unchecked.

**Only the UI is missing.** No backend change for M11.

---

## Keyboard

`TBD` — untested. The `Calculate` chain has no search field, so per
`table-column-header.md` it likely follows plain DOM focus order in Notion. **We implement
arrow navigation regardless** — same deliberate deviation.

---

## States

| State | Behaviour |
|---|---|
| No calculation | Footer cell empty; hover reveals a `Calculate` affordance (`TBD`) |
| Calculation set | `LABEL value`, right-aligned |
| Empty column | Renders the computed value anyway (`SUM 0` on an all-empty Number column) |
| Grouped view | `TBD` — whether each group gets its own footer, and whether a grand total exists |
| Read-only source | Calculations are read-only by nature; keep enabled |

---

## Persistence

Per-column calculation is **view state** → `PATCH /db/views/{id}` `{config}`, applied
immediately. JSONB pass-through, **no backend change**.

Route through `patchViewConfig` (`DatabaseShell.tsx:81-125`).

---

## Checklist

1. Open a database with a Number column and 3+ rows with values.
2. Open the Number column's header menu → `Calculate`. → assert a flyout with `None ✓`, `Count`, `Percent`, **`More options`**.
3. Open the same on a **Text** column. → assert **no `More options`** branch.
4. Click `Count`. → assert a third-level flyout, and that it **flips left** with no room right.
5. → assert its first row is a **toggle** labelled `Show large counts as 99+` with the description beneath.
6. → assert rows: Count all, Count values, Count unique values, Count empty, Count not empty.
7. Open `More options`. → assert exactly `Sum, Average, Median, Min, Max, Range`.
8. Pick `Sum`. → assert a footer row appears showing **`SUM <total>`**, right-aligned under that column.
9. → assert other columns' footer cells are **empty**.
10. → assert the label renders in muted small uppercase.
11. Reload. → assert the calculation persisted in `view.config`.
12. Set the calculation back to `None`. → assert the footer cell empties.
13. Group the view, then set a calculation. → assert the documented per-group behaviour (capture first).
14. Set a calculation from the **footer** hover affordance. → assert it matches the header-menu path (capture the affordance first).
