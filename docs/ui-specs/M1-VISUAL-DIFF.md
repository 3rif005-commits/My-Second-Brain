# M1 — live run, for the visual diff

> **This is exit criterion 4.** Criteria 1–3 are met; nothing ships as done until
> you compare these against the Notion originals and say what is off.
>
> Run on 2026-08-31 against `localhost:3000`, light mode, 1300px viewport — the same
> width as the Notion captures, so the two sets are directly comparable.

| Step | Ours | Notion original |
|---|---|---|
| Menu open on a Text column | `actual/M1-02-header-menu-text.jpg` | `02-header-menu-text.jpg` |
| Change type flyout | `actual/M1-05-header-change-type-flyout.jpg` | `05-header-change-type-flyout.jpg` |
| Calculate, level 2 | `actual/M1-70-calculate-flyout-l2.jpg` | `70-calculate-flyout-l2.jpg` |
| Calculate → Count, level 3 | `actual/M1-71-calculate-count-flyout-l3.jpg` | `71-calculate-count-flyout-l3.jpg` |
| Persistence after reload | `actual/M1-72-calculation-persisted-after-reload.jpg` | — (ours only) |

## What the run confirmed

- **Row list matches the spec in order** — Change type, Filter, Sort, Group, Calculate,
  Freeze, Hide, Unwrap content, Insert left, Insert right, Duplicate property, Delete
  property.
- **Flyouts open to the right with the parent still visible**, not a push stack.
- **Level three flips LEFT** when it runs out of room, exactly as Notion's
  Calculate → Count does. This was the single riskiest behaviour in the Popover
  primitive and it works without special-casing.
- **Conversion legality is server-driven.** Change type enables exactly Number, Select,
  Multi-select, Status, URL, Email, Phone for a Text property and greys Date, Person,
  Checkbox, Formula, Relation, Rollup — matching `convertible_to`, not a client copy.
- **Rows for absent surfaces are disabled, not missing** — Filter, Freeze, and Group
  (Text is not groupable until Phase 0c).
- **A calculation survives a reload**: three-level menu → `view.config` → PATCH →
  reload → `Count all ✓` still set.
- **No console errors** at any point.

## The diff was run (2026-08-31) — five differences found, four fixed

I originally assigned this comparison to the user. That was over-delegation: the
plan's argument is that a CODE REVIEW cannot catch this defect class, which is true
and does not imply the images cannot be read side by side. Four of the five were
mechanical and are now fixed.

### Fixed

1. **Four rows had no icon at all** — Group, Unwrap content, Insert left, Insert
   right. Their labels therefore started where the icons should have been, giving the
   menu a **ragged left edge** while Notion's labels all align. This was the single
   most visible parity break and I had not spotted it in my first pass.
   Fixed at the primitive: `MenuList` now ALWAYS reserves the icon box, so no future
   surface can reintroduce it by omitting an icon.
2. **Change type used the wrong glyph** — `<>` (code brackets) where Notion uses
   circular convert arrows.
3. **Sort used a list glyph** where Notion uses up/down arrows.
4. **The rename field had a filled background at rest.** Notion's is flat and fills
   only on hover/focus, so it reads as the property's NAME rather than as a form
   input sitting in a menu.

### Still open

5. **`Show large counts as 99+` is missing** from the Count panel — a toggle with the
   description *"This improves performance for large databases."* We have no
   equivalent performance concern, so it was never built. **This is a product
   decision, not a mechanical fix, and is the one thing genuinely left for the user:**
   build a no-op-shaped equivalent, or record it as a deliberate omission.

### Deliberate, not defects

- **`AI Autofill` is absent** — out of scope. Its badge-and-chevron pattern is
  captured for reuse.
- **Divider placement follows from that**: Notion's first divider falls after AI
  Autofill, ours after Change type.
- **`Delete property` renders red.** Notion's fell below the fold in the capture, so
  its colour is UNVERIFIED — left as-is rather than matched to a guess.

## Original notes from before the fixes

1. **`Show large counts as 99+` is missing** from the Count panel. Notion has it as a
   toggle with the description *"This improves performance for large databases."*
   We have no equivalent performance concern, so it was not built. **Genuine gap** —
   decide whether to add a no-op-shaped equivalent or record it as a deliberate omission.
2. **The `Group` row has no icon** where Notion shows a grid glyph. Cosmetic, one line.
3. **`AI Autofill` is absent.** Deliberate — out of scope, and its badge/chevron pattern
   is already captured for reuse.
4. **Divider placement differs as a consequence.** Notion's first divider falls after
   AI Autofill; ours falls after Change type, since that section now holds one row.
   Worth deciding whether Change type belongs grouped with Filter/Sort instead.
5. **The rename field shows a filled background** (`--menu-field-bg`) at rest. Notion's
   looks flatter until focused. Check this one closely — it is the kind of small
   difference that reads as "not Notion" without being nameable.

## One unrelated thing the run surfaced

Adding a property through the **existing** inline form did not refresh the table — the
new column only appeared after a reload. That form is M2's code (`TableView.tsx:652-802`),
untouched by M1, so this is pre-existing rather than a regression. Worth fixing in M2,
where that form is replaced anyway.

## Not yet run

The **inline-database check** — opening this menu from a database embedded in a note, to
confirm Radix's portal does not trip BlockNote's `TableHandles` crash. It needs a note
with an inline database; `Popover` has a `container` prop ready if it reproduces.


---

# M2 / M2b — live run

Run 2026-08-31 against `localhost:3000`, same fixture.

| Step | Ours |
|---|---|
| Creation picker, 17 types | `actual/M2-10-new-property-type-picker.jpg` |
| A URL cell rendering as a link | `actual/M2b-url-cell-renders-a-link.jpg` |

## Confirmed

- The name field is in the **header cell**, the picker hangs below it, and the type
  list is a **two-column grid** — matching `10-new-property-type-picker.jpg`.
- All 17 types present, including M2b's six.
- A URL cell round-trips: typed `example.com`, saved, and rendered as a link whose
  href is `https://example.com/` with `target="_blank" rel="noreferrer"` — the scheme
  is added, so the browser does not treat it as a relative path.

## Found and fixed during the run

**Every type shared or fell back to the wrong icon.** Relation, Rollup and Button all
rendered the plain text glyph, and Select and Status shared one circle. A picker where
several rows carry the same or a fallback icon stops being scannable — the same defect
class as M1's missing row icons, one surface along. Each type now has a distinct glyph
(Select a chevron-circle, Status a dashed circle, Relation ↗, Rollup a magnifier,
Button a click, ID a fingerprint, the two timestamps a clock).

## Not compared

The M2 popover's own reference shot is Notion's `10-new-property-type-picker.jpg`,
which shows **26 types in a taller panel** with an `AI Autofill` section above the grid.
Ours shows 17 and no AI section — both deliberate and recorded, so this is not a
pixel-comparable pair.

---

# M2 completion — `Edit property` (2026-08-31)

Run by me, in Chrome, against the live app and the live Notion fixture side by
side. Four defects found, all four fixed in the same session. Two of them were
in files this milestone did not otherwise touch — which is the case for keeping
this step.

## Defects found and fixed

**1. The `Show as` ring rendered as a filled pie, not a ring.**
`conic-gradient` alone paints a disc; the hole has to be masked out. Present in
both the preview card and the cell. Fixed with a shared `ringStyle()` helper in
`numberFormat.ts` so the preview cannot promise a shape the column then renders
differently.

**2. The third-level flyout bounced back rightward, hiding the header menu.**
The chain went: header menu (right edge) -> options panel (flipped LEFT) ->
option editor (flipped RIGHT again, landing on top of the header menu). Notion's
chain keeps travelling in one direction and leaves all three panels visible.

Root cause: `MenuList` hardcoded `side="right"` for every flyout, so each level
re-decided independently. A panel now reads the side Radix actually placed it on
and passes that to its children.

The first fix for this did not work, and the reason matters: `data-side` was read
**once on mount**, and Radix stamps a provisional value before floating-ui
measures. The read caught the pre-flip value. It needs a `MutationObserver`, not
a one-shot read — a class of bug no unit test would have caught, since jsdom does
no positioning at all.

**3. `Colors` was a control with no visible effect.**
`SelectCell`, `MultiSelectCell` and `StatusCell` hashed the label to a fixed
palette and never looked at `config.options` — so setting an option to Red
changed nothing anywhere the user could see. Exactly the defect `Number format`
would have had if `NumberCell` had not been taught to format.

Fixed by matching the cell's value against the configured options **by name** and
using that option's colour. Deliberately NOT by rebuilding these cells as option
pickers: they are free-text today, that is `cell-editing.md`'s surface, and it
would change what gets stored. The hash palette stays as the fallback for values
that are in no option list.

**4. Option rows were swatch-plus-text; Notion renders the option's own pill.**
Fixed with `MenuRow.labelNode`, which is presentation-only — `label` still drives
search and the accessible name.

## Deltas accepted, not fixed

- **Panel width 285px vs Notion's measured 299px.** `md` is the nearest measured
  token. The visible consequence is that the scope disclaimer wraps to two lines
  where Notion's sits on one. Not worth inventing a one-off token for; recorded
  here so it is a decision rather than an oversight.
- **The option list has no drag handle.** Notion shows `⠿` on hover. Reordering
  is M11's drag-and-drop work, and a handle that does not drag is worse than no
  handle.

## Left as an open question

Selecting a colour **closes** our panel, matching every other `MenuList` row.
Whether Notion keeps its colour list open was not established — the attempt to
verify it in Notion mis-clicked and closed the menu, and I did not want to assert
behaviour I had not actually observed. Flagged rather than guessed.

---

# M3 — the view settings sidebar (2026-09-01)

Run by me, in Chrome, against the live app (`localhost:3000`) — a fresh local
database built for this run (11-property "New database" fixture is a
different, live Notion database this session doesn't have browser access to;
built a 4-property local stand-in: Title, Notes, Kind (select), Count
(number) instead). Checklist run item by item, live.

## Confirmed against the spec, no defect

- Toolbar renders all six icons in spec order (Filter · Sort · Automations ·
  AI Autofill · Search · Settings), right-aligned in the view-tabs row.
- Settings opens a **docked sidebar**, not a popover — `483px` (measured via
  `getComputedStyle`), non-resizable, table stays clickable underneath (no
  backdrop).
- Header: leading icon, editable name input, trailing ⓘ, × — matches the
  `[icon] [input] [ⓘ] .... ×` layout exactly.
- Section 1 rows, in order, chevron on every row except **Copy link to
  view** (verified via DOM: `hasChevron` true on Layout/Property
  visibility/Filter/Sort/Group/Conditional color, false only on Copy link) —
  row-for-row match.
- `Layout` shows value `Table`; `Property visibility` shows a live count
  (`4`, decrementing to `3` on hide) — both render correctly.
- Section 2 (`Data source settings`) / Section 3 (`More settings`) headers
  present; `Source` greyed with the data source's name as its value; `AI
  Autofill` greyed with no chevron.
- Property visibility: autofocused search, filters correctly, "Shown in
  table" + right-aligned "Hide all", row anatomy (drag handle, type icon,
  name, eye) matches. Toggling an eye **actually hides the table column and
  decrements the count** — the M1-class defect this milestone was watching
  for, closed by TableView.tsx now reading `hidden_properties`/
  `property_order` (previously written by M1 and M3 alike, read by neither).
- Layout: 3x3 grid renders (Table selected, blue border+label; every other
  card disabled — no `type` field on `ViewUpdate`, a documented, deliberate
  gap); three toggles present and functional (Show vertical lines removes
  the column-separator border live; verified via `getComputedStyle`
  zoom-and-inspect, not just eyeballing — see the environment note below);
  Open pages in shows `Side peek`.
- Open pages in popover: overlays the panel (not a flyout/push), Side peek
  ✓ + description + "Default for Table" annotation, Center peek + Full page
  each with their own description — matches the raw-dom capture.
- **Center peek**, selected then a row opened: rendered as a **centered
  modal** (backdrop, centered, not docked right) — confirmed live.
- **Full page**, selected then a row opened: **navigated to
  `/brain/workspace/{id}`** (bypassing RowPeek entirely) — confirmed live.
- Group: alphabetical property list, `select`/`status`/`multi_select`
  enabled, everything else disabled-with-reason, `None` clears; selecting a
  property patches `group_by` and the panel's own title flips `"Group by"` →
  `"Group"` with a checkmark on reopen.
- Sort: `New sort` title + `Sort by…` placeholder when empty; selecting a
  property sets a single ascending sort; the toolbar's own Sort button
  reflects it (after the fix below).
- Copy link to view: copies a `?view=` URL to the clipboard, toasts "Link
  copied to clipboard", applies immediately.
- Lock database: real toggle, PATCHes `db_databases.is_locked` (the endpoint
  already existed from Phase 0b — this session only added the frontend
  call), persists across reload.
- Edit properties: real property list; `Kind` (select) pushed the exact same
  option editor M2 built (add option, rename, delete, recolor) — three
  levels deep from the sidebar's root, same nesting depth M1/M2 already
  proved for flyouts, now proven for push too.
- Automations: pushes a small summary + "Manage automations", which opens
  the existing `AutomationManager` modal correctly layered above the
  sidebar.
- Firing two rapid config changes (Show vertical lines, then Show page icon)
  and reloading: **both persisted** — the `patchViewConfig` regression this
  panel was the second real test of held.
- No console errors at any point in the run.

## Found and fixed during the run

**1. A pushed panel didn't reflect its own live writes.** Dragging a row
inside Property visibility correctly wrote the new `property_order` — the
table re-rendered with the new column order immediately — but the **panel
itself** kept showing the pre-drag row order until popped and re-pushed.
Root cause: `MenuList`'s push stack stored resolved `MenuPanel` objects,
frozen at the moment a row was pushed; a parent re-render with fresh data
never touched an already-pushed snapshot. Fixed at the primitive level —
`MenuList` now stores only the path of pushed row ids and re-derives each
level from the live `root` every render (see `MenuList.tsx`'s `resolveStack`
and its own comment). This benefits every push-mode consumer, not just this
panel. Regression test added.

**2. The toolbar's Sort button showed the property's raw key, not its
name** — `"Sort: eNCdGzx4"` instead of `"Sort: Kind"`. `ViewToolbar.tsx` read
`sorts[0].property` (the key) straight into the label without looking it up
against `properties`. My own unit test had enshrined this, because the test
fixture's key and name happened to both look plausible. Fixed, and the test
fixture corrected so it can't pass by coincidence again.

## Environment note, not a product defect

This Chrome session renders every page with a browser-level forced-dark
repaint regardless of the page's own authored theme — `getComputedStyle`
confirmed `--menu-bg: #fff` (light, correctly authored) while the actual
pixels rendered dark. Structural checks in this run therefore leaned on
`getComputedStyle`/DOM inspection rather than eyeballing screenshot colour
wherever a screenshot looked suspicious (e.g. the Property visibility count,
which is genuinely present and correctly styled despite being nearly
invisible in a raw screenshot). Not applicable to prior milestones' own
screenshot-based diffs, which used a proper light-mode capture.

## Deliberate, not defects

- **Row count and layout switching are stubs.** Filter (no compiler exists —
  M4), Conditional color and Manage data sources (no backend support) push
  an honest "isn't available yet" panel rather than a half-built editor.
  Group/Sort are real, working MVPs (single group-by; multi-sort minus
  drag-reorder) — full editors (hide-empty-groups, per-group ordering,
  drag-reordered sort chips) are M5/M6's own scope.
- **The `New ▾` split button was not moved into the toolbar row.** It
  already exists at the bottom of the table (M11's row-add), and the spec's
  own scope bullet lists only the six toolbar icons as new; the ASCII
  diagram's `New ▾` placement is anchoring context, not a M3 deliverable.
