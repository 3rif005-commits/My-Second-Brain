# (i) Empty states, menus and overlays - raw capture (2026-10-13)
Viewport 1300x649 DPR1, sidebar collapsed (Ctrl+\) for privacy. Light first.

## 1. Empty database (Empty DB, Table view) - Light  (screenshots/i-empty-db-light.jpg)
- Only one view ("Table"); no board view -> nothing else to capture. No "No pages"/empty message, no illustration, NO calculation row.
- Header row (Name with Aa icon, "+ Add property") and the "New page" row are rendered normally; below it the table is padded with **4 ghost rows**.
- Every row below the header (the "New page" row and the 4 ghosts) is the same element: `div.notion-table-view-empty-placeholder[role=button]`, **1100 wide x 37 high (36 + 1px bottom border `1px solid rgba(42,28,0,0.07)`)**, margin-left 8px, cursor pointer, `transition: background 0.2s`. Rows y: 202.4, 239.4, 276.4, 313.4, 350.4 (pitch 37). Total table block 413 high.
- First one holds the label: inner 280px-wide (the Name column) span, 14px/400/lh 20px, colour `rgb(161,158,153)`, padding-left 8px (text "New page", plus icon left of it, see g-other-views.md). The Name column has a right hairline `rgba(42,28,0,0.07)` (vertical line at x383).
- Ghost rows: empty. Clicking any (incl. ghosts) = creates a new page (button role), not clicked.
- **Hover** on a ghost/placeholder row: bg `rgba(55,53,47,0.024)` over the full 1100 width (faint), rest transparent.

## 2. Empty board column - Light
- Projects Board has 5 groups (Blocked 2, Not started 4, Review 3, In progress 4, Done/other 3); none with 0 cards, no "No Status" group rendered. **Not captured: no empty column exists** (see f-board-gallery.md for the filled columns).

## 3. No results (Projects Table view, toolbar search "zzzz") - Light  (screenshots/i-no-results-light.jpg)
- Toolbar search: after clicking the search icon the toolbar expands to an inline `input` (126x16, 14px/400/lh14, colour `rgb(44,44,43)`, placeholder "Type to search..." grey), a round clear button (grey circle with x, at x1081) and the settings-sliders icon. The first click only opened it; a second click in the field was needed to focus. Header row (Name/Notes/Budget/...) stays; all rows vanish; horizontal scrollbar stays.
- No illustration, no message text like "No results". Placement: `div.notion-collection-view-empty-state`, **flex row, justify center, align center, gap 12px, 1108x144 (margin 0 -96px, x96,y202.4 = directly under the header row)**, padding 0, containing only two buttons:
  - **"Clear search"** and **"+ New page"** buttons: `div[role=button]` each **28 high** (97.4 / 97.6 wide), **padding 0 8px, radius 6px, border 1px solid rgba(28,19,1,0.11)**, bg transparent, **14px/500/lh 16.8px, colour rgb(142,139,134)**, "+ New page" icon gap 6px (svg fill rgb(142,139,134)), `transition background 0.02s ease-in`, cursor pointer. Buttons centre vertically at y274 (144px box centre).
  - **Hover**: bg `rgba(33,27,23,0.051)` (text colour unchanged).
- Search cleared afterwards via the round x button (query is local, nothing saved).

## 4. Empty page body (Clients row "<row>" in side peek) - Light  (screenshots/i-empty-page-peek-light.jpg)
- Opened via hover "OPEN" button on the row (clicking the name text opens the Name cell editor instead; Escape closes it). Peek = right half panel (x650..1300).
- Below the properties and the "Comments / Add a comment..." strip (hairline at y~327), the empty body shows ONE prompt line: **"Press 'enter' to continue with an empty page, or <u>create a template</u>"**: `div` x726 (483 wide, 56 high), **16px/400/lh 24px, colour rgb(161,158,153)**, padding **8px 0 24px 8px**. No templates list/gallery here (this DB has no templates). "create a template" is a `div[role=button]` 123.6x24, same grey, `text-decoration: underline`, `transition background 0.02s ease-in`.
- While the page loads, the body shows a **skeleton**: six rows of a light-grey rounded square (~26x26 at x731) + a light-grey bar (~121x14), pitch 35px (y388..563). Gone once loaded (after ~1s) - not measured further.
- Title "<row>" 40px bold at y99; property rows 38px pitch (Industry, Projects), "+ Add a property".

## 9. Emoji / icon picker (click the page icon; fixture page) - Light
Note: the first two clicks on the icon did nothing visible / toggled it, the third opened it (single click opens it). Screenshots: i-emoji-picker-light.jpg, i-icon-picker-light.jpg, i-icon-color-popover-light.jpg.
- **Container** `div[role=dialog]`: **408 x 390**, bg #fff, **radius 10px**, shadow `rgba(25,25,25,0.05) 0 20px 24px 0, rgba(25,25,25,0.027) 0 5px 8px 0, rgba(42,28,0,0.07) 0 0 0 1px` (the standard popup shadow). Position: x125.5,y199 = left edge ~165px left of the icon's left edge, top is at the icon's vertical middle (it OVERLAPS the icon, it does not sit below it). Below the dialog the page is not dimmed (no backdrop).
- **Header row** (tabs + Remove): 40px high (y199..239), padding 0 8px; 1px hairline under it at y239. Tabs `div[role=tab]`: **28 high, padding 0 8px, radius 6px, 14px/400/lh 16.8**, first at x133.5; widths Emoji 51, Icons 49.5, Upload 60.4 (they touch, no gap). Selected tab colour `rgb(44,44,43)`, unselected `rgb(142,139,134)`; hover bg `rgba(33,27,23,0.051)` (the Icons tab is shown hovered in the Icons screenshot), `transition background 0.1s ease-in-out`. **Active underline**: abs div **tab-text width (35px) x 2px, `border-bottom 2px solid rgb(44,44,43)`**, x = tab x + 8 (i.e. under the label only), y237 (bottom of the 40px header).
- **"Remove"** button right-aligned: 68.1x28 at x457.4, **colour rgb(142,139,134)**, 14px/400, padding 0 8px, radius 6px, `background 0.1s ease-in-out`. (No "Random" text button: the random action is the shuffle icon button below.)
- **Search row**: wrapper 408x36 padding 4px 8px gap 8px (y243). Filter box: **322x28, radius 6px, bg `rgba(66,35,3,0.03)`, shadow `rgba(28,19,1,0.11) 0 0 0 1px`** (idle ring), padding 3px 6px, 14px/lh 20px, magnifier icon left, placeholder "Filter..." grey. **Focused ring** (the Icons tab auto-focuses it): `rgb(35,131,226) 0 0 0 1px inset, rgb(35,131,226) 0 0 0 1px` (i.e. 2px blue).
- Right of the filter: two 28x28 buttons (gap 6px): **Random/shuffle** (icon shuffle, `border 1px solid rgba(28,19,1,0.11)`, radius 6px, `background 0.1s ease-in-out`, 14px/500) at x463.5; and on the **Emoji tab: skin-tone button** 28x28 at x497.5 (no border, radius 6px, padding 0 6px, shows a 20px emoji hand, default yellow); on the **Icons tab: colour button** 28x28 at x497.5 (border like shuffle) holding a 14px filled circle `rgb(173,169,163)`.
- **Body scroller** `div.notion-scroller.vertical` 408 x 249 (y~280..529), content width 393 + a **15px native scrollbar** (Chrome Linux classic scrollbar with up/down arrow buttons; styling = `scrollbar-color: rgb(211,209,203) rgba(0,0,0,0)` , `scrollbar-width: auto`; no `::-webkit-scrollbar` rules). Light grey thumb (~rgb 211,209,203-ish), arrows visible (see screenshot).
- **Category header** ("Recent", "People", ...): **12px/500/lh 12px, colour rgb(125,122,117)**, wrapper 393x20 **padding 6px 8px 0, margin 6px 0 8px**, text x133.5.
- **Emoji cell**: **32 x 32, radius 4px, font 24px/lh 36px, no gap (pitch 32)**, 11 per row, first at x137.5 (12px inset from the dialog), `transition background 0.02s ease-in`. **Hover/selected bg `rgba(33,27,23,0.051)`** (the "Recent" cell with the current emoji also has it).
- **Icons tab cells**: 32x32 but **radius 8px**, x starts 141.5 (4px more inset), pitch 32, 24px font box (glyphs are dark grey 24px svg/mask `rgb(44,44,43)`-ish ~ (55,53,47)); hover bg same 0.051; section header "Icons" same style as above but x137.5. Selected/first cell shows the hover bg.
- **Footer = category bar** (Emoji tab only; Icons tab has none): row 393x32 at y548 (below hairline y539): 11 buttons (recent clock, smileys, nature, food, activities, travel, objects, symbols, flags, custom/grid, "+" circle) each **32x32 radius 4px**, icons 20px `rgb(44,44,43)`; the active category (Recent) has bg `rgba(33,27,23,0.051)`. It is a transform-animated strip (`translateY(259px)` on an inner wrapper).
- **Icon colour popover** (click the dot button): box **159.8 x 105, radius 10px, same shadow**, bg #fff, at x497.5,y275 (directly below the button, left-aligned to it). Contains two rows of five **22x22 hit areas (radius 6px) with a 20px dot svg** (row 1: grey, light grey, brown, orange, ...? shown as pale discs; row 2: green, blue, purple, pink, red), hairline divider, then a **row 151.8x28 radius 6px, hover bg rgba(33,27,23,0.051)** "Ask every time" (14px/400/lh 16.8, `rgb(44,44,43)`) + **toggle switch ON**: track **30x18, radius 44px, padding 2px, bg rgb(39,131,222)**, knob **14x14 white radius 44px, translateX(12px)** (off state: see page-menu in b-shell: bg rgba(135,131,120,0.3)).

### 9b. Upload tab - Light (screenshots/i-icon-upload-light.jpg)
- Dialog shrinks to **408 x 192** (same r10/shadow), header identical. Body padding 16px: **"Upload an image" drop button 376x48, radius 4px, bg `rgba(66,35,3,0.03)`**, 14px/400, colour rgb(125,122,117) with image icon; hint "or Ctrl+V to paste an image or link" **12px/400/lh 18px rgb(161,158,153)**, margin-top 10px, centred, 376x18.
- Footer: **Cancel** (59.6x28, radius 6px, padding 0 8px, 14px/400, rgb(125,122,117), hover bg 0.051) at left; **Save** (47.9x28, radius 6px, padding 0 8px, **bg rgb(39,131,222), text rgb(243,249,253), 14px/500**) at right. **DISABLED style** (`aria-disabled=true`): **opacity 0.4, cursor default** - same colours, just faded.
- Tooltip verified on the colour button: "Select icon color": dark pill bg rgb(44,44,43), text rgb(240,239,237), 12px/400/lh 16.8, **padding 5px 8px, radius 6px, shadow `rgba(0,0,0,0.08) 0 4px 12px -2px, rgba(255,255,255,0.05) 0 0 0 1px inset`, max-width 300px, width max-content**; centred horizontally under the trigger with a **6px gap** (button bottom 275 -> tooltip top 281).

## 5. General menu anatomy (page "..." menu; fixture page) - Light  (screenshots/i-page-menu-light.jpg, i-menu-danger-hover-light.png)
Most numbers are already in b-shell.md section 2b (256 wide, r10, standard shadow, rows 28 high, hints, dividers, switch), c-page-blocks.md (block menu) and e-table-editing.md section 2 (check, disabled, headers). Only ADDITIONS here:
- **Danger row ("Move to Trash")**: at rest identical to other rows (label rgb(44,44,43), icon rgb(56,56,54)). **On hover: label AND icon turn `rgb(229,100,88)` and bg = standard hover `rgba(33,27,23,0.051)`** (JS-applied; also sticks until another row is hovered). Same red as the sidebar unread badge.
- Row icon colour is `rgb(56,56,54)` for all normal rows (20px svg); chevron-row "Use with AI" icon is `rgb(44,44,43)`; hint text on the right `rgb(161,158,153)` 12px.
- **Toggle OFF** (Small text / Full width / Lock page): track 30x18 r44 `rgba(135,131,120,0.3)` padding 2px, knob 14px white translateX(0); **ON** = track `rgb(39,131,222)`, knob translateX(12px) (verified in the icon-colour popover, see 9). Track is right-aligned at the row end.
- Section structure: rows | 1px divider `rgba(42,28,0,0.07)` | rows ...; no header text in this menu. Menus WITH headers: block menu ("Text", 12px/500 lh 14.4 rgb(125,122,117), `padding 0 8px; margin 6px 0 8px`), status editor, view settings (see other files).
- Disabled: see e-table-editing.md "two disabled styles" (opacity 0.4 on whole row, OR label/icon rgb(188,186,182) with opacity 1). Check mark: `svg.checkmarkSmall` 16px fill rgb(44,44,43) right-aligned. Submenu chevron: 16px `svg.arrowChevronSingleRightSmall` fill rgb(142,139,134).
- Keyboard-active row = same bg as hover (0.051), see e-table-editing.md.

## 11. Scrollbars - Light
- Notion defines ONE global rule: **`* { scrollbar-color: rgb(211, 209, 203) rgba(0, 0, 0, 0); }`** (thumb `rgb(211,209,203)`, transparent track), `scrollbar-width: auto`. **No `::-webkit-scrollbar` rules** except `.hide-scrollbar { scrollbar-width: none }` + `::-webkit-scrollbar{display:none;width:0!important;height:0!important}` (used for hidden-scroll strips).
- Therefore the scrollbar is the browser's own: on this Chrome/Linux it is the classic **15px wide** bar with up/down arrow buttons and a rounded light thumb (see screenshots: emoji picker, page menu, main page). On macOS/overlay-scrollbar OSes it is a thin overlay thumb. To recreate: copy the CSS rule above; do not draw a custom bar.
- Menu scroller (`div.notion-scroller.vertical`, overflow hidden auto): bar width 15 (offsetWidth-clientWidth), horizontal strips (`notion-scroller horizontal`, overflow auto hidden) bar height 15. Main page scroller (right edge of viewport) also 15px.

## 6. Tooltip with shortcut (hover the top-bar hamburger) - Light
- "Lock sidebar open" + second line "Ctrl+\" : same dark pill as b-shell (bg rgb(44,44,43), 12px/400/lh 16.8, padding 5px 8px, radius 6px, shadow `rgba(0,0,0,0.08) 0 4px 12px -2px, rgba(255,255,255,0.05) 0 0 0 1px inset`). Box 114.1 x 43.6 (title line 16.8 + shortcut line 16.8 + 10px). Title colour rgb(240,239,237); the **shortcut is NOT a chip**, just a plain 12px `span` on its own line, **colour rgb(173,169,163)**, no bg. Placed to the right of the trigger (x42 vs trigger x16..32), top y10 (aligned to the trigger top), appears after ~0.5s hover delay. (Single-line tooltip: bottom-centred, see section 9b.)

## 7. Modal / dialog (Settings; opened via workspace switcher menu > Settings) - Light  (screenshots/i-modal-settings-light.jpg)
- Structure: `div` fixed full-viewport flex centre (z-index 999 root) containing (1) **`div.notion-modal-underlay[role=presentation]`: position absolute inset 0, bg `rgba(15,15,15,0.6)` (var --ca-modUndBac), no blur, no transition measured**, and (2) **`div.notion-dialog[role=dialog]`**: position relative, z-index 1, bg #fff, **radius 12px**, `overflow hidden`, **width 90vw (max 1512px), height calc(100% - 100px)** = 1170 x 497 at x65,y50 in the 1300x597 viewport (50px top/bottom margin, centred), **shadow `rgba(25,25,25,0.24) 0 24px 48px 0, rgba(25,25,25,0.14) 0 4px 12px 0, rgba(42,28,0,0.07) 0 0 0 1px`** (var --c-shaOutScr), **`transition: transform 0.2s`** (open = transform from a small offset/scale to `matrix(1,0,0,1,0,0)`; final value identity).
- Close button: top-right `div[role=button]` **22x22, radius 100%** at x1201,y62 (12px from the dialog top/right... dialog right = 1235), `background 0.1s ease-in-out`, x icon; hover bg standard 0.05.
- Left nav column (x65..305, ~240px, own scroller with 15px bar): search field 224x28 at x73,y58 (radius 6px, bg `rgba(66,35,3,0.03)`, blue focus ring `rgb(35,131,226) 0 0 0 1px inset, 0 0 0 1px`, auto-focused, padding 4px 6px, 14px/lh 20px); section labels ("Account", "Workspace", "Features") 12px grey; nav items 209x28 (x73), radius 6px, padding 4px 6px, gap 6px, 14px/400, selected bg `rgba(33,27,23,0.05)`, `transition background 0.1s ease-in-out`. Content column: title "Preferences" 24px-ish bold, hairline-separated sections, selects as outlined buttons, toggle switch OFF (30x18). Contents are the next batch's job.
- Escape closes it.

## 7b. Workspace switcher popup (click the workspace row in the sidebar) - Light (not saved: shows account data)
- Menu card **300 x 516, radius 10px, standard popup shadow**, at x8,y84 (below the switcher row, left-aligned, appears with `transform translate(-4px,0)` mid-animation), bg #fff. Rows **284x28 (x16), radius 6px**, label 14px/400 `rgb(44,44,43)` at x48 (icon 20-22px at x24); selected workspace has a **white-on-blue `checkmark` svg (14px) at the right** (blue fill on a dark disc); blue text rows ("Upgrade", "New workspace") use `rgb(39,131,222)`; account-email section label 12px grey with a "..." 20px button right; footer "Log out all accounts" 12px grey (never clicked).

## 10. Date mention picker (click an inline date mention "@Yesterday" on the page) - Light (screenshots/i-date-mention-picker-light.jpg)
- Same date popover as e-table-editing.md 1.3, **248 x 500, radius 10px, standard popup shadow**, anchored below-left of the mention but flipped up/left (here x400,y85). Contents identical: date input (value pre-selected, highlighted), month header + "Today" + prev/next, 7x6 grid (selected day blue pill, today = red/coral filled circle 13), then rows **End date (toggle)**, **Date format "Relative" >**, **Include time (toggle)**, **Remind "None" >**, hairline, **"Clear"** (14px/400 rgb(44,44,43), x412), hairline, footer **"? Learn about reminders"** (14px/400 **rgb(125,122,117)**, icon left). Difference vs the property cell picker: the mention variant shows "Date format: Relative" (not "Full date") and has the Clear row; no other layout change. Escape closes it without changing the mention.

## 12. Focus ring - Light (screenshots/i-focus-ring-light.png)
- Keyboard focus (`:focus-visible`) is drawn with **box-shadow rings, outline hidden** (`outline: rgba(0,0,0,0) solid 2px`, so it still shows in forced-colors mode).
- **Top-bar icon button (More)**: `box-shadow: rgb(248,248,247) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px, rgba(255,255,255,0.25) 0 0 0 6px`, radius stays 6px: i.e. 2px light gap, 2px **blue rgb(35,131,226)** ring, faint 2px white halo outside.
- **In-text page-link mention (Tab from the editor)**: `outline: none; outline-offset 1px; box-shadow: rgb(255,255,255) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px` (white gap + blue ring, no halo).
- Inputs use a different ring: `rgb(35,131,226) 0 0 0 1px inset, 0 0 0 1px` (2px blue, see search fields). Mouse clicks never show the ring (only keyboard).

# DARK pass (Ctrl+Shift+L; body bg rgb(25,25,25)). Sizes, positions, radii identical to Light; only colours/shadows differ.

## D9. Emoji / icon picker - Dark (screenshots/i-emoji-picker-dark.jpg, i-icon-picker-color-dark.jpg)
- Dialog bg **rgb(37,37,37)**, shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.2) 0 14px 28px -6px, rgba(25,25,25,0.118) 0 2px 4px -1px` (same dark popup shadow as b-shell). Text rgb(240,239,237).
- Tabs: selected + underline `rgb(240,239,237)` (underline 2px same colour), unselected `rgb(142,139,134)`; Remove `rgb(142,139,134)`; category headers ("Recent", "People") **rgb(173,169,163)**.
- Filter box bg `rgba(252,252,252,0.03)`, idle ring `rgba(255,255,235,0.1) 0 0 0 1px` (also the shuffle button border), focus ring unchanged blue `rgb(35,131,226)` 1px inset + 1px.
- Emoji cell hover / selected bg **`rgba(255,255,255,0.055)`**. Icon glyphs on the Icons tab render light grey (~rgb(200,199,196)); colour dots unchanged hues (grey 211/127, brown 170,117,95, orange 202,142,27 / 216,118,32, green 45,153,100, blue 46,124,209, purple 141,91,193, pink 201,64,121, red 205,73,69) displayed at reduced opacity.
- Colour popover: bg rgb(37,37,37), same dark shadow; "Ask every time" row hover bg `rgba(255,255,255,0.055)`, label rgb(240,239,237); toggle ON track `rgb(39,131,222)`, knob white (identical to light).

## D5. Menu - Dark (screenshots/i-page-menu-danger-dark.jpg)
- Popup bg rgb(37,37,37) (see b-shell dark). Normal row label `rgb(240,239,237)`, icon `rgb(230,229,227)`, hint `rgb(125,122,117)`, hover bg `rgba(255,255,255,0.055)`.
- **Danger row hover**: label + icon **`rgb(229,100,88)`** (same red as light), bg `rgba(255,255,255,0.055)`.

## D6. Tooltip - Dark
- Identical to light: bg `rgb(44,44,43)`, text `rgb(240,239,237)`, shadow `rgba(0,0,0,0.08) 0 4px 12px -2px, rgba(255,255,255,0.05) 0 0 0 1px inset` (the 1px inset white 5% line separates it from the dark page). Shortcut line (when present) `rgb(173,169,163)`.

## D7. Modal (Settings) - Dark (screenshots/i-modal-settings-dark.jpg)
- Backdrop `div.notion-modal-underlay`: **`rgba(15,15,15,0.8)`** (Light 0.6). Dialog bg **rgb(32,32,32)**, shadow **`rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.64) 0 24px 48px 0, rgba(25,25,25,0.56) 0 4px 12px 0`**. Text rgb(240,239,237). Selected nav item bg `rgba(255,255,255,0.082)`. Close button hover = round bg (22px). Search field blue focus ring unchanged. The Theme select shows "Dark"; toggle OFF track grey (`rgba(202,204,206,0.3)`-like), knob white.

## D11. Scrollbar - Dark
- Global rule becomes **`* { scrollbar-color: rgba(255, 255, 255, 0.2) rgba(0, 0, 0, 0); }`** (thumb 20% white, transparent track). Still no `::-webkit-scrollbar` styling; same 15px native bar on Chrome/Linux.

## D12. Focus ring - Dark
- Top-bar button: `box-shadow: rgb(25,25,25) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px, rgb(25,25,25) 0 0 0 6px` (gap + halo colour = page bg rgb(25,25,25); the blue ring is unchanged).

## D1. Empty database - Dark (screenshots/i-empty-db-dark.jpg)
- Row hairlines `rgba(255,255,243,0.082)`; "+ New page" label/icon `rgb(161,158,153)`-ish grey (icon fill measured rgb(240,239,237) container, drawn at reduced opacity); hover bg of a ghost row **`rgba(255,255,255,0.055)`**.
- **Behaviour (verified in dark, applies to light too): the "+ New page" label+icon is drawn in whichever placeholder row the mouse is over; at rest (no hover) it sits in row 1.** The other 4 rows are empty; the 5 rows are the same component (`notion-table-view-empty-placeholder`), hover moves the label, so a recreation needs: 5 placeholder rows, each shows the "+ New page" content only while hovered (row 1 by default).

## D3. No results - Dark (screenshots/i-no-results-dark.jpg)
- Same layout. "Clear search" / "+ New page" buttons: text + icon `rgb(142,139,134)`, border `1px solid rgba(255,255,235,0.1)`, bg transparent; hover bg `rgba(255,255,255,0.055)` (standard dark hover).

## Problems / not captured (this batch)
- Empty board column (none exists), Empty DB other views (none), confirmation dialog (skipped, nothing zero-risk beyond e-table-editing's), Upload tab dark, template-picker/gallery modal (needs creating a page).
- **Accident 1**: after navigating to the reference page a stray "zzzz" keystroke typed into the page TITLE ("zzzUI Reference (Claude)"); I corrected it and restored the exact title "UI Reference (Claude)" (it generated 2-3 brief edit events in Notion's history). Rule learned: after `navigate`, the title/editor can hold focus: never use `type` unless JS confirms `document.activeElement` is the intended input.
- **Accident 2**: a mis-click on "New" in the Projects Table toolbar created one blank "New page" row (peek opened); I moved that single blank row to Trash through its own page menu ("Move to Trash", recoverable; it will be in Trash). The original 9 rows are intact.
- Sidebar peek and the workspace switcher expose real workspace/account names; those screenshots were NOT saved (the saved Settings screenshots have the name blanked to "Jane Doe"; the dimmed sidebar behind the modal shows only fixture titles truncated).
