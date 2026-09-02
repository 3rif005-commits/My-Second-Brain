# Dashboard view — the widget grid

> Ground truth: **partial** live capture, 2026-09-02 (`app.notion.com`) — real Notion's
> whole widget-grid EDITING surface is gated behind the Business plan on this workspace
> (confirmed live, not assumed: creating the view succeeds, but the page renders
> "Dashboards require the Business plan to add widgets or edit the dashboard layout,"
> no grid, only an "Upgrade now" button). The user was asked directly (`AskUserQuestion`)
> how to proceed given this real capture gap; chose a best-effort rebuild using this
> app's own established primitives + `task-45-brief.md`/`research`'s own documented
> interaction facts, over skipping the milestone or paying for a real capture. Every
> claim below is tagged **(captured)**, **(documented)**, or **(inferred)** — see
> "What could and couldn't be captured" below before trusting any specific detail.
> Implements: M12 (Dashboard's own dedicated work)
> Binds to: `DashboardView.tsx`'s `config.rows[]` (unchanged shape —
> `{ id, height, widgets: [{ id, view_id, width }] }`, `task-45-brief.md`)

## What could and couldn't be captured

**(captured)** Creating a Dashboard view (the M7 create-flow card grid → Dashboard)
works normally, same as every other type. Once created:
- The page body shows only three static info cards ("Ask Notion AI to build your
  dashboard," "Add charts, tables, lists to your dashboard," "Learn about filters across
  multiple data sources") and an "Upgrade now" button — no widget grid renders at all
  on this plan.
- The toolbar shows **exactly one icon** — Settings (sliders) — no Filter, Sort,
  Automations, AI Autofill, or Search. Even more reduced than Form's own 3-icon set
  (`form-view.md`).
- The Settings popover (free tier) is the same shape every other view's own settings
  popover already has: a "View name" field, "Layout" (the same type-grid this app's own
  `ViewLayoutPanel.tsx` already builds, Dashboard shown as the locked/current type),
  a **"Show icons in heading"** toggle (not seen on any other view type's settings —
  purpose not determinable without a real widget to test it against; not built this
  session, disclosed rather than guessed), "Copy link to view," "Manage data sources,"
  "Lock database."

**(documented)** `docs/research/notion-databases-research.md` §13, sourced from
Notion's own public help docs (notion.com/help/dashboards), predates this session and
already recorded "Availability: Business and Enterprise plans only" — this app's own
build (task-45, well before this UI-parity plan existed) already knew about the paywall
and deliberately chose NOT to gate the feature the same way, so a plan restriction was
never going to block our OWN app regardless. The same section documents (not captured
live, but from Notion's own written material, not training recall):
- `+` on a row or at the bottom to add a widget: choose an **existing** view or **create
  a new one** for the dashboard.
- Right-click a widget (or click its title) for its actions menu: **Duplicate** ("a copy
  with the same view settings and layout"), **Delete**.
- Resize: **drag** between two widgets (width) or between two rows (height) — no numeric
  stepper in real Notion.
- Two modes, View and Edit, matching this app's own pre-existing toggle.

**(inferred)** Everything about the widget grid's own pixel-level chrome not named
above — exact spacing, hover states, the row/widget border treatment, drag-handle
affordances — none of it could be checked. This session did NOT attempt to invent that
level of detail; see "What changed" below for the deliberately narrow scope this
session actually touched.

## What changed this session

This app's `DashboardView.tsx` (task-45, pre-dates this UI-parity plan) was already a
complete, functional widget grid — CSS Grid, 12 columns, add/remove/resize rows and
widgets, all PATCHing `config` correctly. The gap was the same class M12 already found
in Form: plain-HTML chrome (a native `<select>`, a bare `×` button) where this app has
an established, proven alternative. Given the capture gap above, this session changed
only the two pieces that could be swapped for ALREADY-VERIFIED primitives without
guessing at Notion's own exact shape:

1. **"Add widget"** — was a native `<select>` + a separate "+ Add" button (two-step:
   pick, then click). Now the same Popover+MenuList picker `FormView.tsx`'s own
   "+ Add question" already established: one click opens it, each row shows an icon +
   the view's name + its type as a caption (reusing `ViewTabs.tsx`'s own
   `ADD_VIEW_TYPES` icon set, exported for this purpose rather than a third copy),
   selecting a row adds the widget immediately — matching the **(documented)** real
   Notion "+" behavior above (existing-view choice), not a two-step form.
   **Not built:** "create a new view for this dashboard" from inside the picker —
   real, documented, deliberately deferred, same disclosed-scope-down class as
   `form-view.md`'s own "New question" section.
2. **The widget header's `×` remove button** — now a `MoreHorizontal` "···" trigger
   opening a MenuList with **Duplicate** (disabled, reason: "Would duplicate the
   underlying view, not built" — real, **(documented)** above, not invented) and
   **Remove** (unchanged behavior, still routes through the same `ConfirmDialog`).

**Deliberately UNCHANGED, and why:**
- **Resize stays a numeric stepper**, not drag. `task-45-brief.md` already made this
  call explicitly ("a full drag-resize interaction is nice-to-have but a numeric input
  is an acceptable, simpler substitute... document which you built") before this
  session existed, and building a NEW drag interaction with zero ability to verify its
  shape against a real capture would be inventing UI, not matching one. Left as-is.
- **The View/Edit mode toggle, the grid mechanic itself, row add/remove.** All already
  match the **(documented)** two-mode facts; no capture contradicted them.
- **`ViewSettingsSidebar`'s own Filter/Sort/Group rows** still render for a Dashboard
  view (unchanged) — real Notion's FREE-tier Settings popover doesn't show them either
  (confirmed **(captured)**, see above), but gating the shared sidebar per view type is
  a bigger, cross-cutting change or than this session's own scope; flagged, not built.

### `ViewToolbar.tsx` — a second, smaller finding

Separately from the widget-grid gap, the FREE-tier toolbar capture above was concrete
and easy to verify: exactly one icon (Settings). This app's shared `ViewToolbar.tsx`
rendered the full six-icon set for every view type before this session, Dashboard
included. Fixed: `view.type === "dashboard"` now hides Filter/Sort/Search AND
Automations/AI Autofill (Form's own branch keeps those two) — a dashboard has no rows
of its own for any of the six to act on.

## Trigger

Selecting a "Dashboard"-type view tab. No hover state.

## Rows — the page body

| # | Element | State |
|---|---|---|
| 1 | `{n}/12 widgets` counter | always |
| 2 | View / Edit toggle | always, Edit disabled when `!editable` |
| 3 | One block per `config.rows[]` entry | Edit mode adds a row-height stepper + "Remove row" above each |
| 4 | Each row: up to 4 widget cells (12-col CSS Grid, `span {width}`) + (Edit mode) an "+ Add widget" trigger sized to the row's remaining columns | |
| 5 | Each widget cell (Edit mode): a header bar — view name, a width stepper (1-12), a "···" menu (Duplicate disabled / Remove) — then the mounted view component itself | View mode shows only the mounted component, no header bar |
| 6 | "+ Add row" | Edit mode only |

## Widget content dispatch

Unchanged from pre-M12: `DashboardWidgetContent` mounts the referenced view's own
existing component (`TableView`/`BoardView`/`GalleryView`/etc.) via its own
independent per-widget query (`useWidgetQuery`) — every M1-M11 affordance that
component normally has (cell editing, row peek, etc.) works identically inside a
widget. `chart` renders read-only (`editable={false}`); `form` and a dangling
`view_id` both render a clear placeholder, never a crash.

## Add-widget picker

Popover+MenuList, one row per candidate view (same-data-source, non-dashboard,
non-form, not already-referenced — server-enforced, client pre-checked). Row full
(4/4) or dashboard full (12/12) replaces the trigger with an inline amber message,
matching the pre-existing (unchanged) behavior.

## Widget actions menu

| Row | State |
|---|---|
| Duplicate | disabled, reason: "Would duplicate the underlying view, not built" |
| Remove | real, opens the same `ConfirmDialog` this app uses everywhere else |

## Keyboard

Not captured — TBD.

## States

Empty dashboard (no rows): "No widgets yet." (View mode) / "No rows yet — add one
below." (Edit mode) — unchanged, pre-existing. Loading/error per-widget: unchanged,
pre-existing (`useWidgetQuery`'s own "Loading…"/error text).

## Persistence

Unchanged: every structural change (add/remove row or widget) PATCHes `config`
immediately; row-height and widget-width numeric inputs debounce at 600ms
(`task-45-brief.md`'s own combined-review fix, pre-dates this session).

## Checklist

Live-verified against this app's own build (`localhost:3000`, a scratch database):
created a Dashboard view via the M7 create-flow, confirmed the toolbar shows only
Settings, entered Edit mode, added a row, opened the new "Add widget" picker (icon +
name + type caption, Form correctly excluded), added a Table widget and confirmed it
rendered real row data, opened the widget's new "···" menu (Duplicate greyed out,
Remove red), opened the Remove confirmation dialog (cancelled, left the widget in
place), and confirmed View mode renders the same widget with no edit chrome.
Frontend 953 → 953 tests (no count change — existing `DashboardView.test.tsx`/
`ViewToolbar.test.tsx` updated in place for the new interaction shape, not added to),
`tsc` clean.

## Deferred, ranked

1. **A real capture of the widget-grid's own exact chrome** — blocked by the
   Business-plan paywall; everything above the "What changed" line is
   **(inferred)**/**(documented)**, not **(captured)**, until re-verified against an
   actual widget grid.
2. **Drag-resize** (width between widgets, height between rows) — real, documented,
   deliberately kept as the pre-existing numeric-stepper substitute rather than
   inventing an unverified drag interaction.
3. **"Create a new view" from the Add-widget picker** — real, documented, this app's
   picker covers existing views only.
4. **"Show icons in heading"** — a real toggle seen in the free-tier Settings capture,
   purpose undetermined (no widget to test it against), not built.
5. **Per-view-type gating of `ViewSettingsSidebar`'s Filter/Sort/Group rows for
   Dashboard** — the toolbar's own six-icon set is now correctly reduced; the docked
   sidebar's own equivalent rows still render unconditionally. Flagged, not fixed this
   session (a bigger, cross-cutting change).
