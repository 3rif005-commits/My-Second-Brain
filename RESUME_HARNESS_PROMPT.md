# Paste this to continue the harness work (copy everything inside the fence)

The same text is scheduled to fire automatically overnight (see the bottom).

```
Continue the AI harness work on Second Brain, UNATTENDED — I am asleep and will
not answer. Decide and execute. Branch: feat/ai-harness.

FIRST, FIND WHERE THE LAST RUN STOPPED (this prompt may fire several times):
  cd /home/ayoub/projects/second_brain && git status --short && git log --oneline -5
  grep -n "\[~\]" docs/superpowers/plans/HARNESS_PROGRESS.md
- A task marked [~] with uncommitted changes = a previous run died mid-task.
  Read the diff, finish it or revert it, never start it over blind.
- If the "Next action" list in HARNESS_PROGRESS.md is empty, or everything left
  is blocked on me: run the MORNING SMOKE PASS below once, then stop.

STATE — read in this order, only the parts you need:
1. docs/superpowers/plans/HARNESS_PROGRESS.md — "Next action", Decisions (binding), Blocked
2. HARNESS.md — the rules; each names the failure that bought it
3. the experiment card for the task you pick (docs/superpowers/experiments/)

THE QUEUE (from HARNESS_PROGRESS.md "Next action", in order):
0. Truncation: rs-lectures-two hits the 16,000 output-token cap 3/3 on Claude.
   First detect it (stop_reason == "max_tokens" / finish_reason == "length")
   and record it on the run + show "note was cut off" in the UI — that is a
   bug fix, no experiment needed. Then the experiment (card E13): cap 24K vs
   tighter length rules; primary = pass rate on rs-lectures-two, guardrails =
   anchors and $/run. n=3.
1. compare-sources quality: leaked extractor labels ("C-01", "INS-06") and
   coverage differences called "Contradiction". Guard in the eval first, then
   change the skill, measure n=3.
2. E6b (format vs spec length) with anchors/text_chars floors.
3. The blocked-chip reason when a source FAILED processing.
4. Study-guide skill migration (unblocked — mastery_guide.py is committed).
5. Run card.

BUDGET — HARD LIMITS FOR TONIGHT
- Model spend: stop starting new paid runs once the night's total passes $3.
  Sum it from the eval reports' "spent this run" lines (evals/reports/*.json
  newer than the last session-log entry). rs-lectures-two costs ~$0.10/run.
- Paid Claude only for runs that DECIDE something (Decisions table rule).
  Plumbing: --dry-run first, always.
- Your own tokens: read files with grep/sed ranges, not whole files. Never paste
  whole reports; print only the summary lines you need.

BROWSER CHECKS — CHEAP BY DESIGN
Every change that touches the UI gets a live check, but through the existing
Playwright specs (scripted, headless, text results), NOT the claude-in-chrome
extension and NOT by reading many screenshots:
- Stack (3.8GB RAM — nothing else running):
    S=/tmp/sb; mkdir -p $S
    ~/llama.cpp/build/bin/llama-server -m ~/llama.cpp/models/nomic-embed-text-v1.5.f16.gguf --port 8081 --embedding --ctx-size 2048 --batch-size 2048 -ngl 0 > $S/embed.log 2>&1 &
    (cd backend && env -u PYTHONPATH ./.venv/bin/uvicorn main:app --port 8000 > $S/backend.log 2>&1 &)
    (cd frontend && NODE_OPTIONS=--max-old-space-size=2048 npm run build > $S/build.log 2>&1 && npm run start > $S/frontend.log 2>&1 &)
  Backend runs from .venv (runtime); tests use venv. Never `next dev`.
  Stop by pid from `ss -ltnp | grep -E ":3000|:8000|:8081"` — never pkill a
  pattern in your own command line.
- Free specs (no model call): npx playwright test --project=workspace-skills
- Paid specs, one call each, only after a change they cover:
    npx playwright test --project=skills-live e2e/selection-skills-live.spec.ts
    LECTURE_A=backend/evals/corpus/sources/pdf/rs-lecture-2.pdf LECTURE_B=backend/evals/corpus/sources/pdf/rs-lecture-3.pdf npx playwright test --project=skills-live e2e/compare-sources-live.spec.ts
- Read results as text (--reporter=line, grep passed|failed|Error). Open ONE
  screenshot only when a test fails and the error text does not explain it.
- A new UI feature gets a new spec in e2e/, not a manual click-through.
- Cheaper model: you MAY hand "start the stack, run these specs, report
  pass/fail + error lines" to ONE subagent with model "haiku" — it only runs
  and reports, it never edits, so a dead session loses nothing. Everything
  that writes code stays inline.

MORNING SMOKE PASS (once, at the end of the night)
Start the stack, run workspace-skills (free) and selection-skills-live (one
call), stop the stack, and write the result into HARNESS_PROGRESS.md
"Last session" so I see at a glance whether the app works.

HOW TO WORK
- One change at a time. After each task: backend suite
  (cd backend && env -u PYTHONPATH ./venv/bin/python -m pytest -q; the ~448
  test_db_* errors are a missing local Postgres), vitest if frontend changed,
  the relevant spec live. Commit after every completed task with this
  session's attribution lines. Never push.
- Experiments: a card in docs/superpowers/experiments/, primary + guardrail,
  n>=3. Guardrail regresses → revert and say why. Kept → one line in HARNESS.md.
- Anything new and genuinely a decision: take the reversible option, add one
  line to the Decisions table, carry on.
- Never claim it works because it type-checks. Say what you verified and how.
- Do not spawn subagents for anything except the haiku browser runner above.

THINGS ONLY I CAN DO — write them at the END of HARNESS_PROGRESS.md
"Blocked / needs the user", never stop to ask:
- Supabase migrations: write the SQL file, end it with a SELECT that proves it
  applied, and keep working on anything that does not depend on it.
- More lecture pairs for the corpus: say exactly what and where.

BEFORE YOU STOP (every firing, even a short one)
Update HARNESS_PROGRESS.md: statuses, "Last session", "Next action", blockers,
one session-log line with the commit sha. Commit. Stop the stack.
```

## Overnight schedule

Scheduled from the Claude Code session on 2026-09-24 with `CronCreate`: the
prompt above fires every few hours while that terminal stays open. The jobs
live only in that session — if Claude Code exits, paste the prompt by hand.
