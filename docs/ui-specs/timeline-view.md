# Timeline view — its own dedicated per-view work

> Ground truth: live capture, 2026-09-02/03 (`app.notion.com`, a fresh `Timeline` view
> added to the fixture database) — screenshots taken inline during the session (matching
> this M12 sub-phase's own convention since Form/Chart/Dashboard/Board/Calendar) plus a
> direct drag test of a real multi-day event (dragged its body, read its own resulting
> Date value back from the row peek to confirm the exact shift).
> Implements: M12 (Timeline's own dedicated work, the last of the nine views)
> Binds to: `TimelineView.tsx`'s `TimelineBar` (bar geometry, resize, and the new
> whole-bar-move interaction)

## Scope, per the plan's own words

`docs/plans/2026-08-28-notion-databases-ui-parity.md`'s M12 task breakdown named five
things for Timeline: "zoom-level refinement beyond what exists, dependency arrows,
drag-to-reschedule, the table/timeline split view, row peek/hidden_properties wiring."
Timeline's underlying feature set (`frontend/components/database/views/TimelineView.tsx`)
is unusually mature going into this session — built whole under **task-34** (Milestone 9,
pre-dates this UI-parity plan), including 8 zoom levels, bar geometry, edge-resize,
dependency arrows, and the server-side shift cascade. Per this session's own instructions,
each of the plan's five items was checked against the actual code and a fresh capture
before assuming it was still real, undone scope — matching Calendar's own session finding
3 of 4 named items already done, and Board's finding 2 of 3.

## Already done before this session — confirmed by reading the code, then by capture

- **Zoom levels.** All 8 (`hours|day|week|bi_week|month|quarter|year|5_years`) already
  built with strictly-decreasing pixels-per-day, task-34-original. Live capture: real
  Notion's own zoom dropdown lists the identical 8 labels, in the identical order
  (Hours/Day/Week/Bi-week/Month/Quarter/Year/5 Years) — an exact match, confirmed rather
  than assumed.
- **Bar geometry / multi-day bars.** `computeBarGeometry` already renders a ranged event
  as one bar positioned along the zoomed axis; a `null` end already renders as a point
  marker. Live capture of the same 3-day event (Sep 2–4) used for Calendar's own session
  confirmed an identical continuous pill-shaped bar with the title inline.
- **Dependency arrows.** `computeArrowEndpoints`/the SVG overlay/the `arrows_by` boolean
  toggle (disabled-with-a-reason when no dependency pair exists) were all already built
  and already unit-tested against the real backend shift-cascade contract
  (task-34-report.md's own explicit confirmation). Not re-verified live this session — the
  fixture database has no dependency relation configured, and setting one up (a new
  relation property pair plus "Turn on dependencies") would be its own separate capture
  effort disproportionate to re-confirming an already-tested, already-correct feature.
- **Event peek.** `useRowPeek`/`RowPeek` were already wired (M12 cross-cutting pass).
  Live capture: clicking a real Notion bar opens a **side** peek (`&pm=s`) — Timeline's
  own distinct default from Calendar/Gallery/Feed's Center default, matching what the
  Layout panel's own "Open pages in: Side peek" already showed and what
  `TimelineView.tsx` already passed through (`peekMode === "center" ? "center" : "side"`,
  defaulting side). No change needed.
- **Bar resize (edge-drag).** `resolveBarResize` already shifts one edge, clamping to a
  1-day minimum range — task-34-original, already unit-tested including the
  dependency-shift-propagation test (`resizing one bar... moves a second dependent row's
  bar too`). Live capture: hovering a bar's edge reveals a small drag handle circle,
  confirming the interaction exists in real Notion too — not re-verified pixel-for-pixel
  (this session's own capture budget went to the genuinely new finding below instead).

## What this session found and built — a real, capture-confirmed gap

### Whole-bar drag-to-move ("drag-to-reschedule"), distinct from edge-resize

`TimelineBar`'s pre-session code wired mouse handlers **only** on the two edge-resize
handles — dragging the bar's own body did nothing at all, and clicking it (without an
`OpenNoteButton` in the track itself, only in the title column) did nothing either.
Live-captured this session, directly: dragging a real Notion bar's **body** (not an edge)
moves the whole event — both `start` and `end` shift by the identical delta, the range's
length unchanged. Confirmed concretely: a Sep 2–4 event dragged one column right became
Sep 3–5 (read back from its own row peek, not inferred from the drag distance). This is
the plan's own "drag-to-reschedule" item, genuinely separate from resize (which
task-34-brief.md's own words already called "the load-bearing interaction" — but only
ever specified the edge-drag case, never a whole-bar move, since the original task-34
build never captured Timeline against live Notion at all).

Also live-captured: a **stationary click** (no drag) on the bar body opens the side peek
— the same "whole bar/card is the open-trigger" pattern this M12 phase already found for
List and Calendar's own bars.

**Built:** `resolveBarMove(value, deltaPx, zoom)`, mirroring `resolveBarResize`'s own
shape and Calendar's own `resolveDropDate` (shift every edge that exists by the identical
delta — here `end` only when non-null, supporting a point marker too). `TimelineBar`
gained a single `onMouseDown` on its own outer div (the resize handles' own handlers
already `stopPropagation()`, so they're unaffected) that tracks movement against a 5px
threshold — the same distance-threshold convention dnd-kit's `activationConstraint` uses
elsewhere in this codebase, hand-rolled here since `TimelineBar` already uses plain mouse
events, not dnd-kit. Below the threshold: open the peek (`onOpenRow`, works read-only
too, matching row-affordances' own "click always opens, drag needs `editable`" split).
At/above it: commit `resolveBarMove` through `onCellChange`, gated on `editable`, same as
resize. Cursor affordance added (`cursor-grab`/`active:cursor-grabbing` when editable,
`cursor-pointer` read-only) — absent before this session.

## `hidden_properties`/`property_order` — deliberately NOT wired, and why

Same finding and same reasoning as Calendar's own session: Timeline's title column shows
**only the title**, in both real Notion (confirmed live) and this app's build — never any
other property. `RowPeek.tsx` does not consult `hidden_properties`/`property_order`
either (M10's own established always-alphabetical behavior). Wiring either into
`TimelineView.tsx` today would be dead code with no rendering path that ever reads it.
Left unbuilt and disclosed here rather than shipped as an inert pass-through.

## The table/timeline split view — real, confirmed live, deliberately still out of scope

`task-34-brief.md`'s own original ruling explicitly cut this: "no table panel
(`show_table`/`table_properties`)... not in the plan's test-case list." This session's own
live capture reconfirms it's a real, working feature in Notion — a "Show table" toggle in
the Layout panel opens a collapsible mini-table (a `Name` column by default, presumably
configurable via `table_properties`) pinned to the left of the Gantt track, listing every
row **including ones with no date** (which get a "jump to it" arrow instead of a bar).
This is genuinely a second, secondary table-shaped view living inside Timeline — closer in
size to a scoped-down `TableView.tsx` than a per-view polish item, and building it
properly would need its own capture pass (which properties show, how `table_properties`
config works, its own column/row interactions). Consistent with the original task-34
ruling and this session's own scope, it stays unbuilt, reconfirmed rather than silently
dropped.

**Also reconfirmed, also already ruled out (task-34-brief.md's own words): the
off-screen "jump to project" arrow.** With `Show table` on, a row plotted outside the
visible date window renders as a "←"/"→" arrow in the table panel instead of nothing.
Real and present in Notion; task-34-brief.md's own scope cut ("skip the overflow-arrows
jump-to-project interaction") already excluded it, reconfirmed by this session's capture,
not rebuilt.

## What changed in code

- `TimelineView.tsx`: new exported `resolveBarMove` (pure, mirrors `resolveBarResize`'s
  shape); `TimelineBar` gained `onOpenRow`, a body-level `onMouseDown` (click-vs-drag via
  a 5px movement threshold), and cursor styling. `onOpenRow={openRow}` threaded through
  from the existing `useRowPeek` destructure at the call site.

## Live verification

**Real Notion: complete for the new finding.** The whole-bar-move interaction was
directly captured and its resulting date value read back from the row's own peek to
confirm the exact shift (not inferred from pixel distance). Zoom levels, bar geometry,
event peek's Side default, and the table-split/off-screen-arrow features were all
independently reconfirmed live this session as well.

**Against this app's own running build: not completed, disclosed rather than forced.**
`./app.sh`'s stack was already running (reused from Calendar's own session). After the
code change, the automation session's browser extension disconnected entirely partway
through this session (`tabs_context_mcp` returned "Browser extension is not connected")
— a further failure mode in the same general instability class this workstream has hit
repeatedly (Board's, List's, and this file's own Calendar session all hit
`Page.captureScreenshot` timeouts from memory exhaustion; this was the extension
connection itself going down, not just a slow renderer). A Chrome restart is the known
fix for that class of failure (per the List session's own precedent), but restarting
closes the user's open tabs — not done unilaterally without asking, and no live-verify
session was requested this time.

**Unit tests are the substitute**, same acceptable-fallback class as Board's and
Calendar's own write-ups: `TimelineView.test.tsx` grew from 38 to 47 (new
`resolveBarMove` pure-function tests mirroring `resolveBarResize`'s own fixtures, plus
three component tests: dragging the bar body moves it, a stationary click opens the peek
instead, and a read-only bar still opens the peek on click but never moves on drag) — all
passing, every pre-existing test (all 8 zoom levels, resize, dependency arrows and their
date-mismatch warning, the real shift-propagation test) still green after the change.
Frontend suite: 61 files / 975 tests green (was 966 after Calendar's own session), `npx
tsc --noEmit` clean.
