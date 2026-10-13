# Batch b: App shell and search (captured 2026-10-12, Light first)

Viewport 1300x649, DPR 1. Tool output truncation limited some dumps; values below are all measured via getComputedStyle.
Font stack everywhere (inherited from body): `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Helvetica, "Apple Color Emoji", "Noto Sans Arabic", "Noto Sans Hebrew", Arial, sans-serif, "Apple Color Emoji"...`
NOTE: this is the NEW Notion sidebar (2026): no Search row/Home row list; a pill nav row (Home pill + round icon buttons), no chevron on the workspace switcher, a floating bottom bar (New chat pill + 2 round buttons).

## 1. Sidebar (expanded) - LIGHT

### Container
- `nav.notion-sidebar-container` 270x649 at x0,y0. bg `rgb(249,248,247)`. Right edge = **no border**, instead `box-shadow: rgb(240,239,237) -1px 0 0 0 inset` (1px inset hairline on the right edge). transition `width 0.2s`.
- Inner `div.notion-sidebar` 270x649, flex column, transition `width 0.2s, opacity 0.2s, transform 0.2s`. Text color `rgb(44,44,43)`, base 16px/24px (rows override to 14px).
- Scroll area: `div.notion-scroller.vertical` y=92, 270x493 (from below the nav row to above the bottom floating bar), padding-top 6px. Page rows are `a` links inside `div.notion-outliner-private-header-container` etc.
- Default width 270px (measured).

### Workspace switcher (top)
- `div.notion-sidebar-switcher` x8,y6, 254x32 (!the clickable row spans the whole width, the close button sits inside it at the right), margin 6px 8px, radius 9999px? (the element says r 9999px, it is a pill on hover), cursor pointer, transition `background 0.02s ease-in`.
- Inner row: x8,y7 203.8x30, padding 4px 8px, flex.
- Avatar box: 22x22 at x16,y11, radius 4px, margin-right 8px; the image inside is 19.5x19.5 radius 4px (`img`, transition `opacity 0.1s ease-out`). Notification dot: 8x8 at x33,y10.5, bg `rgb(229,100,88)`, 1px solid `rgb(249,248,247)` border (matches sidebar bg), radius 4px.
- Name text: 14px / weight 500 / line-height 20px, color `rgb(44,44,43)`, at x46, single line, ellipsis (the text div is 151.8 wide, gap 8px). **No chevron** is shown on this switcher (screenshot confirms).
- Right: `div.notion-close-sidebar` (aria "Close sidebar"), 24x24 at x232,y10, radius 9999px, margin 0 4px 0 10px, transition `opacity 0.2s` (it is hover-revealed in the sidebar; was opacity 1 while the mouse was over the sidebar).

### Nav row (replaces Search/Home/Inbox rows)
- Container `div[aria-label="Sidebar navigation"]` x8,y52, 216x32, flex, gap 2px, transition `padding 0.2s ease-out`.
- **Home** (selected pill): x8,y52, 85.4x32, radius 9999px, bg `rgba(33,27,23,0.05)`, padding 0 0 0 8px, margin-right 4px, flex. Icon svg 22x22 at x16,y57 color `rgb(56,56,54)`. Label span "Home" 14px / 500 / lh 16.8px, color `rgb(44,44,43)`, padding-left 6px.
- **Chat, Meetings, Inbox**: each 32x32 round (radius 9999px), padding 0 5px, color `rgb(125,122,117)`, icon svg 22x22 (color `rgb(142,139,134)`) at +5px. x: Chat 99.4, Meetings 133.4, Inbox 167.4 (gap 2px). Transition `padding 0.2s ease-out, margin 0.2s ease-out` (they expand into pills with label when selected; labels are hidden: Inbox label span 14/500 exists).
- Inbox unread badge: span 12x12 at x185.4,y54, font 9px / 600 / lh 10.8px, color `rgb(253,246,246)`, bg `rgb(229,100,88)`, radius 9999px, padding 0 3px.
- **Search**: `div[aria-label=Search]` 32x32 at x226,y52 (right-aligned), radius 9999px, color `rgb(44,44,43)`, transition `background 0.1s ease-in-out`.
- There is NO separate compose/new page icon at the top; it is the round "New page" button in the bottom bar (see below).

### Section header "Private"
- `div.notion-outliner-private-header` x8,y98, 254x30, radius 6px, padding 0 8px, gap 4px, flex.
- Label span: **12px / 500 / lh 16px, color `rgb(161,158,153)`**, letter-spacing normal, x16.

### Page rows (`a` > div)
- `a` x8, 254x30, radius 6px, row pitch 31px (30px + 1px gap). Inner div: padding **5px 8px** at depth 0, **5px 8px 5px 16px** at depth 1 (indent per level = 8px: icon x17 at depth 0, x25 at depth 1). 14px / 500 on the row div, lh 21px. Label inner text is weight 400 (the row div is 500 but the label span is 400).
- Icon box 20x20 (`notion-record-icon`, radius 3.5px); emoji img 14x14 at +3px; default doc/db icons are 20x20 svg. margin-right 8px (the 22x18 wrapper at x16).
- Text color: default row `rgb(95,94,89)` (set on `a`), inner selected/hover text `rgb(44,44,43)`.
- **Selected (current page)** row bg `rgba(33,27,23,0.05)` (a, and inner div), text `rgb(44,44,43)`. Hover on an unselected row: see hover section below.
- Toggle: on row hover the icon becomes a 20x20 box (radius 4px, transition `background 0.02s ease-in`, bg `rgba(33,27,23,0.05)` on hover over it) containing a 12x12 chevron svg (transition `transform 0.2s ease-out`; path 7.6x4.4 when expanded = pointing down; 4.4x7.6 = pointing right when collapsed).
- Children rows (Projects, Clients, Empty DB: database table icon 20x20 `rgb(142,139,134)`-ish; "View of Projects": linked-view icon): same 30px height, 8px more indent each level.
- Hover-revealed buttons at the right of the row: wrapper 45x20 at x209, padding-left 3px, gap 2px; each button 20x20, radius 4px, transition `background 0.1s ease-in-out`, icon svg 16x16 color `rgb(142,139,134)` (button color `rgb(125,122,117)`). Order: `+` (aria "Add a page inside", x212) then `...` (class `notion-sidebar-page-menu`, aria "Delete, duplicate, and more...", x234ish).
- "Add new" row: `div` x8,y315 254x30, radius 6px, plus icon 16x16 at x19 color `rgb(173,169,163)`, label 14px / 400 / color `rgb(161,158,153)` at x46.

### Bottom area (below scroller)
- Rows Library / Help / Trash: each 254x30 at x8, radius 6px, row text 14px / 400 / `rgb(95,94,89)`, icon svg 22x22 at x16 color `rgb(142,139,134)`, label x46, transition `background 0.15s`. Tooltip on Help: "Help, contact, more..." (dark pill).
- Floating bottom bar (no background strip):
  - "New chat" pill: x16,y593, 138x40, bg `#fff`, radius 999px, shadow `rgba(25,25,25,0.027) 0 8px 12px 0, rgba(25,25,25,0.027) 0 2px 6px 0, rgba(42,28,0,0.07) 0 0 0 1px`. Text 14px/500 `rgb(95,94,89)`, gap 6px, with kbd chip "Ctrl+O": 12px/500 `rgb(161,158,153)`, bg `rgba(66,35,3,0.03)`, radius 4px, padding 2px 4px, margin-right -4px.
  - "New page" round button (aria "New page", compose icon): x164,y593, 40x40, bg `#fff`, radius 999px, same 3-layer shadow as New chat; transition `background 0.02s ease-in, transform 0.1s ease-out`.
  - "Hot and fresh features" round button (what's-new/sparkle icon): x214,y593, 40x40, bg `#fff`, radius 999px, shadow `rgba(0,0,0,0.04) 0 2px 4px 0, rgba(42,28,0,0.07) 0 0 0 1px`.

### Sidebar hover / resize / collapse (LIGHT, measured)
- Row hover bg = selected bg = `rgba(33,27,23,0.05)` (on `a` and inner div). On hover the icon turns into a 20x20 toggle (radius 4px) with a 12x12 chevron (right-pointing when collapsed, `transform 0.2s ease-out`). Right buttons appear: `+` at x212, `...` at x234 (20x20, radius 4px, hover bg `rgba(33,27,23,0.05)`, transition `background 0.1s ease-in-out`, svg 16x16 `rgb(142,139,134)`).
- "Private" header on hover: bg `rgba(33,27,23,0.05)`, radius 6px, label color becomes `rgb(95,94,89)`, a 12x12 chevron appears after the label (x57), and three 20x20 buttons (gap 2px) at x190/212/234: "Open in Library" (arrow), "Add a page" (+), more (...).
- Resize handle: `div[role=separator]` aria "Resize with left and right arrow keys", x269, 12px wide x 649, cursor `col-resize`; a 1px abs-positioned line div at x269 (cursor default) is its parent. aria-valuemin 0 / max 100 / now 0 (not useful). Drag and keyboard resize did not work through the automation, so **min/max width NOT captured** (default 270).
- Collapsed (click `.notion-close-sidebar` 24x24 at x232,y10, or Ctrl+\): `.notion-sidebar-container` width 0 (transition `width 0.2s`), inner `.notion-sidebar` gets `transform: translate(-250px, 59px)` and height 558 (transition `width 0.2s, opacity 0.2s, transform 0.2s`). Topbar then shows a hamburger `div.notion-open-sidebar` ("Lock sidebar open", tooltip "Lock sidebar open / Ctrl+\") 24x24 at x12,y10, radius 6px, transition `background 0.1s ease-in-out`, with the Inbox unread badge on it; breadcrumb moves to x42; an "Edited 7m ago" text appears (14px, color `rgb(161,158,153)`).
- **Peek** (hover the hamburger at (24,22); hovering x=2 at the left edge did NOT trigger it): floating panel x0,y59, 270x558, translate(0,59), bg `#fff`, radius `0 8px 8px 0`, shadow `rgba(25,25,25,0.05) 0 20px 24px 0, rgba(25,25,25,0.027) 0 5px 8px 0, rgba(42,28,0,0.07) 0 0 0 1px`; the close button becomes a `>>` icon at x232; panel has its own scroll bar; z-index 9 (wrapper), container z 202.
- Screenshots: screenshots/b-sidebar-light.jpg, b-sidebar-collapsed-light.jpg, b-sidebar-peek-light.jpg.

## 2. Top bar - LIGHT (partial)
- `div.notion-topbar` x270 (sidebar expanded) 1030x44, no bg, no border, no shadow, transition `opacity 0.7s, color 0.7s`.
- Breadcrumb item: `div` x282,y10, 171.1x24, radius 6px, padding 0 5px 0 3px, transition `background 0.1s ease-in-out`, 14px/400/lh 16.8px, color `rgb(44,44,43)`; icon `notion-record-icon` 18x18 radius 3.5px margin-right 5px; title text 140.1 wide; hover shows a grey pill (visible in zoom). Next item "Private" (lock icon + label, permission pill) x453,y10, 91.6x24, radius 6px, padding 0 6px, label span 14px/400 color `rgb(161,158,153)`, margin 0 5px 0 4px, followed by a small chevron.
- Right cluster: Share `div.notion-topbar-share-menu` x1128.6,y8, 71.4x28, radius 6px, padding 0 8px, gap 6px, icon 12x20 (lock) color `rgb(56,56,54)`, 14px/400. Copy link x1202, 28x28, radius 6px, svg 20x20 `rgb(142,139,134)`. Favorite `notion-topbar-favorite-button` x1232, 28x28. More `notion-topbar-more-button` ("Actions") x1262, 28x28, svg 22x22 `rgb(56,56,54)`, transition `background 0.02s ease-in`. All buttons: radius 6px, transition `background 0.1s ease-in-out`. No separate Comments / Updates buttons in this version.
- "Edited 7m ago": 14px, `rgb(161,158,153)`, shown right before Share only when the sidebar is collapsed (zero-size when sidebar expanded).

## 2b. Top bar hover + tooltip + page "..." menu - LIGHT
- Top bar button hover bg (on the button div itself, not child svg/parent): `rgba(33,27,23,0.05)` (Copy link, Share, Favorite, More all identical, radius 6px, `background 0.1s ease-in-out`; More uses 0.02s). Tooltip on More: "Page settings & actions", dark pill, bg `rgb(44,44,43)`, text `rgb(240,239,237)` 12px/lh 16.8, padding 5px 8px, radius 6px, shadow `rgba(0,0,0,0.08) 0 4px 12px -2px, rgba(255,255,255,0.05) 0 0 0 1px inset`, 141x27, appears below the button (y42) right-aligned, fade `opacity 0.05s ease-out`.
- **Menu popup** (click `div.notion-topbar-more-button`): box 256 wide (inline `width:256px; max-height:80vh`; scroller 519.2px tall = 80% of 649; min-width 180px, max-width calc(100vw-24px)), x1032 (right edge 12px from the viewport edge), **top y44 (right below the 44px top bar)**. bg `#fff`, radius 10px, shadow `rgba(25,25,25,0.05) 0 20px 24px 0, rgba(25,25,25,0.027) 0 5px 8px 0, rgba(42,28,0,0.07) 0 0 0 1px`. Open animation: wrapper inline `transform-origin:100% top; transform: scaleX(1) scaleY(1); opacity:1; transition: opacity, transform 200ms ease` (scales in from top-right, 200ms ease).
- Inner `div.notion-scroller` (overflow hidden auto, thin scrollbar visible) holds a `div[role=listbox]` of 241px; rows have `role=option`.
- Search field: row 233x36 (padding 4px 8px at x1036,y52) holding an input box 217x28, radius 6px, padding 3px 6px, bg `rgba(66,35,3,0.03)`, focused ring `rgb(35,131,226) 0 0 0 1px inset, 0 0 0 1px` (auto-focused on open), input 14px/lh 20px, placeholder "Search actions...", search icon at x1052. Container padding 8px 4px 4px, gap 1px.
- Font tiles (3, Default / Serif / Mono): each 72.3x61 radius 4px, padding 10px 6px 6px, transition `color 0.3s, border 0.3s`; "Ag" glyphs: Default 24px (sans) / Serif 25px / Mono 26px with letter-spacing -1px; selected tile (Default) text color `rgb(39,131,222)` blue; others `rgb(44,44,43)`; caption 12px/16px color `rgb(125,122,117)` (blue when selected), margin-top 4px. Tiles start at x1044, spaced across the 217px row.
- Rows (`div[role=option]`): 233x28 (x1036), padding 0 8px, gap 8px, radius 6px, cursor pointer, hover bg `rgba(33,27,23,0.05)`. Icon svg 20x20 at x1044, color `rgb(56,56,54)`. Label 14px/400/lh 16.8px `rgb(44,44,43)` at x1072. Right hint (shortcut) span 12px/400 `rgb(161,158,153)`, right-aligned, e.g. "Ctrl+Alt+L", "Ctrl+D", "Ctrl+Shift+P"-style glyph text "Ctrl+⇧+P" (Move to). Chevron (12px) at right for submenu rows (Use with AI, Translate, Notify me, Connections); value text ("Comments", "None") 14px `rgb(161,158,153)` margin-right 4-5px.
- Row order: Copy link, Copy page contents, Duplicate, Move to, Move to Trash | Small text (toggle), Full width (toggle), Customize page | Lock page (toggle), Use with AI > | Suggest edits, Translate > | Import, Export, Turn into wiki | Updates & analytics, Version history | Notify me (Comments) >, Connections (None) > | meta.
- Dividers: 1px high, 217 wide at x1044, bg `rgba(42,28,0,0.07)`, no margin shown (separation ~ 8px each side via row padding).
- Switch (Small text / Full width / Lock page): track 30x18 at x1231, radius 44px, padding 2px, off bg `rgba(135,131,120,0.3)`, transition `background 0.2s, box-shadow 0.2s`; knob 14x14 radius 44px, bg `#fff`, transition `transform 0.2s ease-out, background 0.2s ease-out`.
- Bottom meta (3 lines): "90 words", "Last edited by <name>", "Today at 6:39 PM": each 12px/400/lh 16px color `rgb(161,158,153)`, margin 4px 0, at x1044 (blanked to "Jane Doe" in the screenshot).
- Submenu (Translate, opens on hover, to the LEFT): 233 wide, max-height 454.3, x803; rows 29px pitch language list with a search field "Search languages..." (focus ring blue); header "From / English / Detected language >", "To".
- Screenshots: screenshots/b-page-menu-light.jpg, b-page-menu-bottom-light.jpg.

## 3. Search / quick find (Ctrl+K works; also the Search icon in the sidebar nav) - LIGHT
Screenshots: screenshots/b-search-empty-light.jpg, b-search-results-light.jpg. Titles outside the fixture and the workspace name are blanked to "Page"/"Workspace" (the blanking also overwrote snippet text, so the "Page Page ..." in result snippets and the grey "Page" type pill are artifacts of blanking, not real text; the real pill text is unknown, probably "Page"/"Database").
- **Dialog** `role=dialog`: 1006 wide, x147 (centered in the full 1300 viewport, i.e. over the sidebar too), **top 58.4px (= 9vh)**, height capped to 100% of the viewport height (here 649 so it runs off the bottom of this short viewport; its internal grid is 700px tall; the real max-height rule is not recoverable at this viewport size). bg `rgba(255,255,255,0.9)` + `backdrop-filter: blur(40px)` (glass: the page's pink cover shows through), radius 20px, shadow `rgba(25,25,25,0.24) 0 24px 48px 0, rgba(25,25,25,0.14) 0 4px 12px 0, rgba(42,28,0,0.07) 0 0 0 1px`, overflow hidden, transition `height 0.2s, width 0.2s`. **No dimmed backdrop**: the wrapper (fixed, full-screen, `transition opacity 0.001s, transform 0.001s`) is transparent. No measurable open animation (opacity 1 on first frame); closes with Escape. Internal layout: CSS grid, rows `auto auto minmax(0,1fr) auto`, single column.
- Input row: margin 12px, gap 8px, height 24px at y70.4; search icon at x~174 (20px); `input` 866x24, 16px/400/lh 24px, color `rgb(44,44,43)`, placeholder "Search or ask a question in <workspace>..." (placeholder color `rgb(44,44,43)` at reduced opacity in render ~ `rgb(170,168,164)`-ish, appears light grey), no border. Right: two 32x32 round buttons (radius 9999px, transition `background 0.1s ease-in-out`, icon color `rgb(39,131,222)` blue): "Hide highlight pane" at x1075, "Hide filters" at x1111, both y66.4.
- Filter chips row at y116.4 (24px high): "Title only" (x159, 94x24), "Created by v" (x259, 118x24), "In v" (x383, 60x24): radius 32px, padding 0 8px, gap 6px, 14px/400/lh 24px, color `rgb(125,122,117)`, transition `background 0.02s ease-in`; "+ Filter" (x449, 60x24): radius 12px, padding 0 9px 0 5px, gap 6px, 14px, color `rgb(161,158,153)`, transition `background 0.1s ease-in-out`.
- Results list (left column x161..718, 557 wide; scroller with visible scrollbar at x~739): section header "Today"/"Yesterday": 12px/500/lh 14.4px, color `rgb(125,122,117)`, padding 0 8px, margin 6px 0 8px (first header at y160).
- Result row (empty query) `div[role=option]` 557x36 (x161), radius 12px, padding 4px 8px, transition `background 0.02s ease-in`; pitch 37px. Inner 28px row, gap 8px: icon 20x20 at x169 (color `rgb(44,44,43)`; page icon outline, db table icon, emoji icon), title 14px/**500**/lh 20px color `rgb(95,94,89)`, then dash span "—" 12px color `rgb(125,122,117)`, then path 12px/400/lh 16.8px color `rgb(161,158,153)` ("UI Reference (Claude) / Projects": separator "/" 12px with padding 0 4px). Selected/hovered row bg `rgba(33,27,23,0.05)` (hover and keyboard-selected look identical; selected row also shows a 14x14 enter-arrow icon `rgb(142,139,134)` at the right, x688). No date column in this version.
- Preview pane (right, x762..1139, y~183/150): bordered card, shows breadcrumb "UI Reference (Claude)" (12px) + page title (bold ~20px) with a grey header band 82px tall and two small icon buttons (copy link, open) at its top-right (x1079..1131, white pill, radius 6px-ish). Pane can be hidden via the blue icon at top-right.
- **Results state (query "Projects")**: header row: left label ("Page" blanked/"Pages") 12px/500, right "Best matches v" button x621, 12px/500 `rgb(125,122,117)`, radius 4px, gap 2px. Rows become two-line `role=option` 557x54.8, padding 8px, radius 12px (selected bg `rgba(33,27,23,0.05)`): line 1 = title (14px) + object-type pill (11px/500/lh 14.3px, color `rgb(142,139,134)`, small grey bg pill, margin-left 1px); line 2 = path/snippet 12px/16.8px `rgb(161,158,153)` where the **matching term is highlighted**: span 12px/500, color `rgb(39,131,222)` (blue text, no background). Row pitch ~56px. Preview pane moves up (starts y150).
- Footer hint: none visible (the grid's last row is empty/off-screen at this viewport height).

## 4. Toast - LIGHT
- Trigger: page "..." menu > Copy link -> "Copied page link to clipboard" (also hits the clipboard only).
- Wrapper: `position: fixed; bottom: 24px; inset-inline-start 0; width 100%; z-index 1000000; padding 4px; display flex; pointer-events none`. Toast box: **212.6x43** (auto width) centered horizontally in the full viewport (margin 0 auto), y578 at 649 tall (bottom edge 24+4px from the bottom), bg `rgb(44,44,43)` (`--c-bacAccPri`), text `rgb(240,239,237)`, 14px/400/lh 21px, radius 8px, padding 11px 16px, shadow `rgba(25,25,25,0.05) 0 20px 24px 0, rgba(25,25,25,0.027) 0 5px 8px 0, rgba(42,28,0,0.07) 0 0 0 1px`, transition `transform 0.27s, opacity 0.27s`, enter animation `0.27s snackbar-slide-in-bottom`. Stays visible for roughly 7-9 seconds (still shown ~8s after click in one run, gone by ~9-10s in another).

## 5. DARK pass (Ctrl+Shift+L; verified body.dark, then toggled back: Light, localStorage.theme {"mode":"light"})
Sizes, radii, paddings, transitions are identical to Light. Only colors/shadows changed:

### Sidebar (screenshots/b-sidebar-dark.jpg, b-sidebar-peek-dark.jpg)
- Page bg `rgb(25,25,25)`. Sidebar container bg `rgb(32,32,32)`, edge hairline `box-shadow: rgb(44,44,43) -1px 0 0 0 inset`.
- Selected row bg (on the inner div) `rgba(255,255,255,0.055)`; row hover bg `rgba(255,255,255,0.055)` (same); selected/hovered text `rgb(240,239,237)`, default row text `rgb(188,186,182)`, row icons `rgb(188,186,182)`.
- Home pill bg `rgba(255,255,255,0.055)`, label `rgb(240,239,237)`; Chat/Meetings/Inbox/Search glyphs `rgb(173,169,163)`; unread badge unchanged `rgb(229,100,88)`.
- Switcher name `rgb(240,239,237)`; section header "Private" `rgb(125,122,117)` (hover brighter); "Add new" `rgb(125,122,117)`; Library/Help/Trash text `rgb(188,186,182)`.
- Row hover buttons (+, ...) color `rgb(173,169,163)`, hover bg `rgba(255,255,255,0.055)`.
- Bottom bar: New chat pill bg `rgb(44,44,43)`, text `rgb(188,186,182)`, kbd chip text `rgb(125,122,117)` with transparent bg; shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 4px 12px -2px`. New page button bg `rgb(44,44,43)`, icon `rgb(240,239,237)`, same shadow. "Hot and fresh" button bg `rgb(32,32,32)`, shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 2px 4px 0`.
- Peek panel: bg `rgb(32,32,32)`, radius `0 8px 8px 0`, shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.2) 0 14px 28px -6px, rgba(25,25,25,0.118) 0 2px 4px -1px`.

### Top bar
- Transparent. Breadcrumb text `rgb(240,239,237)`, "Private" label `rgb(125,122,117)`, Share text `rgb(240,239,237)`, Copy link/Favorite svg `rgb(173,169,163)`, More svg `rgb(230,229,227)`, button hover bg `rgba(255,255,255,0.055)`.

### Page menu (screenshots/b-page-menu-dark.jpg)
- Popup bg `rgb(37,37,37)`, radius 10px, shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.2) 0 14px 28px -6px, rgba(25,25,25,0.118) 0 2px 4px -1px`.
- Search input box bg `rgba(252,252,252,0.03)`, unfocused ring `rgba(255,255,235,0.1) 0 0 0 1px` (blue focus ring appears when focused as in Light).
- Row label `rgb(240,239,237)`, icons `rgb(230,229,227)`, shortcut hints and meta text `rgb(125,122,117)`, dividers `rgba(255,255,243,0.082)`, row hover bg `rgba(255,255,255,0.055)`.
- Switch off: track `rgba(202,204,206,0.3)`, knob white. Font tile captions `rgb(173,169,163)`, "Ag" glyphs `rgb(240,239,237)`, selected "Ag" blue `rgb(39,131,222)`.

### Search (screenshots/b-search-empty-dark.jpg, b-search-results-dark.jpg)
- Dialog bg `rgba(32,32,32,0.9)` + blur(40px), shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.64) 0 24px 48px 0, rgba(25,25,25,0.56) 0 4px 12px 0`, radius 20px.
- Input text `rgb(240,239,237)`; chips `rgb(173,169,163)`, "+ Filter" `rgb(125,122,117)`; section header "Today" `rgb(173,169,163)`; selected/hover row bg `rgba(255,255,255,0.055)`; row title `rgb(188,186,182)`; dash `rgb(173,169,163)`; path `rgb(125,122,117)`; row icon `rgb(240,239,237)`; blue icon buttons unchanged `rgb(39,131,222)`; match highlight unchanged `rgb(39,131,222)`; "Best matches" `rgb(173,169,163)`.

### Toast
- bg `rgb(44,44,43)`, text `rgb(240,239,237)`, shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.2) 0 14px 28px -6px, rgba(25,25,25,0.118) 0 2px 4px -1px` (Light toast: bg `rgb(44,44,43)` too, shadow as above in section 4). Screenshot: screenshots/b-toast-light.jpg (no dark toast image; the zoom missed it).

## NOT CAPTURED
- Sidebar resize min/max width (drag and arrow keys don't work through automation).
- Search dialog max-height rule and footer (viewport too short; dialog runs off the bottom at 649px).
- Search open/close animation (appears instantly; no measurable transition other than height/width 0.2s).
- Real "type pill" text in search results (blanking overwrote it).
- Dark: toast screenshot, page-menu bottom, tooltip colors.
