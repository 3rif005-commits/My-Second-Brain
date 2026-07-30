# Android Native Editor — Status

Last updated: 2026-05-15

---

## Architecture

The Android app uses a **native Jetpack Compose block editor** (NOT the old WebView/editor.html).
It reads/writes the same **BlockNote JSON** stored in `Note.content: JsonArray` — full round-trip
parity with the web app.

Plan file: `/home/ayoub/.claude/plans/agent-subagent-type-plan-model-opus-prom-bubbly-taco.md`

---

## Phases Complete

### Phase 1 — Data Model ✅
- `BlockType`, `BlockColor`, `CalloutColor`, `InlineStyles`, `StyleRun`, `MentionAnchor`
- `BlockState` with per-block `TextFieldState` + `SnapshotStateList<StyleRun>`
- `BlockNoteSerializer` (JSON ↔ `BlockModel`)
- `BlockStateBridge` (`BlockModel` ↔ `BlockState`, including style/mention round-trip)

### Phase 2 — Block Rendering ✅
All block types render correctly:
- `ParagraphBlock`, `HeadingBlock` (H1/H2/H3 + Toggle variants)
- `BulletListBlock`, `NumberedListBlock` (auto-numbered per indent level)
- `CheckListBlock` (toggleable checkbox)
- `QuoteBlock`, `CodeBlock`, `CalloutBlock`, `DividerBlock`
- `BlockRow` (handle column + content, drag-to-reorder via `sh.calvin.reorderable`)
- `BlockHandle` (drag handle + block actions menu)

### Phase 3 — Slash Menu + Mention Menu ✅
- `/` slash menu: opens on `/` typed, filters by query, selects block type on tap/Enter
- `@` mention menu: opens on `@` typed, fuzzy filters notes, inserts `@NoteName` mention
- `@NoteName` text is tappable — opens the referenced note (`LocalOpenNote` CompositionLocal)
- `RichInputTransformation`: handles Enter→split, Backspace→merge, `/`/`@` triggers

### Phase 4 — Inline Formatting ✅
- `StyleOps`: range shift math for insert/delete, `applyToRange`, `canonicalize`
- `InlineRichTextEngine`: `toggleBold/Italic/Underline/Strike`, pending marks on collapsed cursor
- `StyledTextOverlay`: transparent-input-over-styled-`BasicText` overlay pattern
- `FormatToolbar`: B/I/U/S + H1/H2/• buttons, appears on text selection

### Phase 5 — Toggle Blocks ✅
- `ToggleBlock.kt`: chevron animates 90° on expand/collapse, `AnimatedVisibility` for body
- `BlockState.bodyBlock` lazily created if absent (new toggles created via slash menu)
- Enter on summary → opens toggle + focuses body; Enter in body → new paragraph after toggle
- Body text changes observed by `LaunchedEffect` → `vm.markDirty()` (body not in `vm.blocks`)
- `BlockRow.kt`: all four toggle types routed through `ToggleBlock`
- `BlockTextField.kt`: `onSplitOverride` parameter for custom Enter behavior
- `DocumentViewModel.findBlock()`: searches body blocks too (fixes inline formatting in bodies)
- Toggle open/close state now persists (calls `markDirty()`)

### Phase 6 — Block Handle + Actions ✅ (built before this session)
- Drag handle with `ReorderableItem`
- Block actions menu: change type, set color, duplicate, delete

### Performance Fixes ✅ (applied this session)
- `derivedStateOf` in `BlockHandle` and `BlockRow` — eliminates O(n) recompositions on focus/select change
- Removed `height(IntrinsicSize.Min)` from `BlockRow` — single layout pass per item
- `derivedStateOf` for `hasFocusedSelection` in `BlockEditor` — no recompose on every cursor move
- **Keyboard architecture**: `imePadding()` moved to a separate overlay Box (for menus only).
  `LazyColumn` uses `contentPadding = ime.union(navBars).bottom` — height never changes during
  keyboard animation. Zero per-frame re-layout during keyboard open/close.
- `WindowCompat.setDecorFitsSystemWindows(window, false)` + `statusBarsPadding()` — edge-to-edge
- `RichInputTransformation` + `StyleOps` guards: skip style shifts for plain-text blocks

---

## Phases Remaining

### Phase 5 — Toggle Blocks ❌
`ToggleBlock.kt` is NOT built. Toggle-type blocks (`ToggleH1`, `ToggleH2`, `ToggleH3`,
`ToggleListItem`) currently fall back to `ParagraphBlock` / `HeadingBlock` and the toggle
body (`BlockState.bodyBlock`) is ignored.

Needs:
- `ToggleBlock.kt`: clickable chevron to expand/collapse, `AnimatedVisibility` for body
- `BlockState.bodyBlock: BlockState?` already exists (wired in `BlockStateBridge`)
- `DocumentViewModel.setToggleOpen(blockId, open)` already exists
- `BlockRow.kt`: route all toggle types through `ToggleBlock` instead of fallback
- Serialization: already handles toggle children in `BlockStateBridge`

### Phase 7 — Color Picker ✅
- `ColorPickerSheet.kt`: `ModalBottomSheet` with 2×5 grid of color swatches (all 10 `BlockColor` values)
- `EditorColors.swatchColor()`: full-opacity palette colors for swatch rendering
- `BlockActionsMenu`: inline color grid at bottom (2 rows of 5 swatches, no nested sheet)
- `FormatToolbar`: colored-circle button opens `ColorPickerSheet`; `findBlock()` fixes toolbar for toggle bodies
- `DocumentViewModel.insertNewBlock()`: now accepts `initialText` (used by toggle body Enter split)

---

## Key File Locations

```
editor/
  DocumentViewModel.kt          — block list, focus, menus, save loop
  model/
    BlockState.kt               — per-block live state
    BlockType.kt, BlockColor.kt, etc.
  rich/
    RichInputTransformation.kt  — Enter/Backspace/slash/@ in InputTransformation
    StyleOps.kt                 — range shift math for styles + mentions
    InlineRichTextEngine.kt     — toggle bold/italic/underline/strike
    StyledTextOverlay.kt        — derivedStateOf AnnotatedString overlay
  serialization/
    BlockNoteSerializer.kt      — JSON ↔ BlockModel
    BlockStateBridge.kt         — BlockModel ↔ BlockState
  ui/
    BlockEditor.kt              — LazyColumn + keyboard/menu architecture
    BlockRow.kt                 — Row per block (handle + content)
    EditorLocals.kt             — LocalNumberedListIndex, LocalOpenNote
    NativeBlockEditor.kt        — entry point, CompositionLocalProvider
    blocks/
      BlockTextField.kt         — BasicTextField + overlay + mention tap
      ParagraphBlock.kt, HeadingBlock.kt, BulletListBlock.kt, ...
    handle/
      BlockHandle.kt            — drag handle icon, derivedStateOf focus
    menus/
      SlashMenu.kt, MentionMenu.kt, FormatToolbar.kt, BlockActionsMenu.kt
```

---

## Keyboard / IME Architecture (important — do not revert)

```
Box(fillMaxSize)                         ← BlockEditor root, NO imePadding
  ├─ LazyColumn(
  │    contentPadding = ime∪navBar.bottom  ← scrolls content above keyboard
  │    fillMaxSize                          ← height NEVER changes
  │  ) { blocks }
  └─ Box(fillMaxSize + imePadding)        ← overlay ONLY, no list inside
       ├─ SlashMenuPanel  (BottomStart)   ← sits above keyboard
       ├─ MentionMenuPanel(BottomStart)
       └─ FormatToolbar   (BottomCenter)
```

`WindowCompat.setDecorFitsSystemWindows(window, false)` in `MainActivity` is required
for `imePadding()` and `WindowInsets.ime` to receive values from the system.
