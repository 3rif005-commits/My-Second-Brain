# Notion Databases — UI Parity: Primitive Layer Design

> **Status:** design in progress. Token values are `TBD` until the Notion screenshots land
> — see §5. Everything else is decided.
> **Date:** 2026-08-28
> **Specs:** `docs/ui-specs/` (16 surfaces, one file each)
> **Plan:** `docs/plans/2026-08-28-notion-databases-ui-parity.md`
> **Extends:** `docs/superpowers/specs/2026-08-08-notion-databases-design.md` (the
> mechanics — built, M1–M14, not re-designed here) and `NOTION_PHASE.md` (page/editor UX —
> prior art to extend, not fork).

---

## 1. The root cause this document addresses

Notion's entire database UI is **one repeated primitive**:

> hover reveals an affordance → clicking it opens a popover anchored to that affordance →
> the popover is a searchable list of icon+label rows → a row either applies immediately or
> pushes a sub-panel with a back arrow.

We have no such primitive. `frontend/components/ui/` contains four files —
`button.tsx`, `input.tsx`, `ConfirmDialog.tsx`, `PromptDialog.tsx` — and `package.json`
has no Radix, no Headless UI, no Floating UI. With nothing to reach for, every surface
reinvented itself as an inline form: **40 native `<select>` elements across 11 files**, a
trailing-column form for property creation, an inline form for view creation. An OS
dropdown breaks the illusion the instant it opens, and no amount of per-surface polish
fixes a missing shared abstraction.

So the primitive layer is Phase 0 and lands before any surface is touched. It ships
nothing user-visible, and that is the correct outcome for that phase.

---

## 2. Package list

Three new dependencies. Each is unstyled — we own every pixel — and React-18 compatible.

| Package | Why it earns its place |
|---|---|
| `@radix-ui/react-popover` | Anchored positioning with flip and shift, portalling, Esc, outside-click dismissal, and focus return to the trigger. It wraps `@floating-ui/react-dom`, so collision handling is real rather than approximated. **Hand-rolling anchored-popover flip/shift is where this class of work usually dies** — and we would be hand-rolling it 16 times. |
| `@radix-ui/react-dialog` | `SidePeek`, plus the four existing modals. Gives a real focus trap, scroll lock and `aria-modal`. `ConfirmDialog` and `PromptDialog` migrate onto it, which also removes their hand-rolled Esc/backdrop handling. |
| `@radix-ui/react-tooltip` | Notion labels nearly every hover affordance ("Drag to move", "Click to open menu"). Correct delay-group behavior — one tooltip warms up, subsequent ones appear instantly — is fiddly and not worth writing. |

### 2.1 Rejected, with reasons

**`@radix-ui/react-dropdown-menu` — rejected.** This is the non-obvious call. Radix's
`DropdownMenu` implements the ARIA **menu** pattern: roving `tabindex`, focus moving to the
active item, and built-in typeahead. Notion's menus are not menus in that sense — they keep
focus in a **search input at the top of the panel** while ↑/↓ move a visually-active index
in the list below and Enter picks it. That is the ARIA **combobox** pattern, and it fights
`DropdownMenu` at every point: the roving focus steals focus from the input, and the
built-in typeahead swallows the characters the input needs.

Adopting it would mean two menu primitives with different keyboard behavior, and the
seam between them would be exactly the kind of inconsistency this phase exists to
eliminate. One `MenuList` built on `Popover` serves every menu in the inventory instead.

**`@mantine/core` — rejected, despite already being installed.** It is a direct dependency
(BlockNote's Mantine flavor) but is used in **zero** lines of our own app code, so "free"
is misleading — adopting it is a new adoption, not a reuse. It ships opinionated styles
and requires a `MantineProvider`; BlockNote already mounts its own, and a second
app-level provider risks style and theme collisions with the editor. Radix ships unstyled,
which is what a pixel-parity target needs.

**An emoji dataset (`@emoji-mart/data`, `emojibase-data`) — rejected for now.** A
searchable dataset is ~1 MB. `NoteEditorPage.tsx:17` already has a curated `EMOJIS` array;
`IconPicker` extends it to ~400 entries with keyword tags for search. Revisit only if
search quality is the actual complaint.

**`@dnd-kit/core`, `-sortable`, `-utilities` — already installed and already used.**
`DragHandle` wraps them; no new dependency.

---

## 3. The six primitives

All under `frontend/components/ui/primitives/`.

### `Popover`

Thin wrapper over Radix Popover carrying our tokens and default offsets.

```ts
interface PopoverProps {
  trigger: React.ReactNode;          // composed via asChild
  open?: boolean;                    // controlled; uncontrolled by default
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "right" | "bottom" | "left";   // default "bottom"
  align?: "start" | "center" | "end";           // default "start"
  sideOffset?: number;
  width?: number | "trigger";
  maxHeight?: number | string;
  children: React.ReactNode;
}
```

### `MenuList`

The heart of the layer. Rendered inside a `Popover`.

> **REVISED 2026-08-29 against live Notion captures.** The original sketch — one level of
> push/pop sub-panel behind a back arrow — did not survive contact with the product.
> Evidence: `docs/ui-specs/raw-dom/table-column-header-menu.txt`,
> `property-type-picker.txt`.

**Sub-panels are adjacent flyouts, not a push/pop stack.** Opening "Change type" from the
column header menu renders a second panel to the *right* while the parent stays fully
visible. There is no back arrow because nothing is hidden. Our own
`TemplateManager.tsx:116` / `AutomationManager.tsx:99` use push/pop — that is *our*
convention, and it is not what this surface does.

**Nesting runs at least three levels and flips mid-chain.** `Calculate` → `Count` → the
count functions. The third level opened to the *left*, because the second already ran to
x≈1077 in a 1300px viewport. Each level makes its own flip/shift decision — the concrete
reason to take Radix's collision handling rather than approximate it.

**Column count is per-panel.** The "+ Add property" type picker is a two-column grid; the
"Change type" list of *the same types* is one column. A single search match fills one cell
of the grid rather than collapsing to a list.

```ts
interface MenuRow {
  id: string;
  icon?: React.ReactNode;
  label: string;
  description?: string;              // caption under the label ("This improves performance…")
  badge?: string;                    // "Basic", "Now with agents"
  hint?: string;                     // right-aligned shortcut, e.g. "Ctrl+Alt+L"
  value?: string;                    // right-aligned current value, e.g. "Table"
  kind?: "row" | "toggle";           // rows can be switches
  checked?: boolean;                 // confirmed: current type / current calculation carry ✓
  danger?: boolean;
  disabled?: boolean;                // confirmed and SEMANTIC — see below
  disabledReason?: string;
  submenu?: () => MenuPanel;         // opens an adjacent FLYOUT, at any depth
  onSelect?: () => void;
}

interface MenuSection {
  label?: string;
  action?: { label: string; onSelect: () => void };  // right-aligned bulk action, e.g. "Hide all"
  rows: MenuRow[];
}
interface MenuPanel {
  title?: string;
  columns?: 1 | 2;                                          // per-panel, not global
  search?: { placeholder: string; scope: "panel" | "section" };
  sections: MenuSection[];
  footer?: React.ReactNode;
}

interface MenuListProps { root: MenuPanel; onClose: () => void }
```

`disabled` is semantic, not cosmetic: "Relation" is greyed in Change type because a Text
property cannot convert to one. Conversion legality is a rule the UI expresses, and **our
backend has no endpoint describing it** — flagged as a possible backend sub-task, not
absorbed into M1.

**Search is scoped per section and can hide behind an icon.** In the type picker the
magnifier sits on the "Select type" *section header* and expands an input beneath it,
while the "AI Autofill" section above stays unfiltered. That expansion does not persist
reliably across reopens.

**Keyboard — partially established. Notion is not self-consistent.**
Confirmed with real key events: Escape cancels the new-property popover and discards the
typed name; Escape does **not** dismiss the create-database modal at all. We adopt
Escape-closes everywhere — the majority behaviour, and it matches our existing
`ConfirmDialog`/`PromptDialog` convention.

| Key | Behavior | Status |
|---|---|---|
| ↑ / ↓ | Move the active row; focus stays in the search input | **TBD** — not yet observed |
| ← / → | Move across columns in a 2-column panel | **TBD** |
| Enter | Activate the active row | **TBD** |
| Esc | Close, returning focus to the trigger | confirmed on the property popover |
| Tab | Close and return focus to the trigger | **TBD** |
| typing | Filters rows within the searchable section | confirmed |

### Panels are host-agnostic — keep them as data

Sort opened from the **toolbar** renders as an anchored popover. The *same* Sort opened
from **view settings** renders as a pushed sidebar panel — same placeholder, same
alphabetical list, same rows. Filter behaves the same way, and additionally renders from a
third host (the filter-bar chip).

So a panel's **content** is independent of its **container**. Build panels as `MenuPanel`
data and let the host decide whether to render it in a `Popover`, in the config sidebar's
panel stack, or as a flyout. Do **not** build a bespoke `FilterPopover` and a separate
`FilterSidebarPanel` — that is exactly how this codebase ended up with 40 native
`<select>` elements.

### The config sidebar — a third surface the design missed

`view-settings-sidebar.txt` and `relation-config-panel.txt` show the *same* container,
`notion-view-settings-sidebar`, **483px wide and docked right**, hosting both the view
settings panel and per-type property configuration. Notion reuses one sidebar and swaps
its contents rather than opening a bespoke popover per surface.

This breaks the clean "Popover+MenuList for menus, SidePeek for the row peek" split.
Either this becomes its own primitive (`ConfigSidebar`) or `SidePeek` grows a panel-stack
mode. 483px is a token, not a per-surface choice.

**RESOLVED 2026-08-29: the sidebar pushes.** Clicking "Property visibility" replaced the
sidebar's contents and rendered a back arrow (←) beside the panel title, × still top right.

So Notion uses **both** navigation models, chosen by host surface:

| Host | Sub-panel model |
|---|---|
| Column header menu (popover) | adjacent **flyout**, parent stays visible |
| Config sidebar (docked panel) | **push/pop** with a back arrow |

`MenuList` needs both as an explicit mode. Neither is "the" Notion pattern, and our
existing `TemplateManager`/`AutomationManager` push/pop matches the sidebar half.

**A consistent pattern worth copying, seen twice:** the entity's name is an *editable
input at the top of its own config panel*, with a leading icon button and a trailing ⓘ —
in the column header menu for a property, and in the view settings sidebar for a view.
There is no "Rename" row anywhere. We have no rename affordance at all for views or
databases (`ViewTabs` renders a bare button, `DatabaseShell.tsx:388` a static `<h1>`).

### `SidePeek`

Radix Dialog as a right-hand drawer. Resizable by dragging its left edge, width persisted.
Esc closes. URL-addressable via a search param so a peeked row is linkable and survives a
reload — today's `RowPeek` is none of these.

### `HoverAffordance`

`opacity-0 → 100` on the parent's `group-hover`, in a **reserved box** so revealing it
never reflows the row. Also reveals on `focus-visible`, so the affordance is reachable by
keyboard rather than mouse-only.

### `IconPicker`

Emoji grid, search over keyword tags, and a Remove action. Extends
`NoteEditorPage.tsx`'s existing curated list rather than introducing a second, divergent
emoji experience. Serves database, view and row icons.

### `DragHandle`

`@dnd-kit` wrapper used identically by row, property, column and group reordering, so the
drop-indicator treatment is defined once.

---

## 4. Migration path for the existing inline forms

The primitives land first (Phase 0) and nothing changes. Each surface then migrates within
its own milestone, so no milestone contains both a rewrite and a regression risk from
someone else's rewrite.

| Today | Becomes | Milestone |
|---|---|---|
| `TableView.tsx:652-802` — trailing-column add-property form, 5 `<select>` | Anchored New-property popover, searchable type list, per-type config sub-panel | M2 |
| `ViewTabs.tsx:171-259` — inline create form, native type `<select>`, group-by chosen up front | `+` popover with view-type cards; creates immediately; group-by configured afterwards in view options | M7 |
| `ButtonPropertyConfigPopover.tsx` — the one existing anchored popover | Re-based on `Popover` + `MenuList`; keeps its behavior | M1 |
| `RelationPicker.tsx:92-105` — `role="dialog"` + search over a filtered list | Re-based on `MenuList`; it is already the right shape | M11 |
| `ConfirmDialog`, `PromptDialog` | Re-based on Radix Dialog; call sites unchanged | Phase 0 |
| `DatabaseSettingsMenu.tsx` — 5-section `w-72` panel, 2 `<select>`, radios | Split: view-scoped rows move into the view options panel; database-scoped rows into the database `···` | Later phase |
| `AutomationEditor` (10 `<select>`), `ButtonActionChainEditor` (8) | `MenuList` pickers | Later phase |

The later-phase rows are listed so the count is honest: **40 native `<select>` elements
exist, and this phase removes roughly 13 of them.** The rest belong to surfaces outside
Table view and are scheduled, not forgotten.

---

## 5. Design tokens

Derived from the screenshots (`docs/ui-specs/screenshots/`), defined once in
`app/globals.css` and surfaced through `tailwind.config.ts`. Today `globals.css` defines
**five** CSS variables and the Tailwind config adds only `brand` and Inter — there is
effectively no token set for a popover to inherit, which is why every existing panel
hard-codes its own greys and radii.

| Token | Purpose | Light | Dark |
|---|---|---|---|
| `--menu-width-sm` / `-md` / `-lg` | Notion uses a small set of fixed menu widths | TBD | — |
| `--menu-max-height` | Before the list scrolls | TBD | — |
| `--menu-radius` | Popover corner radius | TBD | — |
| `--menu-shadow` | Popover elevation | TBD | TBD |
| `--menu-border` | Popover border | TBD | TBD |
| `--menu-bg` | Popover background | TBD | TBD |
| `--menu-row-height` | One icon+label row | TBD | — |
| `--menu-row-padding-x` | Row horizontal padding | TBD | — |
| `--menu-row-hover-bg` | Row hover fill | TBD | TBD |
| `--menu-icon-size` | Leading icon box | TBD | — |
| `--menu-section-gap` | Space around a section divider | TBD | — |
| `--menu-label-size` | Row label type | TBD | — |
| `--menu-hint-size` | Right-side hint/value type | TBD | — |
| `--menu-section-size` | Section header type | TBD | — |
| `--menu-disabled-opacity` | Disabled row treatment | TBD | — |
| `--popover-offset` | Gap between trigger and popover | TBD | — |

**No value is filled in from memory.** A token with no screenshot behind it stays `TBD`
and blocks the milestone that needs it.

---

## 6. Risks

1. **Radix portals escape the inline-database wrapper.** `DatabaseBlock.tsx:188-199`
   stops `mousemove` and `mouseup` propagation at its wrapper because BlockNote's
   `TableHandles` extension walks up from the hovered element to the first
   `<td>`/`<th>`/`.tableWrapper` ancestor, resolves to the non-table `database` block, and
   crashes with `Cannot read properties of undefined (reading 'rows')`. Radix renders
   popover content in a portal at the document root — **outside that wrapper** — so every
   popover opened from an inline database must be re-verified against that crash.
   Mitigation: Phase 0's acceptance includes opening a `MenuList` from inside an inline
   database and moving the mouse over it. If it reproduces, the fix is to portal into the
   wrapper via Radix's `container` prop rather than to re-add ad-hoc guards.
2. **Header chrome collision.** `STATUS.md` records that the `⚙` "Database settings"
   trigger already overlaps the AI-assistant toggle in the Workspaces shell. M7 adds more
   header chrome to the same row and must fix that layout rather than route around it.
3. **A `MenuList` that is really a combobox needs the right ARIA**, or it becomes less
   accessible than the native `<select>` it replaces. `role="combobox"` on the input with
   `aria-activedescendant` pointing at the active row — asserted in Phase 0's vitest
   coverage, not left to review.
4. **Bundle cost.** Three Radix packages are small individually; the check is that
   `npm run build` output does not regress meaningfully. Measured at Phase 0's exit.

---

## 7. What this design deliberately does not do

- It does not change the API layer. The mechanics are done. Four small backend gaps
  (view delete, database patch/delete, property description) are scoped as **Phase 0b**
  and named in the plan, rather than quietly widening this design.
- It does not touch the nine non-Table view types. The pattern is proven once on Table
  before being copied.
- It does not introduce a component library. Radix is positioning, focus and dismissal
  plumbing; every visual decision stays ours and comes from a screenshot.
