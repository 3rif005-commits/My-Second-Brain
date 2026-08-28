# Notion Databases — UI Parity Specs

> **Goal:** a user who knows Notion sits down in front of our databases and does not
> notice they left Notion. Same affordances on hover, same menu from the same click, same
> rows in the same order, same sub-panels behind the same arrows, same keyboard, same
> empty states. Not "Notion-inspired." The same experience.
>
> **Status:** spec phase. See `PROGRESS.md` for what is done.
> **Design:** `docs/superpowers/specs/2026-08-28-notion-databases-ui-parity-design.md`
> **Plan:** `docs/plans/2026-08-28-notion-databases-ui-parity.md`
> **Extends:** `docs/plans/2026-08-08-notion-databases.md` (M1–M14, the mechanics — done)

---

## Why these files exist

The mechanics are built and correct: 22 property types, 10 view types, a filter→SQL
compiler, formulas, rollups, relations, templates, automations. The UI on top of them is
not Notion — it is a set of inline forms and 40 native `<select>` elements, because
"like Notion" was never written down in a form anyone could check an implementation
against.

These specs are that form. Each one describes a single surface in enough detail that an
implementing agent has nothing left to invent, and ends with a numbered checklist an agent
can run live in Chrome to prove the surface matches.

**Ground truth is live Notion, captured two ways** — never training recall, which drifts:

1. **DOM** — menus opened in a real logged-in Notion tab via `claude-in-chrome`, reading
   **text content and ARIA only**. Notion's class names are obfuscated and worthless.
   Raw captures are kept in `raw-dom/<surface>.txt` as the evidence behind each spec.
2. **Screenshots** — captured by the user per `SCREENSHOT-CHECKLIST.md` into
   `screenshots/`. These carry what the DOM cannot: spacing, icon choice, section
   dividers, hover states, widths.

A spec written from memory is how the last round failed. If a detail is in neither the
DOM capture nor a screenshot, it is marked `TBD` — never guessed.

---

## Surface index

**In scope this phase — the primitive layer plus full parity for Table view.** The other
nine view types are a named later phase; prove the pattern once before copying it nine
times.

| # | Surface | Spec | Milestone |
|---|---|---|---|
| 1 | Table column header menu | `table-column-header.md` | M1 |
| 2 | Property creation popover + edit panel | `property-create-edit.md` | M2 |
| 3 | View options `···` panel | `view-options-panel.md` | M3 |
| 4 | Filter panel — simple, then advanced with nested AND/OR | `filter-panel.md` | M4 |
| 5 | Sort panel — multi-level, drag-reorder | `sort-panel.md` | M5 |
| 6 | Group panel — group, sub-group, hidden/empty, collapse, counts | `group-panel.md` | M6 |
| 7 | View tab bar — per-view `···`, `+` type cards, view icon | `view-tab-bar.md` | M7 |
| 8 | Database creation, title, icon, description | `database-header.md` | M8 |
| 9 | Row hover affordances + open-as | `row-affordances.md` | M9 |
| 10 | Row peek panel internals | `row-peek.md` | M10 |
| 11 | Calculations row | `calculations-row.md` | M11 |
| 12 | `+ New` split button + templates menu | `new-row-button.md` | M11 |
| 13 | Right-click context menus — cell, row, header | `context-menus.md` | M11 |
| 14 | Column resize + column/row drag-reorder | `table-drag-resize.md` | M11 |
| 15 | Cell edit interactions, per property type | `cell-editing.md` | M11 |
| 16 | Empty / loading / error states | `states.md` | M11 |

**Inventoried, deferred to the later phase** (not spec'd here, listed so nothing is lost):
`DatabaseSettingsMenu` (⚙ — sub-items, dependencies, templates, automations, export),
`TemplateManager`/`TemplateEditor`, `AutomationManager`/`AutomationEditor`,
`ButtonActionChainEditor`, `RelationPicker`, `FormulaEditor`, `DatabaseBlock` inline
header, `ButtonBlock`/`ButtonCell`, and the nine non-Table views (Board, Gallery, List,
Feed, Calendar, Timeline, Chart, Form, Dashboard).

---

## Spec template

Every `<surface>.md` has exactly these sections, in this order. No others.

```markdown
# <Surface name>

> Ground truth: raw-dom/<surface>.txt · screenshots/NN-<slug>.png
> Implements: <milestone>
> Binds to: <hook/state/type it reads and writes>

## Trigger
What the user hovers or clicks. What appears on hover, and after how long.
What the affordance looks like before hover (usually: nothing, occupying reserved space).

## Anchor
Where the popover opens relative to the trigger. Width. Max-height. Scroll behavior.
Flip and shift rules when it would overflow the viewport.

## Rows
EVERY row, in order. One table row each:
| # | Icon | Label | Right side | Sub-panel? | Effect |
"And the usual options" is a failed spec. If Notion shows 12 rows, there are 12 rows here.
Note which rows are conditional and on what, and which are disabled and why.

## Sub-panels
Each one in the same shape as Rows, with its back affordance and its title.

## Keyboard
↑ ↓ Enter Esc Tab ← . Type-to-search. Where focus sits on open. Where focus returns on close.

## States
Empty, loading, error, disabled-and-why. Quote the exact copy.

## Persistence
What saves immediately, what saves on close, what saves on blur. Which endpoint or
config key each one writes.

## Checklist
Numbered click-through an agent runs in Chrome. One assertion per step.
Each step names the screenshot to capture into screenshots/actual/.
```

---

## Review loop

Per milestone, in order. A milestone is not done until step 4 passes.

1. Implementation matches its spec file **row for row**.
2. `cd frontend && npx tsc --noEmit && npm run test` clean.
3. The spec's **Checklist** is run live in Chrome via `claude-in-chrome`; every step is
   screenshotted into `screenshots/actual/`.
4. **The user diffs `screenshots/actual/` against `screenshots/` and says what is off.**
   Nothing ships as done before this. A code review structurally cannot catch this defect
   class — the gap is in affordance and shape, and tests assert behavior.
5. Review pass over the accumulated diff, run inline, findings appended to `REVIEW-LOG.md`
   one at a time as they are found.
6. The milestone ends with the exact CLI commands for the user to run themselves.

Review checkpoints are batched: after M1–M3, after M4–M6, after M7–M11, plus one
whole-branch pass at the end.

---

## Working rules

- **No subagents.** Every step runs inline in the main session. Subagent output lives only
  in a transcript, and a session hitting its limit has destroyed completed work here more
  than once.
- **Disk first.** Each artifact is written the moment it is finished, never accumulated
  and flushed at the end. `PROGRESS.md` is updated on every status transition and is the
  resume point for a fresh session. Commit per artifact.
- **Raw evidence before prose.** DOM captures land in `raw-dom/` before being turned into
  a spec. Re-opening a Notion menu is cheap; re-deriving a capture you no longer have is not.
- **No native dialogs.** `window.confirm/prompt/alert` freeze the tab and kill browser
  automation. Use `ConfirmDialog`, `PromptDialog`, `useToast()`. Notion has no native
  dialogs either, so the constraint and the goal agree.
- **No invented numbers.** A spacing, width or color with no screenshot behind it is `TBD`.
