# Row peek

> **Milestone:** M10
> **Ground truth:** `raw-dom/row-peek.txt`, `layout-and-open-pages-in.txt` ·
> `screenshots/62-peek-side.jpg`, `64-peek-menu.jpg`, `65-peek-add-property.jpg`,
> `22-open-pages-in.jpg`
> **Today:** `components/database/RowPeek.tsx` — a fixed `max-w-2xl` drawer with a
> `bg-black/30` backdrop, component state only.
> **Binds to:** `DatabaseRow`, `GET`/`PATCH /api/notes/{id}`, `view.config` for the default
> open mode.

---

## Trigger

| Entry point | Result |
|---|---|
| The row's `OPEN` button (hover-revealed) | Opens in the view's **default** mode |
| Row menu → `Open in` → `Side peek` | Forces side peek |
| `Alt+Click` the row | Side peek |
| Row menu → `Open in` → `New tab` | Full page in a new tab |

The view's default mode is set in **Settings → Layout → Open pages in**: `Side peek`
(default for Table), `Center peek`, or `Full page`.

While a peek is open, the row's `OPEN` button reads **`CLOSE`** — it is a toggle.

---

## Anchor

| Property | Value | Ours today |
|---|---|---|
| Placement | Right portion, x≈650–1300 at a 1300px viewport — about **half** | Right drawer, `max-w-2xl` |
| **Backdrop** | **None** | `bg-black/30` over the whole viewport |
| **Modality** | **Non-modal** — the table stays visible **and interactive** | Modal; interaction trapped |
| Resize | Left edge draggable — `TBD` whether width persists | Not resizable |
| Dismiss | `×`/`»` in the header, `CLOSE` on the row, Escape | Escape, backdrop click |

> Notion's own copy for the mode is *"Open pages on the side. **Keeps the view behind
> interactive.**"* Non-modality is the stated intent, not an accident. **Ours must change.**

---

## URL

Opening the peek rewrites the URL:

```
?v=<viewId>&p=<pageId>&pm=s
```

| Param | Meaning |
|---|---|
| `v` | the active view |
| `p` | the peeked page (row) |
| `pm` | peek **mode** — `s` for side peek |

So a peek is **deep-linkable and restorable**, and the mode travels with the link. Our
`peekRowId` (`TableView.tsx:180`) is component state — nothing in the URL, nothing
restorable, nothing shareable.

**Adopt `?p=<noteId>&pm=s|c` to match.**

---

## Header bar

```
»   ⤢                                        Share   ★   ⋯
```

| Control | Purpose |
|---|---|
| `»` | Collapse / return to the table |
| `⤢` | Expand to **full page** |
| `Share` | Page sharing |
| `★` | Favourite |
| `⋯` | The **page** menu — see below |

`TBD` — prev/next row navigation was **not** observed in the header. Our plan assumed it
exists; do not spec it without evidence.

---

## Title

The row's title, rendered large and **directly editable**, with the caret placed on open.

---

## Property list

```
[type icon]  [property name]  ..........  [value or "Empty"]
```

| Aspect | Behaviour |
|---|---|
| Ordering | **Alphabetical** — *not* table order |
| Title property | **Excluded** — it is the heading instead |
| Empty values | Render the literal muted word **`Empty`** |
| Set values | Render as their real control (a Select shows its coloured chip) |
| Last row | **`+ Add a property`** |

> Notion uses **both** orderings deliberately: *table order* where you reorder (Property
> visibility panel), *alphabetical* where you scan (peek, Group, Sort, Filter pickers).
> Our `RowPeek.tsx:69-72` sorts by `position`. **This is a checkable difference.**

### `+ Add a property`

Opens the type picker — rendered **single-column**, section labelled `Type`, placeholder
`Property name`. The table header's version is **two-column**, labelled `Select type`,
placeholder `Type property name…`.

Notion is not self-consistent here. **We pick one rule:** single-column in narrow hosts
(peek, sidebar), two-column in wide ones, and **one** shared copy string.

Adding a property here writes **schema** — it affects every view, not just this row.
Per `property-create-edit.md`, such a panel should carry a scope disclaimer.

---

## The `⋯` menu — a *page* menu, not a row menu

Because a row **is** a page, this is the standard Notion page menu. It is **not** the row
menu from `row-affordances.md`.

| Group | Rows |
|---|---|
| — | Search actions… (autofocused) |
| Fonts | 3-card picker: `Default` / `Serif` / `Mono` |
| Actions | Copy link `Ctrl+Alt+L` · Copy page contents · Duplicate `Ctrl+D` · Move to `Ctrl+⇧+P` · Move to Trash |
| Display toggles | Small text · Full width · Table of contents (**on**) · Customize layout |
| Page | Lock page · Use with AI ✅ sub-panel |

Four inline toggles — `MenuRow`'s toggle kind is now confirmed across three surfaces.

> **Scope this deliberately.** Most of this menu is *editor* chrome (fonts, small text,
> full width, table of contents), not database behaviour. It belongs to our note-page
> surface, not to database parity. **Recommend: M10 ships the peek shell, the property
> list and `+ Add a property`; the `⋯` menu reuses whatever our note page already has.**

---

## Below the properties

A **`Comments`** section header, then the page body. `TBD` — comments UI and body
rendering not captured; our peek already embeds `BlockEditor` for the body.

---

## Keyboard

| Key | Behaviour | Status |
|---|---|---|
| Escape | Closes the peek | ours does; Notion `TBD` |
| Focus on open | The title, caret placed | confirmed |
| `Alt+Click` a row | Opens the side peek | from the menu hint |
| `Ctrl+⇧+↵` | Opens in a new tab | from the menu hint |
| Prev / next row | **Not observed** | `TBD` |

---

## States

| State | Behaviour |
|---|---|
| Side peek (`pm=s`) | Right half, no backdrop, table interactive |
| Centre peek (`pm=c`) | Centred modal — `TBD`, not captured |
| Full page | Navigates away |
| All properties empty | Each shows the muted word `Empty` |
| Row deleted while open | `TBD` |
| Read-only source (`is_virtual`) | Properties render read-only; `+ Add a property` suppressed |

---

## Persistence

| Action | Writes | When |
|---|---|---|
| Open / close | URL params `p`, `pm` | Immediately |
| Edit title | `PATCH /api/notes/{id}` | Debounced |
| Edit a property | The row property PATCH, same path as a table cell | Immediately |
| `+ Add a property` | `POST /db/data-sources/{id}/properties` — **schema-level** | Immediately |
| Body edits | `PATCH /api/notes/{id}` `{content, content_text}` | On editor save |

> Our `RowPeek` already debounces a re-index 30s after a body save (`:118-127`). Keep that.

---

## Checklist

1. Hover a row and click `OPEN`. → assert a peek opens on the **right half**.
2. → assert there is **no dark backdrop** and the table behind is still **clickable**.
3. → assert the row's button now reads **`CLOSE`**.
4. → assert the URL gained `p=<noteId>` and `pm=s`.
5. Reload. → assert the peek reopens on the same row in the same mode.
6. Click a cell in the table **behind** the peek. → assert it responds (non-modal).
7. → assert the header shows `»`, `⤢`, `Share`, `★`, `⋯`.
8. → assert the title is directly editable with the caret placed on open.
9. → assert properties are listed **alphabetically**, excluding the title property.
10. → assert empty properties render the literal word **`Empty`**.
11. → assert a set Select property renders as its **coloured chip**.
12. Click `+ Add a property`. → assert a **single-column** type picker with placeholder `Property name`.
13. → assert it carries a scope disclaimer, since it writes schema.
14. Add a property. → assert the new column also appears in the **table**.
15. Click `⋯`. → assert the page menu opens with a search field and toggles.
16. Set Settings → Layout → Open pages in → `Center peek`, then open a row. → assert a **centred modal** and `pm=c` in the URL.
17. Set it to `Full page`, open a row. → assert navigation to the full page.
18. Press Escape with the peek open. → assert it closes and the URL params are removed.
