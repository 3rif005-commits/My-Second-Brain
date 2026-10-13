# Menus, overlays, pickers, empty states, focus and scrollbars

Sources: `_raw/i-empty-menus-overlays.md` plus the shared patterns from `b-shell.md`, `c-page-blocks.md` and `e-table-editing.md`
(measured 2026-10-12/13). This file is the **general pattern library**. Surface files reference it.

Screenshots:
[page menu](../screenshots/i-page-menu-light.jpg) ·
[danger row hover](../screenshots/i-menu-danger-hover-light.png) ([dark](../screenshots/i-page-menu-danger-dark.jpg)) ·
[emoji picker](../screenshots/i-emoji-picker-light.jpg) ([dark](../screenshots/i-emoji-picker-dark.jpg)) ·
[icons tab](../screenshots/i-icon-picker-light.jpg) ([dark with colour](../screenshots/i-icon-picker-color-dark.jpg)) ·
[icon colour popover](../screenshots/i-icon-color-popover-light.jpg) ·
[upload tab](../screenshots/i-icon-upload-light.jpg) ·
[date mention picker](../screenshots/i-date-mention-picker-light.jpg) ·
[settings modal](../screenshots/i-modal-settings-light.jpg) ([dark](../screenshots/i-modal-settings-dark.jpg)) ·
[focus ring](../screenshots/i-focus-ring-light.png) ·
[empty DB](../screenshots/i-empty-db-light.jpg) ([dark](../screenshots/i-empty-db-dark.jpg)) ·
[no results](../screenshots/i-no-results-light.jpg) ([dark](../screenshots/i-no-results-dark.jpg)) ·
[empty page body](../screenshots/i-empty-page-peek-light.jpg)

---

## 1. The menu (popover) primitive
| Property | Light | Dark |
|---|---|---|
| Background | `#ffffff` | `rgb(37,37,37)` |
| Radius | **10px** | same |
| Shadow (`shadow.menu`) | `rgba(25,25,25,0.05) 0 20px 24px 0, rgba(25,25,25,0.027) 0 5px 8px 0, rgba(42,28,0,0.07) 0 0 0 1px` | `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.2) 0 14px 28px -6px, rgba(25,25,25,0.118) 0 2px 4px -1px` |
| Border | **none** (the 1px edge is the shadow's last layer) | none (an opaque ring in the shadow) |
| Inner padding | 4px around the row list (8px 4px 4px when there is a search field) | |
| Row | **height 28px, 29px pitch (1px gap), radius 6px, padding 0 8px, gap 8px** | |
| Row label | 14px / 400 / 16.8px `rgb(44,44,43)` | `rgb(240,239,237)` |
| Row icon | 20px. `rgb(56,56,54)` in most menus, `rgb(44,44,43)` in the column header menu, grey `rgb(142,139,134)` in type lists | `rgb(230,229,227)` / `rgb(240,239,237)` / `rgb(173,169,163)` |
| Row hover / keyboard-active bg | `rgba(33,27,23,0.051)`, `transition: background .02s ease-in` | `rgba(255,255,255,0.055)` |
| Keyboard hint (right) | 12px `rgb(161,158,153)` ("Ctrl+D", "Ctrl+⇧+P", "Alt+⇧+L", "Del") | `rgb(125,122,117)` |
| Value text (right) | 14px `rgb(161,158,153)` (sometimes `rgb(125,122,117)`) | `rgb(125,122,117)` / `rgb(173,169,163)` |
| Submenu chevron › | 16px `rgb(142,139,134)` | `rgb(173,169,163)` |
| Checkmark ✓ | `checkmarkSmall` 16px `rgb(44,44,43)`, right-aligned | `rgb(240,239,237)` |
| Section header | **12px / 500 / 14.4px `rgb(125,122,117)`, padding 0 8px, margin 6px 0 8px**, no uppercase | `rgb(173,169,163)` |
| Divider | 1px `rgba(42,28,0,0.07)`, inset ≈12px each side, ≈4px vertical space each side | `rgba(255,255,243,0.082)` |
| Search field at top | 28px, radius 6px, padding 3px 6px, bg `rgba(66,35,3,0.03)`, **auto-focused**, focus ring `rgb(35,131,226) 0 0 0 1px inset, rgb(35,131,226) 0 0 0 1px` | bg `rgba(252,252,252,0.03)`, idle ring `rgba(255,255,235,0.1) 0 0 0 1px` |
| Footer meta text | 12px / 16px `rgb(161,158,153)`, margin 4px 0 | `rgb(125,122,117)` |

- **Danger row** (Delete, Move to Trash): **looks normal at rest. On hover the label and icon turn `rgb(229,100,88)`** (both themes), with the standard hover bg.
- **Disabled rows come in two styles:** (a) label and icon `rgb(188,186,182)` / dark `rgb(95,94,89)` at opacity 1 (header menu, e.g. Freeze). (b) the **whole row at `opacity: 0.4`** (Change type flyout, disabled primary buttons, disabled eye toggles).
- **Badges:** blue `rgb(39,131,222)` on `rgba(0,124,215,0.094)` (dark bg `rgba(67,155,255,0.24)`). Grey `rgb(142,139,134)` on `rgba(42,28,0,0.07)`. Both 11px / 500, radius 4px, padding 2px 4px.
- **Widths seen:** 180 (group menu, scale menu), 200 (Calculate, Change type), 220 (peek mode, property label menu, option colour menu, view ⋯), 248 (column header), 250 (dropdowns from rows), 256 (page ⋯), 260 (filter chip), 265 (block ⋮⋮), 290 (Filter/Sort pickers, views list), 300 (select editor, edit-property flyout), 317 (sort chip), 324 (slash), 360 (New ▾), 390 (new view), 415 (type picker).
- **Open animation:** `opacity 0→1` + `transform: scale(<1)→1`, **200ms ease**, `transform-origin` at the corner or edge nearest the anchor (e.g. `0% top` below-left, `100% top` below-right). Close is the reverse fade.
- **Placement:** anchored **4px below** the trigger by default, left-aligned (or right-aligned for right-edge triggers). It **flips above** when there's no room below, and is **clamped 12px inside the viewport**. Submenus are **adjacent flyouts** that overlap their parent by 4–19px and open on hover, click or →.
- **Keyboard:** see `database-table.md` §9.9. ↑/↓ move a highlight while focus stays in the search input. → / ← open and close flyouts. Enter picks. Esc closes the innermost layer.

## 2. Toggle switch
- Track **30×18** (26×14 + 2px padding, content-box), **radius 44px**. **Off `rgba(135,131,120,0.3)`** (dark `rgba(202,204,206,0.3)`). **On `rgb(39,131,222)`** in both themes. `transition: background 200ms, box-shadow 200ms`.
- Knob **14×14 white circle**, `translateX(0)` off, `translateX(12px)` on, `transition: transform 200ms ease-out, background 200ms ease-out`.
- It sits right-aligned in a 28px menu row. The whole row is the hit target (with a hover bg).

## 3. Tooltip
- bg **`rgb(44,44,43)` in both themes**, text `rgb(240,239,237)` **12px / 400 / 16.8px**, **padding 5px 8px, radius 6px**, max-width 300px, `width: max-content`.
- Shadow `rgba(0,0,0,0.08) 0 4px 12px -2px, rgba(255,255,255,0.05) 0 0 0 1px inset`.
- **A shortcut or secondary line** goes on its own line in `rgb(173,169,163)` (not a key-cap chip).
- Placement: centred **6px below** the trigger by default. Beside it (right, top-aligned) for the sidebar hamburger. Right-aligned for top-bar buttons at the edge.
- It shows after a **≈0.5s hover delay**, fading in with `opacity .05s ease-out`.

## 4. Modals
| Kind | Backdrop | Card |
|---|---|---|
| **Settings** | `rgba(15,15,15,0.6)` / dark **0.8** (`div.notion-modal-underlay`, no blur) | **90vw (max 1512px) × calc(100% − 100px)**, centred (50px top/bottom), **radius 12px**, bg #fff / `rgb(32,32,32)`, `shadow.modal`, `transition: transform .2s`. Close button 22×22 circle, top-right |
| **Confirm** (e.g. delete property) | same | **406px**, padding 20px, centred text, message 16px / 600 / 24px, full-width stacked buttons 32px, 8px apart (`database-table.md` §12) |
| **Automation editor** | same | 500×421, radius 12px, ✕ 20px circle bg `rgba(55,53,47,0.06)` |
| **Center peek** | `rgba(15,15,15,0.6)` / 0.8 | 975px max, 72px insets, radius 12px (`row-page.md` §1.2) |
| **Quick find** | **none** (transparent wrapper) | 1006px glass, radius 20px (`shell.md` §3) |

`shadow.modal` = light `rgba(25,25,25,0.24) 0 24px 48px 0, rgba(25,25,25,0.14) 0 4px 12px 0, rgba(42,28,0,0.07) 0 0 0 1px`; dark `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.64) 0 24px 48px 0, rgba(25,25,25,0.56) 0 4px 12px 0`.

**Buttons in dialogs and panels:**
| Style | Spec |
|---|---|
| Primary | bg `rgb(39,131,222)`, text `rgb(243,249,253)` 14px / 500, radius 6px, height 28–32, padding 0 8–12px. Light hover `rgb(31,118,204)`, dark hover `rgb(61,144,225)`. **Disabled: opacity 0.4** |
| Secondary / outlined | transparent, border `1px solid rgba(28,19,1,0.11)` (dark `rgba(255,255,235,0.1)`), text `rgb(44,44,43)` 14px / 500, radius 6px. Hover `rgba(33,27,23,0.051)` |
| Danger (outlined) | text `rgb(229,100,88)`, border `1px solid rgba(206,24,0,0.165)`, transparent |
| Quiet / text | no border, text `rgb(125,122,117)` or `rgb(142,139,134)`, hover bg only |
| Blue text link button | 12px `rgb(39,131,222)`, padding 2px 6px, radius 6px ("Hide all") |
| Circle close ✕ | 20–24px circle, bg `rgba(42,28,0,0.07)`, glyph 14px `rgb(142,139,134)` |

## 5. Emoji / icon picker
- Opens on a click of the page icon, **overlapping** the icon (no backdrop). **408×390**, radius 10px, `shadow.menu`.
- **Header 40px** (padding 0 8px, 1px divider below). Tabs **Emoji · Icons · Upload**: 28px tall, padding 0 8px, radius 6px, 14px. Selected `rgb(44,44,43)`, others `rgb(142,139,134)`. **The active tab has a 2px underline under the label only** (`border-bottom: 2px solid` text colour, at the header's bottom). "**Remove**" is right-aligned (14px `rgb(142,139,134)`).
- **Search row:** "Filter…" field 322×28 (radius 6px, bg `rgba(66,35,3,0.03)`, **idle ring `rgba(28,19,1,0.11) 0 0 0 1px`**, blue ring on focus) + a **shuffle (random)** button 28×28 (1px border, radius 6px) + a **skin-tone** button (Emoji tab) or an **icon-colour** button (Icons tab: a 14px dot).
- **Body:** category headers ("Recent", "People", …) **12px / 500 `rgb(125,122,117)`**, padding `6px 8px 0`, margin `6px 0 8px`. **Emoji cells 32×32, radius 4px, emoji 24px, no gap, 11 per row**, hover bg `rgba(33,27,23,0.051)`. Icons-tab cells are 32×32 with **radius 8px** and 24px glyphs.
- **Footer (Emoji tab):** a category bar of eleven 32×32 icon buttons (20px icons). The active one has the hover bg.
- **Icon colour popover:** 160×105, radius 10px. Two rows of five colour dots (22px hit areas, 20px dots), a divider, and an "Ask every time" row with a toggle.
- **Upload tab:** the card shrinks to 408×192. "Upload an image" is a 376×48 button (radius 4px, bg `rgba(66,35,3,0.03)`, 14px `rgb(125,122,117)`), with the hint "or Ctrl+V to paste an image or link" (12px `rgb(161,158,153)`). The footer has Cancel (quiet) and **Save** (primary, opacity 0.4 while disabled).
- Dark: card `rgb(37,37,37)`, tab underline `rgb(240,239,237)`, headers `rgb(173,169,163)`, cell hover `rgba(255,255,255,0.055)`.

## 6. Date picker
Fully specified in `database-table.md` §9.4. **The date-mention variant** is identical except that Date format defaults to "**Relative**". Clear and "Learn about reminders" are present in both.

## 7. Colour picker
Block text/background colours and their swatches: `blocks.md` §3 and §6. Option colour menu: `database-table.md` §6 and §9.2.

## 8. Focus rings (keyboard only, `:focus-visible`)
- **Buttons and rows:** `outline: 2px solid transparent` plus
  light `box-shadow: rgb(248,248,247) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px, rgba(255,255,255,0.25) 0 0 0 6px`;
  dark `rgb(25,25,25) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px, rgb(25,25,25) 0 0 0 6px`. The element keeps its own radius.
- **Inline links/mentions:** `rgb(255,255,255) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px`.
- **Inputs:** `rgb(35,131,226) 0 0 0 1px inset, rgb(35,131,226) 0 0 0 1px` (2px total). These show whenever the input is focused.
- Mouse clicks never show the button ring.

## 9. Scrollbars
- **Notion does not draw a custom scrollbar.** One global rule per theme:
  light `* { scrollbar-color: rgb(211,209,203) transparent; }`, dark `* { scrollbar-color: rgba(255,255,255,0.2) transparent; }`, `scrollbar-width: auto`.
- So it is the OS scrollbar (15px classic on Linux/Windows Chrome, a thin overlay on macOS). Horizontal strips that should not show a bar use `.hide-scrollbar { scrollbar-width: none } ::-webkit-scrollbar { display: none }`.

## 10. Empty states
- **Empty database (table):** **no message and no illustration.** The header row renders normally. Below it are **5 placeholder rows** (`.notion-table-view-empty-placeholder`, full table width, **37px** each with a 1px bottom divider; the title column keeps its right line). The "**+ New page**" label (14px `rgb(161,158,153)`) shows in **row 1 at rest and moves to whichever placeholder row is hovered**. Hover bg `rgba(55,53,47,0.024)` (dark `rgba(255,255,255,0.055)`). Clicking any of them creates a page. No calculation row.
- **No results (search or filter):** **no message.** A centred flex row (height 144px, gap 12px) right under the header row holds two buttons: "**Clear search**" and "**+ New page**", each 28px tall, padding 0 8px, radius 6px, **border 1px solid `rgba(28,19,1,0.11)`**, **14px / 500 `rgb(142,139,134)`**. Hover bg `rgba(33,27,23,0.051)`.
- **Empty page body:** "Press ‘enter’ to continue with an empty page, or <u>create a template</u>" (`row-page.md` §4). While a page loads, a **skeleton** of six rows shows (a light-grey ≈26px rounded square + a ≈121×14 bar, 35px pitch).
- **Empty board column / hidden groups:** not in the fixture (not captured).
