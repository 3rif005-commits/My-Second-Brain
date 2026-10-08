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
