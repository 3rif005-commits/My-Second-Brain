# Keeping up with Notion (the monthly process)

> Written for milestone 10. Last reviewed: **2026-10-08** (API version `2026-03-11`).
> A change in Notion is detected by the **canary**, absorbed by the **adapter**, and verified by
> the **contract tests**. Nothing outside `backend/services/notion_sync/notion/` should ever need
> editing for a Notion change (a lint test enforces that).

## What watches for you
| Watcher | What it catches | How to run |
|---|---|---|
| Contract tests (every commit, no network) | OUR regressions against recorded real responses: `docs/notion-sync/evidence/live/**/T*.json` | `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest -p asyncio tests/notion_sync/test_contract.py` |
| The canary (daily, test workspace only) | THEIR changes: sends a fixture with every block type, a database with relations/rollup/formula and 9 view types, reads it back, sends again and expects 0 writes | `cd backend && venv/bin/python -m evals.notion_canary` (cron: `5 3 * * * cd …/backend && venv/bin/python -m evals.notion_canary --quiet`) |
| Settings → Notion → Health | shows the canary's last result (green / which checks failed), API version pinned, items failing, rate-limit waits | `GET /notion/health` |

A red canary means: syncing of unchanged types keeps working, but Notion's behaviour changed. Read
the failed check names in the report, then follow "When the canary is red" below.

## The monthly review (15 minutes)
1. Open <https://developers.notion.com/page/changelog> and read everything since the date at the top of this file.
2. For each entry write one line under "Log" below: **irrelevant**, **opportunity** (a feature we could use), or **breaking-in-next-version**.
3. Anything tagged breaking: add a line to `STATUS.md` ("Send to Notion: Notion deprecates X on <date>").
4. Update the "Last reviewed" date above.

## Moving to a new API version
Only ever in one commit, on a branch:
1. Change `NOTION_VERSION` in `notion/version.py` (and nothing else).
2. Re-record the cassettes: `venv/bin/python -m evals.notion_live_probe` (writes `evidence/live/<timestamp>/`), then point `RUN` in `tests/notion_sync/test_contract.py` at the new folder.
3. Run the whole suite, `evals.notion_m1_live --m2/--m3/--m4/--m6/--m9` and `evals.notion_canary`. All green → merge.
4. Add a row to `evidence/live/RESULTS.md` for anything that behaved differently.
Never change the version on a user's connection silently: a connection stores the version it was made with (`notion_connections.api_version`).

## When the canary is red
| Check | Probable cause | Where to look |
|---|---|---|
| "send succeeds" | a payload field was renamed or became required | the 400 message in the report; `notion/writers/` or `notion/dbschema.py` |
| "Notion holds the blocks we sent" | Notion changed what it stores (a block type, nesting) | `notion/chunker.py`, `limits.py` (depth was verified at 3: toggle > toggle > toggle OK, a 4th level 400) |
| "sending again writes nothing" | our hash includes something unstable | `engine/runner.py` `object_hash` inputs; a signed URL in an IR? |
| "Notion computes our rollup / formula" | rollup/formula semantics changed | `notion/dbschema.py` |
| "all view types are accepted" | the Views API changed a configuration | `notion/views.py`; `evidence/live/RESULTS.md` L11 |

## Log of reviewed changes
| Date | Entry | Tag | Note |
|---|---|---|---|
| 2026-10-08 | Initial: all research done against `2026-03-11` | — | see `RESEARCH.md`, `evidence/live/RESULTS.md` (L1–L13) |
