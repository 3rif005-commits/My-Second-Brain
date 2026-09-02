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

**Right-click anywhere on the row opens the same menu** and also selects the row — but it
is anchored at the **pointer position**, not to the drag handle. There is no separate
context menu. (Confirmed 2026-08-31.)

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
- **view setting** — the default for *every* row. **Captured** (view settings → Layout →
  "Open pages in"): three modes, each with a description line —
  **Side peek** *("Open pages on the side. Keeps the view behind interactive." — annotated
  "Default for Table")*, **Center peek** *("Open pages in a focused, centered modal.")*,
  **Full page** *("Open pages in full page.")*

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
| Peek is non-modal | Notion's own copy: *"Keeps the view behind interactive."* The table stays usable while a side peek is open. Our `RowPeek` renders a `bg-black/30` backdrop and blocks interaction — **must change** |
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

---

## List view (M12) — confirmed deltas vs Table, captured live 2026-09-02

> Ground truth: `raw-dom/row-affordances-list-view.txt` ·
> `screenshots/list-row-{rest,hover,menu,peek,edit-toggle}.jpg`

The plan's M12 task breakdown (`docs/plans/2026-08-28-notion-databases-ui-parity.md`)
named List's own row-affordances shape as needing its own capture rather than assuming
this file's Table-shaped one transfers verbatim. It mostly does — with four confirmed
differences:

1. **No checkbox in the gutter.** List's left gutter has only `+` and the drag handle
   (⠿), not Table's three. Right-click and the drag handle's own click still visibly
   select the row (tinted), so bulk selection may still exist via some other gesture —
   `TBD`, not found this session.
2. **No separate `OPEN`/`CLOSE` button.** The entire row is itself a real `<a>` — a
   plain click anywhere on the icon/title opens the side peek directly (confirmed via
   the URL gaining the identical `p=<noteId>&pm=s` row-peek.md already established for
   Table), respecting the view's "Open pages in" default the same way. There's just no
   separate labelled control for it; the row itself is that control.
3. **A new "Edit" button, no Table equivalent.** A small pencil icon appears inside the
   hovered row, after the title. Clicking it turns the title into an inline-editable
   field AND reveals the row's other Property-Visibility-visible properties as
   right-aligned "Add `<Name>`" quick-fill prompts on the same line — Table never needs
   this (every cell is already independently click-to-edit); List's one-line layout has
   nowhere to put untitled properties at rest, so this is the on-demand reveal for them.
   Unclicked-through: which editor opens from one of those prompts (very likely the same
   `renderCellValue` dispatcher every other view already shares — see `PROGRESS.md`'s M12
   survey — but not confirmed live).
4. **The row menu itself is identical** to Table's, row for row, including the `Open in`
   flyout (`New tab` / `Side peek`, same shortcuts). One addition spotted in the footer —
   a `<N> words, <N> characters` line below the timestamp — possibly present on Table too
   and simply not recorded there; low priority to re-check.

**Not verified, same reasons as Table's own checklist:** drag-to-reorder (this
environment's own established drag-simulation limitation), and which two properties this
session's fixture had set visible (the settings sidebar's Property visibility submenu
kept dismissing on click — a repro not chased down, out of scope for this capture).

### Built (2026-09-02)

`ListView.tsx` rebuilt around this capture, reusing shared M9/M10 infra rather than a
second copy: `RowGutter` (new `showCheckbox` prop, `false` here — List's own gutter has
only `+`/drag-handle), the row menu (`buildRowMenu`, unchanged), and the row peek's own
URL sync — extracted out of `TableView.tsx` into a new shared `lib/database/useRowPeek.ts`
hook (identical behavior, just no longer duplicated; every future M12 view reuses this
same hook instead of copy-pasting Table's own ~60 lines). `hidden_properties`/
`property_order` now read via the same `viewConfig.ts` helpers Table already uses — a real
gap this view had (silently no-op before now, confirmed by the M12 code survey).

**The title's inline-edit + revealed-properties area is genuinely new UI** (delta #3
above) — there was nothing to reuse. Built as local component state
(`editingRowId`/`titleDraft`), toggled by the Edit button, closed on Escape or on the
ROW's own blur (not the title input's blur in isolation — see the live-found bug below).

**A real bug found live, fixed, and regression-tested:** the title input's own `onBlur`
closed the whole editing row (unmounting the revealed properties with it) on every
mousedown, BEFORE a click headed to one of those properties ever landed — the identical
"trigger swaps mid-interaction, dismiss logic wins the race" class M11's cell-editing
session already hit twice (`AddPropertyPopover`, `SelectCell`). Reproduced live: clicking
a revealed property's own value right after typing a title never worked, the row
collapsed back to read-only first. Fixed by moving the exit-edit decision to the row's own
`onBlur` (checking `e.relatedTarget` stayed inside the row), matching this codebase's own
established fix pattern for this exact bug class.

**Live-verified before the fix was found:** resting state (nothing visible), hover
(gutter + Edit appear, no layout shift), the Edit toggle (title becomes editable, revealed
property chip appears), the row menu (drag handle click, identical rows to Table's),
`Open in → Side peek`, a plain click opening the peek via `?p=&pm=s`. **Not re-verified
live after the blur-race fix** — the automation environment ran out of memory mid-session
(confirmed via `free -h`: 590MB free, 3.4/3.7GB swap — the same class of exhaustion
several prior sessions in this workstream have hit) and the Chrome extension didn't
reconnect after freeing memory; a full Chrome restart would fix it but closes the user's
open tabs, so left for the user rather than done unilaterally. The fix itself is covered
by two new jsdom regression tests reproducing the exact blur/`relatedTarget` sequence a
real click triggers, not just asserted "should work."

Tests: `ListView.test.tsx` rewritten (13 tests — rest-state-hides-properties, Edit reveals
them in position order, `hidden_properties` respected, inline title commit, peek-opens-not-
navigates, no-checkbox, read-only suppression, the two blur-race tests, add-row via both
the gutter and the bottom "+ New page"). `RowGutter.test.tsx` gained one test for
`showCheckbox={false}`. `DashboardView.test.tsx`'s own `next/navigation` mock extended
(it embeds List as a widget type, which now needs `usePathname`/`useSearchParams` too).

---

## Row peek rolled out to every remaining view (2026-09-02)

> Not part of List's own capture above — a separate, capture-independent fix applied the
> same session, closing a gap the M12 code survey (`PROGRESS.md`) itself flagged: "Row
> peek internals (M10)... only `TableView.tsx` imports `RowPeek` — every other view opens
> a row via full navigation (`OpenNoteButton`) only, never the peek."

M10's row peek (`?p=`/`?pm=` URL sync, non-modal side/center panel, "Open pages in"
respect) was always view-agnostic INTERNALLY — nothing about `RowPeek.tsx` itself is
Table-specific. The gap was purely that no other view's own row/card ever called it.
Closed for Feed, Board, Gallery, Calendar, and Timeline the same session List's own
`useRowPeek` hook was extracted, reusing that exact hook rather than five more copies of
Table's own ~60 lines:

- **Feed** — the card title's click now calls `openRow` instead of a bare `useOpenNote`
  navigation.
- **Board** / **Gallery** — `OpenNoteButton` already had an `onOpen`/`isOpen` prop pair
  built for exactly this (M9's own doc comment: "every other caller omits this and keeps
  today's exact navigate-to-Workspace behavior unchanged" — no longer true). Both now pass
  `onOpen={openRow}` and a real `isOpen`, which also means Board/Gallery cards get the
  labelled `OPEN`/`CLOSE` toggle Table's own row already had, not just an icon.
- **Calendar** / **Timeline** — same `OpenNoteButton` wiring on their own event bars/rows.

**No new UI shape was invented anywhere** — every one of these already had the exact
`OpenNoteButton` control M9 built; this only changed what clicking it DOES (peek vs. bare
navigation), matching each view's own "Open pages in" config the same way Table/List
already did. Calendar/Timeline's event bars show no property list at all (just the
title), so `hidden_properties`/`property_order` don't apply there — nothing to fix.

**A second, closely-related fix landed the same pass, once the pattern was visible in
Board/Gallery's own code:** their cards ALSO silently ignored `property_order` (both
always sorted by schema `position`, never the Property Visibility panel's own drag-
reorder), and Board additionally ignored `hidden_properties` outright — the identical
"Property Visibility writes a key, nothing reads it" class Table's own `orderedProperties`
had before M3's review checkpoint fixed it once. Both now read through the same
`viewConfig.ts` helpers (`orderProperties`/`getHiddenKeys`) List's own build already
established, via a precomputed `otherProps` list passed down to `BoardCard`/`GalleryCard`
rather than each card re-deriving its own order. Gallery's own DELIBERATE difference —
`hidden_properties` may include the title key there, hiding it — was left untouched;
only its missing `property_order` support was added.

**Not live-verified** — same environment-exhaustion reason as List's own post-fix
re-check above. Every one of these changes is covered by a new jsdom test per view
(`BoardView.test.tsx`, `GalleryView.test.tsx`, `CalendarView.test.tsx`,
`TimelineView.test.tsx`, `FeedView.test.tsx`) asserting the `?p=<rowId>&pm=s` URL a real
click writes, replacing each file's own now-obsolete "navigates to the workspace route"
assertion, plus one hidden/ordered-properties test each for Board and Gallery — not just
a hope it behaves the same as List's already-live-verified version of the identical hook.
