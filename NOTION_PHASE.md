# Notion UX Phase — Status & Plan

> Special phase inserted after Phase 3 (Context Protocol) and before Phase 4 (Polish & Expansion).
> Goal: close the gap between what we have and what Notion provides as baseline UX.
> When complete, this merges into the Phase 1 → 4 progression as a foundation upgrade.
> Last updated: 2026-05-12 (Trash ✅, Cmd+K ✅, Page icon ✅, Breadcrumbs ✅, Favorites/Recent ✅, Properties panel ✅, Topics filter ✅, Dark/Light mode ✅, Export MD ✅, Export PDF ✅, Share link ✅, @mention ✅, Backlinks ✅)

---

## Why This Phase Exists

After Phase 3, the core AI features (semantic search, tutor, MCP) are solid.
But the editor and navigation UX still feel like a prototype — missing things
users expect from day one in any note-taking app (search, trash, page icons, breadcrumbs).
Before expanding features (Phase 4), we make the existing app feel complete.

---

## Status

| Task | Priority | Effort | Status |
|------|----------|--------|--------|
| Trash / soft delete with restore | P1 | S | ✅ Done |
| Cmd+K quick search modal | P1 | M | ✅ Done |
| Page icon (emoji) on notes | P1 | S | ✅ Done |
| Breadcrumb navigation | P1 | S | ✅ Done |
| Favorites + Recent pages in sidebar | P1 | M | ✅ Done |
| Drag-to-reorder sidebar (notes + collections) | P1 | M | ✅ Done |
| Page properties panel (mastery, topics, source) | P1 | M | ✅ Done |
| Topics as clickable filters | P1 | S | ✅ Done (in Properties panel; sidebar topic chips removed — Notion only shows these in DB views) |
| Full-text search (tsvector on content_text) | P2 | S | ✅ Done |
| Multi-column layout (BlockNote xl-multi-column) | P2 | S | ✅ Done |
| Export to Markdown | P2 | S | ✅ Done |
| Inline @mention links to other notes | P2 | L | ✅ Done |
| Backlinks panel ("referenced by N notes") | P2 | M | ✅ Done |
| Dark / Light mode toggle | P3 | S | ✅ Done |
| Export to PDF | P3 | M | ✅ Done |
| Public share link | P3 | M | ✅ Done |

**Effort key:** S = small (< 1 day) · M = medium (1–2 days) · L = large (3+ days)

---

## Phase Plan

### P1 — Core UX (must ship before Phase 4)

These 8 items fix the biggest daily-use gaps. Without them the app feels unfinished.

#### 1. Trash / Soft Delete
- Add `deleted_at TIMESTAMPTZ` column to `notes` table (migration)
- All note queries filter `WHERE deleted_at IS NULL`
- Delete button sets `deleted_at = NOW()` instead of hard delete
- New "Trash" section at bottom of sidebar listing soft-deleted notes
- Restore button and permanent-delete button inside Trash view
- Files to touch: migration, `routers/notes.py`, `api/notes/`, `useNotes.ts`, `Sidebar.tsx`

#### 2. Cmd+K Quick Search Modal
- Global keyboard shortcut (`Cmd+K` / `Ctrl+K`) opens a floating search modal
- Fuzzy search on note titles + `content_text` using PostgreSQL `ilike`
- Debounced input (300ms) → results appear below as list
- Click result → navigate to that note
- New endpoint: `GET /api/notes/search?q=` → `ilike '%q%'` on title + content_text
- Files to touch: new `SearchModal.tsx` component, `BrainLayoutClient.tsx` (keydown listener), new API route

#### 3. Page Icon (Emoji) on Notes
- Add `icon TEXT DEFAULT '📄'` column to `notes` table (migration)
- Emoji picker shown in NoteEditorPage above the title (click to change)
- Icon shown next to note title in sidebar NoteTree
- Files to touch: migration, `NoteEditorPage.tsx`, `NoteTree.tsx`, API routes

#### 4. Breadcrumb Navigation
- Top of editor shows: `My Brain › [Collection Name] › [Note Title]`
- Collection name is clickable (filters sidebar to that collection)
- Note title is the current page (non-clickable)
- Files to touch: `NoteEditorPage.tsx`, add breadcrumb component

#### 5. Favorites + Recent Pages in Sidebar
- Add `is_favorited BOOLEAN DEFAULT FALSE` and `last_viewed_at TIMESTAMPTZ` to `notes` (migration)
- Star icon on each note in sidebar — click to toggle favorite
- Sidebar gets two new collapsible sections above collections:
  - **Favorites** — notes where `is_favorited = TRUE`
  - **Recent** — top 5 notes ordered by `last_viewed_at DESC`
- `last_viewed_at` updated server-side whenever a note page is loaded
- Files to touch: migration, `Sidebar.tsx`, `NoteTree.tsx`, API routes

#### 6. Drag-to-Reorder Sidebar
- Notes and collections can be dragged to reorder within sidebar
- `position INTEGER` already exists on `collections`; add `position` to `notes` (migration)
- Use `@dnd-kit/core` + `@dnd-kit/sortable` (already common in Next.js projects)
- Drag fires `PATCH` to update `position` for affected rows
- Files to touch: `NoteTree.tsx`, add dnd-kit dependency

#### 7. Page Properties Panel
- Collapsible panel shown below the note title (above the editor blocks)
- Shows and allows editing of: mastery status, topics (tag chips), source URL/filename, created date
- `mastery_status` has a cycle button (not_started → learning → reviewing → mastered)
- Topics are editable inline (type to add, × to remove)
- All of this data already exists — just needs a UI surface
- Files to touch: new `NoteProperties.tsx` component, `NoteEditorPage.tsx`

#### 8. Topics as Clickable Filters
- Clicking a topic chip in the sidebar or properties panel filters the note list to that topic
- Add `?topic=` query param to `/brain` route → sidebar filters to matching notes
- Files to touch: `Sidebar.tsx`, `useNotes.ts`, `brain/page.tsx`

---

### P2 — Content & Discovery

#### 9. Full-Text Search
- Add PostgreSQL `tsvector` index on `notes.content_text` (migration)
- `GET /api/notes/search?q=` uses `to_tsquery` for ranked full-text results
- Combine with semantic search: text results shown first, semantic below

#### 10. Multi-Column Layout
- Enable `@blocknote/xl-multi-column` in the BlockNote schema
- Adds `/column` slash command to split blocks side-by-side
- Files to touch: `BlockEditor.tsx`, add package

#### 11. Export to Markdown
- BlockNote has `@blocknote/core` markdown serializer (`blocksToMarkdownLossy`)
- Add "Export" button in note toolbar → download `.md` file
- Files to touch: `NoteEditorPage.tsx`

#### 12. Inline @Mention Links
- Type `@` in editor → dropdown of notes to link to
- Creates a clickable inline link to the referenced note
- Enables backlinks tracking (scan content for all `@mention` references)
- Files to touch: custom BlockNote inline content spec, `BlockEditor.tsx`

#### 13. Backlinks Panel
- Bottom of each note: "Referenced by N notes" expandable list
- Query: scan all user notes' `content` JSONB for `@mention` blocks referencing this noteId
- Files to touch: new `BacklinksPanel.tsx`, new API route `GET /api/notes/[noteId]/backlinks`

---

### P3 — Polish

#### 16. Dark / Light Mode Toggle
- Tailwind + BlockNote both support theme switching
- Toggle button in sidebar footer
- Persisted to `localStorage`

#### 17. Export to PDF
- Use browser `window.print()` with a print stylesheet (simplest approach)
- Or `@react-pdf/renderer` for structured PDF (already in plan)

#### 18. Public Share Link
- Add `is_public BOOLEAN DEFAULT FALSE` to `notes`
- Public notes readable at `/share/[noteId]` without auth
- Share button in note toolbar copies the link

---

## DB Migrations Needed for P1

```sql
-- migration 005_notion_phase.sql

-- Soft delete
ALTER TABLE notes ADD COLUMN deleted_at TIMESTAMPTZ;

-- Page icon
ALTER TABLE notes ADD COLUMN icon TEXT NOT NULL DEFAULT '📄';

-- Favorites + recents
ALTER TABLE notes ADD COLUMN is_favorited BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE notes ADD COLUMN last_viewed_at TIMESTAMPTZ;

-- Position for reordering
ALTER TABLE notes ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

-- Cover image (P2)
ALTER TABLE notes ADD COLUMN cover_image_url TEXT;
```

---

## Implementation Order

Work P1 top-to-bottom. Each item is independent — they can be done in any order within P1.
Start with Trash (smallest, highest risk mitigation) then Cmd+K (highest user value).

```
Trash → Cmd+K → Page Icon → Breadcrumbs → Favorites/Recent → Drag-Reorder → Properties Panel → Topic Filters
→ (P2) Full-text search → Multi-column → Export MD → ...
```

---

## Definition of Done

This Notion phase is complete when a user can:
1. Search any note with Cmd+K
2. See emojis on notes in sidebar
3. Know where they are (breadcrumbs)
4. Pin important notes (favorites)
5. Recover a deleted note (trash)
6. Reorder notes by dragging
7. See and edit note metadata inline (mastery, topics)
8. Filter by topic

After that → merge this into the main phase progression and begin Phase 4.
