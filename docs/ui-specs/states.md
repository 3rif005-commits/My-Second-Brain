# Empty, loading and error states

> **Milestone:** M11
> **Ground truth:** `raw-dom/resize-and-states.txt`, `empty-database-toolbar.txt`,
> `group-and-sort-panels.txt` · `screenshots/94-state-no-results.jpg`,
> `93-state-new-database` (see `empty-database-toolbar.txt`)
> **Today:** `TableView.tsx:816` renders the text `No rows yet.` for every empty case.

---

## There is more than one empty state

Notion distinguishes them. **We render one message for all of them.**

### 1. Brand-new database, no rows, no filter

The table renders **normally** — column header row, and a single **`New page` placeholder
row** where a row would be. There is **no empty-state message**.

The empty state *is* the affordance to fill it.

> Ours renders `No rows yet.` in a centred colspan cell — a message, and no way to act.

### 2. A filter matches nothing

**The entire table disappears.** Column headers, group headers, the `+ New page` row and
the calculations footer are **all** gone. What remains, centred:

```
[ ⧩ Edit filters ]     [ + New page ]
```

**Two buttons. No text at all.**

The filter/sort bar stays visible above, so the user can see a filter is active. The bar
and the empty state work together — the bar explains *why*, the buttons offer *what next*.

> This is the clearest single lesson from the whole capture: **Notion answers "why is this
> empty" with actions, not a sentence.**

### 3. An empty group

`TBD` — not captured. Groups with no rows are **hidden by default** (`Hide empty groups` is
on), and appear greyed with an eye-slash in the Group panel. Capture the visible-empty-group
case with the toggle off.

### 4. No properties

`TBD` — a database always has at least the title property, so this may be unreachable.

---

## Loading

`TBD` — not captured. A hard reload was not caught mid-load.

Ours: `DatabaseShell.tsx:127-133` renders a centred `Loading…`; `RowPeek` renders an
animated pulse block. Notion's approach is uncaptured — **do not guess.**

---

## Error

`TBD` for Notion.

Ours: `DatabaseShell.tsx:135-141` renders the error text centred; mutations toast via
`useToast()`. Notion's database menus show **no inline error region**, which suggests
toasts there too — but this is inference, not capture.

---

## Disabled states seen across the captures

Worth collecting, because they show Notion's convention: **disabled rather than absent**,
with the reason usually implicit in context.

| Where | Row | Why |
|---|---|---|
| `Change type` | `Relation` | A Text property cannot convert to a Relation |
| Column header menu | `Duplicate property` | Reason **unverified** — do not claim one |
| Column header menu | `Insert right` (last column), `Freeze` (in one capture) | **Observed, unexplained** |
| View tab menu | `Add view to sidebar` (with 2 views), `Source` (with 1) | **Observed, unexplained** |
| Add-sort picker | `Status` | Possibly no options configured — **unverified** |
| Group picker | `Files` **absent**, not disabled | Per-panel eligibility |

> Notion mixes **disabled** and **absent** and the rule is not obvious. Our own convention,
> already set by `DatabaseShell.tsx:400`, is **hidden rather than shown-disabled** for
> things that structurally cannot apply (All Notes). Keep that, and use *disabled with a
> visible reason* only where the user might reasonably expect the action to work.

---

## Our read-only source is a state Notion has no equivalent for

The virtual **All Notes** source (`is_virtual`) has no `db_properties`, no `db_views`, and
returns 501 for writes. Every surface must suppress its write affordances:

| Surface | Behaviour |
|---|---|
| Column header menu | Suppress entirely |
| `+ Add property` | Suppress |
| Row gutter, `⋯`, bulk bar | Suppress |
| `New` split button | Suppress |
| View tab bar | Suppress |
| Database icon / title / description | Suppress |
| Filter, Sort, Group, calculations | **Keep** — they are query concerns and work server-side |

---

## Checklist

1. Create a fresh database. → assert the table renders with a header row and a **`New page` placeholder row**, and **no empty-state message**.
2. Apply a filter matching nothing. → assert the **entire table disappears** — no headers, no footer.
3. → assert exactly two centred buttons: `Edit filters` and `+ New page`.
4. → assert **no text message**.
5. → assert the filter bar is **still visible** above.
6. Click `Edit filters`. → assert the filter builder opens.
7. Click `+ New page`. → assert a row is created **and the filter is handled** (either cleared or the row made to match — capture Notion's behaviour first).
8. Group a view with `Hide empty groups` **off**. → assert the empty group's presentation (capture first).
9. Open a database on a slow connection. → assert the loading state (capture Notion's first).
10. Open the All Notes virtual source. → assert every write affordance in the table above is **absent, not disabled**, while Filter/Sort/Group remain available.
