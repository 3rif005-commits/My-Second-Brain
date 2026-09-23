# E7 — Progressive disclosure of skills

Date: 2026-09-23 · Config: `AGENT_SKILL_DISCLOSURE=index` · Model: claude-haiku-4-5 (measured, below)

**Hypothesis:** sending the skill catalogue (name + description) instead of the
matched bodies keeps the base prompt flat as the catalogue grows, at the cost
of one extra round trip when a skill is actually needed.

**Change:** `services/agent/engine.py` — under `index`, the system prompt
carries `SkillRegistry.index()` and one extra tool, `skill.load`, which returns
a body by name. Default remains `inline`.

**Primary metric:** base system-prompt tokens with 3 skills vs 10 (should be
flat under `index`, linear under `inline`).
**Guardrail:** task success on agent cases — a model that never calls
`skill.load` is a model working without instructions.

**Not yet measured.** The corpus has no agent-loop cases; it scores synthesis
only. Building those is the prerequisite, and it is worth doing anyway — the
tool loop (E4) has never been measured on anything.

**What the unit tests already establish:**
- the catalogue reaches the prompt and the bodies do not;
- `skill.load` returns the body and emits `skill_active`;
- an unknown name answers with the catalogue, not an error;
- loading needs no permission tier, including in an untrusted-context turn.

**Crossover worth remembering:** with two 30-character skills the index is
LARGER than the bodies it replaces. This trade only pays once bodies or
catalogues are big. A test documents it, because the intuition runs the other
way.

**Known limitation:** a skill's `tools` whitelist is applied when the request
is built, so a skill loaded mid-turn can instruct but cannot narrow the tool
list already sent. Re-sending tool definitions to narrow them would invalidate
the prompt cache for the rest of the turn.

**Decision:** KEEP (code, default off), MEASUREMENT PENDING agent-loop cases.

## Measured on Claude — 2026-09-23 (`claude-haiku-4-5`, n=5 per arm)

Baseline `agent-claude-notdone` (inline) vs `e7-index`, plus a new case built
for the guardrail, `agent-needs-a-skill` ("Make flashcards from my gradient
descent note"), which fails if the flashcards skill was never active. The
runner now records `skill_active` events per run — `skill.load` is answered by
the engine, so it never appeared in the brain's tool list and a first count of
"0 loads" meant nothing.

| | inline | index |
|---|---|---|
| **guardrail** — right skill active when needed | 5/5, plus note-author + cite-everything every time | **5/5, exactly `flashcards`** |
| input tokens, skill needed | 6,907 | 9,376 (+36%) |
| $ / latency, skill needed | 0.0082 / 3.8 s | 0.0120 / 8.7 s |
| input tokens, no skill needed (find-and-update / delete) | 14,177 / 6,350 | 11,972 / 5,694 (−16% / −10%) |
| pass, all three cases | 15/15 | 15/15 |

**What it shows:**
- The guardrail holds: a model given only the catalogue loads the skill it
  needs, every time, and only that one.
- The inline classifier misfires: keyword overlap pasted `flashcards` and
  `note-author` into "Delete my shopping list note". The index path's
  saving on no-skill turns is mostly those irrelevant bodies.
- With four small skills, a turn that needs one pays an extra round trip that
  costs more than the bodies it avoids — the crossover this card predicted.

**Primary metric (prompt flat as the catalogue grows):** not measurable yet —
there are four skills, not ten. The mechanism is now shown safe, which is
what the switch was waiting on.

**Decision:** KEEP `inline` as the default. Switch to `index` when the
catalogue grows past the crossover (re-run `e7-skill-*` and the agent family
then). Separately worth fixing: the inline classifier's false positives.

**Ratchet line added:** an eval that cannot see an engine-handled tool must
record the event it emits instead.
