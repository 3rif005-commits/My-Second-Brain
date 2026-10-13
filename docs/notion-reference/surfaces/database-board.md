# Database: Board view

Source: `_raw/f-board-gallery.md` §1–2 (measured 2026-10-13, viewport 1300×597, sidebar collapsed).
The header, view tabs and toolbar are the same as the table (`database-table.md` §1). Pills and the option palette are in `database-table.md` §6.

Screenshots:
[board light](../screenshots/f-board-light.jpg) ·
[board scrolled (Done column)](../screenshots/f-board-scrolled-light.jpg) ·
[board dark](../screenshots/f-board-dark.jpg) ·
[card hover light](../screenshots/f-board-card-hover-light.png) ·
[card hover dark](../screenshots/f-board-card-hover-dark.png) ·
["+ New page" hover](../screenshots/f-board-newpage-hover-light.png) ·
[cards with page cover](../screenshots/f-board-cover-light.png)

Fixture view settings: group by Status, **Color columns ON**, card preview None, card size Medium, card layout List, only Name visible. Open pages in **side peek**.

---

## 1. Frame
- `div.notion-board-view`: `margin 0 96px; padding-left 8px` (so columns start at the page's content x). It scrolls horizontally inside the full-width scroller.
- The column header row starts **8px below the views bar**. The card area is a separate flex row below the headers.
- **Columns: 276px wide, 12px gap** (288px pitch). The board ends after the last column (no "+ Add group" column in this fixture).
- Group order follows the Status **group** order (To-do group, then In progress, then Complete), not the option list order.

## 2. Column (header and body are two boxes with the same tint)
| Part | Geometry |
|---|---|
| Header | **276×40, padding 0 8px, radius `10px 10px 0 0`**, bg = column tint |
| Body `div.notion-board-group` | width 276, **padding `0 8px 8px`, radius `0 0 10px 10px`**, margin-bottom 16px, bg = column tint. A 3px spacer sits before the first card |

**Column tints** (Color columns ON):
| Group colour | Light tint | Dark tint |
|---|---|---|
| Gray (Not started) | `rgba(66,35,3,0.03)` | `rgba(252,252,252,0.03)` |
| Brown (Blocked) | `rgba(115,59,3,0.035)` | `rgba(253,158,101,0.05)` |
| Blue (Review, In progress) | `rgba(0,128,213,0.047)` | `rgba(41,139,253,0.063)` |
| Green (Done) | `rgba(3,87,31,0.035)` | `rgba(83,255,140,0.035)` |
| Other hues | not in the fixture. Derive them from the same pattern: the hue at about 3–5% alpha in light, 3.5–6% alpha in dark | |

**Header contents** (left to right):
- **Group pill**: the status pill (h 20, radius 10px, `padding 0 9px 0 7px`, dot 8×8) inside a `padding 3px, radius 6px` hover target.
- **Count**: 8px after the pill, a 20px-tall button, padding 0 6px, radius 4px, **14px / 400, in the group colour** (gray uses `rgb(95,94,89)`; dark `rgb(188,186,182)`). Hover bg `rgba(33,27,23,0.051)`.
- On header hover (`transition: opacity .1s`): "**⋯**" (More group options) and "**+**" (Add a page), each **24×24, radius 6px**, right-aligned (right edge = column right − 8). Icons 16px in the group colour.

Group colours used for the dot, count and New-page text:
| Group | Dot | Count / "New page" text | Card ring (light) | Card ring (dark) |
|---|---|---|---|---|
| Gray | `rgb(142,139,134)` | `rgb(95,94,89)` / dark `rgb(188,186,182)` | `rgba(42,28,0,0.07)` | `rgba(255,255,243,0.082)` |
| Brown | `rgb(182,137,101)` | `rgb(182,137,101)` | `rgba(139,46,0,0.086)` | `rgba(255,174,122,0.133)` |
| Blue | `rgb(39,131,222)` | `rgb(39,131,222)` | `rgba(0,124,215,0.094)` | `rgba(71,157,255,0.173)` |
| Green | `rgb(70,161,113)` | `rgb(70,161,113)` | not measured (follow the pattern: green at ≈9% alpha) | `rgba(119,255,179,0.118)` |

## 3. Card
- The card is the `div[presentation]` inside `.notion-collection-item`: **260px wide** (column − 2×8), **radius 10px**, min height 40, **8px gap between cards**, `transition: background .1s ease-out`.
- **Light:** bg **white** in every column. **No border.** Shadow:
  `rgba(25,25,25,0.027) 0 4px 12px 0, rgba(25,25,25,0.02) 0 1px 2px 0, <ring> 0 0 0 1px`, where `<ring>` is the **per-column tinted ring** from the table above.
- **Dark:** the card bg is an **opaque tinted colour, not white**:
  | Group | Dark card bg | Dark card hover bg |
  |---|---|---|
  | Gray | `rgb(32,32,32)` | not measured (≈ `rgb(37,37,37)`) |
  | Brown | `rgb(56,45,38)` | not measured |
  | Blue | `rgb(33,48,65)` | `rgb(37,54,73)` |
  | Green | `rgb(36,52,43)` | not measured |

  The dark shadow has two layers only: `rgba(25,25,25,0.08) 0 2px 4px 0, <ring> 0 0 0 1px`.
- **Content:** the card is an `<a>` with **padding 8px 10px**. Title **15px / 500 / 22.5px**, `padding 0 1px`, primary colour. The page icon (when Show page icon is on and the page has one) precedes the title.
- **Property rows** (when visible): each **h 28, padding 5px, radius 5px, margin 0 6px, 12px / 400 / 18px**, no property-name labels, in property order. Dates are plain text. A checkbox is a 16px box + label. A file is a grey chip. **Empty properties are not rendered at all.** Select, status and tag pills on cards were not captured. Use the standard pill at the card's 12px scale (by analogy with Notion's smaller board pills; unverified).
- **Card preview = page cover:** the cover is **260×148, object-fit cover, object-position 50% 60%**, clipped by the card's 10px radius, with a **1px divider** `rgba(42,28,0,0.07)` below it, then the title block. Cards without a cover show no image.
- **Hover:** the card bg becomes the **column tint** (light; e.g. Blocked `rgba(115,59,3,0.035)`). The shadow is unchanged. A **hover action chip** appears at the card's **top-right (top 8, right 8)**: 57×24, radius 4px, bg #fff, `shadow.floatButton`, `transition: opacity .2s`. It holds an **edit (pencil) 29×24** and a **⋯ 28×24** button (padding 4px 6px, 16px icons `rgb(125,122,117)`, hover bg `rgba(33,27,23,0.051)`). In dark the chip is `rgb(37,37,37)` with the dark float shadow and icons `rgb(173,169,163)`.
- **Click:** opens the page in a **side peek** (per the view setting).
- Selected and dragging states were not captured.

## 4. "+ New page" at the bottom of each column
- `div` **260×40, radius 10px, padding 0 10px, gap 9px, 15px / 400 / 18px**, plus icon 16px, text **in the group colour** (gray: `rgb(125,122,117)` visually).
- **No bg at rest, a solid 1px ring** (`box-shadow 0 0 0 1px`) in the column's ring colour. It is **not dashed**.
- **Hover bg = the column tint.** `transition: background .1s ease-in-out`.

## 5. Not captured
Compact card layout, selected/drag states, an empty column, the hidden-groups column (the fixture has none), pills on cards, and dark hover of the header icons and the New row.
