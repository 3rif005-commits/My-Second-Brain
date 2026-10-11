# Live probe results: T1–T10 (2026-10-08, API 2026-03-11)

Workspace "My second brain backup" (free plan), connection "Second Brain mirror" (internal, bot).
Script: `backend/evals/notion_live_probe.py`. Raw calls (no token): `2026-10-08T10-30-25Z/`, `2026-10-08T10-32-53Z/` (T6/T7 re-run after fixing the probe).

| # | Question | Answer (VERIFIED live) | Design consequence |
|---|---|---|---|
| T1 | Is append-children atomic? | **Yes.** 3 blocks with an invalid 3rd → 400 `validation_error`, 0 children written. | Retry a failed append chunk whole; no partial-chunk re-read needed. Validate chunks before sending. |
| T2 | Does a nested block edit bump the page's `last_edited_time`? | **Yes** (10:31 → 10:32 after editing a block inside a toggle); `last_edited_by` = our bot id. Human half (user edited the inner block by hand, 10:36): page `last_edited_by` = a user, ≠ bot ✓. | The cheap page-level check sees nested edits; no per-block deep scan needed. |
| T3 | Where does an inline child_database land? | **At the end at creation time.** A, B, [create inline DB], C → order A, B, child_database, C. | The append-order trick works for first creation. Moving it later needs a rebuild. |
| T4 | One `dual_property` update creates the reverse? | **Yes.** Y gets `Xs` (relation) from one PATCH on X. | Phase 2 needs one call per relation pair. |
| T5 | Our formula expressions verbatim? | **Yes, all six**: arithmetic, `if`, string concat + `format`, `dateBetween`/`parseDate`, `let`, `.map(current…).join`. Values computed correctly (6, big, "row (3)", 10, 16, "x!, y!"). Unknown function → 400 "Type error with formula" at schema write. | Formula push is reliable; a 400 at schema write triggers the snapshot-only fallback for that property. |
| T6 | Same database shown on a second page? | **Yes.** `POST /v1/views` with `create_database.parent` puts a linked `child_database` on another page. Board view with `group_by` works (needs the property **id**, not its name). | An inline DB embedded in two notes maps to home DB + linked view (E, not A). Views reference property ids, which come from our mapping table. |
| T7 | Free-plan file cap? | **5 MiB exactly**: 4.9 MiB uploads and attaches; 5.1 MiB → "File size of 5.1 MiB exceeds the limit of 5 MiB." **Also: `.bin` extension rejected** ("extension that is not supported for the File Upload API"). | Size check in the dry run (planned). **New:** an extension allow-list check too. Unsupported types → zip-wrap or link-out with a marker. |
| T8 | Uploaded `.html` as an embed? | **Accepted** (embed block via `file_upload`). **JS runs**: the user clicked the button in Notion and it changed to "JS works: …" ✓. | Interactive blocks map to an embed of the uploaded HTML; they stay interactive in Notion. |
| T9 | Validation edge cases | heading_4 ✓. Code language is a **strict enum**: `jsx` and unknowns → 400 (`latex`, `plain text`, `python` OK). Text length counted in **UTF-16 units** (1,001 emoji = 2,002 → 400). Icon emoji strictly validated (flag 🇲🇦 OK, "abc" → 400). **Block equation of 1,001 chars accepted** (the documented 1,000 limit didn't apply to a block equation; inline untested). column_list with 1 column → 400. | Language map with `plain text` fallback; split text on UTF-16 length; icon allow-list check; single column → flatten. All as designed. |
| T10 | Timestamp/ID columns addable to a schema? | **Yes**: created_time, last_edited_time, created_by, unique_id (prefix "SB"). Values are Notion's own. | Keep "Created/Edited in Second Brain" date properties for our real values (as designed). |

Not yet tested: T11 (moving a database to another parent, for collection moves). Also documented, not in our test list: a data-source schema must stay under 50 KB.

Cleanup: both probe pages moved to the TEST workspace's trash (SB-TEST-root kept, now empty).


## M1 live findings (2026-10-08, `backend/evals/notion_m1_live.py`)

| # | Question | Answer (VERIFIED live) | Consequence |
|---|---|---|---|
| L1 | Is `list_start_index` accepted on `numbered_list_item`? | **No, on create or on update.** 400 "list_start_index should be not present" (also `list_format`). Tried against API 2026-03-11 on the test workspace; the docs list it as creatable. | A numbered list that starts at N is sent as starting at 1: an *approximated* loss (`list_start`). FIDELITY_MATRIX row changed from E to A. |
| L2 | Does a full M1 fixture send (headings 1-6, toggle heading, nested lists, to-do, toggle, quote, code, divider, inline styles, link, inline math, long emoji text, unknown block) go through in one run? | **Yes**: page create + container + 4 requests; read-back block types match the plan. `is_toggleable: false` on plain headings is accepted. `parent: {type: data_source_id}` creates a row. A second send makes 0 write calls. | none |
| L3 | Cost of a *changed* note | 29 requests for a 25-block note (delete every block we created, re-append). | ADR-06 block diff is still needed (planned later); fine for M1. |
| L4 | Nesting limit per request | **Top block + 2 nested levels are accepted** (toggle > toggle > toggle OK, a 4th level 400 "children should be not present"). `column_list > column > block`, `callout` with empty text + child, `table` (2 rows), block `equation` all accepted in one request. | `MAX_DEPTH = 3` (was 2: too conservative, and it would have broken columns, whose columns need a child at creation). |
| L5 | M2 live fixture (table with merged cell, 2 callouts, columns 1:2, math, checkpoint, button, page break, public image, uploaded image, YouTube video, uploaded file, cover) | **Sent in 13 requests; read-back types match.** External image link, `file_upload` image/file, cover via upload all accepted. Re-send: 0 writes. | none |
| L6 | M3 live (tree of databases: 3 collections, 5 notes with properties, mentions, a link to our own note, private target, rename, move between collections, delete → archive) | **All as designed**: pages/databases nested as planned; `data_source_id` rows with Topics/Mastery/Source/Favorite/Privacy/dates accepted; `{"type":"mention","mention":{"type":"page"}}` accepted; **`POST /pages/{id}/move` works row→data source, row→page, page→data source and page→page** (T11 for pages answered; databases not moved); re-send 0 writes. | none |
| L7 | M4 live (a block we did not create appears on the page → held back; copy; overwrite) | `GET /pages/{id}/markdown` returns the page as markdown (used for the diff). Held back with 0 writes; "Keep both" makes a new page and leaves the original untouched; Overwrite removes the foreign block and the page equals ours; re-send 0 writes. The test token cannot act as a human, so a foreign block stands in for a human edit (the person-edit half was verified in M0, T2). | none |
| L8 | M5: block-level diff live | An edit of every text block of a 20-block note (several with nested children): **all 20 Notion block ids kept**, 20 PATCHes instead of 20 deletes + appends. Appending one paragraph: 5 requests (was 29). | none |
| L9 | Scale (`evals/notion_scale.py --notes 30 --blocks 20`) | 152 requests for 30 notes (5.1/note), effective 1.97 req/s (bucket 2.5 + latency); a 5% edit = 27 requests; no change = 0. Extrapolation: 500 notes ≈ 2,500 requests ≈ 21 min; **10,000 notes ≈ 50,700 requests ≈ 7 h** at the measured rate. | matches the design estimate (6.7 h) |
| L10 | M6 live (two linked databases: 13 scalar property types, status options, two-way relation, rollup, formula, rows) | **All created.** One `dual_property` PATCH makes the pair; a rollup over it computed 7 (our value 7); a formula computed 6 (ours 6); our "(SB value)" snapshot columns carry our numbers; every scalar value type accepted (`place`, `date` with `time_zone`, select by name). Re-send: 0 writes; adding/renaming a property works by property id; a property removed here is left in Notion. **`verification` cannot be created** (400): skipped with a declared loss. | none |
| L11 | M7 live (views) | The Views API accepts table, board, list, gallery, calendar, timeline, form, chart, dashboard with the configurations we send; **chart axes must be typed** (`x_axis.type`), **a dashboard needs `data_source_id` too**, a board needs `group_by`, map needs a place property (we send a table). Widgets are views created with `dashboard_view_id`. `GET /views?database_id=` lists ids only; Notion's auto "Default view" can be deleted once another view exists. 11 views sent in one run; re-send 0 writes. | none |
| L12 | Inline database in position (T3 trick, live) | Host page `[before, DB, after]` is written exactly in that order: the blocks before go in with `position: start`, the ones after with `position: after_block <the database block>`. **A positioned insert returns the new blocks followed by every later sibling** (an unpositioned append returns only the new ones), so the adapter keeps the first N results. | none |
| L13 | M8-M9 live (chat thread, skill with a reference, a note's sources: an uploaded file from "storage:", a YouTube link, a website bookmark) | Thread = a page of 🧑/🤖 callouts under "💬 Chats"; skill = a page under "🧠 Skills" with the frontmatter in a callout and each reference in a toggle; the Sources toggle holds a `file_upload` block, an external video and a bookmark. Re-send: 0 writes. | none |


## Re-run of the live evals (2026-10-10, cloud sandbox, API 2026-03-11, TEST workspace)

Run on branch `claude/peaceful-goodall-p53g39` (= PR #3 head + spec fixes) against `SB-TEST-root`. No code changes were needed.

| Script | Result |
|---|---|
| `evals.notion_m1_live` (M1 fixture) | passed: 18 requests; re-send 0 writes; changed note 5 requests |
| `--m2` (tables, callouts, columns, files, cover) | passed: 29 requests |
| `--m3` (hierarchy, mentions, move, archive) | passed: 52 requests |
| `--m4` (edited-in-Notion protection) | passed: 37 requests |
| `--m6` (databases, relations, rollup, formula, rows) | passed: 93 requests |
| `--m9` (chat thread, skill, note sources) | passed: 29 requests |
| `evals.notion_canary` | 14/14 checks ok (incl. Notion computes our rollup and formula; all view types accepted; re-sends write nothing) |
| `evals.notion_scale --notes 30 --blocks 20` | first send 152 requests / 61.8 s (2.46 req/s); 5% edit 7 requests (5 writes); no change 0; extrapolated 10,000 notes ≈ 50,667 requests ≈ 5.6 h at 2.5 req/s (L9 measured 7 h at 1.97 req/s: the API was faster this time) |

Cleanup: each script moves what it made to the test workspace's trash; afterwards a search shows only `SB-TEST-root` live (plus one trashed data source).

## Real backup and restore (2026-10-10, demo account, real Supabase project)

| Step | Result (VERIFIED) |
|---|---|
| `python -m tools.backup --user <demo>` | 80,187-byte `.sbz`, `verify` found 0 problems. Counts: 13 notes, 3 deleted notes, 0 folders, 6 databases, 14 rows, 0 chats, 7 skills, 0 files. |
| `python -m tools.restore --dry-run` | `ok`, would create 0 folders / 13 notes / 0 chats; names the 14 database rows and 3 deleted notes as not restored (as designed). |
| `restore.apply` into the demo account | Created one "Restored from backup <date>" folder holding 13 notes. Notes 16 → 29, folders 0 → 1; the 16 existing notes were not touched. All 13 restored notes matched the archive by title and by content. |
| Cleanup | The 13 restored notes and the scratch folder were deleted by id (only what the restore created). Notes back to 16, folders 0. |

## Browser, B2 and B3 (2026-10-10, real app against real Supabase, TEST Notion workspace)

| Check | Result (VERIFIED) |
|---|---|
| `notion-sync-live` ×4 | pass (connect/send/re-send; folder send, dots, Activity, Health, kill switch; B1 migration) |
| `unknown-block-live` (B3) | pass |
| `notion-visual-live` | pass: screenshots light/dark × 1280/390 px, focus trap, Esc, focus return, no sideways overflow. Found: ghost Button invisible in dark mode (fixed). |
| B2: expired link | 400 from storage; `POST /storage/fresh-url` → 200 and the new link serves the file; another user's path → 404; no auth → 422. Test object removed. |

## Tidy "Notes" table (2026-10-11, live)
| Check | Result (VERIFIED) |
|---|---|
| `PATCH /views/{id}` on a new Notes database's default view with `name`, `configuration.properties` (visible flags, in order) and `sorts` | Accepted: view renamed "All notes"; Name, Topics, Mastery, Privacy, Favorite, Edited shown; Source, Source URL, Created, SB ID hidden; sorted by "Edited in Second Brain" descending. Applied once at creation; a view a person already renamed is never touched. |
| `notion_m1_live` (plain, `--m3`) and `notion_canary` after the change | pass (canary 14/14); +1 get/patch round trip per new Notes database |

## Real notes through the real engine (2026-10-11)
All 13 live notes of the demo account (read-only from Supabase) were sent to the SB-TEST workspace with `Engine` and trashed afterwards.

| Finding (VERIFIED live) | Fix |
|---|---|
| **A table inside a bullet inside a bullet (3 levels) is refused** (`…bulleted_list_item.children[2].embed should be defined`; Notion creates a table only with its rows in the same request, so it needs 2 levels and the chunker had put it on level 3 with its rows deferred). The study-guide notes made from lecture slides have exactly this shape. | `chunker.levels_needed`: a table / column_list / column that does not fit at its depth waits, with the siblings after it, until its parent exists, then goes in as a block of its own request. |
| One refused block failed the whole note, and the message gave no hint where. | A 400 `validation_error` on an append (atomic, T1) is halved until the block is found; a block with children is retried as shell + children so only the guilty descendant is replaced by a ⚠️ note. The result says "Notion refused N blocks". Failure messages carry Notion's field path, never a value. |
| After a replacement, the children queued for that block crashed the send (`IndexError`). | `_resolve` returns None for a replaced block and the children are skipped. |

After the fixes: 13/13 notes `done`, 0 refused blocks, 64 requests, 26 s here; `notion_canary` 14/14; backend 2786 passed.
