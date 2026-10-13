# App shell: sidebar, top bar, search, toast

Source: `_raw/b-shell.md` (measured 2026-10-12, viewport 1300×649, `getComputedStyle`).
Colours use the token names from `../tokens.json`. Raw rgb values are given inline so this file
stands on its own.

> **This is the 2026 Notion shell.** It is NOT the classic "Search / Home / Inbox" row list.
> The top of the sidebar is a **pill nav row**. There is **no** compose button next to the
> workspace name. "New page" is a **round floating button at the bottom** of the sidebar. The
> top bar has **no** Comments/Updates buttons. Clone this version.

Screenshots:
[sidebar light](../screenshots/b-sidebar-light.jpg) ·
[sidebar dark](../screenshots/b-sidebar-dark.jpg) ·
[collapsed](../screenshots/b-sidebar-collapsed-light.jpg) ·
[hover-peek light](../screenshots/b-sidebar-peek-light.jpg) ·
[hover-peek dark](../screenshots/b-sidebar-peek-dark.jpg) ·
[page ⋯ menu light](../screenshots/b-page-menu-light.jpg) ·
[page ⋯ menu bottom](../screenshots/b-page-menu-bottom-light.jpg) ·
[page ⋯ menu dark](../screenshots/b-page-menu-dark.jpg) ·
[search empty light](../screenshots/b-search-empty-light.jpg) ·
[search empty dark](../screenshots/b-search-empty-dark.jpg) ·
[search results light](../screenshots/b-search-results-light.jpg) ·
[search results dark](../screenshots/b-search-results-dark.jpg) ·
[toast](../screenshots/b-toast-light.jpg)

Note on screenshots: workspace names, non-fixture page titles and the user's name were blanked to
"Workspace" / "Page" / "Jane Doe" client-side. In the search screenshots the blanking also
overwrote snippet text, so "Page Page …" is an artifact, not real Notion text.

Font everywhere: the Notion UI stack (`tokens.json → font.ui`). Base text 16px/24px. Shell rows are 14px.

---

## 1. Sidebar

### Container
| Property | Light | Dark |
|---|---|---|
| Element | `nav.notion-sidebar-container` > `div.notion-sidebar` | |
| Width | **270px** default | same |
| Background | `rgb(249,248,247)` | `rgb(32,32,32)` |
| Right edge | **no border**: `box-shadow: rgb(240,239,237) -1px 0 0 0 inset` | `rgb(44,44,43) -1px 0 0 0 inset` |
| Text colour | `rgb(44,44,43)` | `rgb(240,239,237)` |
| Transition | `width 0.2s` (container); `width .2s, opacity .2s, transform .2s` (inner) | |

- Vertical layout: switcher (y 6–38) → nav pill row (y 52–84) → scroller (`div.notion-scroller.vertical`, y 92 to above the bottom bar, `padding-top 6px`) → bottom rows (Library, Help, Trash) → floating bottom bar.
- Min/max resize width: see the note at the end of this file.

### Workspace switcher (top row)
- `div.notion-sidebar-switcher`: 254×32 at x8 y6 (`margin 6px 8px`), radius **9999px** (a pill, visible on hover), `transition: background 0.02s ease-in`, cursor pointer.
- Inner: `padding 4px 8px`, flex, gap 8px.
- Avatar box **22×22, radius 4px**, margin-right 8px. Image 19.5×19.5, radius 4px.
- Notification dot: 8×8, bg `rgb(229,100,88)`, `1px solid` sidebar-bg border, radius 4px, overlapping the avatar's top-right.
- Name: **14px / 500 / 20px**, `rgb(44,44,43)` (dark `rgb(240,239,237)`), single line, ellipsis. **No chevron.**
- Right side: `div.notion-close-sidebar` ("Close sidebar", `«`), **24×24, radius 9999px**, margin `0 4px 0 10px`, hover-revealed (`transition: opacity .2s`).
- Hover bg: `rgba(33,27,23,0.05)` (dark `rgba(255,255,255,0.055)`).
- The switcher menu itself was not captured.

### Nav pill row (Home · Chat · Meetings · Inbox … Search)
- Container `div[aria-label="Sidebar navigation"]`: x8 y52, 216×32, flex, **gap 2px**, `transition: padding .2s ease-out`.
- **Selected item = pill with label.** Home: 85×32, radius 9999px, bg `rgba(33,27,23,0.05)` (dark `rgba(255,255,255,0.055)`), padding-left 8px, margin-right 4px. Icon 22×22 `rgb(56,56,54)`. Label "Home" **14px / 500 / 16.8px**, `rgb(44,44,43)`, padding-left 6px.
- **Unselected items = 32×32 round icon buttons** (radius 9999px, padding 0 5px). Icon 22×22, colour `rgb(142,139,134)` (dark `rgb(173,169,163)`). Order: Chat, Meetings, Inbox. Each expands into a labelled pill when selected (`transition: padding .2s ease-out, margin .2s ease-out`).
- Inbox unread badge: 12×12, **9px / 600**, text `rgb(253,246,246)` on `rgb(229,100,88)`, radius 9999px, padding 0 3px, top-right of the icon.
- **Search**: 32×32 round button, right-aligned at x226, `transition: background .1s ease-in-out`. It opens the quick-find dialog (§3).
- Hover on any of them: bg `rgba(33,27,23,0.05)` / dark `rgba(255,255,255,0.055)`.

### Section header ("Private", "Teamspaces", "Shared", "Favorites")
- `div.notion-outliner-private-header`: 254×30, radius 6px, padding 0 8px, gap 4px.
- Label **12px / 500 / 16px**, `rgb(161,158,153)` (dark `rgb(125,122,117)`), letter-spacing normal, no uppercase.
- **Hover:** bg `rgba(33,27,23,0.05)`. Label darkens to `rgb(95,94,89)`. A 12×12 chevron appears after the label (it toggles the section). Three 20×20 buttons appear at the right (gap 2px): "Open in Library" (arrow), "Add a page" (+), more (⋯).

### Page rows
| Property | Value |
|---|---|
| Element | `a` (radius 6px, 254×30, x8) > `div` (row) |
| Height / pitch | **30px**, **31px pitch** (1px gap) |
| Padding | depth 0: `5px 8px`; depth 1: `5px 8px 5px 16px` |
| **Indent per level** | **8px** (icon x17 at depth 0 → x25 at depth 1 → x33 at depth 2) |
| Font | row div 14px/500/21px, **label span weight 400** |
| Text colour | `rgb(95,94,89)` rest (dark `rgb(188,186,182)`); hovered/selected `rgb(44,44,43)` (dark `rgb(240,239,237)`) |
| Icon box | **20×20** (`.notion-record-icon`, radius 3.5px), margin-right 8px; emoji 14×14 inside (inset 3px); default page/database glyphs are 20×20 svg, `rgb(142,139,134)` |
| Selected (current page) bg | `rgba(33,27,23,0.05)` / dark `rgba(255,255,255,0.055)` |
| Hover bg | same as selected |

- **On row hover the icon is replaced by a toggle:** a 20×20 box (radius 4px, `transition: background .02s ease-in`, its own hover bg `rgba(33,27,23,0.05)`) holding a **12×12 chevron**: right-pointing when collapsed, down when expanded (`transition: transform .2s ease-out`).
- **Hover buttons at the right:** wrapper 45×20 (padding-left 3px, gap 2px). `+` ("Add a page inside") then `⋯` ("Delete, duplicate, and more…"). Each is **20×20, radius 4px**, icon 16×16 `rgb(142,139,134)` (dark `rgb(173,169,163)`), hover bg as above, `transition: background .1s ease-in-out`.
- "Add new" row at the end of a section: 30px row, plus icon 16×16 `rgb(173,169,163)`, label 14px/400 `rgb(161,158,153)` (dark `rgb(125,122,117)`).
- Labels truncate with an ellipsis.

### Bottom rows (Library, Help, Trash)
- 254×30, radius 6px, text 14px/400 `rgb(95,94,89)` (dark `rgb(188,186,182)`), icon **22×22** `rgb(142,139,134)` at x16, label at x46, `transition: background .15s`.

### Floating bottom bar (no background strip behind it)
| Item | Geometry | Light | Dark |
|---|---|---|---|
| "New chat" pill | 138×40 at x16, radius 999px, gap 6px | bg #fff, text 14px/500 `rgb(95,94,89)` | bg `rgb(44,44,43)`, text `rgb(188,186,182)` |
| Kbd chip "Ctrl+O" inside it | 12px/500, padding 2px 4px, radius 4px, margin-right -4px | `rgb(161,158,153)` on `rgba(66,35,3,0.03)` | `rgb(125,122,117)`, transparent |
| **"New page"** round button (compose icon) | **40×40** at x164, radius 999px, `transition: background .02s ease-in, transform .1s ease-out` | bg #fff | bg `rgb(44,44,43)`, icon `rgb(240,239,237)` |
| "What's new" round button | 40×40 at x214 | bg #fff | bg `rgb(32,32,32)` |

Shadows: the New chat and New page buttons use `shadow.floatButton`: light
`rgba(25,25,25,0.027) 0 8px 12px 0, rgba(25,25,25,0.027) 0 2px 6px 0, rgba(42,28,0,0.07) 0 0 0 1px`,
dark `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 4px 12px -2px`. The what's-new button is lighter:
light `rgba(0,0,0,0.04) 0 2px 4px 0, rgba(42,28,0,0.07) 0 0 0 1px`, dark `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 2px 4px 0`.

### Resize handle
- `div[role=separator]` ("Resize with left and right arrow keys"): **12px wide**, full height, centred on the sidebar's right edge, `cursor: col-resize`. A 1px line element is its parent.

### Collapsed sidebar and hover-peek
- Collapse: `«` button or **Ctrl+\\**. `.notion-sidebar-container` animates `width 270→0` over 0.2s. The inner sidebar slides out (`transform: translate(-250px, 59px)`).
- The top bar then shows a **hamburger** `div.notion-open-sidebar` at x12 y10, **24×24, radius 6px** (tooltip "Lock sidebar open / Ctrl+\\"), carrying the Inbox badge. Breadcrumbs move to x42, and "Edited 7m ago" appears before Share (14px, `rgb(161,158,153)`).
- **Peek:** hovering the hamburger (not the screen edge) shows the sidebar as a floating panel at x0 y59, **270×558**, bg #fff (dark `rgb(32,32,32)`), **radius `0 8px 8px 0`**, `shadow.menu` (light `rgba(25,25,25,.05) 0 20px 24px 0, rgba(25,25,25,.027) 0 5px 8px 0, rgba(42,28,0,.07) 0 0 0 1px`; dark `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,.2) 0 14px 28px -6px, rgba(25,25,25,.118) 0 2px 4px -1px`). Its close button becomes `»` ("lock open").

---

## 2. Top bar

- `div.notion-topbar`: **height 44px**, starts at the sidebar's right edge. **No bg, no border, no shadow.** `transition: opacity .7s, color .7s`.
- **Breadcrumb item:** 24px tall, radius 6px, padding `0 5px 0 3px`, **14px / 400 / 16.8px** `rgb(44,44,43)` (dark `rgb(240,239,237)`), icon 18×18 (radius 3.5px), margin-right 5px. Long titles truncate (max-width ≈140px of text). Hover bg `rgba(33,27,23,0.05)`.
- After the page crumb: a **permission pill** ("🔒 Private ⌄"): padding 0 6px, radius 6px, label 14px `rgb(161,158,153)` (dark `rgb(125,122,117)`) + a small chevron.
- **Right cluster** (right-aligned, 12px from the edge):
  - **Share**: `div.notion-topbar-share-menu`, 71×28, radius 6px, padding 0 8px, gap 6px, lock icon 12×20 `rgb(56,56,54)`, text 14px/400. Plain text button, **not** a blue button.
  - **Copy link**: 28×28, radius 6px, icon 20×20 `rgb(142,139,134)` (dark `rgb(173,169,163)`).
  - **Favorite (star)**: 28×28, radius 6px.
  - **More `⋯`** (`notion-topbar-more-button`, tooltip "Page settings & actions"): 28×28, icon 22×22 `rgb(56,56,54)` (dark `rgb(230,229,227)`).
  - Hover bg on every button: `rgba(33,27,23,0.05)` / dark `rgba(255,255,255,0.055)`, radius 6px, `transition: background .1s ease-in-out` (More uses .02s).
- "Edited N ago" is only shown when the sidebar is collapsed.

### Tooltip (shared style for every tooltip)
`bg rgb(44,44,43)` (same in dark), text `rgb(240,239,237)` **12px / 16.8px**, secondary line `rgb(173,169,163)`,
**padding 5px 8px, radius 6px**, `box-shadow: rgba(0,0,0,.08) 0 4px 12px -2px, rgba(255,255,255,.05) 0 0 0 1px inset`.
Placed ~6px below the trigger (right-aligned for right-edge buttons). Fade-in `opacity .05s ease-out` after ~0.5s hover delay.

### Page `⋯` menu
- Opens directly **under the top bar (top = 44px)**, right edge 12px from the viewport edge. **256px wide**, `max-height: 80vh`, min-width 180px.
- Card: bg #fff / dark `rgb(37,37,37)`, **radius 10px**, `shadow.menu`.
- **Open animation:** `transform-origin: 100% top`, scale from smaller to 1 with opacity, **`transition: opacity, transform 200ms ease`**.
- Container padding `8px 4px 4px`, gap 1px. Rows are `role=option` inside a `role=listbox`.
- **Search field** first: input box 217×28 (in a 233×36 row, padding 4px 8px), radius 6px, padding 3px 6px, bg `rgba(66,35,3,0.03)` (dark `rgba(252,252,252,0.03)` with `rgba(255,255,235,0.1) 0 0 0 1px` ring), 14px/20px, placeholder "Search actions…". It is auto-focused, with focus ring `rgb(35,131,226) 0 0 0 1px inset, rgb(35,131,226) 0 0 0 1px`.
- **Font tiles** (Default / Serif / Mono): 3 tiles, each 72×61, radius 4px, padding `10px 6px 6px`, `transition: color .3s, border .3s`. "Ag" glyph: Default 24px sans, Serif 25px, Mono 26px (letter-spacing -1px). Caption 12px/16px `rgb(125,122,117)`, margin-top 4px. **The selected tile's glyph and caption are blue `rgb(39,131,222)`.**
- **Rows:** 233×28, padding 0 8px, gap 8px, radius 6px, hover bg `rgba(33,27,23,0.05)`. Icon 20×20 `rgb(56,56,54)` (dark `rgb(230,229,227)`). Label 14px/400/16.8px. **Shortcut hint** right-aligned 12px `rgb(161,158,153)` (dark `rgb(125,122,117)`), e.g. "Ctrl+Alt+L", "Ctrl+D", "Ctrl+⇧+P". Submenu rows have a 12px chevron. Value text (e.g. "Comments", "None") 14px `rgb(161,158,153)`.
- Order: Copy link, Copy page contents, Duplicate, Move to, Move to Trash | Small text ⏻, Full width ⏻, Customize page | Lock page ⏻, Use with AI › | Suggest edits, Translate › | Import, Export, Turn into wiki | Updates & analytics, Version history | Notify me (Comments) ›, Connections (None) › | meta.
- **Dividers:** 1px, inset 12px each side, `rgba(42,28,0,0.07)` (dark `rgba(255,255,243,0.082)`).
- **Toggle switch:** track **30×18**, radius 44px, padding 2px, off `rgba(135,131,120,0.3)` (dark `rgba(202,204,206,0.3)`). The "on" colour is in `menus-overlays.md`. Knob 14×14 white, radius 44px. `transition: background .2s, box-shadow .2s`; knob `transform .2s ease-out`.
- **Meta footer:** "N words", "Last edited by …", "Today at 6:39 PM". Each 12px/16px `rgb(161,158,153)`, margin 4px 0.
- **Submenus** (e.g. Translate) open on hover as a flyout, to the left when there is no room on the right, 233px wide.

---

## 3. Search / quick find (Ctrl+K, or the Search pill)

- `role=dialog`, **1006px wide**, horizontally centred over the **whole** viewport (including the sidebar), **top = 9vh**. Height grows with content and is capped by the viewport. CSS grid rows `auto auto minmax(0,1fr) auto`.
- **Glass card:** bg `rgba(255,255,255,0.9)` + **`backdrop-filter: blur(40px)`** (dark `rgba(32,32,32,0.9)`), **radius 20px**, overflow hidden.
  Shadow light `rgba(25,25,25,0.24) 0 24px 48px 0, rgba(25,25,25,0.14) 0 4px 12px 0, rgba(42,28,0,0.07) 0 0 0 1px`;
  dark `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.64) 0 24px 48px 0, rgba(25,25,25,0.56) 0 4px 12px 0`.
  `transition: height .2s, width .2s`.
- **No dimmed backdrop.** The fixed full-screen wrapper is transparent. It appears without a visible animation and closes on Esc.
- **Input row:** margin 12px, gap 8px, search icon 20px, `input` **16px / 400 / 24px**, no border. Placeholder "Search or ask a question in <Workspace>…" (light grey). Right: two 32×32 round buttons with **blue icons `rgb(39,131,222)`**: "Hide highlight pane" and "Hide filters".
- **Filter chips row:** "Title only", "Created by ⌄", "In ⌄": 24px tall, **radius 32px**, padding 0 8px, gap 6px, 14px/24px `rgb(125,122,117)` (dark `rgb(173,169,163)`). "+ Filter": radius 12px, padding `0 9px 0 5px`, `rgb(161,158,153)`.
- **Results list (left column, 557px):**
  - Section headers ("Today", "Yesterday", "Past week"): **12px / 500 / 14.4px**, `rgb(125,122,117)` (dark `rgb(173,169,163)`), padding 0 8px, margin `6px 0 8px`.
  - Row (empty query): 557×36, **radius 12px**, padding 4px 8px, 37px pitch, gap 8px. Icon 20×20. Title **14px / 500** `rgb(95,94,89)` (dark `rgb(188,186,182)`), then "—" 12px, then the path 12px `rgb(161,158,153)` with " / " separators (padding 0 4px).
  - Hover = keyboard-selected: bg `rgba(33,27,23,0.05)` (dark `rgba(255,255,255,0.055)`). The selected row also shows a 14×14 ↵ icon at the right.
- **With a query:** a header row with "Pages" on the left and "Best matches ⌄" on the right (12px/500, radius 4px). Rows become two lines, 557×55, padding 8px, radius 12px. Line 1 is the title plus a type pill (11px/500 `rgb(142,139,134)` on a light grey pill). Line 2 is the path or snippet at 12px/16.8px. **Matched terms are blue `rgb(39,131,222)`, weight 500, with no background.**
- **Preview pane (right column, x≈762–1139):** a bordered card showing the breadcrumb (12px), the page title (bold, about 20px) on an 82px grey header band, and two small white icon buttons (copy link, open) at its top-right. It can be hidden with the blue toggle.
- The footer and max-height were not captured (the 649px viewport was too short).

---

## 4. Toast (snackbar)

- Trigger example: Copy link → "Copied page link to clipboard".
- Wrapper: `position: fixed; bottom: 24px; left: 0; width: 100%; z-index: 1000000; padding: 4px; display: flex; pointer-events: none`.
- Toast: auto width (212×43 for that text), **centred horizontally**, bg **`rgb(44,44,43)` in both themes**, text `rgb(240,239,237)` **14px / 400 / 21px**, **radius 8px, padding 11px 16px**. Shadow is light `shadow.menu`, dark `shadow.menu` dark.
- Animation: `0.27s snackbar-slide-in-bottom`; `transition: transform .27s, opacity .27s`. It stays about 7–9s.

---

## Keyboard shortcuts seen
| Shortcut | Action |
|---|---|
| Ctrl+K | Quick find |
| Ctrl+\\ | Toggle (lock) sidebar |
| Ctrl+O | New chat (AI) |
| Ctrl+Shift+L | Toggle light/dark |
| Ctrl+Alt+L | Copy link (page menu hint) |
| Ctrl+D | Duplicate |
| Ctrl+Shift+P | Move to |
