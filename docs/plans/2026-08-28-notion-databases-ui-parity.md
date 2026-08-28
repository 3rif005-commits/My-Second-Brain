# Notion Databases — UI Parity Implementation Plan

> **Status:** structure decided; per-milestone task lists are written as each surface spec
> lands (they cite spec rows, so they cannot be written first). See
> `docs/ui-specs/PROGRESS.md` for what is ready.
>
> **Goal:** a user who knows Notion sits down in front of our databases and does not notice
> they left Notion. Same affordances on hover, same menu from the same click, same rows in
> the same order, same sub-panels behind the same arrows, same keyboard, same empty states.
>
> **Specs:** `docs/ui-specs/` — one file per surface, and the source of truth for every row
> **Design:** `docs/superpowers/specs/2026-08-28-notion-databases-ui-parity-design.md`
> **Extends:** `docs/plans/2026-08-08-notion-databases.md` (M1–M14, the mechanics — done,
> not re-planned here)

---

## Context

The mechanics are built and correct: 22 property types, 10 view types, a filter→SQL
compiler, formulas, rollups, relations, templates, automations, CSV in/out. The UI on top
of them is not Notion, for one structural reason — **there is no interaction primitive
layer**, so every surface reinvented itself as an inline form. 40 native `<select>`
elements across 11 files; property creation as a trailing-column form; view creation as an
inline form with the group-by chosen up front.

The previous round failed on UI because "like Notion" was never written down in a checkable
form, so its exit criteria could only assert behavior — and the gap is in affordance and
shape, which behavior tests do not see. This plan's exit criteria therefore end in a live
visual diff, and its specs are exhaustive enough that an implementing agent invents nothing.

**Scope:** the primitive layer plus full parity for **Table view**. The other nine view
types are a named final phase — prove the pattern once before copying it nine times.

---

## Global constraints

- **No subagent-driven execution.** Every milestone runs inline in the main session. A
  subagent's output lives only in a transcript, and a session hitting its usage limit has
  destroyed completed work on this project more than once. Artifacts are written to disk as
  they are finished and committed per artifact; `docs/ui-specs/PROGRESS.md` is the resume
  point for a fresh session.
- **The API layer is done and does not change**, apart from the three endpoints scoped as
  Phase 0b. Any surface that seems to need more is a signal that scope drifted into
  mechanics — raise it, do not widen quietly.
- **No native `window.confirm/prompt/alert`** — they freeze the tab and kill browser
  automation. Use `components/ui/ConfirmDialog`, `PromptDialog`, `useToast()` from
  `app/providers.tsx`. Notion has no native dialogs either, so the constraint and the goal
  agree.
- **No new migrations.** This phase should need none; if one appears, scope drifted.
- **No invented visual values.** A spacing, width or colour with no screenshot behind it is
  `TBD` and blocks the milestone that needs it.
- **Per-view state goes in `view.config`**, an unvalidated JSONB pass-through
  (`ViewUpdate.config`). Property order, visibility, width and wrap are per-view in Notion
  too, so column reorder / hide / resize / insert-left / insert-right need **zero** backend
  change. Do not use schema-level `db_properties.position` for view-local ordering.
- Frontend: `cd frontend && npx tsc --noEmit && npm run test`; build `npm run build`;
  e2e `npx playwright test`.
- Backend: `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/ -p asyncio`.
  Two venvs — `.venv` is runtime, `venv` is the test venv. Do not mix them.
- Whole stack: `./app.sh start|stop|status|logs`.

---

## Milestone sequence

| # | Milestone | Spec | Ships |
|---|---|---|---|
| **0** | Primitive layer + design tokens | design doc §3, §5 | Nothing user-visible — correct for this phase |
| **0b** | Three backend endpoints | — | Unblocks M2, M7, M8 |
| **1** | Table column header menu | `table-column-header.md` | The single biggest win |
| **2** | Property creation + edit panel | `property-create-edit.md` | Searchable type picker, per-type config |
| **3** | View options `···` panel | `view-options-panel.md` | Properties / Layout / Load limit / Open-pages-in, and the entry points to M4–M6 |
| — | **review checkpoint (M1–M3)** | | |
| **4** | Filter panel — simple, then nested AND/OR | `filter-panel.md` | First time a filter is settable from the UI at all |
| **5** | Sort panel — multi-level, drag-reorder | `sort-panel.md` | Same |
| **6** | Group panel — group, sub-group, hidden/empty, counts | `group-panel.md` | Same |
| — | **review checkpoint (M4–M6)** | | |
| **7** | View tab bar — per-view `···`, `+` type cards, view icon | `view-tab-bar.md` | Rename/duplicate/delete a view; fixes the header-chrome collision |
| **8** | Database creation, title, icon, description | `database-header.md` | A database can be renamed for the first time |
| **9** | Row hover affordances + open-as | `row-affordances.md` | Drag handle, `⋮⋮`, selection, OPEN |
| **10** | Row peek internals | `row-peek.md` | Resizable, URL-addressable, add-property, comments |
| **11** | Calculations row, `+ New`, context menus, resize, drag-reorder, cell editing, states | `calculations-row.md`, `new-row-button.md`, `context-menus.md`, `table-drag-resize.md`, `cell-editing.md`, `states.md` | The remainder of Table parity |
| — | **review checkpoint (M7–M11), then whole-branch pass** | | |
| **12** | **Apply the pattern to the other nine views** | — | Named and sized below; gets its own prompt |

### Phase 0 — primitive layer

Six components under `frontend/components/ui/primitives/`: `Popover`, `MenuList`,
`SidePeek`, `HoverAffordance`, `IconPicker`, `DragHandle`. Three new packages
(`@radix-ui/react-popover`, `-dialog`, `-tooltip`) — see the design doc §2 for why
`-dropdown-menu` and Mantine are rejected.

Vitest coverage is required for **keyboard and dismissal**, since that is what a later
visual diff cannot check: ↑/↓ with focus retained in the search input, Enter, Esc popping
one sub-panel then closing, ← popping, Tab returning focus to the trigger, type-to-search,
outside-click, and `role="combobox"` + `aria-activedescendant` on the search input.

Exit also requires the inline-database check from design doc §6.1: open a `MenuList` from
a database embedded in a note and move the mouse over it. Radix portals render outside
`DatabaseBlock`'s `stopPropagation` wrapper, which is the only thing keeping BlockNote's
`TableHandles` from crashing.

### Phase 0b — the three backend endpoints

No migration, no schema change, ~65 lines total.

| id | Endpoint | Unblocks |
|---|---|---|
| B1 | `DELETE /db/views/{view_id}` | M7 — view `···` → Delete |
| B2 | `PATCH` + `DELETE /db/databases/{database_id}` | M8 — title, icon, description, delete |
| B3 | `PropertyUpdate.description` (the column exists on `PropertyResponse`; the patch model cannot write it) | M2 — the property Description field |

**Not built, flagged:** duplicating a row cannot copy the page body without a new endpoint
(B4). Duplicating a view and duplicating a property are done client-side (POST + PATCH)
and are faithful. Deleting a row already works through the existing
`DELETE /api/notes/{noteId}` — it needs wiring, not an endpoint.

---

## Definition of done, per milestone

In this order. A milestone is not done until step 4 passes.

1. **Implementation matches its spec file row for row.** Not "covers the same ground" —
   the rows, their order, their icons, their hints, their sub-panels.
2. `cd frontend && npx tsc --noEmit && npm run test` clean.
3. The spec's **Checklist** is run live in Chrome via `claude-in-chrome`, every step
   screenshotted into `docs/ui-specs/screenshots/actual/` **as it is taken**, so an
   interrupted run resumes at the next unshot step.
4. **The user diffs `screenshots/actual/` against `screenshots/` and says what is off.**
   Nothing ships as done before this. A code review structurally cannot catch this defect
   class: it is scoped to the diff it is handed, and the gap here is in affordance and
   shape, which passing tests do not measure.
5. Review pass over the accumulated diff, run inline, findings appended to
   `docs/ui-specs/REVIEW-LOG.md` one at a time as they are found. Batched at the three
   checkpoints above, plus one whole-branch pass at the end.
6. The milestone ends with the exact CLI commands for the user to run themselves:
   ```
   cd frontend && npx tsc --noEmit && npm run test
   cd frontend && npm run build
   ./app.sh start          # then click through the surface in the browser
   ```
   Backend milestones (0b) add:
   ```
   cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/ -p asyncio
   ```

---

## Phase 12 — the other nine views (named, sized, not detailed)

Gets its own prompt once the pattern is proven on Table. Sized by how much of each view's
surface is already-built mechanics versus net-new UI:

| View | Size | Why |
|---|---|---|
| Board | L | Group headers, card layout options, drag between columns, per-group `+` and `···` |
| Gallery | M | Card preview source, card size, fit-image; shares the property-visibility panel |
| List | S | Nearly all shared surface |
| Feed | S | Same |
| Calendar | L | Date-range bars, month/week, drag to reschedule, event peek |
| Timeline | L | Zoom levels, dependency arrows, drag to reschedule, the table/timeline split |
| Chart | M | Config panel is already dense; mostly a `<select>` → `MenuList` migration |
| Form | M | Field editor, logic, the public page |
| Dashboard | M | Widget grid, per-widget config |

Also deferred here, and inventoried so they are not lost: `DatabaseSettingsMenu`,
`TemplateManager`/`TemplateEditor`, `AutomationManager`/`AutomationEditor` (10 native
`<select>`), `ButtonActionChainEditor` (8), `RelationPicker`, `FormulaEditor`,
`DatabaseBlock`'s inline header, `ButtonBlock`/`ButtonCell`.
