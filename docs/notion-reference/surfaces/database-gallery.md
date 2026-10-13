# Database: Gallery view

Source: `_raw/f-board-gallery.md` §3–4 (measured 2026-10-13, viewport 1300×597, sidebar collapsed).
The header and toolbar are the same as the table (`database-table.md` §1).

Screenshots:
[gallery light](../screenshots/f-gallery-light.jpg) ·
[gallery dark](../screenshots/f-gallery-dark.jpg) ·
[card hover light](../screenshots/f-gallery-card-hover-light.png) ·
[card hover dark](../screenshots/f-gallery-card-hover-dark.png) ·
["+ New page" tile](../screenshots/f-gallery-bottom-newtile-light.jpg) ·
[New tile hover](../screenshots/f-gallery-newtile-hover-light.png) ·
[Large size](../screenshots/f-gallery-large-light.jpg) ·
[Fit media](../screenshots/f-gallery-fitmedia-light.jpg)

Fixture view settings: card preview = page cover, Wrap all content off, open in **center peek**, card layout List, only Name visible.

---

## 1. Grid
- `div.notion-gallery-view`: `padding 0 104px 180px` (aligned with the page content). The grid has `padding 16px 0 4px` and **`gap: 16px`** for rows and columns.
- Columns auto-fill by card size. At a 1077px-wide grid:
  | Card size | Columns | Card width | Cover height | Card height |
  |---|---|---|---|---|
  | Small | 5 | 202.6 | 114 (16:9) | 152.7 |
  | Medium | 3 | 348.3 | 195.75 (16:9) | 234.3 |
  | Large | 3 at this width (wider cards on larger screens) | 348.3 | 195.75 | 234.3 |
  | *as first found ("Medium", unset)* | 3 | 348.3 | **146** | 184.8 |

  An unset default rendered a 146px cover. Explicitly picking a size gives a **16:9 cover**. Use 16:9 for the clone.

## 2. Card
- **Radius 10px.** Light bg **white**, shadow `rgba(25,25,25,0.027) 0 4px 12px 0, rgba(25,25,25,0.02) 0 1px 2px 0, rgba(42,28,0,0.07) 0 0 0 1px`. `transition: background .1s ease-out`.
- Dark bg **`rgba(255,255,255,0.055)`** (translucent over the page), shadow `rgba(25,25,25,0.08) 0 2px 4px 0, rgba(255,255,243,0.082) 0 0 0 1px`.
- **Preview (cover) area:** full card width. `img` **object-fit cover, object-position 50% 40%**. The top corners follow the card's 10px radius (the card clips). There is a **1px divider below it** (`rgba(42,28,0,0.07)` / dark `rgba(255,255,243,0.082)`).
- **Card without a cover:** the same-height area is a **blank placeholder with bg `rgba(66,35,3,0.03)`** (dark: same as the card bg), with **no divider**.
- **Fit media ON:** `object-fit: contain`, so the image is letterboxed on the card bg. The height is unchanged.
- **Title block:** padding **8px 10px**, title **15px / 500 / 22.5px**, `padding 0 1px`, single line with ellipsis (Wrap off). Property rows (when visible) follow below the title in the board-card property style (`database-board.md` §3).

## 3. States
- **Hover:** light card bg `rgba(55,53,47,0.04)`, dark `rgb(47,47,47)`. An action chip appears at the **top-right (top 8, right 8)**: bg #fff / `rgb(37,37,37)`, radius 4px, `shadow.floatButton`, `transition: opacity .2s`. Buttons are 26px tall, padding 4px 6px, 12px / 500, `rgb(125,122,117)` / `rgb(173,169,163)`:
  - card with a cover: **"Reposition"** (70px) + edit (29) + ⋯ (28)
  - card without a cover: edit + ⋯
- **Click:** opens a **center peek** (per the view setting).

## 4. "+ New page" tile
- The last grid child, starting a new row: **one column wide × 40px**, **radius 10px**, no bg, **ring `rgba(42,28,0,0.07) 0 0 0 1px`** (dark `rgba(255,255,235,0.1)`), **padding `9px 14px 8px`, 15px / 400 / 22.5px**, centred, colour **`rgb(173,169,163)`** (dark `rgb(125,122,117)`), plus icon 15px.
- Hover bg `rgba(33,27,23,0.051)`, `transition: background .02s ease-in`.

## 5. Not captured
Compact layout, gallery property rows, and the selected card.
