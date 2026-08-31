# Database header — creation, title, icon, description

> **Milestone:** M8
> **Ground truth:** `raw-dom/database-header.txt`, `create-database-picker.txt`,
> `database-page-menu.txt`, `empty-database-toolbar.txt` ·
> `screenshots/50-db-header-hover.jpg`, `51-db-icon-picker.jpg`,
> `52-db-description-toggled.jpg`, `53-db-page-menu.jpg`, `54-...-DARK.jpg`
> **Today:** `DatabaseShell.tsx:387-388` renders the icon as static text and the title in a
> static `<h1>`. `Sidebar.tsx:115` creates "Untitled Database" and navigates. **A database
> can never be renamed, and never gets an icon or description.**
> **Binds to:** `DatabaseResponse` (`title`, `icon`, `description`, `cover_url`) — and
> **`PATCH`/`DELETE /db/databases/{id}`, which do not exist (plan gap B2).**

---

## Creation

Creating a database opens a **full-viewport modal** — the **data-source picker**. It does
*not* go straight to an empty table.

```
×   Add to [🔒 Private ▾]        [ Search                    ]

    [ ▦  Empty database ]

    ↗ Existing data sources
    [ Academic studies (2) ]   [ Remote Sensing ]     ← cards with LIVE previews
    [ python …            ]   [ Linux          ]
    Show more

    Templates
    [ Tasks Tracker — "Stay organized with tasks, your way." ]
```

| Element | Detail |
|---|---|
| `Add to [Private ▾]` | Destination picker. **No analogue for us** — we have no page tree. Omit |
| Search | **Autofocused**; filters across sections (assumed — `TBD`) |
| `Empty database` | The only non-preview card |
| `Existing data sources` | Cards showing a **live mini-preview** — the source's first ~3 property names as columns and ~3 rows of real values, select values as chips |
| `Templates` | Cards with a name, one-line description and the same preview |

> **This is the `db_databases → db_data_sources` split**, which our backend implements and
> our UI exposes nowhere. `handleNewDatabase` POSTs a title and navigates.
>
> The live card previews are a **real build cost**. Flag before committing to them — a
> static icon + property-name list may be enough.

**Escape does not dismiss this modal** (verified twice with real keys). Only the `×` closes
it. **We deviate: Escape closes**, matching our `ConfirmDialog`/`PromptDialog` convention.

`TBD` — whether the inline `/database` slash command opens the same modal. The user
suspected it does; **unconfirmed, do not assume.**

---

## Header affordances

Invisible at rest. Hovering the title area reveals a row **above** the title:

```
☺ Add icon     🖼 Add cover     ⓘ Add description
```

Reserved space — they must **not** shift the title when they appear (same rule as the row
gutter in `row-affordances.md`).

> This was initially mis-read as "always present" from an accessibility-tree dump. **The
> a11y tree reports elements that are not visible** — hover states must be confirmed from a
> screenshot. See `raw-dom/00-METHOD.md`.

### `Add description` is a toggle

Once on, the button reads **`Hide description`** and a field appears under the title with
placeholder `Add a description…`.

Description *visibility* is state, separate from whether the description has content. Our
`DatabaseResponse.description` is `list[Any]` (rich text) with no shown/hidden flag —
`TBD` whether Notion stores one or infers it from emptiness.

### `Add icon` assigns immediately

**Clicking it applies a random icon at once** — a 🚋 appeared on the title and in the
breadcrumb — **and then** opens the picker.

Not "open a picker, then choose", but "assign something now, refine if you like". Same
create-first spirit as view creation.

---

## The icon picker

```
[ Emoji ] [ Icons ] [ Upload ]                    Remove
[ 🔍 Filter…                     ]  [ 🔀 ]  [ ✋ ]
People
  <emoji grid, ~12 columns, scrollable, category section headers>
──────────────────────────────────────────────────────────
[🕐] [☺] [🌿] [🍕] [⚽] [✈] [💡] [✅] [🏳] [▦] [+]     ← category jump bar
```

| Element | In scope for us? |
|---|---|
| **Emoji** tab | ✅ |
| Search (`Filter…`) | ✅ |
| **Remove** | ✅ |
| Category section headers + jump bar | ✅ |
| **Shuffle** 🔀 | ✅ — cheap, and it pairs with assign-immediately |
| **Skin tone** ✋ | ⚠️ only if the emoji data carries variants; otherwise defer |
| **Icons** tab | ❌ — we have no icon set |
| **Upload** tab | ❌ — no asset pipeline for this |

**Prior art:** `NoteEditorPage.tsx:17` has a fixed `EMOJIS` array, a grid and an
outside-click ref — no search, no categories, no remove. **Extend it; do not fork it.**

---

## Title

A `textbox` with placeholder `New database` — **always editable in place**, no rename
affordance and no edit mode. Ours is a static `<h1>`.

---

## The page-level `⋯` menu

| Row | Hint | Notes |
|---|---|---|
| Copy link | `Ctrl+Alt+L` | |
| Duplicate | | |
| Move to | `Ctrl+⇧+P` | No page tree for us — omit |
| Move to Trash | | Needs **`DELETE /db/databases/{id}`** (gap B2) |
| Customize layout | | |
| Lock database | | `db_databases.is_locked` exists |
| Import | | |
| Merge with CSV | | We have CSV import in `Sidebar` |
| Export | | We have `Export CSV` in `DatabaseSettingsMenu` |
| Updates & analytics | | Out of scope |
| Version history | | Out of scope |
| Notify me | | Out of scope |
| Mentions | | |
| Connections | `None` | Out of scope |
| *footer* | last edited by / at | |
| Learn about databases | | Help link |

---

## Keyboard

| Key | Behaviour | Status |
|---|---|---|
| Escape, create modal | **Does not dismiss** — `×` only | confirmed (real keys, twice) |
| Escape, icon picker | `TBD` | |
| Focus on create-modal open | The Search input | confirmed |

---

## States

| State | Behaviour |
|---|---|
| No icon | `Add icon` shown on hover |
| Icon set | The icon renders beside the title and in the breadcrumb; hovering it reopens the picker |
| No description | `Add description` on hover |
| Description shown | Button reads `Hide description`; field shows `Add a description…` when empty |
| Untitled | Title shows the placeholder `New database` |
| Read-only source (`is_virtual`) | All Notes has no `db_databases` row. Suppress icon/description/rename entirely |

---

## Persistence

| Action | Writes | Exists? |
|---|---|---|
| Create | `POST /db/databases` `{title, icon}` | ✅ |
| Rename | `PATCH /db/databases/{id}` `{title}` | ❌ **gap B2** |
| Set / remove icon | `PATCH /db/databases/{id}` `{icon}` | ❌ **gap B2** |
| Description | `PATCH /db/databases/{id}` `{description}` | ❌ **gap B2** |
| Cover | `PATCH /db/databases/{id}` `{cover_url}` | ❌ **gap B2**; and no upload pipeline — **defer cover entirely** |
| Move to Trash | `DELETE /db/databases/{id}` | ❌ **gap B2** |

**M8 is blocked on Phase 0b's B2.** Nothing else in this milestone can ship without it.

---

## Checklist

1. Create a database from the sidebar. → assert a **data-source picker modal** opens, not an empty table.
2. → assert an `Empty database` card, an `Existing data sources` section with preview cards, and a `Templates` section.
3. → assert the Search input is **autofocused**.
4. Press Escape. → assert **our** modal closes (a deliberate deviation from Notion, which ignores it).
5. Pick `Empty database`. → assert a new database opens with one Table view and one `Name` property.
6. Move the pointer away from the title. → assert **no** header affordances are visible.
7. Hover the title area. → assert `Add icon`, `Add cover`, `Add description` appear **above** the title.
8. → assert the title does **not** shift horizontally or vertically when they appear.
9. Click `Add icon`. → assert an icon is **applied immediately** and the picker opens.
10. → assert the picker has an Emoji tab, a search field, a `Remove` action and a category jump bar.
11. Search `rocket`, pick one. → assert the title's icon updates and persists across reload.
12. Click `Remove`. → assert the icon is cleared and `Add icon` returns on hover.
13. Click `Add description`. → assert a field appears with `Add a description…` and the button becomes `Hide description`.
14. Type a description and reload. → assert it persisted (**requires B2**).
15. Click the title and type. → assert it edits **in place** with no edit-mode toggle, and persists (**requires B2**).
16. Open the page `⋯`. → assert the documented rows, and that out-of-scope rows are **absent rather than dead**.
17. On the All Notes virtual source. → assert icon, description and rename are **absent**, not disabled.
