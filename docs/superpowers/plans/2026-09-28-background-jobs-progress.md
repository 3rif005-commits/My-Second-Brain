# Background jobs (5.3) — build ledger

Spec: `docs/superpowers/specs/2026-09-28-background-jobs-design.md` (Opus, 2026-09-28).
User said "go ahead" 2026-09-28 → the spec's three recommendations are the defaults:
per-note auto-run is an explicit opt-in (global stays `suggest`); $5/month all-AI cap;
Activity page shows background jobs only.

Rules for this build: inline, one file done → one file on disk, ledger updated on every
transition, tests touching the user's real notes clean up after themselves.

| # | Milestone | Status |
|---|-----------|--------|
| M1 | Run later (normal/local price): `ai_jobs` + migration 025, worker tick, API, bell, card in note, split send button, Cancel | in progress |
| M2 | Activity page + caps | todo |
| M3 | Batch mode (Anthropic Message Batches) | todo |
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
- [ ] live browser pass (needs migration 025 applied)

## Log
- 2026-09-28 · M1 backend done: store, worker (claim, late, stuck recovery, additive-only), scheduler tick, /jobs API, 26 tests (in-memory table, `tests/fake_db.py`). Full suite: 1811 passed, 0 failed (448 errors = pre-existing, need the local pgtest Postgres on :55432).
- 2026-09-28 · M1 frontend done: `lib/backgroundJobs.ts` (price line, times, API), `components/ai/BackgroundJobs.tsx` (queued/running/failed cards + the normal result card labelled Background), split send button (Run now / Run later), `jobs` on the API proxy. 12 new vitest tests; 207 pass in components/ai + lib; tsc clean on own files. **Live pass waits for migration 025.**
