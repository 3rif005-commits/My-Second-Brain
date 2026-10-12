# Prompt for a LOCAL Claude Code session (with Claude in Chrome)

Copy everything below the line into a new **local** Claude Code session, opened on
your clone of `My-Second-Brain`, with the **Claude in Chrome** extension connected and
Chrome logged into your Notion account.

---

## Your task: build a complete, measured Notion UI reference

I'm redesigning my app (**My Second Brain**, a Notion-like app: Next.js 16 + Tailwind +
BlockNote, in this repo under `frontend/`) so that it looks and feels exactly like
Notion. A later session, running in the cloud **without a browser that can log into
Notion**, will do the redesign. It will only have what you write into this repo, so your
output has to be detailed and precise enough to rebuild Notion's UI from it without
ever seeing Notion.

Use **Claude in Chrome** (my real Chrome, already logged into Notion). Go as deep as you
need. Thoroughness matters more than speed. Measure things instead of eyeballing them.

### Ground rules
- **Do not change or delete any of my existing Notion content.** Everything you create
  goes inside one new page called **"UI Reference (Claude)"**, in my private section.
- **Settings are read-only.** Open every settings tab and look, but don't change
  anything. There is one exception: you may switch **Appearance** between Light and Dark
  to capture both themes. Set it back to what it was at the end.
- **Never click** upgrade, billing, purchase, invite, delete-workspace, or
  log-out actions.
- **Privacy:** capture only the reference page and the settings UI. Before you commit
  anything, check every image and text file for my email, my name, other people's names,
  or my real page titles. Crop or blur them, or replace them with placeholders.
- Work at a desktop viewport of **1440×900** at 100% zoom. Notion's left sidebar should be
  expanded unless a step says otherwise.

### How to run this: split the work across models
Start this session on **Opus** (`/model opus`). You are the **orchestrator**. Do the
thinking yourself, and hand the long, mechanical browser work to cheaper subagents using
the Agent tool's `model` parameter.

| Role | Model | Does |
|---|---|---|
| Orchestrator (you) | **Opus** | Plans the batches, writes each subagent's brief, reviews every batch for gaps, and writes the final files (`tokens.json`, `surfaces/*.md`, `preferences.md`, `checklist.md`) |
| Builder | **Sonnet** | Step 1: builds the reference page and databases in Notion |
| Capturers | **Sonnet** | Step 2: one subagent per surface group. Screenshots, `getComputedStyle` measurements, states, and behavior notes |
| Checker | **Haiku** | Mechanical checks: the privacy scan (grep text for emails and names, list images to inspect), image file sizes, and that every file linked from the README exists |

Rules for this setup:
1. **Test first.** Before anything else, start one Sonnet subagent whose only job is to
   call a Claude in Chrome tool (for example, list the open tabs) and report back. If
   subagents **can't** reach the Chrome tools, stop using subagents for the browser.
   Instead, tell me to switch with `/model sonnet` for Steps 1–2 and back with
   `/model opus` for Step 3, and continue in this session.
2. **Run browser subagents one at a time, never in parallel.** They all drive the same
   Chrome window. Run them in the foreground (`run_in_background: false`).
3. **Use small batches.** Suggested groups: (a) the build in Step 1; (b) the app shell and
   search; (c) page and blocks; (d) table view; (e) table editing, property menus and
   panels; (f) board and gallery; (g) list, calendar, timeline and chart; (h) the row page,
   peek and view settings; (i) empty states, menus and overlays; (j) settings and
   preferences. Each group is captured in light, then dark. Switch the theme once
   between the light and dark passes, not once per surface.
4. **Raw notes go to files, not into your context.** Each capturer writes everything to
   `docs/notion-reference/_raw/<group>.md` (plus screenshots in `screenshots/`) and
   returns to you **only** a summary of 10 lines or fewer: what it covered, what it
   missed, and any problems. This keeps your context small and saves tokens.
5. **Give each capturer a full brief.** It starts with no context. Paste in the ground
   rules, its exact list of surfaces, the measurement method in Step 2, the output paths,
   and the instruction to return only the short summary.
6. **Review every batch.** After each batch, read its raw file. Compare it with the
   surface list and the checklist goals. If anything is missing (a state, a theme, a
   property type, a measurement), send the same subagent back with a precise follow-up
   (SendMessage to continue it) rather than starting a new one. Move on only when the
   group is complete.
7. **Opus writes the synthesis.** In Step 3, you write the final files yourself from the
   raw notes. Don't delegate the synthesis or the checklist. Then run the Haiku checker,
   fix what it reports, and do Step 4.

### Step 1: Build the reference page in Notion
Create the page **"UI Reference (Claude)"** with:
- **Page chrome:** a cover image, an emoji icon, and a short description line.
- **Rich content:** H1, H2 and H3 headings, paragraph, bulleted, numbered and to-do lists
  (some checked), a toggle (open and closed), a callout, a quote, a divider, a code block,
  an image, a simple table (not a database), a 2-column layout, an @mention of a page, a
  date mention, and inline styles (bold, italic, code, link, colored text, highlight).
- **A full-page database "Projects"** with 15 rows of realistic dummy data and these
  properties: Title, Text, Number (with currency format), Select, Multi-select, Status,
  Date (some ranges), Person, Checkbox, URL, Email, Files, Relation (to a second small
  database "Clients"), Rollup, Formula, Created time, Last edited time, Button, and ID.
  - Give select, multi-select and status options **many different colors** (use all 10
    Notion colors across them).
  - Leave a few cells empty so empty states show.
- **Views on "Projects":** Table (with a group-by and a filter and sort applied in a second
  table view), Board (grouped by Status), Gallery (with card previews from the cover image),
  List, Calendar, Timeline, and Chart if available.
- **An inline (linked) database** of "Projects" inside the reference page body.
- An **empty** third database "Empty DB", to capture empty states.

### Step 2: Capture every surface, in both themes
For each surface below, capture it in **Light** and **Dark**. For each capture:
1. **A screenshot.** Save it as
   `docs/notion-reference/screenshots/<surface>-<light|dark>.png`.
   Use JPG if PNG files are over ~600 KB. If your tools can't write image files to disk,
   say so up front. Then do two things: (a) write extra-detailed text descriptions instead,
   and (b) give me a short numbered list of the most important screens for me to capture
   by hand into that folder.
2. **Measurements** taken with JavaScript `getComputedStyle` on the real DOM (not
   guessed). Record, for every distinct element type:
   - font-family, font-size, font-weight, line-height, letter-spacing, color
   - background, border (width, style, color), border-radius, box-shadow
   - padding, margin, gap, width, height
   - transition (duration and easing)
3. **Interaction states:** hover, active/pressed, focus, selected, and disabled where
   relevant. Hover each element and measure again.
4. **Behavior notes:** what appears on hover (handles, buttons), keyboard shortcuts, how
   menus open (position, animation, duration), and what happens on click.

Surfaces to capture:

**App shell**
- **Sidebar:** workspace switcher, the Search, Home and Inbox rows, section headers
  (Favorites, Private, Teamspaces), a page row with nested children, and a page row on
  hover with the `⋯` and `+` buttons. Also capture the collapsed sidebar, the sidebar
  resize handle, and the "New page" button. Measure sidebar width, row height, indent
  per level, and the icon box size.
- **Top bar:** breadcrumbs, "Edited …", Share, Comments, Updates, star, and `⋯`, plus the
  `⋯` page menu open.
- **Search / quick find** dialog (⌘K / Ctrl+K), with and without a query.
- Toast or notification examples if you can trigger one safely.

**Page**
- **Cover and icon:** the cover on hover (Change cover, Reposition), icon sizes, and the
  title (size, weight, margin). Also the hover bar above the title ("Add icon / Add cover /
  Add comment").
- **Page width:** normal vs. full width (measure the content max-width), and
  Default / Serif / Mono fonts and small text, using the page's `⋯` menu (this is a
  page-level setting on my reference page, so changing it is allowed).
- **Every block type** from Step 1: spacing between blocks, the block handle (⋮⋮) and `+`
  on hover, the `/` slash menu, the text-selection formatting toolbar, and the color menu.

**Database (the main focus, be exhaustive)**
- **Header:** title, description, view tabs (active vs. inactive, overflow "+ N more"),
  and the toolbar (Filter, Sort, the automation lightning, Search, `⋯` view settings, and
  the blue **New** split button with its dropdown).
- **Table view:**
  - **Header cells:** each property-type icon, height, text color, and the resize handle.
  - **Rows:** row height, cell padding, grid line colors (horizontal and vertical), and the
    row hover background.
  - **Title cell:** the title cell on hover with the **OPEN** button, and the row drag
    handle and checkbox on hover.
  - **Selection:** a selected row and a multi-row selection with its action bar.
  - **Rendering of every property type** in a cell: Select/Status pill shape, radius,
    padding, font size, and **all 10 option colors (background and text, light and
    dark)**, plus person avatars, date, checkbox, number alignment, URL, files, relation,
    and formula.
  - **Editing:** the editing state for text, select (the option menu with search and
    "Create"), date (the date picker), person, and relation.
  - **Rows and calculations:** the "+ New page" row at the bottom and the calculation
    footer ("Calculate" on hover, then with a value).
  - **Property header menu**, the **"+" add property** type picker, and the **edit property**
    side panel.
  - **Grouped table** (group header, count, and collapse), and **filter and sort chips**
    under the toolbar.
- **Board:**
  - **Columns:** column header (colored pill and count), column width, and gap.
  - **Cards:** card padding, shadow, and radius, the card on hover, and the "+ New" at the
    bottom of each column. Also the hidden-groups column.
- **Gallery:** card sizes (small, medium, large), the preview image area, and properties
  under the title.
- **List, Calendar** (month grid, today marker, event chips), **Timeline** (bars, today
  line, table side panel), and **Chart**.
- **Row page / peek:**
  - **Display modes:** side peek, center peek, and full page.
  - **Properties block:** the label column width, the value column, and hover states.
  - **Controls:** "Add a property", "Hide N properties", comments, and the page body
    below.
- **View settings** panel (`⋯` on the view): every sub-page (Layout, Properties, Filter,
  Sort, Group, Automations, and so on).
- **Empty states:** an empty database, an empty board column, and a filter with no results.
- **Linked/inline database** inside a page (how it differs from full-page).

**Menus and overlays (general)**
- A typical dropdown menu: width, radius, shadow, row height, icon size, section headers,
  dividers, the keyboard-hint text on the right, and the toggle switch inside menus.
- Tooltip style, modal/dialog style, and the confirmation dialog (if you can trigger one
  without confirming anything destructive).
- The color picker, the emoji/icon picker, and the date picker.

**Settings window (read-only)**
- Open Settings and capture **every tab** in the left nav: My account, My settings or
  Preferences, Notifications, Connections, Language & region, General, People,
  Teamspaces, Security, Identity, Import, and any others present.
- For each tab: the layout of the left nav (groups, headers, active state), the page title
  and description, setting rows (label, help text, control on the right), dividers,
  section headers, button styles (primary, secondary, danger), inputs, toggles, dropdowns,
  and the modal size and position.
- Write a full list of **every user-customizable preference** Notion offers (appearance,
  start page, date format, first day of week, open links in the app, and so on). My app
  will offer a similar "customize your experience" settings page.

### Step 3: Write the output files
Put everything under `docs/notion-reference/`. Keep the capturers' `_raw/` notes too;
the cloud session can use the extra detail.

- **`README.md`**
  - an index of everything captured, with links to each screenshot
  - how the measurements were taken, and the date
  - a list of anything you could NOT capture, and why
- **`tokens.json`:** the design tokens, as **light** and **dark** objects:
  - text colors (primary, secondary, tertiary, placeholder), backgrounds (app, sidebar,
    hover, active, selected), borders and dividers
  - the accent blue
  - the 10 option colors (background and text, for tags/pills), plus the text-color and
    highlight colors
  - font stacks, the type scale (title, H1–H3, body, small, caption), and spacing
  - radii, shadows (menu, card, modal), z-order hints, and transition durations
- **`surfaces/<area>.md`:** one file each for shell, page, blocks, database-table,
  database-board, database-gallery, database-other-views, row-page, menus-overlays, and
  settings. Each file contains:
  - the screenshots, linked
  - a precise **anatomy** (element by element, with the measured values)
  - states (hover, active, focus, selected, disabled, empty, loading)
  - behavior and interaction notes, plus keyboard shortcuts
  - DOM notes where they help (structure, which element carries the style)
- **`preferences.md`:** every Notion user preference and setting, with its options and
  default values.
- **`checklist.md`:** a flat, numbered checklist of every visual detail a perfect Notion
  clone must match. Group it by area. Each item should be specific and verifiable
  ("Table row height is 33px", not "rows look right"). Aim for completeness. This will
  be used as the acceptance criteria for the redesign.

The repo already contains earlier Notion measurements in
`docs/superpowers/specs/2026-08-28-notion-databases-ui-parity-design.md` and the
`--menu-*` tokens at the top of `frontend/app/globals.css`. Read them first. Re-verify
them, note anything that differs, and reuse the same measuring method.

### Step 4: Commit and push
- Create a branch **`ui-audit/notion-reference`** from `origin/feat/ai-harness`.
- Commit **only** `docs/notion-reference/`. Do the privacy check from the ground rules
  first.
- Push with `git push -u origin ui-audit/notion-reference`.
- At the end, restore Notion's Appearance setting to what it was.

### When you're done
Reply with a short summary:
- what was captured
- how many screenshots and how many checklist items
- anything missing or uncertain
- the branch name

Leave the "UI Reference (Claude)" page in Notion. I may publish it to the web for
later comparison.
