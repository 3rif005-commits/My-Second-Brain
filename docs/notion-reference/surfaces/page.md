# Page: frame, cover, icon, title, width and fonts

Source: `_raw/c-page-blocks.md` §1–3 (measured 2026-10-12, viewport 1300×649 or 1300×597, `getComputedStyle`).
Blocks inside the page are in `blocks.md`.

Screenshots:
[cover hover light](../screenshots/c-cover-hover-light.jpg) ·
[cover hover dark](../screenshots/c-cover-hover-dark.jpg) ·
[cover buttons zoom](../screenshots/c-cover-buttons-light.png) ·
["Add icon/cover/description" bar](../screenshots/c-add-icon-cover-bar-light.png) ·
["Add comment" hover, dark](../screenshots/c-add-comment-hover-dark.png) ·
[page ⋯ menu with fonts/toggles](../screenshots/c-page-menu-fonts-toggles-light.jpg) ·
[full width + TOC](../screenshots/c-full-width-toc-light.jpg) ·
[small text](../screenshots/c-small-text-light.jpg) ·
[serif](../screenshots/c-font-serif-light.jpg) ·
[mono](../screenshots/c-font-mono-light.jpg)

---

## 1. Page frame (layout grid)

```
.notion-scroller.vertical            (frame = viewport − sidebar; 15px scrollbar inside)
 └ .whenContentEditable
    └ .layout                        display:grid
       ├ .layout-full                cover (full bleed)
       └ .layout-content             icon, page controls, title, .notion-page-content
```

- **Normal width:** `grid-template-columns: [full-start] minmax(96px,1fr) [content-start] 720px [content-end] minmax(96px,1fr) [full-end]`.
  The measured value at a 1015px frame was `147.5px 720px 147.5px`. **Content column = 720px**, centred, with a **96px minimum gutter**.
  (The "708px" in `d-table.md` §8 is the inline database's header row, which is 720 minus about 6px on each side, not the column. Many older Notion clones use 708 for the column. This build measures the **column at 720px**.)
- **Full width:** `[full-start] 96px [content-start] 1fr [content-end] 96px [full-end]`. The content is the frame minus 2×96px (823px at a 1015px frame).
- **Full-page database pages are always full width** (padding 0 96px). See `database-table.md`.
- `.notion-page-content`: `padding-top 8px`, flex column, no horizontal padding.
- Page background: `#ffffff` light, `rgb(25,25,25)` dark.

## 2. Cover
- `div.layout-full`, **full bleed** across the frame (not the 720 column).
- **Height = 30vh** (194.7px at a 649px viewport). Image `object-fit: cover`.
- **Hover controls:** top-right, `position:absolute; top:12px; right:12px; transition: opacity .2s` (fades in on cover hover).
  - A pill containing **Change cover | Reposition | ⤓**: height 28, padding 2px, **radius 6px**, bg #fff (dark `rgb(32,32,32)`), `shadow.floatButton` (light `rgba(25,25,25,.027) 0 8px 12px, rgba(25,25,25,.027) 0 2px 6px, rgba(42,28,0,.07) 0 0 0 1px`; dark `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,.08) 0 4px 12px -2px`).
  - Buttons: 24px tall, padding 0 6px, radius 4px, **14px / 400 / 16.8px, `rgb(142,139,134)`** (both themes), `transition: background .1s ease-in-out`. At narrow widths "Change cover" shortens to "Change".
  - Dividers: 1×16px, radius 2px, margin 0 4px.

## 3. Page icon
- `div.notion-record-icon`: **78×78, emoji font-size 78px, line-height 78px**, radius 4px, cursor pointer, `transition: background .02s ease-in`.
- **With a cover:** `margin: -42px 0 0 8px`. The icon **overlaps the cover's bottom edge by 42px** (36px of the icon hangs below the cover). x = content-left + 8px.
- Without a cover, the icon sits at the top of the content column. No hover background was observed.

## 4. Page controls bar (above the title)
- `div.notion-page-controls`, colour `rgb(161,158,153)` (dark `rgb(125,122,117)`), margin-left -1px, flex.
  - With cover+icon: `padding 8px 0 4px`, 40px tall, directly under the icon. It shows **"Add comment"**.
  - Without icon/cover: `padding 4px 0`, 36px tall, at the top of the page. It shows **"Add icon" · "Add cover" · "Add comment"** (on a database page: "Add description" instead of "Add comment").
- **Hidden at rest.** It fades in on hover of the header area (`opacity 0→1`, `transition: opacity .1s`).
- Buttons: **28px tall, padding 0 8px, radius 6px, 14px / 400 / 16.8px**, leading icon 14×14 in the same colour. Hover bg `rgba(33,27,23,0.051)` (dark `rgba(255,255,255,0.055)`). Text colour does not change.

## 5. Title
| Page kind | Font | Notes |
|---|---|---|
| Doc page | **40px / 48px / 700**, `rgb(44,44,43)` (dark `rgb(240,239,237)`), letter-spacing normal | `h1.content-editable-leaf-rtl`, `padding 0 8px` (text x = column + 8) |
| Full-page database | **32px / 38.4px / 700** | wrapper `padding-right 96px; margin 0 0 8px` |
| Inline (linked) database | **24px / 31.2px / 600** | see `database-table.md` |

- Empty-title placeholder: **"New page"**, colour via `-webkit-text-fill-color: rgba(21,14,0,0.286)` (dark `rgba(255,252,235,0.306)`).
- Spacing: icon bottom → controls (40px) → title (48px) → `.notion-page-content` (padding-top 8px). The first paragraph's text starts about 14px below the title box.

## 6. Small text and fonts (page `⋯` menu)
**Small text** scales text by ×0.875. The column width, icon and cover do not change.

| Element | Default | Small text |
|---|---|---|
| Page title | 40/48 | 32/38.4 |
| Paragraph, list, to-do, quote, callout | 16/24 | 14/21 |
| H1 | 30/39 | 26.25/34.125 |
| H2 | 24/31.2 | 21/27.3 |
| H3 | 20/26 | 17.5/22.75 |
| Code | 13.6/20.4 | 11.9/17.85 |
| Simple-table cell | 14/20 | 12/20 |

Block wrapper paddings (6px, and 30/26/22px above headings) **do not** scale.

**Font** (tiles in the page menu). The title stays 40px/48px/700 in all three:

| Font | font-family | Body | H1 | H2 | H3 | Code | Table cell |
|---|---|---|---|---|---|---|---|
| Default | UI stack (`font.ui`) | 16/24 | 30/39 | 24/31.2 | 20/26 | 13.6/20.4 | 14/20 |
| Serif | `Lyon-Text, Georgia, ui-serif, serif` | **17/27.2** | 31.875/41.44 | 25.5/33.15 | 21.25/27.63 | 14.45/23.12 (code stays mono) | 15/20 |
| Mono | `iawriter-mono, Nitti, Menlo, Courier, monospace` | **15/24** | 28.125/36.56 | 22.5/29.25 | 18.75/24.38 | 12.75/20.4 | 13/20 |

Serif = ×1.0625 with line-height 1.6. Mono = ×0.9375. Weights are unchanged.

## 7. Table of contents (right margin)
A floating outline appears in the right margin on long pages:
- **Collapsed:** short horizontal dashes at the far right (x≈1250–1265), one per heading. Width varies by level, and the active heading's dash is darker.
- **Expanded (on hover):** card **232×111**, bg #fff, **radius 14px**, padding `12px 12px 0`, margin-right 10px, `shadow.menu`. Items **13px / 16.9px / 400**, 25px pitch, **indent 12px per heading level**. Active heading `rgb(39,131,222)`, others `rgb(125,122,117)`.

## 8. Behaviour
- The page `⋯` menu (font tiles, Small text, Full width, Lock page) is specified in `shell.md` §2.
- Hovering anywhere over the header area reveals the page controls bar.
- Hovering the cover reveals Change cover / Reposition.
