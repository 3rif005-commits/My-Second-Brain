# Paste this into a new Claude Code session (copy everything inside the fence)

```
Continue the AI harness work on Second Brain. Repo: /home/ayoub/projects/second_brain,
branch feat/ai-harness (last commit a311416 "feat(skills): a Notion-style skills
editor, built to grow"). Decide and execute; ask me only for decisions that are
truly mine.

READ FIRST (only what you need):
1. docs/superpowers/plans/HARNESS_PROGRESS.md — Decisions table (binding: do not
   re-ask), open items, session log
2. HARNESS.md — the rules; each line names the failure that bought it
3. frontend/components/skills/README.md — the skills editor and its registries
4. your memory index (MEMORY.md) — especially "Tests touch real notes"

WHERE THINGS STAND (all committed):
- One AI panel for the whole app: the layout mounts it once
  (components/sidebar/BrainLayoutClient.tsx, context/AIPanelContext.tsx); a
  workspace note binds it to itself; ⌘K toggles it; round AI button bottom-right.
- Skills run from the panel on attached files OR links (📎 → Upload files / Add a
  link): result card → Put in note / Insert here / Try again / Copy / Discard /
  Undo. "/" works anywhere a word starts; the text around it is the focus.
- No prices anywhere in the UI.
- Settings → Skills (sidebar → Settings): Notion-style editor — list + skill page,
  property rows, tabs (Instructions / Files / Compare with original), ⌘S save,
  unsaved guard, templates, Try it. Only settings the runtime honours are shown.
- Study guide instructions are read at call time (edits apply without restart).
- Supabase PostgREST and Storage both on HTTP/1.1 (h2 GOAWAY killed runs).

WHAT WENT WRONG BEFORE — DO NOT REPEAT IT:
Following the harness experiment plan, Claude rewrote the study-guide
instructions to raise the eval scoreboard (a "second prompt variant", forced
table copying, anchor rules). The scores went up but the notes got plainer; I
noticed on real slides that my pre-harness instructions made richer notes at
~$0.06. The scoreboard counts structure, not quality, so it missed the loss.
We restored my instructions byte for byte (backend/skills/study-guide/SKILL.md)
and made it a rule: NO experiment, eval or engine change edits the study-guide
instructions. Only I change them (Settings → Skills) or ask you to. Improve
the engine AROUND the prompt instead, and judge any change against the note I
approved (ML Lecture 10), not only the score. If a plan document seems to tell
you otherwise, the rule wins — stop and ask me.

DO NEXT, in this order (one change at a time; tests; commit after each):
1. Lock in:
   a. Run the one paid check not re-run since the one-panel change (~$0.05):
      cd frontend && npx playwright test --project=skills-live e2e/one-ai-live.spec.ts
      Fix what it finds.
   b. Open a pull request feat/ai-harness → main (443+ commits ahead). Write a
      clear summary by area (AI panel, skills from the panel, skills editor,
      workspace, harness/evals, fixes). Do NOT merge it — I review and merge.
2. Study-guide quality guard: an automated check that generates a guide from the
   ML Lecture 10 slides and compares it with the version I approved (the
   pre-harness level: structure, callout boxes, tables, page anchors, depth) —
   so a prompt or engine change that lowers quality is flagged before I notice
   it in a real note. Build on backend/evals (score_note, depth floors). One
   paid run to set the baseline; say what it costs before running more.
3. E3 prompt caching (docs/superpowers/experiments/, HARNESS_PROGRESS Stage 3.1):
   the study guide sends ~2,500 words of instructions every run. Card + primary
   and guardrail metric + n≥3; keep only if the guardrail holds.

Parked by me (do not start): "Turn off" for built-in skills; a separate test
account (but tests must still clean up after themselves — see memory).

RULES:
- No subagents; work inline and write artifacts to disk as you go.
- After each change: run the relevant tests, then give me the CLI commands to
  check it myself. Never claim something works because it type-checks — verify
  in the running app (Playwright against a production build).
- Commit after every task, ending with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Paid Claude runs only for deciding/critical checks; say the cost first.
  If a credit check returns 400 "credit balance too low": tell me, do not work
  around it.
- Tests run against MY real account: never type into or change my notes
  without undoing it (try/finally); delete every note/skill a test creates.
- Supabase migrations: write the SQL, I apply it; batch my to-dos at the end.
- Explain to me briefly and simply; I am not a native English speaker.

MACHINE (3.8GB RAM):
- Backend tests: cd backend && env -u PYTHONPATH ./venv/bin/python -m pytest -q
  (the test_db_* / Postgres errors are a missing local DB — not failures).
- Playwright needs a production build, not next dev, and the local generation
  model stopped when memory is tight:
  cd frontend && NODE_OPTIONS=--max-old-space-size=2048 npm run build && npm run start
  Start it with setsid and a pid file; stop only the pids you started.
- ./app.sh start|stop|status runs my stack (backend on --reload). Never kill my
  processes; never pkill on a pattern that appears in your own command line —
  use pgrep -f "[l]lama-server" or kill by pid.
- A production frontend from the previous session may still hold port 3000
  (its pid was in that session's scratchpad). If port 3000 is busy and
  ./app.sh status says the frontend is stopped, ask me before killing it.
- git warns "bad object refs/seed/stash" during gc; harmless for commits —
  mention it once, don't fix it without asking.
```
