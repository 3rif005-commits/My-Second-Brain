# Paste this to continue the harness work (copy everything inside the fence)

```
Continue the AI harness work on Second Brain. I am not reviewing steps — decide
and execute. Branch: feat/ai-harness (already checked out, clean).

STATE — read these first, in this order:
1. docs/superpowers/plans/HARNESS_PROGRESS.md   ← source of truth: decisions, task list, blockers, and the measurement queue
2. docs/superpowers/plans/2026-09-22-harness-experiment-plan.md   ← the method: scoreboard, one change at a time, ratchet
3. HARNESS.md   ← the rules this work earned, each naming the failure that bought it
4. docs/superpowers/experiments/   ← E4, E6, E7 cards and what is still undecided

WHAT CHANGED SINCE THE LAST SESSION
I have topped up the Anthropic API credits (Console → Billing, same org as the
key in backend/.env), and I have committed or stashed my edits to
backend/prompts/mastery_guide.py.

Check both before trusting them:
  cd backend && env -u PYTHONPATH ./venv/bin/python -c "import httpx; from core.config import settings; print(httpx.post('https://api.anthropic.com/v1/messages', headers={'x-api-key': settings.anthropic_api_key, 'anthropic-version':'2023-06-01','content-type':'application/json'}, json={'model':'claude-haiku-4-5','max_tokens':8,'messages':[{'role':'user','content':'say ok'}]}, timeout=30).status_code)"
  git status --short
A 200 means credits are live; 400 with "credit balance is too low" means they
landed in a different organisation than the key — tell me, do not work around it.
If the balance is live, remove the AI_DISABLED_PROVIDERS=anthropic line from
backend/.env so Claude is first in the chain again.

FIRST TASK — THE MEASUREMENT QUEUE (in order, ~30 minutes, well under $1)
Everything below is already built and has never met a real model. Run it, write
the numbers into the experiment cards, and tell me what they decide.
1. E6 on Claude: both arms, n=3, then `python -m evals.compare`. Keep or revert
   the Markdown variant on the evidence.
2. `--family agent --runs 3` — the first measurement of the tool loop and the
   approval gate.
3. Run compare-sources on two real lecture PDFs through the UI and show me the
   note it wrote.
4. E7: AGENT_SKILL_DISCLOSURE=index against the agent cases.
Then continue down HARNESS_PROGRESS.md: the study-guide skill migration, the
selection menu, the run card.

HOW TO WORK
- Do not ask me to choose. The "Decisions" table in the progress file is
  binding; if something genuinely new comes up, take the reversible option,
  write it into that table with one line of reasoning, and carry on.
- Do not spawn subagents. Work inline and write every artifact to disk as it
  lands — sessions have died before and lost finished work.
- One change at a time. After each task: run the tests, then give me the exact
  CLI command to see it working.
- Experiments need a card in docs/superpowers/experiments/, a primary metric, a
  guardrail metric, and n>=3. If the guardrail regresses, revert and say why.
- Anything kept adds one line to HARNESS.md naming the failure it fixed.
- Commit after every completed task. Use this session's attribution lines.
- Never claim something works because it type-checks. Say what you verified and
  how, and say plainly what you did not.

THIS MACHINE (3.8GB RAM — it bites)
- Backend suite: `cd backend && env -u PYTHONPATH ./venv/bin/python -m pytest -q`
  (the ~448 test_db_* errors are a missing local Postgres, not a regression).
- Playwright needs the llama.cpp generation server stopped, the frontend on
  `npm run start` (NOT app.sh's dev server), and nothing else big open:
  `npx playwright test --project=workspace-skills`.
- Next build needs `NODE_OPTIONS=--max-old-space-size=2048` and a quiet machine.
- Never pkill on a pattern that appears in your own command line — use
  `pgrep -f "[l]lama-server"` or kill by pid.

THE TWO THINGS ONLY I CAN DO
- Supabase migrations: write the SQL, print it for me to paste, and keep working
  on anything that does not depend on it. End every migration with a SELECT that
  proves it applied.
- Real lecture PDFs for the eval corpus: say exactly what you want and where to
  put them.
Batch both at the END of a message, never mid-task.

END OF EVERY SESSION
Update HARNESS_PROGRESS.md (statuses, "Last session", "Next action", blockers,
one session-log line with the commit sha), commit, and reply with: what shipped,
the commands to verify it, what you could not verify, and the exact next task.
```
