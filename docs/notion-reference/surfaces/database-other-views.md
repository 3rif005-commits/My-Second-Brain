# Database: List, Calendar, Timeline, Chart

Source: `_raw/g-other-views.md` (measured 2026-10-13, viewport 1300×597, sidebar collapsed, content x 104–1181).
The header and toolbar are shared with the table (`database-table.md` §1).

Screenshots:
[list](../screenshots/g-list-light.jpg) ([dark](../screenshots/g-list-dark.jpg)) ·
[calendar](../screenshots/g-calendar-light.jpg) ([dark](../screenshots/g-calendar-dark.jpg)) ·
[timeline](../screenshots/g-timeline-light.jpg) ([dark](../screenshots/g-timeline-dark.jpg)) ·
[timeline today](../screenshots/g-timeline-today-light.jpg) ·
[timeline scale menu](../screenshots/g-timeline-scale-menu-light.jpg) ·
["No date" popup](../screenshots/g-timeline-nodate-popup-light.jpg) ·
[chart](../screenshots/g-chart-light.jpg) ([dark](../screenshots/g-chart-dark.jpg)) ·
[chart tooltip](../screenshots/g-chart-tooltip-light.jpg)

Dark tokens used by all four views: text `rgb(240,239,237)`, secondary `rgb(173,169,163)`, tertiary `rgb(125,122,117)`, hairlines **`rgb(56,56,54)`**, weekend tint `rgba(255,255,255,0.03)`, today red unchanged `rgb(229,100,88)`.

---

## 1. List
- Wrapper padding 4px 0. Rows: **30px tall, margin 1px 0, so a 32px pitch. No divider lines.**
- Row `a`: full width, flex, **radius 6px, padding-left 4px**, `transition: background .02s ease-in`.
  - Left: icon box **22×22** (radius 3.5px, margin-right 5px; default page glyph 18px `rgb(161,158,153)` / dark `rgb(125,122,117)`) and title **14px / 500 / 21px**, nowrap.
  - Right: visible properties, right-aligned, padding 0 8px, **14px / 400 primary colour** (plain text, no labels).
- **Hover:** row bg **`rgba(55,53,47,0.06)`** (dark `rgba(255,255,255,0.055)`). The gutter shows **"+" 24×24** and **⋮⋮ 18×24** to the left (in the page padding). After the title, an "**Edit**" button (26×20, white bg, radius 6px, 16px icon `rgb(125,122,117)`, faint outline) opens the peek.
- "+ New page" row: 30px, padding `0 8px 0 6px`, radius 6px, 14px `rgb(161,158,153)`, plus icon 18px.

## 2. Calendar (month)
- Frame is full content width. **Week starts Sunday.**
- **Header** (42px): month label "October 2026" **14px / 600** at the left (margin 0 8px). Right side: "**Manage in Calendar**" (24px tall, padding 0 6px, radius 6px, **border 1px solid `rgba(28,19,1,0.11)`**, 14px / 500, app icon 16px), then **‹ Today ›**: arrows 24×24 radius 6px (20px glyph `rgb(142,139,134)`), "Today" 24px tall, padding 0 6px, radius 6px, 14px / 400.
- "**No date (N)**" button in the views-bar toolbar (28px, padding 6px, radius 6px, 14px `rgb(142,139,134)`) opens a popup of undated pages (see Timeline).
- **Weekday row** (24px): "Sun … Sat" **12px / 400 / 18px `rgb(161,158,153)`** (dark `rgb(125,122,117)`), centred. Bottom line `box-shadow: rgb(230,229,227) 0 1px 0 0` (dark `rgb(56,56,54)`). Weekends are not highlighted in this row.
- **Grid:** 7 equal columns (153.7px at this width). A left outer line `box-shadow: rgb(230,229,227) -1px 0 0 0`. **Each cell: `border-right` + `border-bottom` 1px solid `rgb(230,229,227)`** (dark `rgb(56,56,54)`). This is an **opaque** grey, unlike the table's translucent divider.
  - Cell height **124px**. Rows grow by 34px per extra event lane. **There is no "+N more"; rows just grow.** All cells in a week share the height.
  - **Weekend cells (Sun, Sat): bg `rgb(249,248,247)`** (dark `rgb(32,32,32)`). Out-of-month cells get no extra tint.
  - **Day number:** 14px / 400 / 24px line, top + 4px, **right-aligned 11px from the cell's right edge**. In-month: primary. Out-of-month: `rgb(161,158,153)` (dark `rgb(125,122,117)`). The 1st of a month reads "**Oct 1**".
  - **Today:** the number sits in a **24×24 circle, bg `rgb(229,100,88)`, white text**, right edge 5px from the cell edge.
  - The event area starts at cell top + 30, padding 3px 6px, with 34px lanes.
- **Event chip:** `a` **28px tall (padding 2px 0), radius 6px, bg white** (dark `rgb(47,47,47)`), shadow **`rgba(0,0,0,0.04) 0 2px 4px 0, rgba(42,28,0,0.07) 0 0 0 1px`** (dark `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 2px 4px`). Width = cell − 12. Inner padding 0 6px. Title **14px / 600**, ellipsis. No icon or time by default.
  - Hover: bg **`rgba(84,72,49,0.08)`** (dark `rgb(55,55,55)`).
  - **Multi-day events** are one continuous bar per week row. The first segment has radius `6px 0 0 6px`. Continuing segments are full-bleed from the row's left edge with radius 0, and the title repeats (padding-left 12px). The last segment has its right corners rounded. **Hovering one segment tints all of them.** A range keeps a fixed lane across weeks.
- **Day-cell hover:** an "**Add an item**" button at the cell's **top-left**: outer 24×24, padding 2px, bg white, **radius 8px**, `shadow.menu`. Inner 20×20 radius 6px, plus 20px `rgb(142,139,134)`. The cell itself gets no hover bg.

## 3. Timeline
- **Full bleed:** the timeline spans the whole scroller (not the 96px page padding). Header sticky. Horizontal scrollbar at the bottom.
- **Header row 1** (36px): left (padding-left 96px): the `»` table-panel toggle (24×22, radius 6px) + a sticky month label "October 2026" **14px / 500**. Right (padding-right 96px): "Manage in Calendar", a **scale selector "Month ▾"** (24px, padding 0 6px, radius 6px, **14px / 400 `rgb(142,139,134)`**), and ‹ Today ›. Month-start labels ("November") appear in the scale row at the month's first day.
- **Scale menu:** card **180px**, radius 10px, padding 4px, `shadow.menu`, 4px below the button: Hours, Day, Week, Bi-week, Month, Quarter, Year, 5 Years (28px rows). The current one has bg `rgba(33,27,23,0.051)`.
- **Day row** (32px, bottom line `rgb(230,229,227) 0 -1px 0 0 inset`): at Month scale **each day is 40px wide**. Labels 12px / 400 / 28px `rgb(161,158,153)`, centred. **Today's label: a pill 22px tall, radius 11px, bg `rgb(229,100,88)`, white 12px / 500.**
- Hovering a bar highlights its date range in the day row: a 22px pill (radius 11px, bg `rgb(247,247,247)` / dark `rgba(255,255,255,0.03)`) behind those days, with the start day bold.
- **Grid body:** bg **`rgb(253,253,253)`** (faintly off-white). **No vertical day lines.** **Weekend columns** (Sat+Sun, 80px) have bg **`rgb(247,247,247)`** (dark `rgba(255,255,255,0.03)`).
- **Today line:** 1px `border-right: 1px solid rgb(229,100,88)`, full height at the day's centre, with a **7×7 red dot** at the top (overlapping the header line).
- **Rows: 36px** (bar 34 + 1px margin each side).
- **Bar:** **34px tall, radius 6px, bg white** (dark `rgb(37,37,37)`), the same shadow as calendar chips (dark: ring `rgb(56,56,54)` + `rgba(25,25,25,0.08) 0 4px 12px -2px`). Width = days × 40 − 3 (a one-day bar is 37px). Inner `a` padding 0 6px, title **14px / 500** (not 600). **If the title is longer than the bar, it overflows to the right of the bar unclipped, with no bg.** Hover bg `rgba(33,27,23,0.051)`.
  - **Resize hit areas:** invisible 8×34 divs at both ends, `cursor: col-resize`, with no visible handle.
  - **Off-screen bars:** a 16×16 chip (bg `rgb(142,139,134)`, radius 4px, 1px white border, white ← or → arrow) pinned at the left/right edge in the bar's row (`transition: transform .16s ease-in-out, opacity .16s`). Clicking it scrolls to the bar.
- **Undated rows** are not drawn. "**No date (N)**" opens a **320px** popup (radius 10px, `shadow.menu`): a search "Search for a page…", the caption "Click to add to the timeline" (12px `rgb(161,158,153)`), then rows (page icon, title, and an "Open" link at the right in `rgb(142,139,134)`).
- The left table panel was collapsed in this view and was **not captured**.

## 4. Chart (vertical bar)
- The toolbar is reduced to **Filter, Settings, New**.
- **No title, legend or caption.** One `svg`, 400px tall, starting right under the views bar, with a transparent bg.
- Plot area: left gutter 25px, top 20px, bottom 37px (category labels). Bands split the width equally.
- **Grid:** horizontal lines at each tick, **1px `rgb(230,229,227)`, dotted (`stroke-dasharray: 1 3`)**. The zero baseline is a **solid** line in the same colour. No y-axis line and no vertical grid (dark lines `rgb(56,56,54)`).
- **Axis labels:** 12px / 400 `rgb(125,122,117)` (dark `rgb(173,169,163)`). Y labels are right-aligned in the gutter (integer ticks). X labels are centred under the bands, 15px below the plot.
- **Bars:** **16px wide**, centred in the band, **top corners radius 2px**, square bottom, **stroke 0.5px white** (dark: the page bg). Each bar is coloured by its **option colour**:
  | Option colour | Bar fill |
  |---|---|
  | Gray | `rgb(227,226,224)` |
  | Brown | `rgb(189,149,118)` |
  | Blue | `rgb(94,159,232)` |
  | Green | `rgb(114,188,143)` |
  | others | not in the fixture (expect equivalent mid-tones of each hue) |

  Fills are the same in dark.
- **Data labels:** the value above each bar, 12px `rgb(125,122,117)`, about 7px above.
- **Hover:** the whole category band gets a light grey tint (≈`rgb(243,243,243)`, dark ≈`rgba(255,255,255,0.05)`; visual estimate). A **tooltip** card appears: 137×79, **radius 8px**, bg white (dark `rgb(32,32,32)`), shadow `rgba(0,0,0,0.04) 0 2px 4px 0, rgba(42,28,0,0.07) 0 0 0 1px` (dark `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 2px 4px`). Row 1 (padding 12px): an **8×8 colour square** (radius 1px) + the series name (12px `rgb(125,122,117)`) + the value right-aligned (12px `rgb(161,158,153)`). A 1px divider. Row 2: a list icon + "**Click to view data**" (12px `rgb(161,158,153)`). Clicking opens a peek of the matching rows.
