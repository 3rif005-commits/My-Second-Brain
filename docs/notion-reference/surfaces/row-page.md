# Row page, peek modes, view settings panel, new view

Source: `_raw/h-row-page-view-settings.md` (measured 2026-10-13, viewport 1300×597, sidebar collapsed).

Screenshots:
peeks: [side](../screenshots/h-side-peek-light.jpg) ([dark](../screenshots/h-side-peek-dark.jpg)) · [center](../screenshots/h-center-peek-light.jpg) ([dark](../screenshots/h-center-peek-dark.jpg)) · [full page](../screenshots/h-full-page-light.jpg) · [peek mode menu](../screenshots/h-peek-mode-menu-light.png)
properties: [label hover](../screenshots/h-properties-label-hover-light.png) ([dark](../screenshots/h-properties-label-hover-dark.png)) · [label menu + visibility flyout](../screenshots/h-property-label-menu-light.jpg) · [person editor in place](../screenshots/h-property-person-editor-light.png)
comments/body: [comments + body](../screenshots/h-comments-body-light.png) ([dark](../screenshots/h-comments-body-dark.png)) · [comment focused](../screenshots/h-comment-focus-light.png)
view settings: [root](../screenshots/h-view-settings-root-light.jpg) ([dark](../screenshots/h-view-settings-root-dark.jpg)) · [root scrolled](../screenshots/h-view-settings-root-scrolled-light.png) · [Layout (table)](../screenshots/h-view-settings-layout-table-light.png) · ["Open pages in"](../screenshots/h-view-settings-open-pages-in-light.jpg) · [Layout board](../screenshots/h-vs-layout-board-light.png) ([scrolled](../screenshots/h-vs-layout-board-scrolled-light.png)) · [Layout gallery](../screenshots/h-vs-layout-gallery-light.png) ([dark](../screenshots/h-vs-layout-gallery-dark.png), [scrolled](../screenshots/h-vs-layout-gallery-scrolled-light.png)) · [card size](../screenshots/h-vs-card-size-menu-light.png) ([dark](../screenshots/h-vs-card-size-menu-dark.png)) · [card preview](../screenshots/h-vs-card-preview-menu-light.png) · [property visibility](../screenshots/h-vs-property-visibility-light.png) ([scrolled](../screenshots/h-vs-property-visibility-scrolled-light.png)) · [filter](../screenshots/h-vs-filter-light.png) · [filters active](../screenshots/h-vs-filters-active-light.png) · [sort](../screenshots/h-vs-sort-light.png) · [sort active](../screenshots/h-vs-sort-active-light.png) · [group none](../screenshots/h-vs-group-none-light.png) · [group grouped](../screenshots/h-vs-group-grouped-light.png) · [conditional color](../screenshots/h-vs-conditional-color-light.png) · [more settings](../screenshots/h-vs-more-settings-popover-light.png) · [sub-items](../screenshots/h-vs-sub-items-light.png) · [automations](../screenshots/h-vs-automations-light.png) · [edit properties](../screenshots/h-vs-edit-properties-light.png) · [edit property in sidebar](../screenshots/h-vs-edit-property-priority-light.png)
new view: [view-type picker](../screenshots/h-new-view-picker-light.png) · [view ⋯ menu](../screenshots/h-view-item-menu-light.png)

---

## 1. Display modes
Per view setting "Open pages in": **Side peek** (default for Table/Board), **Center peek**, **Full page**. Peek URLs add `&p=<row id>&pm=s` (side) or `&pm=c` (center).

### 1.1 Side peek
- `div.notion-peek-renderer`: absolute, top 0 / right 0 / bottom 0, **width 650px** at a 1300px viewport (≈50%; resizable, so it's probably a stored width). z-index 109.
- Panel: bg **#fff** (dark `rgb(32,32,32)`), radius 0, **no border**. Its edge is `shadow.floatButton` (light `rgba(25,25,25,.027) 0 8px 12px 0, rgba(25,25,25,.027) 0 2px 6px 0, rgba(42,28,0,.07) 0 0 0 1px`; dark `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,.08) 0 4px 12px -2px`).
- **It pushes the page instead of overlaying it.** The main frame shrinks to the remaining width and re-lays out (tabs collapse into "N more…"). **No dimming.** The page stays interactive.
- **Animation:** `transition: width .2s ease, transform .2s ease`. Close slides it out (`translateX(650px)`) while the frame grows back. Open is the same slide-in (it looked instant only because the main thread was busy).
- **Resize handle:** a 12px hit area on the left edge (`cursor: col-resize`), **with no visual highlight**.
- **Close:** Esc (one press, even while editing the title), click outside, or ».
- **Keyboard:** **Alt+J = next row, Alt+K = previous row.** Ctrl+Enter = open in full page.
- **Top bar** (sticky, **44px**, padding-inline 12px 10px, no border):
  - Left (gap 2px): **» Close** (20px icon) · **⤢ Open in full page** (16px) · divider · **Switch peek mode** (panel icon) · divider · **↑ Previous** · **↓ Next**. Each is **24×24, radius 6px**, icon `rgb(142,139,134)` (dark `rgb(173,169,163)`), hover `rgba(33,27,23,0.051)`.
  - Dividers: **1×14px, bg `rgba(28,19,1,0.11)`** (dark `rgba(255,255,235,0.1)`), margin 0 6px.
  - **Close and Open are always visible. Peek-mode, prev/next and the dividers fade in on top-bar hover** (`opacity .1s`). A disabled arrow has opacity 0.4.
  - Right: **Share** (text button 71×28) · Copy link · Favorite · ⋯ (28×28 each, radius 6px).
  - Tooltips include the shortcut: "Close / Escape", "Open in full page / Ctrl+↵", "Previous page / Alt+K", "Next page / Alt+J".
- **Peek-mode menu:** a 220px card, radius 10px, `shadow.menu`, 4px below the button (scale+fade 200ms, origin top-centre). Rows: Side peek ✓ · Center peek · Full page · New tab · divider · Edit view default.
- **Page inside the side peek:** grid `76px | 483px | 76px` (**483px content column**). Cover **20vh** (doc pages use 30vh). Page controls bar 48px (padding `16px 0 4px`) with "**Add icon**" and "**Customize layout**" (hover-revealed). **Title 32px / 700 / 38.4px.**

### 1.2 Center peek
- Backdrop: the fixed full-screen renderer, **bg `rgba(15,15,15,0.6)`** (dark **0.8**), covering the top bar too.
- Modal: **top 72px, left/right 72px with `margin-inline: auto`, max-width 975px, height `calc(100% − 144px)`, radius 12px**, bg #fff (dark `rgb(32,32,32)`), `shadow.floatButton` (dark as for the side peek). The body scrolls inside the modal.
- Top bar: the same as the side peek, but with **no » Close button** (close via Esc or the backdrop). Its top corners are rounded to 12px.
- Content grid `126px | 708px | 126px` (**708px column**). Cover 20vh. Title 32px.
- **No measurable open/close animation** (treat it as instant, or use a ≤150ms fade).

### 1.3 Full page
- A normal doc page: **720px column**, cover 30vh, **title 40px / 700 / 48px**.
- Breadcrumbs: **"<parent page> / Projects / <row title>"**. The database is a crumb.
- Properties, comments and body as below. The value column grows, and the **label column stays 160px**.

## 2. Properties block
- A column of `div[role=row]`: **row 34px tall, margin-bottom 4px (38px pitch)**, 14px/21px, `cursor: grab` (rows reorder by drag). Rows start 2px inside the content column.
- **Label cell:** **width 160px (fixed in every mode), padding 0 6px, radius 6px**, colour `rgb(125,122,117)` (dark `rgb(173,169,163)`), `transition: background .02s ease-in`.
  - The type icon is an 18×18 box with the masked 19.2px glyph, `rgb(142,139,134)` (dark `rgb(173,169,163)`). 6px gap.
  - Label **14px / 400 / 20px**, ellipsis.
- **Value cell:** margin-left 4px, then a `div[role=button]` filling the rest, **min-height 34, padding 6px (7px 6px for text/empty), radius 4px**. Value **14px / 400 / 21px**, primary colour.
- **Empty value:** the text "**Empty**" in `rgb(161,158,153)` (dark `rgb(125,122,117)`).
- Value rendering matches the table cells, except: **numbers are left-aligned** here. URLs grey the path. ID is grey. Relations and emails use the 1px gradient underline. Buttons are bordered chips.
- **Label hover:** bg `rgba(33,27,23,0.051)`. **The type icon becomes the ⋮⋮ drag handle.** After ≈0.5s a dark tooltip with the full name appears to the **left**.
- **Value hover:** **no background.** A **mini toolbar** appears at the row's right end (52×24, radius 6px, padding 2px, `shadow.floatButton`, Comment + Copy). Rollups show Edit + Copy. **Relations** get a value bg `rgba(55,53,47,0.06)` (radius 4px) plus a 45×24 card with "−" Unlink and "+" Link another.
- **Click a label → property menu** (220px, opens **above** the label when there's room, radius 10px): Rename · Edit property · Comment | **Property visibility ›** (flyout: **Always show ✓ / Hide when empty / Always hide**) · Duplicate property · Delete property | Customize layout.
- **Click a value → in-place editor** covering the value cell (width = value cell, radius 6px, `shadow.menu`), with the same editors as the table (`database-table.md` §9).
- **"+ Add a property":** 34px row, padding `0 8px 0 6px`, radius 6px, 14px `rgb(161,158,153)`, plus icon 16px `rgb(173,169,163)`. Hover bg `rgba(33,27,23,0.051)`.
- "N more properties" / property groups / backlinks: **not present in the fixture** (not captured). Hidden properties come from "Hide when empty" or "Always hide".

## 3. Comments
- Heading "**Comments**" **13px / 500 / 18px `rgb(125,122,117)`** (dark `rgb(173,169,163)`), about 20px below "Add a property".
- Composer row (padding `8px 4px 12px 0`): **24×24 circular avatar** (initial 11px `rgb(142,139,134)`; dark inner bg `rgb(37,37,37)`), then the input "**Add a comment…**" 14px/20px, placeholder `rgb(161,158,153)`. **No border and no background, at rest or focused.**
- **Focused:** three 24×24 buttons appear at the right (30px step): **Attach file** · **@ Mention** · **Send** (`arrowInCircleUpFill`, **opacity 0.4 while empty**). Esc blurs the input.
- The comments wrapper has **`border-bottom: 1px solid rgba(55,53,47,0.09)`** (dark `rgba(255,255,255,0.094)`). That is the divider between the header area and the page body.

## 4. Page body (empty)
- Placeholder block **padding `8px 0 24px 8px`**, **16px / 24px `rgb(161,158,153)`** (dark `rgb(125,122,117)`): "Press ‘enter’ to continue with an empty page, or <u>create a template</u>". "create a template" is an underlined button in the same colour.

## 5. View settings panel (toolbar sliders button)
> **Re-verified:** a **docked 483px right panel** (`.notion-view-settings-sidebar`) with **push/pop** navigation, as the 2026-08-28 spec said. Details below.

- **Placement:** absolute, **hanging from the bottom of the views bar** (top 40px inside the sticky views-bar row), `right: -96px` (it bleeds into the page gutter), **width 483px including `padding-right: 96px`** (≈387px visible), height = rest of the viewport, z-index 88.
- **bg = page bg** (#fff / dark `rgb(25,25,25)`), **no shadow**. A left border **`1px solid rgb(230,229,227)`** (dark `rgb(56,56,54)`) that **fades in over the top 12px** (`border-image: linear-gradient(180deg, <bg> 0, <border> 12px) 1 100%`).
- **It overlays the table** (the table is not resized).
- **Enter/exit:** `transition: opacity .2s ease, transform .2s ease` (slides in from the right).
- While the panel is open the toolbar sliders button keeps its hover bg (active state).
- The scroll area has a top fade mask (`mask-image: linear-gradient(transparent 0, #000 34px)`). Rows are 259px wide, inset 8px.
- **Header (root):** "**View settings**" **12px / 500 `rgb(125,122,117)`** + **✕ close: 20×20 circle, bg `rgba(42,28,0,0.07)`** (dark `rgba(255,255,235,0.1)`), 14px glyph.
- **Name row:** icon button 28×28 (radius 6px, the view-type icon) + name input (radius 6px, padding 3px 6px, bg `rgba(66,35,3,0.03)`, **ring `rgba(28,19,1,0.11) 0 0 0 1px`**, placeholder "View name"), with an **ⓘ** (Add view description) inside at its right.
- **Rows:** 259×28, radius 6px, 29px pitch, hover `rgba(33,27,23,0.051)`. Icon 20px **`rgb(56,56,54)`** (dark `rgb(230,229,227)`), label 14px, **value right-aligned 14px `rgb(161,158,153)`**, chevron 16px `rgb(173,169,163)`.
  - Layout "Table" · Property visibility "19" · Filter · Sort · Group · Conditional color · Copy link to view
  - divider · section "**Data source settings**" (12px / 500 grey): Source "Projects" · Edit properties · Automations · AI Autofill · Turn into · More settings
  - divider · Manage data sources · Lock database · Manage in Calendar ↗
  - **No** Duplicate/Delete view (those are in the view's ⋯ menu, §6) and **no** Load limit row in this build.
- **Push/pop with no animation.** A sub-page header shows **← Back (24×22, radius 6px)** + **title 14px / 600** + the ✕. **Esc closes the whole panel, even from a sub-page.** Click-outside also closes it.

### Sub-pages
- **Layout:** a **3×3 grid of layout cards** (83×56.5, gap 8px, radius 6px, padding 6px; icon 20px; label 11px/16.5px): Table · Board · Timeline / Calendar · List · Gallery / Chart · Feed · Map.
  - Rest: `box-shadow: inset 0 0 0 1px rgb(230,229,227)` (dark `rgb(56,56,54)`), content `rgb(125,122,117)`.
  - **Selected:** `inset 0 0 0 2px rgb(39,131,222)`, content blue.
  - Hover: bg `rgba(33,27,23,0.051)`.
  - Option rows below (274×28, padding 0 8px, with a hover bg on toggle rows), by layout:
    - Table: Show vertical lines ⏻ · Show page icon ⏻ · Wrap all content ⏻ · Open pages in "Side peek" ›
    - Board: Show page icon · Wrap all content · Group by "Status" › · **Color columns** ⏻ · Open pages in › | Card preview "None" › · Card size "Medium" › · **Card layout** block
    - Gallery: Show page icon · Wrap all content · Open pages in "Center peek" › | Card preview "Page cover" › · Card size "Medium" › · **Fit media** ⏻ · Card layout block
  - **Open pages in** dropdown (250px, opens above the row): two-line items with an icon, a title (14px) and a description (12px `rgb(125,122,117)`): Side peek ✓ ("Open pages on the side. Keeps the view behind interactive." + blue "Default for Table"), Center peek, Full page.
  - **Card layout block:** 251×157, bg `rgba(66,35,3,0.03)`, radius 10px, padding 12px, caption "Card layout" 12px. Two radio previews **102×76** (bg #fff, radius 10px): unselected `outline: 1px solid rgb(230,229,227); outline-offset: -1px`, **selected `outline: 2px solid rgb(39,131,222); outline-offset: -2px`** with blue-tinted mini bars. Options: Compact / List.
  - Card size dropdown: Small · Medium · Large. Card preview dropdown: None · Page cover · Page properties › · Page content ("Uses first block on the page").
- **Property visibility:** search "Search for a property…" (field style, auto-focused, blue ring). Section "**Shown in table**" + a blue "**Hide all**" text button (12px `rgb(39,131,222)`, padding 2px 6px). Rows 259×28 with **no hover bg**: ⋮⋮ (20px `rgb(173,169,163)`) · type icon (`rgb(56,56,54)`) · name · **eye toggle** 24×24. **The title row's eye is disabled (opacity 0.4).** A "Hidden in table" section with "Show all" appears when something is hidden.
- **Filter** ("Add filter"): search "Filter by…" + all properties + a sticky footer "+ Add advanced filter". With active filters ("Filters"): one row per filter (⋮⋮ + the blue filter chip) + "+ Add filter".
- **Sort** ("New sort"): search "Sort by…" + properties. With active sorts ("Sort"): property button + direction button (h 32, bg #fff, border 1px `rgba(28,19,1,0.11)`, radius 6px) + ✕, then "+ Add sort" and "Delete sort".
- **Group** ("Group by"): search + "None ✓" + groupable properties. When grouped: Group by › · Status by "Option" › · Sort "Ascending" › · Hide empty groups ⏻ | "Groups" + "Hide all" · one row per group (⋮⋮ + pill + eye) | Remove grouping · Learn about grouping.
- **Conditional color:** an illustration (258×128, radius 10px), a description (12px grey), and a primary "**+ New color setting**" button (258×28, blue, radius 6px).
- **More settings:** this is a **popover, not a pushed page** (250px, opens above the row): Sub-items › · Dependencies › · Connections › · Customize page layout ›. **Sub-items** pushes a page with a caption, an illustration card, and a full-width blue "Turn on sub-items".
- **Automations:** a paywall page (⚡, heading, "Upgrade now"). Not usable on this plan.
- **Edit properties** ("Properties"): a search, all properties with chevrons (hidden-in-view ones greyed), and a sticky footer: + New property · Deleted properties "1" › · Learn about properties. **Clicking a property pushes "Edit property" into this same sidebar**: name + ⓘ · Type "Select" › · Property access · AI Autofill › · Sort "Manual" › | Options + … | footer: Wrap content ⏻ · Duplicate property · Delete property.
  > **Both forms exist:** from the column header menu, Edit property is a **300px flyout** (`database-table.md` §12). From View settings → Edit properties it is a **pushed page in the 483px sidebar**. The content is the same.

## 6. View tabs: view ⋯ menu and "+ New view"
- In the "N more…" menu each view row has a ⋯ that opens a **220px** menu: Rename · Display as › · Edit view · Source "Projects" › | Copy link to view | **Duplicate view · Delete view** | Manage in Calendar.
- "N more…" footer: **+ New view** · New data source.
- **"+ New view" → view-type picker**: a 390px card (radius 10px, `shadow.menu`) opening to the left of the menu. Caption "**Add a new view**" (12px / 500 grey). A **4-column grid of tiles 92×62 (radius 8px, 2px gaps)**: icon 22px `rgb(44,44,43)` above a 14px label `rgb(73,72,70)`. Order: **Table · Board · Gallery · List / Chart · Dashboard · Timeline · Feed / Map · Calendar · Form**. The first tile is highlighted. Opening the picker creates nothing.
