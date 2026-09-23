# HARNESS PROGRESS — single source of truth

> Updated by Claude at the end of every session. Read this FIRST, work the next `[ ]` item,
> update it BEFORE the session ends. Never start a task without marking it `[~]` here.
> Plan: `2026-09-22-harness-experiment-plan.md` · Research: `../research/2026-09-22-agent-harness-state-of-the-art.md`
> Spec: `../specs/2026-09-13-ai-harness-skills-proposal.md`

**Status legend:** `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (say why + what's needed)

**Branch:** `feat/ai-harness` (created, 3 commits)
**Last session:** 2026-09-22 — Stage 1 complete; Stage 2 built and baselined
**Next action:** measurement is blocked — the free tier's daily quota is spent
(429s) and Anthropic has no credits. Unblocked and useful meanwhile:
agent-loop eval cases, which E4 (the tool loop) and E7 (progressive disclosure)
both need and which the corpus has never had. When credits exist, the first run
is E6 on Claude (~$0.25). Measurement-bearing cards (E3, E5, E6) are parked until
the Anthropic balance is topped up; measuring them on the free fallback model
would measure the fallback.

**Run the backend suite with `env -u PYTHONPATH`** — this machine's ROS install
puts `/opt/ros/jazzy` on PYTHONPATH and its pytest plugins crash collection:
`env -u PYTHONPATH ./venv/bin/python -m pytest -q` from `backend/`.
The ~448 `test_db_*` / `test_note_row` errors are a missing local Postgres on
`127.0.0.1:55432`, not a regression — 1440 tests pass without it.

---

## Decisions already made (do NOT re-ask the user)

| Decision | Value |
|---|---|
| On source drop | `suggest` — never auto-generate. Extraction + embedding only. |
| Model tiers | fast = `claude-haiku-4-5` · standard = `claude-haiku-4-5` (revisit after E6) · deep = `claude-sonnet-5` only if an eval justifies it |
| Output format | Keep BlockNote HTML until E6 measures Markdown+fences; switch only if the eval says so |
| User skills storage | Bundled skills stay files. User-authored skills deferred to H3 — do not build now. |
| Framework adoption | None. No CrewAI/LangGraph/Temporal. Plain Python in `services/`. |
| Subagents | Do not spawn Claude Code subagents for execution. Work inline, write to disk as you go. |

---

## Stage 1 — Stop the bleed + fix the hole (no eval needed)

- [x] 1.1 **E1** — `workspace_on_drop` setting (`nothing|suggest|auto`, default `suggest`); gate
      `processor.py:240` `maybe_synthesize`; keep `POST /notes/{id}/synthesize` manual path intact.
- [x] 1.2 **E1 UI** — Workspace shows a "Generate study guide" action with a token/cost estimate
      (estimate computed locally from chars/4 × price, no model call).
- [x] 1.3 **E11a** — `brain.delete_note` confirmation must come from the client, not from
      `args["confirm"]` (`services/agent/permissions.py` + `engine.py` + the SSE contract).
- [x] 1.4 **E11b** — mark retrieved note/source text as untrusted data in the prompt; a turn that
      read untrusted content may not call a write tool without explicit user approval.
- [x] 1.5 Backend tests for 1.1–1.4 green; CLI commands given to the user.

## Stage 2 — H1 scoreboard (the real unlock)

- [~] 2.1 `ai_runs` table migration (SQL written by Claude, **applied by the user** — see prompt).
- [x] 2.2 `services/ai/usage.py` — every model call records tokens in/out/cache, model, latency,
      surface, skill, trigger, status, cost estimate.
- [x] 2.3 `backend/evals/score_note.py` — deterministic scorer: headings, toggles-with-children,
      callouts, math blocks, tables, anchors-that-resolve, must-mention hits.
- [~] 2.4 `backend/evals/corpus/manifest.json` + the corpus itself (**user supplies source files**;
      until then use `frontend/e2e/fixtures/test.pdf` + synthetic md/txt/website cases).
- [x] 2.5 Adversarial case: source text that tries to trigger `delete_note`. Must yield 0 write calls.
- [x] 2.6 `backend/evals/run.py` — runs the manifest n times per config, writes `ai_runs` rows +
      a JSON report, prints a comparison table.
- [~] 2.7 **E2 baseline** — 3 runs per case on current code; numbers written into the plan doc.

## Stage 3 — H2 core harness (one experiment at a time, card per experiment)

- [ ] 3.1 **E3** cache-shaped context assembly (stable prefix, volatile tail, `cache_control`).
- [x] 3.2 **E4** close the tool loop (code + unit tests; measurement pending credits) (feed results back, round cap, parallel results in one message).
- [ ] 3.3 **E5** tool-output discipline (25k cap + hint, `response_format`, errors as instructions).
- [~] 3.4 Gateway merge — **steps A and B done**: agent provider selection
      comes from `services/ai`, agent turns write run rows, and
      `services/ai/agent_stream.py` drives the tool loop in either dialect, so
      **Claude can now run the agent**. `services/descriptor.py` moved onto the
      gateway too. `services/llm.py` folded in too (330 → 158 lines, no provider
      clients left; the X-LLM-Model choice survives as the gateway's
      `model_override`). `routers/agent_inline.py` keeps its byte-level
      pass-through **deliberately** (xl-ai parses the upstream bytes itself, so
      re-encoding changes a contract only a browser can verify) but now tees
      its stream into the run log. **Remaining**:
      `frontend/app/api/ai/route.ts` still calls Gemini directly from Next.js —
      it needs an OpenAI-compatible backend endpoint the AI SDK can point at;
      and a Gemini tool-loop adapter is the one dialect still missing.
- [x] 3.5 Per-run budgets + `max_usd` guard (`services/ai/budget.py`,
      `MAX_USD_PER_RUN`, default $0.50: synthesis refuses pre-flight, an agent
      turn stops between rounds).

## Stage 4 — H3 (only after Stage 3 numbers justify it)

- [~] 4.1 **E6** Markdown+fences vs HTML — **first result in**: −66% output
      tokens, 8/9 vs 6/9 on the cases that ran (free model, n=3). PROMISING,
      NOT PROVEN — needs a Claude re-run to decide. See the card.
- [~] 4.2 **E7** progressive disclosure — MCP discovery caching done; skill
      index + `skill.load` implemented behind `AGENT_SKILL_DISCLOSURE=index`
      (default `inline`). **Measurement blocked**: the corpus has no agent-loop
      cases, so the tool loop has never been measured at all. Tool groups open.
- [~] 4.3 Skill folders + frontmatter — **loader done**: `<name>/SKILL.md`
      folders alongside flat `.md`, frontmatter for surfaces/inputs/output/
      model_tier/auto/confirm, `reference()` files read on demand, `index()`
      for the metadata-only prompt listing, and `require_auto` so the
      classifier cannot fire a skill that did not opt in. **Not done**: moving
      the mastery-guide text out of `prompts/mastery_guide.py` into a
      `study-guide` skill — that file has uncommitted edits of yours, so it is
      waiting on you rather than on the code.
- [ ] 4.4 **E8** retrieval upgrades (contextual chunk prefixes, reranking).
- [ ] 4.5 **E9** map-reduce for 3+ sources.
- [ ] 4.6 **E10** model/effort tiering incl. local Gemma fast tier.

## Stage 5 — H4 (not before Stage 4 is measured)

- [ ] 5.1 Workspace action bar / `/` palette / selection menu + run cards.
- [ ] 5.2 **E12** learned style playbook.
- [ ] 5.3 Background agents (triggers, budgets, activity page) on the Batch API.
- [ ] 5.4 Remote MCP server + per-user OAuth (the subscription bridge); MCP Apps UI.

---

## Blocked / needs the user

1. **Apply `supabase/migrations/020_ai_runs.sql`** in the Supabase SQL editor.
   Until then runs are measured from an in-process buffer (evals work, the app
   works) but nothing is persisted and no history accumulates.
2. **Anthropic credits are exhausted** — `Your credit balance is too low`
   (2026-09-22, after ~$0.27 of baseline runs). Every Claude measurement is
   blocked until it is topped up; the chain currently falls back to OpenRouter's
   free Nemotron, which is a different model and cannot be compared.
3. **Gemini is unreachable from `backend/venv`**: `No module named 'google'`.
   Either `./venv/bin/pip install google-genai` or accept that the second
   fallback is dead there.
4. **Real lecture PDFs for the corpus** (task 2.4) — drop them in
   `backend/evals/corpus/sources/` and say which topics; the manifest currently
   ships four synthetic cases.

## Session log

- 2026-09-22 · docs committed (proposal, research, plan) · `2529cd7`
- 2026-09-22 · Stage 1.1–1.2: `workspace_on_drop` (default `suggest`) + priced
  `GET /synthesis/estimate` + "Generate note" CTA · `0bd3827`
- 2026-09-22 · Stage 1.3–1.4: approval gate (`NeedsApproval`, client-minted
  approval keys, untrusted-context taint, Confirm button in chat) · `5e00382`
- 2026-09-22 · Stage 2.2–2.6: `ai_runs` migration, usage recording inside the
  AI client, deterministic note scorer, eval corpus + runner · `ae60e33`
- 2026-09-22 · Stage 2.7: baseline measured on claude-haiku-4-5 (3 cases × 3
  runs, $0.27 spent); runner now surfaces provider fallbacks · `39e2117`
- 2026-09-22 · Stage 3.2 (E4): multi-round tool loop, every call answered,
  results capped, both budgets visible · `b8f5b3c`
- 2026-09-23 · Stage 3.4 step A: agent provider selection unified with
  services/ai; agent turns write run rows; found and fixed the
  API_PROVIDER=anthropic endpoint mismatch · `f40aeef`
- 2026-09-23 · Stage 3.5: per-run budget guard (pre-flight refusal for
  synthesis, between-rounds stop for agent turns) · `c7e8c45`
- 2026-09-23 · Stage 3.4 step B: `services/ai/agent_stream.py` (both tool
  dialects), engine + descriptor migrated onto it, Claude can drive the agent
  · `b4071fa`, `32a86ca`
- 2026-09-23 · Stage 3.4: `services/llm.py` folded into the gateway; model
  override preserved; error classifier kept · `2f3e8ac`
- 2026-09-23 · inline AI spend now logged (byte-level proxy kept); MCP
  discovery cached per server with a 5-minute TTL · `3f501cb`
- 2026-09-23 · migration applied by user; free-model baseline measured; found
  and fixed swallowed in-stream errors; test isolation (no production DB, no
  .env-dependent provider config) · `97b0d13`, `c486235`, `961ae90`, `7e42cc5`
- 2026-09-23 · skill loader: folders, frontmatter, on-demand references,
  metadata index, auto-gating · pending

## Decisions taken while executing (not re-asked)

| Decision | Value | Why |
|---|---|---|
| Approval transport | `AgentRequest.approvals: ["<tool>:<target>"]`, replayed by the client after Confirm | The model writes tool args, so consent cannot live there; a separate channel is the only honest one. Reversible: it is one field. |
| Untrusted taint scope | Editing existing data + any MCP call need approval once a turn has read untrusted text; additive tools stay open | Gating `create_note` would break the assistant's main job; the worst an injection then achieves is a note the user can delete. |
| Ingest surface | Always treated as untrusted (its messages ARE the uploaded document) | Cheap and correct; only affects edit/MCP paths. |
