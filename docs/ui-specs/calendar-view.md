# Calendar view — its own dedicated per-view work

> Ground truth: live capture, 2026-09-02 (`app.notion.com`, a fresh `Calendar` view added
> to the fixture database) — screenshots taken inline during the session (not saved as
> numbered files under `screenshots/`, matching this M12 sub-phase's own convention since
> Form/Chart/Dashboard/Board) plus a direct right-click/hover/click walk of a real
> multi-day event.
> Implements: M12 (Calendar's own dedicated work)
> Binds to: `CalendarView.tsx`'s date-grid math (`buildMonthGrid`/`buildWeekGrid`/
> `weekStartOf`) and `CalendarEventBar`'s trigger wiring; `RowMenuTrigger.tsx`'s new
> `open`/`onOpenChange` controlled mode

## Scope, per the plan's own words

`docs/plans/2026-08-28-notion-databases-ui-parity.md`'s M12 task breakdown named four
things for Calendar: "date-range bars (multi-day events), drag-to-reschedule refinement
beyond the single-day drop `CalendarView.tsx` already has, event peek, row peek/hidden_
properties wiring." Per this session's own instructions, each was checked against the
actual code before assuming it was still real, undone scope.

## Already done before this session — confirmed by reading the code, then by capture

Three of the plan's four named items turned out to already be built, matching Board's
own session finding the identical pattern (2 of 3 named items already done):

- **Date-range bars (multi-day events).** `layoutWeekRow`/`CalendarEventBar` already
  rendered a multi-day event as ONE bar spanning `colSpan` grid columns (a
  `grid-column: N / span M` inline style), not one bar per day — built at M9's original
  construction (task-33-brief.md), not new. Live-captured against a real 3-day event
  (Sep 2–4): real Notion renders the identical shape, a single continuous bar with the
  title on the left, no per-day repeats or breaks.
- **Drag-to-reschedule beyond the single-day drop.** `resolveDropDate` already shifts
  `date.end` by the SAME delta as `date.start` on drop, preserving a ranged event's
  length — also M9-original, already unit-tested (`CalendarView.test.tsx`'s own
  `resolveDropDate` describe block, "shifts a ranged event's end by the identical
  delta"). Not re-verified live this session (dragging reliably under this machine's own
  environment instability — see "Live verification" below — was not attempted a second
  time once the pure-function tests were confirmed still accurate); no code change.
- **Event peek.** `useRowPeek`/`RowPeek` were already wired into `CalendarView.tsx` in
  the M12 cross-cutting row-peek pass (2026-09-02, this file's own earlier PROGRESS.md
  log entry — "Board and Gallery... Calendar and Timeline (clicked OPEN on the Sep 2
  event bar)... All six views write the identical `&p=<rowId>&pm=s` URL"). Live-captured
  this session: clicking a real Notion event bar opens a **center** peek
  (`&pm=c`) showing the full property list — matching `config`'s own "Open pages in:
  Center peek" default, already set for Calendar in the M12 "Open pages in defaults"
  session. No further work needed; `CalendarView.tsx` already passes `peekMode ===
  "center" ? "center" : "side"` through to `RowPeek`.

## What this session found and built — real, capture-confirmed gaps

### 1. Week-start-day bug (Monday-first vs. real Notion's Sunday-first)

`CalendarView.tsx`'s original build (M9/task-33) assumed Monday-first weeks, "matching
`services/db/query/grouping.py`'s own `1=Monday` default" — but that convention belongs
to the grouping engine's own week-BUCKETING feature (an unrelated surface used
elsewhere), never actually captured against Calendar's own grid. Live-captured this
session: a real Notion Calendar's header row reads **Sun / Mon / Tue / Wed / Thu / Fri /
Sat** — independently confirmed by the highlighted "today" cell landing under "Wed" on
2026-09-02, a real Wednesday (verified by direct date-math, not assumed).

Fixed: `mondayOf` → `weekStartOf` (Sunday-anchored), plus a real correctness bug this
surfaced — `buildWeekDays`'s "hide weekends" branch previously took the first 5 days
from the week's own start; under a Sunday anchor that would keep Sunday and drop Friday,
so it now offsets `+1..+5` (Monday..Friday) instead of `+0..+4`. `buildMonthGrid`/
`buildWeekGrid`/`formatRangeLabel` all follow the same anchor. Every date-literal test
fixture tied to a week boundary was recomputed and rewritten (`CalendarView.test.tsx`),
not just the helper functions — `layoutWeekRow`'s own pure-function tests needed no
changes (they exercise column math against an arbitrary date array, indifferent to which
weekday convention produced it).

### 2. No weekday header row existed at all

Confirmed by reading `CalendarView.tsx`'s full render tree before this session: no
Sun–Sat label row anywhere. Real Notion always shows one. Added: a fixed header row
above the grid, `WEEKDAY_LABELS` sliced to Mon–Fri when `show_weekends` is off (matching
the same offset fix above).

### 3. The event bar's permanent icon and its only-icon-opens-it interaction

Real-Notion capture: hovering an event bar reveals **nothing** — no icon of any kind,
unlike Board/Gallery's cards. The whole bar is the open-trigger (same class as List's
own "no separate OPEN button" finding); clicking anywhere on it opens the peek. Before
this session, `CalendarEventBar` rendered an always-visible `OpenNoteButton` icon (never
hover-gated) as the ONLY click target — clicking the title text itself did nothing.

Fixed: `OpenNoteButton` removed; the bar's own outer `<div>` (already the dnd-kit
draggable target) now carries `onClick={() => onOpenRow?.(row.id)}`. The title also
switched from the shared `renderCellValue` dispatcher to plain text — real Notion's bar
never went into inline-edit on click (confirmed live: clicking always opened the peek,
never a text cursor), matching `ListView.tsx`'s own established reasoning that a row's
title button opens the peek and editing has its own separate affordance elsewhere (here:
inside the peek itself, there is no Calendar-specific inline editor for this).

### 4. No row-menu access existed on Calendar at all

With no hover icon and no per-column header (a table-grid-only concept), Calendar had
**zero** way to reach Favorite / Copy link / Move to Trash before this session. Live
capture: right-clicking anywhere on a real event bar opens the SAME row menu every other
view already has — `RowMenu.tsx`'s own header comment already documented this as the
general rule ("right-click anywhere on the row opens the SAME menu"), but no view had
actually wired a row-level `onContextMenu` handler yet (only `ColumnHeader.tsx`, for
column menus, had). Calendar is the first to need it, since it is the only view with no
other entry point at all.

Built: `RowMenuTrigger.tsx` gained an optional externally-controlled `open`/
`onOpenChange` pair. When given, `trigger` renders as plain content (not a click-to-open
Popover trigger — the SAME click already means "open the peek" on Calendar's bar) and
Popover's own trigger becomes an invisible, `pointer-events-none`, `absolute inset-0`
anchor used purely for positioning. `CalendarEventBar` owns the state and attaches
`onContextMenu` (`e.preventDefault(); setMenuOpen(true)`) to its own outer div, so
right-clicking anywhere on the bar opens the identical menu content (Favorite/Edit
icon/Edit property/Open in/Comment/Copy link/Duplicate/Move to Trash) every other view's
`RowMenuTrigger` already renders — reused, not a second copy. Every other caller
(`RowGutter.tsx`) is unaffected: omitting `open` keeps the pre-existing internal-state,
click-to-open behavior exactly as before.

### 5. Today's highlight

Live capture: today's date number carries a filled red circle. Absent before this
session. Added to `CalendarDayCell` (`isToday` prop, compared against a `todayKey`
computed once per render in `CalendarView`).

## `hidden_properties`/`property_order` — deliberately NOT wired, and why

The plan's own words bundled this with "row peek." Row peek's own wiring is done (see
above). The Property visibility panel DOES exist in Calendar's view-settings sidebar in
real Notion (confirmed: a "Property visibility" row with a count badge, in the same root
list every other view's sidebar shares — Layout / Property visibility / Filter / Sort /
Conditional color). But **its actual effect could not be captured** — the automation
session repeatedly failed to hold the sub-panel open long enough to read its rows (this
machine's own recurring memory exhaustion; see "Live verification" below) — and, more
importantly, there is nowhere in Calendar's own rendering that `hidden_properties` COULD
affect even if it were wired:

- The event bar shows **only the title**, in both real Notion and this app's build,
  confirmed identical by direct capture — never any other property.
- `RowPeek.tsx` does not consult `hidden_properties`/`property_order` at all (M10's own
  established, deliberate behavior: `otherProperties` always shows every property,
  alphabetically — "a scan surface, not a reorder surface").

Wiring `config.hidden_properties`/`property_order` into `CalendarView.tsx` today would
be dead code — read, but with no rendering path that ever consults it. Left unbuilt and
disclosed here, rather than shipped as an inert pass-through pretending to be a real
feature (this workstream's own standing rule against half-finished, unverifiable wiring).
If a future capture finds a real effect (e.g. an agenda/day view this session's Month/
Week-only capture didn't reach), `viewConfig.ts`'s existing `getHiddenKeys`/
`orderProperties` helpers are the ones to reuse — same as every other view already does.

## What changed in code

- `CalendarView.tsx`: `mondayOf` → `weekStartOf` (Sunday-first); `buildWeekDays`'s
  weekend-hidden offset fix; new `WEEKDAY_LABELS` + header row; `CalendarDayCell` gained
  `isToday`; `CalendarEventBar` rewritten (no `OpenNoteButton`, plain-text title,
  whole-bar `onClick`/`onContextMenu`, `RowMenuTrigger` in controlled mode);
  `CalendarWeekRow`/`CalendarView` thread `todayKey`/`onTrashed` instead of
  `onCellChange`/`peekRowId` (no longer needed by the bar itself).
- `RowMenuTrigger.tsx`: new optional `open`/`onOpenChange` controlled-mode props,
  additive — every existing caller (`RowGutter.tsx`, used by Table/List) is unchanged.

## Live verification

**Real Notion: complete.** Every finding above (Sunday-first header, the continuous
multi-day bar, click-opens-center-peek, no hover icon, right-click's full row menu,
today's red-circle highlight) was captured directly against `app.notion.com` — screenshots
taken inline, plus one independent date-math cross-check (2026-09-02 landing under "Wed").

**Against this app's own running build: not completed, disclosed rather than forced.**
`./app.sh`'s stack was already running; a fresh database with a Date property and a row
was created via the browser to test against. The automation session then hit this
machine's own recurring memory exhaustion repeatedly (`free -h`: 298–337Mi free,
3.3–3.7Gi/3.7Gi swap, across three separate checks) — `Page.captureScreenshot` timed out
five times across two fresh tabs, the same failure class `board-view.md`'s own session
and List's own M12 session already hit and disclosed rather than forcing through. Per
this session's own instructions (retry once, try one fresh tab, then disclose), two
fresh tabs were tried; a third was not, given the identical failure repeating each time.

**Unit tests are the substitute**, same acceptable-fallback class as Board's own
write-up: `CalendarView.test.tsx` grew from 42 to 44 (`weekStartOf`-adjusted grid
fixtures; new right-click-opens-row-menu, weekday-header, and today-highlight tests),
all passing, plus every pre-existing interaction test (drag resolution, `+` on empty
days, view-range/weekends toggles) still green after the rewrite. Frontend suite: 61
files / 966 tests green (was 963 after Board's own session), `npx tsc --noEmit` clean.
