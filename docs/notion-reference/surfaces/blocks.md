# Blocks: every block type, handle, slash menu, selection toolbar, colours

Source: `_raw/c-page-blocks.md` §4–8 (measured 2026-10-12, `getComputedStyle`). Page frame is in `page.md`.

Screenshots:
[lists + to-do](../screenshots/c-lists-todo-light.png) ·
[lists/to-do/callout dark](../screenshots/c-lists-todo-callout-dark.jpg) ·
[code/quote/callout](../screenshots/c-code-quote-callout-light.jpg) ·
[code hover dark](../screenshots/c-code-hover-dark.jpg) ·
[image hover](../screenshots/c-image-hover-light.jpg) ·
[table/columns/mentions/sub-pages](../screenshots/c-table-columns-mentions-subpages-light.jpg) ·
[sub-page link hover](../screenshots/c-subpage-link-hover-light.png) ·
[block handle tooltip](../screenshots/c-block-handle-tooltip-light.png) ·
[block menu + colour flyout light](../screenshots/c-block-menu-color-light.jpg) ·
[block menu dark](../screenshots/c-block-menu-dark.jpg) ·
[block menu colour dark](../screenshots/c-block-menu-color-dark.jpg) ·
[background colours light](../screenshots/c-color-menu-backgrounds-light.jpg) ·
[background colours dark](../screenshots/c-color-menu-backgrounds-dark.jpg) ·
[selection toolbar](../screenshots/c-selection-toolbar-light.jpg) ·
[selection toolbar, bold active](../screenshots/c-selection-toolbar-bold-light.jpg) ·
[selection toolbar dark](../screenshots/c-selection-toolbar-dark.jpg) ·
[selection colour menu](../screenshots/c-selection-color-menu-light.jpg) ·
[selection colour menu dark](../screenshots/c-selection-color-menu-dark.jpg) ·
[slash menu](../screenshots/c-slash-menu-light.jpg) ·
[slash filtered](../screenshots/c-slash-menu-filtered-light.jpg) ·
[slash dark](../screenshots/c-slash-menu-dark.jpg) ·
[placeholder](../screenshots/c-placeholder-empty-paragraph-light.png) ·
[placeholder dark](../screenshots/c-placeholder-empty-paragraph-dark.png) ·
[H1 placeholder](../screenshots/c-placeholder-heading1-light.jpg)

All text colours below are light / dark: primary text `rgb(44,44,43)` / `rgb(240,239,237)`.

---

## 1. Spacing model (the most important rule)

- A block `div.notion-selectable.notion-<type>-block` has **no margin and no padding**. **Consecutive blocks touch** (bounding-box gap = 0).
- Spacing comes from **padding on an inner wrapper** plus **2px padding on the editable leaf** (`div.content-editable-leaf-rtl[data-content-editable-leaf]`). Lists use `2px 0`.
- So a 16px/24px paragraph leaf is 28px tall, and the block is 40px tall.

| Block | Class | Wrapper padding top / bottom | Leaf font | Block height |
|---|---|---|---|---|
| Paragraph | `notion-text-block` | 6 / 6 | **16px / 24px / 400** | 40 |
| H1 | `notion-header-block` | **30 / 6** | **30px / 39px / 600** | 79 |
| H2 | `notion-sub_header-block` | **26 / 6** | **24px / 31.2px / 600** | 67.2 |
| H3 | `notion-sub_sub_header-block` | **22 / 6** | **20px / 26px / 600** | 58 |
| Bulleted / numbered / to-do / toggle item | | **1 / 1** (the first item after a non-list block gets 6 top) | 16/24 | 30 (30px pitch) |
| Quote | `notion-quote-block` | 8 / 8 | 16/24 | 40 |
| Code | `notion-code-block` | 8 / 8 | 13.6/20.4 mono | varies |
| Callout | `notion-callout-block` | 8 / 8 outside the box | 16/24 | 82 for one line |
| Divider | `notion-divider-block` | line centred in a 13px block | — | 13 |
| Column list | `notion-column_list-block` | 12 / 12 | — | — |

Visual gaps between texts: paragraph→paragraph 12px (+2px leaf paddings). Paragraph→H1 6+30. H1→H2 6+26. List item→list item 2px.
Wrapper horizontal padding is 6px (paragraph text left edge = column + 6), and headings use the same left edge.
All headings use **weight 600** (the page title is 700). Letter-spacing is normal everywhere.

## 2. Block specifics

### Bulleted list
- Row: flex, `padding-left 2px`. Marker box `div.notion-list-item-box-left` is **24×28** (padding 2px 0). The bullet is a `::before` **"•" at font-size 24px**, centred in the box, in the text colour.
- Text leaf starts 24px after the box (column + 32).
- **Nested indent: 32px per level.**
- Only depth 1 and 2 were seen. The glyph change per depth (Notion cycles • ◦ ▪) was **not verified** in this capture.

### Numbered list
- Same 24×28 box. The marker is `"1."` at 16px, text colour, right-aligned in the box. Text starts at the same x as a bullet's.

### To-do
- **Checkbox 16×16, radius 1.5px**, 4px into the 24px box, vertically centred (6px from the top). `transition: background .2s ease-out`.
  - Unchecked: transparent, **border 1px solid `rgb(56,56,54)`** (dark `rgb(230,229,227)`).
  - Checked: **bg `rgb(39,131,222)`**, no border, white check svg 14×14 (`checkmarkFillSmall`).
- Text leaf `padding 2px 0 2px 6px`.
- **Checked text:** `opacity 0.7` + `text-decoration: line-through` in `rgba(44,44,43,0.5)` (dark `rgba(240,239,237,0.5)`). The colour itself is unchanged.

### Toggle
- A 24×24 button (radius 4px, hover bg `rgba(33,27,23,0.051)`, `transition: background .02s ease-in`) holding the caret svg `arrowCaretDownFillSmall` **12.8×12.8**, text colour.
- **Open = caret points down (no transform). Closed = `rotate(-90deg)` (points right).** `transition: transform .2s ease-out`.
- Children indent **32px**. Toggle block wrapper `padding 1px 6px`.

### Callout
- Box inset 8px in the block: **bg `rgb(249,248,247)`** (dark `rgb(56,56,54)`), **border 1px solid transparent, radius 10px, padding 12px**, flex.
- Icon box 24×24, `margin-top 7.5px`, emoji ≈16.8px. The text block follows immediately (its own 6px wrapper padding and 2px leaf padding).
- Text 16/24, primary colour.

### Quote
- Inner div: **`border-left: 3px solid` currentColor** (`rgb(44,44,43)` / dark `rgb(240,239,237)`), **padding 0 14px**. Text 16px/24px/400, the same size as body text (not larger).

### Divider
- Line div: full width minus 8px each side, **height 1px, bg `rgba(28,19,1,0.11)`** (dark `rgba(255,255,235,0.1)`). 6px above and 6px below, so the block is 13px.

### Code block
- Box: **bg `rgba(66,35,3,0.03)`** (dark `rgba(252,252,252,0.03)`), **radius 10px, padding 24px 22px** (line-numbers container padding 12px 0).
- Text: `SFMono-Regular, Menlo, Consolas, "PT Mono", "Liberation Mono", Courier, monospace`, **13.6px / 20.4px / 400**, `white-space: pre`, `tab-size: 2`.
- **Syntax colours (Prism):**
  | Token | Light | Dark |
  |---|---|---|
  | keyword | `rgb(0,119,170)` | `rgb(102,162,204)` |
  | function | `rgb(221,74,104)` | `rgb(236,236,147)` |
  | string | `rgb(102,153,0)` | `rgb(189,224,82)` |
  | punctuation | `rgb(153,153,153)` | ≈ `rgb(153,153,153)` |
  | comment | not in the fixture. Prism default is slategray `rgb(112,128,144)` | — |
- **Hover toolbar** (top-right, 4px inset): a pill 28px tall, padding 2px, radius 6px, bg #fff (dark `rgb(32,32,32)`), `shadow.floatButton`. Buttons 24px tall, radius 4px, `rgb(142,139,134)`: "JavaScript ⌄" (14px, padding 0 6px), Copy, Wrap, ⋯ (24×24 each).

### Image
- Block padding 8px. The image is clipped by a wrapper with **radius 10px**.
- **Hover toolbar** top-right (4px inset), same pill style as the code toolbar: "Ask AI" | comment | align | caption | full view | download | ⋯.
- **Resize handles** at the left and right edges (4px inset, vertically centred): **6×48, bg `rgba(15,15,15,0.6)`, border 1px solid `rgba(255,255,255,0.9)`, radius 20px**, `transition: opacity .2s ease-in-out`. Same in both themes.

### Simple table (not a database)
- `notion-table-block` scrolls full-bleed; the real `<table>` starts at column + 14px. `border-collapse: collapse`.
- Cells: **border 1px solid `rgb(230,229,227)`** (dark `rgb(56,56,54)`), on all sides.
- Header row `th`: **bg `rgb(247,246,243)`** (dark `rgba(255,255,255,0.03)`), **weight 500**.
- Cell text `div.notion-table-cell-text`: **14px / 20px, padding 7px 9px** (smaller than body text). Row pitch 35px.
- Columns default to equal widths across the 720px column (240px each for 3).

### Columns
- Two columns of **337px** with a **46px gap** in the 720 column. The block has 12px top/bottom padding. Columns hold normal blocks.

### Mentions
- **Date mention** (`span.notion-text-mention-token`): colour `rgb(125,122,117)` (dark `rgb(173,169,163)`), no underline, no bg. The leading "@" is at 60% alpha.
- **Page mention** (`a.notion-page-mention-token`): page icon 20×20 inline (margin-right 8px) and title **weight 500**, `text-decoration: underline`, **thickness 0.8px, offset 10%, colour `rgba(55,53,47,0.25)`** (dark ≈ `rgba(255,255,255,0.28)`).

### Sub-page / child-database link block
- Full-row `a`: **radius 4px, hover bg `rgba(33,27,23,0.051)`**, `transition: background .02s ease-in`. Icon box 24×24 (glyph 22×22 `rgb(142,139,134)`), margin-right 4px.
- Title **16px / 20.8px / 500** with **`border-bottom: 1px solid rgba(28,19,1,0.11)`**, which is the "underline".

### Inline styles
| Style | Light | Dark |
|---|---|---|
| **Bold** | `font-weight: 600` | |
| *Italic* | `font-style: italic` | |
| `Inline code` | mono stack, **0.85em (13.6px)**, **colour `rgb(207,81,72)`**, **bg `rgba(33,27,23,0.05)`**, **radius 4px, padding 0.2em 0.4em**, line-height normal | bg `rgba(255,255,255,0.055)`, colour unchanged |
| Link | inherits the text colour. Inner span **opacity 0.7**, underline 0.8px, offset 10%, colour `rgba(55,53,47,0.4)`. **Not blue.** | underline `rgba(255,255,255,0.282)` |
| Coloured text (red) | `rgb(207,81,72)` | same |
| Highlight (yellow bg) | `rgba(211,168,0,0.137)`, radius 0 | `rgba(255,205,75,0.24)` |

## 3. Block text and background colours (`tokens.json → color.block`)

These are the colours for **text and blocks**. Database option pills use a **different** palette (see `database-table.md`).

| Name | Text (light) | Background (light) | Text (dark) | Background (dark) |
|---|---|---|---|---|
| Default | `rgb(44,44,43)` | transparent | `rgb(240,239,237)` | transparent |
| Gray | `rgb(125,122,117)` | `rgb(240,239,237)` | `rgb(125,122,117)` | `rgb(56,56,54)` |
| Brown | `rgb(159,118,90)` | `rgb(245,237,233)` | `rgb(159,118,90)` | `rgb(69,54,45)` |
| Orange | `rgb(210,123,45)` | `rgb(251,235,222)` | `rgb(210,123,45)` | `rgb(83,54,31)` |
| Yellow | `rgb(203,148,52)` | `rgb(249,243,220)` | `rgb(203,148,52)` | `rgb(80,68,37)` |
| Green | `rgb(80,148,110)` | `rgb(232,241,236)` | `rgb(80,148,110)` | `rgb(38,61,48)` |
| Blue | `rgb(56,125,201)` | `rgb(229,242,252)` | `rgb(56,125,201)` | `rgb(35,56,80)` |
| Purple | `rgb(154,107,180)` | `rgb(243,235,249)` | `rgb(154,107,180)` | `rgb(60,45,71)` |
| Pink | `rgb(193,76,138)` | `rgb(250,233,241)` | `rgb(193,76,138)` | `rgb(78,43,60)` |
| Red | `rgb(207,81,72)` | `rgb(252,233,231)` | `rgb(207,81,72)` | `rgb(80,44,41)` |

**Text colours are the same in both themes. Only the backgrounds change.**

Swatch tiles in colour menus: **26×26, radius 6px**, `box-shadow: inset 0 0 0 1px rgba(28,19,1,0.11)` (light). Text swatches show an "A" (16px/500) in the colour, and background swatches are filled. In dark each swatch's ring is a per-hue translucent tint: default/gray `rgba(255,255,235,.1)`, brown `rgba(255,177,129,.192)`, orange `rgba(255,147,75,.28)`, yellow `rgba(255,205,75,.24)`, green `rgba(108,255,172,.157)`, blue `rgba(67,155,255,.24)`, purple `rgba(200,125,255,.2)`, pink `rgba(255,103,177,.23)`, red `rgba(255,104,92,.24)`.

## 4. Block handle (`+` and `⋮⋮`)
- They appear in the left gutter on block hover:
  - **`+`** `div.notion-block-add-button`: **24×24**, at block-x − 52, radius 4px, `transition: background .02s ease-in`. Tooltip: "Click to add below / Alt-click to add a block above".
  - **`⋮⋮`** drag handle: **18×24**, at block-x − 28, radius 4px, **cursor grab**. Tooltip: "Drag to move / Click or Ctrl to open menu".
  - Both hold a 20×20 svg, **fill `rgb(173,169,163)`** (dark `rgb(125,122,117)`). Hover bg `rgba(33,27,23,0.051)` (dark `rgba(255,255,255,0.055)`).
- **Vertically centred on the block's first text line** (H1: on the 39px line; paragraph: on the 24px line). Non-text blocks (image, code) align them near the top.

### Block action menu (click `⋮⋮`)
- A menu card **265px wide**, `shadow.menu`, radius 10px. It opens **beside the handle and flips to the left** when there's no room. The block gets a blue selection overlay `rgba(35,131,226,0.14)` while the menu is open.
- Search input "Search actions…" at the top. Section header "Text" (12px / 500 / 14.4px, `rgb(125,122,117)`, padding 0 8px, margin `6px 0 8px`).
- Rows **242×28**, radius 6px, padding 0 8px, gap 8px. Icon 20×20 `rgb(56,56,54)`, label 14px, shortcut hint 12px `rgb(161,158,153)`. Separators 1px `rgba(42,28,0,0.07)`.
- Items: Turn into ›, Color › | Copy link to block (Alt+⇧+L), Duplicate (Ctrl+D), Move to (Ctrl+⇧+P), Delete (Del) | Comment (Ctrl+⇧+M), Suggest edits | Ask AI (Ctrl+J), Skills › | footer "Last edited by …" (12px `rgb(161,158,153)`).
- **Colour flyout** (hover "Color"): opens to the right. Sections "Last used", "Text color", "Background color". Rows 197×28 with the 26px swatch tile + name.

## 5. Slash menu (`/`)
- Typing `/` in an empty block shows a grey inline chip "Type to search" after the slash.
- Card **324px wide, about 239px tall** (scrolling list + fixed footer), radius 10px, `shadow.menu`. Its left edge sits at the block's text edge − 5px. It opens **below** the line, or **flips above** when there's no room, with a 6px gap.
- Section headers: "Suggested", "Basic blocks", … ("Filtered results" when filtering). 12px/500 `rgb(125,122,117)` (dark `rgb(173,169,163)`).
- Rows **301×32** (32px pitch), radius 6px, padding 0 8px, gap 8px. **Icon 20×20 plain svg with no tile or box**, `rgb(56,56,54)`. Label 14px. Secondary text after " · " in 14px `rgb(161,158,153)` (e.g. "Heading 1 · Turn into"). **Markdown hint** right-aligned 12px `rgb(161,158,153)` ("#", "##", "###", "-", "[]", …).
- "New" badge (measured in dark): 30×18, 11px/500, padding 2px 4px, radius 4px, text `rgb(39,131,222)` on `rgba(67,155,255,0.24)`. In light it is the same blue family; its exact bg was not measured (use `--menu-badge-bg` `rgba(0,124,215,0.094)`).
- **Footer**: 32px, `border-top` 1px divider, padding 0 8px. "Close menu" 14px on the left, "esc" 12px `rgb(161,158,153)` on the right.
- The first row is auto-selected. ↑/↓ move it, Enter inserts, Esc closes. Selected row bg `rgba(33,27,23,0.051)` (dark `rgba(255,255,255,0.055)`).

## 6. Text-selection toolbar
> **In this build the selection toolbar is a vertical floating card, not the classic horizontal bar.**

- Card **192×323**, bg #fff (dark `rgb(37,37,37)`), **radius 14px, padding 8px**, `shadow.menu`. It is placed above the selection, or beside it when there's no room.
- Row 1: **"Normal Text ›"** (turn-into), 28px row.
- Row 2 (five 32×28 buttons, radius 6px, gap 4px): **A** (colour: a 20×20 tile, radius 6px, inset ring), **B**, *I*, U, Tx (clear formatting).
- Row 3: link, strikethrough, code `</>`, equation √x, ⋯.
- Row 4: "Comment" (icon + label) · emoji reaction · suggest edit.
- Then a "Skills" section (AI actions: Improve writing, Proofread, Explain, …) and an "Edit with AI" input (hint "Alt+⇧+E").
- Icons 20×20 `rgb(56,56,54)` (dark `rgb(230,229,227)`). **Active state (e.g. Bold on a bold selection): icon turns blue `rgb(39,131,222)`, with no background.**
- Dividers 1px `rgba(42,28,0,0.07)`, inset 12px.
- **Colour popover** (A): **190×278**, radius 10px, `shadow.menu`, padding 12px. Sections "Recently used", "Text color", "Background color". A **5-column swatch grid**: 30×30 cells (4px gap) with a 26×26 tile inside. The current colour has a 2px dark ring `rgb(44,44,43)`. Order: Default, Gray, Brown, Orange, Yellow / Green, Blue, Purple, Pink, Red.

> A clone may still choose the classic horizontal bar. If it does, use the same buttons, icons, active colour and menu shadow.

## 7. Placeholders
- They render via `::after { content: attr(placeholder) }`, coloured with **`-webkit-text-fill-color: rgba(21,14,0,0.286)`** (dark `rgba(255,252,235,0.306)`).
- Empty focused paragraph: **"Press ‘space’ for AI or ‘/’ for commands"**. It only shows on the focused empty block.
- Empty headings: "Heading 1" / "Heading 2" / "Heading 3", in the heading's own size.
- Empty page title: "New page".
