# Database: header, toolbar and Table view

Sources: `_raw/d-table.md` (database at rest, cells, palette, selection, calculation),
`_raw/e-table-editing.md` (editors, property menus, config panel, grouping, filter/sort chips).
Measured 2026-10-12 with `getComputedStyle`. Fixture: the "Projects" database (15 rows, 19 property types).

Screenshots, at rest:
[full table](../screenshots/d-table-full-light.jpg) ·
[header + toolbar + overflow tabs](../screenshots/d-header-toolbar-overflow-light.png) ·
[header + table dark](../screenshots/d-header-toolbar-table-dark.jpg) ·
[views overflow menu](../screenshots/d-views-overflow-menu-light.png) ·
[New ▾ templates](../screenshots/d-new-templates-menu-light.png) ·
[toolbar search open](../screenshots/d-toolbar-search-open-light.png) ·
[title hover](../screenshots/d-title-hover-add-description-light.png) ·
header icons [1](../screenshots/d-header-icons-1-light.png) [2](../screenshots/d-header-icons-2-cells-light.png) [3](../screenshots/d-header-icons-3-light.png) [4](../screenshots/d-header-icons-4-end-light.png) ·
[column resize handle](../screenshots/d-column-resize-handle-light.png) ·
[row hover gutter + OPEN](../screenshots/d-row-hover-gutter-open-light.png) ·
[row hover dark](../screenshots/d-row-hover-gutter-open-dark.png) ·
[OPEN hover](../screenshots/d-open-button-hover-light.png) ·
[drag handle hover](../screenshots/d-row-drag-handle-hover-light.png) ·
[selected rows + action bar](../screenshots/d-selected-rows-action-bar-light.jpg) ·
[action bar zoom](../screenshots/d-selected-rows-action-bar-zoom-light.png) ·
[selected dark](../screenshots/d-selected-rows-action-bar-dark.jpg) ·
cells dark [1](../screenshots/d-cells-date-person-email-checkbox-url-dark.jpg) [2](../screenshots/d-cells-edited-button-id-relation-rollup-dark.jpg) ·
[select editor dark](../screenshots/d-select-cell-picker-dark.png) ·
[option colour menu dark](../screenshots/d-option-color-menu-dark.jpg) ·
[new-page row hover](../screenshots/d-new-page-row-hover-light.png) ·
[header menu → Calculate](../screenshots/d-header-menu-calculate-light.jpg) ·
[Count submenu](../screenshots/d-calculate-count-submenu-light.jpg) ·
[calc footer](../screenshots/d-calc-footer-count-light.png) ·
[calc footer dark](../screenshots/d-calc-footer-count-dark.png) ·
[calc value menu](../screenshots/d-calc-footer-menu-light.jpg) ·
[inline linked DB](../screenshots/d-inline-linked-db-light.jpg) ·
[inline linked DB dark](../screenshots/d-inline-linked-db-dark.jpg)

Colours below are light / dark. Shadow names refer to `tokens.json → shadow`.

---

## 1. Database header (full page)

- A full-page database is **always full width**: `padding: 0 96px` inside the frame (not the 720px column).
- **Title:** `h1`, **32px / 38.4px / 700**, `rgb(44,44,43)` / `rgb(240,239,237)`, `padding 0 8px`.
- On title hover a bar appears above it: **"Add icon · Add cover · Add description"** (28px buttons, padding 0 8px, radius 6px, 14px/400 `rgb(161,158,153)`, icon 14px, `transition: opacity .1s`; hover bg `rgba(33,27,23,0.051)`).
- Title → views bar: 8px. Views bar → table header: 0 (the views bar is 40px tall).

### View tabs: rounded pills, no underline
| Part | Value |
|---|---|
| Tab `div[role=tab]` | **h 32, padding 6px 12px, radius 20px** (pill), flex, nowrap, `transition: background .1s ease-in-out` |
| Spacing | each tab is in a 40px-tall drag container with `margin-right 1px`, so tabs are 1px apart |
| Icon | layout svg (`viewTable`, `viewBoard`, …) **20×20, margin-right 6px**, fill = text colour |
| Label | **14px / 500 / 16.8px**, margin-top 1px |
| **Active** | bg `rgba(33,27,23,0.05)` / `rgba(255,255,255,0.055)`; text `rgb(44,44,43)` / `rgb(240,239,237)` |
| Inactive | no bg; text + icon `rgb(125,122,117)` / `rgb(173,169,163)`; **same weight 500** |
| Inactive hover | bg `rgba(33,27,23,0.051)` / `rgba(255,255,235,0.1)` |
| Overflow | "**4 more…**" button: h 32, padding 6px 10px, radius 20px, **14px / 400**, `rgb(125,122,117)` |
| Tooltip (hover ≈0.5s) | standard dark tooltip: line 1 the view name, line 2 "Table view of Projects" (`rgb(173,169,163)`), 6px below |

- **There is no border under the views bar.** The only horizontal line is the table header row's bottom.
- **No "+" add-view button in the bar.** "+ New view" is at the bottom of the "N more…" menu.
- **"N more…" menu:** a standard menu card **290px** wide, radius 10px, `shadow.menu`, 4px below the button and left-aligned with it. It has a focused search field "Search for a view…" (258×28, bg `rgba(66,35,3,0.03)`, radius 6px, blue focus ring), then **all** views as 28px rows (⋮⋮ handle, 20px view icon, name, ⋯ at right; the current view is highlighted), and "+ New view" at the bottom.

### Toolbar (right side of the views bar)
- Container: h 40, `padding-right 8px`, `transition: opacity .1s ease-in-out`.
- Order: **Filter · Sort · Automations ⚡ · AI Autofill (wand) · Search 🔍 · Settings (sliders) · [New ▾]**.
  The old "⋯" view-settings button is now a **sliders icon** labelled "Settings".
- Icon buttons: **28×28, padding 6px, radius 6px**, no gap between them. Icon 16×16 fill `rgb(142,139,134)` / `rgb(173,169,163)`. Hover bg `rgba(33,27,23,0.051)` / `rgba(255,255,255,0.055)`.
- **Search:** clicking 🔍 opens a borderless, background-less input to the right of the icon, **150px** wide, 14px, placeholder "Type to search…". `transition: width .2s, opacity .2s` (it grows from 0). Esc closes it.
- **New split button** (68×28, 6px left margin):
  - "New": **44×28, padding 0 8px, radius `6px 0 0 6px`, bg `rgb(39,131,222)`, text `rgb(243,249,253)` 14px / 500 / 21px**, `transition: background .02s ease-in`.
  - Chevron: **24×28, radius `0 6px 6px 0`**, same bg, 16px chevron. The divider is `box-shadow: rgba(28,19,1,0.11) 1px 0 0 0 inset` (dark `rgba(255,255,235,0.1)`).
  - Hover darkens **only the hovered half**: light `rgb(31,118,204)`. **In dark the hover is lighter: `rgb(61,144,225)`.**
  - **▾ dropdown:** card **360px**, radius 10px, `shadow.menu`, **right-aligned to the button, 4px below**, `transition: opacity .2s, transform .2s`. Contents: header "Templates for Projects" (14px/500 `rgb(125,122,117)`, with a ? help icon), help text (14px `rgb(161,158,153)`), a divider, and "+ New template".

## 2. Table header row
- `div.notion-table-view-header-row`: **height 36px**. Its only line is
  `box-shadow: <page-bg> -3px 0 0 0, rgba(42,28,0,0.07) 0 -1px 0 0 inset` (dark `rgba(255,255,243,0.082)`). That gives a 1px bottom line. **No top line, and no vertical lines in the header.**
- **Sticky:** when scrolled, it sticks under the 44px top bar with bg = page bg.
- Header cell: `div.notion-table-view-header-cell` (cursor grab) > `div[role=button]` (**padding 0 8px**, `transition: background .02s ease-in`) > flex (h 24, **gap 6px**) = [18×24 icon box] + label.
- Label: **14px / 400 / 16.8px, `rgb(125,122,117)` / `rgb(173,169,163)`**, ellipsis.
- **Property-type icon:** a 19.2×19.2 `div` painted via **CSS `mask-image: url(https://app.notion.com/icons/<name>_gray.svg)`** with `background-color: rgb(142,139,134)` / `rgb(173,169,163)`.

| Type | Icon file | Looks like |
|---|---|---|
| Title | `font` | "Aa" |
| Text | `description` | 4 left-aligned lines, the last shorter |
| Number | `hashtag` | # |
| Select | `arrow-circle-down` | circle with a filled down-triangle |
| Multi-select | `list` | bulleted list |
| Status | `burst` | dashed "loading" circle (8 radial dashes) |
| Date | `calendar` | filled calendar page |
| Person | `friends` | two people |
| Email | `username` | @ |
| Formula | `formula` | Σ |
| Checkbox | `checkmark-square` | filled rounded square with a white check |
| URL | `link` | diagonal chain link |
| Created time / Last edited time | `clock` | filled clock |
| Files & media | `attachment` | paperclip |
| Button | `cursor-button` | button with a cursor |
| Unique ID | `numero` | № |
| Relation | `arrow-northeast` | ↗ |
| Rollup | `search` | magnifying glass |

- **Column widths:** title **280px**, every other column **200px** (the default for a new column).
- **Header cell hover:** bg `rgba(33,27,23,0.051)` over the full cell (radius 0). The icon does not change.
- **Resize handle:** **5px wide × 36px** (header only), centred on the column's right edge. Transparent at rest, **hover `rgba(35,131,226,0.8)`** (a blue bar), `cursor: col-resize`, `transition: background .2s ease-out`.
- After the last column: a **"+" add property** button (28×28, radius 6px, `plusSmall` 16px `rgb(142,139,134)`) and a **"⋯"** button (28×28, radius 6px). The trailing area is 56px wide.

## 3. Rows and grid
- **Grid lines are cell borders:** every `div.notion-table-view-cell` has **`border-right: 1px solid rgba(42,28,0,0.07)` and `border-bottom: 1px solid rgba(42,28,0,0.07)`** (dark `rgba(255,255,243,0.082)`). Horizontal and vertical lines are the same colour as the header line.
- No outer left border on the title column. The top line is the header row's inset shadow.
- Cell content: **padding 7.5px 8px, 14px / 21px / 400**, primary text colour.
- **Row height: 37px** (36 + 1px border) for single-line rows. Rows grow when content wraps (e.g. a 2-line date range is 57px).
- **No row hover background.** Hovering a row reveals the OPEN button and the gutter controls.
- Row DOM: `notion-collection-result-wrapper > notion-page-block (8px gutter) > notion-table-view-row (margin-left 8px) > flex > cells`.

## 4. Title cell, OPEN, gutter
- Title: page icon (or `pageEmpty` 18×18 `rgb(161,158,153)` / `rgb(125,122,117)` when the page has none), gap 6px, text **14px / 500**, no underline.
- **OPEN button** (on row hover, inside the title cell, right edge ≈5px from the cell border, vertically centred):
  - Outer: **69×24, padding 2px, radius 6px, bg #fff** / `rgb(32,32,32)`, `shadow.floatButton`.
  - Inner: padding 0 4px, radius 4px, gap 6px. Text **"OPEN" 12px / 500 / 18px, letter-spacing 0.5px, uppercase**, `rgb(125,122,117)` / `rgb(173,169,163)`. Icon `peekSide` 15×20 `rgb(142,139,134)`.
  - Inner hover: bg `rgba(33,27,23,0.051)` / dark inner bg `rgb(37,37,37)` → hover `rgba(255,255,255,0.055)`.
- **Gutter** (in the 96px page padding, vertically centred on the row):
  - **"+"** (add row below): 24×24 at table-x − 86, radius 4px, icon 20px `rgb(173,169,163)` / `rgb(125,122,117)`.
  - **Drag handle ⋮⋮**: **18×24** at table-x − 62, radius 4px, 6-dot icon 20px, same colour, cursor grab, hover bg `rgba(33,27,23,0.051)`.
  - **Row checkbox**: 36×36 hit area at table-x − 36. The box is **16×16, radius 3px, border 1px solid `rgba(27,21,0,0.19)`** (dark `rgba(255,252,235,0.306)`). **Opacity 0 at rest → 0.7 on row hover → 1 on checkbox hover** (`transition: opacity .2s`). Checkbox hover bg `rgba(66,35,3,0.047)` / `rgba(252,252,252,0.047)`.

## 5. Selection
- **Selected row:** an overlay `div.notion-selectable-halo`, **bg `rgba(35,131,226,0.14)`** (both themes), covering the row's 36px content height and the full table width (not the gutter), radius 0.
- Checked row checkbox: bg `rgb(39,131,222)`, white check 14px, stays visible.
- A **header select-all checkbox** appears in the header gutter. Partial selection shows a white **dash** on blue.
- **Multi-select action bar:** floats **over the left part of the views bar** at (table-x − 10, views-bar y). **462×32, radius 5px**, bg #fff / `rgb(37,37,37)`, `shadow.floatButton`. Segments are separated by `box-shadow: rgba(42,28,0,0.07) 1px 0 0 0`:
  1. "**N selected**", padding 0 10px, 14px, **blue `rgb(39,131,222)`**.
  2. One quick-edit button per visible property (type icon + name), padding 0 8px.
  3. Trash icon.
  4. "⋯" (30×32).
- **Esc** clears the selection.
- **Selected cell** (after closing an editor): overlay `box-shadow: rgb(39,131,222) 0 0 0 2px inset`, bg `rgba(35,131,226,0.07)`, radius 2px. Esc on a selected cell selects its row. A second Esc clears it.

## 6. Cell rendering per property type
| Type | Rendering |
|---|---|
| Text | 14/21 primary colour, wraps |
| Number | **right-aligned** (`text-align: end`). Currency format "$22,000.00" |
| Formula (number) | right-aligned |
| **Select** | pill **h 20, padding 0 6px, radius 4px, 14px / 400**, line-height 20px |
| **Multi-select** | same pills, `flex-wrap: wrap; gap: 6px 8px` |
| **Status** | pill **h 20, radius 10px, padding `0 9px 0 7px`**, nowrap + ellipsis, with a leading **dot 8×8 (radius 99px, margin-right 5px)** |
| Person | **20×20 circular avatar** (bg #fff / `rgb(37,37,37)`, `outline: 1px solid rgba(42,28,0,0.07)`), initial 11px `rgb(142,139,134)`. Name 14px, gap 6px |
| Date | "December 15, 2026". Range: "November 5, 2026 → December 5, 2026" (U+2192, same style) |
| Checkbox | **16×16, radius 3px, border 1px solid `rgba(27,21,0,0.19)`**. Checked: bg `rgb(39,131,222)` + white 14px check |
| Email | primary colour, underlined with **`background-image: linear-gradient(...)` 1px at the bottom**, colour `rgba(28,19,1,0.11)` (dark `rgba(255,255,235,0.1)`). Not `text-decoration` |
| URL | same underline. Protocol/www stripped. The path part is muted `rgb(161,158,153)` / `rgb(125,122,117)` |
| Files | chip **h 24, padding 0 6px, radius 4px, bg `rgba(42,28,0,0.07)`** / `rgba(255,255,243,0.082)`, file icon 20px, max-width 200, ellipsis |
| Relation | page icon 18px `rgb(142,139,134)` + title **14px / 500** with the 1px gradient underline |
| Rollup (show original) | renders the source values (e.g. pills) |
| Created / Last edited time | "October 12, 2026 6:31 PM" |
| Button | **h 24, padding 0 6px, radius 6px, border 1px solid `rgba(28,19,1,0.11)`**, no bg. Label 14px / 500 |
| Unique ID | "PRJ-30", **muted `rgb(161,158,153)`** / `rgb(125,122,117)` |
| Empty | blank, no placeholder |

### Option colours (select, multi-select, status), `tokens.json → color.option`
**A different palette from the block colours.** In light, pills are a translucent tint with **dark** text. In dark, pills are a stronger tint with **pale** text.

| Colour | Light bg | Light text | Dark bg | Dark text | Status dot (both) |
|---|---|---|---|---|---|
| Default | `rgba(42,28,0,0.07)` | `rgb(44,44,43)` | `rgba(255,255,243,0.082)` | `rgb(240,239,237)` | — |
| Gray | `rgba(28,19,1,0.11)` | `rgb(73,72,70)` | `rgba(255,252,235,0.306)` | `rgb(240,239,237)` | `rgb(142,139,134)` |
| Brown | `rgba(127,51,0,0.157)` | `rgb(88,68,55)` | `rgba(255,184,132,0.365)` | `rgb(245,237,233)` | `rgb(182,137,101)` |
| Orange | `rgba(196,88,0,0.204)` | `rgb(106,66,34)` | `rgba(255,143,71,0.482)` | `rgb(251,235,222)` | not observed |
| Yellow | `rgba(209,156,0,0.282)` | `rgb(101,81,33)` | `rgba(255,188,53,0.46)` | `rgb(249,243,220)` | not observed |
| Green | `rgba(0,96,38,0.157)` | `rgb(42,83,60)` | `rgba(113,255,175,0.337)` | `rgb(232,241,236)` | `rgb(70,161,113)` |
| Blue | `rgba(0,118,217,0.204)` | `rgb(38,74,114)` | `rgba(81,166,255,0.494)` | `rgb(229,242,252)` | `rgb(39,131,222)` |
| Purple | `rgba(92,0,163,0.14)` | `rgb(85,59,105)` | `rgba(208,147,255,0.427)` | `rgb(243,235,249)` | not observed |
| Pink | `rgba(183,0,78,0.153)` | `rgb(104,53,78)` | `rgba(255,133,192,0.427)` | `rgb(250,233,241)` | not observed |
| Red | `rgba(206,24,0,0.165)` | `rgb(109,53,49)` | `rgba(255,116,105,0.525)` | `rgb(252,233,231)` | not observed |

For the unobserved status dots, use the block **text** colour of the hue (e.g. orange `rgb(210,123,45)`). The observed dots follow the same rule loosely (green `rgb(70,161,113)` vs block green text `rgb(80,148,110)`), so treat this as an approximation.

Option colour menu swatch: **18×18, radius 4px**, bg = pill bg, `box-shadow: inset 0 0 0 1px` (light: the same rgba; dark: the per-hue ring listed in `blocks.md` §3).

## 7. "+ New page" row and calculation footer
- **"+ New page" row:** 37px tall. Only the button is clickable: **103×28, padding 0 8px, radius 6px**, plus icon 16px `rgb(173,169,163)`, label **14px / 400 `rgb(161,158,153)`**. Hover bg `rgba(33,27,23,0.051)` on the button only, not the full row.
- **Calculations:** this build shows **no "Calculate ⌄" on hover**. They are set from the column header menu → **Calculate ›** (200px submenu: None ✓ / Count › / Percent › / More options ›). Count › opens a 250px submenu: a "Show large counts as 99+" toggle (with help text in a light grey block), then Count all / Count values / Count unique values / Count empty / Count not empty.
- **Footer with a value:** a 50px row. The value button is **right-aligned in its column**: padding 0 6px, radius 6px, `transition: background .2s`, label **"COUNT" 10px / 500, letter-spacing 1px, uppercase, `rgb(161,158,153)`** / `rgb(125,122,117)`, then the value **14px `rgb(125,122,117)`** / `rgb(173,169,163)`, gap 4px. Hover bg `rgba(33,27,23,0.051)`. Clicking it opens the same 200px menu below it.
- When the table is taller than the viewport, the footer is **sticky at the viewport bottom**, with bg = page bg and `border-top: 1px solid` divider colour.

## 8. Inline (linked) database inside a page
- Header row: the linked-view icon **`arrowDiagonalUpRight` 20×20** in the text colour, then the title **24px / 31.2px / 600** (not 32/700). With a single view **there is no tab row**; the title takes its place.
- The toolbar is on the same row, right-aligned to the text column, and **always visible** (not hover-only). It adds a **⤢ "open as full page"** button before Settings.
- **The table scrolls full-bleed:** the horizontal scroller spans the whole frame. An inner wrapper pads left/right by the column's offset, so the first column aligns with the text column while further columns extend to the window edge.
- Same rows, cells, borders, pills and gutter as the full-page table. All 15 rows render (no "Load more" at this size).

---

# Part 2: Editing, property menus and panels

Source: `_raw/e-table-editing.md`. Screenshots are the `e-*` files in `../screenshots/` (light, with dark variants where noted):
[text editor](../screenshots/e-text-cell-editor-light.png) ([dark](../screenshots/e-text-cell-editor-dark.png)) ·
[title editor](../screenshots/e-title-cell-editor-light.png) ·
[number editor](../screenshots/e-number-cell-editor-light.png) ·
[multi-select](../screenshots/e-multiselect-editor-light.png) ·
[multi-select filter + Create](../screenshots/e-multiselect-filter-create-light.png) ·
[Create "zzz"](../screenshots/e-multiselect-create-zzz-light.png) ([dark](../screenshots/e-multiselect-create-zzz-dark.png)) ·
[keyboard focus ring](../screenshots/e-multiselect-keyboard-focus-light.png) ([dark](../screenshots/e-multiselect-keyboard-focus-dark.png)) ·
[status editor](../screenshots/e-status-editor-light.png) ·
[date picker](../screenshots/e-date-picker-light.png) ·
[date today](../screenshots/e-date-picker-today-light.png) ·
[date range](../screenshots/e-date-picker-range-light.png) ([dark](../screenshots/e-date-picker-range-dark.jpg)) ·
[remind flyout](../screenshots/e-date-picker-remind-flyout-light.png) ·
[person picker](../screenshots/e-person-picker-light.png) ·
[person no-match](../screenshots/e-person-picker-nomatch-invite-light.png) ·
[relation picker](../screenshots/e-relation-picker-light.png) ([dark](../screenshots/e-relation-picker-dark.png)) ·
[relation row hover](../screenshots/e-relation-picker-row-hover-light.png) ·
[relation create](../screenshots/e-relation-picker-noresults-create-light.png) ·
[URL quick actions](../screenshots/e-url-cell-hover-quickactions-light.png) ·
[URL editor](../screenshots/e-url-cell-editor-light.png) ·
[checkbox hover](../screenshots/e-checkbox-hover-light.png) ·
[files empty](../screenshots/e-files-cell-empty-editor-light.png) ·
[files filled](../screenshots/e-files-cell-filled-editor-light.png) ·
[header menu](../screenshots/e-header-menu-priority-light.png) ·
[header menu bottom](../screenshots/e-header-menu-priority-bottom-light.png) ·
[delete hover](../screenshots/e-header-menu-delete-hover-light.png) ·
[keyboard](../screenshots/e-header-menu-keyboard-light.png) ·
[title-column menu](../screenshots/e-header-menu-name-light.png) ·
[Freeze disabled](../screenshots/e-header-menu-text-freeze-disabled-light.png) ·
[Change type](../screenshots/e-change-type-flyout-light.jpg) ([dark](../screenshots/e-header-menu-change-type-dark.jpg)) ·
[type picker](../screenshots/e-type-picker-light.png) ([dark](../screenshots/e-type-picker-dark.jpg)) ·
[type picker bottom](../screenshots/e-type-picker-bottom-light.png) ·
[type search](../screenshots/e-type-picker-search-open-light.png) ·
[type search "te"](../screenshots/e-type-picker-search-te-light.png) ·
[delete modal](../screenshots/e-delete-property-modal-light.jpg) ·
edit property: [select](../screenshots/e-edit-property-select-light.png) ([dark](../screenshots/e-edit-property-select-dark.jpg)) [sort](../screenshots/e-edit-property-select-sort-light.jpg) [new option](../screenshots/e-edit-property-select-new-option-light.png) [status](../screenshots/e-edit-property-status-light.jpg) [number](../screenshots/e-edit-property-number-light.jpg) [format list](../screenshots/e-number-format-list-light.jpg) [decimals](../screenshots/e-number-decimal-places-light.jpg) [date](../screenshots/e-edit-property-date-light.jpg) [formula](../screenshots/e-edit-property-formula-light.jpg) [formula editor](../screenshots/e-formula-editor-light.jpg) [relation](../screenshots/e-edit-property-relation-light.jpg) [two-way](../screenshots/e-relation-two-way-light.jpg) [rollup](../screenshots/e-edit-property-rollup-light.jpg) [rollup calc](../screenshots/e-rollup-calculate-light.jpg) [button automation](../screenshots/e-button-automation-editor-light.jpg) [ID](../screenshots/e-edit-property-id-light.jpg) [edited time](../screenshots/e-edit-property-edited-time-light.jpg) ·
[grouped table](../screenshots/e-grouped-table-light.jpg) ·
[group header hover](../screenshots/e-group-header-hover-light.png) ·
[group collapsed](../screenshots/e-group-collapsed-light.png) ·
[group ⋯ menu](../screenshots/e-group-options-menu-light.png) ·
[chips bar](../screenshots/e-chips-bar-light.jpg) ·
[chips zoom](../screenshots/e-chips-zoom-light.png) ([dark](../screenshots/e-chips-zoom-dark.png)) ·
[filter chip popover](../screenshots/e-filter-chip-popover-light.jpg) ([dark](../screenshots/e-filter-chip-popover-dark.jpg)) ·
[filter ⋯](../screenshots/e-filter-chip-more-menu-light.jpg) ·
[operator](../screenshots/e-filter-operator-dropdown-light.jpg) ·
[sort chip popover](../screenshots/e-sort-chip-popover-light.jpg) ·
[toolbar Filter picker](../screenshots/e-toolbar-filter-picker-light.jpg) ·
[Filter picker search](../screenshots/e-toolbar-filter-picker-search-light.png) ·
[toolbar Sort picker](../screenshots/e-toolbar-sort-picker-light.jpg)

**Dark rule for all popups below:** bg `rgb(37,37,37)` + dark `shadow.menu`. Fields `rgba(252,252,252,0.03)` with a `rgba(255,255,235,0.1)` ring. Labels and values `rgb(173,169,163)`. Row highlight `rgba(255,255,255,0.055)`. Dividers `rgba(255,255,243,0.082)`. Geometry is identical to light.

## 9. Cell editors

### 9.1 Text, Title, Number, URL, Email, Phone: the cell editor card
- **A single click opens it.** It is a `div[role=dialog]` in the overlay layer at **(cell x − 1, cell y − 1)**, covering the cell.
- **Width = max(column width, 240px)**, so it overhangs a 200px column by 40px. `min-height 38px`, max-height = viewport − 24. It **grows downward** as text wraps (`white-space: break-spaces`).
- Card: **bg #fff, radius 6px, full `shadow.menu`**. Inner padding **8px 9px**, 14px/21px. **The caret is the text colour** (not blue). There is no inner border or ring. The text lands at exactly the same position as the resting cell text, so nothing jumps.
- **No open animation** (it appears instantly).
- Title editing keeps weight 500 and hides the page icon. Number editing stays **right-aligned** and shows the **formatted** string. URL editing shows the full URL including the protocol.
- After Esc the cell stays **selected** (2px inset blue ring + `rgba(35,131,226,0.07)`). Esc again selects the row, and a third Esc clears it.

### 9.2 Select / Multi-select editor
- Card **300px**, radius 6px, `shadow.menu`, over the cell.
- **Top band:** bg **`rgba(242,241,238,0.6)`** (dark `rgba(255,255,255,0.03)`), radius 6px, padding 4px, about 38px tall (max 240, scrolls), with a 1px bottom line `inset 0 -1px rgba(28,19,1,0.11)`. Inner row padding 5.25px 8px, **gap 6px**, wraps.
- **Pills in the band:** h 20, radius 4px, `padding 0 0 0 6px`, followed by a **× remove button 20×20, radius 6px**, glyph 16px `rgb(73,72,70)` (dark `rgb(173,169,163)`). The × hover is bg `rgba(33,27,23,0.051)` + opacity 0.8.
- A plain text input fills the rest of the band.
- **Hint:** "Select an option or create one", **12px / 500 / 14.4px `rgb(125,122,117)`**, padding 0 8px, margin `6px 0 8px`. A 12px spinner appears at its right while searching.
- **Option rows:** 292×28, radius 6px, padding 0 8px, gap 8px: ⋮⋮ handle + pill + "⋯" (visible on the highlighted row). Already-selected options stay in the list with no ✓.
- Typing filters by case-insensitive substring, and the first match auto-highlights.
- **Create row** (shown whenever the query is not an exact option): "Create" (14px) + a **preview pill of the query in the next colour Notion will assign**. With no matches it is the only row and is auto-highlighted.
- Option `⋯` opens a **220px** side menu: a name field, Delete, a "Colors" header, and 10 colour rows (18px swatch + name, ✓ on the current one).

### 9.3 Status editor
- Card **240px**, the same band (the current pill has no ×). **No hint, no drag handles, no ⋯.**
- Options are grouped under headers **To-do / In progress / Complete** (12px/500 `rgb(125,122,117)`). Between groups is a 1px divider inset 12px.
- The last row (after a divider) is "**Edit property**" (sliders icon).

### 9.4 Date picker
- Card **248px**, radius 6px, `shadow.menu`. Anchored at the cell and **shifted to keep a 12px margin from the viewport edges**.
- **Input:** one field **224×28, radius 6px, padding 0 8px, bg `rgba(66,35,3,0.03)`, ring `rgba(28,19,1,0.11) 0 0 0 1px`**, text "Dec 15, 2026". It is auto-focused with the text selected. **Range:** two fields side by side (≈106px each, ≈11px gap, no arrow between). The active one is bg `rgba(35,131,226,0.15)` + `rgb(39,131,222) 0 0 0 2px inset`.
- **Caption:** "Dec 2026" **14px / 500**. Right side: "**Today**" button (48×20, padding 0 8px, radius 3px, **12px / 500 `rgb(142,139,134)`**), then **‹ ›** 20×20 radius 3px (chevrons `rgb(165,165,165)`).
- **Weekday row:** Su Mo Tu We Th Fr Sa, **12px / 400 / 18px, `rgb(139,152,152)`** (a cool grey, unlike the warm UI greys; the same in dark).
- **Days:** 32×32 cells, button **28×28 (2px inset), radius 6px, 14px**. Six week rows are always shown.
  - Outside-month days: `rgb(139,152,152)`.
  - Hover: bg **`rgba(35,131,226,0.15)`**.
  - **Selected / range ends:** bg **`rgb(39,131,222)`**, text white.
  - **Today: white number on a red disc**, a `::after` circle **24×24, bg `rgb(229,100,88)`**, behind the number.
  - **Range band:** per-cell bg **`rgba(35,131,226,0.21)`**, 28px tall, continuous across a week row with **radius 6px on the row's (or range's) ends**. An outside-month end day gets `rgba(35,131,226,0.43)`.
- **Rows below** (each 240×28, radius 6px, padding 0 8px): divider · **End date** ⏻ · **Date format** "Full date" › · **Include time** ⏻ · **Remind** "None" › · divider · **Clear** (normal colour, not red) · divider · **Learn about reminders** (? icon, `rgb(125,122,117)`). Values are 14px `rgb(125,122,117)`. Chevrons 14px `rgb(173,169,163)`.
- **Toggle switch:** track **30×18, radius 44px, padding 2px**. Off `rgba(135,131,120,0.3)` (dark `rgba(202,204,206,0.3)`), **on `rgb(39,131,222)`**. Knob 14×14 white, moved `translateX(12px)` when on. `transition: background .2s, box-shadow .2s`; knob `transform .2s ease-out`.
- **Flyouts** (Date format: Full date ✓ / Short date / Month/Day/Year / Day/Month/Year / Year/Month/Day / Relative. Remind: None / On day of event (9:00 AM) / 1 day before / 2 days before / 1 week before): menu cards with radius 10px, opening on the side with room and overlapping the picker by 4px. **Animation:** opacity + scale, 200ms ease, `transform-origin` at the edge nearest the parent.

### 9.5 Person picker
- Card **240px**, the same band. Placeholder "Search for people or groups…". Hint "Select as many as you like".
- User row: 20px circular avatar + name 14px + "**(You)**" in `rgb(125,122,117)`. **No email line.**
- No match: section header "People" (**11px** / 500), "No matches in <workspace>" (14px `rgb(161,158,153)`), divider, section "More" → "Invite people ›".

### 9.6 Relation picker
- Card **560px** wide, radius 6px. It populates after about 1s.
- **Search header:** 33px, bg `rgba(66,35,3,0.03)`, padding 6px 10px, bottom line `rgba(28,19,1,0.11) 0 1px 0 0`. Placeholder "Link or create a page…". Right side: "In" (grey) + database icon + "**Clients**" (14px / **600**, 1px gradient underline), which switches the target. A clear × appears when there is a query.
- Section labels "1 selected" / "Select more" (12px / 500 grey). "1 selected" has a "⋯" (Customize shown properties) button.
- Page rows: **544×32 (32px, not 28), radius 4px**, page icon + title 14px / 500 underlined. **Highlight bg `rgba(55,53,47,0.06)`** (light). On the highlighted row a **20×20** "−" (unlink) or "+" (link) button appears as a small white square with a 1px ring.
- No results: "No results", then a create row "**+ New** zzz **in** [db] Clients", and a footer "Give search feedback" (12px `rgb(161,158,153)`) with 👍 👎.

### 9.7 Hover quick-actions on cells
- Hovering a filled Text/Number/URL/Email cell shows a floating box **52×24, padding 2px, radius 6px**, bg #fff / `rgb(32,32,32)`, `shadow.floatButton`, at the **cell's top-right (right − 5, top + 6)**. It has two 24×20 buttons: **Comment** and **Copy to clipboard** (16px icons `rgb(142,139,134)`).
- **There is no "open link ↗" button.** Clicking the link text opens it.

### 9.8 Checkbox and Files
- Checkbox cell padding 10px 8px. Hovering the box gives bg `rgba(66,35,3,0.047)`. A single click toggles it (no editor).
- Files: an empty cell opens a 240px card with "**+ Add a file or image**" (`rgb(125,122,117)`). A filled cell lists files (⋮⋮ + file icon + name + ⋯), then a divider, then the add row. The Upload/Embed popover was **not captured** (Notion opens the native file chooser).

### 9.9 Keyboard (tested with real key events)
| Key | Behaviour |
|---|---|
| ↑ / ↓ | Move the highlighted row. **Focus stays in the search/name input.** |
| Keyboard-highlighted row | gets a **focus ring**: `box-shadow: rgb(248,248,247) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px, rgba(255,255,255,0.25) 0 0 0 6px` (dark: `rgb(25,25,25) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px, rgb(25,25,25) 0 0 0 6px`). Mouse hover gives only the bg. |
| → | On a row with ›, opens the flyout and moves focus into it (first item highlighted with the focus ring) |
| ← | Closes the flyout |
| Enter | Picks the highlighted row, or creates |
| Tab | **In a cell editor: closes it and selects the next cell to the right** (spreadsheet behaviour). In menus: does nothing. |
| Esc | Closes the innermost layer first (flyout → menu → editor → cell selection → row selection) |
| Backspace in an empty token input | Removes the last pill |

Exception: in the "+ add property" type picker, ↓ moves focus **out** of the search field.

## 10. Property header menu
- **Opens on a single click on the header cell.** It appears with `opacity 0→1` + a slight scale, **200ms ease, transform-origin top-left**.
- **Width: 248px** for a 200px column (≈ max(248, column − 12); 268px for the 280px title column). **x = header x − 6, y = header bottom.** If it doesn't fit, it is shifted up to stay 12px inside the viewport, overlapping the header.
- **Top row:** an icon button **28×28, radius 6px, real `border: 1px solid rgba(28,19,1,0.11)`**, with the type icon inside (`rgb(85,83,78)`, dark `rgb(211,211,211)`). Then the name field (radius 6px, padding 3px 6px, bg `rgba(66,35,3,0.03)`, auto-focused with the blue ring, placeholder "Property name") with an **ⓘ** (15px `rgb(142,139,134)`) inside at its right.
- **Rows:** 28px (29px pitch), padding 0 8px, gap 8px, 14px. **Icons 20px in the text colour `rgb(44,44,43)`** (not grey). Submenu chevron 16px `rgb(142,139,134)`. Hover `rgba(33,27,23,0.051)`, `transition: background .02s ease-in`.
- **Select property rows:** Edit property › · Property access · Change type › · AI Autofill › [badge "Now with agents"] | Filter · Sort › · Group · Calculate › · Freeze · Hide · Unwrap content | Insert left · Insert right · Duplicate property · **Delete property**.
  - The "Now with agents" badge: **11px / 500, `rgb(39,131,222)` on `rgba(0,124,215,0.094)`** (dark bg `rgba(67,155,255,0.24)`), radius 4px, padding 2px 4px.
  - **Delete property is not red at rest. On hover its label and icon turn `rgb(229,100,88)`.**
  - **Disabled rows** (e.g. Freeze on columns past the freeze limit): label and icon **`rgb(188,186,182)`** (dark `rgb(95,94,89)`), cursor default.
- Rows vary by type. The **title column** has: rename · **Show page icon** ⏻ · AI Autofill › | Filter · Sort › · Group · Calculate › · Freeze · Unwrap content | Insert left · Insert right. Text has no "Edit property". A rollup's Sort is disabled. A Button has "Edit automation" and no Filter/Sort/Group/Calculate. ID has no Change type/Group/Duplicate. Status adds "Display as: Select ›".
- **Submenus open on hover** (and on click or →).
- **Change type ›** flyout: **200px**, to the right, **overlapping the menu by ~19px**, clamped 12px inside the viewport, fade 200ms. **One column, no search.** Icons **grey `rgb(142,139,134)`**. The current type has a ✓ (16px). **Disabled types use `opacity: 0.4` on the whole row** (a different disabled style from the header menu's). Order: Text, Number, Select, Multi-select, Status, Date, Person, Files & media, Checkbox, URL, Email, Phone, Formula, Relation, Rollup, Created time, Created by, Last edited time, Last edited by, Button, Place, ID.

## 11. "+" add property → type picker
- Clicking the header "+" scrolls to the end and inserts a **pending header cell** with a name input (393×28, bg #fff, radius 6px, emoji button + "Type property name…"). Nothing is created until a type is picked, and Esc discards it.
- **Picker card: 415px** wide (≈404 content), 4px below the header row, radius 10px, `shadow.menu`, right-clamped 12px from the viewport edge, max height ≈ viewport, scrolls.
- **"AI Autofill"** section: Summarize [Basic] ›, Translate [Basic] ›. The "Basic" badge is **11px / 500 `rgb(142,139,134)` on `rgba(42,28,0,0.07)`** (dark `rgba(255,255,235,0.1)`), radius 4px, padding 2px 4px. Then a divider.
- **"Select type"** section header with a **magnifier button** (20×20). Clicking it expands a search field below ("Search types…", 368×28, auto-focused). Filtering is a substring match and the AI rows stay visible.
- **Grid: 2 columns of 192×32 cells** (radius 6px, padding 0 8px, gap 8px, 2px row gap, 0 column gap). Icons 20px grey, labels 14px. Groups are separated by 1px dividers with no headers:
  1. Text, Number / Select, Multi-select / Status, Date / Person, Files & media / Checkbox, URL / Phone, Email
  2. Relation, Rollup / Formula, Button / ID (disabled if one exists), Place
  3. Created time, Last edited time / Created by, Last edited by
  4. Integrations: Google Drive File, Figma File / GitHub Pull Requests, Zendesk Ticket (small blue badge)
- Picking a type with no config (e.g. Text) creates the column immediately.

## 12. Edit property: an adjacent flyout (not a docked sidebar)
> **Correction to the 2026-08-28 spec:** from the header menu, **Edit property opens a 300px flyout** beside the menu (on the side with room, overlapping by ≈4px, top-aligned with the row, fade 200ms). The header menu stays open behind it. The 483px docked sidebar is the **view settings** host (see `row-page.md`).

- Card **300px**, radius 10px, `shadow.menu`, list padding 4px, 28px rows. Row values are 14px **`rgb(161,158,153)`** (dark `rgb(125,122,117)`). Chevrons 16px `rgb(173,169,163)` (dark `rgb(125,122,117)`).
- Clicking a value row opens a **dropdown below the row** (right-aligned, the row's chevron rotates to point down, opacity+scale 200ms).

| Type | Rows |
|---|---|
| **Select** | Sort "Manual" › (Manual / Alphabetical / Reverse alphabetical) · divider · "Options" header with a **+** (20×20) · option rows (⋮⋮ handle 16px, pill, ›) · divider · "Generate with AI" |
| **Status** | No Sort. Three group headers **To-do / In progress / Complete**, each with a +. Option rows with status pills. The default option shows a "**DEFAULT**" tag (12px / 500 uppercase `rgb(161,158,153)`) |
| **Number** | Number format "US Dollar" › (a separate **217px** list with a "Filter formats…" search, 45 formats) · Decimal places "Default" › (Default, 0–5) · "Show as" cards · footer |
| **Date / Created / Edited time** | Date format "Full date" › · Time format "12 hour" › · (Date only) Notifications "None" › |
| **Formula** | Edit formula › · Number format · Decimal places · Show as cards · footer |
| **Relation** | Related to (disabled, opacity .4, db icon + "Clients" 600 underlined) · Limit "No limit" › · Two-way relation "On" › (Enable ⏻ + "Related property name" input) |
| **Rollup** | Relation › · Target property › · Calculate "Show original" › (Show original ✓ / Show unique values / Count › / Percent ›) |
| **ID** | "Prefix" + input (222×28, field style) + hint "PRJ-1, PRJ-2, PRJ-3, …" (12px `rgb(161,158,153)`) + **"Update ID Prefix"** primary button (276×28, blue, **opacity 0.4 while unchanged**) |

- **"Show as" cards** (Number, Formula): three **83×48** buttons (radius 6px, padding 6px 12px, gap 6px): **Number / Bar / Ring**. Unselected: 1px ring `rgba(42,28,0,0.07)`, content `rgb(125,122,117)`. **Selected: `box-shadow: rgb(39,131,222) 0 0 0 2px`, content blue.** Labels 12px.
- Footer: "**Changes apply to all views showing this property.**" 12px/18px `rgb(161,158,153)`, margin `12px 10px 0`.
- New-option input: 276×28, field style, blue ring, "Type a new option…".

### Formula editor
- An anchored panel (not a centred modal, no backdrop): **740×541**, radius 10px, `shadow.menu`, filling the viewport height with 12px margins.
- Header "Edit formula" **16px / 600** + help icon. Close **✕ 24×24 circle, bg `rgba(42,28,0,0.07)`**.
- AI bar: 716×40, radius 10px, light shadow `rgba(0,0,0,0.04) 0 2px 4px 0, rgba(42,28,0,0.07) 0 0 0 1px`, placeholder "Write, fix, or explain a formula…", with a round ↑ submit button.
- **Code box:** 716×96, **bg `rgb(249,248,247)`, radius 10px, blue focus ring**, padding 12px, **12px/18px mono**. Property references are chips: **bg `rgba(84,72,49,0.15)`, radius 4px, padding 2px 4px**, type icon + name. Operators `rgb(154,110,58)`, numbers `rgb(153,0,85)`.
- Preview strip: "Preview with [page ▾]", "Debug mode" ⏻, result 14px `rgb(125,122,117)`, and a "Type: number" badge (11px / 500 `rgb(142,139,134)` on `rgba(42,28,0,0.07)`, radius 6px).
- Bottom: a function list on the left (228px, "Built-ins" header, 28px rows) and a doc pane on the right (title 14px / 600, description 12px `rgb(125,122,117)`, example blocks with a 1px `rgb(240,239,237)` border, radius 5px, 11px mono).

### Button "Edit automation" and confirm dialogs (centred modals)
- **Backdrop `rgba(15,15,15,0.6)`.** Card `div.notion-dialog`, **radius 12px**, bg #fff, **`shadow.modal`** = `rgba(25,25,25,0.24) 0 24px 48px 0, rgba(25,25,25,0.14) 0 4px 12px 0, rgba(42,28,0,0.07) 0 0 0 1px`, `transition: transform .2s`.
- Automation editor: 500×421, editable title "Action" (16px), a **✕ 20×20 circle (bg `rgba(55,53,47,0.06)`)**, a 1px rule, sections "When" / "Do" (12px / 500 `rgb(161,158,153)`), bordered trigger/action cards joined by a vertical connector line, and a full-width **Save** (460×32, blue, 14px / 500, radius 6px).
- **Delete-property confirm:** **406px** wide, **padding 20px, centred text**. Message **16px / 600 / 24px**. Buttons stacked full width (32px, **8px apart**, radius 6px, 14px / 500): **Delete** with text `rgb(229,100,88)` and **border `1px solid rgba(206,24,0,0.165)`**, transparent bg. **Cancel** with border `1px solid rgba(28,19,1,0.11)`.

## 13. Grouped table
- Each group: a **42px group header row**, then its own 36px table header, rows, a "+ New page" row, then a **≈14px gap** before the next group.
- Header contents (vertically centred): **collapse toggle 24×24, radius 4px** with a solid ▼ (`arrowCaretDownFillSmall` 11.2px, text colour). Collapsed = rotated −90° (▶), `transition: transform .2s ease-out`. Then the **group pill** inside a `padding 3px, radius 6px` hover target. Then (when "Show aggregation" is on) the count.
- On header hover: "**⋯**" (Show group options) and "**+**" (Add new page in group), each 24×24 radius 6px with 16px icons, directly after the pill. `transition: opacity .1s ease-in-out`.
- A collapsed group shows only its 42px header.
- Group ⋯ menu: 180px card with Edit groups / Show aggregation / Hide group / Move to Trash.
- Empty groups are hidden in this view. There was no "Hidden groups" section and no "No Status" group.

## 14. Filters and sorts
- **When a view has filters or sorts, the toolbar Filter / Sort icons turn blue `rgb(39,131,222)`.** The chips bar is **collapsed by default**. Clicking the blue Filter icon toggles it (a per-viewer UI toggle).
- **Chips bar:** 44px tall (padding-top 4px), chips start at the table's left edge.
  - **Chip:** **h 24, padding 0 8px, gap 6px, radius 32px (pill), bg `rgba(0,124,215,0.094)`** (dark `rgba(67,155,255,0.24)`), **text and icons `rgb(39,131,222)`**, 14px.
    - Sort chip: ↑ (or ↓) + property + ▾.
    - Filter chip: type icon + "**Priority**" (500) + ": Not Someday" (400) + ▾.
  - After the sort chips: a **1×24 divider** (`border-right: 1px solid rgba(42,28,0,0.07)`, margin 0 6px).
  - "**+ Filter**": h 24, padding `0 9px 0 5px`, radius 12px, 14px `rgb(161,158,153)`, no bg.
- **Filter chip popover:** **260px**, 4px below the chip. Header line: property (12px `rgb(161,158,153)`) + operator button "is not ▾" (12px / 500 `rgb(125,122,117)`) + a "⋯" (Delete filter / Add to advanced filter). Value = a token field (bg `rgba(66,35,3,0.03)`, radius 6px, the 2px-gap blue focus ring) holding pills with ×, then option rows with **16px checkboxes** + pills. Operator menu: Is / Is not / Is empty / Is not empty.
- **Sort chip popover:** **317px**. Rule row: ⋮⋮ + property button + direction button ("Sort old → new", type-aware), each **h 32, padding 0 8px, radius 6px, bg #fff, border 1px solid `rgba(28,19,1,0.11)`, 14px / 500**, + a ✕ (24×24). Then "+ Add sort" and "Delete sort" rows (`rgb(125,122,117)`).
- **Toolbar Filter picker** (no filters yet): **290px** card, max height about the viewport, right-clamped, with the search field level with the toolbar. Search "Filter by…". Property rows 28px with **icons `rgb(56,56,54)`**, ordered **Name first, then alphabetical**. Footer "+ Add advanced filter". **Sort picker**: identical, with "Sort by…" and no footer.
