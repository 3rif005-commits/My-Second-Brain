# Android Parity — Web ↔ Android Feature Gap Tracker

> Load this file at the start of every Android parity conversation.
> Last updated: 2026-05-15

---

## How to use this file

1. Pick a group (start with P1).
2. Read the "Android target" and "Notes" for each item.
3. Implement. Mark `[x]` when done and add the date.
4. Commit with `feat(android):` prefix.

---

## Core Principle — Prompt Independence

**The editor must not be coupled to any specific prompt format.**

The wrong approach: "the mastery guide generates `<details>` tags, so the editor handles `<details>`."
The right approach: "toggle is a standard block type — any content source may produce one."

When a prompt changes, only the HTML→blocks ingest parser changes. The editor itself handles
all block types regardless of where the content came from. This means:

- Block types are defined by **what the editor supports**, not by what any prompt outputs.
- The HTML parser (used during ingest) must handle **standard HTML semantics** (e.g., `<details>`,
  `<blockquote>`, `<ul>`, `<ol>`, `<pre>`) not prompt-specific class names or attributes.
- The JSON storage format is **BlockNote JSON** — the stable contract between all layers.
  Prompt output → parser → BlockNote JSON → editor. Only the first arrow changes with the prompt.

Concretely: if tomorrow you change the mastery prompt to output toggles as `<section class="collapsible">`,
only the ingest HTML parser needs updating. The editor already handles the `toggle` block type and
will continue to display any note that has one — from any source.

---

## Architecture

**Web app:** Next.js + BlockNote (React) + Supabase + FastAPI backend
**Android:** Jetpack Compose + custom WebView editor (`editor.html`) + Supabase Kotlin SDK + LiteRT

The custom `editor.html` is a lightweight JS block editor — no React, no BlockNote npm package.
It reads and writes **BlockNote-compatible JSON** so notes round-trip correctly between web and Android.

Block types currently in `editor.html`: paragraph, h1, h2, h3, bullet, numbered, quote, code, @mention.
Block types in the web app but **missing** from `editor.html`: toggle, callout, divider, interactive.

---

## P1 — Blocking (core note-taking parity)

### 1. Toggle / Collapsible blocks
- **Web:** Toggle is a first-class block type in the BlockNote schema. Any content source
  (manual user input, ingest, copy-paste) can create one via the `/toggle` slash command or
  the toolbar. Stored as `{ type: "toggle", ... }` in BlockNote JSON.
- **Android:** `editor.html` has no toggle type. Any note containing toggle blocks shows them
  as plain paragraphs.
- **Android target:** Add toggle as a first-class block type in `editor.html`:
  - Slash menu: `{ type:'toggle', icon:'▶', label:'Toggle', desc:'Collapsible section' }`
  - `mkBlock('toggle')`: render `<details><summary contenteditable>Title</summary><div class="toggle-body" contenteditable>Content</div></details>`
  - `setContent()`: map BlockNote JSON `type === "toggle"` → toggle block. Also map `type === "details"` if it appears.
  - `getJson()`: serialize toggle back to `{ type: "toggle", props: {}, content: [...summary...], children: [...body...] }`
  - CSS: style `<details>` with a custom triangle marker, indented body
- **Files:** `assets/editor.html`
- [x] Done 2026-05-13

### 2. Callout blocks
- **Web:** Callout is a first-class block type. User creates one via `/callout` in the slash
  menu. Color variants: blue, red, orange, green, purple. Stored as
  `{ type: "callout", props: { backgroundColor: "blue" }, ... }`.
- **Android:** No callout type. Callout blocks from web notes show as plain paragraphs.
- **Android target:**
  - Slash menu: `{ type:'callout', icon:'💡', label:'Callout', desc:'Highlighted note' }`
  - `mkBlock('callout')`: `<div class="block callout" data-color="blue" contenteditable>...</div>`
  - `setContent()`: map `type === "callout"` → callout block, read `props.backgroundColor` → `data-color`
  - `getJson()`: serialize to `{ type: "callout", props: { backgroundColor: d.dataset.color || "blue" }, ... }`
  - CSS: colored left border + faint background tint for each color variant
  - Color picker: tapping the callout shows a small color row (blue / red / orange / green / purple)
- **Files:** `assets/editor.html`
- [x] Done 2026-05-13

### 3. Sidebar — collapsible
- **Web:** Sidebar collapses to zero width with animation; state persisted. On mobile it is
  hidden by default and slides in on tap.
- **Android:** Sidebar is hardcoded `width(260.dp)` in `MainScreen.kt:162`. Always visible.
- **Android target:** Add a hamburger toggle button in the top bar of the content pane.
  Use `AnimatedVisibility` or animated `width` on the sidebar `Modifier`. Persist collapsed
  state in `SharedPreferences`. Default to expanded on tablet, collapsed on phone.
- **Files:** `MainScreen.kt`, `Sidebar.kt`
- [x] Done 2026-05-15

### 4. Trash — soft delete with restore
- **Web:** Delete button sets `deleted_at = NOW()` (soft delete). Sidebar has a "Trash" section
  showing soft-deleted notes. Trash items have Restore + Delete Forever buttons.
- **Android:** Need to verify — if `NotesRepository.deleteNote()` does a hard delete, notes are
  lost permanently. No trash section in sidebar.
- **Android target:**
  - `NotesRepository.deleteNote(id)` → PATCH `deleted_at = now()` (not hard delete)
  - `NotesRepository.listNotes()` → must filter `deleted_at IS NULL`
  - Add `NotesRepository.listTrashed()` → filter `deleted_at IS NOT NULL`
  - Add `NotesRepository.restoreNote(id)` → PATCH `deleted_at = null`
  - Add `NotesRepository.permanentDelete(id)` → hard delete
  - `Sidebar.kt`: add collapsible "Trash" section at the bottom with restore / delete-forever on long press
- **Files:** `NotesRepository.kt`, `Sidebar.kt`, `MainScreen.kt`
- [x] Done 2026-05-14

### 5. Backlinks panel
- **Web:** Bottom of each note: "Referenced by N notes" — clicking opens that note.
- **Android:** Not in `NoteEditorPane.kt`.
- **Android target:** Below the WebView in `NoteEditorPane`, add a composable `BacklinksSection`:
  - Query Supabase: scan all user notes' `content` JSONB for `mention` blocks with `noteId = currentId`
  - Or call the web backend: `GET /api/notes/[noteId]/backlinks` (already built)
  - Show "Referenced by N notes" header (collapsible). Each row: icon + title, tap → `onOpenNote(id)`
- **Files:** `NoteEditorPane.kt`, `NotesRepository.kt`, `NotesLocalStore.kt`
- [x] Done 2026-05-15

### 6. Export to Markdown
- **Web:** "Export MD" button → BlockNote serializes to Markdown → browser downloads `.md` file.
- **Android:** No export.
- **Android target:** Add "Export MD" to the overflow menu in `NoteEditorPane`.
  Call `webView.evaluateJavascript("getMd()", ...)` where `getMd()` is a JS function in
  `editor.html` that converts current blocks to Markdown text (simple map: h1→`# `, bullet→`- `, etc.)
  Then share via Android share sheet as `text/plain`.
- **Files:** `NoteEditorPane.kt`, `editor/serialization/MarkdownSerializer.kt`
- [x] Done 2026-05-15

### 7. Export to PDF
- **Web:** "Export PDF" — browser `window.print()` with print stylesheet.
- **Android target:** Add "Export PDF" to the overflow menu. Use the WebView's built-in print API:
  ```kotlin
  val adapter = webView.createPrintDocumentAdapter(note.title)
  val manager = getSystemService(PrintManager::class.java)
  manager.print(note.title, adapter, PrintAttributes.Builder().build())
  ```
- **Files:** `NoteEditorPane.kt`, `editor/serialization/HtmlSerializer.kt`
- [x] Done 2026-05-15

---

## P2 — Important UX

### 8. Breadcrumb navigation
- **Web:** Top of editor: `My Brain › [Collection] › [Note Title]`
- **Android:** Title field only — no location context.
- **Android target:** Add a single row above the title field: `🧠 Second Brain  ›  [Note Title]`.
  Keep it read-only for now (collection support is item #12).
- **Files:** `NoteEditorPane.kt`
- [x] Done 2026-05-15

### 9. Topic filter — tap topic to filter notes
- **Web:** Tapping a topic chip in the properties panel filters the note list.
- **Android:** Topics are shown and editable in `NotePropertiesDialog` but tapping them does nothing.
- **Android target:** When a topic chip is tapped, call a callback `onFilterByTopic(topic)` that
  passes the string up to `MainScreen`. `MainScreen` keeps a `filterTopic: String?` state that
  filters `notes` in the sidebar. Show a `"Topic: X  ×"` chip at the top of the sidebar to clear
  the filter.
- **Files:** `MainScreen.kt`, `Sidebar.kt`, `NotePropertiesDialog.kt`
- [x] Done 2026-05-15

### 10. Slash menu — missing block types
- Follows from items #1 and #2 — once toggle and callout exist, add them to the slash menu.
- Also add: `divider` → renders as `<hr>`, not editable, serializes as `{ type: "separator" }`.
- **Files:** `assets/editor.html`
- [x] Done 2026-05-13

### 11. Slash and @ triggers — Android soft keyboard fix
- **Web:** Typing `/` or `@` opens the slash / mention menu.
- **Android:** On Android's soft keyboard, `ev.key` is `'Unidentified'` or `'Process'` — so
  `if (ev.key === '/')` and `if (ev.key === '@')` never fire. This is the root cause of
  "/ and @ not working on Android."
- **Android target:** Move trigger detection from `keydown` to the `input` event:
  ```js
  // Replace the current input listener in wire(d) with:
  d.addEventListener('input', function() {
    var t = d.innerText;
    if (t.endsWith('/'))  { setTimeout(function() { trySlash(d); }, 0); }
    if (t.endsWith('@'))  { setTimeout(function() { tryMent(d);  }, 0); }
    syncEmpty(d);
    schedSave();
  });
  ```
  Keep the `keydown` listener for keyboard navigation (arrows, enter, escape inside the menus).
- **Files:** `assets/editor.html`
- **Note:** This is a quick one-file fix that unblocks the two most-used editor features.
- [x] Done 2026-05-13

### 12. Dark / Light mode toggle
- **Web:** Toggle in sidebar footer, persisted to `localStorage`.
- **Android target:** sun/moon icon in sidebar footer; `SecondBrainTheme` switches color scheme; `EditorTypography` uses `@Composable` property getters backed by `MaterialTheme.colorScheme`; all main surface backgrounds use `MaterialTheme.colorScheme.*`; sidebar is always dark (hardcoded `Slate900`) matching web.
- **Files:** `SecondBrainTheme.kt`, `Sidebar.kt`, `MainScreen.kt`, `MainActivity.kt`, `EditorTypography.kt`, `BlockTextField.kt`, `NoteEditorPane.kt`, `SearchDialog.kt`, `InteractiveBlock.kt`, `BlockRow.kt`, `FormatToolbar.kt`, `BlockHandle.kt`, `BlockActionsMenu.kt`, `ChatPane.kt`
- [x] Done 2026-05-15 (full theme-aware implementation, all editor surfaces and chat pane fixed 2026-05-15)

### 13. Collections / folder grouping in sidebar
- **Web:** Notes grouped under collections (folders) in the sidebar.
- **Android:** Flat list — all notes in one "NOTES" section.
- **Android target (minimal):** Fetch collections from Supabase. Group notes by `collection_id`
  in the sidebar. Show collection name as a section header with an expand/collapse toggle.
  Uncollected notes go in a "Notes" section. No create/rename/delete collections for now.
- **Files:** `Sidebar.kt`, `NotesRepository.kt`, `Note.kt`, `Collection.kt`, `NotesDatabase.kt`, `NotesLocalStore.kt`, `SyncManager.kt`, `MainScreen.kt`
- [x] Done 2026-05-15 — local collections table (DB v2 migration), syncs from Supabase in SyncManager, sidebar groups by collection_id with expand/collapse, uncollected notes in NOTES section (reorderable)

---

## P3 — Polish

### 14. Drag-to-reorder notes in sidebar
- **Web:** @dnd-kit drag-to-reorder. PATCH updates `position` on affected rows.
- **Android target:** Add `sh.calvin.reorderable:reorderable` to `build.gradle.kts`.
  Wrap the `LazyColumn` in `Sidebar.kt` with `ReorderableColumn`. On drag end, call
  `NotesRepository.updatePositions(orderedIds)`.
- **Files:** `Sidebar.kt`, `NotesRepository.kt`, `build.gradle.kts`
- [x] Done 2026-05-15

### 15. Public share link
- **Web:** "Share" button sets `is_public=true`, copies `/share/[noteId]` to clipboard.
- **Android target:** Add "Share link" to the overflow menu. PATCH `is_public=true` via
  Supabase. Build URL `https://[web-app-domain]/share/[noteId]`. Copy to clipboard + open
  Android share sheet.
- **Files:** `NoteEditorPane.kt`, `NotesRepository.kt`
- [x] Done 2026-05-15

### 16. Interactive / canvas blocks
- **Web:** Canvas blocks stored in `localStorage` (key: `interactive-${noteId}`), NOT in BlockNote JSON. The Android implementation stores them IN the BlockNote JSON as `{ type: "interactive", props: { html: "..." } }` which is the correct long-term design.
- **Android target (done):** `/canvas` slash command creates a Canvas Block. Empty block shows two options: "🤖 Ask AI" (calls local Gemma at `localhost:8082`, generates self-contained HTML quiz/widget) and "📋 Paste HTML" (raw code editor). Once set, HTML renders in a WebView. `htmlContent` is mutable state so updates trigger recompose.
- **Files:** `BlockType.kt`, `BlockModel.kt`, `BlockState.kt`, `BlockNoteSerializer.kt`, `BlockStateBridge.kt`, `BlockRow.kt`, `InteractiveBlock.kt`, `DocumentViewModel.kt`, `SlashItems.kt`
- [x] Done 2026-05-15

### 17. Note properties — source info
- **Web:** Properties panel shows `source_type`, `source_filename` / `source_url`, `created_at`.
- **Android:** `NotePropertiesDialog` shows mastery + topics only.
- **Android target:** Add a "Source" row to `NotePropertiesDialog`: badge for `source_type`
  (PDF / URL / manual), filename or URL text, created date. Read-only.
- **Files:** `NotePropertiesDialog.kt`, `Note.kt`
- [x] Done 2026-05-15

---

## P4 — Defer

### 18. Multi-column layout
- **Web:** `@blocknote/xl-multi-column` — slash `/column` splits content side by side.
- **Android target:** Flatten multi-column blocks to sequential blocks on load (acceptable
  degradation). Full multi-column support in a WebView contenteditable is not worth the effort.
- [x] Done 2026-05-15 — columnList blocks flattened in BlockNoteSerializer.deserialize()

### 19. Full-text search — verify backend used
- **Web:** Uses PostgreSQL `tsvector` ranked search (migration 006).
- **Android:** Local SQLite search is always run first (searches both `title` AND `content_text`). Supabase PLAINTO FTS results are merged on top (deduped by ID). Partial-word searches always hit local LIKE immediately.
- **Files:** `SearchDialog.kt`, `NotesRepository.kt`, `NotesLocalStore.kt`
- [x] Done 2026-05-15

---

## Implementation Priority Order

```
#11   (/ and @ keyboard fix)         — 15 min, unblocks daily use immediately
#1    (toggle blocks)                 — core block type, editor completeness
#2    (callout blocks)                — core block type, editor completeness
#10   (slash menu: toggle+callout+divider) — follows #1 + #2
#4    (trash + soft delete)           — data safety
#3    (collapsible sidebar)           — screen real estate
#6    (export markdown)               — quick win
#7    (export PDF)                    — quick win
#8    (breadcrumbs)                   — orientation
#5    (backlinks)                     — LINK pillar
#9    (topic filter)                  — discovery
#12   (dark/light mode)               — polish
#13   (collections in sidebar)        — structure
#14   (drag to reorder)               — polish
#15   (share link)                    — sharing
#16   (interactive blocks)            — AI pillar
#17   (source info in properties)     — polish
#18   (multi-column)                  — accepted degradation
#19   (verify full-text search)       — verify only
```

---

## Shared Backend / Supabase — no changes needed

Already built; Android just calls them:
- `deleted_at`, `is_favorited`, `last_viewed_at`, `position`, `is_public` columns (migration 005)
- Full-text search `tsvector` (migration 006)
- `match_notes()` RPC for semantic search (migration 004)
- Backlinks API: `GET /api/notes/[noteId]/backlinks` (web Next.js route)
- Ingest pipeline (FastAPI backend) — outputs any format; Android parser handles it generically

---

## Files Map

| File | Role |
|---|---|
| `ui/main/MainScreen.kt` | Root layout: sidebar + content pane, note list state |
| `ui/sidebar/Sidebar.kt` | Left panel: starred, recent, all notes |
| `ui/notes/NoteEditorPane.kt` | Editor host: WebView wrapper + toolbar |
| `assets/editor.html` | Block editor (plain JS + CSS, no React) |
| `ui/notes/NotePropertiesDialog.kt` | Properties sheet: mastery, topics |
| `ui/notes/IconPickerDialog.kt` | Emoji icon picker |
| `ui/search/SearchDialog.kt` | Search modal |
| `ui/chat/ChatPane.kt` | AI tutor (calls LiteRT in-process) |
| `ui/ingest/PdfIngestDialog.kt` | PDF ingest flow |
| `data/NotesRepository.kt` | All Supabase CRUD |
| `data/Note.kt` | Note data class |
| `data/SyncManager.kt` | Local ↔ Supabase sync |
| `data/local/NotesDatabase.kt` | Room local DB |
