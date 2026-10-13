# (e) Table editing, property menus and panels — raw capture

Date 2026-10-12. Method per `_method.md`; notation and tokens as in `d-table.md`
(`c=` colour, `bg=`, `r=`, `p=`, colours `(r,g,b[,a])`; UI font stack unless stated).
Viewport **1300×597** CSS px, DPR 1, sidebar collapsed (Ctrl+\, content x=104).
Fixture: Projects, view "Table" (`?v=3f77b5cb32d08096807b000c9571b6e0`) unless stated.
Token shorthands reused from d-table / spec §5:
- `--menu-shadow` (L) = `rgba(25,25,25,.05) 0 20px 24px 0, rgba(25,25,25,.027) 0 5px 8px 0, rgba(42,28,0,.07) 0 0 0 1px`
- `--menu-shadow` (D) = `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,.2) 0 14px 28px -6px, rgba(25,25,25,.118) 0 2px 4px -1px`
- `hover` = `rgba(33,27,23,0.051)` (L) / `rgba(255,255,255,0.055)` (D)
- `fg` (44,44,43) / `fg2` (125,122,117) / `fg3` (161,158,153) / icon (142,139,134)
- `divider` rgba(42,28,0,.07); `field-bg` rgba(66,35,3,.03); focus ring = `rgb(35,131,226) 0 0 0 1px inset, rgb(35,131,226) 0 0 0 1px`

## 1. Cell editing states — Light

### 1.0 Common: the "cell editor" popup (Text, Title, Number, URL, Email, Phone)
Screenshots: `e-text-cell-editor-light.png`, `e-title-cell-editor-light.png`, `e-number-cell-editor-light.png`.
- **One click on a text-like cell opens the editor immediately** (no two-stage select for Text/Title/Number in this build; the old capture's two-stage model applied to a Select cell with no options).
- Editor = `div[role=dialog]` placed in `.notion-overlay-container` at **(cell x − 1, cell y − 1)**, i.e. it covers the cell and overhangs it by 1px on top/left (the row's top border line is under it).
- **Width = max(column width, 240px)** set inline (`width: 240px` on the 200px Notes/Budget columns → overhangs the neighbour column by 40px; `width: 280px` on the 280px title column). `min-height 38px; max-height 573px` (viewport − 24) — grows DOWN as text wraps (`white-space: break-spaces`), never sideways.
- Box: **bg #fff, radius 6px, `--menu-shadow`** (the full 3-layer menu shadow, not the lighter OPEN-button shadow), `outline: 1px solid transparent`, flex column.
- Inner: `div` **padding 8px 9px**, min-height 38, 14px / lh 21px, `justify-content: space-between`.
- Text field: `div.content-editable-leaf-rtl[role=textbox]` (contenteditable, placeholder " "), 14px/21px **c (44,44,43), caret-color (44,44,43)** (caret = text colour, not blue). Text sits at exactly the same x/y as the resting cell text (cell p 7.5px 8px vs editor p 8px 9px + 1px offset) → no visual jump.
- No bg tint, no border, no focus ring inside the editor — just the floating card.
- Anchor wrapper (parent of the dialog) carries `--x-transformOrigin: 0% top; transition-duration 200ms; transition-timing-function ease; transition-property none` → **no visible open animation** (appears instantly).
- **Title cell** while editing: identical card, width 280 (= column), the page icon is NOT shown inside the editor (text starts at x 112 = cell + 9), text keeps **font-weight 500**.
- **Number cell** while editing: same card (240 wide); the field is a plain `<input type=text>` (no bg/border/padding), **`text-align: end` — stays right-aligned while editing**, and its value is the **formatted** string ("$22,000.00"), not the raw number.
- **After Escape** the editor closes and the cell stays SELECTED: overlay `div` 199×36 at the cell's content box, `box-shadow rgb(39,131,222) 0 0 0 2px inset`, `bg rgba(35,131,226,0.07)`, `radius 2px` (same as d-table §6c).

### 1.1 Multi-select (Tags) editor
Screenshots: `e-multiselect-editor-light.png`, `e-multiselect-filter-create-light.png` (query "e"), `e-multiselect-create-zzz-light.png`, `e-multiselect-keyboard-focus-light.png`.
Same card as the Select editor in d-table §6c (**300 wide, r 6px, --menu-shadow**, over the cell at cell x−1/y−1); differences and details:
- **Input band** (`div[role=combobox].notion-scroller`): 300×38.5, **bg rgba(242,241,238,0.6)**, r 6px, p 4px, min-h 28, max-h 240 (scrolls if many pills), 14px/21px; bottom edge = `box-shadow rgba(28,19,1,0.11) 0 -1px 0 0 inset` on the scroller wrapper (1px line under the band). Inner flex row **p 5.25px 8px, gap 6px**, wraps.
- **Pills in the band**: same pill colours as cells, **h 20, r 4px, padding 0 0 0 6px** (no right padding: the × button closes it), lh 16.8 (text span lh 20).
- **Remove ×** `div[role=button].notion-token-remove-button[aria-label="Remove token"]`: **20×20, r 6px, margin 0 2px**, `svg.xMark` 16×16 whose colour = the pill's text shade (Finance → (73,72,70)? measured fill (73,72,70) for both, i.e. a fixed gray, not the hue), `transition background 0.1s ease-in-out`. Hover: **bg rgba(33,27,23,0.051)** + **opacity 0.8**.
- Text input after the pills: plain `<input>`, takes the remaining width (110 here), h 20, no placeholder when pills exist.
- **List**: `div[role=listbox]` (r 10px) > `div` p 4px gap 1px. Hint row "Select an option or create one" **12px / 500 / lh 14.4, c (125,122,117), p 0 8px, margin 6px 0 8px**. While a query is being resolved, a **12×12 circular spinner** (`role=status`, `circle` with `transition stroke-dashoffset 0.5s ease-out`, rotating) appears at the right end of the hint row.
- **Already-selected options stay in the list** (no ✓, no separate section); options are in manual order with drag handle ⋮⋮.
- Option row `div[role=option]`: **292×28, r 6px**, `transition background 0.02s ease-in`; inner `p 0 8px, gap 8px`, 14px/16.8. Highlighted (hover or keyboard-active) row: **bg rgba(33,27,23,0.051)** + `⋯` button visible at the right.
- **Filtering**: typing filters by substring, case-insensitive ("e" hides "Ops"). The **first match is auto-highlighted**.
- **"Create" row** (appears at the bottom, after matches, whenever the query is not an exact existing option — even if other options match): `div[role=option]` 28px, content = "Create" (14px, (44,44,43), lh 18.2, margin-right 6px) + a **preview pill of the query in the colour Notion will assign next** (here yellow: bg rgba(209,156,0,0.282), text (101,81,33), h 20, r 4px, p 0 6px). With no matches ("zzz") the list is only hint + Create row, and the Create row is auto-highlighted (Enter would create — NOT pressed).
- **Keyboard (tested with real keys)**:
  - ↑/↓ move the highlighted row; **focus stays in the text input** (`document.activeElement` = INPUT).
  - Keyboard-active row gets a **focus ring**: `box-shadow: rgb(248,248,247) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px, rgba(255,255,255,0.25) 0 0 0 6px` (2px gap + 2px blue ring outside the row), `outline 2px solid transparent`, r 6px — screenshot `e-multiselect-keyboard-focus-light.png`. Mouse hover gives only the bg.
  - On open with no query, nothing is highlighted; the first ↓ highlights row 0.
  - **Tab closes the editor and moves the cell selection to the next cell to the right** (spreadsheet behaviour; value unchanged).
  - Esc closes the editor (value unchanged), leaving the cell selected; Esc again → row selected; Esc again → cleared.
  - Enter: picks the highlighted option / creates (not pressed here to avoid changes; old capture confirms Enter = create + assign + close for Select).
  - Backspace in an empty input removes the last pill (standard; not pressed).

### 1.2 Status editor
Screenshot: `e-status-editor-light.png`.
- Card **240 wide** (not 300), r 6px, `--menu-shadow`, over the cell. Top band identical to the Select band (bg rgba(242,241,238,0.6), 38.5 tall) with the current status pill (no × on a status pill in the band? — the pill shows without × here).
- **No hint text, no drag handles, no `⋯`** on rows. Options grouped under section headers in fixed group order: **To-do** (Blocked, Not started), **In progress** (Review, In progress), **Complete** (Done).
- Section header: `div` **p 0 8px, margin 6px 0 8px**, text **12px / 500 / lh 14.4, c (125,122,117)** — same style as the Select hint.
- Between groups: divider `div` **1px, width = card − 24 (inset 12px each side), bg rgba(42,28,0,.07)**; each group container `p 6px 4px 4px; margin-top 6px; gap 1px`.
- Option rows 232×28, r 6px, p 0 8px, gap 8px, same hover bg; content = status pill (h 20, r 10px, dot).
- Last row (after a divider): **"Edit property"** with `svg.sliders` 20px fill (44,44,43), label 14px (44,44,43) — opens the property config.

### 1.3 Date picker (Due)
Screenshots: `e-date-picker-light.png` (single date), `e-date-picker-today-light.png` (navigated to Oct 2026 → today marker), `e-date-picker-range-light.png` (range row "Nov 5 → Dec 5, 2026"), `e-date-picker-remind-flyout-light.png`.
- Card `div[role=dialog]` **248 wide** (h 500 single / same with range), **r 6px**, bg #fff, `--menu-shadow`. Placement: anchored to the cell (left-aligned to cell x−1) but **shifted to stay in the viewport** — here the Due column was at the right edge and near the bottom, so the card sat flush at the right (x 1040, right edge 1288 = viewport − 12) and moved up to y 85 (bottom 585 = viewport − 12). → **12px viewport margin** collision rule.
- **Input area**: container p 8px (h 44). Single date: one field **224×28, r 6px, p 0 8px, bg rgba(66,35,3,0.03), box-shadow rgba(28,19,1,0.11) 0 0 0 1px** (1px ring, no border), input 14px/16.8 (44,44,43), text "Dec 15, 2026" (short format "Mon D, YYYY"), **auto-focused with the text fully selected** (blue selection highlight). Range: **two fields side by side, 106.3 + 106.4 wide, gap ≈11px**; the field being edited (start) = **bg rgba(35,131,226,0.15) + box-shadow rgb(39,131,222) 0 0 0 2px inset**; the other = normal field style. No "→" between them.
- Calendar = react-day-picker (`.rdp`), 224×249 at the card's padding (x+8).
  - **Caption row**: month label `h2.rdp-caption_label` "Dec 2026" **14px / 500 / lh 21**, (44,44,43), p 0 3.5px, left. Right side: **"Today"** `div[role=button]` **48×20, p 0 8px, r 3px, 12px / 500, c (142,139,134)**, `transition background 0.1s ease-in-out`; then **‹ ›** buttons `div[role=button][aria-label="Go to previous/next month"]` **20×20, r 3px**, chevron svg ~11px, **fill (165,165,165)**, `transition background 0.02s ease-in`; buttons at x 1228 and 1256 (8px apart). Hover bg = standard hover (not measured distinct).
  - **Weekday header**: "Su Mo Tu We Th Fr Sa" — **12px / 400 / lh 18, c (139,152,152)** (a cool gray, unlike the warm UI grays), centred, row h ≈25.
  - **Day cells**: `td.rdp-cell` **32×32**; `button.rdp-day` **28×28 centred (2px inset), r 6px**, 14px / 400 / lh 16.8, c (44,44,43). 6 week rows always rendered.
    - Other-month days (`rdp-day_outside`): **c (139,152,152)**, same size, clickable.
    - **Hover**: **bg rgba(35,131,226,0.15)**, text unchanged.
    - **Selected** (`rdp-day_selected`): **bg (39,131,222), c #fff**, r 6px, weight 400.
    - **Today** (`rdp-day_today`, 12 Oct): button bg transparent, text **#fff**, red disc = `::after` **24×24, border-radius 100%, bg (229,100,88), z-index −1**, centred → white number on a red circle (circle, not rounded square).
    - **Range**: start/end days = selected style (solid (39,131,222), white text); if the end day is an outside-month day it gets **bg rgba(35,131,226,0.43)** with the gray outside text. The band = per-cell `div.rdp-range-overflow` (absolute, z −1, h 28, **bg rgba(35,131,226,0.21)**): 32 wide for middle cells, 30 wide for cells at a week's ends, with **radius 6px 0 0 6px on Sunday / the start day, 0 6px 6px 0 on Saturday / the end day** → a continuous pale-blue band per week row with rounded ends; in-range day text stays (44,44,43) (outside-month in-range days keep their gray).
- **Rows under the calendar** (each `div[role=button]` **240×28, r 6px, inner p 0 8px gap 8px**, 14px/16.8 (44,44,43), hover bg standard, `transition background 0.02s ease-in`):
  1. divider (1px, 224 wide at x+8, bg rgba(42,28,0,.07), container p 4px)
  2. **End date** + toggle
  3. **Date format** + value "Full date" (**14px / lh 20, c (125,122,117)**) + chevron `svg.arrowChevronSingleDownSmall`-class glyph rendered as **›**, 14×14, fill (173,169,163). (In this build the row is labelled just "Date format" — no "& timezone".)
  4. **Include time** + toggle
  5. **Remind** + value "None" + ›
  6. divider
  7. **Clear** (plain row, 14px (44,44,43), NOT red)
  8. divider
  9. **Learn about reminders** — `a[role=link]` row, `svg.questionMarkCircle` 20px fill (142,139,134), text **c (125,122,117)**.
- **Toggle (switch)**: track `div` **30×18, r 44px, p 2px**, off **bg rgba(135,131,120,0.3)**, on **bg (39,131,222)**, `transition background 0.2s, box-shadow 0.2s`; knob `div` **14×14, r 44px, bg #fff**, `transition transform 0.2s ease-out, background 0.2s ease-out` (on = translateX(12px)); hidden `input[role=switch]` 30×18 opacity 0 over it. Track right edge at card right − 12.
- **Flyouts** from Date format / Remind (click): standard menu card **r 10px, bg #fff, --menu-shadow**, opens to the **LEFT of the picker** (no room right): Date format = 180×181 (Full date ✓, Short date, Month/Day/Year, Day/Month/Year, Year/Month/Day, Relative); Remind = 250×152 (None ✓, On day of event (9:00 AM), 1 day before (9:00 AM), 2 days before (9:00 AM), 1 week before (9:00 AM)). Rows `div[role=menuitem]` 28px r 6px; ✓ = `svg.checkmarkSmall` 16px fill (44,44,43) at the right. Flyout right edge overlaps the picker by 4px (flyout x+w = picker x + 4); top shifted so the menu fits above the viewport bottom (`--x-top: -46px`). Animation: wrapper `opacity 1; transform scaleX(1) scaleY(1); transition-property opacity, transform; 200ms ease; transform-origin 0% right` → **fade + scale from the edge nearest the parent**.
- Escape: closes a flyout first, then the picker (a keyboard focus ring then shows on the last row). Values unchanged (verified the row texts after).
- Caveat: midway the Chrome window was resized externally to 761×715; restored to the 1300×597 viewport before continuing (the measurements above are all at 1300×597).

### 1.4 Person picker (Owner)
Screenshots: `e-person-picker-light.png` (names blanked to "Jane Doe"), `e-person-picker-nomatch-invite-light.png`.
- Card **240 wide**, r 6px, `--menu-shadow`, over the cell (x−1, y−1). Same top band as Select (bg rgba(242,241,238,0.6), r 6px, p 4px, h 38.5); input placeholder **"Search for people or groups…"** (14px / lh 20, placeholder grey ≈ (161,158,153)), autofocused.
- Hint "Select as many as you like" — 12px / 500 / lh 14.4, c (125,122,117) (same hint style as Select).
- User row: 232×28, inner p 0 8px gap 8px; **avatar 20×20 circle** (bg #fff, `outline 1px solid rgba(42,28,0,0.07)`, initial 11px / lh 20 c (142,139,134) centred — same avatar as the cell); name 14px (44,44,43); the current user gets a suffix **"(You)"** span 14px / lh 20 **c (125,122,117)**. **No email line** is shown for workspace members in this build (only name + (You)).
- With a non-matching query ("zzz"): section header **"People"** **11px / 500 / lh 13.2, c (125,122,117)** (note: 11px, smaller than the 12px hints), then muted line "No matches in <workspace name>" **14px, c (161,158,153)**, p-left 2px, ellipsis; divider (1px, inset 12px, rgba(42,28,0,.07)); section **"More"** with row **"Invite people"** (`svg.inviteMember` 20px fill (56,56,54) + label 14px (44,44,43) + `svg.arrowChevronSingleRightSmall` 16px fill (142,139,134) at the right) — NOT clicked.
- Escape closed it with no change.

### 1.5 Relation picker (Client)
Screenshots: `e-relation-picker-light.png`, `e-relation-picker-row-hover-light.png`, `e-relation-picker-noresults-create-light.png`.
- **Much wider: 560px** (min-h 65), r 6px, `--menu-shadow`, anchored at the cell (x−1, y−1); takes ~1s to populate (an empty card shows first).
- **Search header** (not the grey band of Select): `div` 560×33, **bg rgba(66,35,3,0.03), p 6px 10px, bottom line `box-shadow rgba(28,19,1,0.11) 0 1px 0 0`**, no radius of its own. Input placeholder **"Link or create a page…"** 14px/21. Right side: "In" 14px **c (125,122,117)** + `svg.collection` (database) 20px fill (142,139,134) + "**Clients**" **14px / 600**, (44,44,43), underlined with the 1px gradient `rgba(28,19,1,0.11)` (clickable: switches the target DB). When a query is typed a **clear (×) button 24×24** appears before "In" (`svg` circle-× ≈16px gray).
- Section label "**1 selected**" / "**Select more**" — 12px / 500 / lh 14.4, c (125,122,117), at x+16. "1 selected" row has a **`⋯` 24×24 button** at the right (`aria-label="Customize shown properties"`, r 6px, c (125,122,117)).
- Page rows `div[role=button]`: **544×32 (32 tall, not 28), r 4px, p 2px 4px 2px 0, margin 0 4px**; `svg.pageEmpty` 18–20px fill (142,139,134-ish gray); title **14px / 500**, (44,44,43), **underlined with the 1px gradient** rgba(28,19,1,0.11) (same as the relation cell). Hover/highlight bg here = **rgba(55,53,47,0.06)** (the legacy warm-gray token, slightly different from the standard 0.051 hover).
- Trailing button on the highlighted row: selected page → **"−" `aria-label="Unlink page"`** (`svg.dashLongSmall` 16px fill (142,139,134)); unselected page → **"+" `aria-label="Link page"`** (`svg.plusSmall`). Each **20×20, r 4px**, rendered as a small white square with a 1px light ring (see screenshots), `transition background 0.1s ease-in-out`; only visible on the hovered / highlighted row (the first selected row is highlighted on open).
- No match ("zzz"): label "No results" (12px/500 gray, with the `⋯` at right) then the create row: `div[role=button]` **552×32, r 6px**, highlighted (bg rgba(33,27,23,0.051)): `+` icon 20px gray, "**New**" 14px **c (125,122,117)**, "**zzz**" 14px (44,44,43) margin 0 4px, "**in**" gray, db icon + "**Clients**" (44,44,43). Footer: 👍 👎 icons + "**Give search feedback**" **12px / lh 18, c (161,158,153)** (row at the bottom, above a 1px divider). Not clicked; Escape closed it (relations verified unchanged).

### 1.6 URL / Email / Phone cell editing
Screenshots: `e-url-cell-hover-quickactions-light.png`, `e-url-cell-editor-light.png`.
- **Hover on a filled URL cell** shows a floating **quick-action box** (`div.quickActionContainer`) **52×24, p 2px, r 6px, bg #fff, shadow = the light "OPEN-button" shadow** (`rgba(25,25,25,.027) 0 8px 12px 0, rgba(25,25,25,.027) 0 2px 6px 0, rgba(42,28,0,.07) 0 0 0 1px`), placed **top-right inside the cell: right edge = cell right − 5, top = cell top + 6**. Two 24×20 buttons, r 4px: **Comment** (`svg.commentFilledSmall` 16px fill (142,139,134), `aria-label=Comment`) and **Copy to Clipboard** (`svg.duplicateSmall`). Button hover bg rgba(33,27,23,0.051); tooltip = dark chip (bg (44,44,43), 12px (240,239,237), r 6px, p 5px 8px) 6px above. **There is no "open link ↗" button** in this build — the link text itself opens the URL (a new tab). The same quick-action box appears on Text/Number/Email cells (d-table D4 recorded it in dark).
- Click (on the padding, not the link) → the standard cell editor (§1.0): 240 wide, `<input>` 14px/21, shows the **full URL with protocol** ("https://example.com/legal"), no underline / no path greying while editing. Email/Phone use the same editor (Email verified to share the `<input>` editor pattern; Phone property not in the fixture).

### 1.7 Checkbox
Screenshot: `e-checkbox-hover-light.png`. Cell button `div[role=button]` 199×36, **p 10px 8px**; box 16×16 r 3px border 1px rgba(27,21,0,0.19), `transition background 0.2s ease-out`; **hover → bg rgba(66,35,3,0.047)** on the box (border unchanged). Single click toggles (no editor; not toggled here). Checked = d-table §6a.

### 1.8 Files cell
Screenshots: `e-files-cell-empty-editor-light.png`, `e-files-cell-filled-editor-light.png`.
- Empty cell click → card **240×34**, r 6px, `--menu-shadow`, list p 3px 4px: one row "**+ Add a file or image**" (`svg.plus` 20px fill (142,139,134), label 14px **c (125,122,117)**), 28px, r 6px.
- Filled cell click (on padding) → card **288 wide** (grows with the file name): file row 28px: drag handle `svg.dragHandleFillSmall` 16px (142,139,134), `svg.pageEmpty` 20px fill (56,56,54), name "https://example.com/spec.pdf" 14px (44,44,43), `⋯` (`svg.ellipsisSmall` 16px) at the right; divider (1px, inset 12px); then the "+ Add a file or image" row.
- **Not captured: the Upload / Embed link popover.** Clicking "Add a file or image" produced no in-page popover in this build (it appears to go straight to the native file chooser, which the extension cannot see or drive). Clicking the file chip itself opens the file URL in a new tab (closed again).

## 2. Property header menu — Light
Screenshots: `e-header-menu-priority-light.png` (top), `e-header-menu-priority-bottom-light.png` (scrolled; Calculate flyout fading in on hover), `e-header-menu-delete-hover-light.png`, `e-change-type-flyout-light.jpg`, `e-header-menu-keyboard-light.png`, `e-header-menu-name-light.png`.

### Opening / placement
- **Single left-click on the header cell** opens it (no separate chevron). If a menu/editor is already open, the first click only closes it and a second click is needed. The menu appears ~200ms after the click with `opacity 0→1; transform scaleX/scaleY → 1; transition-property opacity, transform; 200ms ease; transform-origin 0% top` (fade + slight scale from the top-left).
- Container = `div[role=dialog]` > `div.notion-scroller.vertical` (scrolls; thin overlay scrollbar), **bg #fff, r 10px, --menu-shadow**, max-height = viewport − 24.
- **Width: 248px for a 200px column; 268px for the 280px title column** → width ≈ max(248, column width − 12). (Old spec 248 confirmed for normal columns.)
- **x = header cell x − 6.** Preferred **y = header bottom** (directly below the header row, e.g. Name menu at y 202 = header bottom). When it does not fit below (Priority: 418 tall), it is **shifted up to stay 12px inside the viewport bottom**, so it overlaps the header (top at y 167).

### Header row of the menu (rename field)
- Row at the top (p ≈ 8px 4px 4px): **icon button** `div[role=button][aria-label="Change icon"]` **28×28, r 6px, border 1px solid rgba(28,19,1,0.11)** (a real border here), `transition background 0.1s ease-in-out`; the type icon inside is the mask icon (16.8px, `transform: scale(1.2)`, painted **(85,83,78)**).
- Name field box (6px right of the button) **181×28 (Priority) / ~210 (Name), r 6px, p 3px 6px, bg rgba(66,35,3,0.03)**, auto-focused with the blue focus ring `rgb(35,131,226) 0 0 0 1px inset, rgb(35,131,226) 0 0 0 1px`; `<input placeholder="Property name">` 14px / lh 20 (44,44,43). Trailing **ⓘ** `svg.infoCircleFill` **15.25px, fill (142,139,134)** inside the field at its right (description affordance).

### Rows (all `div[role=menuitem]`, **h 28, row pitch 29 (1px gap)**, width = menu − 8 (4px side padding), r 6px, inner **p 0 8px gap 8px**, 14px / lh 16.8 (44,44,43), icons 20px fill **(44,44,43)** (dark, not gray), submenu chevron `svg.arrowChevronSingleRightSmall` 16px fill (142,139,134) at the right; `transition background 0.02s ease-in`; hover/keyboard-active bg rgba(33,27,23,0.051))
Select property (Priority), in order:
| Row | icon class | › | notes |
|---|---|---|---|
| Edit property | sliders | › | only for types with config (Select/Number/…); opens the config sidebar (§4) |
| Property access | lock | | NEW row vs old capture |
| Change type | arrowSquarePathUpDown | › | flyout |
| AI Autofill + badge "Now with agents" | magicWand | › | badge: **11px / 500 / lh 14.3, c (39,131,222), bg rgba(0,124,215,0.094), r 4px, p 2px 4px, margin-left 6px** |
| — divider — | | | |
| Filter | filter | | |
| Sort | arrowUpDown | › | flyout "Sort ascending / Sort descending" (no separate asc/desc rows in the main menu) |
| Group | squareGridBelowLines | | |
| Calculate | sum | › | (d-table §7) |
| Freeze | pin | | **enabled** on Priority (not greyed) |
| Hide | eyeSlash | | absent on the title column |
| Unwrap content | arrowLineRight | | label reflects state (wrap is ON) |
| — divider — | | | |
| Insert left | arrowRectangleLeft | | |
| Insert right | arrowRectangleRight | | |
| Duplicate property | duplicate | | enabled (old capture's greyed state not reproduced) |
| Delete property | trash | | **NOT red at rest** (44,44,43); **on hover the label AND icon turn (229,100,88)** + standard hover bg |
- Divider: `div` **1px, bg rgba(42,28,0,0.07)**, width = menu − 39 (inset ~12px left, ~27px right because of the scrollbar gutter), inside a p 4px block → ~9px vertical space around it.
- **Title column ("Name") menu** — fewer rows: rename field (icon button shows "Aa") / **Show page icon** (`svg` smiley + a **toggle, ON**, same 30×18 switch as the date picker) / AI Autofill › / — / Filter / Sort › / Group / Calculate › / Freeze / Unwrap content / — / Insert left / Insert right. **No** Edit property, Property access, Change type, Hide, Duplicate or Delete.
- **Submenus open on HOVER** (also on click / →). Hovering Calculate while scrolling opened its flyout.

### Change type › flyout
- Opens to the **right** of the menu, **overlapping it by ~19px** (menu right 1026, flyout x 1007); vertically aligned to the hovered row but **clamped 12px inside the viewport** (here pushed up to y 12). Size **200×418** (max-height, scrolls). Wrapper `transition-property opacity; 200ms ease; transform-origin 50% left` (fade only).
- One column, **no search field**. Rows 177×28 (pitch 29), icon 20px fill **(142,139,134)** (GRAY here, unlike the main menu's dark icons), label 14px (44,44,43). Order: Text, Number, Select ✓, Multi-select, Status, Date, Person, Files & media, Checkbox, URL, Email, Phone, Formula, Relation, Rollup, Created time, Created by, Last edited time, Last edited by, Button, Place, ID.
- Current type: `svg.checkmarkSmall` **16px fill (44,44,43)** at the right.
- **Disabled type ("ID" for a Select)**: `aria-disabled=true`, **the whole row has `opacity: 0.4`** and `cursor default` (icon opacity 0) — i.e. disabled is done with **opacity 0.4**, not a separate colour token (spec §5's `--menu-fg-disabled` rgb(188,186,182) ≈ the visual result; implement as opacity .4 to match exactly).

### Keyboard (tested with real keys, mouse parked outside)
- Focus starts in the **name input**; **↓/↑ move the highlighted row while focus stays in the input** (`activeElement` = INPUT). The highlighted row gets the hover bg only (no focus ring in this menu).
- **→ on a row with › opens the flyout and moves focus into it** (`activeElement` = the flyout `div[role=menu]`, first item "Sort ascending" highlighted with a **blue focus ring** like §1.1).
- **← closes the flyout**; focus then drops to BODY (the parent menu stays open, last row still highlighted).
- **Tab**: no visible effect (menu stays open, focus on BODY).
- **Esc**: closes the innermost flyout first, then the menu (fade-out 200ms).
- Enter not pressed on action rows (would apply sort/filter etc.).

### Correction: two disabled styles exist
- **Header-menu row disabled (Freeze on the LAST column)**: label + icon **c (188,186,182)**, `cursor default`, row opacity 1 → matches spec `--menu-fg-disabled` (L). Freeze was enabled on a middle column (Priority) and disabled on the right-most column (TMP).
- **Change-type flyout disabled type (ID)**: whole row **opacity 0.4**, icon hidden. Use each where it occurs.
- Header menu on the last column was pushed left to fit (x 927 for a column at 934 → right edge stays ≤ viewport − 125? it was right-aligned under the toolbar; the rule is: clamp so the 248px menu stays inside the scroller).
- A **Text** property's menu has no "Edit property" row (no per-type config); starts with Property access.

## 3. "+" add property → type picker — Light
Screenshots: `e-type-picker-light.png`, `e-type-picker-bottom-light.png`, `e-type-picker-search-open-light.png`, `e-type-picker-search-te-light.png`.
- Clicking the header "+" **scrolls the table to the end and inserts a pending header cell** in place of "+" with a name field: box **393×28, bg #fff, r 6px, p 2px 4px, margin 0 11px**, leading emoji/icon button (☺ `svg` gray, 20px) and `<input placeholder="Type property name…">` 14px / lh 14 (placeholder gray). Nothing is created until a type is picked; Esc discards it (header count verified unchanged).
- Picker card hangs **4px below the header row** (top y 202): **415×298 (max-h ≈ viewport − header − 12, scrolls), bg #fff, r 10px, --menu-shadow**, right-aligned to stay inside the viewport (x 873 → right edge 1288 = viewport − 12). (Old spec 378px → now **~404 content / 415 box**.)
- **Section "AI Autofill"** header: 12px / 500 / lh 14.4, c (125,122,117), `p 0 8px; margin 2px 0 4px 3px`. Rows (28px, r 6px, standard row style, first row highlighted on open): **Summarize** `[Basic]` ›, **Translate** `[Basic]` ›; badge "Basic" = **11px / 500 / lh 14.3, c (142,139,134), bg rgba(42,28,0,0.07), r 4px, p 2px 4px** (gray, vs the blue "Now with agents" badge). Then a 1px divider.
- **Section "Select type"** header + a **magnifier** (`svg` 14px, fill (142,139,134), inside a small 20×20 r 4px button right after the label). Click → a search field expands under the header: **368×28, bg rgba(66,35,3,0.03), r 6px, p 3px 6px, blue focus ring**, placeholder **"Search types…"**, autofocused. Filtering is **substring on the label** and applies to all type groups ("te" → Text, Date, Multi-select | Created time, Created by, Last edited time, Last edited by | GitHub Pull Requests, Zendesk Ticket); AI Autofill rows stay visible (unfiltered). Matches keep their 2-column grid positions packed left-to-right (one match = one cell, not a full-width row).
- **Grid**: each `div[role=row]` 384 wide = **two `div[role=gridcell]` 192×32** (row pitch 34 → 2px vertical gap, 0 horizontal gap), cell r 6px, inner **p 0 8px, gap 8px**, 14px/16.8 label (44,44,43) (margin-right 4px), icon 20px **fill (142,139,134)** gray (the same mask icons as the headers). Hover bg rgba(33,27,23,0.051).
- Type order (L→R, top→bottom), groups separated by 1px dividers, **no group headers after "Select type"**:
  1. Text, Number / Select, Multi-select / Status, Date / Person, Files & media / Checkbox, URL / Phone, Email
  2. Relation, Rollup / Formula, Button / ID (**disabled**: opacity-greyed, only one ID per DB) , Place
  3. Created time, Last edited time / Created by, Last edited by
  4. Integrations: Google Drive File, Figma File / GitHub Pull Requests (ellipsized), Zendesk Ticket — each with a **small blue circular "↑" badge** after the label (not clicked).
- Picking **Text** with name "TMP" created the column immediately and closed the picker (no config step for Text). (TMP was then deleted — see below.)
- **Keyboard in the type picker** (inconsistent, as the old spec suspected): with focus in "Search types…", **↓ moved focus OUT of the input (activeElement → BODY)** and scrolled the list, highlighting a cell; → did not visibly move between columns. Esc cancels the whole new-property popover.

### Delete-property confirm modal (Notion modal, not a browser dialog)
Captured on TMP (header menu → Delete property):
- Backdrop: full-viewport `div` **bg rgba(15,15,15,0.6)**.
- Card `div.notion-dialog[role=dialog]` **406×169, centred (x 447, y 214), bg #fff, r 12px, p 20px, margin 0 24px**, `box-shadow: rgba(25,25,25,0.24) 0 24px 48px 0, rgba(25,25,25,0.14) 0 4px 12px 0, rgba(42,28,0,0.07) 0 0 0 1px`, `transition: transform 0.2s`, `text-align center`, max-height 549.
- Text "Delete this property from Projects? It will be removed from all views." **16px / 600 / lh 24, (44,44,43)**, centred, wraps to 2 lines (366 wide).
- Buttons stacked full width (366×32), **8px apart**, r 6px, p 0 12px, **14px / 500**, `transition background 0.02s ease-in`:
  - **Delete**: text **(229,100,88)**, **border 1px solid rgba(206,24,0,0.165)** (red-tinted), bg transparent.
  - **Cancel**: text (44,44,43), border 1px solid rgba(28,19,1,0.11).
  - Hover bg not captured (read as transparent immediately after hover).
- Clicking Delete froze that tab's renderer (CDP timeouts); a fresh tab showed TMP still present → deletion retried below.
- Retried in a fresh tab: Delete → modal (screenshot `e-delete-property-modal-light.jpg`) → **Delete**: TMP removed (header list back to the original 19 properties). The modal closes instantly; no toast observed.

## 4. Edit property — Light
**Correction to the old spec (§3 "config sidebar 483px"):** from the column header menu, **Edit property opens an adjacent FLYOUT, not the docked sidebar.** (The 483px docked sidebar is the view-settings host; not re-opened here.) The flyout opens on the side with room (here to the LEFT of the header menu, its right edge overlapping the menu by ~4px), top-aligned with the "Edit property" row; wrapper `transition-property opacity; 200ms ease; transform-origin 0% right` (fade). Card **300 wide, bg #fff, r 10px, --menu-shadow**, list p 4px, rows 28px r 6px (standard). The header menu stays open behind it.

### 4a. Select (Priority) — `e-edit-property-select-light.png`, `e-edit-property-select-sort-light.jpg`, `e-edit-property-select-new-option-light.png`
- Row **Sort** (`arrowUpDown` icon 20px (44,44,43)) + value "**Manual**" **14px c (161,158,153)** (fg3, lighter than the date picker's (125,122,117) values) + › (`arrowChevronSingleRightSmall` 16px **fill (173,169,163)**). Click → dropdown **250×94** BELOW the row, right-aligned to it (transform-origin 100% top, opacity+scale 200ms), the row's chevron rotates to point down; items Manual ✓ / Alphabetical / Reverse alphabetical.
- Divider (1px, inset 8px, rgba(42,28,0,.07)).
- Section header "**Options**" (12px / 500 / lh 14.4, c (125,122,117), p 0 8px, margin 6px 0 8px) with a **"+" button 20×20, r 6px** at the right (`svg.plus` 20px fill (142,139,134), `transition background 0.1s ease-in-out`).
- Click "+" → an input appears at the top of the list: **276×28, bg rgba(66,35,3,0.03), r 6px, p 3px 6px, blue focus ring**, placeholder "**Type a new option…**" (14px / lh 20). Esc removed it without creating anything.
- Option rows: container **292×28, p 0 8px 0 4px, gap 8px**: drag handle (20×24 box, `svg.dragHandleFillSmall` 16px fill (142,139,134), `cursor grab`) + **pill** (standard option pill h 20, r 4px, p 0 6px) + › (16px fill (173,169,163)) at the right → opens the option colour menu (d-table §6c). Order = manual order (Someday, Urgent, High, Medium, Low).
- Bottom: divider, then "**Generate with AI**" row (`svg.aiFace` 20px fill (56,56,54)). NOT hovered/clicked (it starts an AI request).
- No "Changes apply to all views" footer for Select.

### 4b. Status — `e-edit-property-status-light.jpg`
- Same 300px flyout; **no Sort row**. Three groups, each a header row "To-do" / "In progress" / "Complete" (12px / 500 gray, p 0 8px) with a **"+" 20px button** at the right (add option to that group); options under each with drag handle + status pill (dot) + ›. The default option shows a right-aligned tag "**DEFAULT**" (**12px / 500 / lh 16.8, c (161,158,153), `text-transform: uppercase`**) before its ›.
- Status header menu has an extra row at its end: **"Display as" + value "Select" ›** (eye icon) — Status can render as Select or Checkbox; Freeze was disabled on it (right-most visible column).

### 4c. Number (Budget) — `e-edit-property-number-light.jpg`, `e-number-format-list-light.jpg`, `e-number-decimal-places-light.jpg`
- Flyout 300×205 (opened to the RIGHT here: room on the right). Rows: **Number format** value "US Dollar" ›, **Decimal places** value "Default" › (values 14px **(161,158,153)**, chevrons (173,169,163)); divider; "**Show as**" label (12px / 500 gray, at x+16).
- **Show-as cards**: row container margin 6px 8px 0, **gap 6px**, three `div[role=button]` **83.3×48, r 6px, p 6px 12px, margin 1px**, `transition background 0.02s ease-in`:
  - unselected: `box-shadow rgba(42,28,0,0.07) 0 0 0 1px` (1px ring), content c (125,122,117);
  - **selected: `box-shadow rgb(39,131,222) 0 0 0 2px`**, content **c (39,131,222)**.
  - Content: preview glyph on top ("42" 16px text / a bar = track 59×4 r 1000px bg rgba(42,28,0,0.07) with a 30×4 fill (142,139,134) / a 20px ring svg with stroke (142,139,134)), label below **12px / 400 / lh 12** ("Number", "Bar", "Ring").
- Footer "**Changes apply to all views showing this property.**" **12px / lh 18, c (161,158,153), margin 12px 10px 0, p-bottom 6px** (no divider).
- **Number format list**: a separate card **217×418** (max height, scrolls) opened beside the flyout, aligned to the top of the viewport area (`--x-top:-76px`, transform-origin 100% top, opacity+scale 200ms). Search field at top **193×28, bg rgba(66,35,3,0.03), r 6px, p 3px 6px, blue focus ring, placeholder "Filter formats…", autofocused**. 45 rows (same list/order as the old raw capture `20-edit-property-panel.md`), 28px rows; first row highlighted; **no ✓ on the current format** (US Dollar) in this build.
- **Decimal places**: dropdown 250 wide **below the row** (row chevron rotates down): Default ✓, 0, 1, 2, 3, 4, 5.
- Escape order: closes the innermost list, then a blue keyboard-focus ring shows on the row that opened it; further Escapes close flyout then menu (needed 3–4 presses total).

### 4d. Date (Due) — `e-edit-property-date-light.jpg`
Flyout rows (icons 20px (44,44,43) on the left this time): **Date format** "Full date" › (`calendar` icon), **Time format** "12 hour" › (clock), **Notifications** "None" › (alarm clock). No footer. (Freeze was greyed in Due's menu too, though Due is a middle column → Freeze is disabled for every column right of some limit, not just the last.)

### 4e. Formula (Score) — `e-edit-property-formula-light.jpg`, `e-formula-editor-light.jpg`
- Flyout: **Edit formula** › (pencil icon) / Number format "Number" › / Decimal places "Default" › / divider / Show as cards (same as Number) / footer.
- **Edit formula** opens a large anchored panel (not a centred modal; no backdrop): `div[role=dialog]` **740×541, bg #fff, r 10px, --menu-shadow**, placed at x 238, y 44 (fills the viewport height minus 12px margins).
  - Header: "**Edit formula**" **16px / 600 / lh 24** + (?) help icon; **close ✕** `div[role=button]` **24×24, r 100%, bg rgba(42,28,0,0.07)** at the top right.
  - AI bar: box **716×40, r 10px, bg #fff, `box-shadow rgba(0,0,0,0.04) 0 2px 4px 0, rgba(42,28,0,0.07) 0 0 0 1px`, p 0 8px, gap 6px**; Notion-AI face icon + contenteditable placeholder "**Write, fix, or explain a formula…**" 14px/20 + a round ↑ submit button (gray) at right.
  - **Code editor**: box **716×96, bg (249,248,247), r 10px, blue focus ring** (`rgb(35,131,226) 0 0 0 1px inset, … 0 0 0 1px`); `div[role=textbox]` **p 12px, font 12px / lh 18 monospace** (`SFMono-Regular, Menlo, Consolas, "PT Mono", "Liberation Mono", Courier, monospace`). Property reference = token chip **bg rgba(84,72,49,0.15), r 4px, p 2px 4px**, with the property-type icon (#) + name "Budget" 12px (44,44,43). Syntax colours: operator "/" **(154,110,58)**, number "1000" **(153,0,85)**.
  - Preview strip: "**Preview with**" 12px / 500 (125,122,117) + page chip "Annual report ▾"; at right "Debug mode" 12px (125,122,117) + 30×18 toggle; result "**22**" 14px / lh 21 **(125,122,117)**; type badge "**Type: number**" **11px / 500, c (142,139,134), bg rgba(42,28,0,0.07), r 6px, p 2px 5px**.
  - Bottom split: left list (228 wide, scrolls) — section "**Built-ins**" (12px / 500 gray) then rows 205×28 r 6px: type icon (#, ☑ …) + function/operator (14px) + an "↵" hint on the highlighted row (first row highlighted with the standard hover bg). Right pane: title "# *" (14px / 600), description "Multiplies two numbers." **12px / lh 18 (125,122,117)**, example blocks **491 wide, r 5px, border 1px solid (240,239,237), p 0 6px**, code 11px / lh 16.5 monospace (numbers (153,0,85), functions pink), a copy button at right.
  - Autocomplete while typing NOT captured (typing would edit the formula). Escape closed the editor without changes (formula still `Budget / 1000`).

### 4f. Relation (Client) — `e-edit-property-relation-light.jpg`, `e-relation-two-way-light.jpg`
- Flyout 300×94: **Related to** (disabled: row `opacity 0.4`, cursor default) with value = db icon + "**Clients**" (14px / 600, 1px gradient underline rgba(28,19,1,.11)); **Limit** "No limit" › (icon "123"); **Two-way relation** (ⓘ-style (?) icon after the label) "On" ›.
- Two-way relation › opens a dropdown below (row chevron rotates down): **Enable** + toggle ON (30×18 blue); label "Related property name" 12px gray; input (blue focus ring) value "Projects". Escape closed it unchanged.
- (Old raw `relation-config-panel.txt` described the 483px docked sidebar; from the header menu it is now this flyout.)

### 4g. Rollup (Client industry) — `e-edit-property-rollup-light.jpg`, `e-rollup-calculate-light.jpg`
- Header menu for a rollup: icon button = magnifier; rows: Edit property › / Property access / Change type › / — / Filter / **Sort (disabled, (188,186,182))** / Group / Calculate › / Freeze (disabled) / Hide / Unwrap content / — / Insert left / Insert right / … (no AI Autofill).
- Flyout 300 wide: **Relation** "↗ Client" ›, **Target property** "(select icon) Industry" ›, **Calculate** "Show original" ›. Values carry the property-type icon (16px gray) before the name, (161,158,153) text.
- Calculate › dropdown (below, 200 wide): **Show original ✓**, Show unique values, Count ›, Percent ›.

### 4h. Button (Action) — `e-button-automation-editor-light.jpg`
- Header menu: rename field / **Edit automation** (pencil) / Property access / Change type › / — / Freeze (disabled) / Hide / — / Insert left / Insert right / Duplicate property / Delete property (no Filter/Sort/Group/Calculate).
- **Edit automation opens a centred MODAL**: backdrop rgba(15,15,15,0.6); card `div.notion-dialog` **500×421, r 12px, bg #fff, modal shadow** (`rgba(25,25,25,.24) 0 24px 48px 0, rgba(25,25,25,.14) 0 4px 12px 0, rgba(42,28,0,.07) 0 0 0 1px`), `transition transform 0.2s`. Title "Action" (editable, 16px); **close ✕ 20×20 (p 4px) circle, bg rgba(55,53,47,0.06)** top-right; 1px rule under the title; sections "**When**" / "**Do**" labels **12px / 500 / lh 15.6, c (161,158,153)**; trigger card "Button is clicked" (bordered card, r 6–10px); a vertical connector line; action card "Edit [↗ This page ▾]" with chip **bg rgba(42,28,0,0.07), r 4px, p 0 4px, 14px**, then property row "☑ Done ▾" → value (checked checkbox) in a select box; footer **Save** button **460×32, bg (39,131,222), text (243,249,253) 14px / 500, r 6px**. Closed with ✕ (nothing saved).

### 4i. ID (Ref) — `e-edit-property-id-light.jpg`
- Header menu: Edit property › / — / Filter / Sort › / Calculate › / Freeze (disabled) / Hide / Unwrap content / — / Insert left / Insert right / Delete property (no Change type, no Group, no Duplicate).
- Flyout **300×114**: "Prefix" 14px label + input **222×28, bg rgba(66,35,3,0.03), r 6px, ring rgba(28,19,1,0.11) 1px, p 3px 6px** (value "PRJ"); hint "PRJ-1, PRJ-2, PRJ-3, …" **12px / lh 16, c (161,158,153)**; button "**Update ID Prefix**" **276×28, bg (39,131,222), text (243,249,253) 14px / 500, r 6px, `opacity 0.4` + cursor default while unchanged** (disabled style for primary buttons = opacity .4).

### 4j. Last edited time (Edited) — `e-edit-property-edited-time-light.jpg`
- Header menu: Edit property › / Change type › / — / Filter / Sort › / Group / Calculate › / Freeze (disabled) / Hide / Unwrap content / — / Insert left / Insert right / Duplicate property (disabled colour) / …
- Flyout: **Date format** "Full date" ›, **Time format** "12 hour" › (same rows as Date minus Notifications). Created time is the same type family (not opened separately).

## 5. Grouped table ("Table — grouped" view, group by Status) — Light
Screenshots: `e-group-header-hover-light.png`, `e-group-collapsed-light.jpg`, `e-group-options-menu-light.jpg`.
- Each group = header row + its own full table header row (Name, Notes, …) + rows + "+ New page" row; groups follow the Status option order (Blocked, Not started, Review, In progress, Done — the To-do/In progress/Complete group order then option order). Groups with no rows after the filter are not shown; **no "Hidden groups" section** and **no "No Status" group** appear in this view.
- **Group header row**: `div` **h 42**, margin-left 8px (starts at table x), cursor text. Contents (vertically centred, y = row top + 9):
  - **Collapse toggle** `div[role=button]` **24×24, r 4px**, `transition background 0.02s ease-in`, `aria-label` "Close" when expanded / "Open" when collapsed (aria-expanded); glyph `svg.arrowCaretDownFillSmall` **11.2px, fill (44,44,43)** (a solid ▼), `transition transform 0.2s ease-out`; collapsed = **rotated −90° (▶)** (`matrix(0,-1,1,0,0,0)`). Hover bg standard rgba(33,27,23,0.051).
  - **Group pill** inside a `div[role=button]` **p 3px, r 6px** (84.8×26), `transition background 0.02s ease-in`, hover bg rgba(33,27,23,0.051); pill = the normal Status pill (h 20, r 10px, dot) — Select groups would use the select pill.
  - **No count** next to the pill in this view (the group "⋯" menu offers "Show aggregation", i.e. the count is hidden by a view setting).
  - On hover of the header row: **"⋯"** `div[role=button][aria-label="Show group options"]` **24×24, r 6px** (`svg.ellipsisSmall` 16px fill (142,139,134)) and **"+"** `[aria-label="Add new page in group"]` 24×24 (`svg.plusSmall` 16px fill (142,139,134)), placed right after the pill (0 gap between them), `transition opacity 0.1s ease-in-out` (hidden at rest).
- **Spacing**: header row 42 → table header (36) directly below → rows (37 each) → "+ New page" row (37) → **~14px gap** → next group header (e.g. Blocked group header y 166, its New-page row y 323, next header y 367).
- **Collapsed group**: only the 42px header row remains (▶ toggle with hover bg, pill, ⋯ +); the next group header follows immediately (y 166 → 208).
- **Group "⋯" menu**: standard menu card **180×123, r 10px, --menu-shadow**, 4px below the ⋯ button, left-aligned to it: **Edit groups** (grid icon), **Show aggregation** (eye), **Hide group** (eye-slash), **Move to Trash** (trash) — rows 28px. Not clicked (Escape). The Blocked group was collapsed and re-expanded (restored).
- **No filter/sort chips row**: although this view has a filter (Priority is not Someday) and a sort (Due ascending), the chips bar is NOT shown under the toolbar in this build; instead the toolbar **Filter and Sort icons turn blue** (active). See §6.

## 5. Grouped table ("Table — grouped" view, group by Status) — Light
Screenshots: `e-grouped-table-light.jpg`, `e-group-header-hover-light.png`, `e-group-collapsed-light.png`, `e-group-options-menu-light.png`.
(Session resumed 2026-10-13 after a usage-limit stop: fixture re-verified — 19 properties, no TMP, row values unchanged; Light; 1300×597.)
- Each group = header row + its own full table header row (Name, Notes, …) + rows + "+ New page" row; groups follow Status order (Blocked, Not started, Review, In progress, Done). Empty groups are not shown; **no "Hidden groups" section** and **no "No Status" group** in this view.
- **Group header row**: `div` **h 42**, margin-left 8px (starts at table x), cursor text. Contents vertically centred (y = row top + 9):
  - **Collapse toggle** `div[role=button]` **24×24, r 4px**, `transition background 0.02s ease-in`, `aria-label` "Close" when expanded / "Open" when collapsed; glyph `svg.arrowCaretDownFillSmall` **11.2px, fill (44,44,43)** (solid ▼), `transition transform 0.2s ease-out`; collapsed = rotated −90° (▶, `matrix(0,-1,1,0,0,0)`). Hover bg rgba(33,27,23,0.051).
  - **Group pill** inside a `div[role=button]` **p 3px, r 6px** (84.8×26), `transition background 0.02s ease-in`, hover bg rgba(33,27,23,0.051); the pill itself = normal Status pill (h 20, r 10px, dot).
  - **No count** after the pill here (the group ⋯ menu offers "Show aggregation" → the count is hidden by a view setting; when shown it sits after the pill).
  - On header-row hover: **"⋯"** `[aria-label="Show group options"]` **24×24, r 6px** (`svg.ellipsisSmall` 16px fill (142,139,134)) and **"+"** `[aria-label="Add new page in group"]` 24×24 (`svg.plusSmall` 16px), directly after the pill, no gap between them, `transition opacity 0.1s ease-in-out`, hidden at rest.
- **Spacing**: header 42 → table header row 36 → rows 37 → "+ New page" 37 → **~14px gap** → next group header (Blocked header y 166, its New-page row y 323, next header y 367).
- **Collapsed group**: only the 42px header remains; the next group header follows immediately (y 166 → 208).
- **Group ⋯ menu**: card **180×123, r 10px, --menu-shadow**, 4px below ⋯, left-aligned to it: Edit groups (grid icon) / Show aggregation (eye) / Hide group (eye-slash) / Move to Trash (trash), 28px rows. Not clicked. The Blocked group was collapsed then re-expanded (restored).
- **No filter/sort chips row** in this build: this view has a filter (Priority is not Someday) and a sort (Due ascending) but no chip bar is shown under the toolbar; instead the toolbar **Filter and Sort icons are tinted blue** (see §6).

## 6. Filter / sort chips, popovers and toolbar pickers — Light
Screenshots: `e-chips-bar-light.jpg`, `e-chips-zoom-light.png`, `e-filter-chip-popover-light.jpg`, `e-filter-chip-more-menu-light.jpg`, `e-filter-operator-dropdown-light.jpg`, `e-sort-chip-popover-light.jpg`, `e-toolbar-filter-picker-light.jpg`, `e-toolbar-filter-picker-search-light.png`, `e-toolbar-sort-picker-light.jpg`.

### Active state in the toolbar
- When the view has filters/sorts, the toolbar **Filter / Sort icon buttons keep their 28×28 r 6px shape but the svg fill turns (39,131,222)** (inactive (142,139,134)). The chips bar is **collapsed by default**; **clicking the blue Filter button toggles the chips bar** (a per-viewer UI toggle; no data change). It was toggled back to hidden afterwards.

### Chips bar (grouped view)
- Row container **h 44 (p-top 4px)**, under the views bar, spanning the toolbar width; chips vertically centred (y = row top + 12), starting at the table's left edge (x 104).
- **Sort chip** `div[role=button]`: **h 24, p 0 8px, gap 6px, r 32px (full pill), bg rgba(0,124,215,0.094), text/icons (39,131,222)**, 14px / 400 / lh 24, `transition background 0.02s ease-in`. Content: `svg.arrowStraightUpFillSmall` (~8px, ↑ for ascending) + property name "Due" + `svg.arrowChevronSingleDownSmall` (~8.6px). Width 70.
- **Divider** after the sort chip(s): `div` **1×24, border-right 1px solid rgba(42,28,0,0.07), margin 0 6px**.
- **Filter chip**: same pill (h 24, r 32px, p 0 8px, gap 6px, bg rgba(0,124,215,0.094), c (39,131,222)) — the "active filter" colour is this pale blue; content: property-type mask icon (19.2px painted (39,131,222), scale 1.2) + "**Priority**" (**14px / 500**) + ": Not " (400) + "Someday" (400) + chevron ▾. Wrapper for drag (cursor grab, r 14px).
- **"+ Filter"** button: **h 24, p 0 9px 0 5px, r 12px, gap 6px, margin-right 12px**, text 14px / lh 16.8 **c (161,158,153)**, `svg.plusSmall` fill (161,158,153), `transition opacity 0.2s`, no bg at rest.
- No "Reset" / "Save for everyone" buttons appeared (the filter/sort are saved view settings, not unsaved local changes).
- After closing a chip popover with Escape the chip shows a keyboard focus ring (`box-shadow` blue ring).

### Filter chip popover (click the Priority chip)
- Card **260×225, r 10px, --menu-shadow**, 4px below the chip, left-aligned with it.
- Header line (p ≈ 8px 12px): "**Priority**" 12px / 400 / lh 18 **c (161,158,153)** + operator button "**is not ▾**" **12px / 500, c (125,122,117)** (clickable) + at the right a **"⋯" 20×20 r 6px** button.
- Value input = the multi-select token field: `div[role=combobox]` **236×30, bg rgba(66,35,3,0.03), r 6px, p 4px 6px**, focused with the 2px-gap blue ring (`rgb(248,248,247) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px, rgba(255,255,255,.25) 0 0 0 6px`); contains the "Someday" pill with × and a clear-all ⊗ (gray circle-x) at the right.
- Option list: rows 28px: **checkbox 16×16** (checked = blue (39,131,222) with white check; unchecked = 1px border rgba(27,21,0,.19), r 3px) + option pill; first row highlighted.
- **"⋯" menu** (flyout to the right): **Delete filter** (trash), **Add to advanced filter** (filter icon) — NOT clicked.
- **Operator dropdown** (click "is not"): menu below the operator: Is / **Is not** (highlighted) / Is empty / Is not empty — Escape, unchanged.
- Old spec's "property ▾ operator ▾ value input" layout is now this compact header line + token input; there is no "+ Add filter rule" inside a simple filter (that lives in Advanced filter).

### Sort chip popover (click the Due chip)
- Card **317×107, r 10px, --menu-shadow**, 4px below the chip.
- One rule row: drag handle ⋮⋮ (gray, 16px) + **property button** "📅 Due ▾" and **direction button** "Sort old → new ▾" — both **h 32, p 0 8px, gap 8px, r 6px, bg #fff, border 1px solid rgba(28,19,1,0.11), 14px / 500 (44,44,43), margin-right 8px**, `transition background 0.02s ease-in` — then **✕ remove 24×24** (gray x icon).
- Then rows "**+ Add sort**" and "**🗑 Delete sort**" (28px menu rows, label c (125,122,117), icons gray). Not clicked.
- Direction labels are type-aware ("Sort old → new" for dates).

### Toolbar quick-pickers (plain "Table" view, no filters)
- **Filter** (click the Filter icon): card **290×478 (max height), r 10px, --menu-shadow**, right-aligned so it fits (x 939), top y 111 (it overlaps the toolbar row — anchored with its search field level with the button, not below it). Search field **251×28, bg rgba(66,35,3,0.03), r 6px, p 3px 6px, blue focus ring, placeholder "Filter by…", autofocused**. Property rows (`role=option`) **267×28, r 6px**, icon 20px **fill (56,56,54)** (darker than menus' gray) + name 14px; **alphabetical order with Name first** (Name, Attachments, Budget, Client, Client industry, Contact, Created, Done, Due, Edited, Notes, Owner, Priority, Ref, Score, Status, Tags, Website…); first row highlighted. Footer (after a divider) "**+ Add advanced filter**" row, text **c (125,122,117)**. (Old spec width 285 → **290**.)
  - Keyboard: ↓ keeps focus in the search input; typing "pr" filtered to Owner, Priority and the keyboard-active row showed the **blue focus ring** (`e-toolbar-filter-picker-search-light.png`). Escape closed without picking.
- **Sort** (click the Sort icon): identical card (290×478), placeholder "**Sort by…**", 17 property rows (no footer row). Escape closed without picking; both toolbar icons stayed gray (nothing added).

---------------------------------------------------------------------------
# DARK pass (Ctrl+Shift+L; `body.dark`)
Geometry identical to Light everywhere checked (same widths, heights, radii, paddings); only colours/shadows change. All popups use **bg rgb(37,37,37) + the dark `--menu-shadow`** (`rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,.2) 0 14px 28px -6px, rgba(25,25,25,.118) 0 2px 4px -1px`) — including the cell editors (r 6px), date picker, header menu, flyouts, type picker, relation picker and chip popovers.
Screenshots: `e-text-cell-editor-dark.png`, `e-multiselect-create-zzz-dark.png`, `e-multiselect-keyboard-focus-dark.png`, `e-date-picker-range-dark.jpg`, `e-header-menu-change-type-dark.jpg`, `e-edit-property-select-dark.jpg`, `e-type-picker-dark.jpg`, `e-relation-picker-dark.png`, `e-filter-chip-popover-dark.jpg`, `e-chips-zoom-dark.png`.

| Element | Light | Dark |
|---|---|---|
| Cell editor card bg | #fff | **rgb(37,37,37)** (dark menu shadow) |
| Editor text / caret | (44,44,43) | **(240,239,237)** / same |
| Select/multi/status/person top band | rgba(242,241,238,0.6) | **rgba(255,255,255,0.03)** |
| Band bottom line | inset 0 −1px rgba(28,19,1,.11) | **rgba(255,255,235,0.1)** |
| Hint / section labels (12px/500) | (125,122,117) | **(173,169,163)** |
| Token remove × | (73,72,70) | **(173,169,163)** |
| Highlighted row bg | rgba(33,27,23,.051) | **rgba(255,255,255,0.055)** |
| Keyboard focus ring on a row | `(248,248,247) 0 0 0 2px, (35,131,226) 0 0 0 4px, rgba(255,255,255,.25) 0 0 0 6px` | **`rgb(25,25,25) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px, rgb(25,25,25) 0 0 0 6px`** (gap colour = page bg) |
| "Create" label | (44,44,43) | (240,239,237); preview pill uses the dark pill palette (d-table D3) |
| Date picker field (idle) | bg rgba(66,35,3,.03), ring rgba(28,19,1,.11) | **bg rgba(252,252,252,0.03), ring rgba(255,255,235,0.1)** |
| Date field being edited | rgba(35,131,226,.15) + 2px inset (39,131,222) | same |
| Weekday header / outside days | (139,152,152) | **same (139,152,152)** |
| Day text | (44,44,43) | **(240,239,237)** |
| Day hover / range band / outside end | rgba(35,131,226,.15) / .21 / .43 | **same** |
| Selected/start/end day | (39,131,222) + white | same |
| "Today" button text / ‹ › chevrons | (142,139,134) / (165,165,165) | **same** |
| Row values ("Full date", "None") | (125,122,117) | **(173,169,163)** |
| Toggle off / on | rgba(135,131,120,.3) / (39,131,222) | **rgba(202,204,206,0.3)** / (39,131,222) |
| Dividers | rgba(42,28,0,.07) | **rgba(255,255,243,0.082)** |
| Header-menu row text + icons | (44,44,43) | **(240,239,237)** |
| Submenu chevron › | (142,139,134) | **(173,169,163)** |
| Rename field | bg rgba(66,35,3,.03) | **bg rgba(252,252,252,0.03), ring rgba(255,255,235,0.1)** (blue ring when focused, same blue) |
| Icon button border / type icon | rgba(28,19,1,.11) / (85,83,78) | **rgba(255,255,235,0.1) / (211,211,211)** |
| ⓘ in the rename field | (142,139,134) | **(173,169,163)** |
| "Now with agents" badge | (39,131,222) on rgba(0,124,215,.094) | **(39,131,222) on rgba(67,155,255,0.24)** |
| Delete property on hover | (229,100,88) | **same (229,100,88)** |
| Change-type flyout icons | (142,139,134) | **(173,169,163)**; disabled ID row still opacity 0.4 |
| Edit-property values ("Manual") | (161,158,153) | **(125,122,117)** (darker in dark) |
| Edit-property chevrons | (173,169,163) | **(125,122,117)** |
| Drag handles in option rows | (142,139,134) | **(173,169,163)** |
| Generate-with-AI face icon | (56,56,54) | **(230,229,227)** |
| Type picker labels / icons | (44,44,43) / (142,139,134) | **(240,239,237) / (173,169,163)** |
| "Basic" badge | (142,139,134) on rgba(42,28,0,.07) | **(142,139,134) on rgba(255,255,235,0.1)** |
| Pending new-column header box | #fff | **rgb(25,25,25)** (page bg) |
| Relation picker search header | bg rgba(66,35,3,.03), line rgba(28,19,1,.11) | **bg rgba(252,252,252,0.03), line rgba(255,255,235,0.1)** |
| Relation "In" / labels | (125,122,117) | **(173,169,163)** |
| Relation page-title underline | rgba(28,19,1,.11) | **rgba(255,255,235,0.1)** |
| Relation highlighted row | rgba(55,53,47,.06) | **rgba(255,255,255,0.055)** |
| Unlink "−" icon | (142,139,134) | **(173,169,163)** |
| Sort/filter chip bg / text | rgba(0,124,215,.094) / (39,131,222) | **rgba(67,155,255,0.24) / (39,131,222)**; hovered/open chip ≈ rgba(67,155,255,0.36) |
| "+ Filter" text | (161,158,153) | **(125,122,117)** |
| Chip divider | rgba(42,28,0,.07) | **rgba(255,255,243,0.082)** |
| Filter popover: property label / operator | (161,158,153) / (125,122,117) | **(125,122,117) / (173,169,163)** (swapped lightness) |
| Filter token field | rgba(66,35,3,.03) + 2px-gap ring | **rgba(252,252,252,0.03)** + dark ring variant |
| Toolbar active Filter/Sort icon | (39,131,222) | same |

- Extra seen in dark: hovering **AI Autofill ›** in the header menu opens a flyout with two described rows — "**Basic**" (*Limited availability. Uses a fast model to fill properties based on info in the current row.*) and "**Custom Agent** [New]" (*Uses advanced models…*) — rows with a 12px gray description under a 14px title. Not clicked.
- Not re-captured in dark: person picker, files/URL editors, formula editor, delete modal, button automation modal (their colours follow the same dark tokens: card (37,37,37), fields rgba(252,252,252,.03), labels (173,169,163)).

## Final state
- Notion switched back to **Light** (`body.dark` false, `localStorage.theme = {"mode":"light"}`).
- Fixture: no values changed; TMP property created and deleted (only change, as allowed); Blocked group collapse reverted; chips bar toggled back to hidden; no filters/sorts added to the Table view.
- Not captured: Files "Upload / Embed link" popover (native file chooser, not drivable); formula autocomplete while typing (would edit the formula); hover bg of modal buttons; config **docked sidebar (483px)** not re-measured — from the header menu, Edit property is a flyout in this build.
