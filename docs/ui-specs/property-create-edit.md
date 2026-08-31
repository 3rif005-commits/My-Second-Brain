# Property creation and editing

> **Milestone:** M2
> **Ground truth:** `raw-dom/property-type-picker.txt`, `relation-config-panel.txt`,
> `table-column-header-menu.txt` · `screenshots/10-new-property-type-picker.jpg`,
> `12a`, `12b`, `13-relation-config-sidebar.jpg`, `13b-edit-property-number.jpg`
> **Today:** `views/TableView.tsx:652-802` — a trailing-column inline form with 5 native
> `<select>` elements and per-type conditional fields crammed into one flex-wrap row.
> **Binds to:** `POST /db/data-sources/{id}/properties`, `POST .../relations`,
> `PATCH /db/properties/{id}`, `DELETE /db/properties/{id}`.

---

## Trigger

| Entry point | Opens |
|---|---|
| `+ Add property` at the right end of the header row | Creation flow |
| Column header menu → `Change type` | Type picker for an existing property |
| Column header menu → `Edit property` | Per-type config (**only for types that have any**) |
| Column header menu → the name field / `ⓘ` | Rename / add description |

---

## Creation

### The name field is not in the popover

Clicking `+ Add property` turns **the header cell itself** into a text input:

```
[ icon ]  [ Type property name…  ]        ← in the header row, autofocused
└─ popover hangs below ─┘
```

- Placeholder `Type property name…`, **autofocused**
- A leading **icon button** — properties can carry their own icon. We have no such concept
- The popover opens **below** this input

Our form puts name and type side by side inside one row. **Notion separates them.**

### The popover

Width **378px**, anchored below the header cell, vertically scrollable.

| Section | Contents |
|---|---|
| **AI Autofill** | `Summarize` [badge `Basic`] ✅ sub-panel · `Translate` [badge `Basic`] ✅ sub-panel |
| **Select type** | Section header with a **magnifier icon** at its right, then the type grid |

### The type grid

**Two columns**, 26 types, in this order:

```
Text                 | Number
Select               | Multi-select
Status               | Date
Person               | Files & media
Checkbox             | URL
Phone                | Email
Relation             | Rollup
Formula              | Button
ID                   | Place
Created time         | Last edited time
Created by           | Last edited by
Google Drive File    | Figma File
GitHub Pull Requests | Zendesk Ticket
```

It stays a two-column grid when filtered — a single match fills one cell rather than
collapsing to a list.

### Type search is a separate, hidden input

**The name field does not filter the type list.** Typing `sel` into it left the grid
completely unfiltered.

Clicking the magnifier on the `Select type` **section header** expands a full-width input
beneath that header and focuses it. Filtering then:

- narrows the type grid only — the `AI Autofill` section above stays unfiltered, so
  **search scope is per-section**
- groups third-party types below a divider with a blue **upgrade badge**

That expansion **does not persist reliably** across reopens.

### Scope decision — 26 types vs our 11

Our `ADDABLE_PROPERTY_TYPES` (`TableView.tsx:130`) offers 11.

| | Types |
|---|---|
| We offer | rich_text, number, select, multi_select, status, date, checkbox, relation, formula, rollup, button |
| Notion also offers, **and our backend already supports** | Person, Files & media, URL, Phone, Email, ID, Place, Created time, Last edited time, Created by, Last edited by |
| Integrations, out of scope | Google Drive File, Figma File, GitHub Pull Requests, Zendesk Ticket |

The eleven missing native types are **absent from the UI list only** —
`backend/services/db/properties/` implements them.

**DECIDED 2026-08-31: adopt the 11 backend-supported types.** The picker ships 22 native
types, not 11.

Sequenced as **M2 + M2b** so the work stays reviewable:

| | Scope |
|---|---|
| **M2** | The picker and edit panel themselves — two-input creation flow, 2-column grid, per-type config, scope disclaimer — over the **existing 11** types |
| **M2b** | The **11 additional** types: their picker entries, cell renderers, and per-type config panels |

Splitting is a sequencing choice, not a reduction: the picker rewrite and eleven new cell
renderers are different kinds of risk and should not land in one review. The four
third-party integration types stay out of scope.

---

## Per-type configuration

### Relation — opens in the config sidebar, not the popover

Container `notion-view-settings-sidebar`, **483px**, docked right — the *same* container as
view settings.

```
Related to                                    ×
[ Link to a data source…  ]      ← autofocused
Existing data sources
  [icon] New database
         New page                ⓘ            ← parent page as a second line
  [icon] Academic studies (2)
  …
  Show 9 more                                 ← truncation with an explicit expander
```

The target is chosen by **data source**, not database — matching the create-database
picker. Our form asks for a "target database" and resolves a data source id behind the
scenes (`TableView.tsx:675-690`); the vocabulary differs.

Self-relation is offered and listed **first**. We allow it too, and agree.

`TBD` — what appears after a target is chosen (two-way toggle, reverse property name),
which is the half our own form models.

### Number — opens as a flyout from `Edit property`

```
Number format      Number     >
Decimal places     Default    >
Show as
  [42 Number]*  [▬ Bar]  [◐ Ring]        ← 3-card grid with live previews
Changes apply to all views showing this property.
```

**The footer is the important part.** Notion states the **scope** of the edit —
data-source-level, affecting every view. Our backend has exactly this split
(`db_properties` on the data source, `config` on the view) and our UI makes no distinction
at all.

**Adopt the pattern: any panel editing schema-level state carries a scope disclaimer.**

**Correction after building it (2026-08-31):** the disclaimer does *not* go in
`MenuPanel.footer`. The captured number panel has **no dividers anywhere**, and
`footer` draws a rule above itself and mutes its contents — which would also be
wrong for the interactive `Show as` cards sitting just above it. Both live in
`MenuSection.content` instead, a field added for exactly this. `footer` keeps its
two other established uses (metadata, and the per-user `Only applies to you`).

The three `Show as` cards are Number / Bar / Ring. Choosing **Bar or Ring reveals
a bordered sub-form**: `Color` (a swatch list, expanded in place — not a native
`<select>`, and not a nested popover, which would make Escape ambiguous three
dismissal layers deep), `Divide by` (a number input Notion pre-fills with `100`
on selection), and a `Show number` switch.

`Number format` carries **its own search** (`Filter formats…`) — Notion lists 45
formats, the backend enum carries 39, and we render that intersection in Notion's
order. `Decimal places` is `Default` / `0`–`5`; `Default` is written as an
explicit `null` so a previously-set value is actually cleared rather than merged
over.

### The `Edit property` row is conditional — captured 2026-08-31

A `Text` column's header menu opens straight onto `Change type`. **There is no
`Edit property` row at all** for a type with no per-type config. This was the
last open question in this spec and it is now settled: the row is derived from
the type, not always rendered.

`hasEditableConfig()` in `EditPropertyPanel.tsx` is the single place that rule
lives. Today it returns true for `number`, `select`, `multi_select` and `status`.

### Select / Multi-select — the option editor

```
[↑↓] Sort                     Manual   >

Options                                +
[⠿] (Alpha)                            >     ← the option renders as its own pill

[✨] Generate with AI
```

- `Options` is a **section header with a trailing `+` icon button**, not a row.
  This is why `MenuSection.action.label` is a `ReactNode` rather than a string.
- The option's own `>` opens a third-level panel:

```
[ Alpha                    ] (i)     ← autofocused, text SELECTED
[🗑] Delete

Colors
[▪] Default   [▪] Gray   [▪] Brown   [▪] Orange   [▪] Yellow
[▪] Green     [▪] Blue   [▪] Purple ✓ [▪] Pink    [▪] Red
```

Exactly **10 colours**, in that order, each with a filled swatch as its icon and
a trailing `✓` on the current one. Deleting an option is **not** confirmed —
unlike deleting a property, it loses one label rather than every row's value.

- The options list's own `Sort` (Manual / Alphabetical / Reverse alphabetical)
  sorts the **option list**, not the table rows. It is a different control from
  the header menu's `Sort` row, which sorts the table. Choosing an alphabetical
  order **rewrites the stored order** rather than being a display-time flag, so
  that switching back to `Manual` cannot silently restore a stale order.

**Not adopted:** `Generate with AI`. Out of this phase's scope; tracked, not built.

### Status — the same editor, split into three groups

`StatusOption` carries a `group` field closed to `To-do` / `In progress` /
`Complete` (backend `choice.py`, a deliberate simplification of Notion's
parallel `options[]`/`groups[]` schema). The editor therefore renders **three
labelled sections, each with its own `+`**, instead of one flat `Options` list —
a flat list could never set `group`, and every option created would silently
land in `To-do`.

### Still not captured

Date format, Formula editor, Rollup config. `formula`, `relation` and `rollup`
are deliberately **excluded** from `hasEditableConfig` for now: their config is
already reachable through the push-panel the creation popover uses, and routing
one editor through two entry points with two different shapes is exactly how the
old inline forms drifted apart. Unifying them is the one named follow-up here.

---

## Rename and description

Both live in the **column header menu**, not in a separate panel:

- The property name is an **editable input at the top of its own menu**. There is no
  "Rename" row.
- The trailing **`ⓘ` is "Add property description"** (confirmed from its tooltip).

> `PropertyResponse` has a `description` field but `PropertyUpdate` accepts only `name` and
> `config` — **plan gap B3, confirmed needed.**

---

## Keyboard

| Key | Behaviour | Status |
|---|---|---|
| Focus on open | The **name input** in the header cell | confirmed |
| Tab | Plain DOM order — name input → `ⓘ` → … | confirmed |
| ↑ / ↓ | **Nothing** in the header menu; arrows move the text caret | confirmed |
| ↑ / ↓ in the *type grid* | Not observable — Notion does not receive synthetic KeyboardEvents (raw-dom/00-METHOD.md), and the grid was not re-tested with real events. We implement grid-aware ↑/↓/←/→ regardless. |
| Enter | Same — not observed; we activate the focused row. |
| Esc | **Cancels and discards the typed name** — no property is created | confirmed |

We implement arrow navigation on every panel regardless — see `table-column-header.md`
for why this is a deliberate deviation.

---

## States

| State | Behaviour |
|---|---|
| Type has no config | **No `Edit property` row** in the header menu (Text) |
| Type has config | `Edit property` present (Number) |
| Illegal conversion | Disabled in `Change type` — e.g. Text → Relation is greyed |
| Third-party types | Below a divider with an upgrade badge |
| Search expanded | Does not persist across reopens |
| Read-only source (`is_virtual`) | Suppress the whole surface — All Notes has no `db_properties` |

---

## Persistence

| Action | Writes | When |
|---|---|---|
| Create (ordinary) | `POST /db/data-sources/{id}/properties` `{name, type}` | On type pick |
| Create relation | **`POST .../relations`** — never the generic properties endpoint, or `relation_ref_from_config` rejects it (`TableView.tsx:482-489`) | On target pick |
| Rename | `PATCH /db/properties/{id}` `{name}` | On blur / Enter |
| Description | `PATCH /db/properties/{id}` `{description}` — **needs gap B3** | On blur |
| Change type | `PATCH /db/properties/{id}` `{type}` — **`PropertyUpdate` does not accept `type`** | On pick |
| Per-type config | `PATCH /db/properties/{id}` `{config}` | Immediately |
| Delete | `DELETE /db/properties/{id}` | Immediately |

**Two backend gaps this surface depends on:** `description` (B3), and a `type`-accepting
patch for conversions. Neither is in Phase 0b as currently scoped — **raise before M2**.

---

## Checklist

1. Click `+ Add property`. → assert the **header cell becomes a text input**, autofocused, placeholder `Type property name…`, with a leading icon button.
2. → assert a popover opens **below it**, **378px** wide.
3. → assert an `AI Autofill` section above a `Select type` section.
4. → assert the type grid is **two columns**.
5. Type `sel` into the **name** field. → assert the type grid does **not** filter.
6. Click the magnifier on the `Select type` header. → assert an input expands beneath that header and takes focus.
7. Type `rel`. → assert only matching types remain, the grid stays **two-column**, and `AI Autofill` above is **unfiltered**.
8. Press Escape. → assert the popover closes and **no property was created**.
9. Reopen, type a name, pick `Number`. → assert a property is created with that name and type.
10. Open its header menu. → assert an **`Edit property`** row is present.
11. Click it. → assert a flyout with `Number format`, `Decimal places`, a `Show as` **3-card grid**, and the footer **"Changes apply to all views showing this property."**
12. Open a **Text** property's header menu. → assert **no `Edit property` row** (Text has no config).
13. Open `Change type` on the Text property. → assert `Relation` is **disabled**.
14. Click the `ⓘ` beside a property name. → assert it adds a **description** and that it persists (requires B3).
15. Create a **Relation**. → assert the config opens in the **483px docked sidebar**, not a popover, listing **data sources** with the current one first.
16. → assert the request went to `POST .../relations`, not `POST .../properties`.
17. Rename a property via the menu's name field. → assert the column header updates and a `PATCH` fired on blur.
18. Delete a property. → assert the column disappears and `DELETE /db/properties/{id}` fired.
