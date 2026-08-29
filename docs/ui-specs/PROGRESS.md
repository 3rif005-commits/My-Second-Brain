# Progress — Notion Databases UI Parity

**This file is the resume point.** A fresh session reads it and knows exactly where to
pick up, with no need to reconstruct context. Update it immediately after every status
transition, before moving on.

Statuses: `not-started` → `dom-captured` → `screenshots-read` → `written` → `self-audited`

**Branch:** `feat/notion-databases-ui-parity` (from `feat/workspaces-compact-redesign` @ 25a08b4)

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
| 2 | `property-create-edit.md` | dom-captured | `property-type-picker.txt`, `relation-config-panel.txt` | 10, 12a, 12b, 13 |
| 3 | `view-options-panel.md` | dom-captured | `view-settings-sidebar.txt` | 18, 20 |
| 4 | `filter-panel.md` | dom-captured (partial) | `filter-entry.txt` | — |
| 5 | `sort-panel.md` | dom-captured (partial) | `group-and-sort-panels.txt` | 32 |
| 6 | `group-panel.md` | dom-captured (partial) | `group-and-sort-panels.txt` | 36 |
| 7 | `view-tab-bar.md` | not-started | — | — |
| 8 | `database-header.md` | dom-captured (partial) | `create-database-picker.txt`, `empty-database-toolbar.txt`, `database-page-menu.txt` | 54 |
| 9 | `row-affordances.md` | dom-captured | `row-affordances-and-menu.txt` | 57, 58, 60 |
| 10 | `row-peek.md` | not-started | — | — |
| 11 | `calculations-row.md` | dom-captured (partial) | `table-column-header-menu.txt` | 70, 71 |
| 12 | `new-row-button.md` | not-started | — | — |
| 13 | `context-menus.md` | not-started | — | — |
| 14 | `table-drag-resize.md` | not-started | — | — |
| 15 | `cell-editing.md` | not-started | — | — |
| 16 | `states.md` | dom-captured (partial) | `empty-database-toolbar.txt` | — |

---

## Blocked on the user

- [x] **Notion tab** — done. `app.notion.com` (note: `notion.so` redirects there).
- [x] **`computer` permission** — granted mid-session, so real clicks/keys/screenshots work
      and the screenshots no longer have to be taken by hand.
- [x] **Light mode** — user authorised the theme switch; `Ctrl+Shift+L` toggles it.
      **Restore to DARK when capture is finished** — that is how the workspace was found.
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

## Log

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
