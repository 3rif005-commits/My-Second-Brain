# `+ New` split button and templates

> **Milestone:** M11
> **Ground truth:** `raw-dom/new-button-and-context-menus.txt` ·
> `screenshots/74-new-row-templates-empty.jpg`
> **Today:** `TableView.tsx:911-963` — a `+ New` text button, plus a `▾` **only when at
> least one non-default template exists** (`:925`).
> **Binds to:** `POST /db/data-sources/{id}/rows`, `POST /db/templates/{id}/instantiate`,
> `RowTemplateResponse`.

---

## Trigger

A split button at the right of the view toolbar:

```
[  New  |  ▾  ]
```

| Half | Action |
|---|---|
| `New` | Creates a row **immediately** |
| `▾` | Opens the templates menu |

There are also two in-table row-creation affordances, which belong to `row-affordances.md`
and the grouped-table section of `group-panel.md`:

- `+ New page` beneath the last row (and **per group** when grouped)
- `+` in the row hover gutter — inserts a row **below** that one

---

## What creating a row actually does

Clicking `+ New page` created the row **and put the title cell into inline edit**, caret
placed. Our `handleAddRow` (`TableView.tsx:589-601`) POSTs and refetches with **no focus
management** — the user has to find and click the new row.

**Focus the new row's title cell after creation.**

---

## Rows — the templates menu

Captured with **zero** templates:

```
Templates for New database                    [?]
Create a reusable page template for this database.
────────────────────────────────────────────────
+   New template
────────────────────────────────────────────────
▤   Add shortcut to sidebar
```

| Element | Detail |
|---|---|
| Section header | `Templates for <database name>`, with a **`?` help icon** at its right |
| Empty-state copy | *"Create a reusable page template for this database."* |
| `+ New template` | Opens the template editor |
| `Add shortcut to sidebar` | No analogue for us — **omit deliberately** |

`TBD` — the menu with templates present: how each is listed, whether a default is marked,
and each template's own menu.

---

## An information-architecture difference, not a hidden chevron

| | Notion | Ours |
|---|---|---|
| Chevron with 0 templates | **Always shown** | **Hidden** (`TableView.tsx:925`) |
| Where templates are authored | **This menu** | `DatabaseSettingsMenu` (the ⚙) → `Manage templates` |
| Empty state | Invites creation | Nothing — the affordance is absent |

Hiding the chevron hides **the only affordance for creating a template**. Notion treats the
`New` dropdown as the entry point to authoring, not merely a picker for existing templates.

> **This is a real IA decision and it is the user's call.** Options: (a) adopt Notion's —
> templates authored from the `New` dropdown, (b) keep ours — authored from the settings
> menu, (c) both. **Flagged, not silently restructured.**

---

## Keyboard

`TBD` — untested.

---

## States

| State | Behaviour |
|---|---|
| No templates | Chevron still present; menu shows the empty-state copy and `New template` |
| Templates exist | `TBD` — capture before implementing |
| A default template exists | Our backend auto-applies it server-side on a bare `POST .../rows` (Task 37). Notion's marking of a default is `TBD` |
| Read-only source (`is_virtual`) | Suppress the whole button — All Notes has no write endpoint |

---

## Persistence

| Action | Writes |
|---|---|
| `New` | `POST /db/data-sources/{id}/rows` — bare, backend applies the default template |
| Pick a template | `POST /db/templates/{id}/instantiate` |
| `New template` | `POST /db/data-sources/{id}/templates` |

Our `instantiateTemplate` does **not** refetch rows — the caller must call `refetchRows()`
(`useDatabaseView.ts:522-532`). Keep that contract.

---

## Checklist

1. Open a database with **no** templates. → assert the toolbar shows a `New` button **with a chevron**.
2. Click `New`. → assert a row is created **and its title cell enters inline edit with the caret placed**.
3. Click the chevron. → assert a menu headed `Templates for <database name>` with a `?` icon.
4. → assert the empty-state copy `Create a reusable page template for this database.`
5. → assert a `+ New template` row.
6. Create a template, reopen the menu. → assert it is listed (capture Notion's listing first).
7. Pick it. → assert a row is created from it and the table refreshes.
8. Click `+ New page` under the last row. → assert the same create-and-focus behaviour.
9. Group the view. → assert **each group** has its own `+ New page`, and that using it sets that group's property value.
10. Hover a row and click the gutter `+`. → assert a row is inserted **directly below** it.
11. On a read-only source. → assert the whole button is absent, not disabled.
