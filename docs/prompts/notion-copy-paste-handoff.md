# Hand-off: Notion-style block selection and copy/paste (cloud session, 2026-11-03/04)

Paste the section below into a new local Claude Code session started in `~/projects/second_brain`.

---

## Prompt

You are continuing editor work on Second Brain (repo `3rif005-commits/My-Second-Brain`, branch `main`;
read `CLAUDE.md` first). A cloud session built Notion's block identity and copy/paste into the note
editor. All of it is merged and pushed to `main` (commits `58cad76`, `8561157`, `75c7d3a`, `c75c5db`,
plus this hand-off file). Run `git pull` first and check `git log --oneline -6` shows them.

### What already works (do not rebuild)

1. **Block selection** (`frontend/components/editor/blockSelection.ts`, registered by
   `blockSelectionExtension.ts`): a real ProseMirror `Selection` subclass, `BlockSelection` (modelled on
   prosemirror-tables' CellSelection), with Notion's keys:
   - Esc in text selects the block. Ctrl+A selects the block's text, and pressing it again selects every block.
   - In block mode: Ctrl+A selects all blocks, Esc clears, Enter goes back into the text.
   - In block mode: ↑/↓ move, and Shift+↑/↓ grow or shrink the selection (lifting to the parent when the ends are at different depths).
   - In block mode: Backspace/Del delete, Ctrl+C/X copy and cut, Ctrl+D duplicates, Tab/Shift+Tab indent and outdent, Ctrl+Shift+↑/↓ move blocks.
   - Typing never overwrites selected blocks.
   - Dragging from the page margin draws a box that selects blocks; Shift+click extends the selection.
   - Clicking ⋮⋮ selects that block, and Turn into / Duplicate / Delete act on every selected block (`notionMenus.tsx`).
   - The blue overlay is the `.sb-block-selected` class (`app/editor.css`).
   - Two traps already handled:
     - BlockNote mounts the ⋮⋮ menu's contents on hover, so selection happens on the click, not on menu mount.
     - Browsers collapse the hidden DOM selection on focus changes, so `createSelectionBetween` keeps
       block mode unless the pointer chose a new selection.
2. **App → Notion** (`notionCopy.ts`): `text/html` is rewritten where Notion misreads BlockNote's
   export:
   - to-do: `<li><input type=checkbox>text</li>`, with no `<p>` inside the item
   - toggle: a `<details><summary>` outside any list
   - callout: one `<aside>`

   The user confirmed it works in Notion.
3. **App → app is lossless, like Notion → Notion** (`appClipboard.ts`): every copy/cut writes the selected
   blocks as stored JSON under `text/x-second-brain-blocks` (the app's version of Notion's
   `text/_notion-blocks-v3-production`). The paste handler in `BlockEditor.tsx` reads it first and inserts the blocks with
   fresh ids. Every block type round-trips: database (same `databaseId`, like a Notion linked view),
   image, callout, math, button, interactive, toggles, colours and children.
   Covered by `appClipboard.test.ts`, which round-trips every schema type.

### What is still broken: pasting a DATABASE from Notion into the app

> **Update 2026-11-05: step 1 done, and it changes the plan.** The real clipboard (fixtures in
> `frontend/components/editor/fixtures/notion-database-*.json`) carries no schema and no rows:
> - Inline (linked) database: the `collection_view` block plus `blockSubtree.collection_view`,
>   which holds the view type, `format.table_properties` (property ids, not names), `page_sort`
>   (row ids) and `format.collection_pointer.id`. There is no `collection` table and there are no row pages.
> - Full-page database (`collection_view_page`): `{ "blockId": … }` only, with no subtree.
> - `text/html`: `<p><a href="…/p/<id>">Untitled</a></p>`, with no table.
>
> So steps 2–3 below can't work from the clipboard. The data has to be fetched from Notion's API with
> the user's Send to Notion connection, and only if the database is shared with that connection. The user
> stopped here; nothing is built. Not yet checked: an original (non-linked) inline database, and whether the
> public API's data-source id equals `collection_pointer.id`.

The user copied a database in Notion and pasted it into the app. It did not come through. The cause:
- Notion → app goes through `readNotionJson` / `notionJsonToBlocks` in `notionBlocks.ts`. That code only
  reads `blocks[].blockSubtree.block` records.
- It has no case for `collection_view` / `collection_view_page`, so a database falls to the
  `default:` branch and becomes a paragraph holding at most its title.
- The HTML fallback (`notionPaste.ts`) gets, at best, a `<table>` of the visible rows.

Your task: make a Notion database pasted into the app arrive as a real app database (properties,
rows, ideally the view type), shown by a `database` block.

Steps:
1. **Capture a real payload first. Don't guess the format.**
   - The session that wrote `notionPaste.ts` captured real clipboards; do the same.
   - In the user's Chrome, in a Notion page with an inline database, copy (a) the database block alone and
     (b) a selection that includes it.
   - On a scratch page, read every type in `event.clipboardData.types` in a `paste` listener.
   - Save the raw JSON as test fixtures. Ask the user before saving anything with private content; use a test database.
   - Find out whether the v3 envelope carries the `collection` record (schema = properties and
     types), the `collection_view` (table/board…), and the row pages with their property values, or
     only the block with its `collection_id`.
2. **Map it to the app's database API** (backend `backend/routers/databases.py`):
   - `POST /databases` creates a database.
   - `POST /data-sources/{id}/properties` adds properties.
   - `POST /data-sources/{id}/rows` adds rows.
   - `POST /data-sources/{id}/views` adds views.
   - There is also CSV import in `backend/routers/db_import.py` (`POST /csv`), which may be the shortest path for schema plus rows.

   The paste handler is synchronous, so read the clipboard synchronously as today. Then insert a
   placeholder `database` block, create the database asynchronously, and set `databaseId`/`viewId` on the block.
   `insertDatabaseBlock` in `components/database/DatabaseBlock.tsx` shows the block shape.
3. **If the JSON has no rows/schema** (only a reference), fall back to the `text/html` table: build the
   database from its header and rows (column types guessed, default text). Say so in the UI, e.g.
   a toast "Imported N rows from Notion; property types as text".
4. **Images from Notion** have the same "reference only" problem (`attachment:` URLs; see the
   header of `notionPaste.ts`). Check the captured payload for anything better while you are there.
5. **Tests:**
   - Add unit tests built from the captured fixtures.
   - Live-check in the real app: paste into a scratch note, then delete the scratch note and database.
     CLAUDE.md: e2e runs on the user's real notes, so undo everything you create.
   - Run `cd frontend && npx tsc --noEmit && npx vitest run`. The full run matters: the design guard
     (`lib/design/designGuard.test.ts`) counts things like a literal checkbox-input pattern in any
     file, comments included.
6. Commit small, push to `main` (it deploys to Vercel). Update `STATUS.md`.

### Smaller known gaps (lower priority)
- The block colour item in the ⋮⋮ menu still colours only the menu's own block, not every selected one.
- There is no Ctrl+/ "turn into" shortcut.
- A block selection survives clicks outside the page area (e.g. the sidebar).
- Clicking a divider directly shows BlockNote's thin outline, not the Notion block overlay.
- Text-mode paste of several blocks puts the remainder after the caret's block; Notion splits the
  line at the caret instead.
