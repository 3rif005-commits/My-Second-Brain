# Board view — row hover affordances + card layout options

> Ground truth: live capture, 2026-09-02 (`app.notion.com`, the fixture database's own
> `Board` view, auto-grouped by `Person`) — screenshots taken inline during the session
> (not saved as numbered files under `screenshots/`, matching this M12 sub-phase's own
> convention since Form/Chart) plus targeted `zoom`/hover reads for exact icon/row
> content.
> Implements: M12 (Board's own dedicated work)
> Binds to: `BoardView.tsx`'s `config.card_preview`/`config.card_size`/
> `config.card_layout` (new this session) and the pre-existing `config.hidden_properties`/
> `property_order` (already wired, see "Already done before this session" below)

## Scope, per the plan's own words

`docs/plans/2026-08-28-notion-databases-ui-parity.md`'s M12 task breakdown named three
things for Board: "row hover affordances/peek (cards, not rows — needs its own capture
of what a Notion Board card's own hover state shows, almost certainly different from a
Table row's left-gutter shape), card layout options (cover/properties-shown, likely
close to Gallery's own once that ships), `hidden_properties` wiring."

## Already done before this session — confirmed by reading the code, not assumed

`hidden_properties`/`property_order` wiring: **already correct.** `BoardView.tsx`
already called `getHiddenKeys`/`orderProperties` (`viewConfig.ts`) before this session —
landed in an earlier M12 commit (`a228e72 fix(db): Board/Gallery cards ignored Property
Visibility's own order`) alongside the row-peek wiring pass. Row peek itself (`?p=&pm=`)
was also already wired (`feb485f`). This session's own real scope was narrower than the
plan's original three items: just the two below, plus a bug already flagged for this
milestone.

## What was captured

### Row hover affordances

Hovering a card reveals exactly two icons, top-right, identical in shape to Gallery's
own M12 capture (`row-affordances.md`'s "Gallery view" section): a pencil-shaped "open"
icon and a "···" row-menu trigger — both hover-only (invisible at rest, no layout
shift), confirmed by zooming the region before and after hovering. The row menu's own
content (opened live) is byte-identical to every other view's row menu: Add to
Favorites, Edit icon, Edit property, Layout, Property visibility, Open in, Comment,
Copy link, Duplicate, Move to, Move to Trash.

**Two row-menu shortcuts (Layout, Property visibility) are NOT built** — same
disclosed scope-down `row-affordances.md`'s Gallery section already made for the
identical two rows on Gallery's own cards: they open the SAME panels already reachable
from the view's own settings sidebar, and a second, card-scoped entry point wasn't
built to match. Not silently dropped — named here and in Gallery's own write-up.

### Card layout options (the sliders-icon Layout panel)

The full row set, top to bottom: the 3×3 type grid, Show page icon, Wrap all content,
Group by, **Color columns** (new, Board-specific — not offered for any other view type
captured so far), Open pages in, **Card preview**, **Card size**, **Card layout**.

| Row | Options | Default (captured) | Built this session? |
|---|---|---|---|
| Card preview | None / Page cover / a picked `files` property / Page content ("Uses first block on the page") | **None** | None/Page cover/a files property — reusing `GalleryView.tsx`'s own `extractFileUrl`. "Page content" not built (needs first-block extraction — the same real cost this workstream has flagged and skipped everywhere it comes up, Gallery's own session included). |
| Card size | (not captured which values, only that the row exists, defaulting to "Medium") | Medium | Built as small/medium/large — see "What's inferred" below. |
| Card layout | Compact / List | List | Built — identical semantic to `GalleryView.tsx`'s own `card_layout` (`readCardLayout`, exported and reused, not a second copy): List = one line per property, "Label: value"; Compact = every value joined onto one line with " · ", no labels. |
| Color columns | toggle | **On** | **Not built** — colors each column by its own group option's color (real, captured as existing, no infrastructure to reuse yet: `BoardColumn` currently reads only `group.label`/`group.key`, never a color). Disclosed, not silently dropped. |

**Board's own default differs from Gallery's, confirmed live, not assumed:** a fresh
Board view's Card preview reads **None**; a fresh Gallery view's reads **Page cover**
(`GalleryView.tsx`'s own `readCardPreview`). Board cards are data-oriented by default in
real Notion; Gallery's are image-grid-oriented. `BoardView.tsx`'s own
`readBoardCardPreview` defaults to `"none"` for exactly this reason — NOT Gallery's
helper reused verbatim, since the two views' defaults genuinely diverge.

### What's inferred, not captured

**Card size's own visual effect** — the row's existence and its "Medium" default were
captured; what changes at Small vs. Large was NOT (the session didn't click through all
three to compare, given the environment's own recurring memory pressure — see
"Live verification" below). Board's own card sits in a FIXED-width column (`w-72`),
unlike Gallery's freeform wrapping grid — a card can't get visually wider the way a
Gallery card can, so "size" almost certainly means something else here. Interpreted as
the cover image's own height (`small`/`medium`/`large` → `h-16`/`h-28`/`h-40`) — the one
element that can meaningfully resize inside a fixed-width card — a reasonable, disclosed
guess, not a captured fact. If a future capture shows otherwise, `BOARD_COVER_HEIGHT_CLASSES`
is the one place to correct it.

## The bug fixed alongside this

`BoardView.tsx` had the identical OPEN/CLOSE-doesn't-actually-toggle bug M10 (Table) and
Gallery's own M12 session each already fixed once — `onOpenRow={openRow}` (always
re-opens) instead of `useRowPeek`'s own `toggleRow`. Already flagged for this exact
milestone in `row-affordances.md`'s own Gallery section ("Confirmed present in
`BoardView.tsx` too... deliberately NOT fixed this session, out of scope for Gallery's
own named milestone; tracked for Board's own upcoming M12 milestone instead"). Fixed
here: `onOpenRow={toggleRow}`.

## What changed in code

- `GalleryView.tsx`: exported `CARD_LAYOUTS`/`CardLayout`/`readCardLayout`,
  `extractFileUrl`, `CoverPlaceholder` — all type-agnostic or semantically identical
  between the two views, reused rather than a third copy.
- `BoardView.tsx`: `BoardCard` gained a cover slot (shown only when
  `card_preview !== "none"`), wrapped the OPEN button + new `RowMenuTrigger` "···" in
  `HoverAffordance` (needed a `group` class on the card's own wrapper div — previously
  absent, since the only hover-state class before this was `cursor-grab`), and applies
  `cardLayout` to the property list exactly like `GalleryView.tsx`'s own card. `BoardView`
  gained a native-`<select>` toolbar row (Card preview / Card size / Card layout) —
  the SAME control style `GalleryView.tsx`'s own Layout row already uses (a native
  `<select>`-based inline bar above the grid, not the docked sidebar's `MenuList`/Popover
  system) — matching, not diverging from, the established pre-M12 pattern for this
  exact class of control.
- `BoardViewProps` gained an optional `onConfigChange` (mirrors `GalleryView`'s own
  prop exactly); `DatabaseShell.tsx`'s `case "board"` and `DashboardView.tsx`'s own
  Board-widget branch both wire it the same way Gallery's already were.

## Deliberately NOT built, ranked

1. **Color columns** — real, captured, needs new infrastructure (reading a group's own
   option color) this session didn't build.
2. **"Page content" as a Card-preview source** — needs first-block extraction, the
   recurring flagged-and-skipped cost across this whole workstream.
3. **The row menu's own Layout/Property visibility shortcuts** — same scope-down as
   Gallery's identical two rows.
4. **Card size's real visual effect** — inferred (cover height), not captured at each
   of the three settings.
5. **Keyboard, loading/error states** — not captured, matching every other surface's
   own TBD status.

## Checklist

**Unit-tested in full**, `BoardView.test.tsx` (23 pre-existing tests unchanged/still
green + 9 new): OPEN/CLOSE actually toggles (reusing the same button element across
both clicks, the same disambiguation Table's/Gallery's own identical test uses), hovering
reveals the row-options trigger and its menu content, Card preview defaults to no cover
slot even with `cover_image_url` present, "Page cover" renders `row.cover_image_url`
when configured, selecting each of the three new `<select>`s PATCHes the right config
key, Card layout's list-vs-compact rendering difference. Frontend 954 → 963 tests green,
`tsc` clean.

**Live verification: partial, disclosed rather than forced.** The capture itself (real
Notion, above) is complete. Re-verifying the BUILT result against this app's own running
instance was attempted but blocked by this machine's own recurring memory exhaustion
(`free -h`: ~530Mi free, 3.3Gi/3.7Gi swap — the same class this workstream has hit
repeatedly, e.g. List's own M12 session) — the Chrome tab's renderer stopped responding
to `Page.captureScreenshot` across a fresh tab and a retry, not just once. Not forced
further. Every interaction path this write-up describes IS covered by the unit tests
above, which assert actual DOM output and actual `onConfigChange` payloads, not a
hypothetical — but a pixel-level live check (does the hover icon land exactly where
Notion's own does, does the cover height genuinely look right at each size) has not
happened against this app's own build yet.
