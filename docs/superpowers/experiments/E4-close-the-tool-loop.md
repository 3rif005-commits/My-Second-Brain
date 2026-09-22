# E4 — Close the tool loop

Date: 2026-09-22 · Config name: `tool-loop` · Model(s): pending (credits)

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
