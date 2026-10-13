# (f) Board + Gallery views - raw capture

Date 2026-10-13. Viewport 1300x597, DPR 1, sidebar collapsed (Ctrl+\). Fixture: Projects DB. Notation as in d-table.md.
Font: Notion UI stack. Default text colour (44,44,43) light / (240,239,237) dark. Owner never shown (hidden by default, name not recorded).
Screenshots in screenshots/f-*.

## 1. BOARD (group by Status), Light
Screens: f-board-light.jpg, f-board-scrolled-light.jpg (scrolled right, shows Done col), f-board-card-hover-light.png, f-board-newpage-hover-light.png, f-board-cover-light.png (Card preview=Page cover, temporary).

### View settings (Layout) of this Board
Show page icon ON, Wrap all content ON, Group by Status, **Color columns ON**, Open pages in Side peek, **Card preview None**, **Card size Medium**, **Card layout List** (alt: Compact). Property visibility: only Name shown ("1"). So default cards show ONLY the title. Hide empty groups / hidden groups: none present in this fixture (all 5 statuses have >=1 card; no "Hidden groups" column and no "+ Add group" visible at the right end; board just ends after Done).

### Frame
- `div.notion-board-view`: x=96 (page content x=104 = 96 + padding-left 8), `padding 0 0 0 8px`, `margin 0 96px`. Top y=166.4 = directly under the 40px views bar (views bar y126.4-166.4): the column header row starts at **y=174.4** (8px below).
- Horizontal scroll: the scroller `.notion-scroller.vertical.horizontal` spans full width (1300); scrollWidth 1544 = 8 + 5 cols x 288 + ~96 right pad. Horizontal scrollbar at bottom of page. Board DOM: collection_view_page-block (padding 0 0 180px) > flex row (header row) / flex row with `margin-top 48px` (card groups).
- **Column pitch 288px**: column width **276**, `margin-right 12px` (gap 12). Columns x: 104, 392, 680, 968, 1256.

### Column = header + body (two separate boxes, same tint)
- **Header** div: 276x**40**, `padding 0 8px`, `border-radius 10px 10px 0 0`, bg = column tint, y=174.4. Header and body touch (body starts y=214.4).
- **Body** `div.notion-board-group`: width 276, `padding 0 8px 8px`, `border-radius 0 0 10px 10px`, `margin 0 12px 16px 0`, bg = same tint. Height = cards + gaps + New row (empty-ish column Blocked w/ 2 cards = 147).
- Column tint (Color columns ON), light (rgba): Blocked brown (115,59,3,.035); Not started gray (66,35,3,.03); Review/In progress blue (0,128,213,.047); Done green (3,87,31,.035).
- Header contents (left to right): **status pill** (the same style as the select/status pill: h20, r10, `padding 0 9px 0 7px`, 14px/400/lh16.8, wrapped in a button 84.8x26 `padding 3px r6 transition background .02s`, starts x=112), dot 8x8 (x+7) + label 14px; **count** = 20x20 button, r4, `padding 0 6px`, 14px/400/lh16.8, colour = group colour, hover bg rgba(33,27,23,.051) (`transition background .1s`), starts 8px after the pill (x 196.8 for Blocked); at header hover (opacity transition .1s): **"⋯" (aria "More group options") 24x24 r6 at x=324** and **"+" (aria "Add a page") 24x24 r6 at x=348** (right edge = column right-8). Both icons 16px, fill = group colour; hover bg rgba(33,27,23,.051).
- Pill / dot / count colours, light:
  | Group | pill bg | pill text | dot | count + "New page" text | card ring |
  |---|---|---|---|---|---|
  | Blocked (brown) | (127,51,0,.157) | (88,68,55) | (182,137,101) | (182,137,101) | (139,46,0,.086) |
  | Not started (gray) | (28,19,1,.11) | (73,72,70) | (142,139,134) | (95,94,89) | (42,28,0,.07) |
  | Review/In progress (blue) | (0,118,217,.204) | (38,74,114) | (39,131,222) | (39,131,222) | (0,124,215,.094) |
  | Done (green) | (0,96,38,.157) | (42,83,60) | (70,161,113) | (70,161,113) | green (not measured) |
- Order in this board: Blocked, Not started, Review, In progress, Done (Notion's status-group order, not option order).

### Card (List layout, no preview), Light
- Wrapper `div.notion-selectable.notion-page-block.notion-collection-item` > `div[presentation]` = the card: x = col+8, **width 260**, **min height 40** (title 1 line), **border-radius 10**, bg **white (255,255,255)** in every column, **no real border; box-shadow = `rgba(25,25,25,.027) 0 4px 12px 0, rgba(25,25,25,.02) 0 1px 2px 0, <ring> 0 0 0 1px`** where ring is the per-column 1px tint from the table above. `margin-bottom 8px` (gap between cards = 8). `transition background .1s ease-out`.
- Card is an `<a>` (link, 260x38.5) with inner padding **8px 10px**; title div 240 wide, 22.5 tall: **15px / 500 / lh 22.5px, c (44,44,43), padding 0 1px**. Page icon would precede the title (Show page icon ON; fixture rows have none).
- Card height with title only: 40. Cards with properties grow (see below). Stack: header 40 → first card at y=217.4 (3px below header bottom? body y=214.4 + 3px spacer div) → cards 8px apart → New row.
- **Hover**: card bg becomes the column tint colour over white, i.e. same rgba as the column bg (Blocked: rgba(115,59,3,.035)). Shadow unchanged. Plus the **hover action group** appears top-right: container 57x24, `border-radius 4px`, bg white, `box-shadow rgba(25,25,25,.027) 0 8px 12px 0, rgba(25,25,25,.027) 0 2px 6px 0, rgba(42,28,0,.07) 0 0 0 1px`, transition opacity .2s; position top 8, right 8 of the card (x=307..364 in a 260 card at 112). Two buttons: **edit (pencil-ish "✎") 29x24** and **"⋯" 28x24**, each `padding 4px 6px`, 16px svg, colour (125,122,117), font 12px/500; hover bg of each = rgba(33,27,23,.051) (standard). Clicking the card opens a SIDE PEEK (Open pages in = Side peek) - not triggered.
- Selected/dragging: not captured (would need drag or side effects).
- **Empty properties**: Notion hides empty property rows on cards (Owner, Contact etc. do not render; Budget $0 and checkbox render because they have values).

### Properties on card (temporarily shown, then reverted to Name-only; see Problems)
Order follows property order. Each property row: **h 28**, `padding 5px`, `border-radius 5px`, `margin 0 6px`(left 118 vs title 122: row starts x+6, text at x+11), **12px/400/lh 18px**, c (44,44,43) (dates/numbers), no prop-name labels. Rows seen: Budget "$8,000.00", checkbox "Done" (16px box + label, label 12px), Due "November 30, 2026" (plain text, no icon), Edited timestamp "October 12, 2026 6:31 PM", Files "https://example.com/spec.pdf" (chip with file icon, bg gray, ~r4). Card height with 4 props ~156-168px. Pills for select/status/tags would use the standard small pill (not captured because of the permission block).

### "+ New page" row (bottom of every column)
- `div` 260x**40**, `border-radius 10`, `padding 0 10px`, `gap 9px`, **15px/400/lh 18px**, colour = group colour (brown (182,137,101), gray (95,94,89)... but the light screenshot shows gray text for Not started; measured count colour (95,94,89), row text looks (125,122,117)), plus icon 16x16 + label "New page". Rest bg transparent, **ring `0 0 0 1px` in the same per-column ring colour** (dashed look is NOT used; solid). **Hover bg = the column tint** (rgba same as column), `transition background .1s ease-in-out`, cursor text. Clicking creates a page (not clicked).

### Board with Card preview = Page cover (temporary), f-board-cover-light.png
Card 260 wide; cover `img` **260x148, object-fit cover, object-position 50% 60%**, top corners clipped by the card (card overflow clip, r10), then a **1px divider** (border-bottom `rgba(42,28,0,.07)`), then title block (h 39 incl padding 8px 10px). Card height 186.5. Cards without cover show no image (just the title card). Reverted to None.

## 2. BOARD, Dark (f-board-dark.jpg, f-board-card-hover-dark.png)
Page bg (25,25,25). Title text (240,239,237).
| Group | column bg | card bg | card ring (3rd shadow) | pill bg | pill text | dot | count/new text |
|---|---|---|---|---|---|---|---|
| Blocked | (253,158,101,.05) | (56,45,38) | (255,174,122,.133) | (255,184,132,.365) | (245,237,233) | (182,137,101) | (182,137,101) |
| Not started | (252,252,252,.03) | (32,32,32) | (255,255,243,.082) | (255,252,235,.306) | (240,239,237) | (142,139,134) | (188,186,182) |
| Review/In progress | (41,139,253,.063) | (33,48,65) | (71,157,255,.173) | (81,166,255,.494) | (229,242,252) | (39,131,222) | (39,131,222) |
| Done | (83,255,140,.035) | (36,52,43) | (119,255,179,.118) | (113,255,175,.337) | (232,241,236) | (70,161,113) | (70,161,113) |
- Dark cards are **opaque tinted colours, not white**; shadow = `rgba(25,25,25,.08) 0 2px 4px 0, <ring> 0 0 0 1px` (2 layers only, no big blur). New-page row: transparent bg, ring = the same ring colour, text = count colour; hover bg = (card-ish tint) not separately measured.
- Card hover (Review): bg (33,48,65) -> **(37,54,73)** (lighter). Hover action group: bg transparent/dark with the same pattern (icons (173,169,163)); in the zoom it's a dark chip (dark bg (37,37,37)-like with 1px ring), no white.
- Header "⋯"/"+" icon fill = count colour; hover bg of those not captured in dark (mid-transition).

## 3. GALLERY (card preview = Page cover), Light
Screens: f-gallery-light.jpg (original state), f-gallery-bottom-newtile-light.jpg, f-gallery-card-hover-light.png, f-gallery-newtile-hover-light.png, f-gallery-large-light.jpg, f-gallery-fitmedia-light.jpg.
Settings of this view: Show page icon ON, Wrap all content OFF, Open pages in **Center peek**, Card preview Page cover, Card size shown as **Medium**, Fit media OFF, Card layout List.

### Grid
- `div.notion-gallery-view`: x=0, `padding 0 104px 180px`; grid box x=104, w 1077 (frame minus 2x104), `padding 16px 0 4px`, **gap 16px (row and column)**.
- **Original (before I touched card size) at 1300px viewport: 3 columns of 348.3px, cards 348.3 x 184.8; cover area 146px tall** (+1px divider + ~38 title block).
- Small: **5 columns of 202.6px**, card h 152.7, cover img 114 (=16:9ish). Large/explicit Medium: 3 columns 348.3, card h **234.3**, cover img **195.75** (=348.3 x 9/16, 16:9). So explicit sizes give 16:9 covers; the original state had a 146px cover (see Problems).
- Grid columns = repeat(auto-fill-like) with min width: Small ~180-200, Medium/Large ~ >300.

### Card (List layout)
- Card = first child of `.notion-collection-item`: **radius 10**, **bg white (255,255,255)**, `box-shadow rgba(25,25,25,.027) 0 4px 12px 0, rgba(25,25,25,.02) 0 1px 2px 0, rgba(42,28,0,.07) 0 0 0 1px`, `transition background .1s ease-out`. Column width = card width.
- **Cover** area (top): full card width x **146** (Medium original); `img` object-fit **cover**, object-position **50% 40%**, radius 1px 1px 0 0 computed (the card clips to r10 so top corners follow the card radius); **1px divider** below the cover: border-bottom `rgba(42,28,0,.07)`.
- **Card without cover**: the same 146px area is shown as a blank placeholder with bg **rgba(66,35,3,.03)** (warm gray) and NO divider line; title block follows directly (no content preview because Card preview = Page cover).
- **Title block**: padding **8px 10px**, height 39 (8 + 22.5 + 8); title **15px/500/lh 22.5px**, c (44,44,43), `padding 0 1px`, nowrap (Wrap all content OFF) with ellipsis. No properties shown (property visibility = Name only).
- **Hover**: card bg -> **rgba(55,53,47,.04)** (gray tint); the cover/placeholder keep their look. Action group top-right of the card (top 8, right 8): for cards WITH a cover: 126.7x26 container (**"Reposition" button 69.7x26 text 12px/400-500 c (125,122,117)** + edit 29x26 + "⋯" 28x26); for cards without cover: only edit + "⋯" (≈57x26). Container: bg white, r4, `box-shadow rgba(25,25,25,.027) 0 8px 12px 0, rgba(25,25,25,.027) 0 2px 6px 0, rgba(42,28,0,.07) 0 0 0 1px`, `transition opacity .2s`; each button `padding 4px 6px`, 12px/500, c (125,122,117).
- **"+ New page" tile** (last grid child, below the last row, 16px gap after the last row): **348.3 x 40** (first column width), **radius 10, `box-shadow rgba(42,28,0,.07) 0 0 0 1px`, no bg, `padding 9px 14px 8px`, 15px/400/lh 22.5px**, content centred, colour **(173,169,163)**, plus svg 15x15 fill same (margin 0 6px 0 -1px), label "New page". **Hover bg rgba(33,27,23,.051)**, text colour unchanged, `transition background .02s ease-in`.
- **Fit media ON**: img `object-fit: contain` (position 50% 60%), the image letterboxed on white (cover area keeps 146/196 height); card height unchanged. Reverted OFF.

## 4. GALLERY, Dark (f-gallery-dark.jpg, f-gallery-card-hover-dark.png)
- Card bg **rgba(255,255,255,.055)** (translucent on page bg (25,25,25)), shadow `rgba(25,25,25,.08) 0 2px 4px 0, rgba(255,255,243,.082) 0 0 0 1px`; divider `1px solid rgba(255,255,243,.082)`; no-cover placeholder also reads as card bg (same translucent white). Title (240,239,237).
- Hover card bg **rgb(47,47,47)**. Action group chip: bg **rgb(37,37,37)**, shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,.08) 0 4px 12px -2px`, text/icon (173,169,163).
- New tile: text (125,122,117) (rest colour; probably dimmer than light), ring `rgba(255,255,235,.1) 0 0 0 1px`.

## Problems / not captured
- **View setting changes** (reverted unless noted): Board Card preview None->Page cover->None (reverted); Board Property visibility: temporarily showed Budget, Done, Due, Attachments, Edited then "Hide all" -> only Name shown again (verified on screenshot). Gallery Card size Small -> Large -> Medium, Fit media ON -> OFF.
  - **Gallery Card size is NOT exactly as originally found**: the original rendered "Medium" at 348x184.8 (cover 146); after explicitly picking Medium it renders 348x234 (16:9 cover 196). The original was probably an unset default that also labels "Medium"; now the stored value is explicit Medium. Cosmetic only, no content changed. To restore the old look Notion offers no unset.
- Mid-capture the permission system started refusing further view-setting edits (so Tags/Priority/Owner/Due pills on cards were not captured on the board, nor "Compact" card layout, nor a card with Wrap off/page-icon).
- Not captured: selected card, drag state, Done column ring (light), dark hovers of header icons and New row, dark New row hover bg, empty/0-card column, hidden-groups UI (none in fixture), Gallery property rows (Name-only view).
- Theme left in Light (localStorage theme mode light verified).
