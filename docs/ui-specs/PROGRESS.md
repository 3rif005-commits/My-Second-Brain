# Progress — Notion Databases UI Parity

**This file is the resume point.** A fresh session reads it and knows exactly where to
pick up, with no need to reconstruct context. Update it immediately after every status
transition, before moving on.

Statuses: `not-started` → `dom-captured` → `screenshots-read` → `written` → `self-audited`

**Branch:** `feat/notion-databases-ui-parity` (from `feat/workspaces-compact-redesign` @ 25a08b4)

---

## Phase 0 — COMPLETE (2026-08-31)

| Item | State |
|---|---|
| `@radix-ui/react-popover`, `-dialog`, `-tooltip` | installed |
| Design tokens | **measured** from live Notion via `getComputedStyle`, in `globals.css` + `tailwind.config.ts` |
| `Popover`, `MenuList`, `SidePeek`, `HoverAffordance`, `IconPicker`, `DragHandle` | written, `components/ui/primitives/` |
| Keyboard + dismissal tests | 24 tests, 4 files |
| Full suite | **45 files / 599 tests green** (baseline was 41 / 575) |
| `npx tsc --noEmit` | clean |
| Inline-database crash check | **moved to M1** — Phase 0 renders nothing, so there is nothing to run it against. `Popover` gained a `container` prop so the fix is one line when M1 needs it |

Phase 0 ships nothing user-visible. That is the intended outcome.

## Phase 0b — COMPLETE (2026-08-31)

| id | Endpoint | State |
|---|---|---|
| B1 | `DELETE /db/views/{id}` | done — refuses to delete the last view, in a transaction |
| B2 | `PATCH` + `DELETE /db/databases/{id}` | done — delete is **soft** (`deleted_at`), rows deliberately not trashed |
| B3 | `PropertyUpdate.description` | done — explicit `null` clears, via `model_fields_set` |
| B5 | `PropertyUpdate.type` | done — **grew well past its estimate**, see below |

**Backend suite 1829 passed** (was 1797; +32).

### B5 was mis-scoped in the plan, and by how much

The plan called it "`PropertyUpdate` must accept `type`" — about five lines. It
became `services/db/properties/convert.py` (~180 lines) plus 32 tests, because a bare
type flip is not merely untidy: values are §3.3 discriminated wrappers and `rows.py`
rejects a wrapper whose tag does not match its property, so every stored value would
have been invalidated at once.

Chosen semantics: coerce a defined subset, refuse the rest with a 400. Nothing is
destroyed silently. `legal_targets()` serves the greying list the UI needs, so there is
no second copy to drift.

**Currently convertible:** text-family (`rich_text`/`url`/`email`/`phone_number`),
`select` ↔ `status` ↔ `multi_select`, and into `number` where the text parses.
**Refused:** relation, formula, rollup, title, date, and checkbox as a target.
The matrix is extensible — widening it is a change to one dict.

## M1 / M2 / M2b — COMPLETE (2026-08-31)

| Milestone | State |
|---|---|
| M1 — table column header menu | done, visual-diffed, 4 defects fixed |
| M2 — property creation popover | done, visual-diffed |
| M2b — the 5 held-back property types | done; one defect found (types sharing an icon) |
| **M2 completion — `Edit property`** | **done, visual-diffed, 4 defects fixed** |

**Frontend 50 files / 676 tests green. Backend 1385 passed, 0 failed** (448 errors
are all `ConnectionRefusedError` — no local Postgres on this machine; pre-existing).
`npx tsc --noEmit` clean.

### What `Edit property` settled

- **The row is conditional on the property type.** A Text column's menu opens
  straight onto `Change type`; Notion shows no `Edit property` row at all.
  `hasEditableConfig()` is the one place that rule lives: `number`, `select`,
  `multi_select`, `status`.
- `NumberConfig` gained `decimal_places` / `show_as` / `bar_color` / `divide_by` /
  `show_number`. No endpoint change was needed — `config` is an unvalidated
  pass-through for non-computed types — but the model is the written-down schema
  and would otherwise have gone stale against what the UI writes.
- `NumberCell` **formats** now (39 formats, decimal places, bar/ring). Without
  that, `Number format` would have been a control nothing reads.
- The select cells read the configured option **colour**, matched by name. They
  are still free-text; rebuilding them as option pickers is `cell-editing.md`.

### Primitive additions this needed

| Addition | Why |
|---|---|
| `MenuSection.action.label: ReactNode` | the `Options` header's action is a `+` icon, not text |
| `MenuSection.content` | the `Show as` cards and the scope disclaimer are not rows, and `footer` would draw a divider the captured panel does not have |
| `MenuPanel.width` | widths are per-panel: 248px menu, 299px `Edit property` flyout |
| `MenuRow.labelNode` | an option row renders as the option's own coloured pill; `label` still drives search |
| flyout side inheritance | a chain that flipped left must keep going left, or the third level covers the first |

### Deferred, tracked

- `formula` / `relation` / `rollup` are excluded from `hasEditableConfig` — their
  config is already reachable through the creation popover's push-panel, and two
  entry points with two shapes is how the old inline forms drifted. Unifying them
  is the one named follow-up in `property-create-edit.md`.
- Option drag-reorder (`⠿`) waits for M11's drag work.
- Whether Notion keeps its colour list open on select is **unverified** — see
  `M1-VISUAL-DIFF.md`.

---

## Session artifacts

| Artifact | Status |
|---|---|
| `README.md` | written |
| `PROGRESS.md` | written |
| `SCREENSHOT-CHECKLIST.md` | written — 101 shots (87 P1 / 14 P2), §0 fixture + §1–§17 |
| `docs/superpowers/specs/2026-08-28-notion-databases-ui-parity-design.md` | written except §5 tokens (all TBD until screenshots) |
| `docs/plans/2026-08-28-notion-databases-ui-parity.md` | structure written; per-milestone task lists pending their specs |

## Surface specs

| # | Spec | Status | Raw DOM | Screenshots read |
|---|---|---|---|---|
| 1 | `table-column-header.md` | **written** (Keyboard TBD) | `table-column-header-menu.txt` | 02, 05, 70, 71 |
| 2 | `property-create-edit.md` | **written** (Select/Status option editors TBD) | `property-type-picker.txt`, `relation-config-panel.txt` | 10, 12a, 12b, 13, 13b |
| 3 | `view-options-panel.md` | **written** (Keyboard TBD) | `view-settings-sidebar.txt`, `layout-and-open-pages-in.txt` | 18, 20, 21, 22 |
| 4 | `filter-panel.md` | **written** (Keyboard TBD) | `filter-entry.txt` | 24, 30, 31 |
| 5 | `sort-panel.md` | **written** (Keyboard TBD) | `group-and-sort-panels.txt` | 32, 32b, 33, 34 |
| 6 | `group-panel.md` | **written** (Keyboard TBD) | `group-and-sort-panels.txt` | 36, 37, 37b |
| 7 | `view-tab-bar.md` | **written** (Keyboard TBD) | `view-tab-bar.txt` | 44, 44b, 44c, 46, 46b |
| 8 | `database-header.md` | **written** (blocked on B2) | `database-header.txt`, `create-database-picker.txt`, `database-page-menu.txt` | 50, 51, 52, 53, 54 |
| 9 | `row-affordances.md` | **written** (Keyboard TBD) | `row-affordances-and-menu.txt` | 57, 58, 60 |
| 10 | `row-peek.md` | **written** (centre peek TBD) | `row-peek.txt` | 62, 64, 65 |
| 11 | `calculations-row.md` | **written** (footer hover, Percent, other types TBD) | `calculations.txt` | 70, 70b, 70c, 71, 72 |
| 12 | `new-row-button.md` | **written** (templates-present state TBD) | `new-button-and-context-menus.txt` | 74 |
| 13 | ~~`context-menus.md`~~ | **REMOVED** — no distinct context menus exist; folded into §1 and §9 as extra triggers | `new-button-and-context-menus.txt` | 77, 78 |
| 14 | `table-drag-resize.md` | **written** (reorder drags TBD) | `resize-and-states.txt` | 79, 80 |
| 15 | `cell-editing.md` | **written** (Select, Status, Date; 7 types TBD) | `cell-editing.txt` | 85a-d, 87, 88 |
| 16 | `states.md` | **written** (loading/error/empty-group TBD) | `resize-and-states.txt`, `empty-database-toolbar.txt` | 94 |

---

## Blocked on the user

- [x] **Notion tab** — done. `app.notion.com` (note: `notion.so` redirects there).
- [x] **`computer` permission** — granted mid-session, so real clicks/keys/screenshots work
      and the screenshots no longer have to be taken by hand.
- [x] **Light mode** — user authorised the theme switch; `Ctrl+Shift+L` toggles it.
      **RESTORED TO DARK 2026-08-29** at the end of the autonomous capture session, as
      found. Flip it back to light with `Ctrl+Shift+L` before resuming capture — every
      light-mode screenshot in `screenshots/` was taken that way, and token values must
      come from light.
- [ ] **Fixture database** — user created an empty "New database" and authorised me to
      build the §0 fixture into it. Not built yet. Needed for: §1 (header menus vary by
      property type), §15 (cell editing per type), and the per-type config panels in §2.
      Consider trimming §0's 21 properties to the ~12 that actually change a menu.
      **UPDATE 2026-08-29:** built 11 properties into the user's "New database"
      (Name, Text, Number, Select, Multi-select, Status, Date, Person, Checkbox,
      URL, Files) plus one row "Row one". Enough for every capture so far.
      Still missing: Formula, Relation, Rollup, Created time; option values on
      Select/Status; more rows; a second view; a template.

---

## Baseline (branch health before any implementation)

- `npx tsc --noEmit` — **clean** (exit 0), 2026-08-29.
- `npm run test` — **clean** (exit 0): 41 files, 575 tests passed, 83s. 2026-08-29.

## Decisions taken (2026-08-31)

| Decision | Choice | Effect on the plan |
|---|---|---|
| Property types (26 vs our 11) | **Adopt the 11 backend-supported natives** | New **M2b**; picker ships 22 types |
| Grouping (10 types vs our 3) | **Add engine support first** | New **Phase 0c** — backend grouping engine, before M6 |
| Calculate sub-panel placement | **M1 ships it** | M11 reduced to the footer row |

Plus one gap found while reconciling: **Phase 0b needs a fourth endpoint (B5)** —
`PropertyUpdate` must accept `type`, or M1's `Change type` row is dead from the first
milestone.

## Remaining TBDs, ranked

Everything below is marked `TBD` inside a written spec. None blocks starting Phase 0.

**Blocks a specific milestone if not closed first**
1. §15 — cell editors for Text, Number, Multi-select, Person, Files, URL, Checkbox.
   **Select, Status and Date are captured.** The three captured differ from each other in
   placeholder copy, option rendering, create-on-type and footer rows, so the rest must be
   captured rather than inferred. **Blocks M11.**
2. §4 — filter operator lists for Checkbox, Number, Person, Files, Multi-select, Status,
   URL. **Text (8), Date (9) and Select (4) are now captured**, which was enough to
   establish the derive-from-TYPE_OPERATORS rule and surface two AST questions. The
   remaining seven are lower risk. **Partially unblocks M4.**
3. §14 — the column-drag and row-drag drop indicators. **Blocks part of M11.**

**Wanted but not blocking**
4. §11 — the footer's hover "Calculate" affordance; the `Percent` branch; Checkbox/Date
   branches.
5. §16 — the loading state, the error state, a visible empty group.
6. §10 — centre peek (`pm=c`); whether prev/next row navigation exists at all.
7. §2 — the Select/Status option editors, Date format, Formula, Rollup config panels.
8. §8 — whether the inline `/database` slash command opens the same data-source picker.
9. Keyboard behaviour on every surface except the column header menu.
10. Several **observed-but-unexplained** disabled states — collected in `states.md`.

## Fixture state (in the user's Notion, database "New database")

Built by me, with the user's authorisation, 2026-08-29:
- **11 properties**: Name (title), Text, Number, Select, Multi-select, Status, Date,
  Person, Checkbox, URL, Files
- **1 row**: "Row one", all values empty
- **2 views**: `Table` and `Board` (Board auto-grouped by Status)
- **1 Select option**: `Alpha`, created via create-on-type, applied to Row one
- **1 calculation**: `Sum` on the Number column, so the footer row renders
- **TYPES CORRECTED 2026-08-31.** Four properties had been created with the wrong type
  during the build (Status was Select, Person was Status, Checkbox and URL were both
  Person; Date was Select). All fixed via Change type and verified by reading the header
  type icons. The fixture is now honestly typed.
- **Still missing** for full §0 coverage: Formula, Relation, Rollup, Created time;
  more rows; a row template

## Log

- **2026-08-31 (second autonomous session)** — 13 more captures, 2 more specs (M7, and
  M1/M9/M3/M4 extended). Confirmed live: view creation is create-first-configure-after;
  Delete view is state-dependent on view count; the row context menu is the row menu with
  a third trigger (so §13 shrank); calculations are settable from the header menu, and
  Number's branches match `_NUMERIC_AGGREGATORS` exactly; cell editing is two-stage
  (select, then edit) where ours is one-stage; Select cells offer create-on-type with a
  coloured chip preview. Three self-corrections recorded rather than edited away: the
  bulk bar shows labels not icons; the header affordances ARE hover-revealed; and the
  a11y tree reports elements that are not visible, so hover states need screenshots.
  Theme restored to dark at the end.
- **2026-08-29 (autonomous session)** — Captured 13 surfaces live and wrote 4 specs.
  Screenshots: 24. Raw DOM captures: 9. See the log entries and git history.
  Key corrections to the plan and design doc, all committed with their evidence:
  view settings is a docked 483px sidebar not a popover; Filter/Sort are top-level
  toolbar buttons; sub-panels flyout from popovers but push from the sidebar; menus nest
  3 levels and flip mid-chain; the type picker is a 2-column grid with a separate hidden
  search; creating a database opens a data-source picker; the peek is URL-addressable and
  non-modal; the column header menu has no keyboard navigation at all; Notion groups by
  any property type where we support 3.
- **2026-08-29** — Wrote the implementation plan's structure: 12 milestones + Phase 0
  (primitives) + Phase 0b (three backend endpoints), three review checkpoints, and the
  per-milestone definition of done whose gate is the user's visual diff. Per-milestone task
  lists are deliberately absent — they cite spec rows.
- **2026-08-29** — Wrote the primitive-layer design doc. Decided: 3 Radix packages
  (popover, dialog, tooltip); `-dropdown-menu` rejected because Notion's menus are ARIA
  comboboxes, not menus, and its roving focus/typeahead fight the search input; Mantine
  rejected despite being installed. §5 token table is written but every value is TBD.
- **2026-08-29** — Wrote `SCREENSHOT-CHECKLIST.md`: §0 builds a `Parity Fixture` database
  with one property of every type, 8 rows with deliberate empty cells, sub-items,
  dependencies, 3 views and a template; §1–§17 are 101 numbered shots grouped by
  milestone, so §0–§3 (23 shots) alone unblocks M1–M3.
- **2026-08-29** — Branched from `feat/workspaces-compact-redesign` @ 25a08b4. Wrote
  `README.md` and this file. Surface inventory complete: 16 in-scope surfaces, 9 view
  types plus 8 sub-editors deferred to the later phase.
