# UI audit and redesign spec: My Second Brain → Notion look

**Status: built.** The decisions in §5 were approved with the recommended options, and
all seven phases of §4.8 are done (see §6 for the result, what changed and what is left).

- **What it compares:** the app on `feat/ai-harness` against the measured Notion reference in
  [`docs/notion-reference/`](../notion-reference/README.md) (tokens, 331-item checklist, 280 screenshots).
- **How the app was captured:** 2026-10-13, running locally, logged in with the E2E test account, at the
  same 1300×649 viewport, in light and dark.

**How to read this folder**
| Path | What |
|---|---|
| `compare/*.jpg` | Side by side: **Notion on the left, our app on the right**. Same viewport. |
| `app-screens/*.jpg` | Every app screen captured, light and dark. |
| `scripts/` | The Playwright scripts that took the captures. Run `shoot.mjs` first (it logs in with `E2E_EMAIL`/`E2E_PASSWORD` and saves the session to `$AUDIT_TMP/auth.json`), then `dbshoot.mjs`. They are re-run after each build phase to compare again. |

**One caveat about the database captures:** the cloud machine has no `DATABASE_URL`, so the database API
can't run here. The database screens were rendered by the **real app components** with the API answered
by a fixture that mirrors the Notion "Projects" test database (`scripts/dbshoot.mjs`). The rendering is
real; only the data is canned.

---

## 1. The verdict in one paragraph

The app has Notion's **structure and features**: every view type, peeks, view settings, property menus,
and editors. It doesn't have Notion's **visual system**. In numbers:

- **2,351** hard-coded Tailwind gray classes (`gray-*`, `slate-*` …)
- **439** indigo/brand classes
- **74** native `<select>` dropdowns and **24** native checkboxes
- **28** components drawing their own popups
- the Inter font instead of Notion's system font
- a dark navy sidebar in *both* themes

So every screen is "almost right but off". Only the menus already use measured Notion tokens (`--menu-*`).
Fixing screens one at a time would never converge. The fix is a **token + component foundation first**,
then a pass over every surface against the checklist. That is the plan in §4.

## 2. Root causes (fix these and most gaps disappear)

| # | Root cause | Evidence | Effect |
|---|---|---|---|
| R1 | **No design tokens.** Colors are raw Tailwind classes everywhere. | 2,351 gray and 439 indigo classes across 168 files | Cool blue-grays instead of Notion's warm grays, indigo instead of Notion blue, and inconsistent hover and borders on every screen |
| R2 | **Wrong font.** `Inter` via `next/font`. | `tailwind.config.ts`, `app/layout.tsx` | Text is wider and rounder than Notion's system stack, on every screen |
| R3 | **Sidebar is a dark navy panel** (`bg-[#0d1220]`, `bg-gray-900`) in light mode too. | `components/sidebar/*` | It's the biggest visual difference on every screen. Notion's sidebar is warm off-white `rgb(249,248,247)` |
| R4 | **No shared controls.** Each page builds its own buttons, selects, toggles and dialogs. | 74 `<select>`, 24 checkboxes, 28 private popups | The settings pages and view config bars look like a browser form, not an app |
| R5 | **Dark mode is a color swap, not a theme.** | see the dark bugs in §3.9 | Broken screens in dark mode |
| R6 | **No page frame.** There is no 44px top bar with breadcrumbs, Share and `⋯`, no 720px page column, and no 96px database gutter. | home, note and database screenshots | Content floats at the wrong width, and titles are small |

## 3. Gap list by area

Severity: **H** = visible at a glance and makes it "not Notion"; **M** = noticeable when you use it;
**L** = detail. Checklist numbers (`#n`) refer to [`checklist.md`](../notion-reference/checklist.md).

### 3.1 Global (A)
| Sev | Gap | Notion target |
|---|---|---|
| H | Inter font | System stack (#1) |
| H | Cool grays (`gray-500` text, `gray-200` borders) | Warm text `rgb(44,44,43)` / `rgb(125,122,117)`, divider `rgba(42,28,0,0.07)` (#3–7, #11) |
| H | Indigo accent (buttons, links, focus, checkboxes) | Blue `rgb(39,131,222)`, focus `rgb(35,131,226)` (#8–9) |
| M | Focus rings vary per component; some show on mouse click | One keyboard-only ring (#14–16) |
| M | Hover backgrounds vary (`gray-50`, `gray-100`, `white/5` …) | One hover `rgba(33,27,23,0.051)` (#6, #12) |
| L | No Ctrl+Shift+L theme toggle | #17 |
| L | Next.js dev indicator in the bottom-left corner (dev only) | Hide it in screenshots (`devIndicators: false`) |

### 3.2 Sidebar (B) (`compare/home-light.jpg`)
| Sev | Gap | Notion target |
|---|---|---|
| H | Dark navy panel in light mode | `rgb(249,248,247)` L / `rgb(32,32,32)` D, inset 1px edge (#19–20) |
| H | 260px wide | 270px, resizable, collapsible with Ctrl+\\ (#18, #41–43) |
| H | Big indigo "+ New Note" button | Floating round "New page" button at the bottom (#40) |
| H | Five stacked nav rows (Search, Notifications, Workspace, Activity, Settings) | Workspace switcher row, then a pill nav row (Home, Inbox …, Search on the right) (#21–28) |
| M | Section headers are UPPERCASE with icons (RECENT, DATABASES, NOTES) | 12px/500 sentence case, hover shows chevron, `+` and `⋯` (#30–31) |
| M | Page rows: no hover chevron or `⋯`/`+`, 📄 emoji for every page | 30px rows, hover swaps the icon for a chevron and shows `⋯` and `+` (#32–38) |
| M | "Sign out" and the theme toggle sit in the sidebar footer | Move them into the workspace switcher menu and Settings. Footer rows: Library-style links, Trash (#39) |

### 3.3 Top bar, search, toast (C, D)
| Sev | Gap | Notion target |
|---|---|---|
| H | No top bar on pages. A "My Brain › Untitled" breadcrumb sits inside the content | 44px top bar: breadcrumbs, "Edited …", Share, link, ★, `⋯` (#44–50) |
| H | No page `⋯` menu with fonts, Small text and Full width | 256px page menu with font tiles and toggles (#51–56). This is also where per-page customization lives |
| M | Search (⌘K) opens the AI assistant panel, not quick find | Centered glass quick-find dialog with results and preview (#64–72) |
| M | Toasts are not Notion style | Dark centered toast, 24px from the bottom (#62–63) |
| L | Tooltips are not unified | #57–61 |

### 3.4 Page and blocks (E, F) (`compare/app-home-note-grid.jpg`)
| Sev | Gap | Notion target |
|---|---|---|
| H | Title about 28px, page icon is a generic 📄 | 40px/700 title, 78px icon overlapping the cover, cover 30vh (#73–82) |
| H | Content width doesn't match | 720px column, minimum 96px gutter, Full-width option (#73–74) |
| H | Callout and headings from the AI ingest use saturated fills (orange H1 band) | Notion block colors: muted backgrounds from `color.block` (#114–115). The ingest's "importance" colors need to be remapped to these |
| M | "Properties" toggle under the title | Notion shows page properties only for database rows. Keep it, but restyle it as the properties block (#268–276) |
| M | BlockNote default spacing, list markers, code, quote and divider | Measured block metrics (#87–113) |
| M | Slash menu, block handle and selection toolbar use BlockNote/Mantine defaults | #116–126 |
| L | Empty-block placeholder text | #126 |

### 3.5 Database page, header and toolbar (G) (`compare/db-table-light.jpg`)
| Sev | Gap | Notion target |
|---|---|---|
| H | Database title is 18px in a toolbar row | 32px/700 page title in the page column, with the 96px gutter (#81, #127) |
| H | View tabs are plain text without icons | 32px pills with type icons, active pill bg, "N more…" overflow (#128–131) |
| H | No blue **New** split button. Toolbar icons are greyed and duplicated (two gears, `⋯` at the top right) | Filter, Sort, Automations, Search, Settings, then the blue New ▾ button (#132–138) |
| M | Header `⋯` and gear sit separately above the tabs | Fold them into the page top bar `⋯` and the toolbar Settings |

### 3.6 Table (H, I) (`compare/db-table-light.jpg`, `db-table-row-hover`, `db-table-header-menu`, `db-table-date-editor`)
| Sev | Gap | Notion target |
|---|---|---|
| H | Rows are about 50px and wrap ("Oct 3,⏎2026", "Not⏎started") | 37px single-line rows, no wrapping by default (#146–147) |
| H | Status shows a grey dot plus plain text | A status **pill**: tinted bg, colored dot, radius 10px (#159) |
| H | Select and multi-select pills are round, with Tailwind tints | Radius 4px, 20px tall, `color.option` palette in light and dark (#158, #160–162) |
| H | URLs are blue links, empty cells show "—" | URLs in text color with a thin underline; empty cells blank (#167–168, #173) |
| H | Header labels are 14px dark with a heavy bottom border | 14px `rgb(125,122,117)`, 36px tall, one hairline, no top or vertical header lines (#139–142) |
| M | Grid lines are cool gray | `rgba(42,28,0,0.07)` hairlines (#145) |
| M | Date cells use the short form "Oct 3, 2026" and wrap; the editor is the browser's native date input | "October 3, 2026", ranges with " → ", and the Notion 248px date picker (#164, #194–199) |
| M | OPEN button style and position, plus gutter `+`, ⋮⋮ and checkbox | #152–154 |
| M | No "+ New page" row at the bottom of the table | 37px row with "+ New page" (#174) |
| M | Header menu items are close, but the header menu shows no type-icon button style | Mostly fixed by tokens (#204–209) |
| L | Calculation footer and inline-database details | #175–179 |

### 3.7 Board, gallery, list, calendar, timeline, chart (J, K)
| Sev | Gap | Notion target |
|---|---|---|
| H | **Board and Gallery show a row of native form controls** (Hide empty groups, Card preview, Card size, Card layout) above the view | These belong in View settings › Layout, never inline (#288–289) |
| H | Board cards print every property with a "Status:" label and "—" for empty ones | No labels, empty properties hidden, 15px/500 title, 260px cards (#228–233) |
| H | Board columns: no colored header pill, no tint, no "+ New page" per column | #224–227, #234 |
| H | Gallery: a grey image placeholder icon on every card, with labelled properties | A plain tinted placeholder or the cover, no labels (#236–240) |
| H | Calendar: flat blue bands, "+1 more" | White event chips with shadow; cells grow; no "+N more" (#243–251) |
| H | Timeline: a split table with OPEN links, and tiny blue dots or squares as bars | Full-bleed timeline, 34px white bars with titles, red today line (#252–256) |
| H | Chart: "no y-axis configured yet" on a fresh chart | Defaults to a count by the group property, bars in option colors (#257–259) |
| M | List: no right-aligned properties, page icons faint | #241–242 |

### 3.8 Row page and view settings (L, M) (`compare/db-row-peek-light.jpg`, `db-view-settings-light.jpg`)
| Sev | Gap | Notion target |
|---|---|---|
| M | The side peek works but its top bar is minimal (`×`, `⤢` … "Open in Workspace") | 44px top bar with », ⤢, peek mode, ↑ ↓, Share and `⋯`; side peek 650px pushes the page (#260–263) |
| M | Property rows: icon color and label column | 160px label column, 34px rows at a 38px pitch, "Empty" placeholder (#268–276) |
| M | Peek title 20px | 32px/700 in a peek, 40px full page (#265) |
| M | View settings panel exists but needs token styling and the layout cards | #281–295 |

### 3.9 Dark mode bugs (`app-screens/*-dark.jpg`)
| Sev | Bug |
|---|---|
| H | The database title input renders as a **white bar** in dark mode (`db-table-dark.jpg`) |
| H | The home screen in dark mode has a grey wash and unreadable text (`compare/home-dark.jpg`) |
| M | Dark backgrounds are navy (`#0d1220` / `gray-900`) instead of Notion's neutral `rgb(25,25,25)` / `rgb(32,32,32)` |

### 3.10 Settings (O) (`compare/settings-ai-providers-light.jpg`, `app-settings-grid.jpg`)
| Sev | Gap | Notion target |
|---|---|---|
| H | Settings is a page with a thin top tab bar of 7 links | A **modal** (90vw, max 1512px, radius 12px) with a 240px left nav, search, and grouped sections (#305, #310–316) |
| H | No Account or Preferences page. Theme lives in the sidebar footer | Preferences is the first page (#328–331) |
| H | Every page has its own layout: different widths, title sizes and indents; MCP centered; Routing in cards | One content column (800px max, 36px 60px padding), 26px/600 title, sections with hairlines, setting rows with label, help text and control on the right (#317–321) |
| H | Native selects, indigo filled buttons, washed-out disabled indigo "Save" and "Connect" | Notion select button and menu, toggles, primary blue, danger pale red, disabled at opacity 0.4 (#322–325) |
| M | Sub-tabs (Routing: Targets/Rules/…, MCP: Servers/Audit log) use underlines | 28px pill sub-tabs (#326) |
| M | Skills page shows "Loading…" on an empty two-pane layout | A proper empty state and loading skeleton |

## 4. The redesign spec

### 4.1 Principle
**Pure Notion by default, customizable by the user, built once on tokens.** Every color, size, radius,
shadow and duration comes from `docs/notion-reference/tokens.json`. Components use **semantic tokens
only**. A raw Tailwind color in a component counts as a build failure (§4.7).

### 4.2 Token layer (Phase 1)
- **`frontend/app/tokens.css`:** CSS variables generated from `tokens.json` for `:root` (light) and `.dark`.
  - text, icon, bg, border, accent, toggle, shadow, and the `option` and `block` palettes
  - radius, durations, z-index
  - The existing `--menu-*` tokens fold into this file. They were re-verified and are unchanged.
- **`tailwind.config.ts`:** semantic names mapped to those variables, for example:
  - colors: `bg-app`, `bg-sidebar`, `bg-hover`, `text-primary`, `text-secondary`, `border-divider`,
    `accent`, `option-blue-bg`
  - shadows: `shadow-menu`, `shadow-card`
  - radius: `rounded-card`
  - The font stacks (`ui`, `serif`, `mono`, `code`) replace Inter.
- **Customization lives here too.** Accent, density, font and text size are variables or classes on
  `<html>`, so a preference changes the whole app at once (§4.6).

### 4.3 Component kit (Phase 2): `frontend/components/ui/`
Each component is built once to the reference, with light and dark, keyboard and focus behavior, and a
unit test. The existing `primitives/` (Popover, MenuList, SidePeek, HoverAffordance, IconPicker) are kept
and restyled.

| Component | Replaces | Reference |
|---|---|---|
| `Button`: primary, secondary (outlined), ghost, danger, icon (28×28), split (New ▾) | Every ad-hoc button | `menus-overlays.md`, #134–135, #307 |
| `Select` (button plus menu, ✓ on the selected option) | **74 native `<select>`** | #322–323 |
| `Toggle` (30×18) and `Checkbox` (16px) | **24 native checkboxes** in settings and config | #166, #200 |
| `Input` / `SearchInput` | Assorted inputs | #15 |
| `Menu` / `Submenu` / `MenuRow` / section header / hint | The 28 private popups | #296–302 |
| `Tooltip`, `Toast`, `Dialog` (confirm 406px), `Modal` | ConfirmDialog, PromptDialog, the remaining `window.confirm` | #57–63, #215–216, #305–306 |
| `Tag` (select, multi-select, status pill with dot) | The pill code inside the cells | #158–162 |
| `Tabs` (view pills, settings sub-tab pills) | Underline tabs | #128–130, #326 |
| `SettingsPage` / `SettingsSection` / `SettingsRow` | Each settings page's own layout | #317–321 |
| `EmptyState`, `Skeleton` | "Loading…", "No databases yet" text | #308–309 |

### 4.4 Surfaces (Phases 3–6), each against its checklist section
1. **App shell:**
   - sidebar (§3.2)
   - top bar and breadcrumbs plus the page `⋯` menu (§3.3)
   - quick find on ⌘K, with the AI assistant on its own shortcut and button
   - toasts and tooltips
2. **Page and blocks:**
   - the page frame (cover, icon, title, 720px column, full width)
   - a BlockNote theme mapped to the tokens: block spacing, headings, lists, to-do, callout, quote,
     code, divider, colors
   - slash menu, handle and selection toolbar
   - the ingest's importance and callout colors remapped to `color.block`
3. **Database:**
   - header, tabs and toolbar
   - the table (row metrics, cells, pills, dates, URL and empty cells, gutter, New page row,
     calculations)
   - every editor (date picker instead of the native input)
   - board, gallery, list, calendar, timeline, chart
   - the row page and peeks, view settings
   - the Board and Gallery config controls move out of the inline bar into View settings › Layout
4. **Settings:**
   - the modal with the left nav (§4.5)
   - every existing page re-laid out with `SettingsPage`/`SettingsRow`
   - new Account and Preferences pages
5. **Every other screen** (chat, ingest, activity, workspace, login and signup, share, forms): tokens and
   kit only, keeping their own layouts.

### 4.5 Settings information architecture
Settings opens as a modal from the workspace switcher (and from `/brain/settings/...` deep links, which open
the modal on that section). Left nav:

- **Account:** Profile (name, avatar, email, sign out) · **Preferences** · Notifications
- **AI:** Providers · Routing · Skills
- **Integrations:** Notion · MCP servers · Connected apps
- **Workspace:** General (name, icon) · Import / export · Background jobs · Activity log
- **Search settings** at the top. Results are grouped by section, with matches in bold.

### 4.6 User customization (the "customize your experience" layer)
**Defaults are pure Notion.** Everything below is stored per user in Supabase auth `user_metadata`,
which needs no migration. It's cached in `localStorage` so it applies before the first paint (no flash).

| Setting | Options | Default | Where |
|---|---|---|---|
| Theme | Use system / Light / Dark (+ Ctrl+Shift+L) | System | Preferences |
| Accent color | Notion blue, plus a curated set (purple, green, orange, pink, gray) | Blue | Preferences › Appearance |
| Contrast | Standard / High | Standard | Preferences › Appearance |
| Default page font | Default / Serif / Mono | Default | Preferences, and per page in `⋯` |
| Small text by default | toggle | off | Preferences, and per page in `⋯` |
| Full width by default | toggle | off | Preferences, and per page in `⋯` |
| Density | Comfortable / Compact (table rows, sidebar rows, menus) | Comfortable | Preferences › Appearance |
| Sidebar | width (drag), collapsed state | 270px, open | Sidebar itself |
| Open database pages in | Side peek / Center peek / Full page | Side peek | Preferences, and per view |
| Table defaults | Vertical lines, page icons, wrap content | on, on, off | Preferences, and per view |
| Start page | Last visited / Home / A chosen page | Last visited | Preferences |
| Start week on Monday | toggle | off | Preferences |
| Date format | Full / Short / M/D/Y / D/M/Y / Y/M/D / Relative | Full | Preferences |
| Time format | 12h / 24h | from locale | Preferences |
| Number format | Default / 1,000,000.00 / 1.000.000,00 | Default | Preferences |
| Enter for new line | toggle | off | Preferences |
| Reduce motion | Use system / On / Off | system | Preferences |

**Accent rule:** the accent changes only accent tokens (primary buttons, checked boxes, selection, links in
menus, focus). Grays, option colors and block colors never change, so every accent still looks like Notion.

### 4.7 Definition of done (verifiable, so it's one pass)
1. **No raw colors:** an ESLint rule (or a Vitest guard) fails on `gray|slate|zinc|neutral|indigo|violet|purple|blue-\d`
   Tailwind classes and on hex or `rgb()` literals in `components/` and `app/`. Tokens only.
2. **No native controls:** no `<select>` or `type="checkbox"` outside `components/ui/`, and no
   `window.confirm`/`alert`. This is enforced by the same guard.
3. **Measured values match:** a Playwright **parity test** reads computed styles for the measurable
   checklist items (sizes, colors, radii, shadows) on the fixture database and pages, in light and dark.
   The checklist becomes an automated test.
4. **Visual check:** `scripts/` re-captures every screen. The `compare/` pairs are regenerated, and each H
   and M gap in §3 is ticked with its after-image.
5. **No regressions:** the existing Vitest and Playwright suites stay green, and the existing
   database behavior tests are untouched.

### 4.8 Build order and size
| Phase | Scope | Rough size | Gate before the next phase |
|---|---|---|---|
| 1 | Tokens, font, theme provider (system theme, Ctrl+Shift+L, no flash), raw-color guard (report-only) | S | Tokens render in light and dark |
| 2 | Component kit (§4.3) with tests | M | Kit reviewed on a demo route |
| 3 | App shell: sidebar, top bar, page menu, quick find, toast, tooltip | M | Checklist B–D |
| 4 | Database: header, table, editors, all views, peeks, view settings | **L** | Checklist G–M |
| 5 | Page and BlockNote theme, ingest color remap | M | Checklist E–F |
| 6 | Settings modal plus Preferences/customization (§4.5–4.6) | M | Checklist O, all preferences persist |
| 7 | Remaining screens; guard switched to **failing**; parity test; final compare | M | §4.7 all green |

Each phase is one PR on top of `feat/ai-harness`, with before and after compare images.

## 5. Decisions needed from you
1. **Sidebar design: 2026 or classic?** Notion's current sidebar has a pill nav row and a floating New page
   button (that's what was captured). The classic version has vertical Search, Home and Inbox rows.
   *Recommendation: 2026, since it's measured.*
2. **Settings as a modal** (Notion) instead of a full page? *Recommendation: modal, keeping the
   `/brain/settings/...` URLs as deep links.*
3. **Branding:** keep your logo and name only in the workspace switcher row (Notion style), and drop
   the indigo everywhere else? *Recommendation: yes. Indigo becomes one of the accent choices.*
4. **The floating AI button** (bottom right): keep it, restyled like Notion's AI button, and move
   ⌘K to quick find? *Recommendation: yes. The AI assistant gets its own shortcut (⌘J).*
5. **Ingest colors:** the AI ingest colors H2 headings by "importance" with strong fills. Remap them
   to Notion's muted block colors? *Recommendation: yes. The meaning stays and the look gets calmer.*
6. **Fixture data for real testing:** to run the parity test against a real database (not canned data),
   add `DATABASE_URL` (the Supabase pooler string) to this cloud environment's secrets.

## 6. Result (after the build)

**Decisions taken (§5):** the 2026 sidebar; Settings as a modal (URLs kept as deep
links); the logo and name only in the workspace switcher, indigo kept only as an
accent choice; ⌘K opens quick find and ⌘J the AI panel; the ingest colours mapped to
Notion's muted block palette. (`DATABASE_URL` is still not set in the cloud
environment, so the database screens were again checked against the fixture.)

| Phase | Commit | What changed |
|---|---|---|
| 1 Tokens | `df64f91` | `app/tokens.css` (measured light/dark tokens, accent presets, contrast, density); gray/slate → Notion's warm scale, indigo/violet/brand → the accent; system font; theme + preferences layer with no flash; Ctrl/⌘+Shift+L |
| 2 Kit | `abe8447` | `components/ui`: Button/IconButton, Input, Toggle, Checkbox, Select, Tag, Tabs, Tooltip, Modal, ConfirmDialog, PromptDialog, Settings rows, EmptyState/Skeleton, DatePicker; Notion toast |
| 3 Shell | `6a1bfd4` | Sidebar (warm, resizable, Ctrl+\\, workspace menu, pill nav, sections, 30px rows, floating New page); top bar + page ⋯ menu (fonts, Small text, Full width); quick find on ⌘K; Home |
| 4 Database | `6d4844a` | Header, pill tabs + "N more…", toolbar, table metrics, pills on the option palette, blank empty cells, long dates + date picker, OPEN chip, gutter, New page row, selection bar, grouped tables; board/gallery/list/calendar/timeline/chart; row peek; layout options moved into View settings |
| 5 Page | `d9d9c4f` | BlockNote theme on the tokens, Notion block metrics, calm callouts and heading colours, page font/Small text in the editor |
| 6 Settings | `269d585` | The Settings modal with grouped left nav and search; My account; **Preferences** (the customization layer, every option wired) |
| 7 Finish | this commit | Remaining screens (login/signup, workspace, AI panel) on the tokens; all off-palette and hard-coded colours removed; native controls drawn in the kit style; empty-database placeholder rows; parity check; after/compare images |

**Verification**
- **Tests:** the full Vitest suite passes (1,275 tests; new tests for the kit). Tests
  whose expectations described the old look were updated to the Notion behaviour.
- **Parity:** `scripts/parity.mjs` reads computed styles from the running app in light
  and dark and compares them with the measured Notion values —
  [`parity-report.md`](parity-report.md): **62 of 62 checks pass**.
- **Design guard** (`frontend/lib/design/designGuard.test.ts`): off-palette colours
  **549 → 0**, hard-coded colours **9 → 0**, native dialogs **1 → 0**.
- **Screens:** `after/` holds every screen re-captured in light and dark;
  `compare-after/` shows **Notion | before | after** side by side.

**Known deviations and follow-ups (honest list)**
1. **Native dropdowns and checkboxes:** 75 `<select>` and 22 checkboxes remain inside
   the larger editors (automations, button actions, chart and filter builders, routing
   rules…). They are drawn in the kit's style by a global rule, so they look the same,
   but their open menus are still the browser's. The guard stops the count growing;
   converting them to `components/ui/Select` is the next step (their tests drive the
   native control today).
2. **Calendar "+N more":** cells still cap at three events with "+N more"; Notion grows
   the cell instead.
3. **Quick find preview pane** is not built (the dialog is 755px instead of 1006px).
4. **Board/Gallery card size and Timeline's table panel** keep this app's own options.
5. **Per-page font / Small text / Full width** are stored per browser, not per page in
   the database.
