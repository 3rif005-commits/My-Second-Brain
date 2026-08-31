# Filter panel

> **Milestone:** M4 — the first of the three query-surface milestones.
> **Ground truth:** `raw-dom/filter-entry.txt` · `screenshots/24-filter-property-picker.jpg`,
> `30-filter-advanced-builder.jpg`, `31-filter-add-rule-or-group.jpg`
> **Today:** **does not exist.** `useDatabaseView.loadRows()` faithfully posts
> `activeView.filter` to `POST .../query`, and the compiler behind it is complete — but
> nothing in the UI can ever set it.
> **Binds to:** `ViewResponse.filter`, `PATCH /db/views/{id}` `{filter}`, and the AST in
> `backend/services/db/query/ast.py`. **No backend change needed.**

---

## Trigger

Two entry points to the same surface — the spec covers both:

1. The **`Filter`** button in the view toolbar (funnel icon, leftmost of the six).
2. The **`Filter`** row inside the view settings sidebar.

Both open the same panel content. The host differs: the toolbar renders it as an **anchored
popover**; the sidebar renders it as a **pushed panel with a back arrow**. This is a general
rule established across several surfaces — *panel content is host-agnostic.*

Once at least one filter exists, a **persistent filter bar** appears between the toolbar
and the table. We have no such bar.

---

## Anchor

| Host | Placement | Width |
|---|---|---|
| Toolbar button | Anchored popover below the button, right-aligned | ≈285px |
| Settings sidebar | Pushed panel, back arrow beside the title | 483px (the sidebar's width) |
| Filter bar chip | Anchored popover below the chip, left-aligned | ≈500px (the builder is wider) |

---

## Rows — stage 1, the property picker

| Element | Detail |
|---|---|
| Search | `Filter by…`, autofocused |
| List | **Every** property, **alphabetically** |
| Divider | Before the last row |
| Last row | `+ Add advanced filter` |

Property list as captured: Name, Checkbox, Date, Files, Multi-select, Number, Person,
Select, Status, Text, URL.

**All property types are filterable, including Files** — contrast the Group panel, which
omits Files. Each panel needs its own eligibility predicate, not one shared
"supported types" list.

> Our backend's `TYPE_OPERATORS` (`services/db/query/operators.py:146`) already defines
> per-type operator sets and deliberately omits `place` and `button` as unfilterable. The
> UI's eligible list should be derived from that map, not hardcoded.

Picking a property applies a default filter immediately and opens the builder.

---

## The filter bar

Appears under the toolbar once a filter exists:

```
[ ⧩ 1 rule ▾ ]   [ + Filter ]
```

| Element | Behaviour |
|---|---|
| `⧩ N rule(s) ▾` | A chip showing the **rule count**. Clicking reopens the builder |
| `+ Filter` | Adds another filter, reopening the property picker |

Pluralisation (`1 rule` vs `2 rules`) is `TBD` but assume standard.

---

## Rows — stage 2, the advanced builder

```
Where   [Aa Name ▾]   [Contains ▾]   [ Value ]   [⋯]
+ Add filter rule ▾
🗑 Delete filter
```

### Rule row anatomy

| Slot | Content | Notes |
|---|---|---|
| Conjunction | `Where` for the first rule | For rules 2+ this becomes an **AND/OR selector**. `TBD` — capture with a second rule |
| Property | Dropdown showing the property's **type icon** + name | Opens the same alphabetical picker |
| Operator | Dropdown, **per type** | See the per-type table below |
| Value | Varies by type | See the per-type table below |
| `⋯` | Per-rule menu | `TBD` — likely duplicate / remove / turn into group |

### Operators and value editors are two separate per-type dispatches

| Type | Operators | Value editor |
|---|---|---|
| **Text / Title** | **8** — Is, Is not, Contains, Does not contain, Starts with, Ends with, Is empty, Is not empty | A text input |
| **Date** | **9** — Is, Is before, Is after, Is on or before, Is on or after, **Is between**, **Is relative to today**, Is empty, Is not empty | A **sub-property selector** (`Start date`/end), plus a compound relative-value builder (`This` + `week`) and a calendar |
| **Select** | **4** — Is, Is not, Is empty, Is not empty | A searchable **multi-select checkbox list** of the property's options, rendered as chips |
| Checkbox, Number, Person, Files, Multi-select, Status, URL | `TBD` | `TBD` |

Three captured types gave sets of 4, 8 and 9 operators. **Do not hardcode these.** Derive
them from the backend's `TYPE_OPERATORS` / `RESULT_TYPE_OPERATORS`
(`services/db/query/operators.py:146,179`), which already encode this variation — that
keeps the server's 400 for an illegal pair unreachable and gives new types correct
operators for free.

The value editor is a **separate** dispatch from the operator list. Neither implies the
other.

### Two AST questions this raises — for the user, before M4

1. **`Is between` takes two values**, and **select `is` takes an array** (its value editor
   is a multi-select checkbox list). `FilterCondition.value` is a single `Any` — it can
   carry either, but the UI and any validation must handle it deliberately. **Verify
   `_DATE_OPS` includes a between operator; if not, that is a backend sub-task.**
2. **A date filter targets a sub-property** (start vs end). `FilterCondition` is
   `{property, operator, value}` with **no representation for this**. It needs either a
   convention inside `property` or a new field.

**Flag both. Do not invent an encoding.**

### Footer rows

| Row | Effect |
|---|---|
| `+ Add filter rule ▾` | A **split control** — the chevron opens a two-row menu |
| `🗑 Delete filter` | Removes the whole filter |

### The nesting menu

| Row | Description | Effect |
|---|---|---|
| `+ Add filter rule` | — | Appends a sibling condition |
| `⧉ Add filter group` | *"A group to nest more filters"* | Appends a nested group |

Nesting is **explicit**, never implicit. That maps exactly onto our AST.

---

## Mapping to the backend AST

`backend/services/db/query/ast.py` already models this precisely:

```python
FilterCondition { type: "condition", property, operator, value }
FilterGroup     { type: "group", op: "and" | "or", children: [FilterNode] }
```

| UI element | AST |
|---|---|
| A rule row | `FilterCondition` |
| The AND/OR selector | `FilterGroup.op` |
| `Add filter group` | A nested `FilterGroup` in `children` |
| `Delete filter` | `filter: null` |

`MAX_FILTER_DEPTH` is **10** — far beyond anything this UI produces. Operator validity per
type is enforced server-side by `TYPE_OPERATORS`/`RESULT_TYPE_OPERATORS`, which returns a
**400** for an illegal pair. The UI must offer only legal operators so that 400 is
unreachable in normal use, and surface it via `useToast()` if it ever happens.

**No backend change is required for M4.**

---

## Keyboard

`TBD` throughout — not tested with real key events on this surface.

The property picker has an autofocused search field, so it should follow the combobox
model (input focused, ↑/↓ moving an active row), unlike the column header menu.

---

## States

| State | Behaviour |
|---|---|
| No filter | No filter bar. The toolbar `Filter` button opens the property picker directly |
| One filter | Filter bar shows `1 rule` |
| Filter matches nothing | **Captured.** The **entire table disappears** — headers, group headers, `+ New page` and the calc footer all gone — replaced by two centred buttons, `⧩ Edit filters` and `+ New page`, with **no text message**. The filter bar stays visible above. Ours renders the text "No rows yet." with no action |
| Filter references a deleted property | Our backend "tolerates dangling property refs at read, sweeps on delete" (`2026-08-08` spec §7). The UI must render such a rule without crashing — `TBD` how Notion does it |
| Read-only source (`is_virtual`) | All Notes supports filtering server-side; keep the filter UI enabled |
| Locked view (`is_locked`) | `TBD` — presumably the filter bar becomes read-only |

---

## Persistence

| Action | Writes | When |
|---|---|---|
| Pick a property | `PATCH /db/views/{id}` `{filter}` | Immediately, with a default operator |
| Change operator | same | Immediately |
| Change value | same | **Debounced** — a text value must not PATCH per keystroke |
| Add rule / group | same | Immediately |
| Delete filter | `{filter: null}` | Immediately |

`loadRows()` re-queries automatically: its effect is keyed on
`JSON.stringify(activeView.filter)` (`useDatabaseView.ts:196-203`), so a filter change
re-runs the query with no extra wiring.

> Use `patchViewConfig`-style sequencing (`DatabaseShell.tsx:81-125`) for rapid successive
> edits. `filter` is a separate `ViewPatch` field from `config`, so the existing helper
> covers only `config` — either widen it or add the same queue for `filter`. **Two rapid
> filter edits must not lose the first.**

---

## Checklist

1. Open a database with several property types and at least 3 rows.
2. Click the toolbar `Filter` button. → assert a popover opens with an autofocused input placeholdered `Filter by…`.
3. → assert every property is listed **alphabetically**, including `Files`.
4. → assert a divider then `+ Add advanced filter` as the last row.
5. Pick `Name`. → assert a filter bar appears under the toolbar showing `1 rule`.
6. → assert the builder opens with `Where [Name] [Contains] [Value]`.
7. Type a value matching one row. → assert the table narrows to that row **after a debounce**, not per keystroke.
8. → assert exactly one `PATCH /db/views/{id}` fired for the whole typed string, not one per character.
9. Reload. → assert the filter persisted and the table is still narrowed.
10. Open the operator dropdown. → assert only operators legal for a title property are offered.
11. Change the property to `Checkbox`. → assert the operator list changes and the value editor becomes a checkbox/boolean control.
12. Click `+ Add filter rule ▾`. → assert a two-row menu: `Add filter rule`, and `Add filter group` with the description `A group to nest more filters`.
13. Pick `Add filter rule`. → assert a second row appears and its leading slot is now an **AND/OR selector**, not the word `Where`.
14. Switch it to `Or`. → assert the table's result set widens accordingly.
15. Pick `Add filter group`. → assert a nested, indented group appears with its own conjunction selector.
16. → assert the resulting `view.filter` JSON is a `FilterGroup` whose `children` contain a nested `FilterGroup`.
17. Open the same filter from the **view settings sidebar**. → assert identical content, rendered as a **pushed panel with a back arrow** rather than a popover.
18. Click `Delete filter`. → assert the filter bar disappears and all rows return.
19. Make two filter edits within ~200ms. → assert **both** persist after reload.
20. Filter to match nothing. → assert the empty-result state renders (see `states.md`).
