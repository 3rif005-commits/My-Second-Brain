# E7 — Progressive disclosure of skills

Date: 2026-09-23 · Config: `AGENT_SKILL_DISCLOSURE=index` · Model: pending

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
