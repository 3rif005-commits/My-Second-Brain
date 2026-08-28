# UI/UX parity prompt — Notion databases

Paste everything below the line into a **fresh session** (Opus 5, **not** Fable),
in **plan mode**.
This session produces **specs + plan only — no implementation code.**
Later sessions execute the plan.

Companion to `docs/prompts/notion-databases-research-and-plan-prompt.md`, which
drove the *mechanics* half of this feature to completion (M1–M14). That prompt
worked: the data model, formulas, rollups, relations, filters, 10 view types and
the API all exist and are tested. This prompt covers the half it did not
specify — **the interaction surface.**

---

**Use ultrathink for every judgment call in this task.** Budget is not a concern —
depth is. The value here is that the spec is *complete and verifiable* before a
line of UI code is written. The previous round failed on UI precisely because
"like Notion" was never written down in a checkable form.

## The goal

A user who knows Notion should sit down in front of our databases and **not
notice they left Notion.** Same affordances on hover, same menu opens from the
same click, same rows in the same order inside that menu, same sub-panels behind
the same arrows, same keyboard behavior, same empty states.

Not "Notion-inspired." Not "clean and modern." **The same experience.**

The mechanics are already there. This is entirely about what the user touches:
how a database gets created, how a view gets created and configured, how a
property gets added and edited, what every button does, and what panel it opens
with what attributes inside it.

## Why the current UI is not that — verified findings, start from these

Do not re-derive these; they are confirmed. Do extend them.

1. **There is no interaction primitive layer.** `frontend/package.json` has no
   Radix, no Headless UI, no Floating UI. `frontend/components/ui/` contains only
   `button.tsx`, `input.tsx`, `ConfirmDialog.tsx`, `PromptDialog.tsx`.
   Notion's entire database UI is one repeated primitive — *hover reveals an
   affordance → click opens a popover anchored to it → the popover is a
   searchable list of icon+label rows → a row either applies immediately or
   pushes a sub-panel with a back arrow.* Without that primitive, every surface
   in our code reinvented itself as an inline form. **This is the root cause.**
2. **Table column headers are inert.** `frontend/components/database/views/TableView.tsx:326`
   — `header` is a plain string for every property type except Button. Notion's
   column header dropdown is ~12 actions (rename, edit property, filter, sort
   asc/desc, hide, duplicate, insert left, insert right, wrap, freeze, delete)
   plus a nested type picker. Missing this one menu is a large fraction of the gap.
3. **View creation is an inline form with a native `<select>`.**
   `frontend/components/database/ViewTabs.tsx:150–210` — name field, OS dropdown,
   "Create" button, and group-by chosen *up front*. Notion opens a popover with a
   grid of view-type cards, creates immediately, and configures group-by
   *afterwards* in the view options panel.
4. **Native `<select>` throughout** — `TableView.tsx:662`, `ViewTabs.tsx:150`,
   and elsewhere. Notion never renders one; an OS dropdown breaks the illusion
   instantly.
5. Property creation is a trailing-column inline form (`TableView.tsx:645–780`),
   not Notion's anchored "New property" popover with a searchable type list.

Sweep the rest of `frontend/components/database/` for the same class of problem
and add what you find to the spec inventory.

## Decisions already made — do not re-litigate, but do plan around them

- **Ground truth = live DOM inspection *plus* my screenshots.** Both. Your
  training recall of Notion's exact menu rows is approximate and will drift; a
  spec written from memory is how we got here.
- **Scope of this plan = the primitive layer + full parity for Table view.**
  Board / Gallery / Calendar / Timeline / Chart / List / Feed / Form / Dashboard
  get a *named later phase*, not detailed milestones. Prove the pattern once
  before copying it nine times.
- **New dependencies are allowed** — Radix (`@radix-ui/react-popover`,
  `-dropdown-menu`, `-dialog`, `-tooltip`) for positioning, focus trapping and
  keyboard/a11y plumbing, styled entirely by us. Hand-rolling anchored-popover
  flip/shift positioning is where this work usually dies. Justify the exact
  package list in the spec.

## Process

1. **Inventory the surfaces.** Read `frontend/components/database/**` and list
   every place a user can click, hover, drag, or right-click. That list becomes
   the spec index.
2. **Capture ground truth, both ways:**
   - **DOM:** I will open notion.so logged in and hand you the tab. Use the
     `claude-in-chrome` tools to open each menu and read the real labels, real
     row order, real sub-panel structure, real keyboard handling. Notion's class
     names are obfuscated — read text content and ARIA, not styles.
   - **Screenshots:** produce `docs/ui-specs/SCREENSHOT-CHECKLIST.md` — a
     numbered list telling me exactly which menu to open in Notion and what to
     capture, one line per shot, so I can do the whole set in one sitting. I drop
     them in `docs/ui-specs/screenshots/`. You read the images for the visual
     detail the DOM cannot give: spacing, icon choice, section dividers, hover
     states, widths.
   Ask me for the tab and for the screenshots at the point in the plan where you
   actually need them. Do not guess ahead of them.
3. **Write one spec file per surface**, then the plan.

## Deliverables (all committed to the repo)

1. `docs/ui-specs/README.md` — the surface index, the spec template, and the
   review loop.
2. `docs/ui-specs/SCREENSHOT-CHECKLIST.md` — what I capture in Notion, numbered.
3. `docs/ui-specs/<surface>.md` — **one per surface**, each containing exactly:
   - **Trigger** — what the user hovers/clicks; what appears on hover and when.
   - **Anchor** — where the popover opens relative to the trigger, its width,
     max-height, scroll behavior, and flip/shift rules.
   - **Rows** — *every* row, in order: icon, label, right-side hint/value,
     whether it opens a sub-panel, and exactly what clicking it does. This
     section is the heart of the spec; "and the usual options" is a failure.
   - **Sub-panels** — each one spelled out in the same shape, with its back
     affordance.
   - **Keyboard** — ↑ ↓ Enter Esc Tab, type-to-search, focus return on close.
   - **States** — empty, loading, error, disabled-and-why.
   - **Persistence** — what saves immediately vs. on close vs. on blur.
   - **Checklist** — a numbered click-through an agent can run in Chrome to
     verify the surface, one assertion per step.
4. `docs/superpowers/specs/2026-08-28-notion-databases-ui-parity-design.md` — the
   primitive layer design: component API for each primitive, the Radix package
   list with justification, the design tokens (spacing scale, popover shadow,
   row height, icon size, type ramp) extracted from the screenshots, and the
   migration path for the existing inline forms.
5. `docs/plans/2026-08-28-notion-databases-ui-parity.md` — the phased plan,
   written with the **`superpowers:writing-plans`** skill.

Stop after these. Do not implement.

## The primitive layer — Phase 0 of the plan

Six components, built and unit-tested before any surface is touched. Notion
parity is mostly these:

| Primitive | Serves |
|---|---|
| `Popover` — anchored, flip/shift, Esc + outside-click, focus return | every menu |
| `MenuList` — search input, ↑↓ nav, icon+label rows, section dividers, **push/pop sub-panels with a back arrow** | type picker, filter, sort, group, view options, column header |
| `SidePeek` — right drawer, resizable, Esc, URL-addressable | row peek |
| `HoverAffordance` — opacity 0→100 on row/cell hover, no layout shift | drag handles, ⋮⋮, open buttons |
| `IconPicker` — emoji grid + search + remove | database, view, row icons |
| `DragHandle` — `@dnd-kit` wrapper (already installed) | row, property, column, group reorder |

Each gets vitest coverage for keyboard and dismissal behavior. Phase 0 ships
nothing user-visible and that is fine — say so in the plan.

## Surface order for the Table-view phases

Sequence the plan in this order; each is its own spec file and its own milestone:

1. Table **column header menu** — the biggest single win; do it first after Phase 0.
2. **Property creation + edit panel** — searchable type picker, per-type config,
   description, wrap, visibility, width, duplicate, delete.
3. **View options panel** — the `···` → Properties / Filter / Sort / Group /
   Layout / Load limit / Open-pages-in.
4. **Filter panel** — simple, then advanced with nested AND/OR groups.
5. **Sort panel** — multi-level, drag-reorder.
6. **Group panel** — group by, sub-group, hidden/empty groups, collapse, counts.
7. **View tab bar** — per-view `···` (rename, duplicate, copy link, delete),
   `+` popover with view-type cards, view icon.
8. **Database creation** — inline (`/database`) and full-page, title + icon +
   description inline-edit.
9. **Row hover affordances + open-as** — drag handle, ⋮⋮ menu, OPEN button,
   side peek / center peek / full page.
10. **Row peek panel internals** — property list, inline add-property, page body,
    comments, backlinks.
11. **Calculations row**, **templates menu**, **`+ New` split button**,
    **right-click context menus**, **column resize**, **row/column drag-reorder**.

Then one final phase named **"Apply the pattern to the other nine views"** —
listed, sized, not detailed. It gets its own prompt later.

## Definition of done per milestone — visual, not green

This is the part the last round got wrong. Our unit tests pass on a UI that feels
wrong, because tests assert behavior and the gap is in affordance and shape. So
every milestone's exit criteria are, in order:

1. Implementation matches its spec file row for row.
2. `cd frontend && npx tsc --noEmit && npm run test` clean.
3. An agent runs the spec's **Checklist** live in Chrome via `claude-in-chrome`
   and screenshots every step into `docs/ui-specs/screenshots/actual/`.
4. **I diff that against my Notion screenshot and say what is off.** Nothing
   ships as done before this step. Per `feedback_sdd_model_tiers`, a code review
   cannot catch this class of defect — only the live comparison can.
5. Subagent review pass per `feedback_subagent_review_loop` (per-milestone, plus
   a whole-branch pass at the end).
6. Per `feedback_test_after_milestone`, the milestone ends with the exact CLI
   commands I run myself.

Batch milestones 1–3 and 4–6 before review checkpoints rather than reviewing
after each; use Sonnet for execution and reserve Opus for the spec and the
reviews (`feedback_sdd_model_tiers`).

## Read first — the ground you're building on

- `docs/plans/2026-08-08-notion-databases.md` — the mechanics plan this extends.
  Its M1–M14 are done; you are not re-planning any of it.
- `frontend/components/database/` — all of it, especially `DatabaseShell.tsx`,
  `ViewTabs.tsx`, `views/TableView.tsx`, `DatabaseSettingsMenu.tsx`,
  `DatabaseRowProperties.tsx`, `RowPeek.tsx`.
- `frontend/lib/database/useDatabaseView.ts` and `frontend/lib/database/types.ts` —
  the state and types the new UI binds to. **The API layer is done and should not
  need to change.** If a surface genuinely needs a new endpoint or field, flag it
  as a distinct backend sub-task rather than quietly widening scope.
- `NOTION_PHASE.md` — the earlier phase that cloned Notion's page/editor UX
  (Cmd+K, icons, breadcrumbs, properties panel). Its primitives and visual
  language are prior art; extend them, don't fork them.
- `frontend/app/globals.css` and the Tailwind config — the existing token set.
- Auto-memories: `project_workspaces_redesign`, `feedback_sdd_model_tiers`,
  `feedback_subagent_review_loop`, `feedback_test_after_milestone`.

## Environment constraints (confirmed — don't rediscover)

- Whole stack: `./app.sh start|stop|status|logs`.
- Frontend: `cd frontend && npx tsc --noEmit && npm run build`; unit tests
  `npm run test` (vitest); e2e Playwright in `frontend/e2e/`.
- **No native `window.confirm/prompt/alert`** — they freeze the tab and kill
  browser automation. Use `ConfirmDialog` / `PromptDialog` / `useToast()`.
  Notion has no native dialogs anyway, so this constraint and the goal agree.
- No direct DB access from this machine; any migration is written as a file and
  handed to me to run in the Supabase SQL editor. This phase should need none —
  if it does, that is a signal the scope drifted into mechanics.
- Current branch is `feat/workspaces-compact-redesign` with uncommitted work.
  Ask me where this phase should branch from before the plan assumes anything.

## Definition of done for *this* session

The surface inventory is complete; the screenshot checklist exists and is
specific enough for me to execute without asking follow-ups; every surface has a
spec file whose **Rows** section is exhaustive rather than summarized; the
primitive-layer design is decided with its package list justified; the plan is
phased with per-milestone test commands and the visual-diff gate written into
every milestone's exit criteria; and you have asked me the questions whose
answers would change the design.

Then stop and hand back for approval before any implementation begins.
