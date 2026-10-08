# Send to Notion — progress ledger

> Research + design only. No feature code until the user approves (prompt: NOTION_SYNC_PROMPT.md).
> A fresh session resumes from this file, not from chat context.

| # | Artifact | Status | Notes |
|---|----------|--------|-------|
| 0 | Repo grounding (docs, memory, data inventory) | done | evidence/INVENTORY.md |
| 1 | RESEARCH.md | done (live tests T1-T10 pending token) | |
| 2 | FIDELITY_MATRIX.md | done | |
| 3 | DIVERGENCE_LEDGER.md | done (B1-B7, U1-U5 for user) | |
| 4 | DESIGN.md + mockups | done (mockups/index.html) | |
| 5 | ROBUSTNESS.md | done | |
| 6 | STATUS.md milestone plan | done — STOP, awaiting approval | |

## Facts established
- 2026-10-07: no Notion API integration in repo (grep for api.notion.com / @notionhq / notion-client outside venvs: zero hits; "notion" hits are "Notion-style" comments only).

## Decisions made by the user (2026-10-07)
- D1 = **Tree of databases** (collection page → inline "Notes" DB of its notes; sub-collections as child pages; root "Notes" DB for un-filed notes).
- D3 = **Formula + snapshot** property.
- Divergence fixes approved: **B1** (interactive blocks out of localStorage), **B3** (keep unknown blocks), **B2** (24-h capture URLs). B5 not chosen (Notion token still uses new encrypted storage).
- U1–U4: reviewed one by one, user chose the recommendation for each = **keep as-is** (no app changes).
- D2 = **deletes listed unchecked in the dry run; if ticked, page moved to `🗄 Deleted in Second Brain`** (never `in_trash`).
- D4 = **Notion is a trusted cloud destination (ceiling `personal`)**; private notes blocked, per-send "Send once anyway"; auto-sync never releases.
- D5 = **whole brain ON: collections, notes, databases, embedded files; OFF: workspace source files, chat threads, skills** (each a Settings toggle).
- Still open: throwaway test workspace token; explicit go-ahead to start M0 (no feature code until then).

## M0 build log
- 2026-10-07 B3 fixed (ba34f9c): unknown blocks kept via `unknownBlock` placeholder; 144/144 editor vitest pass. Live browser check NOT done yet.
- 2026-10-07 `services/secrets.py` (Fernet, rotation, fail-closed) + settings `secrets_key`, `notion_test_token`; 8/8 tests pass.
- 2026-10-07 migration `030_notion_sync.sql` written; verified in a throwaway postgres:16 container (stubbed profiles/auth.uid/authenticated): applies, re-applies idempotently, proof SELECT = 6 tables, RLS on, notion_connections 0 policies, others 1. Deviation from DESIGN §5: token_ciphertext is TEXT (Fernet output is ASCII; PostgREST bytea is hex-awkward) + token_hint, include, released columns added. **NOT applied to production yet: the user runs it in the Supabase SQL editor.**
- 2026-10-07 B3 LIVE-VERIFIED: `e2e/unknown-block-live.spec.ts` (project `unknown-block-live`) passes against the real app: placeholder shown, edit + autosave, stored `flashcard` block identical to the original (props + nested children), no `unknownBlock` persisted. Fixture note created and permanently deleted by the spec; checked 0 `SB-TEST` notes left. (First run timed out on a 69 s cold compile; spec timeout raised to 300 s; one leftover fixture from that run was cleaned up by hand.) Stack started for the test (backend+frontend only, no llama.cpp) and stopped again, as found.
- 2026-10-08 migration 030 APPLIED to production (all 6 tables reachable via service role). SECRETS_KEY + NOTION_TEST_TOKEN in backend/.env and verified (encrypt/decrypt round-trip; token `ntn_…`). Test workspace = "My second brain backup" (empty, user's new workspace); connection "Second Brain mirror", type API token (internal), users/me → bot ✓. 030 later edited (82ee460) so RLS is enabled with plain statements (SQL editor warning).
- 2026-10-08 SB-TEST-root shared (title was empty; set via API to `SB-TEST-root` 🧪). Live probe T1–T10 run: 81 requests, all answered; results in evidence/live/RESULTS.md, raw calls saved (no token) for cassettes.
- 2026-10-08 T2 human half ✓ (last_edited_by = user ≠ bot); T8 ✓ (JS runs in Notion). Probe pages trashed in the test workspace.
- **M0 CLOSED 2026-10-08.** NEXT: M1 (connect + send one plain note with dry-run preview), plus approved fixes B1, B2.

## M1 build log (started 2026-10-08)
- Piece 1 IR `services/portable/` (ir, canonical, losses), ir_version 1. Piece 2 readers (blocknote: paragraph, heading 1-6, bullet/numbered/check, toggle, quote, codeBlock, divider; inline marks/colours/links/inlineMath/mention-as-text; UnknownReader -> opaque) + `services/notion_sync/registry.py`.
- Piece 3 adapter `services/notion_sync/notion/` (pinned version, httpx client, token bucket 2.5/s burst 3, Retry-After + backoff, creates/appends never blindly retried, chunker 100/2 levels/450 KB/1000 elements, UTF-16 splitting, language map, writers + OpaqueWriter).
- Piece 4 tests `backend/tests/notion_sync/` (readers, writers + golden, chunker seeded-random, client, contract replay of the saved cassettes, guards/lint, engine against an in-memory Notion `fake_notion.py` with fault injection).
- Piece 5 engine core: `planner.py`, `engine/store.py`, `engine/runner.py` (mapping row in `creating` BEFORE the create, reconcile by SB ID / Notes-database listing, ambiguous-append reconciliation, edit check, privacy gate twice, runs/run_items), `connection.py`.
- Live core check on the test workspace: `venv/bin/python -m evals.notion_m1_live` (see RESULTS L1-L3). **Finding L1: `list_start_index` is rejected by Notion; design row changed E -> A.**
- CHECKPOINT reached after piece 5: API (6), UI (7) NOT started; waiting for review of the frozen core.
- Known gaps, by design for M1: changed notes are replaced (delete our blocks + re-append, no block diff); a process kill between an append landing and its bookkeeping can leave orphan blocks (write-ahead cursor is M5); the `SB ID` property is visible, not hidden (views API, M6/M7); estimate of requests is rough; no per-request kill switch (per item only); Notion-side edit detection is the cheap `last_edited_by != bot` check only (M4).
- 2026-10-08 **M1 DONE.** Pieces 6 (API `routers/notion_sync.py`, 16 tests) and 7 (UI: Settings → Notion, `SendToNotionPanel`, ••• menu item; 7 vitest) built. Live browser flow passes (`e2e/notion-sync-live.spec.ts`, 57 s): connect → pick SB-TEST-root → ••• → preview "1 lossy" (text alignment) → Send → "Open in Notion" link → read-back blocks match → re-open → "Nothing to send". Fixture note, connection and the Notes database were removed afterwards (verified). 145 backend tests green.
- Not done / unverified: I have not looked at the sent page with my own eyes in Notion (only API read-back); light/dark and keyboard behaviour of the panel are covered by Esc/focus tests only, no visual dark-mode check of the panel itself.

## M2 build log (2026-10-08)
- IR: `table_row`/`table_cell` types, `Obj.cover`. Readers: table, image/video/audio/file, columnList/column, callout, math, checkpoint, button, pageBreak. Writers `notion/writers/rich.py`. File pipeline `notion/files.py` (https-only, private-IP and redirect guard, size cap from the workspace limit, public links are linked and ours are uploaded) + `NotionAdapter.materialize`. Covers via the same path. Goldens for each type, 13 engine tests with files, fake Notion extended (uploads, column/table/callout rules).
- Live: `venv/bin/python -m evals.notion_m1_live --m2` (RESULTS L4, L5).
- Not done in M2: database blocks (M7), interactive/Disco blocks (needs B1), cross-note dedup of uploads (an upload is made per block; `notion_file_uploads` is unused so far), checking the unsupported-extension list up front (we try and fall back).

## M3-M5 build log (2026-10-08)
- **M3** hierarchy: collections → pages with description, inline "Notes" database per collection and for the root (D1-D), `notion/properties.py` (10 columns, schema kept in step), mentions via a resolver (real mention / text / lock) whose tags are part of each note's hash, two-pass shells, moves via the Move API, deletes listed unchecked and moved to "🗄 Deleted in Second Brain", restore, collection renames/moves. Live: L6.
- **M4** protection: cheap check (last editor) + deep check (blocks we did not create; our own sub-pages/databases and half-landed appends excluded), `needs_you` with a markdown diff, resolutions overwrite / copy ("Keep both": the edited original is detached and never touched) / recreate / forget, per-note pause. Live: L7.
- **M5** engine: background runs (`background=true`, `GET /runs`, `/runs/{id}`, `/runs/{id}/retry`), kill switch before every request (+ `/pause`, `/resume`), adaptive bucket (-20 % for 10 min after a 429), 401 → connection `error` with mappings kept, write-ahead `pending` marker so a kill between an append and its bookkeeping is reclaimed, recovery of interrupted runs, bell entry only when something needs attention, `/health`, block-level diff (ADR-06) with a rebuild only when the structure changed. Live: L8, L9.
- Not built (needs you or a later milestone): UI for M3-M5 (collections in the panel, needs-you diff, Activity, pause) is built in the UI pass at the end of this session; auto-sync scheduler is M8; `notion_file_uploads` dedup table still unused.
- **M6** databases: `readers/database.py` (loaders, typed values, option ids resolved to names, relations from `db_relation_links`), `notion/dbschema.py` (24 types: 16 sent, `people`/`created_by`/`last_edited_by`/`verification`/`button`/`files` skipped with a declared loss, timestamps as date columns, `unique_id` + our text id, formula/rollup + "(SB value)" snapshot per D3), `engine/databases.py` (phase 1 create, phase 2 relations → rollups → formulas → status groups, schema kept in step by property id, nothing ever removed), rows ride the note pipeline with explicit clears, `include_linked`. Live: L10.
- **M7** views: `notion/views.py` (our `config` → Notion `configuration`, filter AST → Notion filter with option ids resolved, sorts, group_by, properties visibility/widths, feed → list, map/ungrouped board/no-date calendar → table, form questions declared lost, dashboards + widgets), `_sync_one_view` (create / PATCH on hash change / reconcile by name after a lost answer), Notion's Default view dropped once ours exist. Live: L11.
- Inline databases are placed exactly where the `database` block sits (anchors + positioned appends, L12). Until the database exists in Notion the host page shows nothing there and says so (`db_embed_pending`); the host is re-sent when the database arrives (its hash carries the anchor state).
- **M8** status + auto-sync (backend): `scope.py` (whole-brain scope per the D5 switches, `mirror_map` for the sidebar dots / header chip with folders rolling up the worst state), `/mirror`, `/rules` CRUD, `/include`, `all: true`; `auto.py` + a scheduler tick (`_tick_notion`, every minute): on-change waits 10 minutes after the last edit, daily runs once a day, 15-minute backoff for a failing item, **never** releases private notes, never overwrites a page edited in Notion, never archives a delete. The UI for M3-M9 (dots, chip, rules, activity) is the next piece.
- **M9** rest of the brain: chat threads (callouts, private messages dropped, gated by every note they cite, a missing note counts as private), skills (user copy wins, references in toggles), a note's sources (opt-in; files named `storage:<path>` so a signed URL never makes a note look edited; videos linked, websites bookmarked), `markdown_in` (markdown → IR). Deny-list test: nothing in `notion_sync/` mentions `ai_providers`, `mcp_servers`, `mcp_grants`, `api_key`, `preferences`. Live: L13.
