# Notion UI reference (measured)

A measured reference of Notion's 2026 web UI, built so that **My Second Brain** (`frontend/`, Next.js 16 + Tailwind + BlockNote)
can be redesigned to look and feel exactly like Notion **without access to Notion**.

- **Captured:** 2026-10-12 to 2026-10-13, on `app.notion.com`, in a real logged-in Chrome driven by Claude in Chrome.
- **Fixture:** the private page "UI Reference (Claude)" with every block type, a 15-row "Projects" database (19 property types, all 10 option colours, 8 views), a "Clients" database (relation and rollup) and an "Empty DB". It is left in Notion for later comparison. The build log is in `_raw/a-build.md`.
- **Themes:** every surface was captured in light and dark (dark colours for all of them; dark screenshots for the key ones).

## How to use this folder
| File | What it is |
|---|---|
| [`tokens.json`](tokens.json) | Design tokens: light/dark colours, option and block palettes, fonts, type scale, spacing, radii, shadows, z-index, durations |
| [`checklist.md`](checklist.md) | **331 numbered, verifiable acceptance criteria** for the redesign, grouped by area |
| [`preferences.md`](preferences.md) | Every Notion user and workspace preference, with options and defaults |
| [`surfaces/shell.md`](surfaces/shell.md) | Sidebar, top bar, page ⋯ menu, quick find, toast, tooltip |
| [`surfaces/page.md`](surfaces/page.md) | Page grid, cover, icon, title, page controls, width, Small text, fonts, TOC |
| [`surfaces/blocks.md`](surfaces/blocks.md) | Every block type, spacing model, inline styles, block colours, handle, block menu, slash menu, selection toolbar, placeholders |
| [`surfaces/database-table.md`](surfaces/database-table.md) | Database header, tabs, toolbar, table, every cell type, option palette, selection, calculations, inline DB, **all editors, property menus, type picker, edit-property, grouping, filters and sorts** |
| [`surfaces/database-board.md`](surfaces/database-board.md) | Board columns, tints, cards, New row |
| [`surfaces/database-gallery.md`](surfaces/database-gallery.md) | Gallery grid, card sizes, covers |
| [`surfaces/database-other-views.md`](surfaces/database-other-views.md) | List, Calendar, Timeline, Chart |
| [`surfaces/row-page.md`](surfaces/row-page.md) | Side/center peek, full page, properties block, comments, view settings panel and all its sub-pages, new-view picker |
| [`surfaces/menus-overlays.md`](surfaces/menus-overlays.md) | The menu primitive, toggle, tooltip, modals, buttons, emoji picker, focus rings, scrollbars, empty states |
| [`surfaces/settings.md`](surfaces/settings.md) | The Settings modal: nav, content layout, every control, every tab |
| `_raw/*.md` | The raw capture notes per batch (a–j), with more detail and DOM notes than the surface files. `_raw/_method.md` is the measuring method |
| `screenshots/` | 280 screenshots, named `<batch>-<surface>-<light|dark>.(jpg|png)` |

Start with `tokens.json` and `surfaces/menus-overlays.md` (the shared primitives), then build surface by surface, using `checklist.md` as the definition of done.

## How the measurements were taken
- Values come from **`getComputedStyle` on the live DOM** and `getBoundingClientRect` for sizes, with helpers injected into the page (`_raw/_method.md`). Hover states were measured after a real mouse hover. Keyboard behaviour was tested with real key events.
- Light/dark was switched with Notion's own **Ctrl+Shift+L**. The user's Appearance setting was **Light** before and after.
- The earlier measurements in `docs/superpowers/specs/2026-08-28-notion-databases-ui-parity-design.md` §5 and the `--menu-*` tokens in `frontend/app/globals.css` were **re-verified and still hold** (menu bg, radius 10px, the per-theme shadow geometry, 28px rows, hover and divider colours, field and badge colours, 248px column menu). The differences found:
  - The column-header **Edit property** opens a **300px flyout**. The **483px docked sidebar** is confirmed for **View settings**, where Edit property is a pushed page. Both exist.
  - The type picker is **415px**, not 378. The filter quick-picker is **290px**, not 285.
  - The select cell editor has **radius 6px**, not 10.
  - Small floating controls (OPEN, action bar, hover chips) use a lighter shadow (`shadow.floatButton`) than menus.
  - There are **two disabled styles**: colour `rgb(188,186,182)`, and opacity 0.4.
  - Keyboard behaviour that the old spec marked TBD has now been tested (`database-table.md` §9.9).
- **Viewport deviation:** the requested 1440×900 was impossible because the machine's screen is 1366×768. Captures use **1300×649** (some batches **1300×597**), at DPR 1 and 100% zoom. Sizes, colours, radii and shadows do not depend on the viewport. Widths in % or vw (e.g. the side peek's 650px, quick find's 9vh offset, cover 30vh) are noted where they occur.

## Things to know before building
- **This is the 2026 Notion UI**, and several things differ from the Notion most clones copy:
  - The sidebar has a pill nav row and a floating New page button.
  - The top bar has no Comments or Updates buttons.
  - View tabs are pills with no underline.
  - The toolbar has a sliders "Settings" button.
  - The selection toolbar is a vertical card.
  - Calculations are set from the column header menu, not by hovering the footer.
  - There is no "+N more" in the calendar.
- **Option pill colours and block text colours are two different palettes** (`tokens.json → color.option` vs `color.block`).
- Your brief's example "Table row height is 33px" is not what Notion measures today. **Rows are 37px** (36px plus a 1px border). The checklist uses measured values only.

## What could NOT be captured, and why
| Item | Why |
|---|---|
| 1440×900 viewport | The screen is 1366×768. See above |
| Sidebar resize min/max width | Dragging the resize handle did not work through automation. Default 270px only |
| Quick-find footer and max-height | The viewport was too short |
| Peek and modal **open** animations | The first sampled frame was already final (main thread busy). Close animations and declared transitions are recorded |
| Files "Upload / Embed link" popover | Notion opens the native OS file chooser, which can't be driven |
| Formula autocomplete while typing | Typing would edit the fixture's formula |
| Status dot colours for orange/yellow/purple/pink/red, and the light "Done" board ring | No fixture option used them. Fallbacks are noted in `tokens.json` |
| Select/tag/person pills on board cards, Compact card layout | A permission check refused further view-setting changes mid-batch |
| Timeline's left table panel | Opening it would persist a view setting |
| Empty board column, hidden groups, "N more properties", property groups, backlinks | Not present in the fixture |
| Automations UI | Paywalled on this plan |
| Settings: Upgrade plan, pickers listing private pages, Time zone list, some sub-tabs | Forbidden by the ground rules, private data, or disabled |
| Primary button pressed state, select hover colour | Pressing creates content. Hover read back the rest colour |
| Workspace switcher menu screenshot | It shows real account data. Described in text only (`_raw/i-empty-menus-overlays.md` §7b) |

## Fixture side effects (all inside "UI Reference (Claude)")
- One blank row created by a mis-click was **moved to Trash** (it is recoverable from Notion's Trash).
- A stray edit to the reference page title was reverted to "UI Reference (Claude)".
- A temporary property "TMP" was created and deleted.
- Calculations, grouping, card sizes and toggles that were changed to measure them were reverted. The one exception: the **Gallery view's card size** is now an explicit "Medium" (16:9 covers), where it used to be an unset default (146px covers).
- No other Notion content or settings were changed.

## Privacy
Screenshots show only the fixture and the settings UI. Names, emails, avatars, workspace names and non-fixture page titles were replaced client-side ("Jane Doe", "user@example.com", "Workspace", "Page") before capture. Text files use `<user>` placeholders.
