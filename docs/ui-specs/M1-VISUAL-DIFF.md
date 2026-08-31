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
