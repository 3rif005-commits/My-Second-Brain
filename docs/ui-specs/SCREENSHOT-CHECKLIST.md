# Screenshot Checklist — real Notion

Everything here is captured **in Notion**, not in our app. These become the visual ground
truth the specs are written against, and the reference the per-milestone visual diff is
run against later.

**Save to:** `docs/ui-specs/screenshots/` — filename exactly as given, e.g. `03-header-menu-text.png`.

---

## How to capture

- **Browser, not the desktop app.** The DOM half of this work needs the same tab via the
  Chrome extension, and the desktop app is unreachable from it.
- **Window ~1440px wide, browser zoom 100%.** Widths are measured off these shots; a
  zoomed shot makes every derived number wrong.
- **Capture the trigger too, not just the popover.** Crop a region that includes the thing
  you clicked plus ~100px of surroundings. The gap between trigger and popover is a
  spec value I cannot recover from a tightly-cropped menu.
- **Light mode** for everything except §17.
- **Full menu, not a crop of it.** If a menu scrolls, take one shot at the top and one
  scrolled to the bottom — both are listed where they apply.
- Don't tidy the fixture between shots. Half-filled rows and empty cells are the point.

**Priority:** **P1** = required, the spec cannot be written without it. **P2** = fills in
detail; capture if you have the patience. P1 alone is 87 shots.

**Capture in milestone order.** §1–§3 unblock the first three milestones — once those are
in, I can start writing specs while you continue.

---

## §0 — Fixture setup (do this first, no shots)

Everything below refers to this fixture, so nothing depends on what happens to be in your
workspace.

1. Create a full-page database named **`Parity Fixture`**.
2. Create a second small database named **`Parity Fixture — Related`** with 3 rows. This
   is only the relation target.
3. On `Parity Fixture`, add one property of **each** of these types, named after the type
   so the shots are self-describing:
   `Text`, `Number`, `Select`, `Multi-select`, `Status`, `Date`, `Person`,
   `Files & media`, `Checkbox`, `URL`, `Email`, `Phone`, `Formula`, `Relation`
   (→ `Parity Fixture — Related`), `Rollup` (through that relation), `Created time`,
   `Created by`, `Last edited time`, `Last edited by`, `ID`, `Button`.
4. Give `Select` and `Status` **at least 4 options each, in different colours**, and give
   `Status` options spread across all three status groups (To-do / In progress / Complete).
5. Add **8 rows**. Fill most cells, but deliberately leave **at least one cell of every
   type empty** — the empty-cell rendering is a spec item.
6. Turn on **sub-items** and give one row two children.
7. Turn on **dependencies**.
8. Add a **second view**, a Table named `Filtered`, with: two filters, one sort, and
   grouping by `Select`. Leave one group empty so the hidden/empty-group behavior is
   visible.
9. Add a **third view**, a Board grouped by `Status`. (Only so the view bar has three tabs
   and the `+` menu has context — no Board shots are needed this phase.)
10. Add **one row template** named `Template A`.

---

## §1 — Table column header menu  → milestone M1  (8 shots)

- [ ] **01** · P1 — Hover the `Text` column header, don't click. → the header in its hover
      state, showing whatever appears → `01-header-hover.png`
- [ ] **02** · P1 — Click the `Text` column header to open its dropdown. → the whole menu,
      top of list, trigger visible → `02-header-menu-text.png`
- [ ] **03** · P1 — Same menu, scrolled to the bottom. If it doesn't scroll, retake 02 and
      name it 03 too. → `03-header-menu-text-bottom.png`
- [ ] **04** · P1 — In that menu, open **Edit property**. → the edit sub-panel, its back
      arrow and title visible → `04-header-edit-property.png`
- [ ] **05** · P1 — From there, open the **property type** picker. → the searchable type
      list, top → `05-type-picker-top.png`
- [ ] **06** · P1 — Same type picker, scrolled to the bottom. → `06-type-picker-bottom.png`
- [ ] **07** · P1 — Open the header menu on the **`Name` (title)** column. Its options
      differ. → `07-header-menu-title.png`
- [ ] **08** · P2 — Open the header menu on the **`Formula`** column. → `08-header-menu-formula.png`

## §2 — Property creation and editing  → M2  (8 shots)

- [ ] **09** · P1 — Hover the `+` at the far right of the header row. → `09-add-property-hover.png`
- [ ] **10** · P1 — Click it. → the New-property popover, type list at top → `10-new-property-top.png`
- [ ] **11** · P1 — Same popover, scrolled to the bottom. → `11-new-property-bottom.png`
- [ ] **12** · P1 — Type `sel` into its search field. → the filtered list → `12-new-property-search.png`
- [ ] **13** · P1 — Pick **Select**. → whatever config panel appears next → `13-new-property-select-config.png`
- [ ] **14** · P1 — Open **Edit property** on the existing `Select` column and get to its
      **options list**. → the full options editor → `14-edit-select-options.png`
- [ ] **15** · P1 — Open the colour picker for one option. → `15-option-colour-picker.png`
- [ ] **16** · P2 — Get to the property **Description** field and type into it. →
      `16-property-description.png`

## §3 — View options `···` panel  → M3  (7 shots)

- [ ] **17** · P1 — Hover the `···` at the right of the view bar. → `17-view-options-hover.png`
- [ ] **18** · P1 — Click it. → the whole panel, top → `18-view-options-top.png`
- [ ] **19** · P1 — Same panel, scrolled to the bottom. → `19-view-options-bottom.png`
- [ ] **20** · P1 — Open its **Properties** sub-panel. → the full property list with its
      shown/hidden sections and toggles → `20-view-properties.png`
- [ ] **21** · P1 — Open its **Layout** sub-panel. → `21-view-layout.png`
- [ ] **22** · P1 — Open **Open pages in**. → `22-open-pages-in.png`
- [ ] **23** · P2 — Open **Load limit**. → `23-load-limit.png`

## §4 — Filter  → M4  (8 shots)

- [ ] **24** · P1 — On the `Filtered` view, open the **Filter** entry point. → the property
      picker it opens with → `24-filter-property-picker.png`
- [ ] **25** · P1 — The view bar with its two filters already applied. → the chips row →
      `25-filter-bar-applied.png`
- [ ] **26** · P1 — Click one applied filter chip. → its editor popover → `26-filter-chip-editor.png`
- [ ] **27** · P1 — Open the **operator** dropdown inside it. → the full operator list →
      `27-filter-operators.png`
- [ ] **28** · P1 — Open the **value** picker for a `Select` filter. → `28-filter-value-select.png`
- [ ] **29** · P1 — Open the operator list for a **Date** filter — it's a different set. →
      `29-filter-operators-date.png`
- [ ] **30** · P1 — Get to **advanced filters** (nested groups). → the advanced panel →
      `30-filter-advanced.png`
- [ ] **31** · P1 — Build one nested group — an `OR` inside an `AND`. → the nesting, its
      indentation and its AND/OR toggles → `31-filter-nested-group.png`

## §5 — Sort  → M5  (4 shots)

- [ ] **32** · P1 — Open **Sort** on a view with no sort yet. → the property picker →
      `32-sort-empty.png`
- [ ] **33** · P1 — With one sort applied. → the asc/desc control → `33-sort-one.png`
- [ ] **34** · P1 — With two sorts applied. → the multi-level list with its drag handles →
      `34-sort-multi.png`
- [ ] **35** · P2 — Mid-drag while reordering the two sorts. → the drop indicator →
      `35-sort-dragging.png`

## §6 — Group  → M6  (6 shots)

- [ ] **36** · P1 — Open **Group** on an ungrouped view. → the property picker → `36-group-empty.png`
- [ ] **37** · P1 — On the grouped `Filtered` view, open the group settings panel. → all of
      its toggles → `37-group-settings.png`
- [ ] **38** · P1 — Open **Sub-group**. → `38-subgroup.png`
- [ ] **39** · P1 — The grouped table itself. → group headers, their counts, collapse arrows,
      and each group's own `+` → `39-grouped-table.png`
- [ ] **40** · P1 — One group collapsed. → `40-group-collapsed.png`
- [ ] **41** · P1 — The **hidden groups** area, with the empty group in it. → `41-hidden-groups.png`

## §7 — View tab bar  → M7  (7 shots)

- [ ] **42** · P1 — The whole view bar, three tabs, one active. → `42-view-bar.png`
- [ ] **43** · P1 — Hovering an inactive tab. → `43-view-tab-hover.png`
- [ ] **44** · P1 — A view's own `···` menu. → the whole menu → `44-view-tab-menu.png`
- [ ] **45** · P1 — Its **Rename** state. → `45-view-rename.png`
- [ ] **46** · P1 — The `+` (new view) menu. → the view-type cards, top → `46-new-view-top.png`
- [ ] **47** · P1 — Same, scrolled to the bottom. → `47-new-view-bottom.png`
- [ ] **48** · P2 — A view's icon picker. → `48-view-icon-picker.png`

## §8 — Database header and creation  → M8  (7 shots)

- [ ] **49** · P1 — The full-page database header at rest — icon, title, description. →
      `49-db-header.png`
- [ ] **50** · P1 — Hovering just above the title, where **Add icon / Add cover / Add
      description** appear. → `50-db-header-hover.png`
- [ ] **51** · P1 — The icon picker open on its emoji tab, with something typed into its
      search. → `51-db-icon-picker.png`
- [ ] **52** · P1 — The description being edited. → `52-db-description-editing.png`
- [ ] **53** · P1 — The page-level `···` at the top right of the database page. → the whole
      menu → `53-db-page-menu.png`
- [ ] **54** · P1 — In any note, type `/database` in the slash menu. → the matching entries →
      `54-slash-database.png`
- [ ] **55** · P2 — An **inline** database inside a page. → its header and how it differs
      from the full-page one → `55-inline-database.png`

## §9 — Row hover affordances  → M9  (6 shots)

- [ ] **56** · P1 — A row at rest, pointer well away from the table. → `56-row-rest.png`
- [ ] **57** · P1 — The same row hovered. → everything that appeared: drag handle, `+`,
      checkbox, the OPEN button → `57-row-hover.png`
- [ ] **58** · P1 — That row's `⋮⋮` menu, top. → `58-row-menu-top.png`
- [ ] **59** · P1 — Same menu, scrolled to the bottom. → `59-row-menu-bottom.png`
- [ ] **60** · P1 — Its **Open in** sub-panel (side peek / centre peek / full page). →
      `60-row-open-in.png`
- [ ] **61** · P1 — Two rows selected via their checkboxes. → the bulk action bar →
      `61-rows-selected.png`

## §10 — Row peek  → M10  (7 shots)

- [ ] **62** · P1 — A row opened as a **side peek**. → the whole panel, its left edge and
      the table behind it → `62-peek-side.png`
- [ ] **63** · P1 — Its header bar alone, close-cropped. → every control in it →
      `63-peek-header.png`
- [ ] **64** · P1 — The peek's `···` menu. → `64-peek-menu.png`
- [ ] **65** · P1 — Its property list, including the **`+ Add a property`** row. →
      `65-peek-properties.png`
- [ ] **66** · P1 — One property row in the peek, hovered. → its own affordances →
      `66-peek-property-hover.png`
- [ ] **67** · P1 — The same row opened as a **centre peek**. → `67-peek-centre.png`
- [ ] **68** · P2 — The peek scrolled to its comments area. → `68-peek-comments.png`

## §11 — Calculations row  → M11  (4 shots)

- [ ] **69** · P1 — The table's footer row at rest, then hovered under one column. →
      `69-calc-row-hover.png`
- [ ] **70** · P1 — The calculate menu open, top. → `70-calc-menu-top.png`
- [ ] **71** · P1 — Same menu, scrolled to the bottom — the full function list matters. →
      `71-calc-menu-bottom.png`
- [ ] **72** · P1 — A calculation applied. → how the value and its label render →
      `72-calc-applied.png`

## §12 — `+ New` and templates  → M11  (3 shots)

- [ ] **73** · P1 — The footer `+ New` row, hovered. → `73-new-row.png`
- [ ] **74** · P1 — Its dropdown half opened. → the template list, including the
      `New template` row → `74-new-row-templates.png`
- [ ] **75** · P2 — The template management menu. → `75-template-menu.png`

## §13 — Context menus  → M11  (3 shots)

- [ ] **76** · P1 — Right-click a **cell**. → `76-context-cell.png`
- [ ] **77** · P1 — Right-click a **row**. → `77-context-row.png`
- [ ] **78** · P2 — Right-click a **column header**. → `78-context-header.png`

## §14 — Resize and drag  → M11  (4 shots)

- [ ] **79** · P1 — Hovering the border between two column headers. → the grip and the
      cursor → `79-resize-hover.png`
- [ ] **80** · P1 — Mid-resize, button held. → the guide line → `80-resize-dragging.png`
- [ ] **81** · P1 — Mid-drag of a **column**. → the drop indicator → `81-column-dragging.png`
- [ ] **82** · P1 — Mid-drag of a **row**. → the drop indicator → `82-row-dragging.png`

## §15 — Cell editing, per type  → M11  (10 shots)

One shot each, cell in its **open/editing** state, the cell itself visible.

- [ ] **83** · P1 — `Text`, expanded → `83-cell-text.png`
- [ ] **84** · P1 — `Number` → `84-cell-number.png`
- [ ] **85** · P1 — `Select`, picker open → `85-cell-select.png`
- [ ] **86** · P1 — `Multi-select`, with two values already chosen → `86-cell-multiselect.png`
- [ ] **87** · P1 — `Status`, picker open, showing its three groups → `87-cell-status.png`
- [ ] **88** · P1 — `Date`, calendar open, with **end date** and **reminder** visible →
      `88-cell-date.png`
- [ ] **89** · P1 — `Relation`, search popover open → `89-cell-relation.png`
- [ ] **90** · P2 — `Person`, picker open → `90-cell-person.png`
- [ ] **91** · P2 — `Files & media`, picker open → `91-cell-files.png`
- [ ] **92** · P2 — `URL`, hovered, showing its link affordances → `92-cell-url.png`

## §16 — States  → M11  (5 shots)

- [ ] **93** · P1 — A **brand new** empty database, no rows and no extra properties. →
      `93-state-new-database.png`
- [ ] **94** · P1 — A view whose filter matches **nothing**. → the whole content area →
      `94-state-no-results.png`
- [ ] **95** · P1 — An **empty group** in the grouped view. → `95-state-empty-group.png`
- [ ] **96** · P2 — A view with several properties **hidden**. → `96-state-hidden-properties.png`
- [ ] **97** · P2 — A loading state, if you can catch one on a hard reload. →
      `97-state-loading.png`

## §17 — Dark mode  (4 shots)

Switch Notion to dark and retake just these. They exist to derive the dark half of the
token set, nothing more.

- [ ] **98** · P1 — The table itself → `98-dark-table.png`
- [ ] **99** · P1 — A column header menu open → `99-dark-header-menu.png`
- [ ] **100** · P1 — The view options panel open → `100-dark-view-options.png`
- [ ] **101** · P1 — A side peek open → `101-dark-peek.png`

---

**P1: 87 · P2: 14 · 101 shots total.**
If you only do §0–§3 (23 shots), I can start writing M1–M3's specs immediately.
