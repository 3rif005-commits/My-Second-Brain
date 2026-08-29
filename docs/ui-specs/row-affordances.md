# Row hover affordances and open-as

> **Milestone:** M9
> **Ground truth:** `raw-dom/row-affordances-and-menu.txt` · `screenshots/57-row-hover.jpg`,
> `58-row-menu-and-bulk-bar.jpg`, `60-row-open-in.jpg`
> **Today:** `views/TableView.tsx:852,896` renders one `OpenNoteButton` (icon-only) on the
> title cell at `opacity-0 group-hover:opacity-100`. Nothing else.
> **Binds to:** `DatabaseRow`, `DELETE /api/notes/{noteId}` (trash), `view.config` for row order.

---

## Trigger

Hovering **anywhere on the row**. Five affordances appear, in two groups.

```
 ┌─ left gutter, OUTSIDE the table ─┐ ┌────────── title cell ──────────┐
   +        ⠿        ☐                📄  Row one          [▣ OPEN]
  add     drag/    select            icon   title          right-aligned
  below   menu
```

| Affordance | x (at 1300px) | Location | Purpose |
|---|---|---|---|
| `+` | ≈299 | left gutter | Add a row below this one |
| `⠿` drag handle | ≈321 | left gutter | **Three gestures** — see below |
| `☐` checkbox | ≈356 | left gutter | Select the row |
| 📄 page icon | ≈390 | inside title cell | The row's own icon |
| `▣ OPEN` | ≈593–640 | inside title cell, right-aligned | Opens the side peek |

### The drag handle carries three gestures

This is the most easily-missed detail on the surface:

1. **Click** → opens the row menu
2. **Drag** → reorders the row
3. **Click also selects the row** — the selection checkbox fills and the bulk bar appears

The plan called this trigger "`⋮⋮`". It is the drag handle itself; there is no separate
menu affordance.

### Layout consequence

The gutter lives **outside the table's left edge** and only exists on hover. The table
must reserve that space permanently, or every row shifts horizontally on hover. Our
`TableView` has no gutter at all — this is a layout change, not just an added button.

### `OPEN` is a labelled button

Not an icon. An icon plus the word `OPEN`, right-aligned inside the title cell. While the
peek is open it becomes **`CLOSE`** — it is a toggle.

### Unresolved

A small circle appears at the bottom-right corner of the selected cell (≈652,238). Not in
the plan. `TBD` — capture its behaviour before speccing. Do **not** assume it is an
Excel-style drag-fill.

---

## Anchor — the row menu

| Property | Value |
|---|---|
| Trigger | Click the drag handle `⠿` |
| Placement | Opens to the left/below the handle; at the viewport's left edge it renders flush |
| Width | ≈255px |
| Scroll | Vertical, with a footer pinned below the divider |
| Sub-panels | **Adjacent flyouts**, parent stays visible (same as the column header menu) |

---

## Rows — the row menu

A **search field sits at the top**: `Search actions…`, autofocused. This is the third
surface with search-at-top, after the property type picker and the sidebar panels.

Section header: **Page**

| # | Icon | Label | Right side | Sub-panel | Effect |
|---|---|---|---|---|---|
| 1 | ⭐ | **Add to Favorites** | — | ❌ | Favourites the row's page |
| 2 | ☺ | **Edit icon** | — | ❌ | Opens the icon picker for this row |
| 3 | ☰ | **Edit property** | — | ✅ flyout | `TBD` — not captured |
| 4 | ↗ | **Open in** | — | ✅ flyout | See Sub-panels §A |
| 5 | 💬 | **Comment** | `Ctrl+⇧+M` | ❌ | Focuses the comment composer |
| — | | *divider* | | | |
| 6 | 🔗 | **Copy link** | — | ❌ | Copies a deep link to the row |
| 7 | ⧉ | **Duplicate** | `Ctrl+D` | ❌ | Duplicates the row **including its page body** |
| 8 | ↱ | **Move to** | `Ctrl+⇧+P` | ❌ | Moves the page elsewhere |
| 9 | 🗑 | **Move to Trash** | `Del` | ❌ | Soft-deletes to trash |

**Footer** (muted, below a divider): `Last edited by <user>` / `<timestamp>`.

### Notes on specific rows

- **"Move to Trash", not "Delete."** Our `DELETE /api/notes/{noteId}` is already a
  soft-delete to trash, so the vocabulary matches. Use Notion's wording.
- **Duplicate needs a backend endpoint.** Copying the page body is not possible
  client-side. This is plan gap **B4**, now confirmed as genuinely required rather than
  hypothetical.
- **Move to** has no analogue — we have no page tree to move a database row into. Omit,
  and say so in the spec rather than shipping a dead row.
- **Add to Favorites** — we have favourites (`NOTION_PHASE.md`). Wire it.
- **Edit icon** — needs `IconPicker` from Phase 0, and a per-row icon field. Rows are
  notes and `notes.icon` already exists (`NOTION_PHASE.md` §3). Reusable.

---

## Sub-panels

### §A — "Open in"

Opens as a **flyout to the right**; the parent menu stays fully visible.

| Row | Right side | Effect |
|---|---|---|
| ↗ New tab | `Ctrl+⇧+↵` | Opens the row's page in a browser tab |
| ▣ Side peek | `Alt+Click` | Opens the side peek |

**Only two options.** The plan's §9 assumed three — "side peek / center peek / full page".
Centre peek and full page are **not** here. Notion sets the default open mode at the *view*
level (view settings → **Open pages in**). So:

- **per-row menu** — override where *this* row opens; two choices
- **view setting** — the default for *every* row; more choices, `TBD`

The spec must not conflate them.

`Alt+Click` occupies the same right-aligned slot as keyboard shortcuts, so `MenuRow.hint`
is a generic "how else to do this" field, not a keyboard-shortcut field.

---

## Bulk selection

Selecting a row (checkbox, or clicking the drag handle) switches the view into a
selection mode:

- Checkboxes appear in **both** the header row and every row
- The header checkbox becomes select-all
- The selected row is tinted
- A floating toolbar replaces the view toolbar:

```
[ 1 selected ]   [≡] [#] [⊙] [☰] [⊙] [⊙]   [🗑]   [⋯]
   count          property-type icons —     trash  overflow
                  bulk-edit a property
```

`TBD` — the overflow `⋯` contents, shift-click range selection, and what each
property-type icon opens.

---

## Keyboard

`TBD` throughout. Not yet tested with real key events on this surface.

Known from the menu labels: `Ctrl+⇧+M` comment, `Ctrl+D` duplicate, `Ctrl+⇧+P` move to,
`Del` trash, `Ctrl+⇧+↵` open in new tab, `Alt+Click` side peek. Whether these work
globally when a row is merely *hovered* versus *selected* is unverified.

---

## States

| State | Behaviour |
|---|---|
| Row at rest | **Nothing visible.** No gutter icons, no OPEN button |
| Row hovered | All five affordances appear. No layout shift (space reserved) |
| Peek open for this row | `OPEN` reads `CLOSE`; the row stays highlighted |
| Row selected | Checkbox filled, row tinted, bulk bar shown |
| Read-only source (`is_virtual`) | Our case. Suppress `+`, drag handle, checkbox and the destructive menu rows; keep `OPEN`. Matches `DatabaseShell.tsx:400`'s hidden-not-disabled rule |
| Sub-item row | We render an expand triangle and indentation (`TableView.tsx:836-848`). Notion's equivalent is `TBD` |

---

## Persistence

| Action | Writes | When |
|---|---|---|
| Add row below | `POST /db/data-sources/{id}/rows` + a position write | Immediately |
| Reorder (drag) | `view.config` row order — JSONB pass-through, **no backend change** | On drop |
| Select | Client state only | — |
| Edit icon | `PATCH /api/notes/{id}` `{icon}` | On pick |
| Duplicate | **Needs a new endpoint (B4)** | Immediately |
| Move to Trash | `DELETE /api/notes/{noteId}` | Immediately |
| Open in side peek | URL: `?p=<noteId>&pm=s` | On click |

---

## Checklist

1. Open a database with at least two rows. → the table renders with no visible row affordances.
2. Move the pointer off the table entirely. → assert no row shows any affordance.
3. Hover a row. → assert exactly five appear: `+`, drag handle, checkbox, page icon, `OPEN`.
4. → assert **no horizontal shift** of the row's content between rest and hover.
5. → assert `OPEN` renders as an icon **plus the text "OPEN"**, right-aligned in the title cell.
6. Click `OPEN`. → assert a side peek opens and the button now reads `CLOSE`.
7. → assert the URL gained `p=<noteId>` and `pm=s`.
8. Reload the page. → assert the peek reopens on the same row.
9. Click `CLOSE`. → assert the peek closes and the URL params are removed.
10. Click the drag handle. → assert a menu opens **and** the row becomes selected.
11. → assert the menu's first element is a search input placeholdered `Search actions…`.
12. → assert the rows are, in order: Add to Favorites, Edit icon, Edit property, Open in, Comment, Copy link, Duplicate, Move to Trash. (Assert the deliberate absence of "Move to".)
13. → assert `Comment`, `Duplicate` and `Move to Trash` show right-aligned hints.
14. → assert a footer shows last-edited-by and a timestamp.
15. Click `Open in`. → assert a flyout opens **to the right** with the parent still visible, containing exactly `New tab` and `Side peek`.
16. Press Escape. → assert the menu closes and focus returns to the drag handle.
17. Select two rows via their checkboxes. → assert the bulk bar reads `2 selected`.
18. → assert the header checkbox is present and selects all.
19. Click `Move to Trash` on one row. → assert the row disappears and appears in Trash.
20. Drag a row by its handle to a new position. → assert the order persists across a reload.
