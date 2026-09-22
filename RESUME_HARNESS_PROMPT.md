# Paste this to continue the harness work (copy everything inside the fence)

```
Continue the AI harness work on Second Brain. I am not reviewing steps — decide and execute.

STATE
Read these first, in this order, before touching anything:
1. docs/superpowers/plans/HARNESS_PROGRESS.md   ← source of truth: decisions, task list, blockers
2. docs/superpowers/plans/2026-09-22-harness-experiment-plan.md   ← method, metrics, experiment cards
3. docs/superpowers/research/2026-09-22-agent-harness-state-of-the-art.md   ← why (skim if short on context)
4. docs/superpowers/specs/2026-09-13-ai-harness-skills-proposal.md   ← the target architecture

Then work the next `[ ]` task in HARNESS_PROGRESS.md. Mark it `[~]` before you start and `[x]`
when it is done and tested. Do as many tasks as your context allows, in order.

HOW TO WORK
- Do not ask me to choose. Every decision is already in the "Decisions" table of the progress
  file; if something genuinely new comes up, pick the reversible option, write it into that
  table with one line of reasoning, and carry on.
- Do not spawn subagents to do the work. Work inline and write every artifact to disk as it
  lands — sessions have died before and lost finished work.
- One change at a time. After each task: run the tests, then give me the exact CLI command(s) I
  can run to see it working.
- Branch: `feat/ai-harness`. If it does not exist, create it from the current branch (commit or
  stash anything already dirty first, separately). Commit after every completed task with a
  clear message. Use the attribution lines from this session's system reminder.
- Experiments (E3+) need a card in docs/superpowers/experiments/, a primary metric, a guardrail
  metric, and n>=3 runs. If the guardrail regresses, revert and record why.
- Anything kept adds one line to HARNESS.md at the repo root naming the failure it fixed.
- Never break the app: `./app.sh start` must still work, backend tests stay green, `tsc` and
  `npm run build` stay clean.

THE TWO THINGS ONLY I CAN DO
- Supabase migrations: you have no direct DB access. Write the SQL file, then print the exact
  SQL for me to paste into the Supabase SQL editor, and keep working on anything that does not
  depend on it. Every migration must end with a SELECT that proves it applied, and must set
  search_path if it mentions `vector`.
- Eval corpus source files: if you need real lecture PDFs I have not supplied, list exactly what
  you want and where to drop them, and meanwhile build the corpus with synthetic/fixture cases
  so the runner is finished and testable.
Batch these requests at the END of your message, never mid-task.

END OF EVERY SESSION (do this before you run low on context)
1. Update HARNESS_PROGRESS.md: task statuses, "Last session", "Next action", blockers, and one
   line in the session log with the commit sha.
2. Commit.
3. Reply with: what shipped, the CLI commands to verify it, anything you need from me, and the
   exact next task.

DONE means: Stage 1 and 2 complete, and Stage 3 experiments each have a card with numbers
showing whether they were kept or reverted.
```
