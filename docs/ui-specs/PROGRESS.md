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
| `docs/superpowers/specs/2026-08-28-notion-databases-ui-parity-design.md` | not-started |
| `docs/plans/2026-08-28-notion-databases-ui-parity.md` | not-started |

## Surface specs

| # | Spec | Status | Raw DOM | Screenshots read |
|---|---|---|---|---|
| 1 | `table-column-header.md` | not-started | — | — |
| 2 | `property-create-edit.md` | not-started | — | — |
| 3 | `view-options-panel.md` | not-started | — | — |
| 4 | `filter-panel.md` | not-started | — | — |
| 5 | `sort-panel.md` | not-started | — | — |
| 6 | `group-panel.md` | not-started | — | — |
| 7 | `view-tab-bar.md` | not-started | — | — |
| 8 | `database-header.md` | not-started | — | — |
| 9 | `row-affordances.md` | not-started | — | — |
| 10 | `row-peek.md` | not-started | — | — |
| 11 | `calculations-row.md` | not-started | — | — |
| 12 | `new-row-button.md` | not-started | — | — |
| 13 | `context-menus.md` | not-started | — | — |
| 14 | `table-drag-resize.md` | not-started | — | — |
| 15 | `cell-editing.md` | not-started | — | — |
| 16 | `states.md` | not-started | — | — |

---

## Blocked on the user

- [ ] **Notion tab** handed over via `claude-in-chrome`, logged in, on the fixture
      database from `SCREENSHOT-CHECKLIST.md` §0. Needs site permission for `notion.so`
      in the Chrome extension.
- [ ] **Screenshots** captured per `SCREENSHOT-CHECKLIST.md` into `screenshots/`.

Both are needed before any spec can move past `not-started`. DOM capture and screenshot
capture run in parallel — the checklist is written first precisely so they can.

---

## Log

- **2026-08-29** — Wrote `SCREENSHOT-CHECKLIST.md`: §0 builds a `Parity Fixture` database
  with one property of every type, 8 rows with deliberate empty cells, sub-items,
  dependencies, 3 views and a template; §1–§17 are 101 numbered shots grouped by
  milestone, so §0–§3 (23 shots) alone unblocks M1–M3.
- **2026-08-29** — Branched from `feat/workspaces-compact-redesign` @ 25a08b4. Wrote
  `README.md` and this file. Surface inventory complete: 16 in-scope surfaces, 9 view
  types plus 8 sub-editors deferred to the later phase.
