# (c) Page and blocks — measured 2026-10-12, viewport 1300x649 DPR1, Light first
Default font stack (DEF): `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Helvetica, "Apple Color Emoji", "Noto Sans Arabic", "Noto Sans Hebrew", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"`. Base text color Light `rgb(44,44,43)`, base 16px/24px.
(Screenshot saved format is actually PNG/JPEG as noted by extension.)

## 1. Cover and icon (Light)
Screenshots: screenshots/c-cover-hover-light.jpg (full), c-cover-buttons-light.png (zoom).
### Page scaffold (DOM nesting)
`.notion-scroller.vertical` (1030 wide incl. 15px scrollbar) > `div.whenContentEditable` > `div.layout` (display:grid, padding-bottom 194.7px(=30% of cover height? it is 0 0 194.7px), transition transform .2s) > cover `div.layout-full` (1015x194.7 at x=270,y=44) and `div.layout-content`.
- `.layout` grid-template-columns: `[full-start] 147.5px [content-start] 720px [content-end] 147.5px [full-end]` at 1015px frame width (i.e. content column 720px, centered, side gutters = (1015-720)/2, min ~96px).
- Content column x=418, width 720.
### Cover
- `div.layout-full`, full-bleed across the whole frame width (1015 here = scroll area minus scrollbar), height 194.7px (viewport-based: ~30vh of 649 = 194.7). Image element uses object-fit cover (default gradient cover here: pink/red gradient `rgb(255,45,85)`-ish).
- Cover hover buttons container: wrapper `position:absolute; top:12px; right:12px; transition: opacity .2s` (fades in on cover hover). Inner pill: `bg rgb(255,255,255); border-radius 6px; padding 2px; display flex; height 28px; width 168.8 (Change 54 | divider | Reposition 68.7 | divider | download-icon btn)`; box-shadow `rgba(25,25,25,.027) 0 8px 12px, rgba(25,25,25,.027) 0 2px 6px, rgba(42,28,0,.07) 0 0 0 1px`.
- Each button: 24px high, `padding 0 6px; border-radius 4px; font 14px/16.8px weight 400; color rgb(142,139,134); transition background .1s ease-in-out; cursor pointer`. Labels shown: "Change cover" collapses to "Change" at this width (text "Change", "Reposition"); then a download-like icon button.
- Dividers: 1px x 16px, radius 2px, margin 0 4px.
### Icon
- `div.notion-record-icon` (button-like, cursor pointer, border-radius 4px, `transition: background .02s ease-in`, `margin: -42px 0 0 8px`, position relative): box **78x78**, emoji font-size **78px**, line-height 78px. x=426 (=content left 418 + 8), y=197 -> **overlaps the cover bottom edge (y=238.7) by 42px** (36px of icon below the cover). Icon bottom y=275.
- Icon hover: no background change measured on `.notion-record-icon` (rgba(0,0,0,0)), cursor pointer.
### Page controls bar ("Add comment") – page WITH cover+icon
- `div.notion-page-controls` x=417,y=275, 721x40, `padding 8px 0 4px; margin-left -1px; display flex; color rgb(161,158,153)`.
- Button "Add comment": 122.4x28, `padding 0 8px; border-radius 6px; font 14px/16.8px 400; color rgb(161,158,153); transition opacity .1s`; icon svg 14x14, fill rgb(161,158,153). Hover bg = `color(srgb .1294 .1059 .0902 / .051)` (rgba(33,27,23,.051)), text color unchanged.
- Title block starts y=315 (controls end 315).

### Page WITHOUT icon/cover (Clients full-page DB) — "Add icon / Add cover / Add description" bar
Screenshot: screenshots/c-add-icon-cover-bar-light.png (zoom, with the first button hovered).
- Bar `div.notion-page-controls`: x=365 (=content-left 366 -1), y=44 (frame top, no cover), 935x36 (spans to right edge), `padding 4px 0` (page with a cover+icon has `padding 8px 0 4px`), margin-left -1px, flex, color rgb(161,158,153), opacity 1 when hovering the title zone (fades in on hover of the header area; otherwise opacity 0 + transition opacity .1s).
- Buttons ("Add icon" 90.5w, "Add cover" 99w, "Add description" 132.5w; in a normal doc page it's "Add icon / Add cover / Add comment"): each 28px high, `padding 0 8px; border-radius 6px; font 14px/16.8px 400; color rgb(161,158,153); transition opacity .1s; cursor pointer`; leading svg icon 14x14, fill rgb(161,158,153). Hover bg `color(srgb .1294 .1059 .0902 / .051)` (rgba(33,27,23,.051)); text unchanged.
- Without icon+cover, DB-page title h1 at y=80 right under the bar (bar 44..80): `h1.content-editable-leaf-rtl`, **32px/38.4px, weight 700, color rgb(44,44,43), padding 0 8px**, wrapper has `padding-right 96px; margin 0 0 8px`. NOTE: full-page DB title is 32px, not the 40px/48px doc-page title. Content x=366 (frame 270 + 96px padding), title wrapper width 919.

## 2. Title (doc page, Light)
- `div.notion-selectable.notion-page-block` (flex) > `h1.content-editable-leaf-rtl.notranslate`. Frame content x=418, **720 wide**.
- h1: **40px / 48px, weight 700, letter-spacing normal, color rgb(44,44,43), padding 0 8px**. Block box 720x48. No margin; position: y=315 (page-controls 275..315 sits above it; icon above that). Title bottom y=363; `.notion-page-content` starts y=371 with `padding-top 8px`... i.e. title→first-block text: first paragraph block y=378.7 (page-content y=371 + 8 padding? measured block top 378.7, text 6px below).
- Full-page DB title is smaller: 32px/38.4px (see Clients above).

## 4a. Block spacing model (Light; identical in Dark)
`.notion-page-content` = 720x? `padding 8px 0 0`; flex column. Blocks `.notion-selectable.notion-<type>-block` have **no margin/padding themselves**; spacing is padding on an inner wrapper; the editable leaf `[contenteditable]` (`content-editable-leaf-rtl notranslate`) has `padding 2px` (lists: `2px 0`), so leaf height = 24 + 4 = 28px for 16px text.
| block | wrapper padding (top/bottom) | leaf font | block h |
| paragraph `notion-text-block` | 6px / 6px | 16px/24px w400 | 40 |
| H1 `notion-header-block` | 30px / 6px | **30px/39px w600** (leaf 43h) | 79 |
| H2 `notion-sub_header-block` | 26px / 6px | **24px/31.2px w600** (leaf 35.2h) | 67.2 |
| H3 `notion-sub_sub_header-block` | 22px / 6px | **20px/26px w600** (leaf 30h) | 58 |
| list item bullet/numbered/to-do | 1px / 1px (first item after a non-list block: 6px top; last 1px) | 16px/24px w400 | 30 |
| callout | leaf is 28.5px from top, 29.5 from bottom (see callout) | | 82 |
| quote | 8px / 8px | | 40 |
| code | 8px / 8px | | 149.2 |
| divider | | | 13 |
| column_list | 18px inner? (topToLeaf 18) | | 64 |
- Gap between consecutive blocks is 0 (bounding boxes touch: gapPrev=0.0). Visual gap = bottom wrapper padding of A + top wrapper padding of B: paragraph->paragraph = 12px between texts' leaf edges (6+6) + the 2px leaf paddings; paragraph->H1 = 6+30; H1->H2 = 6+26; list->list = 1+1 (=2px between 28px leaves, 30px pitch).
- All heading/text colors rgb(44,44,43). Headings have the same 600 weight; H1 30px (NOT 32), H2 24px, H3 20px, letter-spacing normal.

## 4b. Block specifics (Light). Text leaf = `div.content-editable-leaf-rtl.notranslate[data-content-editable-leaf]`
Screenshots: c-lists-todo-light.png, c-code-quote-callout-light.jpg (also shows block handle gutter).
Frame x of the block column = 418 (417.5); wrapper inside block: `padding 6px 6px` (paragraph) -> leaf at x=424+... ; leaf padding 2px. Text left edge in paragraph = 424.
### Bulleted list
- block > wrapper `padding 6px 6px 1px` (1px/1px between list items) > flex row `padding-left 2px` > `div.notion-list-item-box-left` **24x28, padding 2px 0, flex** > `div.pseudoBefore` 8.4x24, **::before content "•", font-size 24px, color rgb(44,44,43)** (bullet glyph centered in the 24px box; glyph x=433..441, box x=426) > text leaf starting x=450 (box 426+24; leaf padding 2px 0).
- Nested item: child block x = parent leaf x => **indent 32px per level** (block x 417.5 -> 449.5 -> 481.5).
### Numbered list
- Same structure; box 24x28 (`padding 2px 0`), `span.pseudoBefore` 24x24 content `"1."`, 16px, same color; text leaf x=450 (same as bullet). Numbers are right-aligned inside 24px box ("1." width fits).
### To-do
- Same row; box-left 24x28; checkbox element `div` **16x16 at box+4px (x=430), radius 1.5px, transition background .2s ease-out**, centered vertically (y offset 6px).
  - Unchecked: bg transparent, **border 1px solid rgb(56,56,54)**.
  - Checked: **bg rgb(39,131,222) (#2783DE), no border**, white svg `checkmarkFillSmall` 14x14 at +1px (path 9.2x9.1), fill #fff.
  - Text leaf `padding 2px 0 2px 6px`. Checked text: leaf `opacity 0.7`, `text-decoration line-through` with decoration color `rgba(44,44,43,0.5)`, text color unchanged rgb(44,44,43).
### Toggle
- Same row; box contains `div` 24x24 (radius 4px, hover bg transition .02s ease-in, cursor pointer) with svg `arrowCaretDownFillSmall` **12.8x12.8**, fill rgb(44,44,43), `transition: transform .2s ease-out`. **Open: transform identity (caret points down); closed: matrix(0,-1,1,0,0,0) = rotate(-90deg) (points right).** Child block x = parent leaf x, i.e. **indent 32px**. Toggle block `padding 1px 6px`; open toggle h=70 (28 title + children).
### Callout
- Block h=82: wrapper padding 8px (block 418..1138; box x=426..1130, 704w, y inset 8px). Box: **bg rgb(249,248,247), border 1px solid transparent, radius 10px, padding 12px, flex, height 66 (1+12+40+12+1)**.
- Icon: box 24x24 at x=439 (426+1+12), `margin-top 7.5px`; emoji img `img.notion-emoji` **16.8px** (this fixture's icon is a grey/orange compass); then the inner text block starts right at 463 (no gap) with its own `padding 6px`, leaf padding 2px -> text x=469. Text 16px/24px color rgb(44,44,43).
### Quote
- Block h=40 (padding 8px top/bottom); `blockquote` flex; inner `div` **border-left 3px solid rgb(44,44,43), padding 0 14px**; leaf `padding 0 8px`?? (text x=443+). Font **16px/24px weight 400, color rgb(44,44,43)** (same as body, not larger).
### Divider
- Block h=13 (6px above, 6px below the line); inner flex `padding 0 8px`; line `div` 704x1, **bg rgba(28,19,1,0.11)**, no border. Block y 340.3, line y 346.3.
### Code
- Block h=149.2 (8px wrapper padding); box 704x133 at x=426: **bg rgba(66,35,3,0.03), radius 10px, inner padding 24px 22px**; leaf `font-family SFMono-Regular, Menlo, Consolas, "PT Mono", "Liberation Mono", Courier, monospace; font-size 13.6px; line-height 20.4px; weight 400; white-space pre; tab-size 2; color rgb(44,44,43)`; line-numbers container padding 12px 0 (x=448). Text left edge x=448.
- Syntax token colors (Prism "default" like): keyword (`function`, `return`) **rgb(0,119,170)**; function name (`greet`) **rgb(221,74,104)**; punctuation `( ) { } ;` **rgb(153,153,153)**; string/template **rgb(102,153,0)**; plain identifiers rgb(44,44,43). Comment: not present in fixture (Prism default would be slategray rgb(112,128,144) — not measured).
- Hover toolbar (top-right, appears on block hover): `position` inside box, at x=957,y=258 (box top+4, right ~4), pill **168.9x28, bg #fff, radius 6px, padding 2px, same 3-layer shadow as the cover buttons** (`rgba(25,25,25,.027) 0 8px 12px, rgba(25,25,25,.027) 0 2px 6px, rgba(42,28,0,.07) 0 0 0 1px`). Buttons 24px high, radius 4px, color rgb(142,139,134), transition background .1s ease-in-out: language selector "JavaScript ▾" (83.9w, padding 0 6px, 14px/16.8px, caret svg 9.9px), then three 24x24 icon buttons: Copy (svg 13.25), Wrap (12.05), More "…" (12.16).
### Image
- Block `padding 8px`, 704 wide image area (x=426), height 469.9 for this 704px-wide image (aspect from the photo); wrapper `border-radius 10px` clips the image (radius **10px**); no caption in fixture. (Hover controls: see below.)
#### Image hover controls (screenshots/c-image-hover-light.jpg)
- Toolbar `div` position absolute, 224.6x28 at x=901,y=107 (image box top+4, right edge 4px inside), pill same white/radius 6px/shadow as the code toolbar, `transition opacity .2s`. Buttons (24px high, radius 4px, color rgb(142,139,134)): "Ask AI" (63.6w, sparkle svg 11.6) | divider | comment (28w, svg 16) | align/fit icon (24, 12.4) | caption (24, 11) | zoom/full-view (24, 12.5) | download (24, 10) | more "…" (24, 12.2).
- Resize handles on hover at left/right edge: `div` **6x48, bg rgba(15,15,15,0.6), border 1px solid rgba(255,255,255,0.9), radius 20px**, `transition opacity .2s ease-in-out`, x=430 (image left 426 +4) and x=1119, vertically centered (y=314 of image 103..573).
- Block handle (+, ⋮⋮) at x=378 / 399 appears for image too, aligned near top (y=115, image top 103).

### Simple table (screenshots/c-table-columns-mentions-subpages-light.jpg)
- `div.notion-table-block` is full-bleed (x=270,w=1015, `padding 8px`; scroll container), real `table` is 720x106 at x=432 (left offset 14px from content x=418: 8px block padding + 6px), `border-collapse: collapse`, 3 equal columns (239.7px each at 720 total; column min width not measured), rows 35px (34 + 1 collapsed border).
- Cells `td`/`th`: **border 1px solid rgb(230,229,227)** (all sides collapsed), `th` header-row **bg rgb(247,246,243), font-weight 500**; body `td` no bg, weight 400. Cell text leaf `div.notion-table-cell-text`: **font-size 14px / line-height 20px, padding 7px 9px**, color rgb(44,44,43) (note: smaller than body 16px).
### Two columns
- `.notion-column_list-block` 720x64 at x=418: padding-block 12px (columns at y+12). Two `.notion-column-block` each **337px** wide (flex 0 1 auto), left at x=418 and 801; the **gap between columns is 46px** (23px on each side of the divider area; spacer/resize elements; wrapper has `transition padding .2s linear`). Column text blocks have normal 6px paragraph padding.
### Mentions (paragraph "Mentions: date @Today  page Projects")
- Date mention: `span.notion-text-mention-token` color **rgb(125,122,117)**, no underline, no bg/padding, 16px/24px weight 400; the leading "@" is a separate span at 60% alpha `rgba(125,122,117,.6)`; the date text in `span.notion-reminder`. (Not clickable-looking; cursor pointer.)
- Page mention: `a.notion-page-mention-token` inline, color rgb(44,44,43), `box-shadow rgba(148,148,148,0) 0 0 0 3px` (transition .1s ease-in), cursor pointer; icon `span` 20x20 inline-block `margin-right 8px` (here the page icon is a "view table" svg 20x20 fill rgb(142,139,134) with an arrow-diagonal 16x16 badge since it's a linked view); title span **font-weight 500, text-decoration underline 0.8px, underline-offset 10%, decoration color rgba(55,53,47,0.25)**.
### Sub-page link blocks (Projects/Clients/Empty DB) (screenshots/c-subpage-link-hover-light.png)
- Block `.notion-collection_view-block` wrapper `padding 6px 6px 1px` (first), 1px/1px next; h=35 then 30. `a` full-row **radius 4px, hover bg rgba(33,27,23,.051)** (`transition background .02s ease-in`), flex row, leading icon box **24x24** (margin-right 4px) with table svg **22x22 fill rgb(142,139,134)** (database icon; pages use emoji/doc icon in the same 24 box), title `div.notranslate` **16px/20.8px weight 500**, **border-bottom 1px solid rgba(28,19,1,0.11)** (the "underline"), color rgb(44,44,43).

### Inline styles (paragraph "bold italic code link red highlight end"; spans inside the leaf)
| style | measured |
| bold | `font-weight 600` |
| italic | `font-style italic` (weight 400) |
| inline code | `span`: font-family SFMono-Regular, Menlo, Consolas, "PT Mono", "Liberation Mono", Courier, monospace; **font-size 13.6px (0.85em)**; **color rgb(207,81,72)**; **bg rgba(33,27,23,0.05)**; **radius 4px**; **padding 2.72px 5.44px (0.2em 0.4em)**; line-height normal |
| link | `a` wrapper (cursor pointer, color inherited rgb(44,44,43)); inner span **opacity 0.7, text-decoration underline 0.8px, underline-offset 10%, decoration color rgba(55,53,47,0.4)** (so link looks gray-ish; NOT blue) |
| red text color | span `color rgb(207,81,72)` |
| yellow highlight | span `background rgba(211,168,0,0.137)`, text color unchanged, radius 0 |

## 5. Block handle (+ and ⋮⋮) — Light (screenshots/c-block-handle-tooltip-light.png, c-block-menu-color-light.jpg)
- Appear in the left gutter on block hover. **+ add button** `div.notion-block-add-button` **24x24**, x=365.5 (= block x 417.5 - 52), radius 4px, cursor pointer, `transition background .02s ease-in`; aria "Click to add below. Alt-click to add a block above". **⋮⋮ drag handle** `div[aria-label="Drag to move, click to open menu"]` **18x24**, x=389.5 (=block x - 28; right edge 407.5, i.e. 10px left of block edge/16 from text), radius 4px, cursor **grab**. Both contain a 20x20 svg, **fill rgb(173,169,163)**. Hover bg of each button: **rgba(33,27,23,0.051)**.
- Vertical: both buttons are 24px tall and **vertically centred on the first text line** of the block: paragraph y=308.3 (leaf 306+14=320 centre); H1 handle top = leaf-top+9.6 (centre on 43px leaf: 332.5); H2 top 391.6 (leaf centre 403.5); H3 top 452.3 (centre 464). For non-text blocks (code, image) they sit near the top (image: y=115 for image top 103; code: y=266 centre for box top 254).
- Tooltip (dark, below button, ~6px gap): `bg rgb(44,44,43); color rgb(240,239,237); font 12px/16.8px; radius 6px; padding 5px 8px; max-width 300; box-shadow rgba(0,0,0,.08) 0 4px 12px -2px, rgba(255,255,255,.05) 0 0 0 1px inset`. Text for ⋮⋮: "Drag to move" / "Click or ctrl/⌘ to open menu" (first part lighter weight/colour). For +: "Click to add below / Alt-click to add a block above".
## Block action menu (click ⋮⋮)
- Opens as a popup **to the left of the handle** (x=120..385 here, since right-hand room is limited; it is placed beside the handle and flips): size **265 x ~418 (viewport-clamped)**, `bg #fff; radius 10px; box-shadow rgba(25,25,25,.05) 0 20px 24px, rgba(25,25,25,.027) 0 5px 8px, rgba(42,28,0,.07) 0 0 0 1px; overflow hidden`. The block gets a blue selection overlay (rgba(35,131,226,.14)-like) while the menu is open.
- Top: search input `Search actions…` 229x20 at (138,183), `font 14px/20px`, container has bg rgb(247,246,243)-ish and a focus ring (blue outline when focused). Section header "Text": `12px/14.4px weight 500, color rgb(125,122,117), padding 0 8px, margin 6px 0 8px`.
- Rows (outer `div`): **242x28, radius 6px, hover bg rgba(33,27,23,0.051), `transition background .02s ease-in`**; inner flex `padding 0 8px; gap 8px`; **icon 20x20 fill rgb(56,56,54)**; label 14px/16.8px weight 400 rgb(44,44,43); shortcut hint right-aligned 12px/16.8px color rgb(161,158,153). Separators 226x1 `bg rgba(42,28,0,0.07)` with ~6px margins. Items in order: Turn into ›, Color › | Copy link to block (Alt+⇧+L), Duplicate (Ctrl+D), Move to (Ctrl+⇧+P), Delete (Del) | Comment (Ctrl+⇧+M), Suggest edits (Ctrl+⇧+Alt+X) | Ask AI (Ctrl+J), Skills › | footer "Last edited by <name>" `12px/16px color rgb(161,158,153) margin 4px 0`. Rows with submenu show a right chevron.
- **Color flyout** (hover "Color", opens at right of menu, x=366..585, y=85..~500): same white card, radius 10px, shadow same; header labels "Last used", "Text color", "Background color": 12px weight 500 color rgb(125,122,117); rows **197x28** radius 6px (hover bg rgba(33,27,23,.051)), inner padding 0 8px gap 8px; swatch tile **26x26, radius 6px, `box-shadow rgba(28,19,1,0.11) 0 0 0 1px inset`, padding 8px, flex, font 16px weight 500** containing "A" (text colors) or filled bg (bg colors). "Last used" row shows e.g. "Yellow background" with shortcut Ctrl+⇧+H. Scrollable list with scrollbar.
### Colors (Light) — name: text-A colour / background tile colour
| name | text color | background color |
| Default | rgb(44,44,43) | transparent/white (tile white, border only) |
| Gray | rgb(125,122,117) | rgb(240,239,237) |
| Brown | rgb(159,118,90) | rgb(245,237,233) |
| Orange | rgb(210,123,45) | rgb(251,235,222) |
| Yellow | rgb(203,148,52) | rgb(249,243,220) |
| Green | rgb(80,148,110) | rgb(232,241,236) |
| Blue | rgb(56,125,201) | rgb(229,242,252) |
| Purple | rgb(154,107,180) | rgb(243,235,249) |
| Pink | rgb(193,76,138) | rgb(250,233,241) |
| Red | rgb(207,81,72) | rgb(252,233,231) |
(Screenshots: c-block-menu-color-light.jpg shows Last used + text colors, c-color-menu-backgrounds-light.jpg shows background colors.)

## 7. Text-selection formatting toolbar — Light
Screenshots: c-selection-toolbar-light.jpg (default), c-selection-toolbar-bold-light.jpg (bold active, card placed ABOVE the selection), c-selection-color-menu-light.jpg.
NOTE: in this Notion build the selection toolbar is NOT a horizontal bar; it is a **vertical floating card** (opens on double-click of a word; no "Ask AI / Text ▾" bar).
- Card: **192 x 323**, `bg #fff; border-radius 14px; padding 8px; box-shadow rgba(25,25,25,.05) 0 20px 24px, rgba(25,25,25,.027) 0 5px 8px, rgba(42,28,0,.07) 0 0 0 1px`; text 14px/16.8px. Placed above the selection (bottom of card ~25px above the word, left edge near the word's x - ~-ish) or, when no room above, beside it (right).
- Row 1 "Normal Text ›" (turn-into): 176x28, `padding 0 8px 0 6px; gap 8px`, T icon 20px, chevron right; radius 6px, hover bg rgba(33,27,23,.051) (same row pattern as menus).
- Divider 160x1 `rgba(42,28,0,.07)` (x inset 12 from card edge) between sections (at y=100, 169, 206 in the card).
- Row 2 (5 buttons, each **32x28, radius 6px**, gap 4px): **A (color)** [20x20 tile inside, `border-radius 6px, inset 0 0 0 1px rgba(28,19,1,.11)`, 12px weight 500 "A"], **B**, *I*, U, Tx (clear formatting, 28w). Icons 20x20 fill rgb(56,56,54). **Active (B when bold selected): icon colour rgb(39,131,222)**, no bg.
- Row 3 (5 buttons 32x28): link, strikethrough, code `</>`, equation √x, more "…".
- Row 4: **"Comment"** (108x28, icon 14.9 + label 14px color rgb(56,56,54), radius 6px, padding 0 6px, transition background .02s ease-in) + emoji-reaction icon button + suggest-edit icon button (32x28).
- Divider, then **"Skills"** header (161x28, 12px/14.4px color rgb(125,122,117), `padding 0 4px 0 8px`, with a settings/sliders icon right) and scrollable list "Improve writing / Proofread / Explain / Reformat…" rows 28px pitch, 14px, hover bg rgba(33,27,23,.051); then an input box "Edit with AI" placeholder (color rgb(161,158,153)) with hint "Alt+⇧+E" at right. (Dismiss AI offers with Escape; nothing clicked.)
### Color menu (A button) — popover below the card
- Popover x=728,y=137, **190 x 278**, `bg #fff, radius 10px, big menu shadow` (same as above), padding 12.  Sections: "Recently used" (12px/14.4 weight 500 rgb(125,122,117)), "Text color", "Background color". 
- Swatch grid: cells **30x30 (pitch 34 → gap 4px)** x 5 columns; inside each a **26x26 tile** (inset 2px), radius 6px, `box-shadow rgba(28,19,1,.11) 0 0 0 1px inset`, text tiles show "A" in the color, bg tiles show the fill. Selected (default) swatch has a dark 2px ring (rgb(44,44,43)). Order: Default, Gray, Brown, Orange, Yellow / Green, Blue, Purple, Pink, Red. Colors identical to the table in section 5 (Light). "Recently used" row shows up to 5 last tiles (yellow bg, green bg, red A, red bg).

## 6. Slash menu — Light (screenshots/c-slash-menu-light.jpg, c-slash-menu-filtered-light.jpg)
- Trigger: `/` on an empty paragraph. The caret line shows `/` + a placeholder chip "Type to search" (grey) beside it; once you type, `/head` is shown as plain text with a faint chip bg.
- Menu card: **324 x 238.8** (fixed height: scrolling list + footer), `bg #fff; radius 10px; box-shadow rgba(25,25,25,.05) 0 20px 24px, rgba(25,25,25,.027) 0 5px 8px, rgba(42,28,0,.07) 0 0 0 1px`. Left edge x=419 = caret line x (424) - 5 approx (i.e. aligned to block's left edge +1). Opens BELOW the line when room, otherwise flips ABOVE (here flipped: bottom at 416 vs caret line at y≈412-430, 6px gap).
- Section headers ("Suggested", "Basic blocks", "Filtered results" when filtered): `12px/14.4px weight 500, color rgb(125,122,117), padding 0 8px, margin 6px 0 8px`, in a 301px-wide list column at x=423 (card padding 4px).
- Rows: **301x32 (x=423), radius 6px, selected/hover bg rgba(33,27,23,0.051), `transition background .02s ease-in`**; inner `padding 0 8px; gap 8px`; **icon 20x20 plain svg (NO tile/box), fill rgb(56,56,54)**; label 14px/16.8px weight 400 rgb(44,44,43); secondary text after the label, separated by " · ": 14px color rgb(161,158,153) (e.g. "HTML · Embeds", "Linked view of data source · Database", "Heading 1 · Turn into"); "New" badge on new items (blue chip, 14px/21px weight 500, 44x28 box incl. paddings — text color light blue-ish on blue bg). Row pitch 32px (first row y=212, next 244...).
- Right keyboard hint on rows that have a markdown shortcut: `12px/16.8px, color rgb(161,158,153), padding 0 2px 0 0`, right aligned at x≈716 (e.g. "#", "##", "###", "####").
- List is scrollable (thin scrollbar, up/down arrow stubs at 735,187 and 735,363; the bottom/top rows fade).
- Divider between groups inside list: 1px rgba(42,28,0,.07) with ~8px margin (visible at y=352).
- **Footer** (fixed bottom, 316x32 at x=423,y=380, `border-top` 1px, `padding 0 8px`): "Close menu" 14px/16.8 rgb(44,44,43) at left, **"esc" hint 12px color rgb(161,158,153)** at right (x=712..731). Footer text is "Close menu / esc" (not "Type '/' on the page").
- Selected row: first row auto-selected (arrow keys move; Enter inserts).
- Filter `/head`: header becomes "Filtered results"; rows: Heading 1 (#), Heading 1 · Turn into, Heading 2 (##), Heading 3 (###), Heading 4 (####)…

## 8. Placeholder text — Light (screenshots/c-placeholder-empty-paragraph-light.png)
- Empty focused paragraph: leaf `div.content-editable-leaf-rtl[placeholder]` renders the placeholder through `::after { content: attr(placeholder) }`; **text "Press ‘space’ for AI or ‘/’ for commands"** (in this build; typographic quotes), **color via `-webkit-text-fill-color: rgba(21,14,0,0.286)`** (pseudo's `color` stays rgb(44,44,43)), same 16px/24px as the paragraph. Shown only when the block is focused/empty. Empty page title placeholder = "New page" (same fill colour, 40px).
- Empty H1 (created via `# `): placeholder text "Heading 1" (H2 "Heading 2", H3 "Heading 3" by the same mechanism), same `-webkit-text-fill-color rgba(21,14,0,0.286)`, rendered in the heading's own 30px/600 (screenshots/c-placeholder-heading1-light.jpg). Temporary blocks created for placeholder/slash tests were deleted (page block count restored to 29).

## 3. Page width and fonts — Light
Page ⋯ menu (screenshots/c-page-menu-fonts-toggles-light.jpg): font tiles "Ag Default / Serif / Mono" at the top (Default tile selected in blue), then Copy link, Copy page contents, Duplicate, Move to, Move to Trash | **Small text** (toggle), **Full width** (toggle), Customize page | Lock page (toggle), Use with AI ›, Suggest edits...
Note: cover height = **30vh** (194.7px at 649px viewport; 179px at 597).
### Normal (default) width
- `.layout` grid `[full-start] 147.5px [content-start] 720px [content-end] 147.5px [full-end]` at frame inner width 1015 → content column **720px**, centered; `.notion-page-content` x=418 w=720, `padding-top 8px`; title and blocks fill the 720 column (title h1 padding 0 8px → text x=426). Page-content has no horizontal padding; the 96px min gutter applies on narrow viewports (`minmax(96px,1fr)`).
### Full width ON (screenshots/c-full-width-toc-light.jpg)
- `.layout` grid becomes `[full-start] 96px [content-start] 823px [content-end] 96px [full-end]` (frame inner 1015 → content = 1015-2*96 = **823px, gutters 96px**). Page-content x=366, w=823. Title/icon shift left accordingly (icon x=374). Cover unchanged (full-bleed).
### Table-of-contents outline (right margin, appears on hover at the right edge; visible when mouse is near x≈1250)
- Collapsed: small right-aligned dashes at x≈1250..1265 (one per heading, widths vary with level; the active one darker).
- Expanded card: **232 x 110.7**, `bg #fff; radius 14px; padding 12px 12px 0; margin 0 10px 0 0; big shadow (rgba(25,25,25,.05) 0 20px 24px, rgba(25,25,25,.027) 0 5px 8px, rgba(42,28,0,.07) 0 0 0 1px)`. Items `span.notranslate` **13px/16.9px weight 400**, rows pitch 25px, indent 12px per level (H1 x=1065, H2 1077, H3 1089); **active heading color rgb(39,131,222)**, others rgb(125,122,117).
### Small text ON (screenshots/c-small-text-light.jpg) — everything scales x0.875, widths unchanged (content column still 720)
| element | default | small text |
| page title h1 | 40px/48px | **32px/38.4px** |
| paragraph / list / to-do / quote / callout leaf | 16px/24px | **14px/21px** |
| H1 | 30px/39px | **26.25px/34.125px** (wrapper padding stays 30/6) |
| H2 | 24px/31.2px | **21px/27.3px** (padding 26/6) |
| H3 | 20px/26px | **17.5px/22.75px** (padding 22/6) |
| code block text | 13.6px/20.4px | **11.9px/17.85px** |
| table cell text | 14px/20px | **12px/20px** (header weight 500) |
Block heights shrink accordingly (paragraph 40→37, list item 30→27... leaf 2px padding + wrapper padding unchanged). Icon (78px) and cover unchanged.
### Font tiles (screenshots/c-font-serif-light.jpg, c-font-mono-light.jpg). Title stays 40px/48px in all.
| font | font-family | body | H1 | H2 | H3 | code block | table cell |
| Default | DEF (ui-sans-serif … ) | 16px/24px | 30px/39px | 24px/31.2px | 20px/26px | 13.6px/20.4px mono (SFMono…) | 14px/20px |
| Serif | `Lyon-Text, Georgia, ui-serif, serif` | **17px/27.2px** | 31.875px/41.4375px | 25.5px/33.15px | 21.25px/27.625px | **14.45px/23.12px** (stays SFMono-Regular, Menlo… mono) | 15px/20px |
| Mono | `iawriter-mono, Nitti, Menlo, Courier, monospace` | **15px/24px** | 28.125px/36.5625px | 22.5px/29.25px | 18.75px/24.375px | **12.75px/20.4px** (SFMono stack) | 13px/20px |
(Serif scales fonts x1.0625 w/ line-height 1.6; Mono x0.9375.) Weights unchanged (headings 600, title 700). All page settings were reset: Default font, Small text off, Full width off (verified: grid back to 147.5/720/147.5, body 16px).

# DARK pass (Ctrl+Shift+L; body bg rgb(25,25,25), frame bg rgb(25,25,25)). Sizes/positions identical to Light; only colors/shadows below.
Screenshots: c-cover-hover-dark.jpg, c-add-comment-hover-dark.png, c-lists-todo-callout-dark.jpg, c-code-hover-dark.jpg (+ more below).
## Dark: text / blocks
- Text color everywhere (title, paragraphs, H1-H3, list text, quote, callout text, bullet glyph, numbers, toggle caret, sub-page link text): **rgb(240,239,237)** (Light was rgb(44,44,43)).
- Callout box bg **rgb(56,56,54)** (border 1px transparent, radius 10px, padding 12px unchanged). Quote bar: 3px solid **rgb(240,239,237)**. Divider line: **rgba(255,255,235,0.1)**.
- To-do: checked box bg rgb(39,131,222) (same blue) + white checkmark; **unchecked border 1px solid rgb(230,229,227)** (Light rgb(56,56,54)); checked text opacity 0.7, line-through color `rgba(240,239,237,0.5)`.
- Code block bg **rgba(252,252,252,0.03)** (radius 10px, same padding); text rgb(240,239,237). Tokens: keyword (`function`,`return`) **rgb(102,162,204)**; function name (`greet`) **rgb(236,236,147)**; string/template **rgb(189,224,82)**; punctuation lighter grey (~rgb(153,153,153) unchanged? shown mid-grey) ; plain rgb(240,239,237).
- Code/image hover toolbar pill: **bg rgb(32,32,32)**, shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,.08) 0 4px 12px -2px` (same on the cover "Change/Reposition" pill), buttons icon/text color rgb(142,139,134) unchanged. Image resize handles unchanged (rgba(15,15,15,.6) bg, 1px rgba(255,255,255,.9) border).
- Cover "Change/Reposition" pill dark: bg rgb(32,32,32) + same shadow above, text rgb(142,139,134).
- Add comment bar dark: color/icon **rgb(125,122,117)**, hover bg **rgba(255,255,255,0.055)**.
- Table: header cell bg **rgba(255,255,255,0.03)**, all borders **1px solid rgb(56,56,54)**, body cells transparent.
- Inline: inline code color rgb(207,81,72) (unchanged), bg **rgba(255,255,255,0.055)**; link span color rgb(240,239,237), opacity .7, underline decoration color **rgba(255,255,255,0.282)**; red text rgb(207,81,72) (unchanged); yellow highlight bg **rgba(255,205,75,0.24)**, text rgb(240,239,237).
- Date mention color **rgb(173,169,163)**; page mention text rgb(240,239,237), mention icon fill rgb(173,169,163); mention/sub-page underline decoration color in dark ≈ rgba(255,255,255,0.28)-ish (measured transiently rgb(55,55,55)).
## Dark: block handle + block menu + color flyout (screenshots/c-block-menu-dark.jpg, c-block-menu-color-dark.jpg, c-color-menu-backgrounds-dark.jpg)
- +/⋮⋮ icons: **fill rgb(125,122,117)** (Light rgb(173,169,163)); hover bg **rgba(255,255,255,0.055)**. Tooltip identical to Light (bg rgb(44,44,43), text rgb(240,239,237), shadow `rgba(0,0,0,.08) 0 4px 12px -2px, rgba(255,255,255,.05) 0 0 0 1px inset`) — note: in Dark the tooltip is the same grey as the dark page bg-ish surface.
- Selected-block overlay while menu open: dark-blue tint (~rgba(45,150,255,.15)) (row visible at y=302..338 in screenshot).
- Menu card: **bg rgb(37,37,37)**, **box-shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,.2) 0 14px 28px -6px, rgba(25,25,25,.118) 0 2px 4px -1px`** (Light uses the 3-layer rgba(25,25,25,.05) 0 20px 24px / .027 0 5px 8px / rgba(42,28,0,.07) ring). Radius 10px same.
- Search input: transparent on a parent with **bg rgba(252,252,252,0.03)**; text rgb(240,239,237); focus ring blue.
- Section header "Text": **rgb(173,169,163)**; row label **rgb(240,239,237)**; row icon fill **rgb(230,229,227)**; shortcut hint & footer **rgb(125,122,117)**; separators **rgba(255,255,243,0.082)**; row hover bg **rgba(255,255,255,0.055)**.
- Color flyout: **bg rgb(37,37,37)**, same dark shadow as menu; headers "Last used/Text color/Background color" rgb(173,169,163). Swatch tile ring `box-shadow` is a per-color translucent inset 1px: default/gray `rgba(255,255,235,0.1)`, brown `rgba(255,177,129,.192)`, orange `rgba(255,147,75,.28)`, yellow `rgba(255,205,75,.24)`, green `rgba(108,255,172,.157)`, blue `rgba(67,155,255,.24)`, purple `rgba(200,125,255,.2)`, pink `rgba(255,103,177,.23)`, red `rgba(255,104,92,.24)`.
### Colors (Dark)
| name | text A color | background |
| Default | rgb(240,239,237) | transparent (tile bg of page = rgb(25,25,25)) |
| Gray | rgb(125,122,117) | rgb(56,56,54) |
| Brown | rgb(159,118,90) | rgb(69,54,45) |
| Orange | rgb(210,123,45) | rgb(83,54,31) |
| Yellow | rgb(203,148,52) | rgb(80,68,37) |
| Green | rgb(80,148,110) | rgb(38,61,48) |
| Blue | rgb(56,125,201) | rgb(35,56,80) |
| Purple | rgb(154,107,180) | rgb(60,45,71) |
| Pink | rgb(193,76,138) | rgb(78,43,60) |
| Red | rgb(207,81,72) | rgb(80,44,41) |
(Text colors are the same hex values in both themes; only backgrounds change.)

## Dark: selection toolbar, slash menu, placeholder (screenshots: c-selection-toolbar-dark.jpg, c-selection-color-menu-dark.jpg, c-slash-menu-dark.jpg, c-placeholder-empty-paragraph-dark.png)
- Selection toolbar card 192x323 same geometry; **bg rgb(37,37,37)**, shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,.2) 0 14px 28px -6px, rgba(25,25,25,.118) 0 2px 4px -1px`; "Normal Text" label rgb(240,239,237); icon fills/B,I,U,… **rgb(230,229,227)**; "Comment" rgb(230,229,227); separators rgba(255,255,243,.082); "Skills" header rgb(173,169,163); skill item text rgb(240,239,237); active-bold icon colour presumably rgb(39,131,222) (same blue). Selected-word highlight is a dark blue (~rgba(35,131,226,.28)).
- Color popover (A): 190x278, bg rgb(37,37,37), same shadow, header labels rgb(173,169,163); swatch tiles dark variants (same tile geometry 30 cell / 26 tile, per-color translucent ring as in block-menu flyout); backgrounds as the Dark color table above.
- Slash menu: card **bg rgb(37,37,37)** + dark shadow (same as menus), 324x238.8; header "Suggested" rgb(173,169,163); labels rgb(240,239,237); **selected/hover row bg rgba(255,255,255,0.055)**; icons fill rgb(230,229,227); secondary text ("Embeds", "Database", "Turn into") **rgb(125,122,117)**; "esc" + hints rgb(125,122,117); "Close menu" rgb(240,239,237); **"New" badge: 30x18, `bg rgba(67,155,255,0.24)`, text rgb(39,131,222), 11px/500, radius 4px, padding 2px 4px** (Light uses the same blue family).
- Placeholder: Dark `-webkit-text-fill-color rgba(255,252,235,0.306)` (Light rgba(21,14,0,0.286)); same text "Press ‘space’ for AI or ‘/’ for commands".
- Page temp blocks removed again (29 blocks).
