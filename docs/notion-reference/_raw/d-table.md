# (d) Database header + Table view — raw capture

Date 2026-10-12. Method per `_method.md`. Viewport this session: **1300×597** CSS px (DPR 1).
Fixture: Projects full-page DB, view "Table" (`?v=3f77b5cb32d08096807b000c9571b6e0`).
Notation: `c=` color, `bg=` background, `r=` radius, `p=` padding, `fs/fw/lh` font size/weight/line-height,
colors as `(r,g,b[,a])`. Font family everywhere = Notion UI stack
`ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Helvetica, "Apple Color Emoji", "Noto Sans Arabic", "Noto Sans Hebrew", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"`.

## 1. Database header (full page) — Light
Screenshot: `screenshots/d-header-toolbar-overflow-light.png` (sidebar expanded → tabs overflow into "4 more…").

### Layout frame
- Page content wrapper for title + views bar: `padding 0 96px` inside the 1015px-wide scroller (frame x=270 → content x=366). A full-page DB is **full width** (not 720px): the views bar is 823px wide here (= frame − 2×96).
- Title `h1.content-editable-leaf-rtl` (role=textbox): **32px / 700 / lh 38.4px**, `c=(44,44,43)`, `padding 0 8px` (text x=374), h 38.4. → Full-page DB title is 32px bold, NOT the 40px doc-page title. (Matches earlier "DB title 32px".)
- No description is shown (none set; the "Add description" affordance only appears on title hover — see §1b).
- Title top y=80; views bar top y=126.4 (≈8px below title box bottom 118.4); table header row top y=166.4.

### View tabs (NEW STYLE: rounded pills, NO underline)
- Each tab = `div[role=tab]` : **h 32, padding 6px 12px, radius 20px (pill)**, `display flex`, `transition: background 0.1s ease-in-out`, `white-space nowrap`, cursor pointer.
  - Wrapped in a drag container `div` h 40 (cursor grab) with `margin-right 1px` → tabs are 1px apart.
- Tab icon: `svg.viewTable` (class names per layout: viewTable, …) **20×20, margin-right 6px**, fill = text color.
- Tab label `span`: **14px / 500 / lh 16.8px**, `margin-top 1px`, nowrap.
- **Active tab** ("Table"): `bg rgba(33,27,23,0.05)`, label+icon `c=(44,44,43)`, weight 500. Width 83.5.
- **Inactive tab**: no bg, label+icon `c=(125,122,117)`, weight 500 (same weight — only colour + bg differ).
- **Overflow**: when tabs don't fit, a `div[role=button]` "**4 more…**" (text with a real ellipsis char): h 32, `padding 6px 10px`, radius 20px, **14px / 400**, `c=(125,122,117)`, same bg transition. No "+" add-view button is shown in the bar at rest (see hover notes §1b).
- Views bar row: h 40 (y 126.4–166.4); tabs left, toolbar right; **no border/shadow under the views bar** (the only line is the table header row's bottom inset shadow).

### Toolbar (right side, container `div` w 247.6, h 40, `padding-right 8px`, `transition opacity 0.1s ease-in-out`)
Order L→R: Filter, Sort, Automations (⚡), AI Autofill (magic wand), Search, Settings (sliders), then New split button (6px left margin).
- Each icon button: `div[role=button]` with `aria-label` (Filter/Sort/Automations/AI Autofill/Search/Settings): **28×28, padding 6px, radius 6px**, `c=(125,122,117)`, `transition background 0.1s ease-in-out`. Buttons abut (x step 28, no gap).
- Icons: 16×16 svg, **fill (142,139,134)**. classes: `filterSmall`, `arrowUpDownSmall`, `lightningSmall`, `magicWandSmall`, `magnifyingGlassSmall`, `slidersSmall` (the old "⋯" view-settings button is now a sliders icon labelled "Settings").
- **New split button** (container 68×28, radius 6px):
  - "New" part `div[role=button]`: **44×28, padding 0 8px, radius 6px 0 0 6px, bg (39,131,222), text (243,249,253) 14px/500/lh 21px**, `transition background 0.02s ease-in`.
  - Chevron part `div[role=button]`: **24×28, radius 0 6px 6px 0, same bg**, divider = `box-shadow: rgba(28,19,1,0.11) 1px 0 0 0 inset` (1px line on its left edge), chevron svg 16×16 fill (243,249,253), margin-top 2px.

### 1b. Header states & menus (Light)
- **Tab hover** (inactive tab): `bg rgba(33,27,23,0.051)` (same token as menu-row hover), text colour unchanged (125,122,117). Fades with `background 0.1s ease-in-out`.
- **Tab tooltip** (hover ~0.5s): `div[role=dialog]` dark chip: `bg (44,44,43)`, r 6px, `padding 5px 8px`, `box-shadow rgba(0,0,0,.08) 0 4px 12px -2px, rgba(255,255,255,.05) 0 0 0 1px inset`; line 1 view name 12px/400/lh16.8 `c=(240,239,237)`; line 2 "Table view of Projects" 12px `c=(173,169,163)`. Placed 6px below the tab, left-aligned with it.
- **No "+" add-view button** is visible in the bar in this build (neither at rest nor on hover); "New view" lives at the bottom of the "N more…" menu.
- **"4 more…" overflow menu** (`d-views-overflow-menu-light.png`): standard menu card 290×299 (bg #fff, r 10px, menu shadow = `--menu-shadow`), anchored 4px below the button, left-aligned with it. Contents: search field "Search for a view..." (focused, 258×28, `bg rgba(66,35,3,0.03)`, r 6px, p 3px 6px, 14px/lh20; focus ring `box-shadow rgb(35,131,226) 0 0 0 1px inset, rgb(35,131,226) 0 0 0 1px`), then ALL views (not only the hidden 4) as 28px rows (`padding 0 8px`, 14px): drag handle ⋮⋮ (gray), view-type icon 20px, name, `⋯` at right; the current view row has the hover/selected bg; scroll list; "+ New view" at the bottom.
- **Toolbar icon hover**: `bg rgba(33,27,23,0.051)`, icon fill unchanged (142,139,134).
- **New hover**: bg **(31,118,204)** on the hovered half only (hovering the chevron darkens only the chevron). Pressed: not measured (pressing "New" creates a page).
- **New ▾ dropdown** (`d-new-templates-menu-light.png`): card **360×104**, bg #fff, r 10px, `--menu-shadow`; **right-aligned to the split button's right edge, top 4px below it**. Enter animation on the wrapper: `transition: opacity 0.2s, transform 0.2s`. Contents: header row "Templates for Projects" (28px row, p 0 8px; text 14px/500 `c=(125,122,117)`) with a (?) help icon 20px fill (142,139,134) at the right; description "Create a reusable page template for this database." 14px/400/lh21 `c=(161,158,153)`, p 0 12px 4px; 1px divider (inset 12px); "+ New template" row 28px (p 0 8px, r 6px, plus icon 20px fill (142,139,134), label 14px `c=(125,122,117)`), hover bg rgba(33,27,23,0.051), `transition background 0.02s ease-in`. Block padding 4px around rows. (No templates exist.)
- **Search** (`d-toolbar-search-open-light.png`): clicking 🔍 keeps the 28×28 magnifier button and opens a borderless, bg-less input to its right: **150px wide** (input 146 + 4px right padding), 14px/400, text `c=(44,44,43)`, placeholder "Type to search…" (renders lighter gray ≈ (161,158,153) visually); container `transition: width 0.2s, opacity 0.2s` (expands from 0). The toolbar slides left by the same width. Escape closes it.
- **Title hover** (`d-title-hover-add-description-light.png`): a row appears above the title (y 44, h 36, p 4px 0): "Add icon", "Add cover", "Add description" — each a 28px button `padding 0 8px`, r 6px, 14px/400 `c=(161,158,153)`, icon 14×14 same colour, `transition opacity 0.1s`. (Hover bg = standard rgba(33,27,23,.051).) No description is set on Projects, so nothing else renders below the title.

## 2. Table header row — Light
Screenshots: `d-header-icons-1-light.png` (Name→Status), `d-header-icons-2-cells-light.png` (Due→Website + cells), `d-header-icons-3-light.png` (Contact→Attachments), `d-header-icons-4-end-light.png` (Edited→Client industry, `+`, `⋯`).
(Sidebar collapsed from here on: content x starts at 104 = 8 + 96.)
- Row `div.notion-table-view-header-row`: h **36**, full table width; carries the ONLY header line:
  `box-shadow: rgb(255,255,255) -3px 0 0 0, rgba(42,28,0,0.07) 0 -1px 0 0 inset` → a 1px bottom line in the divider colour (the white −3px layer masks the left edge). **No top border, no vertical lines in the header** (vertical cell lines start at the first body row).
- Header cell `div.notion-table-view-header-cell` (w = column width, h 36, cursor grab) > `div[role=button]` (h 36, **padding 0 8px**, `c=(125,122,117)`, `transition background 0.02s ease-in`) > flex row (h 24, **gap 6px**) = [icon box 18×24] + [label].
- Label: **14px / 400 / lh 16.8px, `c=(125,122,117)`**, nowrap, ellipsis.
- Property-type icon: NOT an svg — a `div` 19.2×19.2 using **CSS `mask-image: url(https://app.notion.com/icons/<name>_gray.svg)`**, `mask-position 50% 50%`, painted with `background-color (142,139,134)`, placed at (−2,−1) inside the 18px box. A hidden `svg.dragHandleFillSmall` 16px sits in the same box (swaps in on drag).
  | Property (type) | icon file | look |
  |---|---|---|
  | Name (Title) | `font_gray.svg` | "Aa" |
  | Notes (Text) | `description_gray.svg` | 4 horizontal lines, last one shorter (left-aligned paragraph) |
  | Budget (Number) | `hashtag_gray.svg` | # |
  | Priority (Select) | `arrow-circle-down_gray.svg` | circle outline with a filled down-triangle |
  | Tags (Multi-select) | `list_gray.svg` | bulleted list (3 dots + 3 lines) |
  | Status (Status) | `burst_gray.svg` | dashed circular "loading" burst (8 short radial dashes) |
  | Due (Date) | `calendar_gray.svg` | filled calendar page with header band |
  | Owner (Person) | `friends_gray.svg` | two people silhouettes |
  | Contact (Email) | `username_gray.svg` | @ |
  | Score (Formula) | `formula_gray.svg` | Σ sigma |
  | Done (Checkbox) | `checkmark-square_gray.svg` | filled rounded square with white check |
  | Website (URL) | `link_gray.svg` | chain link (diagonal) |
  | Created (Created time) | `clock_gray.svg` | filled clock |
  | Edited (Last edited time) | `clock_gray.svg` | same filled clock |
  | Attachments (Files) | `attachment_gray.svg` | paperclip (diagonal) |
  | Action (Button) | `cursor-button_gray.svg` | small button with a mouse cursor over its bottom-right |
  | Ref (Unique ID) | `numero_gray.svg` | "№" |
  | Client (Relation) | `arrow-northeast_gray.svg` | ↗ arrow |
  | Client industry (Rollup) | `search_gray.svg` | magnifying glass |
- Column widths (rendered): **Name (title) 280px; every other column 200px** (the default for a new column).
- End of header: after the last column a **"+" add-property** `div[role=button]` **28×28**, r 6px, icon `svg.plusSmall` 16px fill (142,139,134), `transition background 0.1s ease-in-out`; then a **"⋯"** button 28×28, r 6px, `transition background 0.02s ease-in`, `c=(125,122,117)`. Both vertically centred (y = row top + 4). The trailing area after the last column is 56px wide (cells there carry only a bottom border).

## 3. Rows / grid — Light
- Row structure: `div.notion-collection-result-wrapper` > `div.notion-selectable.notion-page-block` (x=content−8, includes 8px gutter) > `div.notion-table-view-row` (`margin-left 8px`) > `div` (flex) > `div.notion-table-view-cell` × N, then 2 trailing divs (0-wide + 56-wide) that only have `border-bottom 1px rgba(42,28,0,0.07)`.
- **Cell** `div.notion-table-view-cell`: **`border-right 1px solid rgba(42,28,0,0.07)` + `border-bottom 1px solid rgba(42,28,0,0.07)`** → both grid lines are cell borders, same colour as the header bottom line. No outer left/top border on the table (the title column has no left line; top line = header row inset shadow).
  - NOTE: on first paint (before full hydration) cells had only `border-right`; after the view settled every cell has right+bottom. Horizontal lines ARE shown in the settled state.
- Cell content wrapper (child of child): **padding 7.5px 8px**, 14px / 400 / **lh 21px**, `c=(44,44,43)`, `transition background 0.02s ease-in`. Content box h 22 for one line.
- **Row height: 37px** (36 content + 1 border-bottom) for single-line rows; rows whose content wraps grow (Date ranges wrap to 2 lines → **57px**). Text wraps inside cells in this view (Wrap on); nowrap pills wrap as whole pills.
- Cell font: 14px/21px `(44,44,43)`.
- Left gutter: the page-block wrapper starts 8px left of the table; the row checkbox (16×16) and drag handle live further left in the 96px page padding (see §4).

## 6a. Cell rendering by property type — Light
| Type | Element carrying style | Values |
|---|---|---|
| Title | `svg.pageEmpty` 18×18 fill (161,158,153) (page has no icon → empty-page glyph), gap 6px; `span` text **14px / 500** `c=(44,44,43)`, no underline | text box 16px tall |
| Text | plain div | 14px/21px (44,44,43), wraps |
| Number (US Dollar) | div `text-align: end` (right-aligned) | "$22,000.00"; empty imported values show "$0.00" |
| Formula (number) | div `text-align: end` | "22", "15.5" |
| Select | pill `div`: **h 20, padding 0 6px, radius 4px**, 14px / 400, inner span lh 20px | colours table §6b |
| Multi-select | same pills; container `display flex; flex-wrap wrap; gap 6px 8px` (8px between pills, 6px between wrapped lines) | |
| Status | pill **h 20, radius 10px, padding 0 9px 0 7px**, `white-space nowrap; overflow hidden; text-overflow ellipsis`; leading **dot 8×8, radius 99px, margin-right 5px** (in a 13×8 box) | dot colours §6b |
| Person | avatar **20×20 circle** (`border-radius 100%`, bg #fff, `outline 1px solid rgba(42,28,0,0.07)` — the ring is an outline), initial letter 11px/lh20 `c=(142,139,134)` centred (no photo set); name 14px (44,44,43); gap avatar→name 6px; multiple people: flex gap 6px 8px | |
| Date | plain text 14px (44,44,43), format "December 15, 2026" (long month). Range: "November 5, 2026 → December 5, 2026" with **U+2192 →** same colour/size; wraps | |
| Checkbox | box **16×16, radius 3px, border 1px solid rgba(27,21,0,0.19)** (unchecked, no fill). Checked: **bg (39,131,222)**, no border, `svg.checkmarkFillSmall` 14×14 fill #fff | positioned at cell padding (x+8, y+10) |
| Email | `a` inline, 14px (44,44,43), **underline = background-image `linear-gradient(to right, rgba(28,19,1,0.11), rgba(28,19,1,0.11))`, size 100% 1px, position 0 100%, repeat-x** (not text-decoration) | cursor pointer |
| URL | `a` "example.com" 14px (44,44,43) with the same 1px gradient underline + trailing `span` "/legal" (path) in **(161,158,153)**; protocol/`www` stripped | |
| Files | chip = `span` **h 24, padding 0 6px, radius 4px, bg rgba(42,28,0,0.07)**, max-width 200px; `svg.pageEmpty` 20×20 fill (56,56,54) + text "https://example.com/…" 14px/lh24 (44,44,43), nowrap, clipped with "…" | |
| Relation | `svg.pageEmpty` 18×18 **fill (142,139,134)** (darker than the title's 161 gray) + title `span` **14px / 500**, `c=(44,44,43)`, **underlined with the 1px gradient `rgba(28,19,1,0.11)`** (background-image, size 100% 1px), cursor pointer | |
| Rollup (show original, of a Select) | renders the source pills unchanged (e.g. "Healthcare" green pill, "Software" orange pill) | |
| Created / Last edited time | plain text 14px (44,44,43), format **"October 12, 2026 6:31 PM"** | |
| Button | `div` **h 24, padding 0 6px, radius 6px, border 1px solid rgba(28,19,1,0.11)** (all 4 sides), no bg, no shadow; label "Action" **14px / 500** / lh 16.8 `c=(44,44,43)`; no icon | |
| Unique ID | plain text "PRJ-30" 14px **`c=(161,158,153)`** (muted) | |
| Empty cell | blank, no placeholder at rest | |

## 2b/3b/4. Hover states, resize handle, OPEN, gutter — Light
Screenshots: `d-column-resize-handle-light.png`, `d-row-hover-gutter-open-light.png`, `d-open-button-hover-light.png`, `d-row-drag-handle-hover-light.png`.
- **Header cell hover**: the inner `div[role=button]` gets `bg rgba(33,27,23,0.051)`, radius 0 (full cell rect 200×36); icon does NOT change to a drag handle; cursor pointer (outer cell cursor grab).
- **Column resize handle**: a `div` **5px wide × 36px tall** (header height only), centred on the column's right edge (x = edge − 3 … edge + 2); transparent at rest, on hover **bg rgba(35,131,226,0.8)**, `cursor col-resize`, `transition background 0.2s ease-out`. Shows as a blue vertical bar in the header only.
- **Row hover**: **no row background**. Hover reveals (a) the OPEN button in the title cell, (b) the gutter controls left of the table.
- **OPEN button** (title cell, on row hover): outer `div` **69.3×24, padding 2px, radius 6px, bg #fff, box-shadow `rgba(25,25,25,0.027) 0 8px 12px 0, rgba(25,25,25,0.027) 0 2px 6px 0, rgba(42,28,0,0.07) 0 0 0 1px`**; inner `div` 65.3×20, **padding 0 4px, radius 4px, bg #fff, gap 6px**, text **"OPEN" = 12px / 500 / lh 18px, letter-spacing 0.5px, `text-transform: uppercase`** (DOM text "Open"), `c=(125,122,117)`; icon `svg.peekSide` 15.3×20 fill (142,139,134) (rectangle with a filled left panel = "side peek"). Position: **right edge ≈ 4.7px inside the cell's right border, top 6px below row top** (vertically centred in the 36px row). Inner hover: **bg rgba(33,27,23,0.051)**; `transition background 0.02s ease-in`.
- **Gutter (left of the table, in the page padding)**, all vertically centred on the row:
  - **"+" add-row button** `div[role=button][aria-label="Click to add below. Alt-click to add a block above"]`: **24×24 at x = table − 86**, radius 4px, `svg.plus` 20px fill (173,169,163).
  - **Drag handle** `div[role=button][aria-label="Drag to move, click to open menu"]`: **18×24 at x = table − 62**, radius 4px, `svg.dragHandle` 20×20 (6 dots, 2 columns) fill **(173,169,163)**, cursor grab, `transition background 0.02s ease-in`; hover **bg rgba(33,27,23,0.051)**.
  - **Row checkbox**: hit area `label` **36×36 at x = table − 36** (abuts the table); box **16×16, radius 3px, border 1px solid rgba(27,21,0,0.19)**, centred (x = table − 26), `transition background 0.2s ease-out`; native `input` inside with opacity 0. Wrapper opacity: **0 at rest → 0.7 on row hover** (`transition opacity 0.2s`) → **1 when the checkbox itself is hovered**, and its bg becomes **rgba(66,35,3,0.047)**.

## 5. Selection — Light
Screenshots: `d-table-full-light.jpg` (rest state, sidebar collapsed), `d-selected-rows-action-bar-light.jpg`, `d-selected-rows-action-bar-zoom-light.png`.
- **Selected row**: an overlay `div.notion-selectable-halo` (position absolute, pointer-events none) **bg rgba(35,131,226,0.14)**, covers the row's 36px content height (not the 1px bottom border), full table width (starts at the table's left edge, not the gutter), radius 0. Cells themselves keep transparent bg. Pills/text stay unchanged (blend through the tint).
- **Row checkbox checked**: 16×16 r 3px **bg (39,131,222)**, no border, `svg.checkmarkFillSmall` 14px fill #fff; stays visible (opacity 1) while selected.
- **Header select-all checkbox** appears in the gutter of the header row (same x as row checkboxes) once ≥1 row is selected: partial selection = **bg (39,131,222) with `svg.dashFillSmall` 14px white** (indeterminate dash).
- **Multi-select action bar**: floats **over the views bar** (replaces nothing; overlays the left part of the tabs): `div` **462×32 at (table x − 10, views-bar y)**, **bg #fff, radius 5px, box-shadow `rgba(25,25,25,0.027) 0 8px 12px 0, rgba(25,25,25,0.027) 0 2px 6px 0, rgba(42,28,0,0.07) 0 0 0 1px`**. Segments (each h 32, separated by `box-shadow rgba(42,28,0,0.07) 1px 0 0 0` = 1px right divider):
  1. "**N selected**" — `padding 0 10px`, 14px / 400, **`c=(39,131,222)`** (blue), radius 5px 0 0 5px.
  2. Quick-edit property buttons, one per visible property: "Notes", "Budget", "Priority", "Tags" (more hidden by width) — each `padding 0 8px`, property-type icon (same mask icons, 16–20px, (44,44,43)-ish dark here) + label 14px (44,44,43), 1px right divider; hover bg rgba(33,27,23,0.051).
  3. Trash button (`svg.trash` 20px, fill (44,44,43)) — NOT clicked.
  4. "⋯" button 30×32 (`svg.ellipsisSmall` 16px fill (44,44,43)), radius 0 5px 5px 0.
- **Escape** clears the selection (halo + bar disappear).
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  
## 6b. Option (pill) colour palette — Light
Measured on the pills in cells (bg on the pill `div`, text colour on the pill/its span) and cross-checked against the option colour menu swatches (`d-option-color-menu-light.jpg`). **Pill bg = translucent tint; text = dark shade of the hue.** This is a DIFFERENT palette from the text/block colours in c-page-blocks.md.
| Colour | pill bg | pill text | example option(s) | Status dot |
|---|---|---|---|---|
| Default | `rgba(42,28,0,0.07)` | `rgb(44,44,43)` | Research, Ops, **Someday** | — |
| Gray | `rgba(28,19,1,0.11)` | `rgb(73,72,70)` | Backend, Not started | `rgb(142,139,134)` |
| Brown | `rgba(127,51,0,0.157)` | `rgb(88,68,55)` | Marketing, Blocked | `rgb(182,137,101)` |
| Orange | `rgba(196,88,0,0.204)` | `rgb(106,66,34)` | Frontend, High, Software (rollup) | not in fixture |
| Yellow | `rgba(209,156,0,0.282)` | `rgb(101,81,33)` | Low | not in fixture |
| Green | `rgba(0,96,38,0.157)` | `rgb(42,83,60)` | Finance, Done, Healthcare | `rgb(70,161,113)` |
| Blue | `rgba(0,118,217,0.204)` | `rgb(38,74,114)` | In progress, Review | `rgb(39,131,222)` |
| Purple | `rgba(92,0,163,0.14)` | `rgb(85,59,105)` | Urgent | not in fixture |
| Pink | `rgba(183,0,78,0.153)` | `rgb(104,53,78)` | Design | not in fixture |
| Red | `rgba(206,24,0,0.165)` | `rgb(109,53,49)` | Medium, Legal | not in fixture |
- **Correction to a-build.md:** Priority "Someday" is **Default**, not Gray (the colour menu shows the ✓ on Default). Gray coverage comes from Backend / Not started.
- Option colour menu swatch: **18×18, radius 4px, bg = pill bg, `box-shadow: inset 0 0 0 1px <same rgba>`** (Default's ring uses `rgba(28,19,1,0.11)`).
- Status dot = the strong hue (e.g. blue (39,131,222), same as the accent blue). Dots for the 5 hues no Status option uses were not observable.

## 6c. Select cell editor + option menu — Light
- Click a Select cell → editor card **opens over the cell** at (cell x − 1, cell y − 1), **300 wide** (h 217 for 5 options), bg #fff, **radius 6px** (not 10), `--menu-shadow`. Top input area 300×39 **bg rgba(242,241,238,0.6)**, padding 5.25px 8px, shows the current value as a pill with an × (remove) + caret. Hint "Select an option or create one" 12px / 500 `c=(125,122,117)`. Option rows 292×28, `padding 0 8px`: drag handle ⋮⋮ + pill (same pill styles) + `⋯` at right on hover; row hover bg rgba(33,27,23,0.051). Screenshot `d-select-cell-picker-light.png`.
- Option `⋯` → side menu **220 wide** (h 418), r 10px, `--menu-shadow`, to the right of the picker: name field (focused, blue ring), "Delete" row (trash icon), header "Colors" 12px/500 (125,122,117), 10 colour rows 28px (`padding 0 8px`, swatch 18px + name 14px, ✓ at right for the current colour). Closed with Escape (nothing changed).
- **Selected cell (after closing the editor)**: overlay `div` (absolute, pointer-events none) **`box-shadow: rgb(39,131,222) 0 0 0 2px inset`, bg `rgba(35,131,226,0.07)`, radius 2px**, size = cell minus its right/bottom border (199×36). Pressing Escape on a selected cell selects the whole ROW (shows "1 selected" bar) — a second Escape clears it.

## 7. "+ New page" row & calculation footer — Light
Screenshots: `d-new-page-row-hover-light.png`, `d-header-menu-calculate-light.jpg`, `d-calculate-count-submenu-light.jpg`, `d-calc-footer-count-light.png`, `d-calc-footer-menu-light.jpg`.
- **Header row is sticky**: when the table scrolls under the top bar, `.notion-table-view-header-row` sticks at y=44 (just under the 44px topbar) with **bg #fff** and the same inset bottom line.
- **"+ New page" row**: container 37px tall (`padding-left 8px` from the page block, starts at table x−8); the clickable part is only the button: **103×28, padding 0 8px, radius 6px**, `transition background 0.02s ease-in`; `svg.plusSmall` 16px fill (173,169,163); label "New page" **14px / 400 / lh 20, `c=(161,158,153)`** (`transition opacity 0.2s`). Hover: **bg rgba(33,27,23,0.051)** on the button only (not full-width). No border below it except the last data row's cell borders above.
- **Calculation footer — NO hover affordance in this build**: hovering below a column shows nothing ("Calculate ▾" placeholder text does not exist in the DOM). Calculations are set via the column header menu → **Calculate ›** (submenu 200 wide, r 10px, `--menu-shadow`, rows 28px: None ✓ / Count › / Percent › / More options ›). Count › opens a 250-wide submenu: a toggle row "Show large counts as 99+" (with helper text "This improves performance for large databases." 12px gray, inside a light gray block) then Count all / Count values / Count unique values / Count empty / Count not empty.
- **Footer once a calc exists** ("Count all" on Budget, temporarily): a footer row **50px tall** (y = new-page row bottom + 1), `padding-right 32px`, no border/bg of its own; per-column cell 200 wide; the value button sits **right-aligned** in the column: `div` 72×21, **padding 0 6px, radius 6px, `transition background 0.2s`** containing label **"COUNT" = 10px / 500 / lh 15, letter-spacing 1px, `text-transform: uppercase`, `c=(161,158,153)`** + value **"15" 14px / 400, `c=(125,122,117)`**, 4px gap. Footer is **sticky to the viewport bottom** while the table is taller than the viewport (seen pinned at the bottom after reload). Clicking the value opens a small menu (200 wide, None / Count › / Percent › / More options ›) directly below it, left-aligned with it; button hover bg = rgba(33,27,23,0.051).
- Calculation was set back to **None** (verified: no footer, no "Count" text in the DOM).
- Pill hover tooltip: hovering a multi-select pill shows the dark tooltip chip (bg (44,44,43), 12px white text) with the option name above the pill.

## 8. Inline linked database (on the reference page) — Light
Screenshot: `d-inline-linked-db-light.jpg` (sidebar collapsed; page column 708px at x=283).
- Block `div.notion-selectable.notion-collection_view-block`: header row **708×40** (the page column width).
- **Title row**: `svg.arrowDiagonalUpRight` **20×20, fill (44,44,43)** (the linked-view "↗" indicator, ~4px gap) + title "Projects" **24px / 600 / lh 31.2px** `c=(44,44,43)` (vs full-page DB title 32px / 700). Title starts at column x + 36 (icon at x+12). With a single view, **no tab row** is shown — the title replaces it.
- **Toolbar** on the same row, right-aligned to the 708px column: Filter, Sort, Automations, AI Autofill, Search, **⤢ open-as-full-page** (extra vs full page), Settings (sliders), then the blue New split button (44 + 24 wide). Same 28×28 buttons / 16px icons as full page. **Always visible** (opacity 1 with the mouse outside the block; not hover-only in this build).
- **Horizontal scroll is full-bleed**: the scroller `div.notion-scroller.horizontal` spans the whole content frame (x −6, w 1285 here, `overflow-x auto`) with an inner wrapper **padding-left/right 288.5px** (= the page column's left offset), so the table's first column lines up with the text column (table x = 290.5) but columns extend to the right edge of the window, and scroll under the margin. Header row width 3944 (same columns/widths as full page: title 280, others 200).
- Rows: same 37px rows, same cells, borders, pills and gutter (+, ⋮⋮, checkbox) as full page. **All 15 rows render**; no "Load more" control appears (limit not reached).

---------------------------------------------------------------------------
# DARK pass (Ctrl+Shift+L; `body.dark`, body bg rgb(25,25,25))
Sizes/geometry confirmed identical to Light (same 37px rows, 36px header, 28px buttons, 20px pills, 200/280 columns, same paddings/radii). Only colours/shadows change, listed below.
Screenshots: `d-header-toolbar-table-dark.jpg` (header, tabs, toolbar, tab tooltip, rows with pills), `d-row-hover-gutter-open-dark.png`, `d-selected-rows-action-bar-dark.jpg`, `d-cells-date-person-email-checkbox-url-dark.jpg`, `d-cells-edited-button-id-relation-rollup-dark.jpg`, `d-select-cell-picker-dark.png`, `d-option-color-menu-dark.jpg`, `d-inline-linked-db-dark.jpg`, `d-calc-footer-count-dark.png`.

## D1. Header / tabs / toolbar — Dark
| Element | Light | Dark |
|---|---|---|
| Page title h1 (32/700) | (44,44,43) | **(240,239,237)** |
| Active tab bg / text | rgba(33,27,23,.05) / (44,44,43) | **rgba(255,255,255,0.055) / (240,239,237)** |
| Inactive tab text+icon | (125,122,117) | **(173,169,163)** |
| Tab hover bg | rgba(33,27,23,.051) | **rgba(255,255,235,0.1)** |
| Tab tooltip | bg (44,44,43), sub (173,169,163) | same chip: bg (44,44,43), title (240,239,237), sub (173,169,163), same shadow |
| Toolbar icon fill / button colour | (142,139,134) / (125,122,117) | **(173,169,163) / (173,169,163)** |
| Toolbar button hover bg | rgba(33,27,23,.051) | **rgba(255,255,255,0.055)** |
| New bg / text | (39,131,222) / (243,249,253) | same |
| New hover bg | (31,118,204) (darker) | **(61,144,225) (LIGHTER in dark)** |
| New/chevron divider | inset 1px rgba(28,19,1,.11) | **inset 1px rgba(255,255,235,0.1)** |

## D2. Table grid / header row / cells — Dark
| Element | Light | Dark |
|---|---|---|
| Cell border-right + border-bottom | 1px rgba(42,28,0,.07) | **1px rgba(255,255,243,0.082)** |
| Header row bg (sticky) | #fff | **rgb(25,25,25)** |
| Header row shadow | `#fff -3px 0 0 0, rgba(42,28,0,.07) 0 -1px 0 0 inset` | **`rgb(25,25,25) -3px 0 0 0, rgba(255,255,243,0.082) 0 -1px 0 0 inset`** |
| Header label + mask-icon bg | (125,122,117) / (142,139,134) | **(173,169,163) / (173,169,163)** |
| Cell text, title text, number, date, email | (44,44,43) | **(240,239,237)** |
| Title `svg.pageEmpty` | (161,158,153) | **(125,122,117)** |
| Relation page icon | (142,139,134) | **(173,169,163)** |
| Email / relation 1px gradient underline | rgba(28,19,1,.11) | **rgba(255,255,235,0.1)** |
| URL path span ("/legal") | (161,158,153) | **(125,122,117)** |
| Unique ID text ("PRJ-30") | (161,158,153) | **(125,122,117)** |
| Checkbox unchecked border | 1px rgba(27,21,0,.19) | **1px rgba(255,252,235,0.306)** |
| Checkbox checked | bg (39,131,222), white check | same |
| Person avatar | bg #fff, outline 1px rgba(42,28,0,.07), initial (142,139,134) | **bg (25,25,25) outer / (37,37,37) inner, outline 1px rgba(255,255,243,0.082), initial (173,169,163)** |
| Files chip bg / icon | rgba(42,28,0,.07) / (56,56,54) | **rgba(255,255,243,0.082) / (230,229,227)** |
| Button-in-cell border / text | 1px rgba(28,19,1,.11) / (44,44,43) | **1px rgba(255,255,235,0.1) / (240,239,237)** |
| "+" add-property icon | (142,139,134) | **(173,169,163)** |

## D3. Option pill palette — Dark (bg on pill, text on pill; swatch ring from the colour menu)
In dark the tints are much stronger and the TEXT IS LIGHT (a pale tint of the hue), not dark.
| Colour | pill bg | pill text | swatch inset ring | Status dot |
|---|---|---|---|---|
| Default | `rgba(255,255,243,0.082)` | `rgb(240,239,237)` | rgba(255,255,235,0.1) | — |
| Gray | `rgba(255,252,235,0.306)` | `rgb(240,239,237)` | rgba(255,255,235,0.1) | (142,139,134) |
| Brown | `rgba(255,184,132,0.365)` | `rgb(245,237,233)` | rgba(255,177,129,0.192) | (182,137,101) |
| Orange | `rgba(255,143,71,0.482)` | `rgb(251,235,222)` | rgba(255,147,75,0.28) | n/a |
| Yellow | `rgba(255,188,53,0.46)` | `rgb(249,243,220)` | rgba(255,205,75,0.24) | n/a |
| Green | `rgba(113,255,175,0.337)` | `rgb(232,241,236)` | rgba(108,255,172,0.157) | (70,161,113) |
| Blue | `rgba(81,166,255,0.494)` | `rgb(229,242,252)` | rgba(67,155,255,0.24) | (39,131,222) |
| Purple | `rgba(208,147,255,0.427)` | `rgb(243,235,249)` | rgba(200,125,255,0.2) | n/a |
| Pink | `rgba(255,133,192,0.427)` | `rgb(250,233,241)` | rgba(255,103,177,0.23) | n/a |
| Red | `rgba(255,116,105,0.525)` | `rgb(252,233,231)` | rgba(255,104,92,0.24) | n/a |
- Status dots are the SAME colours in both themes. Swatch in the colour menu = pill bg + its own (different-alpha) inset ring; Light swatch ring = same rgba as its bg.
- Colour-menu labels are (240,239,237) for every colour (not tinted).

## D4. Hover / OPEN / gutter / selection — Dark
- OPEN button: outer **bg (32,32,32)**, `box-shadow: rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 4px 12px -2px` (opaque ring like dark menus), inner **bg (37,37,37)**, text+icon **(173,169,163)**; inner hover bg **rgba(255,255,255,0.055)**.
- Gutter "+" and drag-handle icons: **(125,122,117)** (Light (173,169,163)). Drag-handle hover bg rgba(255,255,255,0.055).
- Row checkbox hover bg: **rgba(252,252,252,0.047)**.
- **Cell hover mini-toolbar** (seen on a Number cell, both themes): a floating box 52×24 at the cell's top-left area (inset ~4px), padding 2px, radius 6px, with two icon buttons `svg.commentFilledSmall` + `svg.duplicateSmall` (16px). Dark: bg (32,32,32), shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,.08) 0 4px 12px -2px`, icons (173,169,163). (Light: white box with the OPEN-style light shadow; not measured separately.)
- Selected row halo: **rgba(35,131,226,0.14)** (same as Light). Checkbox checked bg (39,131,222) (same). Header select-all indeterminate: same blue.
- Action bar: **bg (37,37,37)**, `box-shadow: rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 4px 12px -2px`, r 5px; "3 selected" text (39,131,222); segment dividers `rgba(255,255,243,0.082) 1px 0 0 0`; item text + trash icon (240,239,237).
- After Escape the view keeps a **selection mode**: a sticky checkbox column appears at the far left when scrolled horizontally (36px, bg (25,25,25)) with the keyboard-focused checkbox ringed in blue; another Escape / click elsewhere leaves it.
- Selected cell overlay: `rgb(39,131,222) 0 0 0 2px inset`, bg rgba(35,131,226,0.07) (same as Light).

## D5. Select editor / colour menu — Dark
- Cell editor card: **bg (37,37,37)**, dark menu shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.2) 0 14px 28px -6px, rgba(25,25,25,0.118) 0 2px 4px -1px`, r 6px; top input band **bg rgba(255,255,255,0.03)**; hint text **(173,169,163)**.
- Option colour menu: bg (37,37,37), same dark shadow, r 10px; header "Colors" (173,169,163).

## D6. Inline linked DB — Dark
- Title "Projects" (24/600) and ↗ `svg.arrowDiagonalUpRight` fill **(240,239,237)**; toolbar icons (173,169,163); rest identical to the full-page table dark values.

## D7. Calculation footer — Dark (Count all applied temporarily, then set back to None; verified gone)
- When the table is taller than the viewport, the footer is a **sticky bar at the viewport bottom**: container 1093×51 (spans the visible table width), **bg = page bg (rgb(25,25,25) dark / #fff light), `border-top: 1px solid rgba(255,255,243,0.082)`** (Light: rgba(42,28,0,0.07) by analogy with the grid — the light measurement was taken un-stuck, without the border). When the table fits, the footer sits inline, 50px tall, with no border.
- "COUNT" label **(125,122,117)** dark (Light (161,158,153)); value "15" **(173,169,163)** dark (Light (125,122,117)).

## Re-verification vs earlier tokens (spec §5 / globals.css `--menu-*`)
- **Confirmed unchanged**: `--menu-bg` #fff / rgb(37,37,37); `--menu-radius` 10px (views overflow menu, New ▾ dropdown, Calculate submenus, option colour menu); `--menu-shadow` light 3-layer and dark 3-layer (opaque rgb(56,56,54) ring) exactly as recorded; `--menu-row-height` 28px; `--menu-row-padding-x` 8px; `--menu-row-hover-bg` rgba(33,27,23,.051) / rgba(255,255,255,.055); `--menu-fg` (44,44,43) / (240,239,237); `--menu-field-bg` rgba(66,35,3,.03) (view search field); `--menu-width-sm` 248px (column header menu measured 248×418).
- **Differences / additions**:
  - The **Select cell editor** uses **radius 6px**, not 10px, and is 300 wide.
  - Small floating controls (OPEN button, multi-select action bar, cell mini-toolbar) use a LIGHTER shadow than menus: Light `rgba(25,25,25,.027) 0 8px 12px 0, rgba(25,25,25,.027) 0 2px 6px 0, rgba(42,28,0,.07) 0 0 0 1px`; Dark `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,.08) 0 4px 12px -2px`.
  - Dark field bg inside the cell editor top band is rgba(255,255,255,0.03) (spec has rgba(252,252,252,.03) for `--menu-field-bg` dark — visually identical).
  - Database view tabs are pills (r 20px, active bg rgba(33,27,23,.05)) — there is no underline-style tab anymore.
  - The option pill palette (§6b / D3) is distinct from the block colour palette in c-page-blocks.md (e.g. Light Blue text block = (56,125,201) but Blue pill text = (38,74,114); Dark pill text is a pale tint, not the saturated block colour).

## Not captured / caveats
- Pressed (mousedown) state of "New" (pressing creates a page) — not measured.
- Status dot colours for Orange/Yellow/Purple/Pink/Red (no Status option uses them).
- Light-mode values for the cell hover mini-toolbar (comment/duplicate) were not measured separately (dark only).
- "Calculate ▾" hover placeholder does not exist in this build (calculations only via header menu → Calculate, or by clicking an existing footer value).
- Notion left in **Light**; sidebar re-expanded; no fixture value changed (Budget calculation set back to None both times; option colours untouched).
