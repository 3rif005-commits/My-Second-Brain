# Prompt: build Send-to-Notion Milestone 1

Paste everything below the line into a fresh Claude Code session in /home/ayoub/projects/second_brain.

---

You are continuing the "Send to Notion" feature of my app, Second Brain. Research, design and Milestone 0 are DONE and approved. Your job is **Milestone 1 only**, then stop.

## 1. Read first (before writing any code)
1. `docs/notion-sync/PROGRESS.md`: the ledger; the decisions I made (D1–D5, bug fixes, U1–U4) are binding.
2. `docs/notion-sync/DESIGN.md`: §3 architecture, §4 IR, §5 data model, §6 engine, §7.2/§7.4 UX.
3. `docs/notion-sync/ROBUSTNESS.md`: §1 the mapper interface, §2 anti-corruption layer, §4 create/crash protocol, §10 ADRs. Don't undo an ADR without asking me.
4. `docs/notion-sync/FIDELITY_MATRIX.md` (§2–3 for M1's block types) and `docs/notion-sync/evidence/live/RESULTS.md` (verified Notion behaviour: append is atomic, UTF-16 lengths, strict code-language enum, single column rejected, etc.).
5. The STATUS.md section "Send to Notion": the M1 row and its test commands.
6. My memory index `~/.claude/projects/-home-ayoub-projects-second-brain/memory/MEMORY.md` and the files it links: especially no-subagents, tests-touch-real-notes, check-stack-before-stop, backend-test-quirks.

Already built in M0, so reuse it and don't rebuild: `backend/services/secrets.py` (Fernet), migration `supabase/migrations/030_notion_sync.sql` (applied to production), `backend/evals/notion_live_probe.py`, `frontend/components/editor/unknownBlocks.ts`. `backend/.env` has `SECRETS_KEY` and `NOTION_TEST_TOKEN`.

## 2. Milestone 1 scope: "connect + send ONE plain note faithfully, with dry-run preview"
Build, in this order, committing after each piece:
1. **IR** `backend/services/portable/` (`ir.py`, `canonical.py` stable JSON + sha256, `losses.py`), exactly the DESIGN §4 shapes, `ir_version = 1`. No BlockNote or Notion names inside.
2. **Readers** (BlockNote → IR) for: paragraph, heading 1–6, bullet/numbered/check list items, toggle list item, quote, codeBlock, divider; inline bold/italic/underline/strike/code/colour/link; plus `UnknownReader` → `opaque` (never throws). Registry per ROBUSTNESS §1.1.
3. **Notion adapter** `backend/services/notion_sync/notion/`: the ONLY code that knows Notion (pinned `Notion-Version: 2026-03-11`, httpx, token bucket 2.5 req/s, Retry-After + backoff, never blindly retry a POST create, chunker for 100 children / 2 nesting levels / 500 KB / 2,000 UTF-16 units). Writers (IR → payload) for the same block types + `OpaqueWriter`. Code languages via a map with `plain text` fallback (strict enum, see RESULTS T9).
4. **Contract tests** from the saved responses in `docs/notion-sync/evidence/live/*/T*.json` (replay, no network), plus unit + golden tests for every reader/writer, a coverage-guard test, and a lint test that no module outside `notion_sync/notion/` mentions Notion shapes.
5. **Engine core (minimal, but it's the frozen core: build it properly):** planner (scope = one note → IR → hash → new/changed/unchanged + losses), mapping-table writes per the create protocol (row in `creating` BEFORE the create, reconcile after a crash), runs/run_items, synchronous execution is OK for M1 (background worker is M5). **Re-sending an unchanged note must make zero write calls**: test it.
6. **API** `backend/routers/notion_sync.py`: connect (validate token via `/users/me`, must be a bot; list shared pages; pick root; store token encrypted, return only `…last4`), disconnect, plan (dry run), send, status for a note. Privacy gate (D4): a `private` note is blocked unless released for that run.
7. **UI:** Settings → new "Notion" tab (connect flow per DESIGN §7.4, empty state + connected state), note "•••" menu item "Send to Notion…", and the review side panel (DESIGN §7.2: destination, preview with Exact/Approximated/Lossy pills and plain-word losses, Send, result with "Open in Notion ↗"). Use existing `--menu-*` tokens, `ConfirmDialog`/`useToast`, no native dialogs, keyboard + dark mode. Mockup reference: `docs/notion-sync/mockups/index.html`.
8. **D1 for M1:** only the root container: an un-filed note goes into the root page's "Notes" database (rows carry the hidden "SB ID" property). Collections come in M3.

**Checkpoint:** after pieces 1–5 (IR, readers, adapter, tests, engine core), STOP and show me a short summary + the test output before building the API/UI. I want to review the frozen core.

## 3. Ground rules (strict)
- Work inline. **No subagents, no `/code-review` fan-out**, unless I ask in that message. Write each file to disk as it's done; commit per piece; update `docs/notion-sync/PROGRESS.md` after each piece.
- Notion: **only** the test workspace via `NOTION_TEST_TOKEN`; any live call must check the shared root page is titled `SB-TEST-…` (see the guard in `evals/notion_live_probe.py`). Never print the token. Clean up test pages you create.
- My real notes: e2e/live tests create their own fixture note and delete it permanently in `finally`; never edit an existing note.
- Before starting/stopping anything on ports 3000/8000/8080/8081: run `./app.sh status` right before. Leave the stack as you found it. Don't start the llama.cpp models (`./app.sh start` does), start backend + frontend only.
- Backend tests: `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest -p asyncio …`. Supabase migrations are applied by me in the SQL editor (no direct DB access); M1 should need no new migration. If it does, ask first.
- Mark anything unverified as such; never claim a check you didn't run. If a design detail turns out wrong against real Notion behaviour, stop and tell me rather than silently changing the design.

## 4. Done means
All M1 tests green; a live run on the test workspace sends one fixture note with every M1 block type, it opens in Notion looking right, and a second send reports "Nothing to send" with 0 write calls; the browser flow works end to end (connect → ••• → preview → send → open). Then give me the exact commands to test it myself (STATUS.md M1 row) and stop.
