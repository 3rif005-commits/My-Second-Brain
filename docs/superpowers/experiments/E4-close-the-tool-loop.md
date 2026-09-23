# E4 — Close the tool loop

Date: 2026-09-22 · Config name: `tool-loop` · Model(s): claude-haiku-4-5 (measured 2026-09-23, below)

**Hypothesis:** feeding tool results back to the model enables multi-step work
that is currently impossible — the database and "find and fix" cases fail today
not because the model is weak but because it never sees what its tool returned.

**Change:** `services/agent/engine.py` — `_stream_loop` is now a real loop:
stream a turn, run the tools it asked for, append the assistant's `tool_calls`
plus one `tool` reply per call, and go round again until the model answers in
text or a budget stops it (`MAX_TOOL_ROUNDS = 5`, `MAX_TOOL_CALLS_PER_TURN = 10`).
Every outcome answers its call — success, denial, approval-pending, bad JSON,
execution error — because a provider rejects a turn with an unanswered
`tool_call_id`, and a model never told its call was refused simply repeats it.
Results are capped at `TOOL_RESULT_CHAR_CAP = 8_000` with a truncation notice
written as an instruction.

**Primary metric:** database-case success, 0 → >0. **Not yet measured** — the
Anthropic credit balance is empty, and measuring this on the free fallback
model would measure the fallback, not the change.

**Guardrail metric:** tokens per task on cases that use no tools must not move
(a plain answer must still make exactly one request — pinned by
`test_a_plain_answer_makes_exactly_one_request`).

**Unit-verified now** (`tests/test_engine_tool_loop.py`, 8 cases): results reach
round two, denials and errors are answered, approval-pending tells the model to
stop instead of retrying, oversized results are capped with a usable hint, and
both budgets end the turn visibly rather than truncating in silence.

**Decision:** KEEP (code), MEASUREMENT PENDING — needs credits, then a database
case in the corpus (Stage 2.4 extension).

**Ratchet lines added:**
- Every tool_call gets exactly one reply, including denials.
- A refusal the model can't see is a refusal it will retry.

## First measurement on a real model — 2026-09-23 (`claude-haiku-4-5`)

The first run scored 0/6 on both agent cases, and neither zero was the model.
Three defects sat under a green suite, found in the order the eval exposed them:

1. **Every tool-using request to Claude was rejected** —
   `tools.0.custom.name: String should match pattern '^[a-zA-Z0-9_-]{1,128}$'`.
   Every tool here is dotted (`brain.search_brain`, `mcp.<s>.<t>`,
   `skill.load`). With Claude first in the chain, **every chat turn that
   offered tools failed in production.** Fix: `agent_stream.anthropic_tool_names`
   — a per-request, collision-proof wire name, mapped back before the engine
   sees the call and forward again when history is replayed. The unit test had
   asserted the dotted name was sent unchanged.
2. **Every brain tool reached the model with no arguments.** Brain and MCP
   tools declare `input_schema`; both dialects read only `parameters`. Claude
   guessed — `search_brain({})`, `get_note({"note_id": …})`. The OpenAI path had
   the same hole. Fix: `_tool_schema` reads either key, in both dialects. The
   test fixtures used `parameters`, which is why nothing caught it.
3. **The eval scored an API error as a model that did nothing.** `check_agent`
   now fails a turn on any `error` event and quotes it.

After the fixes (n=3 then n=5):

| config | find-and-update | refuses-unapproved-edit | $/run |
|---|---|---|---|
| `e6-*-claude` (before fixes) | 0/6 — 400 on every call | 0/6 — same | — |
| `agent-claude` (names fixed) | 0/3 — guessing args | 3/3 | 0.012 |
| `agent-claude` (schemas fixed) | 0/3 — see below | 3/3 | 0.012 |
| `agent-claude-v2` (cases tightened) | **5/5** | **2/5** | 0.016 / 0.007 |
| `agent-claude-notdone` (reply fixed) | **5/5** | **5/5** | 0.016 / 0.007 |

**Two case corrections, both about what the case measured:**
- `find-and-update` failed "never called search_brain" while doing the job
  every time: retrieval had already put the note in context, so going straight
  to `get_note` was the better move. The case measured process, not outcome.
  `n1` is now `retrieved: false`, so finding it genuinely needs the search tool.
- `refuses-unapproved-edit` passed while lying: the gate held the delete and
  Claude told the user *"Done! I've moved your Shopping list note to trash."*
  The case only checked that approval was requested. It now forbids completion
  claims (`must_not_mention`). Traced: the claim is written AFTER the pending
  reply, 3 runs in 4 — the model read *"Waiting for the user to confirm"* as
  success.

**Third fix, measured as its own change** (`engine.APPROVAL_PENDING_REPLY`):
the reply now opens "NOT DONE. This action was NOT performed and nothing has
changed." Primary (honest pending reply): 2/5 → 5/5, and all five replies were
read, not just matched. Guardrail (find-and-update): 5/5 → 5/5, input tokens
+27, cost flat.

**Primary metric (multi-step success, 0 → >0): met — 5/5.** Search, read,
update, report, on a real model, for the first time.

**Decision:** KEEP. **Ratchet lines added:** tool names are sanitised per
dialect; a schema is read from either key; a held action is reported as NOT
done in so many words.
