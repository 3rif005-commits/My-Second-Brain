## Resolution (2026-09-02) — case 1, no code bug

Followed the investigation plan below rather than guessing. Asked the user directly
(`AskUserQuestion`): which kind of database (**full-page**, confirmed), whether they'd
deliberately hovered and waited for the gutter (**yes**), and which platform (**browser**).
Then asked for fresh evidence.

The user supplied two screenshots side by side, both in the bulk-selected "1 selected"
state: their own real Notion (a full-page database, row "Presidential Decree 21-285",
colored Module pills — confirmed real Notion by the "Aa" title-column icon, which is
Notion's own convention, distinct from our app's "T") and our app (the "Untitled Database"
fixture, row "Untitled", € Count, Kind "Guide" — confirmed ours by the "T" title icon and
by the bulk-bar showing only a trash icon, matching `row-affordances.md`'s own documented
scope-down: "the overflow ⋯ ... were not built" for M9).

**Both screenshots show the identical `+` / `⠿` drag-handle / `☑` checkbox gutter and
`OPEN` button.** The user's own words: "the same, only the notion are well render so i did
not notice them all this time" — real Notion does show this gutter; it renders subtly
enough that the user hadn't consciously registered it before, not an app bug.

This is **possibility 1** from this doc's own list below: the 2026-08-29 capture was
accurate then, and still is. **No `RowGutter.tsx` change was made** — the existing
implementation already matches. `row-affordances.md`'s "Trigger" section was tightened to
state the full-page-database condition explicitly and record this confirmation, so a
future report against an *embedded/linked* database (still unverified) isn't assumed to be
the same case. Logged in `PROGRESS.md`'s Log and `REVIEW-LOG.md`.

A live before/after sanity check of our own app (resting vs. hover, to confirm no stuck-
visible state) was attempted but blocked by this session's Chrome tab freezing under the
same memory exhaustion this workstream has hit repeatedly (`free -h`: 447Mi free,
3.2Gi/3.7Gi swap) — not forced, since this was a documentation-only resolution with no code
change to verify, and the user's own fresh screenshots already answered the actual
question in dispute (which icons appear, not whether hover-vs-rest gating still works).

---

# Issue: Table row gutter (`+` / drag-handle / checkbox) — reported mismatch vs live Notion

**Reported:** 2026-09-02, by the user, from direct visual comparison of our app against
their own real Notion account. Screenshot showed our app's Table view, hovering the row
"Untitl...": three icons in a left gutter (`+`, `⠿` drag handle, `☐` checkbox) plus a
labelled `OPEN` button, exactly as `row-affordances.md`/M9 built it.

**The user's own words:** "when i review the databases i find [screenshot] these three
icon `+` and `::` and the selection square which i never seen in Notion — i want a task
to solve this and correct it."

## Why this needs a fresh, careful re-check rather than a quick fix

This is not a fresh guess we're correcting — `RowGutter.tsx`'s three icons were built
directly from a live-Notion capture, with recorded pixel offsets, method noted as "real
hover + real click via `computer`":

- `docs/ui-specs/raw-dom/row-affordances-and-menu.txt` (captured 2026-08-29) — records
  exactly this: `+` at x≈299, drag handle `⠿` at x≈321, checkbox `☐` at x≈356, all
  "OUTSIDE the table, in the left gutter," hover-revealed only.
- `docs/ui-specs/screenshots/57-row-hover.jpg` — the screenshot from that capture.
- `docs/ui-specs/row-affordances.md` — the spec built from it, checklist step 3: "Hover a
  row. → assert exactly five appear: `+`, drag handle, checkbox, page icon, `OPEN`."
- This shape was then reused for List (minus the checkbox, its own live-checked delta —
  see `row-affordances.md`'s "List view (M12)" section) and was the whole basis for M9's
  `RowGutter`/`RowMenu` build, later extended to Board/Gallery/Calendar/Timeline/Feed's
  row-peek wiring (M12, this session).

So there are three real possibilities, and the task is to find out which one is true
before touching any code:

1. **The 2026-08-29 capture was accurate then, and still is** — the user's own Notion
   database is in a state where this doesn't show (e.g. a *linked/inline* database
   embedded in a page renders its row gutter differently than a *full-page* database; a
   specific view type; a plan/workspace setting; hovering the wrong zone). If so, nothing
   in our code is wrong — but M9's own spec should record the exact condition under which
   the gutter does/doesn't appear, since right now it doesn't say.
2. **Real Notion's UI has changed since 2026-08-29** (own product update) — Notion ships
   frequently. If so, our app is now stale against a moving target, and the right fix is
   to re-capture and rebuild to match the CURRENT real behavior, not the 2026-08-29 one.
3. **Our own rendering has a bug** the 2026-08-29 capture didn't have — e.g. the icons
   render even without a real hover (stuck visible), or render in a context real Notion
   never showed them in the first place (this app's own "New Database"/fixture setup vs a
   real user database), even though the ORIGINAL capture was accurate for what it tested.

## What to do in the new conversation

Follow this workstream's own established discipline (`docs/ui-specs/README.md`'s "Review
loop"): capture before building, raw evidence before prose, no invented numbers.

1. **Read first, don't re-derive:** `docs/ui-specs/row-affordances.md` (the whole
   "Trigger"/"Anchor"/"States" sections, plus the M12 "List view" and "Feed view" sections
   for how this shape was later adapted), `docs/ui-specs/raw-dom/row-affordances-and-menu.txt`,
   `frontend/components/database/RowGutter.tsx`, `RowMenuTrigger.tsx`,
   `frontend/components/database/RowGutter.test.tsx`.
2. **Ask the user directly** (do not guess): which Notion database were they comparing
   against — a full-page database, or one embedded/linked inside a page? Desktop app or
   browser? Have they specifically hovered a ROW (not the header, not a column) and
   waited for the gutter to render? If they have a link or can share a screenshot of their
   own Notion row *at rest* and *on hover*, that is the fastest way to settle this.
3. **Re-capture live Notion fresh**, in a real, plain, full-page database — screenshot
   both the at-rest state and the hover state, side by side, the same way the original
   2026-08-29 capture did (`computer` tool, real hover, not synthetic). Compare pixel
   position and which icons appear, not just "does a gutter exist."
4. **Compare against our app's CURRENT rendering** (`localhost:3000`) — hover a Table row,
   confirm whether the icons appear ONLY on real hover (no stuck state), and whether
   `showCheckbox` is actually gating correctly for every view that calls `RowGutter`
   (Table `true`, List `false` — grep `RowGutter.tsx` usages to check nothing else is
   wrong).
5. **Decide, then act:**
   - If real Notion (freshly re-checked) still shows this shape in a full-page database →
     no code bug. Explain this clearly to the user with the fresh screenshots side by
     side, and tighten `row-affordances.md`'s own "Trigger" section to say explicitly
     "full-page database only" (or whatever the real condition turns out to be) so this
     doesn't get mis-applied again.
   - If real Notion does NOT show this (confirmed fresh, not assumed) → this is a real
     over-build to fix: adjust `RowGutter.tsx` to match what's actually there, update
     `row-affordances.md`'s spec and its own "Built" sections, update
     `RowGutter.test.tsx`/every downstream view's tests that assert this shape (List,
     Table, and anywhere else `RowGutter` is used), and write up what changed and why in
     `PROGRESS.md`'s Log and `REVIEW-LOG.md`, matching how every other correction in this
     workstream has been recorded.
6. **Live-checklist afterward**, same as every other milestone in this workstream —
   confirm the fix (or the non-fix) actually renders correctly in the running app, not
   just in the capture.

## Relevant files

- `docs/ui-specs/row-affordances.md` — the spec, needs updating either way
- `docs/ui-specs/raw-dom/row-affordances-and-menu.txt` — original capture evidence
- `docs/ui-specs/screenshots/57-row-hover.jpg`, `58-row-menu-and-bulk-bar.jpg` — original screenshots
- `frontend/components/database/RowGutter.tsx` — the component in question
- `frontend/components/database/RowGutter.test.tsx` — its tests
- `frontend/components/database/RowMenuTrigger.tsx` — the shared row-menu logic (used by RowGutter and FeedView)
- `docs/ui-specs/PROGRESS.md` — resume point / log, update after resolving
- `docs/ui-specs/REVIEW-LOG.md` — record the finding here too if it turns out to be a real bug
