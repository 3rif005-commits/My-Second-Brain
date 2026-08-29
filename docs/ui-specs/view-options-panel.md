# View settings panel

> **Milestone:** M3
> **Ground truth:** `raw-dom/view-settings-sidebar.txt`, `layout-and-open-pages-in.txt`,
> `group-and-sort-panels.txt` · `screenshots/18-view-settings-sidebar-light.jpg`,
> `20-view-property-visibility.jpg`, `21-view-layout-panel.jpg`, `22-open-pages-in.jpg`
> **Today:** does not exist. There is no view toolbar at all. `DatabaseSettingsMenu.tsx`
> is a `w-72` gear popover with unrelated concerns (sub-items, dependencies, templates,
> automations, export).
> **Binds to:** `ViewResponse`, `PATCH /db/views/{id}` — `config`, `filter`, `sorts` are
> all unvalidated JSONB pass-through, so **this milestone needs no backend change**.

---

## Trigger

A **`Settings`** button in the view toolbar (a sliders icon), at the right of the toolbar
row, immediately left of the `New` split button.

### The toolbar this lives in

Establish the whole toolbar first, because we have none of it:

```
[ Table ▾ ]                     [⧩] [⇅] [⚡] [✴] [🔍] [⚙]   [ New ▾ ]
  view tabs                    Filter Sort Auto AI  Search Settings
```

| Button | Opens |
|---|---|
| Filter | The filter entry popover — a property list + "Add advanced filter". See `filter-panel.md` |
| Sort | The sort panel |
| Automations | `TBD` |
| AI Autofill | `TBD` — out of scope for us |
| Search | In-view row search. `TBD` |
| **Settings** | **This panel** |

**Filter and Sort are top-level buttons, not rows in a menu.** They *also* appear as rows
inside this panel — two entry points to the same surface, and the spec covers both.

---

## Anchor

**This is not a popover.** It is a **docked right-hand sidebar**.

| Property | Value |
|---|---|
| Container | `notion-view-settings-sidebar` |
| Position | Docked to the right edge of the content area |
| Width | **483px** — a token, not a per-surface choice |
| Height | Full content height, from below the toolbar |
| Flip / shift | None — it is docked, not anchored |
| Dismiss | The `×` at its top right. Escape `TBD` |

The same container hosts property configuration too (see `relation-config-panel.txt`), so
483px and the docked behaviour are shared, not specific to this panel.

---

## Header

```
[ icon ]  [ text input, value = the view name ]  [ ⓘ ]        ×
```

Same pattern as the column header menu names a property: **the entity's name is an editable
input at the top of its own config panel.** There is no "Rename" row.

Our `ViewTabs` renders a bare `<button>` per view and has no rename affordance at all.

---

## Rows

Three sections. Every row in the first section carries a chevron except `Copy link to view`.

### Section 1 — *View settings* (no visible header)

| # | Icon | Label | Right side | Sub-panel | Effect |
|---|---|---|---|---|---|
| 1 | table | **Layout** | `Table` | ✅ push | View type + display toggles. See §A |
| 2 | eye | **Property visibility** | `11` (a **count**) | ✅ push | Show/hide and reorder properties. See §B |
| 3 | filter | **Filter** | — | ✅ push | See `filter-panel.md` |
| 4 | sort | **Sort** | — | ✅ push | See `sort-panel.md` |
| 5 | group | **Group** | — | ✅ push | See `group-panel.md` |
| 6 | palette | **Conditional color** | — | ✅ push | `TBD` — not captured. No backend support; likely defer |
| 7 | link | **Copy link to view** | — | ❌ | Copies a deep link. Applies immediately |

### Section 2 — *Data source settings*

| # | Icon | Label | Right side | Sub-panel | Effect |
|---|---|---|---|---|---|
| 8 | source | **Source** | `New database` | — | Rendered greyed/inactive in the capture |
| 9 | list | **Edit properties** | — | ✅ push | `TBD` |
| 10 | bolt | **Automations** | — | ✅ push | We have `AutomationManager` — fold it in here |
| 11 | sparkle | **AI Autofill** | — | ✅ push | Out of scope |

### Section 3 — *More settings*

| # | Label | Effect |
|---|---|---|
| 12 | **Manage data sources** | `TBD` |
| 13 | **Lock database** | Toggle. We have `ViewResponse.is_locked` and `db_databases.is_locked` already |

> The **View settings / Data source settings** split mirrors Notion's post-2025
> database↔data-source model — which our backend already implements as
> `db_databases → db_data_sources`, and which our UI exposes nowhere. Adopting this split
> is the cheapest place to start exposing it.

---

## Sub-panels

Sub-panels here **push**, replacing the panel's contents and rendering a **back arrow (←)**
beside the title, with the `×` still at top right.

> This is the opposite of the column header menu, whose sub-panels are adjacent flyouts.
> Both models exist in Notion; `MenuList` needs both. This surface uses push/pop — which
> matches our existing `TemplateManager.tsx:116` / `AutomationManager.tsx:99`.

### §A — Layout

Top: a **3×3 grid of view-type cards**, each an icon above a label. The selected card has a
blue border and blue label.

```
Table*   Board    Timeline
Calendar List     Gallery
Chart    Feed     Map
```

Nine types. **Form is absent** — a Form view is created some other way (`TBD`). We offer
ten in a native `<select>`, including Form and Dashboard, and deliberately cut Map.

> This card grid is also the answer for **§7's "+ New view" popover**, which the plan
> described only as "a grid of view-type cards". Reuse the same component.

Then, display toggles:

| Row | Kind | Effect |
|---|---|---|
| **Show vertical lines** | toggle | Column separators in the table |
| **Show page icon** | toggle | The 📄 in each row's title cell |
| **Wrap all content** | toggle | View-level counterpart of the header menu's per-column "Unwrap content" |
| **Open pages in** | row, value `Side peek` | Opens a popover — see §C |

### §B — Property visibility

| Element | Detail |
|---|---|
| Search | `Search for a property…`, autofocused |
| Section header | `Shown in table`, with a right-aligned **`Hide all`** bulk action |
| Row anatomy | `[drag handle ⠿] [type icon] [name] ........ [eye toggle 👁]` |
| Ordering | **Table order** — deliberately *not* alphabetical, because you are reordering the table here |
| Hidden section | Expected below the fold. `TBD` |

Rows are **drag-reorderable**. This is where per-view property order is set — which is why
column order needs **no backend change**: it lives in `view.config`, exactly as Notion does
it. Do not use `db_properties.position` for view-local ordering.

`MenuSection` therefore needs an optional right-aligned `action`.

### §C — Open pages in

Opens as a **popover overlaying the panel**, anchored to its row — neither a push nor a
docked flyout. A third positioning behaviour within this one sidebar.

| Row | Right side | Description |
|---|---|---|
| **Side peek** | ✓ + annotation link `Default for Table` | *"Open pages on the side. Keeps the view behind interactive."* |
| **Center peek** | — | *"Open pages in a focused, centered modal."* |
| **Full page** | — | *"Open pages in full page."* |

Every row carries a description line. The current row carries both a ✓ **and** a secondary
annotation link — a distinct element from `description`; decide in the design doc whether
`MenuRow` gains `annotation` or whether description takes inline markup.

### §D — Group / §E — Sort

See `group-panel.md` and `sort-panel.md`. Both push, both are autofocused searchable
property lists, both list properties **alphabetically**.

Note the ordering rule this establishes across the product:

- **table order** where you are *reordering* (Property visibility)
- **alphabetical** where you are *finding* (Group, Sort, the row peek's property list)

---

## Keyboard

`TBD` throughout. Not yet tested with real key events on this surface.

Each pushed panel opens with its **search input autofocused** (confirmed by observation for
Property visibility, Group and Sort). Given the search field, these panels should follow the
combobox model — input focused, ↑/↓ moving an active row — unlike the column header menu.

---

## States

| State | Behaviour |
|---|---|
| Empty database, 0 properties | Root panel renders identically; `Property visibility` shows `1` |
| 11 properties | `Property visibility` shows `11`. The count is the right-side value |
| No filter / no sort | `Filter` and `Sort` rows show no value; Sort's panel is titled **"New sort"** |
| Group set | `Group` shows the property name; its panel is titled **"Group by"** with a `None ✓` row |
| `Source` row | Rendered greyed. Reason `TBD` |
| Read-only source (`is_virtual`) | Our case. `DatabaseShell.tsx:400` already hides the settings entry entirely for All Notes — keep that |

---

## Persistence

Everything writes `PATCH /db/views/{id}` and applies **immediately**. Nothing saves on close.

| Setting | Target |
|---|---|
| View name | `name` |
| Layout / view type | `type` |
| Show vertical lines, Show page icon, Wrap all content, Open pages in | `config` |
| Property visibility, order, width | `config` |
| Filter | `filter` |
| Sort | `sorts` |
| Group | `config.group_by` |
| Lock | `is_locked` |

`config`, `filter` and `sorts` are unvalidated JSONB pass-through (`ViewUpdate`), so
**M3 requires no backend change.**

> Beware the stale-merge bug already fixed once in `DatabaseShell.tsx:79-125`
> (`patchViewConfig`): two config changes fired close together both read the same stale
> render-time `config` and the second silently dropped the first. This panel fires many
> config changes in quick succession — it **must** go through `patchViewConfig`, not a
> fresh `updateView(id, {config: {...activeView.config, ...patch}})` closure.

---

## Checklist

1. Open a database. → assert a toolbar exists with Filter, Sort, Automations, AI Autofill, Search, Settings, and a `New ▾` split button.
2. Click `Settings`. → assert a **docked right sidebar** opens, **483px wide**, not a popover.
3. → assert it does **not** overlay or dim the table, and the table stays interactive.
4. → assert its header is a **text input** containing the view name, with a leading icon and trailing ⓘ.
5. → assert section 1's rows are: Layout, Property visibility, Filter, Sort, Group, Conditional color, Copy link to view.
6. → assert `Layout` shows the value `Table` and `Property visibility` shows a **count**.
7. → assert `Copy link to view` has no chevron and every other row in section 1 does.
8. → assert a second section headed `Data source settings` and a third headed `More settings`.
9. Click `Property visibility`. → assert the panel **pushes**: contents replaced, a **back arrow** appears beside the title, `×` still top right.
10. → assert the search input is **autofocused**.
11. → assert the section header reads `Shown in table` with a right-aligned `Hide all`.
12. → assert each row shows a drag handle, a type icon, the name, and an eye toggle.
13. → assert the rows are in **table order**, not alphabetical.
14. Drag a property to a new position. → assert the table's column order changes and persists across reload.
15. Toggle one property's eye. → assert the column disappears and `Property visibility`'s count decrements.
16. Click the back arrow. → assert the root panel returns.
17. Click `Layout`. → assert a 3×3 grid of view-type cards with `Table` selected (blue border + blue label).
18. → assert three toggles: Show vertical lines, Show page icon, Wrap all content.
19. → assert an `Open pages in` row showing `Side peek`.
20. Click it. → assert a popover **overlaying the panel** with Side peek ✓ / Center peek / Full page, **each with a description line**.
21. Pick `Center peek`, then open a row. → assert it opens as a centered modal.
22. Fire two config changes within ~200ms (e.g. two toggles). → assert **both** persist after reload — the `patchViewConfig` regression test.
