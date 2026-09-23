# HARNESS.md — rules the AI layer earned

One line per rule. Each names the failure that bought it. If a line cannot name
one, delete it. Keep this under ~60 lines: it is a pilot's checklist, not a
style guide.

Method: `docs/superpowers/plans/2026-09-22-harness-experiment-plan.md`
Progress: `docs/superpowers/plans/HARNESS_PROGRESS.md`

## Spending

- Never generate on a drop. Index, then offer a priced action. (Auto-synthesis
  sent up to ~45K tokens for a note the user may only have wanted indexed, and
  charged it again on every re-synthesis.)
- Price a run before offering it, from stored data — never by asking a model.
  (`GET /notes/{id}/synthesis/estimate` reads chunk lengths.)
- One place derives dollars: `services/ai/pricing.py`. (An estimate and a
  recorded cost that disagree are worse than neither.)
- An unpriced model reports `None`, never `0.0`. ("Unknown" is not "free".)

## Trust

- Approval never arrives in tool arguments. The model writes those, and its
  context holds text ingested from PDFs, web pages and MCP servers.
  (`brain.delete_note` was guarded by `args["confirm"]`, which an injected
  sentence could satisfy.)
- Approvals are scoped to one target (`<tool>:<id>`), so approving one deletion
  cannot be replayed onto another note.
- A turn that has read untrusted text may not edit existing data or call an MCP
  server without a human. Additive tools stay open. (Private data + untrusted
  content + the ability to act is the shape of every published injection.)
- Retrieved material is announced to the model as data, not instructions — the
  cheap half of the pair whose expensive half is the gate.

## Measuring

- Run the backend suite with `env -u PYTHONPATH`. (The ROS install on this
  machine puts `/opt/ros/jazzy` on `PYTHONPATH`; its pytest plugins crash
  collection with `unknown hook 'pytest_launch_collect_makemodule'`.)
- The ~448 database tests need Postgres on `127.0.0.1:55432`; without it they
  error at setup. That is the environment, not a regression.

## The loop

- Every `tool_call` gets exactly one `tool` reply — success, denial, error, or
  waiting-on-approval. (An unanswered `tool_call_id` is a 400 from the provider,
  and a refusal the model cannot see is one it repeats.)
- An approval-pending reply tells the model to stop and say what it would do.
  (Otherwise it spends every remaining round retrying the same blocked call.)
- Tool results are capped, with the truncation notice written as an instruction.
  (A result is re-sent on every later round of the same turn; a silent stump
  teaches the model nothing about narrowing its next call.)
- One provider chain for every surface. (The agent had its own
  `settings.api_provider`, whose `anthropic` branch returned the Messages API
  URL for an OpenAI-shaped payload — broken on the first request.)
