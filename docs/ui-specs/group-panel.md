# Group panel

> **Milestone:** M6
> **Ground truth:** `raw-dom/group-and-sort-panels.txt` · `screenshots/36-group-by-panel.jpg`,
> `37-group-settings-applied.jpg`, `37b-group-sort-options.jpg`
> **Today:** **no group UI exists.** `group_by` is settable exactly once, at Board creation,
> from `ViewTabs`. It can never be changed, inspected or removed afterwards.
> **Binds to:** `view.config.group_by`, `GroupBySpec` (`lib/database/types.ts:97`),
> `PATCH /db/views/{id}` `{config}`.

---

## Trigger

Two entry points:

1. The **`Group`** row in the view settings sidebar → **pushed panel** with a back arrow
2. The **`Group`** row in a column header menu → groups by that property immediately

There is no top-level `Group` toolbar button (unlike Filter and Sort).

---

## Anchor

| Host | Placement | Width |
|---|---|---|
| Settings sidebar | Pushed panel, back arrow | 483px |
| Group's own `Sort` row | Popover **overlaying** the panel, anchored to the row | ≈250px |

---

## Rows — stage 1, not yet grouped

Panel title: **"Group by"**

| Element | Detail |
|---|---|
| Search | `Search for a property…`, autofocused |
| First row | **`None`** with a ✓ — the current state |
| List | Eligible properties, **alphabetically** |

Captured: Name, Checkbox, Date, Multi-select, Number, Person, Select, Status, Text, URL.

> **`Files` is absent here but present in Sort and Filter.** Each panel needs its own
> eligibility predicate — not one shared "supported types" list.

### The scope decision this forces

Notion groups by **at least ten** property types. Our `GROUPABLE_PROPERTY_TYPES`
(`lib/database/types.ts:134`) is three: `select`, `status`, `multi_select`.

This is **not** a frontend-only gap. Grouping by Number or Date needs range/bucket support
in `backend/services/db/query/grouping.py`; Checkbox needs boolean grouping.

**DECIDED 2026-08-31: add engine support first.** M6 matches Notion rather than disabling
seven types.

The engine work is **Phase 0c** in the plan, landing before M6 and running in parallel with
the M1–M3 batch:

| Type | Group key derivation |
|---|---|
| Number | **Range buckets** — bucket size a per-view setting |
| Date | **Day / week / month / year** — unit a per-view setting |
| Checkbox | Boolean — two groups |
| Text, URL, Person | Exact value, plus the `No <Property>` empty bucket |

Touches `services/db/query/grouping.py` and the compiler, with its own pytest surface.

**Consequence for this spec:** the property picker lists every groupable type and none are
disabled — so the "disabled with a reason" state below applies only if 0c slips.

---

## Rows — stage 2, grouped

Panel title changes to **"Group"** (from "Group by"). Same state-dependent titling as Sort
("New sort" → the editor).

| # | Label | Right side | Sub-panel | Effect |
|---|---|---|---|---|
| 1 | **Group by** | the property name | ✅ popover | Reopens the property picker |
| 2 | **Sort** | `Manual` | ✅ popover | Group **ordering** — see §A |
| 3 | **Hide empty groups** | toggle, **ON** by default | ❌ | Maps to `GroupBySpec.hide_empty_groups` |
| — | *section* **Groups** | right-aligned **`Hide all`** | | Bulk action on the section header |
| 4…n | one row **per group** | | | See below |
| n+1 | 🗑 **Remove grouping** | — | ❌ | Clears grouping |
| n+2 | ? **Learn about grouping** | — | ❌ | Help link |

### Per-group rows

```
⠿  [Alpha]        👁      ← the option rendered as its own CHIP
⠿  No Select      👁̸      ← greyed; eye-with-slash = hidden
```

| Slot | Meaning |
|---|---|
| `⠿` | Drag handle — **groups are individually reorderable** (meaningful when Sort = Manual) |
| Label | The option rendered as **its own coloured chip**, not plain text |
| `👁` | **Per-group** visibility toggle |

> Our `GroupBySpec` models only a single `hide_empty_groups` boolean. Notion has
> **per-group visibility** *and* **per-group manual order** on top of that. Both are new
> `view.config` state — JSONB pass-through, **no backend change**.

### The automatic empty group

Rows with no value for the grouped property fall into a group named **`No <PropertyName>`**
— here `No Select`. It appears in the Groups list like any other group and is hidden when
`Hide empty groups` is on.

The backend already produces the bucket; **the naming convention is a UI concern** and this
spec fixes it as `No <PropertyName>`.

---

## Sub-panels

### §A — "Sort" (group ordering)

Opens as a popover **overlaying** the panel, anchored to its row.

| Row | Right side |
|---|---|
| **Manual** | ✓ (default) |
| **Alphabetical** | — |
| **Reverse alphabetical** | — |

Three options. `Manual` is what makes the per-group drag handles meaningful.

**Not to be confused with the view's row `Sort`.** Two different settings named "Sort", in
two different panels. The spec must keep them distinct in the UI copy.

No equivalent field exists in `GroupBySpec`. New config, e.g.
`group_by.group_order: "manual" | "alphabetical" | "reverse_alphabetical"` plus an explicit
order array for manual.

---

## The grouped table

```
▼  [Alpha]                     ← collapse triangle + the option's chip
   <full column header row>    ← each group repeats the header
   <rows in this group>
   +  New page                 ← per-group row-add
+  New group                   ← at the bottom of the table
```

- **Every group repeats the column header row.**
- Each group has its own `+ New page`.
- **`+ New group`** creates a **new select option** on the property — a schema write from
  the table body. We have no equivalent; it would `PATCH` the property's config.
- **No per-group count** was visible in the table's group headers, whereas the **Board**'s
  column headers did show counts (`Not started 1`). **Observed, not explained** — re-capture
  with more rows before the spec claims either behaviour.

---

## Keyboard

`TBD` throughout — not tested with real key events on this surface.

---

## States

| State | Behaviour |
|---|---|
| Not grouped | Panel titled **"Group by"**, `None ✓` present, no Groups section |
| Grouped | Panel titled **"Group"**, `None` gone, Groups section listed |
| `Hide empty groups` on | Empty groups greyed with eye-slash in the panel and absent from the table |
| Ungroupable property | After Phase 0c, every offered type groups. **If 0c slips**, render the 7 unsupported types disabled with a visible reason rather than hiding them |
| Grouped by a deleted property | Backend tolerates dangling refs at read; UI must not crash — `TBD` |
| Read-only source (`is_virtual`) | Grouping is a query concern; keep enabled |

---

## Persistence

| Action | Writes | When |
|---|---|---|
| Group by | `PATCH /db/views/{id}` `{config.group_by.property_key}` | Immediately |
| Group ordering (Sort) | `config.group_by.group_order` (**new**) | Immediately |
| Hide empty groups | `config.group_by.hide_empty_groups` | Immediately |
| Per-group visibility | `config.group_by.hidden_groups[]` (**new**) | Immediately |
| Per-group reorder | `config.group_by.group_order_manual[]` (**new**) | On drop |
| Remove grouping | `config.group_by: null` | Immediately |
| `+ New group` | `PATCH /db/properties/{id}` `{config}` — adds a select option | Immediately |

> `status` grouping needs `mode` set or the backend raises — `DatabaseShell.tsx:180` already
> defaults it to `"option"`. Keep that when grouping is set from this panel, not just at
> Board creation.
>
> Group changes go through `config`, so route them through `patchViewConfig`
> (`DatabaseShell.tsx:81-125`) — this panel fires several config writes in quick succession.

---

## Checklist

1. Open a database with a Select property that has ≥2 options and rows in more than one.
2. Settings → `Group`. → assert a pushed panel titled **"Group by"** with a `None ✓` row and an autofocused search.
3. → assert properties are alphabetical and **`Files` is absent**.
4. → assert types we cannot group by are **disabled with a visible reason**, not missing.
5. Pick the Select property. → assert the table regroups immediately and the panel retitles to **"Group"**.
6. → assert rows: Group by (value = property name), Sort (value = `Manual`), Hide empty groups (toggle **on**), a `Groups` section with `Hide all`, then one row per group, then Remove grouping and Learn about grouping.
7. → assert each group row shows a drag handle, the option as **its own chip**, and an eye toggle.
8. → assert an automatic group named **`No <PropertyName>`** exists for empty values.
9. → assert that group is greyed with an eye-slash while `Hide empty groups` is on.
10. Toggle `Hide empty groups` off. → assert empty groups appear in the table.
11. Click `Sort`. → assert a popover overlaying the panel with exactly **Manual ✓ / Alphabetical / Reverse alphabetical**.
12. Choose `Alphabetical`. → assert groups reorder and the per-group drag handles become inert or hidden.
13. Back to `Manual`, drag one group above another. → assert the table order changes and survives a reload.
14. Toggle one group's eye. → assert that group disappears from the table but stays listed in the panel.
15. In the table, assert **each group repeats the column header row** and has its own `+ New page`.
16. Click `+ New group`. → assert a **new select option** is created on the property and appears in the panel's Groups list.
17. Group by a **Status** property. → assert it works (mode defaults to `option`, not a 400).
18. Click `Remove grouping`. → assert the table flattens and `config.group_by` is cleared.
19. Make two group changes within ~200ms. → assert **both** persist after reload.
