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
| M3 | Batch mode (Anthropic Message Batches) | ✅ done, live-verified (real batch, half price confirmed) |
| M4 | When a source is added | code complete, blocked on migration 027 for the live pass |
| M5 | Schedules + staleness | code complete, blocked on migrations 027+028 for the live pass |

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
- [x] frontend: quote in the ▾ menu, "(now $x)", Sent/expired/needs-you wording + actions, Activity
- [x] live: free-side pass (queue → Sent → cancel) and ONE paid batch run (~$0.05), compare with ai_runs

## Log (M3)
- 2026-09-28 · M3 backend done: 91 jobs tests green. Found: worker tests were reading the real Supabase (modules that import get_supabase by name bypass the conftest guard) → `hermetic_planning`; `no_real_batch_api` guard so no test can send a paid batch.
- 2026-09-28 · M3 live GREEN on the final build: `background-activity` (free), `background-jobs` (7.9 min, now takes the batch path), `background-batch` (7.7 min: paid $0.005574 vs live $0.011149 — exactly half; one batch cancelled). Total real batch spend on the test account this session: $0.0219 over 4 runs. Also walked through in the user's real Chrome (GIF: background-jobs-walkthrough.gif in Downloads).
- Found by the browser walkthrough (all fixed): (1) the ▾ menu showed a guessed "Normal price" for several seconds while the quote loaded → "Checking the price…"; (2) the queued card appeared ~8 s late → shown at once; (3) cost line's numbers didn't add up ($0.01 next to $0.006) → 3 places under ten cents; (4) Activity took 3.4 s → 0.3 s (queries in parallel); (5) the cancel warning vanished with the card → toast (info style, not red); (6) panel card for a refused job had no way to the limit → "Change limit" link; (7) an inserted result's card (and its Undo) disappeared at the next refresh, sometimes before "In “note”" showed → applied cards are kept until you leave, a second Insert after Undo doesn't record a second apply, a failed insert now says why.
- Tooling notes: `./app.sh start --prod` started from a background shell leaves no frontend (the server dies with the shell) — build with `npm run build`, start with `setsid … npm run start`. Two profiles exist in the DB: scripts must take the user from the note, not `profiles[0]`. The stack was found fully stopped mid-session (not caused by these changes).
- Tests: backend jobs 92; frontend 261 in lib/activity/ai/sidebar/settings.

## M4 pieces (migration 027 — next_check_at + one-trigger-per-note — user applies)
Decisions (spec §2.2/§7): per-note opt-in only, global `workspace_on_drop` stays `suggest`
(does not conflict — this is an explicit trigger the user turned on for THIS note); settle
rule fires once, 2 min after the LAST source settles (debounced, so 3 files = 1 job); dedupe
key = (skill, note, sorted ready source ids) — a second trigger for the same key attaches to
the existing open job instead of creating one; note deleted → its trigger is disabled.
- [x] migration 027 (user applies)
- [x] `services/jobs/triggers.py` — CRUD, debounce (`touch_settle`), fire due triggers, dedupe
- [x] wire `touch_settle` into `processor.py` next to the existing `maybe_synthesize` call
- [x] worker: `_tick_triggers` alongside `_tick_jobs`
- [x] API: `GET/PUT /notes/{id}/trigger`, list for the rail
- [x] frontend: SourceRail "When I add a source here: Suggest ▾" line + status
- [ ] live: drop 2 sources on a free-model note with the trigger on → 1 job (no paid call needed)

## Log (M4)
- 2026-09-28 · M4 backend+frontend done: extracted `services/jobs/queue.py` (shared price/eligibility decision between "Run later" and a trigger firing, so a trigger never charges more than the number a click would have shown) — router tests retargeted accordingly, no behaviour change. `services/jobs/triggers.py` (debounced settle, dedupe by source set, deleted-note cleanup), wired into `processor.py`'s settle points (success AND failure — a failed source must not stall the debounce forever), a scheduler tick alongside `_tick_jobs`, `GET/PUT /jobs/notes/{id}/trigger`, and the rail's "When I add a source here" line (`SourceTrigger.tsx`). 18 new trigger tests (2 mutations verified to fail them) + 5 router tests; backend jobs suite 115, full backend suite 1900 passed (unrelated pgtest errors unchanged). Frontend: 1194 passed across the whole suite.
- **Live pass blocked**: migration 027 (`ai_job_triggers.next_check_at` + one-trigger-per-note) is not applied yet — `next_check_at` does not exist on the live table. Checked directly against Supabase.

## M5 pieces
Decisions: cadence reuses `services/db/templates.py`'s `repeat_config` shape verbatim
(daily/weekly, UTC, no per-user timezone anywhere in this codebase — same gap the row-templates
feature already documented and accepted) so `next_occurrence`/`seed_next_run_at` are reused, not
reimplemented; catch-up POLICY differs from row templates on purpose — collapses to the latest
occurrence, logs the rest as $0 `skipped` rows, instead of firing once per missed period; the two
pauses (month cap, 3-unopened) are computed live each tick from `ai_jobs`, not a stored boolean,
so a month-cap pause lifts itself once spend resets; Resume also marks the 3 stale results opened,
or the very next tick would re-pause on the same 3. Stale check reuses `ai_jobs.source_hash`
(present since migration 025, unused until now) + the new `source_signature` helper, which M4's
dedupe key does NOT switch to (different job: same-ready-ids vs also-catches-re-extraction).
- [x] migration 028 (`last_source_signature`, `paused_kind`) — user applies
- [x] `services/workspace/synthesis.source_signature`, `services/jobs/stale.py` (staleness check)
- [x] `services/jobs/schedule.py` (cadence CRUD, catch-up, skip-if-unchanged, both pauses)
- [x] scheduler tick `_tick_job_schedules`
- [x] API: `GET/POST /jobs/schedules`, `PUT/DELETE /jobs/schedules/{id}`, `POST .../resume`;
      `GET /jobs/{id}` now returns `stale`
- [x] backend tests: 21 schedule + 8 stale (4 schedule mutations verified to fail them); jobs
      suite 153, full backend suite 1938 passed (unrelated pgtest errors unchanged)
- [x] frontend: stale banner on the ready card; Settings → Background jobs "Schedules" section
      (list, new-schedule form reusing `GET /jobs/notes/{id}/trigger` for the Job dropdown and
      `GET /jobs/quote` for the real price, pause/resume, delete). "Repeat weekly…" entry from
      the Run-later menu — **deferred**, Settings is the primary entry point and ships first
- [ ] live pass (needs migrations 027 AND 028 applied — neither is yet)
- [ ] **explicitly deferred, not forgotten**: the AI-providers key-removal warning
      ("N background jobs use this key") — touches Settings → AI providers, a page outside
      this feature; lowest-value item in the spec's own edge-case table

## Log (M5)
- 2026-09-28 · Stale check shipped end to end: `GET /jobs/{id}` returns `stale`, the ready
  card shows the exact sentence ('Made from an older version of "Slides.pdf".' /
  'Made from a source you have since deleted.'), Put in note still works either way. Found
  and fixed the same import-order footgun as M4 (routers/jobs.py's new module-level
  `source_signature` import got captured by `no_real_supabase`'s poisoned reference before
  any test patched it) — same fix pattern: patch the name the caller imported, not the
  module it came from.
- 2026-09-28 · Frontend done: cadence reuses the exact `repeat_config` shape (and its UTC-only,
  no-per-user-timezone convention) the app's existing recurring row-templates already use —
  same wording pattern (`<input type="time">`, ISO weekdays 1=Mon..7=Sun) as
  `components/database/AutomationEditor.tsx`. The schedule form's Job dropdown reuses
  `GET /jobs/notes/{id}/trigger` (M4's endpoint) for eligibility/reasons, and `GET /jobs/quote`
  for the real half-price/normal decision — no separate pricing path to keep in sync.
  Frontend suite: 1207 passed, tsc clean.
