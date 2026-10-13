# (g) List / Calendar / Timeline / Chart — raw capture
Date 2026-10-13. Viewport 1300x597 DPR1, sidebar collapsed (content x=104..1181, 1077 wide, = 8 + 96 page padding). Notation as d-table.md.
Fixture: Projects DB, view "List" shows Name + **Created** (a date) only.

## 1. List view — Light  (screenshots/g-list-light.jpg)
- Collection wrapper `.notion-collection_view_page-block`: `padding 4px 0`, width 1077. First row top y=171 (views bar bottom 166 + 4 + 1).
- Row `.notion-selectable.notion-page-block.notion-collection-item`: **h 30, margin 1px 0 -> pitch 32px**, no dividers/borders between rows (none at all).
- Inside: `a` (full-row link, flex, align center, **radius 6px, padding 0 0 0 4px**, `transition background 0.02s ease-in`) > left div (flex, **padding 0 8px 0 0, r 5px**, 893 wide) + right div (properties, **padding 0 8px, r 5px**, 180 wide, content right-aligned; text 164 wide).
- Icon box: div **22x22, r 3.5px, margin-right 5px**, svg 18x18 (default page icon, **fill (161,158,153)**; document outline).
- Title: div **14px / 500 / lh 21px, c (44,44,43)**, margin-right 5px, nowrap. (Title is weight 500 in list, not 400.)
- Property (Created date) on the right: **14px / 400 / lh 21px, c (44,44,43)**, nowrap, plain text (no pill, no label), right edge at x=1173 (8px inside the row). Only shows properties set visible; text colour for dates is body text, not gray.
- **Row hover**: `a` bg **rgba(55,53,47,0.06)**, r 6px, spans 104..1181 (full width 1077) h 30. No shadow.
- Hover controls: left of the row in the page gutter: **"+" (Click to add below) 24x24 at x=60** (svg fill (173,169,163), r 4px) and **drag handle 18x24 at x=84** (⋮⋮, color (44,44,43), 16px); both appear on row hover only. After the title: **"Edit" (open in peek) button 26x20, white bg, r 6px, icon svg 16x16 fill (125,122,117)** at x=title end+~17 (title x 135 + text width + 5 ... was x=305 for "Legal compliance review"), vertically at row y+5, **no border/shadow in computed style** (visual: faint 1px outline, see screenshot). Click on row opens the page (full-page/peek by setting); the Edit button opens the page "edit/peek".
- **"+ New page" row** (after last row; shown at rest): div h 30, **padding 0 8px 0 6px, r 6px, 14px/400/lh21, c (161,158,153)**, plus svg 18x18 fill (161,158,153), `transition background 0.02s ease-in`; hover bg = same rgba(55,53,47,0.06) (assumed, not captured).
- Bottom padding of page: 180px below the collection.

## 2. Calendar (by Due, month) — Light  (screenshots/g-calendar-light.jpg; scrolled view not saved)
Calendar block frame: x=105..1181 (1076 wide), white bg (255,255,255) wrapper. Week starts **Sunday**.
### Header row (div flex, h 42, margin-bottom 2px, y=166)
- Month label "October 2026": **14px / 600 / lh 14px, c (44,44,43)**, margin 0 8px (x=113). No year/month dropdown, plain text.
- Right cluster (vertically ~y 175-199): 
  - **"Manage in Calendar"** button: h 24, **padding 0 6px, r 6px, border 1px solid rgba(28,19,1,0.11), 14px/500/lh16.8 c (44,44,43)**, inline-flex, 16px icon (calendar app icon) left, `transition background 0.02s ease-in`; wrapper margin 2px 8px 0 0. (Link to Notion Calendar app; don't click.)
  - **‹ ›** arrows: each button **24x24, r 6px**, svg 20x20 **fill (142,139,134)**, `transition background 0.1s ease-in-out`.
  - **"Today"** button between arrows: h 24, w 49.4, **padding 0 6px, r 6px, 14px/400/lh16.8, c (44,44,43)**, same transition. Order: ‹ Today ›, right edge at x=1181.
- "No date (2)" button in the VIEWS bar toolbar (left of Filter): h 28, w 82, **padding 6px, r 6px, 14px/400/lh14, c (142,139,134)**, hover transition background 0.1s ease-in-out. Opens a popup listing undated pages.
### Weekday header (div h 24 at y=210, 1076 wide)
- Labels (Sun Mon ... Sat): **12px / 400 / lh 18px, c (161,158,153)**, centred in each 153.7px column. Row has **box-shadow rgb(230,229,227) 0 1px 0 0** (1px bottom line). No weekend highlight in the header.
### Grid
- Container: `padding-top 1px`, **box-shadow rgb(230,229,227) -1px 0 0 0** (left outer line); 7 columns of **153.7px (= 1076/7)**.
- Day cell: **border-right 1px + border-bottom 1px solid (230,229,227)** (#e6e5e3). No top border except the 1px under the weekday row. Height **124px** for rows with <=1 event row (rows grow: +34px per extra event lane, i.e. 3px+28px chip+3px). All cells in a week row equal height. No "+N more" overflow exists: rows just grow (verified: weeks with up to 3 lanes).
- **Weekend cells (Sun, Sat)**: bg **(249,248,247)**. Weekdays: transparent over white. **Out-of-month days** (27-30 Sep, Nov 1-7...) have no extra bg (only the weekend tint), but number colour is gray.
- **Day number**: div 24px tall (14px/400/**lh 24px**), placed at cell top+4 (y=cell+4), text right edge **11px from cell right edge**; colour **(44,44,43)** in-month, **(161,158,153)** out-of-month, `transition color 0.1s ease-out`. First of month shows "Oct 1" / "Nov 1" (short month name prefix) instead of "1".
- **Today (13)**: number in a **24x24 circle, r 100%, bg (229,100,88) = #E56458, text white (255,255,255) 14px/400**; circle right edge 5px from the cell right edge (so number sits ~6px further right than a normal day), top = cell top+4.
- Event area wrapper under the number: starts cell top+30, **padding 3px 6px** (3px 0 for full-bleed middle segments), each lane 34px = chip 28 + 3+3.
### Event chips (page chip)
- Chip `a`: **h 28 (padding 2px 0), r 6px, bg white, box-shadow `rgba(0,0,0,0.04) 0 2px 4px 0, rgba(42,28,0,0.07) 0 0 0 1px`** (1px hairline ring + soft drop), `transition background 0.02s ease-in`. Width = cell width - 12 (141.7).
- Inner: `padding 0 6px`; title text **14px / 600 / lh 21px, c (44,44,43)**, nowrap/ellipsis. NO icon, NO time in these chips (properties hidden; page icon hidden).
- **Hover on chip: bg rgba(84,72,49,0.08)** on the `a` (shadow unchanged). A **"+" add button** also shows in that day cell.
- **Multi-day range bar**: single event spans cells as continuous bar per week row. First segment (starts this row at event start): **r 6px 0 0 6px**, starts at cell x+6 (padding-left 6) and runs to the right edge of the row (bleeds off the right side: row padding-right 0, inner padding-right 11px). Middle/continued segments: **r 0, full bleed from the row's left edge (x=105) to the right edge, inner padding-left 12px**, so the title repeats at the start of each week row. Ending segment gets right r 6px (not seen). **Hover on one segment tints ALL segments of that event** (bg rgba(84,72,49,0.08) incl. the lanes in other weeks).
- Lanes: a range bar occupies a fixed lane across weeks; single-day chips fill lanes below.
### Day cell hover: "+" add button (aria-label "Add an item")
- Appears at the top-LEFT of the hovered cell (x=cell+8, y=cell+8... outer box at cell+6/+6): outer **24x24, p 2px, bg white, r 8px, box-shadow `rgba(25,25,25,0.05) 0 20px 24px 0, rgba(25,25,25,0.027) 0 5px 8px 0, rgba(42,28,0,0.07) 0 0 0 1px`**; inner button **20x20, r 6px, `transition background 0.1s ease-in-out`**, svg 20x20 plus **fill (142,139,134)**. Clicking creates a new page dated that day (not clicked).
- Clicking a chip opens the page (peek/full per setting; not clicked). Cell itself has no hover bg.

## 3. Timeline (by Due, scale Month) — Light  (screenshots/g-timeline-light.jpg, g-timeline-today-light.jpg, g-timeline-scale-menu-light.jpg, g-timeline-nodate-popup-light.jpg)
**Left table panel: NOT captured** — it is collapsed in this view (the `»` toggle at x=98 exists: div 24x22, padding 0 4px, r 6px, margin 1px 4px 0 2px, hover `background 0.1s ease-in-out`, double-chevron icon). Clicking would persist a view setting, so it was not clicked.
The timeline is **full-bleed** (not constrained to the 96px page padding): it spans the whole 1285px scroller, starts at x=0; horizontal scrollbar at bottom (y~589). Header row is sticky.
### Header
- Top row (div h 36, y=167): left cluster **padding 6px 0 0 96px** = `»` toggle + sticky month/year label; right cluster (**padding 7px 96px 0 0**): "Manage in Calendar" (same button as calendar, 14px/500, border 1px rgba(28,19,1,0.11), r 6, h 24), **Month ▾** scale selector, ‹ **Today** ›.
- Pinned label "September 2026"/"October 2026": **14px / 500 / lh 21px, c (44,44,43)**, x=126. A month-start label ("November") is **14px/500/lh21, c (44,44,43), padding-top 13px** (sits in the 2nd line-box at y~188, aligned with first day of the month).
- Scale selector "Month": button h 24 w 66.8, **padding 0 6px, r 6px, 14px/400/lh16.8, c (142,139,134)**, chevron-down 16px right; `transition background 0.1s ease-in-out`. **Today** button: h 24, w 49.4, padding 0 6px, r 6, 14px/400, c (44,44,43). Arrows ‹ › as in calendar (24x24, r6, 20px svg fill (142,139,134)).
- **Scale menu** (click Month): card **180w x 239h, bg white, r 10px, padding 4px, menu shadow `rgba(25,25,25,0.05) 0 20px 24px, rgba(25,25,25,0.027) 0 5px 8px, rgba(42,28,0,0.07) 0 0 0 1px`**, top-left x=1020.8 (aligned with the button), 4px below it. Rows (Hours, Day, Week, Bi-week, Month, Quarter, Year, 5 Years): **h 28, w 172, r 6px, padding ~0 8px, 14px/400, c (44,44,43)**, selected row bg **rgba(33,27,23,0.051)**, `transition background 0.02s ease-in`; row pitch 29px(28 + 1px).
- **Day scale row** (div h 32, y=202, **box-shadow rgb(230,229,227) 0 -1px 0 0 inset** = 1px bottom line): each day label cell **40px wide, h 28**, label **12px / 400 / lh 28px, c (161,158,153)** centred. Today's label: **pill 22x22, r 11px, bg (229,100,88), text white 12px/500/lh18**, (for 2-digit numbers its inner box is 27.4x18 with padding 2px 7px).
- **Hovering a bar highlights its date range in the header**: a div h 22, r 11px, bg (247,247,247), spanning the bar's days (x from bar start-4..), start-day label gets bold dark text (dark blue-ish (35,131,226)-like on zoom; not measured exactly).
### Grid
- Scroller content (9300px wide here), top y=166.4/234 body, **bg (253,253,253)** (grid is faintly gray vs white header).
- **No vertical day lines.** **Weekend columns**: 80px wide (Sat+Sun, 2x40) **bg (247,247,247)** full height.
- **Today line**: div **1px wide, border-right 1px solid (229,100,88) (#E56458)**, full height of the body, at x = day centre. **Dot** at the top: **7x7 circle bg (229,100,88)** at line x-3, y just below the header line (y=231), overlapping the header border.
- Rows: **36px each** (bar 34 + margin 1px 0). Row 1 top at y=234 in unscrolled layout.
### Bars (page bars)
- Bar div: **h 34, margin 1px 0, bg white, r 6px, box-shadow `rgba(0,0,0,0.04) 0 2px 4px 0, rgba(42,28,0,0.07) 0 0 0 1px`** (same as calendar chips). Width = days*40 - 3 (1-day bar = **37px**), left = day-column left + ~2px.
- Inside: `a` full bar, **padding 0 6px, r 6px, cursor pointer, `transition background 0.02s ease-in`**; **hover bg rgba(33,27,23,0.051)**. Title text **14px / 500 / lh 21px, c (44,44,43)** (weight 500 here, vs 600 in calendar), nowrap; **if the bar is shorter than the title the title overflows to the right of the bar, unclipped, with no bg** (e.g. 1-day bar "Pricing experiment": bar 37px, text 116px wide drawn beyond it). No icon, no colour fill by property.
- **Resize handles**: two invisible **8px-wide x 34px-tall** divs at the bar edges (left at bar.x-6, right at bar.right-2), **cursor col-resize**, NO visible styling on hover (no handle graphic). Also a 24px-wide icon slot at the bar end (22x30, cursor pointer, empty here).
- **Off-screen indicators**: bars outside the visible range show a **16x16 chip, bg (142,139,134), r 4px, 1px white border, white arrow svg 14px** pinned at the left (x=8, arrow ←) or right (x=right-8-16, arrow →) edge at the bar's row; `transition transform 0.16s ease-in-out, opacity 0.16s`. Click scrolls to the bar (not clicked).
### Rows without dates
- Shown via the toolbar button "No date (N)" (same as calendar) which opens a popup: **320 x 143 card, r 10, menu shadow as above, bg white**, at x=857, y=164 (below the button, right-aligned to 1177): search input "Search for a page…" (focused: blue ring, ~298x28), caption "Click to add to the timeline" **12px c (161,158,153)**, then rows (page icon 20px, title 14px, **"Open" link at right, 14px c (142,139,134)**). No dashed placeholders in the grid; undated rows are not drawn. Escape closes.

## 4. Chart (vertical bar, group by Status, count) — Light  (screenshots/g-chart-light.jpg, g-chart-tooltip-light.jpg)
- Views bar toolbar on Chart is reduced: **Filter + Settings (sliders) + New** only (28x28 buttons, r 6, p 6px, c (125,122,117), hover transition background 0.1s). Settings button not opened.
- **No chart title, no legend, no caption.** Chart = one `svg` **1092 x 400** (viewBox 0 0 1092 400), x=104..1196 (this view has no 15px scrollbar so it is 15px wider than the 1077 content column), y=174 right under the views bar. Transparent bg. Font: Notion UI stack, SVG text.
- Plot area: **x=129, y=194.4, w 1057, h 343** (left axis gutter 25px, top pad 20, bottom pad 37 for category labels). 5 categories -> each band **211.4px** wide; ordering = alphabetical by option? (Blocked, Not started, Review, In progress, Done = status sort order; not sorted by count).
- **Grid**: horizontal lines at y= 0,2,4,6,8 (4 intervals; 85.75px apart: y 537.9/451.9/366.9/280.9/193.9), **stroke (230,229,227), 1px, dasharray "1 3"** (dotted), full plot width. The y=0 baseline is **solid 1px (230,229,227)** (the same stroke, no dash — it renders as a solid axis line). Vertical grid lines exist in the DOM with stroke-width 0 (invisible). No axis line on the y axis.
- **Y axis labels**: `text` 12px/400, **fill (125,122,117)**, right-aligned (anchor end) ending ~x=121, vertically centred on the grid line. Values 0,2,4,6,8 (integers; max = ceil to even).
- **X axis labels** (category names): **12px/400, fill (125,122,117)**, anchor middle at band centre, baseline y~552 (15px under the plot bottom).
- **Bars**: **16px wide**, centred in the band (band 211.4 -> 97.7px each side), **top corners r 2px, bottom square**, **stroke white (255,255,255) 0.5px**, no shadow. Height = value/8*343 (2 -> 86px, 4 -> 171, 3 -> 129). Fills (Notion chart palette, matches select-option colors, "lighter" variants):
  | Status | fill |
  |---|---|
  | Blocked (brown) | (189,149,118) = #BD9576 |
  | Not started (gray) | (227,226,224) = #E3E2E0 |
  | Review (blue) | (94,159,232) = #5E9FE8 |
  | In progress (blue) | (94,159,232) = #5E9FE8 |
  | Done (green) | (114,188,143) = #72BC8F |
  (Review and In progress are both blue in the DB's status options; chart colour follows the option colour, no auto palette.)
- **Data labels**: each bar has its value centred above it: **12px/400, fill (125,122,117)**, ~7px above bar top (y=bar top-18..), anchor start in DOM but visually centred over the bar.
- **Hover (bar/band)**: the hovered **category band (153 wide column? visual ~211x343, full plot height) is tinted light gray ≈ (243,243,243)** (not measured precisely; shown in tooltip screenshot), and a **tooltip card** appears above the cursor-ish: x=801,y=273, **137.4 x 79, bg white, r 8px, box-shadow `rgba(0,0,0,0.04) 0 2px 4px 0, rgba(42,28,0,0.07) 0 0 0 1px`**. Contents: row 1 (padding 12px, h 40): **8x8 colour square (r 1px, bg = bar colour, margin 0 3px)** + series name "In progress" **12px/400/lh18 c (125,122,117)** + value right-aligned "4" **12px c (161,158,153)**; 1px divider; row 2 (h ~40): list icon 16px + **"Click to view data" 12px/400/lh16, c (161,158,153)**. Click opens a peek with the matching rows (not clicked).
- `filter` in svg defs: feDropShadow dx1 dy1 blur 2.5 opacity .75 black (used for a drag/legacy; not visible).

## 5. Dark pass (Ctrl+Shift+L; body bg (25,25,25)) — screenshots/g-list-dark.jpg, g-calendar-dark.jpg, g-timeline-dark.jpg, g-chart-dark.jpg
Shared dark tokens: text (240,239,237); secondary text (173,169,163); tertiary/gray (125,122,117); hairline/divider (56,56,54) = #383836; weekend tint rgba(255,255,255,0.03) (calendar cell solid (32,32,32)); today red unchanged (229,100,88); bar/chip bg (37,37,37) (timeline) / (47,47,47) (calendar chips); ring `rgb(56,56,54) 0 0 0 1px` replaces the light `rgba(42,28,0,0.07)` ring; drop shadow `rgba(25,25,25,0.08) 0 2px 4px` (calendar chip) / `... 0 4px 12px -2px` (timeline bar).
### List
- Title + date text (240,239,237); page icon svg fill (125,122,117); hover row bg **rgba(255,255,255,0.055)**; "Edit" button: bg (25,25,25), icon (173,169,163), no shadow (visible 1px outline in screenshot); "New page" row same gray scheme (not re-measured).
### Calendar
- Month label, Manage in Calendar text, ‹ Today ›: (240,239,237); Manage border colour rgba(255,255,235,0.1); weekday labels (125,122,117) with 1px line (56,56,54); grid lines (56,56,54); weekend cell bg (32,32,32); out-of-month numbers (125,122,117), in-month numbers (240,239,237); today circle (229,100,88) with dark/near-black number text in computed style on inner node (visually white-ish bold in screenshot - re-check if rebuilding; light mode text was white (255,255,255)).
- Chip: bg **(47,47,47)** rest, **(55,55,55)** hover; shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 2px 4px`; chip title (240,239,237) 14px/600. "+" button visible at hovered cell top-left (24x24 raised dark square).
### Timeline
- Weekend columns rgba(255,255,255,0.03); today line + dot (229,100,88) unchanged; day labels (125,122,117); header hover-range pill rgba(255,255,255,0.03) with bold lighter number; bars bg **(37,37,37)**, ring (56,56,54); title (240,239,237); off-screen arrow chips keep (142,139,134) bg w/ white arrow; Manage button border rgba(255,255,235,0.1). Header bottom line (56,56,54)-ish.
### Chart
- Grid dashed lines (56,56,54); axis/data-label text **(173,169,163)** (light: (125,122,117)); bar stroke becomes (25,25,25) (the bg) instead of white; bar fills UNCHANGED (same hexes; "Not started" stays (227,226,224)); hovered band tint ≈ rgba(255,255,255,0.05) (screenshot ~ (39,39,39)); tooltip card **bg (32,32,32), r 8, shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 2px 4px`**; tooltip name (173,169,163), "Click to view data" (125,122,117).
