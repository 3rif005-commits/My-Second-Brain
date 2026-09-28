# Background jobs (5.3) — build ledger

Spec: `docs/superpowers/specs/2026-09-28-background-jobs-design.md` (Opus, 2026-09-28).
User said "go ahead" 2026-09-28 → the spec's three recommendations are the defaults:
per-note auto-run is an explicit opt-in (global stays `suggest`); $5/month all-AI cap;
Activity page shows background jobs only.

Rules for this build: inline, one file done → one file on disk, ledger updated on every
transition, tests touching the user's real notes clean up after themselves.

| # | Milestone | Status |
|---|-----------|--------|
| M1 | Run later (normal/local price): `ai_jobs` + migration 025, worker tick, API, bell, card in note, split send button, Cancel | ✅ done, live-verified |
| M2 | Activity page + caps | ✅ done, live-verified |
| M3 | Batch mode (Anthropic Message Batches) | in progress |
| M4 | When a source is added | todo |
| M5 | Schedules + staleness | todo |

## M1 pieces
- [x] migration `025_ai_jobs.sql` (user applies)
- [x] `services/jobs/store.py` — CRUD + claim
- [x] `services/jobs/worker.py` — run due jobs, recover stuck ones
- [x] scheduler: `_tick_jobs` + notifications
- [x] `routers/jobs.py` — queue / list / get / cancel / run-now / discard / applied
- [x] backend tests (fake store, fake clock)
- [x] frontend: api + price line formatter
- [x] frontend: split send button + queued card
- [x] frontend: Background result card in the note's AI panel
- [x] live browser pass — `npx playwright test --project=background-jobs` green (3.4 min, real flashcards run $0.0107)

## Log
- 2026-09-28 · M1 backend done: store, worker (claim, late, stuck recovery, additive-only), scheduler tick, /jobs API, 26 tests (in-memory table, `tests/fake_db.py`). Full suite: 1811 passed, 0 failed (448 errors = pre-existing, need the local pgtest Postgres on :55432).
- 2026-09-28 · M1 frontend done: `lib/backgroundJobs.ts` (price line, times, API), `components/ai/BackgroundJobs.tsx` (queued/running/failed cards + the normal result card labelled Background), split send button (Run now / Run later), `jobs` on the API proxy. 12 new vitest tests; 207 pass in components/ai + lib; tsc clean on own files. **Live pass waits for migration 025.**
- 2026-09-28 · M1 live pass GREEN. Queue via ▾ → Run later ("Normal price · ≈$0.05 · runs tonight at 22:00") → Queued card → Run now → result card labelled "Background · ready just now" (21 toggles, real cost $0.0107) → bell entry written by the worker → Insert into this note → Undo → reload no longer offers it → second job queued and cancelled, never ran. Test note trashed, test job rows + bell entry deleted.
- Found live: (1) the backend was WEDGED before my work — the db scheduler's `_tick` had been "skipped: maximum number of running instances reached" since 09:25 and the reload my edits triggered never finished; killed and restarted the backend only. Root cause of the stuck `_tick` NOT investigated (pre-existing; likely `get_pool()` hanging on the Supabase pooler). (2) the frontend runs `next start` (production): new UI needs `./app.sh stop && ./app.sh start --prod`. (3) a hung test skipped its cleanup and left 2 test notes → e2e now has `actionTimeout` so a missing button fails fast; leftovers trashed. (4) `notify()` gained a 20 s timeout: the jobs pass runs one at a time, a database that never answers must not stop later jobs.

## M2 pieces
Decisions (spec defaults): monthly all-AI cap $5, blocks background jobs only, stored in
`profiles.preferences.background_jobs.monthly_cap_usd` (no migration); month = calendar month, UTC;
Activity shows background jobs only; the header's month total counts all AI from `ai_runs`.
- [x] `services/jobs/caps.py` — monthly cap, month spend (paged over ai_runs), pre-flight (per job + monthly), friendly copy
- [x] worker pre-flight → `budget_blocked` (before the model call) + tests
- [x] API: `/jobs/activity` (filters, note titles, totals, badge counts), `/jobs/settings` GET/PUT, `/jobs/{id}/detail`, DELETE `/jobs/{id}`
- [x] result body cleared on apply/discard; retention sweep (30 d results, 90 d rows) + tests
- [x] frontend: `/brain/activity` page (needs-you, ready, in progress, history + filters, expanded row, empty state), sidebar entry + badge
- [x] frontend: Settings → Background jobs (monthly cap)
- [x] live pass: cap $0.01 → queue → "Not started — … monthly limit" in Activity + bell; restore cap

## Log (M2)
- 2026-09-28 · M2 backend done: caps (monthly $5 default in profiles.preferences, month spend paged over ai_runs), worker pre-flight re-prices at start and refuses BEFORE the model call, /jobs/activity|badge|settings|{id}/detail + DELETE, retention sweep every 6 h, result body dropped on apply/discard. 21 new tests; jobs suite 68 green.
- 2026-09-28 · M2 frontend + live pass GREEN (`--project=background-activity`, free, 2.5 min). Limit set to $0.01 in Settings (nonsense refused) → Run later → Run now → refused BEFORE the model ("Not started — about $0.05 would pass your $0.01 monthly limit ($1.48 spent this month)") on the card, in the bell, under Needs you on Activity, and as the sidebar badge → Dismiss → History (Discarded, $0) → expanded row → delete. Limit restored to $5. M1 live re-run after the M2 changes: green ($0.01).
- Found live (all fixed): (1) a dismissed refusal showed cost "price unknown" — the worker now records $0 for a job that never reached the model, cancel-while-queued too; a running job's cancel stays unknown; failed shows "—". (2) "Not started — Not started —" doubled. (3) sidebar badge stayed at 1 after Dismiss until the next 45 s poll → `jobs:changed` event. (4) expanded row said "Made from: sources no longer available" for a job that never ran → line hidden. (5) timeline printed each time twice.
- Tests: backend jobs suite 58; frontend 246 in lib/activity/ai/sidebar.

## M3 pieces (migration 026 — ai_runs.price_mode — user applies before the paid run)
Decisions: batch is decided at queue time and shown before the click (`GET /jobs/quote` = the same
decision the queue makes); only single-call jobs (flashcards, compare-sources, study-guide 1–2 sources);
a rise >25% since queuing → `needs_you`; provider down at submit → retry 3× over ~10 min then fail, never
switch provider; expired/errored batches cost $0; crash between send and save → look the batch up by custom_id.
- [x] migration 026, `batch` capability on anthropic, `services/jobs/batch.py` adapter (submit/poll/collect/cancel/recent)
- [x] `skill_run.batch_call / batch_eligible / finish_batch`, `usage.record_batch_run`
- [x] worker: plan_for, submit, poll/collect, needs_you, expired, reconcile + 25 tests (4 mutations verified to fail them)
- [x] router: quote, batch queue, cancel-at-provider, accept-price + tests; hermetic_planning fixture (a jobs test had read the real project)
- [ ] frontend: quote in the ▾ menu, "(now $x)", Sent/expired/needs-you wording + actions, Activity
- [ ] live: free-side pass (queue → Sent → cancel) and ONE paid batch run (~$0.05), compare with ai_runs

## Log (M3)
- 2026-09-28 · M3 backend done: 91 jobs tests green. Found: worker tests were reading the real Supabase (modules that import get_supabase by name bypass the conftest guard) → `hermetic_planning`; `no_real_batch_api` guard so no test can send a paid batch.
