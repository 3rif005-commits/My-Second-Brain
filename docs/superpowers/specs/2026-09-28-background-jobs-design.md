# Background jobs — design spec (harness item 5.3)

Date: 2026-09-28 · Status: draft for review · Branch: `feat/ai-harness`
Builds on: `services/workspace/skill_run.py` (`produce_skill_result`, `estimate`),
`services/ai/budget.py` (per-run guard, `max_usd_per_run` = $0.50), `ai_runs` (020),
`services/db/scheduler.py` (in-process APScheduler tick), `db_notifications` +
`NotificationsBell`, the AI panel result card (`PanelJobCard` in
`components/ai/PanelCards.tsx`), Settings → Connected apps "Waiting for your approval" (024).

Already decided (not re-opened here): additive only · a budget cap on every job, refused
before start if the estimate exceeds it · an activity page · nothing runs invisibly,
everything cancellable.

## 1. Goal

- **What:** queue a skill job (study guide, flashcards, compare-sources) to run later
  instead of now, and find the result waiting.
- **Who:** a student who drops lecture PDFs in the evening and studies the next day, or
  wants a weekly flashcard refresh without thinking about it.
- **Why:** where the provider has a batch API, a job that can wait costs half.
- **The feeling:** "I queued it, forgot it, and it was there — and nothing changed that I
  didn't click."
- **Not for:** chat, the multi-round agent loop, selection skills (define-terms). They need
  a person turn by turn; they stay live.

**Eligible jobs.** Single-shot (one prompt in, one document out, no tools) and has an
`output`. Today: `study-guide` (1–2 sources), `flashcards`, `compare-sources`. The
chaptered study guide (3+ sources: plan, then a call per chapter) may run in the
background but **not on batch** in v1 — it runs at normal price and the UI says so. A skill
opts out with `background: false` in its frontmatter.

## 2. Entry points

Each entry point shows, **before the click**: the price mode, the estimate, and when it
will be ready. One formatter produces this line everywhere (same rules as
`formatLastRun`): `free` for a zero-price model, `price unknown` when the model has no
published price (unknown ≠ free), never `≈$0.000`.

| Price mode | Line shown | When |
|---|---|---|
| `batch` | `Half price · ≈$0.04 (now $0.08) · ready within a few hours` | provider has a batch API, job is one call |
| `normal` | `Normal price · ≈$0.08 · runs at 22:00` | no batch API (OpenRouter, most OpenAI-compatible), or chaptered guide |
| `local` | `Free · runs on this computer · needs the app running` | local model |

"Within a few hours" is honest: most batches finish in under an hour, but the provider
allows 24h. We never promise "1 hour". Which providers have batch is a capability flag on
the provider in `services/ai/providers.py` (Anthropic now; OpenAI's batch API later), not
a check for a model name.

### 2.1 Run later (manual, one-off)
- **Where:** AI panel and workspace chat. When the composer holds a `/skill` command, the
  send button becomes a split button: **Run now** + a caret menu with
  **Run later — half price** (or plain **Run later** in `normal`/`local` mode) and
  **Repeat weekly…** (opens §2.3 prefilled). The slash-menu row shows a small `½` tag when
  batch applies, so the saving is visible before typing.
- **Default:** Run now (today's behaviour).
- **After the click:** a compact card in the chat, same frame as the result card:
  `Queued · Study guide · 2 sources · ≈$0.04 · ready within a few hours` with
  **Cancel** and **See activity**. Chat stays usable.

### 2.2 When a source is added (per note)
- **Where:** workspace Sources rail, one quiet line under the list:
  **When I add a source here: Suggest ▾**. Options: *Suggest (don't run)* ·
  *Study guide, in the background* · *Flashcards, in the background*. Picking one shows the
  price line for one typical source (`Half price · ≈$0.03 per lecture · max $0.50 a job`).
- **Default:** Suggest. Global `workspace_on_drop` stays `suggest`; this is a per-note
  opt-in stored as a trigger, never a global auto-run.
- **Settle rule:** fires once, 2 minutes after the last source finished indexing (reuses
  the settle guard: no source pending). Dropping 3 PDFs = one job.
- **Visible while on:** the rail shows `⏱ New sources → study guide (background) · Turn off`.

### 2.3 On a schedule
- **Where:** Settings → **Background jobs** (new entry in `sections.ts`, icon `Clock`),
  button **New schedule**; or **Repeat weekly…** from the Run-later menu.
- **Inline form (no native dialogs):** Job ▾ · Note ▾ (its sources are the material) ·
  **Every** day / week on (weekday ▾) **at** 22:00 · **Stop at** $1.00 a month.
- **Price line:** `Half price · ≈$0.04 a run · at most ≈$0.16 a month · stops at $1.00`.
- **Rule, not a setting:** a scheduled run happens only if the note's sources changed since
  the last run; otherwise it is logged as `Skipped — nothing new · $0`.
- **Defaults:** weekly, Sunday 22:00 local, $1.00/month cap.

## 3. Job lifecycle

One row per job in a new table `ai_jobs` (migration 025, user applies). Triggers live in
`ai_job_triggers` (kind `source_added` | `schedule`, skill, note_id, cadence, month cap,
enabled, paused_reason). A job never writes to `note_synthesis` — that row is the live
draft and a background job must not overwrite an unapplied one. The result lives on the
job row until the user applies it.

```
            ┌──────────── cancel ─────────────┐
            │                                 ▼
 queued ──► (pre-flight) ──► submitted ──► ready ──► applied
   │            │   │            │           │
   │            │   │            ├─► failed  └─► discarded
   │            │   │            └─► expired        (+ cancelled from queued/submitted,
   │            │   └─► budget_blocked               + skipped from queued)
   │            └─► needs_you (price went up) ──► queued (on Run) / cancelled
   └─► skipped (schedule: nothing new)
```

`running` is `submitted` for a live or local run (same UI, different copy). Pre-flight
happens at submit time, not queue time: it re-reads the sources, re-prices with the model
selected **now**, and checks the caps.

| State | User sees (exact copy) | Can do | Stored |
|---|---|---|---|
| queued | `Queued · runs at 22:00` / `Queued · runs when the sources are ready` | Cancel · Run now | skill, note_id, source_ids + content hash, trigger, run_after, shown_estimate_usd, price_mode, cap_usd |
| submitted (batch) | `Sent · half price · usually under an hour, at most 24h` | Cancel | provider, model, provider_batch_id, submitted_at |
| running (live/local) | `Running · 1m 20s` | Cancel (stops before the call; a call in flight finishes, per `budget.py`) | started_at |
| ready | `Ready · Study guide for "Lecture 10" · $0.041 (live would be $0.082)` | open card: Put in note · Insert here · Copy · Try again · Discard | result_html, result_title, actual_usd, live_equivalent_usd, ai_run_id |
| applied | `Put in "Lecture 10" · 14:02` + **Undo** (same Undo as the live card) | Undo · Open note | applied_at, applied_note_id |
| discarded | `Discarded` | — (row kept for the log) | discarded_at |
| failed | `Failed — <provider's reason in one line>` e.g. `Failed — the provider rejected the request (context too long)` | Try again (later) · Run now | error, attempt count |
| cancelled | `Cancelled by you` / `Cancelled — the source was deleted` | Queue again | cancelled_at, reason |
| expired | `Not finished within 24h by the provider. Nothing was charged.` | Run now (normal price, shown) · Queue again | expired_at |
| budget_blocked | `Not started — ≈$0.62 is over this job's $0.50 limit` / `… would pass your $5.00 monthly limit ($4.71 spent)` | Change limit (link to the field) · Run with fewer sources · Discard | estimate, which cap, spent |
| needs_you | `Price went up: ≈$0.08 now (was ≈$0.04) — the model changed to <model>` | Run at $0.08 · Cancel | new estimate + why |
| skipped | `Skipped — nothing new since last run · $0` | — | — |

**Provider has no batch — decision:** decided at queue time, not discovered later. The
entry point already shows `Normal price` (§2), so the job simply runs live at its time;
no extra question. Only if the price **rises after queuing** (model or provider changed,
batch no longer available, sources grew) by more than 25% does the job stop in
`needs_you`. Why: the user agreed to a number; spending more than that without asking
breaks "tell the truth", but asking again for a price they already saw is noise.

A failed batch is not retried silently at normal price — that would double the price the
user agreed to. It goes to `failed` with **Run now** priced on the button.

## 4. Activity page

Route `/brain/activity`, a sidebar entry **Activity** (with a count badge when something is
ready or needs you). Settings → Background jobs holds the rules (schedules, per-note
triggers, caps); Activity holds what happened. Same visual language as Connected apps:
rounded `ring-1` cards for items waiting on the user, a plain table for history.

```
 Activity                                     This month: $0.43 of $5.00 · saved $0.39
 ─────────────────────────────────────────────────────────────────────────────────
 Needs you (1)
 ┌───────────────────────────────────────────────────────────────────────────────┐
 │ Flashcards · "Lecture 11" · Price went up: ≈$0.08 now (was ≈$0.04)            │
 │ the model changed to claude-sonnet-5            [Run at $0.08]  [Cancel]       │
 └───────────────────────────────────────────────────────────────────────────────┘
 Ready (2)
 ┌───────────────────────────────────────────────────────────────────────────────┐
 │ Study guide · "Lecture 10" · 2 sources · $0.041 · 3h ago       [Open]  [⋯]    │
 └───────────────────────────────────────────────────────────────────────────────┘
 In progress (1)
   Compare sources · "RS lectures" · Sent · half price · 12 min ago   [Cancel]

 History            [All jobs ▾] [All states ▾] [Last 30 days ▾]
 When        Job            Note          Trigger       State      Cost     Result
 Sun 22:00   Flashcards     Lecture 9     Weekly        Skipped    $0       —
 Sat 18:12   Study guide    Lecture 10    New source    Applied    $0.041   Lecture 10 ↗
 Fri 09:30   Study guide    Lecture 8     Run later     Expired    $0       —
```

**Columns:** When · Job · Note · Trigger (`Run later`, `New source`, `Weekly`/`Daily`) ·
State (§3 words) · Cost (what was charged; `free`; `$0` for skipped/expired/cancelled) ·
Result (link to the note it went into, or `—`).

**Filters:** job, state, trigger, date range (7 / 30 / 90 days). Default: all, 30 days.

**Row actions (⋯):** Open (ready) · Undo (applied, while Undo is possible) · Run again ·
Cancel (queued/submitted) · Stop this schedule / Turn off this trigger · Delete from
history (removes the row and any unapplied result).

**Expanded row** (click the row):
- Sources used, each with its title; `1 source changed after this job was queued` if stale.
- Model · provider · price mode · input/output tokens (`estimated` if the provider did not
  report usage, as today).
- **Cost, honestly:** `Paid $0.041 · the same job run now would be $0.082 · saved $0.041`.
  When there is no saving (normal mode) the line is just `Paid $0.08`; local: `Free`. No
  saving is claimed for `price unknown`.
- Timeline: queued 18:10 → sent 18:12 → ready 18:40 → applied 19:02.
- Error or reason in full, for failed / blocked / expired.

**Header totals:** month spent across **all** AI (from `ai_runs`, so the monthly cap is real)
vs the monthly cap; "saved" = sum of `live_equivalent_usd − actual_usd` for batch jobs.

**Empty state:** `Nothing has run in the background yet. In any chat, type /study-guide and
choose Run later — it runs at half price when your provider allows it.` (Last clause shown
only if the current provider has batch.)

**Retention:** job rows 90 days. An unapplied result is kept 30 days, then removed
(`Result removed after 30 days — Run again`). `ai_runs` keeps its own retention (unchanged).

## 5. How the result reaches the user

Three places, no push, no email (the app has no realtime by design; the bell polls every 45s):
1. **Bell** — one `db_notifications` row per finished job, `source = "job:<id>"`:
   `Study guide for "Lecture 10" is ready` → links to the note with `?job=<id>`. Also for
   `needs_you`, `failed`, `expired`, `budget_blocked` (each with its reason). Not for
   `skipped` (noise).
2. **The note** — opening a note that has a ready job shows the existing result card
   (`PanelJobCard`) at the top of its AI panel, labelled `Background · ready 3h ago`.
   Same buttons: Put in note / Insert here · Preview · Try again · Copy · Discard, then Undo
   after applying. No second card design.
3. **Activity** — sidebar badge + the Ready section (§4).

**Apply = the same code path as a live result.** The card sends the job's `result_html`
through the existing apply flow (new note if the target note is not empty, per the panel
rule; Insert here otherwise), records the AI version (022, style learning keeps working),
and Undo works exactly as today.

**Stale check.** At queue time the job stores a hash per source (the extracted text) and
the note's `updated_at`. When the card opens:
- a source changed or was added → `Made from an older version of "Slides.pdf".` with
  **Try again** priced on the button (half price → queues again; or Run now). Put in note
  still works — the user decides.
- a source was deleted → `Made from a source you have since deleted.` Same choices.
- the note was edited → nothing to warn about: the job is additive, it never replaces text.

## 6. Budgets and safety

**Three caps, all reusing `services/ai/budget.py`:**

| Cap | Default | Where set | Checked |
|---|---|---|---|
| Per job | $0.50 (existing `max_usd_per_run`) | per trigger/schedule; Run later uses the global | pre-flight at submit, and the `budget.limit()` context around the call |
| Per schedule / trigger | $1.00 a month | the schedule form / the rail line | pre-flight: month spend of this trigger + estimate |
| All AI, monthly | $5.00 | Settings → Background jobs | pre-flight for background jobs only; live runs are never blocked by it (the user is watching) |

**At a cap:** the job goes to `budget_blocked` with the numbers (§3), the bell says so, the
trigger stays on. A schedule that hits its month cap pauses itself until the 1st:
`Paused — reached $1.00 this month. Resumes Oct 1 · Raise limit`. An unpriced model
(`price unknown`) cannot trip a cap (existing rule in `Budget.would_exceed`); the UI shows
`price unknown — no limit applies` beside such a job, so this is visible, not silent.

**Batch cost accounting:** `ai_runs` gets `price_mode` (`live` | `batch`) and the row's
`estimated_usd` is the discounted price, so the month total is what was really paid.

**Additive only — enforced in code, not in the prompt:**
- The worker calls `produce_skill_result` (text in, document out) and writes **only** its
  own `ai_jobs` row. It has no handle to `notes`, `note_synthesis`, or the agent tools.
- Only the user's click on the card writes a note, through the existing apply endpoint.
- A test asserts the worker path makes no write outside `ai_jobs`/`ai_runs`/`db_notifications`.

**Prompt injection:** source text is untrusted and no one is watching. So a background run
gets **no tools** — one prompt, one completion. A skill that declares tools is not eligible
(§1). The worst a hostile PDF can do is shape the text of a draft the user reads before
applying. Output passes the same `markdown_to_html` sanitising path as today; links in the
result are shown, never followed.

**Nothing invisible:** every trigger is listed in Settings → Background jobs with an on/off
switch; every job is in Activity; the rail shows an active per-note trigger; everything
queued or sent has Cancel.

## 7. Edge cases (all decided)

The worker is the existing in-process APScheduler (`scheduler.py`), one more tick function
`_tick_jobs` every 60s: submit due jobs, poll sent batches, run due live/local jobs. It only
runs while the backend runs — said plainly in the UI (§2 local line, §10).

| Case | Decision |
|---|---|
| App closed while a job waits (queued) | Nothing runs. On next start the tick picks it up; the card says `Ran late — the app was closed at 22:00`. |
| App closed after a batch was sent | The provider keeps working. On start the tick polls, collects results (kept by the provider for days), marks ready. No re-send. |
| Laptop asleep at schedule time | Same as closed: a missed occurrence runs once on wake, never once per missed period. Missed by more than one period → only the latest runs; the others show `Skipped — missed while the app was off · $0`. |
| Two triggers fire for the same source (e.g. new-source + weekly) | Dedupe key = (skill, note, source-hash set). While a job with that key is queued/sent/ready-unapplied, a second trigger attaches to it (`Also asked by: Weekly`) instead of creating a job. |
| Duplicate submission (double click, restart mid-submit) | Submit is a claimed transition (`UPDATE … WHERE status='queued'` returns one row). Each batch request carries `custom_id = job id`; `provider_batch_id` is stored in the same step. After a crash between send and store, the tick lists recent batches and matches `custom_id` before re-sending. |
| Source deleted while queued | Remaining sources ≥ what the skill needs → run on the rest, card says `Ran without "Slides.pdf" (deleted)`. Otherwise → `cancelled — the source was deleted`. |
| Source deleted after sending | Result still delivered, flagged stale (§5). |
| Note deleted (to Trash) | Queued jobs cancel (`the note was deleted`); a ready result stays in Activity 30 days and **Put in note** creates a new note. Triggers on that note are turned off. |
| Provider key removed | AI providers page warns inline before removal: `2 background jobs use this key. Removing it cancels them.` [Remove and cancel] [Keep]. Removal cancels sent batches at the provider first (anything already finished is still charged — said in the copy). Queued jobs then re-price on the next provider at submit (may land in `needs_you`). |
| Batch expired after 24h | `expired`, `$0` (unfinished batch requests are not billed). Bell notifies. Buttons: **Run now · $0.08** (normal price shown) / **Queue again · ≈$0.04**. Never auto-rerun. |
| Model changed mid-wait | Queued → re-priced with the new model at submit; ≤ +25% runs, more → `needs_you`. Sent → keeps the model it was sent with; the card names that model. |
| Cancel a sent batch | Calls the provider's cancel. Copy: `Cancelling… anything already finished is still charged.` Final state shows what was charged, often $0. |
| Schedule cost creep over weeks | (1) runs only when sources changed; (2) month cap per schedule, pauses at it; (3) after **3 ready results in a row never opened**, the schedule pauses itself: `Paused — you haven't opened the last 3 results · Resume`. (4) Activity header shows month total vs cap. |
| Background job while a live draft exists on the note | No conflict: jobs never touch `note_synthesis`. Both cards can be shown; each applies separately. |
| Provider down / 5xx at submit | Retry on the next tick, up to 3 times over ~30 min, then `failed — <provider> did not answer`. No silent switch to another provider (price may differ); switching goes through the `needs_you` rule. |
| Result truncated (hit output cap) | Same flag as live runs (E13): card shows the truncation notice; state is ready, not failed. |

## 8. Build plan

Each milestone ships alone and is tested alone. Free = pytest with a fake provider and a
fake clock, or the free OpenRouter model. Live browser runs use the user's real data:
delete every note a test creates, undo every apply (see memory: tests touch real notes).
Migration 025 is applied by the user before M1's live pass.

| # | Milestone | Free test proves | Live browser check | Paid run |
|---|---|---|---|---|
| M1 | **Run later, normal/local price.** `ai_jobs` + 025, `_tick_jobs` runs due jobs live via `produce_skill_result`, result on the row, bell notification, result card in the note with `Background` label, Cancel. Split send button. | state machine (queued→running→ready→applied/discarded, cancel, failed); worker writes nothing outside its tables; one formatter never prints `≈$0.000` | `/flashcards` → Run later on the free model → bell → open note → Put in note → Undo → note back as before | none |
| M2 | **Activity page + caps.** `/brain/activity`, sidebar entry + badge, filters, expanded row, retention job; Settings → Background jobs with monthly cap; `budget_blocked` path. | cap math (per job, per trigger, monthly) incl. unpriced model; retention removes results at 30 days, rows at 90 | set monthly cap to $0.01, queue a priced job → `Not started — … over your $0.01 monthly limit` visible in Activity and the bell | none |
| M3 | **Batch mode.** Provider capability flag, Anthropic Message Batches adapter (submit, poll, collect, cancel), `price_mode` on `ai_runs`, saving line, `expired`, `needs_you` on price rise, `custom_id` reconcile. | fake batch adapter: expired → $0, cancel mid-way, crash between send and store does not double-send, model change → `needs_you` | queue `/flashcards` Run later on Haiku 4.5 → `Sent · half price` → ready → expanded row shows `Paid … · saved …` matching `ai_runs` | **yes**: 1 flashcards + 1 one-source study guide on Haiku, batch ≈ $0.05 total |
| M4 | **When a source is added.** Rail line, `ai_job_triggers`, settle rule (2 min after last indexed), dedupe key, rail status + Turn off. | 3 sources dropped → 1 job; second trigger attaches, not duplicates; note deleted → trigger off | drop 2 PDFs into a test note with the trigger on (free model) → one job in Activity → Discard → delete test note | none |
| M5 | **Schedules + staleness.** Schedule form, missed-run rule, skip-if-unchanged, month-cap pause, 3-unopened pause, stale check on the card, key-removal warning. | fake clock: sleep across 3 periods → 1 run + 2 skipped; unchanged sources → skipped $0; stale hash → warning shown | weekly schedule on a test note, "run now" from the row; change a source → card says `Made from an older version…` | optional: one scheduled batch run to confirm end to end, ≈ $0.03 |

Total real spend: about **$0.10**, well under $1. M3 is the only milestone that must spend.

## 9. Open questions (need the user)

1. **Does a per-note "When I add a source: study guide in the background" conflict with
   the recorded "On source drop: suggest — never auto-generate"?** Recommended: allow it as
   an explicit per-note opt-in, visible on the rail with Turn off; the global default stays
   `suggest` and nothing runs for a note the user did not set up.
2. **Monthly all-AI cap default.** Recommended: $5.00, applied to background jobs only (live
   runs are never blocked by it, since the user is watching them).
3. **Activity shows background jobs only, or every AI run?** Recommended: jobs only in v1;
   the header's month total still counts all AI from `ai_runs`, so the cap is honest.

## 10. Honest limits

- **The saving is small per run.** Haiku 4.5 is $1 in / $5 out per million tokens. A
  45K-token study guide (≈25K in / 20K out) costs ≈$0.125 live and ≈$0.063 on batch:
  about **6 cents saved**. The typical guide in `ai_runs` (8.5K in / 9.3K out) saves about
  3 cents. It adds up over a semester of weekly jobs; it is not a reason to wait on its own.
  The real value is "queued and forgotten", not the price.
- **Only Anthropic has batch in v1.** OpenRouter and most OpenAI-compatible providers run
  at normal price; local models are free but need this computer on.
- **Nothing runs while the backend is off.** There is no server in the cloud; a schedule at
  22:00 with the laptop closed runs when it wakes. A sent batch does finish at the provider.
- **No chat, no agent loop, no tools, no selection skills in the background.** Single-shot
  jobs only. The chaptered study guide (3+ sources) runs in the background at normal price.
- **Prompt caching and batch:** both discounts can apply, but cache hits inside a batch are
  not guaranteed; the estimate assumes no cache hit, so it errs high.
- **"Ready within a few hours" is a range, not a promise** — up to 24h, then `expired`.
- **No mobile/Android surface** in this spec; Android parity #20 would read the same
  endpoints later.
