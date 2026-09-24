# HARNESS PROGRESS — single source of truth

> Updated by Claude at the end of every session. Read this FIRST, work the next `[ ]` item,
> update it BEFORE the session ends. Never start a task without marking it `[~]` here.
> Plan: `2026-09-22-harness-experiment-plan.md` · Research: `../research/2026-09-22-agent-harness-state-of-the-art.md`
> Spec: `../specs/2026-09-13-ai-harness-skills-proposal.md`

**Status legend:** `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (say why + what's needed)

**Branch:** `feat/ai-harness`
**Last session:** 2026-09-24, overnight + 06:40 (~$2.06 of the $3 night
budget). **Morning smoke pass (06:5x, own production stack): workspace-skills
5/5, selection skill 1/1, compare-sources + Undo live — the app works.**
Shipped overnight: cut-off guides flagged + 32K cap (E13); estimate follows
sources; compare-sources label leak fixed (E14, confirmed in-app); chip names
failed sources; **study guides default to Markdown** (E6b, −41% cost, live on
two sources); study-guide prompts in `skills/study-guide/`; chat pastes only
chat skills; run card (Retry the right job, job + elapsed, Undo).
**Caveat:** the `rs-*` PDFs are AI-generated study guides, not slides —
re-check E6b on real slides. **Your app.sh stack** is stopped (you stopped it
at 06:43); nothing of mine is left running.
**Next action, in order:**
- [x] **Markdown anchor repair (E6e)** — done 2026-09-24: 9/9 on real slides,
  one live slip repaired. **Open product call:** Markdown is now −59% cost
  with tables/anchors at parity, but callouts at less than half (11–21 vs
  31–45). HTML stays default until someone decides callouts vs cost — or a
  callout experiment closes the gap.
- [x] **Tables (E6d)** — done 2026-09-24: source tables carried verbatim on
  both paths (default HTML: 9–14 → 30–35 of 23 source tables, 3/3, +14%
  cost), duplicates skipped, `<br>` fixed, unplaced tables placed beside the
  section about their page. Live on real slides: 32 tables, 0 duplicates.
- [x] Markdown path places unplaced tables by page too — 2026-09-24.
- [x] Undo refuses after an edit, live (`undo-refusal-live`, ~$0.03) — 2026-09-24.
- [x] **E6c on real slides** — done 2026-09-24: Markdown lost tables (1/3 vs 3/3); **default reverted to HTML**. Opt-in `SYNTHESIS_FORMAT=md` remains. Next try: deterministic table carry-over, measured on `iml-slides-two`.
- [x] Run card failure path, live and free (`run-card` project, MAX_USD_PER_RUN=0.001): banner names the job, Retry reruns it — 2026-09-24.
- "Contradiction" usage in compare-sources: read the runs that use it and judge.
0. [x] **Truncation on real lectures** — done 2026-09-24: detection + UI
   warning (`1b5c095`), cap raised to 32K on evidence (E13: 1/3 → 3/3, 0
   truncated, +8% cost).
0b. [x] **Pre-run estimate** — done 2026-09-24: the study-guide estimate now
   scales with source length (min 3K, max the cap) instead of a flat ~10K;
   skill estimates stay a deliberate ceiling (compare-sources used 2.2K of 10K).
1. [x] **compare-sources quality** — done 2026-09-24 (E14): the extractor's
   ID column is stripped from skill sources; leaks 1/5 → 0/5, pass 4/5 → 5/5.
   Open: "Contradiction" still appears in 3/5 runs — read them and judge;
   the study-guide synthesis still receives the IDs (unmeasured there).
2. [x] **E6b** — done 2026-09-24: Markdown + a coverage rule reached HTML's
   depth at −41% cost on `rs-lectures-two` (n=6); study guides now default to
   Markdown (`SYNTHESIS_FORMAT=md`, `63f5c5e`), HTML one env line away.
   **Caveat found after:** the `rs-*` PDFs are AI-generated study guides built
   from lecture transcripts, not slides. E13/E14/E6b were measured on that kind
   of document. **Re-run E6b on real lecture slides before trusting the
   default** — needs slide PDFs the user OKs (see Blocked).
3. [x] **Blocked reason names the source** — done 2026-09-24: a chip blocked
   for want of sources now says '"Lecture 3" failed to process — retry or
   remove it' or 'waiting for "Lecture 3" to finish processing'. Unit-tested;
   live pass (workspace-skills, 5/5) shows no regression, but the failed-source
   wording itself has not been seen in a browser (needs a source that fails).
4. [x] **Study-guide migration** — done 2026-09-24: `skills/study-guide/`
   holds both prompts (SKILL.md = Markdown path, reference/html-dialect.md =
   HTML path); the Python modules read them byte-for-byte (hashes verified
   identical). Offered on no menu. Chat now classifies only chat-surface
   skills (agent family 9/9). Open: under AGENT_SKILL_DISCLOSURE=index the
   catalogue still lists every skill. **Fixed 2026-09-24**: the index and `skill.load` are chat-surface only.
5. [x] **Run card** — done 2026-09-24: Retry reruns the failed job
   (`efca17a`), the running status names the job and counts up (`e6d22a3`),
   and Undo sits beside the receipt (`2e2793d`) — all but the failure path
   verified live.

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
| E6 outcome (2026-09-24) | Synthesis default is HTML. Markdown was default overnight (E6b) and reverted on real slides (E6c: tables 1/3 vs 3/3); opt-in `SYNTHESIS_FORMAT=md`. Skills keep writing Markdown. |
| E7 outcome (2026-09-23) | `AGENT_SKILL_DISCLOSURE` stays `inline` until the catalogue grows; `index` is proven safe (loads the right skill 5/5). |
| Supabase transport (2026-09-23) | PostgREST over HTTP/1.1 — reversible in `services/database.py`; h2 GOAWAY killed two live runs. |
| Selection skills (2026-09-23) | Run through xl-ai's own invokeAI and review (no second model path); output `insert_below` = add only, `rewrite_selection` = update only; never delete. |
| Paid vs free model (user, 2026-09-23) | Claude (Haiku 4.5) for every run that DECIDES something — experiment arms, agent/approval measurements, the first real note of a skill. Free OpenRouter model for plumbing, smoke and iteration. A deciding run whose `attempts` show a fallback is discarded, not scored. Claude is re-enabled per process (`AI_DISABLED_PROVIDERS=gemini`) until `.env` is edited. |

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
- [~] 2.4 **agent-loop cases added** (`mode: "agent"`, in-memory brain, judged
      on tools called / notes after / what it said). `backend/evals/corpus/manifest.json` + the corpus itself (**user supplies source files**;
      until then use `frontend/e2e/fixtures/test.pdf` + synthetic md/txt/website cases).
- [x] 2.5 Adversarial case: source text that tries to trigger `delete_note`. Must yield 0 write calls.
- [x] 2.6 `backend/evals/run.py` — runs the manifest n times per config, writes `ai_runs` rows +
      a JSON report, prints a comparison table.
- [~] 2.7 **E2 baseline** — 3 runs per case on current code; numbers written into the plan doc.

## Stage 3 — H2 core harness (one experiment at a time, card per experiment)

- [ ] 3.1 **E3** cache-shaped context assembly (stable prefix, volatile tail, `cache_control`).
- [x] 3.2 **E4** close the tool loop (code + unit tests; measurement pending credits) (feed results back, round cap, parallel results in one message).
- [ ] 3.3 **E5** tool-output discipline (25k cap + hint, `response_format`, errors as instructions).
- [x] 3.4 Gateway merge — **steps A and B done**: agent provider selection
      comes from `services/ai`, agent turns write run rows, and
      `services/ai/agent_stream.py` drives the tool loop in either dialect, so
      **Claude can now run the agent**. `services/descriptor.py` moved onto the
      gateway too. `services/llm.py` folded in too (330 → 158 lines, no provider
      clients left; the X-LLM-Model choice survives as the gateway's
      `model_override`). `routers/agent_inline.py` keeps its byte-level
      pass-through **deliberately** (xl-ai parses the upstream bytes itself, so
      re-encoding changes a contract only a browser can verify) but now tees
      its stream into the run log. **DONE**: `POST /v1/chat/completions` on the
      backend + `services/ai/passthrough.py`, and the Next.js `/api/ai` route
      now points the AI SDK at it instead of calling Gemini directly. Every
      model call in the app is now logged and budgeted. The one dialect still
      missing is a Gemini tool-loop adapter.
- [x] 3.5 Per-run budgets + `max_usd` guard (`services/ai/budget.py`,
      `MAX_USD_PER_RUN`, default $0.50: synthesis refuses pre-flight, an agent
      turn stops between rounds).

## Stage 4 — H3 (only after Stage 3 numbers justify it)

- [x] 4.1 **E6** Markdown+fences vs HTML — **decided on Claude** (n=3): 11/12
      vs 11/12 at −68% output tokens, but the Markdown notes are 44% shorter
      with 42% fewer anchors. Default stays HTML; E6b separates format from
      spec length. See the card.
- [x] 4.2 **E7** progressive disclosure — **decided on Claude** (n=5): index
      loads the right skill 5/5 and trims 10–16% on no-skill turns, but costs
      +46% on a turn that needs one. Inline stays default. Tool groups open.
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

- [~] 5.1 Workspace action bar — **backend done**: `services/workspace/skill_run.py`
      runs any skill over a note's sources into the same `note_synthesis` draft
      row, `GET /notes/{id}/skills` prices every offerable skill and says why one
      cannot run yet, `POST /notes/{id}/skills/{name}/run` starts it. Two real
      jobs ship (`compare-sources`, `flashcards`). **Action bar shipped** (`components/workspace/SkillBar.tsx`):
      a chip per skill under the header, each priced before the click, a
      blocked skill showing its reason instead of being greyed out, and the run
      feeding the existing draft/apply flow. **Live pass done** (`e2e/workspace-skills.spec.ts`,
      4 tests green against the running stack): chips render priced, a blocked
      skill shows its reason, and a drop indexes without generating. It caught
      one real defect — "≈$0.000" on a free model. **`/` palette done** — `useNoteSkills` is the single
      source of jobs for both the action bar and the editor's slash menu (two
      lists that could drift is two lists that will), and `BlockEditor` grew a
      generic `extraSlashItems` slot so it stays unaware that skills exist.
      Slash-menu e2e **run and green** (its selector was wrong; fixed).
      **Selection menu shipped**: skills declaring `surfaces: [selection]`
      (first: `define-terms`) lead xl-ai's AI menu over a selection, via an
      AI button now in the formatting toolbar; verified live on the inline
      model (`openai/gpt-4o-mini`). **Next**: the run card.
- [ ] 5.2 **E12** learned style playbook.
- [ ] 5.3 Background agents (triggers, budgets, activity page) on the Batch API.
- [ ] 5.4 Remote MCP server + per-user OAuth (the subscription bridge); MCP Apps UI.

---

## Never exercised against a real model (the honest list)

- `flashcards` has never produced a note (compare-sources has, once, live).
- `POST /v1/chat/completions` has never served a real editor request.
- The editor's inline AI runs on OpenRouter `openai/gpt-4o-mini` (pinned by
  `/agent/inline`), never on Claude; selection skills inherit that.
- The agent loop has run only against the eval's in-memory brain, never a real
  chat turn in the browser.
- E7's primary metric (prompt flat as the catalogue grows) needs >4 skills.

## Blocked / needs the user

1. ~~Apply 020_ai_runs.sql~~ — **applied** (verified 2026-09-24: `ai_runs` answers, 236 rows). **Was:** Apply `supabase/migrations/020_ai_runs.sql` in the Supabase SQL editor.
   Until then runs are measured from an in-process buffer (evals work, the app
   works) but nothing is persisted and no history accumulates.
2. ~~Anthropic credits~~ — **resolved 2026-09-23**. Claude is re-enabled per
   process with `AI_DISABLED_PROVIDERS=gemini`; `.env` now
   says `AI_DISABLED_PROVIDERS=gemini` (edited by you, verified 2026-09-24), so
   no per-process override is needed any more.
3. **Gemini is unreachable from `backend/venv`**: `No module named 'google'`.
   Either `./venv/bin/pip install google-genai` or accept that the second
   fallback is dead there.
4. **Real lecture SLIDES** — the first pair in (`rs-*`) turned out to be AI-generated study guides, not slides. Need a pair of genuine slide decks (e.g. two consecutive `LectNN-IML26.pdf`) with the user's OK. **Was:** ~~Real lecture PDFs~~ — first pair in (`rs-lectures-two`, 2026-09-24; PDFs local in `evals/corpus/sources/pdf/`, gitignored). More pairs still welcome. **Was:** Real lecture PDFs for the corpus (task 2.4) — drop them in
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
- 2026-09-23 · E6 on Claude: HTML stays default (MD writes 44% less) · `a6d7980`
- 2026-09-23 · agent loop on Claude: dotted tool names 400'd, schemas dropped,
  held deletes reported "Done!" — all fixed, 5/5 + 5/5 · `82ab9ed`
- 2026-09-23 · Supabase over HTTP/1.1; first compare-sources note, live · `44bf65c`
- 2026-09-23 · E7 on Claude: inline stays default; skill_active recorded · `8c6af2f`
- 2026-09-23 · selection menu + define-terms; editor AI edits fixed (Responses
  API vs chat/completions), selection kept across menu open · `6695e84`, `4dc8da3`
- 2026-09-24 · first real corpus case (two RS lectures); Claude baseline finds every note truncated at 16K tokens · see next commit
- 2026-09-24 · night run 1: truncation flagged + cap 32K (E13), estimate follows sources, compare-sources label leak fixed (E14), chip names failed sources; ~$1.11 spent · `1b5c095`…see log
- 2026-09-24 · night run 2 (03:17): Markdown default wired + live 2-source guide, source-type correction, study-guide skill folder, chat surface filter, Retry fix · `63f5c5e`…`efca17a`
- 2026-09-24 · night run 3 (05:17): running status names the job + elapsed, verified live; E14 confirmed in-app · see git log
- 2026-09-24 · 06:40 session: Undo beside the receipt, morning smoke all green · `2e2793d`
- 2026-09-24 · E6c on real slides: Markdown default reverted to HTML (tables) · see next commit
- 2026-09-24 · late morning: E6c (MD default reverted), E6d table carry-over + placement, run-card failure path live · `d9ce49f`…`ab23878`
- 2026-09-24 · afternoon: Markdown anchor repair + row-exact table dedupe · `74dff6e`
