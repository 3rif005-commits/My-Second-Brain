# (h) Row page, peek modes, view settings — raw capture

Date 2026-10-13. Method per `_method.md` (helpers `__m/__t/__box`). Viewport **1300×597** CSS px, DPR 1, sidebar collapsed.
Notation as in d-table.md (`c=` colour, `bg=`, `r=`, `p=`, fs/fw/lh). Font = Notion UI stack. Hover bg token
`rgba(33,27,23,0.051)` (= `color(srgb .1294 .1059 .0902 / .051)`) is called **HOVER** below. Divider colour
`rgba(42,28,0,0.07)` = **DIV**; `rgba(28,19,1,0.11)` = **DIV2** (stronger line / pill-gray).
Menu shadow **MENU** = `rgba(25,25,25,0.05) 0 20px 24px 0, rgba(25,25,25,0.027) 0 5px 8px 0, rgba(42,28,0,0.07) 0 0 0 1px`.
Small-card shadow **CARD** (`--c-shaOutMd`) = `rgba(25,25,25,0.027) 0 8px 12px 0, rgba(25,25,25,0.027) 0 2px 6px 0, rgba(42,28,0,0.07) 0 0 0 1px`.
Fixture row used: Projects › "Legal compliance review" (first card of Blocked column, Board view = side peek).

## 1. SIDE PEEK — Light
Screenshots: `h-side-peek-light.jpg` (top bar hovered so all buttons show), `h-peek-mode-menu-light.png`.

### Container / docking
- `div.notion-peek-renderer`: `position:absolute; top 0; inset-inline-end 0; bottom 0; **width 650px**; z-index 109;`
  `transform: translateX(calc(var(--direction,1) * 0px)) translateZ(0)`; `transition: width 0.2s ease, transform 0.2s ease` (inline: duration 200ms, timing `ease`, properties `width, transform`).
  650px = 50% of the 1300 viewport here (default width; not verified whether it's a fixed px or 50% — likely a stored px width since it is resizable).
- Child panel: `display flex; flex-direction column; position absolute; inset 0; width 100%; height 100%; border-radius 0;`
  **bg `var(--c-bacEle)` = #fff**, **box-shadow = CARD** (`--c-shaOutMd`) → the only visual edge on the left is the 1px DIV ring + very soft shadow. No border.
- **The peek PUSHES the page, it does not overlay**: `.notion-frame` width shrinks 1300 → **650** (board/header re-lay out; the views bar collapses tabs into "6 more…"). **No dim / no backdrop.** Main page stays fully interactive.
- **Closed state**: the renderer stays mounted with `translateX(650px)` (off-screen right) — close = slide out.
- **Close animation** (rAF-sampled, click-outside): peek translateX 0→142→265→624→650 and frame width 650→793→916→1274→1300 over ≈ 200–290ms, i.e. both animate together (width+transform 0.2s ease).
- **Open**: declared the same transition, but the first sampled frame after the click already showed translateX 0 / frame 650 (main thread busy mounting the page) → effectively appears at once; rebuild with the 0.2s ease slide-in anyway.

### Resize handle (left edge)
- `div` `position:absolute; inset-inline-start 0; width 1px; top -1px; bottom -1px; z-index 109; pointer-events auto` > child **12px wide hit area** (`cursor: col-resize; height 100%; width 12px`, x 650→662, i.e. extends INTO the peek). bg transparent; **no highlight on hover** (checked bg/box-shadow of both elements while hovering: unchanged). Only the cursor changes. Not dragged.

### Top bar (sticky; stays while the peek content scrolls under it)
- Bar `div`: **h 44**, `display flex; justify-content space-between; align-items center; padding-inline 12px 10px`. No border/shadow under it (cover starts right at y 44).
- **Left group** (`display grid; gap 2px` row of controls, x 662):
  | # | aria-label | icon svg (class) | icon px | tooltip (12px dark chip, below) |
  |---|---|---|---|---|
  | 1 | Close | `arrowChevronDoubleForward` (») | 20 | "Close" / "Escape" |
  | 2 | Open in full page (`<a role=link>`) | `arrowExpandDiagonalSmall` (⤢) | 16 | "Open in full page" / "Ctrl+↵" |
  | — | divider: `div` **1×14, bg DIV2, margin 0 6px** | | | |
  | 3 | Switch peek mode | `peekSide` (panel icon; changes per mode) | 20 | "Switch peek mode" |
  | — | divider (same) | | | |
  | 4 | Previous page | `arrowChevronSingleUp` | 20 | "Previous page" / "Alt+K" |
  | 5 | Next page | `arrowChevronSingleDown` | 20 | "Next page" / "Alt+J" |
  - Each button **24×24, r 6px**, no padding (icon centred), `transition background 0.1s ease-in-out`, icon **fill (142,139,134)**; hover bg = HOVER. Buttons 1–2 sit at x 662/688 (26px step = 24 + 2 gap).
  - **Visibility**: buttons 1–2 are always visible; buttons 3–5 and the dividers have **opacity 0 → 1 on hover of the top bar** (`transition: opacity 0.1s`).
  - Disabled arrow (first row → "Previous page") = **opacity 0.4**.
- **Right group**: "Share" text button (71×28, `p 0 8px`, 14px, c (44,44,43), leading `lock` icon 12px), then **Copy link** (`link` 20px), **Favorite** (`star` 20px), **Actions** (`ellipsis` 22px) — each **28×28**, r 6px, c (44,44,43), HOVER on hover. (Share/⋯ not clicked.)
- **Keyboard**: **Alt+J = next row, Alt+K = previous row** (verified: Legal compliance review → API migration → back). **Escape closes** the peek with ONE press even while the title has the caret. **Click outside** (on the page's empty area) **closes** it (animated).

### Switch peek mode menu (`h-peek-mode-menu-light.png`)
- Popover card **220×160, bg #fff, r 10px, MENU shadow**, anchored 4px below the button, left-aligned ≈ button x − 117 (centred-ish under the left group); wrapper enter animation `opacity + transform scaleX/scaleY`, 200ms ease, `transform-origin 50% top`.
- Rows `div[role=menuitem]` **212×28, r 6px**, 14px/16.8 c (44,44,43), icons 20px fill (125,122,117); current row has HOVER bg + **✓** at the right.
  Rows: **Side peek** (`peekSide`) ✓ · **Center peek** (`peekCenter`) · **Full page** (`peekFull`) · **New tab** (`tabs`, fill (142,139,134)) · divider · **Edit view default** (`sliders`). Row pitch 29 (28 + 1px gap). Escape closes. (Nothing selected.)

### Page frame inside the peek
- Scroller starts at y 44. `.layout.layout-side-peek` 635px wide (650 − 15px scrollbar), **`grid-template-columns: [full-start] 76px [content-start] 483px [content-end] 76px [full-end]`**, `padding-bottom 120px`. → content column **483px**, gutters 76px.
- Cover `div.layout-full` full-bleed 635 × **119.4** (≈20vh at 597 viewport; doc page cover was 30vh). No icon on this row.
- Page controls bar (`.notion-page-controls`, x 725 w 484, **h 48, padding 16px 0 4px**, margin-left −1px): "**Add icon**" (`emojiFaceFill` 14px) and "**Customize layout**" (`layoutFillSmall` 14px) — 28px buttons `p 0 8px`, r 6px, 14px c (161,158,153), `transition opacity 0.1s`; **only visible while hovering the band above the title** (hovering the title itself did not reveal them). NB: a row page offers "Customize layout" instead of "Add cover/Add comment".
- Title `h1`: **32px / 700 / lh 38.4px**, c (44,44,43), `p 0 8px`, at y 211 (= cover bottom 163 + 48 controls). Same 32px as a full-page DB title, NOT the 40px doc title.
- Properties block starts at y 266 (title bottom 249.8 + ~16).

## 2. PROPERTIES BLOCK (row page; measured in the side peek) — Light
Screenshots: `h-side-peek-light.jpg`, `h-properties-label-hover-light.png` (label hover + name tooltip), `h-property-label-menu-light.jpg` (label menu + Property visibility flyout), `h-property-person-editor-light.png` (empty Owner → picker, name blanked), `h-comments-body-light.png`.

### Layout (identical rows; all 18 properties visible, none hidden → no "N more properties" toggle exists on this DB)
- Block = column of `div[role=row]` (481 wide at x 728 — i.e. content column 483 minus 2, starting 2px inside), **row h 34, margin `0 0 4px` → pitch 38**. Row `display flex`, 14px/lh 21, `cursor grab` (rows are draggable to reorder).
- **Label cell** `div[role=cell]`: **w 160 fixed, h 34, `padding 0 6px`, r 6px**, `display flex`, c (125,122,117), `transition background 0.02s ease-in`, cursor pointer.
  - Icon box 18×18 at cell x+6 (=734): property-type icon = CSS **mask** div 19.2×19.2 `mask-image url(/icons/<name>_gray.svg?mode=light)`, painted **bg (142,139,134)** (same icon set as the table header, see d-table §2). A hidden `svg.dragHandleFillSmall` 16px (fill (142,139,134)) shares the box.
  - Label text: **14px / 400 / lh 20px, c (125,122,117)**, starts x 758 (icon 18 + 6px gap), ellipsis.
- **Value cell** `div[role=cell]` (margin-left 4px; wrapper at x 892) > `div[role=button]` **w 313, min-h 34, `padding 6px` (text 7px 6px for empty/placeholder rows), r 4px**, `transition background 0.02s ease-in`, cursor pointer. Value text x 902 → **label col 160 + 8px gap + 6px pad**.
- Values: **14px / 400 / lh 21px, c (44,44,43)**.

### Value rendering per type (peek)
| Property (type) | rendering |
|---|---|
| Empty value (Files, Person…) | text "**Empty**", 14px/lh20, **c (161,158,153)** |
| Action (Button) | bordered chip: `p 0 6px`, h 24, r 6px, **border 1px solid DIV2**, text 14px/lh16.8 (44,44,43) |
| Budget (Number) | "$8,000.00" left-aligned (NOT right-aligned like the table) |
| Client (Relation) | `svg.pageEmpty` 18px fill (142,139,134) + title **fw 500**, lh 16.8, underline = `background-image: linear-gradient(to right, DIV2, DIV2)`, `background-size 100% 1px; background-position 0 100%; repeat-x` (a 1px DIV2 line, not text-decoration); item `margin 0 0 0 6px` |
| Client industry (Rollup of select) | pill (Orange) bg rgba(196,88,0,0.204), text (106,66,34), `p 0 6px`, h 20, r 4px, lh 20 |
| Contact (Email) | `<a>` text (44,44,43), same 1px DIV2 gradient underline |
| Website (URL) | `<a>` with gradient underline; host "example.com" (44,44,43) + path "/legal" **(161,158,153)** (path greyed) |
| Created / Edited (time) | "October 12, 2026 6:13 PM" plain (44,44,43) |
| Done (Checkbox) | 16×16 box, **border 1px solid rgba(27,21,0,0.19), r 3px** (same as table) |
| Due (Date) | "November 30, 2026" |
| Notes (Text) | plain text |
| Priority (Select) / Status / Tags | pills exactly as table (palette d-table §6b); Status pill has the coloured dot; multi pills spaced 8px (`gap 6px 8px` on the wrapper) |
| Ref (ID) | "PRJ-29" **c (161,158,153)** (read-only greyed) |
| Score (Formula) | "8" plain |

### States
- **Label hover** (`h-properties-label-hover-light.png`): label cell bg **HOVER**, r 6px; the type icon is replaced by the **⋮⋮ drag handle** (16px, (142,139,134)); after ~0.5s a dark tooltip with the full property name appears **to the LEFT of the label** (12px chip, same style as other tooltips). The hovered row shows the drag handle in the label even when the pointer is on the value.
- **Value hover**: **no bg** on the value button (measured transparent while hovered) — instead a floating mini-toolbar appears at the row's right end: card **52×24 at x = row right − 56, bg #fff, r 6px, padding 2px, CARD shadow**, two 24×20 buttons (r 4px): **Comment** (`commentFilledSmall` 16px) and **Copy to Clipboard** (copy icon 16px), icon fill (142,139,134).
- **Keyboard focus** on a label (after closing its menu with Escape): label keeps HOVER bg + focus ring `box-shadow: rgb(248,248,247) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px, rgba(255,255,255,0.25) 0 0 0 6px`, r 6px.
- **Click label → property menu** (opens ABOVE the label when there is room above; here card 220×226 at x 728 = label left, bottom ≈ 4px above the row): bg #fff, r 10px, MENU shadow; rows 212×28 (pitch 29), icons 20px fill (44,44,43):
  `Rename` · `Edit property` · `Comment` · divider · `Property visibility ›` · `Duplicate property` · `Delete property` · divider · `Customize layout`.
  **Property visibility ›** = hover flyout to the right (180×94, r 10px, MENU, rows 172×28): **Always show ✓ / Hide when empty / Always hide**. (Nothing changed; Escape ×2 closes flyout then menu, peek stays open.)
  Note: different from the table header menu (no Filter/Sort/Group/Hide/Wrap/Insert; it has Comment, Property visibility, Customize layout).
- **Click an empty value (Owner)** → the person picker opens **in place over the value cell**: card **314 wide (= value cell) at the value cell's top-left, r 6px, MENU shadow, bg #fff**; search field "Search for people or groups…" across the top (36px band, bottom divider), helper "Select as many as you like" 12px gray, then person rows (avatar 20px circle + name + "(You)" gray). Escape closed it, Owner stayed "Empty".
- **Click a text value (Notes)** → same in-place editor card 314×38 at the value's position (r 6px, MENU shadow, bg #fff), contenteditable textbox 14px/lh21 inside with caret; Escape closes without change.
- **"+ Add a property"** row: `div[role=button]` **127.8×34, `padding 0 8px 0 6px`, r 6px**, 14px/lh16.8 **c (161,158,153)**, `svg.plusFillSmall` 16px **fill (173,169,163)** at x 734, `transition background 0.1s ease-in-out`; hover bg HOVER. Sits directly after the last row (same 38 pitch). Not clicked (type picker covered in e §3).
- **No property groups / pinned properties / "N more properties"** on this fixture (all properties "Always show"). The hide/show toggle would come from "Hide when empty"/"Always hide" — not set, not captured.

## 3. COMMENTS SECTION — Light (`h-comments-body-light.png`, `h-comment-focus-light.png`)
- Wrapper `div.layout-content` (483 wide, x 726) with **border-bottom 1px solid rgba(55,53,47,0.09)** — this is the divider between the properties/comments header area and the page body (a border, full content-column width).
- Gap: "Add a property" bottom (184) → "Comments" heading top (204): heading row `p 3px 0`, h 24; text "**Comments**" **13px / 500 / lh 18px, c (125,122,117)**, x 734.
- Comment composer row (x 734, w 475, `padding 8px 4px 12px 0`, h 47):
  - Avatar: **24×24 circle** (r 100%), bg #fff, initial **11px / 400, c (142,139,134)** (here showed the user's initial; blanked to "J"). No border measured.
  - Input `div.discussion-input…[role=textbox]` placeholder **"Add a comment…"** (real ellipsis), 14px/lh20, placeholder colour (161,158,153); hover wrapper `padding 3.5px 4px 3px; margin -3.5px -4px 0; r 6px`. **No border, no bg — at rest or focused.**
  - **Focused**: caret appears; three 24×24 icon buttons (r 6px) appear at the right end (x 1121/1151/1181, 30px step): **Attach file** (`paperClip`), **Mention a person, page, or date** (`at`), **Send comment** (`arrowInCircleUpFill`, **opacity 0.4** while empty) — icons fill (142,139,134). Input narrows 439 → 349.
  - Escape blurs the input (does NOT close the peek). Nothing posted.

## 4. PAGE BODY (empty) — Light
- Right below the divider: placeholder block 483×56 at x 726, **`padding 8px 0 24px 8px`**, text **16px / lh 24, c (161,158,153)**:
  "Press ‘enter’ to continue with an empty page, or <u>create a template</u>" — "create a template" is a `div[role=button]` 123.6×24, same grey, **`text-decoration: underline`**, cursor pointer. No template buttons/list below it in this build.
- Distance divider → placeholder text: 8px padding (text top ≈ divider + 8 + 0). Layout bottom padding 120px below.

## 5. BACKLINKS
- None rendered for this row (no backlinks; the Client relation shows only as a property value). No "N backlinks" row appeared in the peek. Not captured.

### 2b. More value-hover variants (measured on the full page, same in peek)
- Scalar values (Number/Text/Date…): no bg; mini-toolbar **Comment + Copy to Clipboard** at the row's right end (see §2).
- Rollup (Client industry): mini-toolbar shows **Edit (pencil) + Copy**.
- **Relation (Client)**: the value gets a bg **rgba(55,53,47,0.06), r 4px, padding 2px 4px 2px 2px, h 32** (whole value width), plus a right-end mini card **45×24, bg #fff, r 4px, CARD shadow** with two 20×20 buttons (r 4px): **Unlink page** (`dashLongSmall` 16px "−") and **Link another page** (`plusSmall` 16px "+").

## 1b. CENTER PEEK — Light (Gallery view, "Open pages in: Center peek")
Screenshot: `h-center-peek-light.jpg` (mouse over the cover, so the cover's Change/Reposition pill shows too).
- Backdrop = `div.notion-peek-renderer` itself: **`position fixed; inset 0; z-index 99; background var(--ca-oveSmo)` = rgba(15,15,15,0.6)** (computed). Covers the whole app incl. the top bar (the bar is visible through it, darkened).
- Modal `div`: `position absolute; top 72px; inset-inline 72px; margin-inline auto; **max-width 975px**; height calc(100% − 144px); **border-radius 12px**; overflow hidden; bg #fff (`--c-bacEle`); box-shadow CARD (`--c-shaOutMd`)`; flex column.
  At 1300×597: **975×453 at (163, 72)** → centred horizontally, 72px from top and bottom.
- Modal top bar: wrapper `z-index 110; bg #fff; border-radius 12px 12px 0 0`, inner identical to the side peek bar (**h 44, padding-inline 12px 10px**, flex space-between).
  Left group: **Open in full page** (⤢ 16px, x 175) · divider · **Switch peek mode** (`peekCenter` icon) · divider · **Previous / Next** (↑ ↓). **There is NO » Close button in center peek** (close via Esc / backdrop). Right group identical to side peek: Share (71×28) · Copy link · Favorite · ⋯ (28×28 each).
  In this mode all left buttons were visible (opacity 1) while the pointer was in the modal.
- Scroll: the modal body scrolls inside the modal (own 15px scrollbar right edge, starting under the 44px bar); the page behind does not scroll.
- Page layout inside: `.layout.layout-center-peek` **grid `[full-start] 126px [content-start] 708px [content-end] 126px [full-end]`** (scroller 960 = 975 − 15). Content column **708px**; title x = modal x + 126. Cover 119.4 high (20vh), full-bleed in the modal. Title 32px/700 (same as side peek). Properties/comments/body identical to §2–4 (value column wider: 708 − 160 − gaps).
- **Escape closes; click on the backdrop closes.** Open/close animation: none observable — sampling (setInterval 10ms / rAF) saw the modal fully present (opacity 1, transform none) in the first frame after the click, and gone on the first frame after closing (main thread blocked during mount/unmount). The renderer's computed `transition` = `all` default, no inline transition on the modal → treat as **instant** (a 150ms fade would be a safe approximation, not measured).
- URL param: `&p=<row id>&pm=c` (side peek uses `pm=s`).

## 1c. FULL PAGE — Light (from "Open in full page", `h-full-page-light.jpg`)
- URL becomes `/p/Legal-compliance-review-<id>`; tab title = row title.
- Breadcrumbs in the top bar: **"UI Reference (Claude) / Projects / Legal compliance review"** — the DB is a crumb, the row is the last crumb (crumb button `p 2px 6px`, r 6px, 14px, c (44,44,43); separators "/" as in b-shell). Right side: "Edited 13h ago" (grey) · Share · link · ☆ · ⋯.
- Layout = **normal doc page**: `.layout` grid `282.5px | 720px | 282.5px` at 1285 scroller → content column **720px**.
- Cover full-bleed **179.1 high (30vh)**; page controls (Add icon / Customize layout) `h 48, padding 16px 0 4px`, hover-revealed.
- Title **40px / 700 / lh 48px** (doc-page size; the peeks use 32px/38.4). Title at y 271.
- Properties block: rows 718 wide (x 284.5 = content + 2), **label 160 fixed**, value **554** (rest). Same 34px rows / 38px pitch, same fonts. So the label column stays 160px in every mode; only the value column grows.
- Below: Add a property · Comments · divider · empty-body placeholder, identical to §2–4.

## 1d. Table view: OPEN button → side peek
- Hovering the Name cell shows **"OPEN"** button: `div[role=button]` **65.3×20, `padding 0 4px`, r 4px, bg HOVER** (it carries the HOVER bg at rest-on-row-hover; the white-card/CARD shadow lives on a wrapper as in e-table-editing), label "Open" rendered **uppercase via `text-transform`**, **12px / 500 / lh 18px, letter-spacing 0.5px, c (125,122,117)**; leading `svg.peekSide` 15px fill (142,139,134) (the icon follows the view's open mode). Click → **side peek** (Table's "Open pages in" = Side peek, "Default for Table"). The clicked row keeps a blue selection outline while its peek is open.
- Filled Files value in the peek (Annual report › Attachments): chip `span` **h 24, `padding 0 6px`, r 4px, bg DIV (rgba(42,28,0,0.07))**, `svg.pageEmpty` 20px + URL text 14px/lh24 (44,44,43), width capped (≈200px, ellipsis).

## 6. VIEW SETTINGS PANEL — Light (Table view, toolbar "Settings" sliders button)
Screenshots: `h-view-settings-root-light.jpg` (row hover on "Property visibility"), `h-view-settings-root-scrolled-light.png`, `h-view-settings-layout-table-light.png` (Board card hovered), `h-view-settings-open-pages-in-light.jpg`.

### Container — RE-VERIFIED: it IS a docked right panel, `.notion-view-settings-sidebar`, **483px** (spec §3 claim confirmed), push/pop navigation (confirmed), but details:
- `position:absolute; top:40px` **inside the sticky views-bar row** (so it hangs from the bottom of the views bar, y 166.4 = table header top), `inset-inline-end: -96px` (bleeds into the 96px right page gutter), **width 483 incl. `padding-inline-end 96px`** → visible part x 898 → 1285 (≈387px incl. the left border), **height = viewport rest (430.6 here)**, z-index 88.
- **bg #fff (`--c-bacPri`), NO shadow**, left edge **`border-inline-start: 1px solid #e6e5e3` (`--c-borPri`)** with `border-image: linear-gradient(180deg, #fff 0, #e6e5e3 12px) 1 100%` → the left border **fades in over the top 12px**.
- It **overlays the table** (table is not resized; columns run underneath and are hidden by the white panel).
- Enter/exit: `transition: opacity 0.2s ease, transform 0.2s ease`; inline `opacity 1; transform translateX(calc(var(--direction,1) * 0px))` when open (closed = opacity 0 + translateX offset; slide-in from the right).
- The toolbar Settings button keeps **bg HOVER** (active state) while the panel is open; icon fill (142,139,134).
- Inner scroll area: **290 wide at x 899**, starts y 208.4 (under the fixed header), `mask-image: linear-gradient(transparent 0, #000 34px, #000 100%)` (top fade while scrolled). Rows are 259 wide at x 907 (8px inset); a 15px scrollbar track on the right.

### Root page
- Header (fixed, not scrolling): title "**View settings**" **12px / 500 / lh 16px, c (125,122,117)** at x 915, y 183; **Close ✕** button right: **20×20 circle (r 100%), bg DIV rgba(42,28,0,0.07)**, `svg.xMarkSmall` 14px fill (142,139,134), at x 1153.
- Name row: **Change icon** button 28×28 r 6px (`viewTable` 20px, the view-type icon) at x 911 + **view name input** box 215×28, **bg rgba(66,35,3,0.03), r 6px, box-shadow DIV2 0 0 0 1px (1px ring), padding 3px 6px**; input 14px c (44,44,43), placeholder "View name" (grey) — this Table view's stored name is empty, so the placeholder showed; at the right inside the box an **(i) "Add view description"** button (`infoCircleFill` 15px, r 20px).
- Menu rows `div[role=menuitem]` **259×28, r 6px, pitch 29**, `transition background 0.02s ease-in`; hover bg HOVER. Inside: icon 20px at x+8 (fill **(56,56,54)** — darker than usual grey), label 14px/16.8 c (44,44,43) at x+36, right-aligned value **14px c (161,158,153)**, then `svg.arrowChevronSingleRightSmall` **16px fill (173,169,163)**, 8px from the right edge.
- Rows (icon class → value):
  **View settings** group: Layout (`viewTable` → "Table") · Property visibility (`eye` → "19") · Filter (`filter`) · Sort (`arrowUpDown`) · Group (`squareGridBelowLines`) · Conditional color (`blockColor`) · Copy link to view (`link`, no chevron).
  divider (243×1, bg DIV, x 915) — section header "**Data source settings**" (**12px / 500 / lh 14.4, c (125,122,117)**, wrapper `padding 4px 8px 0; margin 6px 0 8px`):
  Source (`pathRoundEnds` → "Projects") · Edit properties (`bulletedList`) · Automations (`lightning`) · AI Autofill (`magicWand`) · Turn into (`arrowSquarePathUpDown`) · More settings (`ellipsis`).
  divider — Manage data sources (`collection` ›) · Lock database (`lock`, no chevron) · Manage in Calendar (`calendarDate13`, **↗ external arrow** instead of chevron).
  **No "Duplicate view" / "Delete view" / "Load limit" / "Sub-items" / "Dependencies" rows in this panel** (this build). Not opened: Source, Edit properties, Automations, AI Autofill, Turn into, Manage data sources, Lock database, Manage in Calendar, Copy link (side-effect / not needed) — see §6 sub-pages for what was opened.

### Navigation model — CONFIRMED push/pop, **no animation**
- Clicking a row **replaces** the panel content (same container, same width). Header becomes: **← Back** button (24×22, r 6px, `svg.arrowStraightLeftSmall` 16px fill (142,139,134)) at x 909 + **sub-page title 14px / 600 / lh 21px c (44,44,43)** at x 941 + the same circular ✕ at the right.
- Back returns to the root. **No slide/fade**: checked right after the click — scroller transform identity, opacity 1 → instant swap.

### Layout sub-page (Table)
- **Layout type grid**: `display grid; grid-template-columns: 3 × 83.33px; gap 8px`, starts x 911, y 220. 9 cards in 3 rows (pitch 64.5): **Table · Board · Timeline / Calendar · List · Gallery / Chart · Feed · Map**.
  - Card `div[role=button]` **83.3×56.5, r 6px, padding 6px**, `transition background 0.02s ease-in`; icon 20px (`viewBoard`…) centred, label below **11px / 400 / lh 16.5px**.
  - Rest: **box-shadow `#e6e5e3 0 0 0 1px inset`** (1px inner border), icon + label **c/fill (125,122,117)**.
  - **Selected (Table)**: **box-shadow `rgb(39,131,222) 0 0 0 2px inset`** (2px blue inner border), icon + label **(39,131,222)**, no bg.
  - Hover: bg HOVER, border unchanged.
- Option rows below (each **274×28, `padding 0 8px`**, label 14px/16.8 c (44,44,43)): **Show vertical lines** ⏺ON · **Show page icon** ⏺ON · **Wrap all content** ⏺ON · **Open pages in** → "Side peek" (value 14px (161,158,153) + chevron).
- **Toggle switch**: track `display flex; height 14px; width 26px; padding 2px; box-sizing content-box (→ 30×18); border-radius 44px; background var(--c-bluBacAccPri) = rgb(39,131,222) when ON`; `transition: background 200ms, box-shadow 200ms`. Knob **14×14 white circle (r 44px)**, `transform translateX(12px)` when ON (0 when OFF), `transition: transform 200ms ease-out, background 200ms ease-out`. (OFF track colour: see Gallery below.)
- **"Open pages in" dropdown** (click; looked, Escape): popover **250×223, r 10px, MENU shadow, bg #fff**, opening ABOVE the row, right-aligned with it; the row gets a focus ring and its chevron turns ▾. Items `div[role=menuitem]` 242 wide, r 6px, two-line: icon 20px (`peekSide`/`peekCenter`/`peekFull`, fill grey) + title **14px/400 (44,44,43)** + description **12px / lh 16.8 c (125,122,117)**:
  **Side peek** ✓ (h 89.2) "Open pages on the side. Keeps the view behind interactive." + link-coloured "**Default for Table**" (12px, (39,131,222)) · **Center peek** (h 70.4) "Open pages in a focused, centered modal." · **Full page** (h 53.6) "Open pages in full page." The current item has HOVER bg + ✓. Escape closed only the dropdown (panel stayed on Layout).

### Property visibility sub-page (`h-vs-property-visibility-light.png`, `…-scrolled-light.png`)
- Header "Property visibility" (← / ✕). **Search input** "Search for a property…" auto-focused: box **266×28, bg rgba(66,35,3,0.03), r 6px, padding 3px 6px, focus ring `rgb(35,131,226) 0 0 0 1px inset, rgb(35,131,226) 0 0 0 1px`**.
- Section header row: "**Shown in table**" (12px/500, c (125,122,117)) left + "**Hide all**" text button right (**12px, c (39,131,222)** blue, `padding 2px 6px`, r 6px, h 18.4). (A "Hidden in table" section + "Show all" would appear below when something is hidden — none hidden here, all 19 shown.)
- Rows **259×28, `padding 0 8px`, pitch 28 (no gap), cursor default, NO hover bg** (measured transparent on hover). Content: `svg.dragHandle` 20px **fill (173,169,163)** (x 910) · property-type mask icon 19px **bg (56,56,54)** (dark) · name 14px (44,44,43) · right: **eye toggle** `div[role=button][aria-label="Toggle property visibility"]` 24×24 r 6px with `svg.eyeFillSmall` 16px fill (56,56,54).
- **Name (title) row's eye is disabled: opacity 0.4** (title can't be hidden). Rows are drag-reorderable (handle). Order = the view's column order.

### Filter sub-page — titled "**Add filter**" (`h-vs-filter-light.png`)
- Search input "Filter by…" (251×28, focused ring). List of every property as `div[role=option]` **267×28, r 6px** (x 903; first option keyboard-highlighted with HOVER bg), type icon + name. Bottom (sticky, divider above): "**+ Add advanced filter**" 14px c (125,122,117). Choosing a property would create a filter — not clicked.
- (Active filters/sorts on a view show as chips under the toolbar — covered in e §6.)

### Sort sub-page — "**New sort**" (`h-vs-sort-light.png`): same pattern: input "Sort by…", option list of properties (no footer).

### Group sub-page — "**Group by**" (`h-vs-group-none-light.png`, ungrouped Table): input "Search for a property…", first option "**None** ✓" (selected, HOVER bg + check), then groupable properties (Name, Budget, Client, Client industry, Contact, Created, Done, Due, Edited, Notes, …). Grouped-view options: see §6b.

### Conditional color sub-page (`h-vs-conditional-color-light.png`)
- Illustration image 258×128 (r 10px, a mini table with tinted rows), description "Customize page colors to easily distinguish categories, highlight overdue events, and bring clarity to your work." **12px / lh 16px, c (125,122,117)** (renders ~13–14px visually; measured on the span), then primary button "**+ New color setting**" **258×28, bg (39,131,222), text (243,249,253) 14px/500, r 6px, padding 6px 12px**. Not clicked.

### More settings → **popover, not a push** (`h-vs-more-settings-popover-light.png`)
- Clicking "More settings" opens a menu card **250×123, r 10px, MENU shadow**, ABOVE the row (row chevron turns ▾): **Sub-items** (`listToggleIndent`) › · **Dependencies** (`arrowTurnDownRight`) › · **Connections** (`integration`) › · **Customize page layout** (`layout`) ›; rows 242×28.
- **Sub-items** → pushes a sub-page (`h-vs-sub-items-light.png`): caption "Break down items in toggles" (12px grey), illustration card (1px border, r 6px: ▾ 🐔 Parent item / ▸ 🐣 Sub-item ×2), full-width blue button "**Turn on sub-items**" (258×28, r 6px). Not clicked. (Dependencies assumed to follow the same pattern — not opened.)

### Automations sub-page (`h-vs-automations-light.png`): header with only ← and ✕ (no title), centred ⚡ icon (orange), "Automations" 16px heading, grey description "Automatically edit properties, create pages, send updates, and more", and an outlined "**⬆ Upgrade now**" button (not clicked — paid feature). No list UI available on this plan.

### Edit properties sub-page — "**Properties**" (`h-vs-edit-properties-light.png`)
- Search input; list of all properties (icon + name + chevron, 28px rows; rows of hidden-in-view properties are greyed, e.g. Owner); sticky footer under a divider: "**+ New property**", "**Deleted properties**  1 ›", "**(?) Learn about properties**" (grey 14px rows).
- Clicking a property (Priority) **pushes "Edit property" INTO THE SAME 483px SIDEBAR** (`h-vs-edit-property-priority-light.png`): icon button + name input ("Priority", (i) description button) · Type › "Select" · Property access · AI Autofill › · Sort › "Manual" · divider · "Options" header with "+" · option rows (⋮⋮ + pill + ›) · sticky footer: Wrap content (toggle ON) · Duplicate property · Delete property.
  → **Reconciliation with e-table-editing §4**: from the column-header menu, "Edit property" is a **flyout popover**; from **View settings › Edit properties › <property>** it is the **docked 483px sidebar with push/pop**. Both exist; same content.

### Closing the panel
- **✕**, **Escape** (from the root AND from a sub-page — Escape on "Layout" closed the whole panel, it does not pop), and **clicking outside** (page area) all close it.

### 6b. Grouped view ("Table — grouped": filter Priority, sort Due, group Status)
- Root rows then show values: Filter → "**Priority**", Sort → "**Due**", Group → "**Status**"; the view name input shows "Table — grouped". (Toolbar Filter/Sort icons are blue = active, as in e §6.)
- **Group** sub-page (`h-vs-group-grouped-light.png`): rows **Group by › "Status"** · **Status by › "Option"** · **Sort › "Ascending"** · **Hide empty groups** (toggle ON) · divider · section header "**Groups**" + blue "**Hide all**" · one row per group: ⋮⋮ handle + the group's pill (Status pill with dot) + eye toggle (Blocked, Not started, Review, In progress, Done) · divider · "**Remove grouping**" (trash icon, grey) · "**Learn about grouping**" ((?) icon, grey). No "Color columns" here (that is a Board layout option).
- **Filters** sub-page with an active filter (`h-vs-filters-active-light.png`), title "**Filters**": row = ⋮⋮ + **filter chip** "◉ Priority: Not Someday ▾" (blue chip, same style as the toolbar chips in e §6: bg ≈ rgba(35,131,226,0.07), text (39,131,222)), then "**+ Add filter**" (grey row).
- **Sort** sub-page with an active sort (`h-vs-sort-active-light.png`), title "**Sort**": row = [property picker button "📅 Due ▾" **84×32**] [direction button "**Sort old → new ▾**" 130×32] — both **bg #fff, border 1px solid DIV2 (rgba(28,19,1,0.11)), r 6px, padding 0 8px, 14px (44,44,43)** — + "Remove sort rule" ✕ 24×24 r 6px; then "**+ Add sort**" and "**🗑 Delete sort**" (grey 14px rows). NB: in this capture the sub-page content rendered ≈22px too far left (drag handles clipped at the panel's left edge, menu rows at x 876 < panel x 898) — looks like a Notion layout quirk of this sub-page; build it aligned like the other sub-pages.

### 6c. Layout sub-page — Board (`h-vs-layout-board-light.png`, `…-scrolled-light.png`)
- Same 3×3 type grid (Board selected; with the vertical scrollbar visible the cards are ~78px wide instead of 83).
- Rows: **Show page icon** ON · **Wrap all content** ON · **Group by › "Status"** · **Color columns** ON · **Open pages in › "Side peek"** · divider · **Card preview › "None"** · **Card size › "Medium"** · **Card layout** block.
- **Card layout block**: container **251×157, bg rgba(66,35,3,0.03), r 10px, padding 12px**, caption "Card layout" **12px c (125,122,117)** centred; two `button[role=radio]` previews **102×76, bg #fff, r 10px, padding 10px**, labels below 14px:
  - Unselected "**Compact**": `outline: 1px solid #e6e5e3; outline-offset -1px`; mini illustration = top band 102×24 bg rgba(66,35,3,0.03) (r 10px 10px 0 0), 14px dot bg DIV2 (r 50%), 3 short bars 22×5 bg DIV (r 90px) in a row; label c (125,122,117).
  - Selected "**List**" (`aria-checked=true`): **`outline: 2px solid rgb(39,131,222); outline-offset -2px`**; band bg rgba(0,124,215,0.094), dot rgba(0,118,217,0.204), stacked bars 56/25/41×5 bg rgba(0,124,215,0.094); label c (44,44,43).

### 6d. Layout sub-page — Gallery (`h-vs-layout-gallery-light.png`, `…-scrolled-light.png`, `h-vs-card-size-menu-light.png`, `h-vs-card-preview-menu-light.png`)
- Rows: **Show page icon** ON · **Wrap all content** OFF · **Open pages in › "Center peek"** · divider · **Card preview › "Page cover"** · **Card size › "Medium"** · **Fit media** OFF · **Card layout** block (Compact / **List** selected). No Group/Color columns.
- **Toggle OFF**: track **bg var(--ca-swiButTeaBg) = rgba(135,131,120,0.3)**, knob white at translateX(0).
- Toggle rows have HOVER bg on hover (row 274×28, r 6px).
- **Card size** dropdown (look only): popover r 10px MENU shadow below the row (row chevron ▾): **Small · Medium ✓ · Large** (28px rows, first keyboard-highlighted).
- **Card preview** dropdown: **None · Page cover ✓ · Page properties › · Page content** (two-line: "Uses first block on the page" 12px grey).
- Nothing was changed (panel text re-read afterwards: Page cover / Medium / Center peek).

### 6e. Toolbar note (Gallery)
- At rest the Gallery toolbar shows only Filter · Sort · Search · New; **Automations, AI Autofill and Settings appear only while the pointer is over the view header/toolbar** (hover-revealed), then they sit at the same 28px pitch (Filter 939 … Settings 1079). On the Table view they were visible at rest (maybe because the panel had been used) — make the extra buttons hover-revealed with the toolbar's `opacity 0.1s` transition.

## 7. "+ NEW VIEW" FLOW — Light (`h-new-view-picker-light.png`, `h-view-item-menu-light.png`)
- Views overflow ("1 more…") menu (as d-table §1b): search "Search for a view...", all views as rows (⋮⋮ · type icon · name · ⋯), then a divider and two footer rows: **"+ New view"** and **"New data source"** (`collection+` icon). Hovering a view row shows a tooltip "Gallery / Gallery view of Projects" to the left.
- **Row ⋯ → view item menu** (card **220×263, r 10px, MENU shadow**, opened to the right/top, aligned with the top bar): **Rename** · **Display as ›** · **Edit view** (sliders) · **Source › "Projects"** · divider · **Copy link to view** · divider · **Duplicate view** · **Delete view** · divider · **Manage in Calendar**. → **Duplicate/Delete view live HERE, not in the View settings panel.** (Nothing clicked.)
- **"+ New view" → view-type picker popover** opening to the LEFT of the overflow menu (card **390×234, bg #fff, r 10px, MENU shadow**, its bottom-right near the "New view" row):
  - Caption "**Add a new view**" **12px / 500, c (125,122,117)** (top-left, padding ≈ 16px 16px 8px).
  - **4-column grid of tiles** `div[role=gridcell]` **92×62, r 8px**, column pitch 94 (2px gap), row pitch 63, `display flex column`, centred, gap 4px, `transition background 0.02s ease-in`. Icon **22px, fill (44,44,43)** (`viewTable`, `viewBoard`, `viewDashboard`, …) above label **14px / lh 20px, c (73,72,70)**.
  - Order: **Table · Board · Gallery · List / Chart · Dashboard · Timeline · Feed / Map · Calendar · Form** (11 tiles; Dashboard and Form are extra vs the Layout grid, which has 9).
  - First tile (Table) is keyboard-highlighted: bg HOVER. Hover = same HOVER bg.
  - **The view is NOT created by opening the picker** (tab count stayed 7 views). Escape closed the picker, then the overflow menu (two/three Escapes). Nothing created.

# DARK PASS (Ctrl+Shift+L; `body.dark`, body bg rgb(25,25,25)). Sizes/positions identical to Light; only colours below.
Screenshots: `h-side-peek-dark.jpg`, `h-properties-label-hover-dark.png`, `h-comments-body-dark.png` (avatar initial blanked), `h-center-peek-dark.jpg`, `h-view-settings-root-dark.jpg` (Gallery view, row hover), `h-vs-layout-gallery-dark.png` (Board card hovered), `h-vs-card-size-menu-dark.png`.
Dark HOVER token = `color(srgb 1 1 1 / 0.055)` (= rgba(255,255,255,0.055)). Dark divider-ish = `rgba(255,255,235,0.1)`.

## Peeks (dark)
| element | dark value |
|---|---|
| Side-peek panel bg | **rgb(32,32,32)** |
| Side-peek panel shadow | **`rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 4px 12px -2px`** (1px solid-ish ring instead of the light DIV ring) |
| Page behind (frame) | rgb(25,25,25) |
| Top-bar icon fill | (173,169,163) |
| Top-bar dividers (1×14) | rgba(255,255,235,0.1) |
| Center-peek backdrop | **rgba(15,15,15,0.8)** (light was 0.6) |
| Center-peek modal bg / shadow | rgb(32,32,32) / same as side-peek shadow |
| Title h1 | (240,239,237) |

## Properties block (dark)
| element | dark value |
|---|---|
| Label text / type-icon (mask bg, `?mode=dark` icon url) | (173,169,163) |
| Label hover bg | HOVER rgba(255,255,255,0.055) |
| Drag handle fill | (173,169,163) |
| Value text | (240,239,237) |
| "Empty" placeholder / Ref (ID) / greyed URL path | (125,122,117) |
| Relation / email underline | `linear-gradient(… rgba(255,255,235,0.1) …)` 1px |
| Button-property chip border | 1px solid rgba(255,255,235,0.1) |
| Value-hover mini toolbar | bg rgb(32,32,32), shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 4px 12px -2px`, icons (173,169,163) |
| "+ Add a property" text | (125,122,117) |
| "Comments" heading | (173,169,163) |
| Comment avatar | outer circle bg rgb(25,25,25), inner bg **rgb(37,37,37)**, initial (173,169,163) |
| Divider under comments (border-bottom) | **1px solid rgba(255,255,255,0.094)** |
| Empty-body placeholder text | (125,122,117) |
| Pills | dark pill palette (e.g. Software/Orange = saturated brown bg, light text) — see d-table dark section |

## View settings panel (dark)
| element | dark value |
|---|---|
| Panel bg | **rgb(25,25,25)** (`--c-bacPri`, same as page — no elevation) |
| Left border | **1px solid rgb(56,56,54)**, border-image `linear-gradient(rgb(25,25,25) 0, rgb(56,56,54) 12px)` (same top fade) |
| "View settings" / section headers | (173,169,163) |
| ✕ button | bg rgba(255,255,235,0.1), icon (173,169,163) |
| Name input box | bg rgba(252,252,252,0.03), ring `rgba(255,255,235,0.1) 0 0 0 1px`, text (240,239,237) |
| Row label | (240,239,237); row icon fill **(230,229,227)**; value text + chevron (125,122,117) |
| Row hover | HOVER rgba(255,255,255,0.055) |
| Dividers | rgba(255,255,243,0.082) |
| Sub-page title / ← icon | (240,239,237) / (173,169,163) |
| Layout card rest | inset ring **rgb(56,56,54) 1px**, icon+label (173,169,163) |
| Layout card selected | inset ring rgb(39,131,222) 2px, icon+label (39,131,222) (unchanged) |
| Layout card hover | HOVER bg |
| Toggle ON / OFF track | rgb(39,131,222) / **rgba(202,204,206,0.3)** |
| Card layout block bg | rgba(252,252,252,0.03); radio cards bg rgb(32,32,32), unselected outline 1px rgb(56,56,54), selected 2px rgb(39,131,222); selected illustration tint rgba(67,155,255,0.24) |
| Dropdown popover (Card size) | bg **rgb(37,37,37)**, shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.2) 0 14px 28px -6px, rgba(25,25,25,0.118) 0 2px 4px -1px` |

## Final state
- Theme switched back with Ctrl+Shift+L: `body.dark` = false, `localStorage.theme = {"mode":"light"}` → **Notion left in Light**.
- No Notion content or settings changed: no property values edited (Owner stayed Empty, Notes unchanged), no comment posted, no view created (7 views before/after), no view setting changed (Gallery Layout re-read: Page cover / Medium / Center peek). Peeks and panels closed.
- Privacy: user's initial on the comment avatar blanked to "J" before saved screenshots; the person-picker name blanked to "Jane Doe"; sidebar collapsed throughout.

## Not captured / caveats
- Peek/center-peek **open** animations: not measurable (main thread blocked during mount; first sampled frame already final). Side-peek close IS animated (0.2s ease width+transform). Center peek appears in two phases: backdrop+modal shell first with partial content (no Share/⋯ yet), then full content ~1–2s later.
- "N more properties" / "Hide N properties" toggle, property groups, backlinks: **not present on this fixture** (all properties "Always show", no backlinks).
- Not opened (side-effects / paywall / not needed): Source, AI Autofill, Turn into, Manage data sources, Lock database, Manage in Calendar, Copy link to view, Dependencies, Connections, Customize page layout, Customize layout (row page), Share, peek ⋯ Actions menu. Automations shows only an "Upgrade now" wall.
- No "Load limit" row exists in this build's View settings panel.
