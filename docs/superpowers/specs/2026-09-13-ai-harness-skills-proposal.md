# Proposal — One AI Harness, Skills as Jobs, Workspace Proposes / User Disposes

> Status: PROPOSAL (not approved). Date: 2026-09-13.
> Scope: Workspace AI, the agent engine, every other model call in the app, and the
> path to Notion-style agents.

---

## 1. The problem, grounded in the code

### 1.1 Workspace spends tokens nobody asked for
`services/workspace/processor.py:240` calls `maybe_synthesize(note_id)` when the last
source settles. If the note is empty, `synthesis.run_synthesis` sends up to
`TOTAL_SOURCE_BUDGET` = 180,000 chars of source text (~45K tokens) plus the ~8K-char
`prompts/note_synthesis.py` prompt to the model, and asks for a whole mastery guide.

On Haiku 4.5 ($1 / $5 per MTok) that costs cents per drop, so the dollar amount is not the
problem today. The pattern is:
- it fires on **every** drop, including when the user only wanted to read, annotate, or chat;
- a re-synthesis pays the full price again and rewrites the whole note;
- the cost scales with every future model upgrade (Sonnet 5 is 2× Haiku, Opus 5 is 5×);
- the job is hardcoded as "workspace = mastery guide". There is no way to say "compare these",
  "put this table in my database", or "just index it".

### 1.2 The AI system is several stacks, not one
There are at least four separate ways to call a model:

| # | Surface | Entry | Model path |
|---|---------|-------|------------|
| 1 | Chat page | `routers/agent.py` → `engine.run_turn` | `services/agent/model.py` (OpenAI-compatible) |
| 2 | Ingest | `routers/agent_ingest.py` → `run_ingest_turn` | same |
| 3 | Interactive blocks | `run_interactive_turn` | same |
| 4 | Descriptor | `services/descriptor.py` | same |
| 5 | Inline editor AI | `routers/agent_inline.py` | OpenRouter `settings.inline_model` |
| 6 | BlockNote AI | `frontend/app/api/ai/route.ts` | **Gemini, called straight from Next.js** |
| 7 | Workspace synthesis | `services/workspace/synthesis.py` | `services/ai/` (Claude first) |
| 8 | Workspace chat | `services/workspace/chat.py` | `services/ai/` stream |
| 9 | Formula OCR | `services/workspace/media.py` | `services/ai/` |
| 10 | Legacy ingest | `routers/ingest.py` → `services/llm.py` | OpenRouter / Gemini / llama.cpp |

Consequences: the Claude-first change (`a9dd5c5`) only reaches rows 7–9. Workspace chat
has its own retrieval and prompt and never uses skills or brain tools. The 5 database
brain tools (`list_databases`, `get_database_schema`, `query_database`, `create_row`,
`update_row`) exist, but Workspace cannot reach them.

### 1.3 The agent engine is not yet a harness
- **The tool loop runs one round.** `_stream_loop` executes tool calls and emits
  `tool_result`, but never sends the results back to the model ("one round in Phase 1;
  multi-round will follow"). The agent cannot do multi-step work (organize, analyze, fill
  rows).
- **Skills are chosen by keyword overlap** (`skills.classify_skills`) and their full bodies
  are pasted into the system prompt. There is no progressive disclosure.
- **Every tool schema ships every turn**: all 15 brain tools plus every MCP tool, and MCP
  discovery makes network calls on every turn. That wastes tokens and churns the cache
  prefix.
- **No run log.** Nothing records tokens, cost, trigger, or outcome per AI run, so "are we
  wasting tokens?" can't be measured.

---

## 2. What Notion does (and what transfers)

**Three tiers, each with a clear trigger:**

| Notion | What it is | Trigger | Our analogue |
|--------|-----------|---------|--------------|
| **Instructions** | Persistent preferences applied to every response | Always on | User profile / style (e.g. the Notion-dialect note style) |
| **Skills** | Reusable instructions, *stored as pages* | `/skill`, selection menu, block menu, `@` in chat, or **auto** only if the skill has a description AND "use automatically" is toggled on | `backend/skills/` + user skills |
| **Custom Agents** | Autonomous: instructions + scoped access + triggers | Schedule, page/database events, Slack | Saved task + trigger on the same harness |

**Databases:** AI Autofill is opt-in *per property*, with two explicit cost tiers: Basic
(simple fills, no credits) and Custom Agent Autofill (multi-step, uses credits). Nothing
expensive runs unless a user configured it.

**Custom Agents** only touch resources explicitly granted to them (never the full workspace
by default), use metered credits, let admins restrict models, and keep an **Activity log**
of trigger → actions → errors for every run.

**Harness lessons** (Notion rebuilt its agent harness 4–5 times over ~3.5 years):
- *Use formats the model already knows.* Custom JSON query formats made models flounder, and
  SQLite syntax fixed it. For document editing a custom XML format failed and
  Notion-flavored Markdown worked, even with a lossy conversion.
- Real tool definitions replaced few-shot prompting, so product teams own their own tools.
- **Progressive disclosure** to scale past 100 tools.
- Tiered evals: a regression/CI tier (~100% pass), a launch-quality tier (80–90%), and a
  frontier tier (~30%) to spot headroom.

**What transfers:** AI work is always *triggered* (explicitly by the user or by a configured
agent), skills are the unit of reusable work, and one harness serves every surface.

---

## 3. The proposal

> **One harness. Skills are the jobs. Surfaces only choose skill + scope + trigger.
> In Workspace, the AI proposes and the user disposes.**

```
 SURFACES     Workspace   Chat   Editor (/ & selection)   Databases   Agents (triggers)
                 │          │            │                    │            │
                 └──────────┴────── TaskSpec ─────────────────┴────────────┘
                                         │
 HARNESS      context assembly · skill loader · tool registry · multi-round loop
              permission gate · budget · event stream · ai_runs log · evals
                                         │
 GATEWAY      services/ai  (Anthropic native + OpenAI-compatible/OpenRouter + local)
```

### 3.1 The TaskSpec — every AI run is described the same way
```yaml
surface:   workspace | chat | editor | database | agent
skills:    [study-guide]              # explicit; auto-pick only for skills marked auto
scope:     { note: <id>, sources: [...], selection: ..., database: <id> }
tools:     [brain.search_brain, workspace.read_source, db.*]   # allowlist from skill ∩ surface
output:    draft_note | insert_at_cursor | rows_proposal | chat
trigger:   user | suggestion_click | automation | schedule
budget:    { max_input_tokens, max_output_tokens, max_usd }
model_tier: fast | standard | deep    # mapped to models in settings, not in code
```

### 3.2 Harness (evolve `services/agent/engine.py`, don't start over)
1. **Merge the gateway.** `services/agent/model.py` and `services/llm.py` are replaced by
   `services/ai/`. The Next.js Gemini route and the OpenRouter inline route go through the
   backend. This gives one place for keys, provider order, fallback, and usage accounting.
2. **Multi-round tool loop** with `MAX_TOOL_CALLS_PER_TURN`, results fed back, parallel
   tool results returned in one message.
3. **Context assembly built for caching:** a stable prefix (persona → skill *index* → core
   tool schemas → scope material such as source text), then a volatile tail (the question,
   timestamps). Workspace chat and re-runs over the same sources then read the source text
   from cache at ~0.1× price. Caveat: the minimum cacheable prefix on Haiku 4.5 is 4,096
   tokens, so the prompt alone won't cache; prompt plus source text will.
4. **Progressive disclosure, provider-agnostic:**
   - skills: the prefix holds only name + description (~100 tokens each), and a
     `load_skill(name)` tool or an explicit invocation pulls the body and its reference files.
   - tools: a small core set is always on. Groups (`db.*`, `workspace.*`, `mcp.<server>.*`)
     load on demand through `load_tools(group)`. When the provider is Anthropic, native tool
     search (`defer_loading`) can replace this. MCP discovery is cached per server, not run
     per turn.
5. **`ai_runs` table** (Notion's Activity log): user, surface, skill, trigger, model,
   input/output/cache tokens, estimated cost, status, error, output reference.
   **Build this first**, because it is how every later decision gets measured.
6. **Budgets:** a per-run cap from the TaskSpec and a per-user daily cap in settings. Runs
   that would exceed a cap ask first.
7. **Existing permission gate** (`permissions.py`) stays, extended with scope checks so a
   run may only touch the note, sources, or database in its scope.

### 3.3 Skills become the job catalog
Move from single `.md` files to folders (the SKILL.md convention):
```
backend/skills/study-guide/
  SKILL.md                 # frontmatter + short procedure
  references/notion-dialect.md   # ← docs/prompts/lesson-notes-notion-dialect.md
  references/examples.md
```
Frontmatter extends what `skills.py` already parses:
```yaml
name: study-guide
description: Turn one or more sources into a structured mastery guide note.
surfaces: [workspace, chat, editor]
inputs: sources              # sources | selection | note | database
output: draft_note           # decides the UI (see 3.4)
tools: [workspace.read_source]
model_tier: standard
auto: false                  # Notion rule: never auto-run unless explicitly enabled
confirm: true                # show estimate before running
```
First catalog, drawn from what the app already has tools for:

| Skill | Replaces / adds | Output |
|-------|-----------------|--------|
| `study-guide` | today's `note_synthesis.py` prompt | draft_note |
| `add-source-section` | full re-synthesis when one source is added | insert_at_cursor |
| `compare-sources` | new | draft_note |
| `extract-to-database` | new, uses `create_row` | rows_proposal |
| `analyze-database` | new, uses `query_database` | chat / draft_note |
| `organize-notes` | new, uses `move_note` / `link_notes` | proposal |
| `flashcards` / `quiz` | new | insert_at_cursor |
| `note-author`, `cite-everything`, `interactive-block-author` | existing | unchanged |

User skills: follow Notion and let **any note be marked as a skill**. The editor already
exists, and skills become part of the second brain. `routers/skills_api.py` and
`/brain/settings/skills` already exist; decide whether user skills stay there or become
flagged notes.

### 3.4 What changes for UX
**Workspace:**
- Dropping sources runs **extraction, chunking and embedding only**, with no generation
  tokens.
- When sources settle, the shell shows **suggested actions**, computed without an LLM from
  source kinds, source count, and whether the note is empty. For example:
  `Study guide · ~45K tokens · ~$0.07`, `Compare 3 sources`, `Table → database`,
  `Ask a question`.
- Also a **`/` palette** over the note (all workspace-surface skills) and skills in the
  **selection menu**.
- A run shows as a **run card** (progress from SSE events, tokens, Apply / Discard). This
  generalises today's `note_synthesis` draft → apply flow; the `_claim` guard and
  `applied_at` machinery carry over as run state.
- The **output contract** decides placement: `draft_note` → the existing replace/append
  review; `insert_at_cursor` → the `cd34dd2` path; `rows_proposal` → a preview table with
  confirm; `chat` → the drawer.
- An optional per-user setting, **"On drop: nothing / suggest / auto-run study guide"**,
  defaults to *suggest*, so anyone who wants today's behaviour can keep it.

**Chat drawer:** runs through the harness with `scope = this note + its sources`.
Retrieval-grounded citations are kept; `workspace/chat.py` becomes a thin surface adapter.

**Databases:** an "AI" column or "Run skill on selected rows" (Notion's Autofill), always
explicitly triggered, with Basic (fast tier) and Deep (agent, multi-step) as visible
choices.

**Agents (later):** an agent is a saved TaskSpec plus a trigger plus scope plus budget.
Triggers reuse `services/db/automations.py` and `services/db/scheduler.py`, plus a new
"source added" event. The activity page reads `ai_runs`. This is not a new stack.

**Android:** because the harness lives in the backend, parity item #20 becomes "call the
same endpoints and render the same run events" rather than reimplementing workspace AI.

### 3.5 Harness work that improves the models themselves
- **Output format experiment (Notion lesson):** synthesis currently makes the model write
  BlockNote HTML with `data-*` attributes. Your own notes record the cost of that dialect:
  an unknown `data-callout-type` silently renders grey, `<blockquote><details>` discards the
  body, and adding loud rules collapsed math blocks from 16 to 3. Try Markdown plus the
  `:::callout` fences that `frontend/lib/markdown/fences.ts` already parses, converted to
  blocks deterministically. **Measure it, don't assume it.**
- **Evals in three tiers**, using the counts you already measure by hand on
  `Lect10-IML26.pdf` (headings, toggles, callouts, math blocks, tables, anchors):
  - *regression*: fixture sources × skills, run in CI, must stay green;
  - *launch*: a real-source set, target 80–90%;
  - *frontier*: hard cases (long scanned PDFs, video) to show headroom.
- **Map-reduce subagents** for large scopes (10 sources, a 5K-row database): per-item
  extraction on the fast tier with isolated context, then one synthesis on the standard
  tier. This keeps the main context small and uses one model per loop, which preserves the
  cache.
- **Batch API** (50% off) for non-urgent work: auto-run-on-drop when a user enables it, and
  scheduled agents.
- **Local model path:** skills declare `model_tier`, and fast-tier skills can run on the
  tablet's Gemma. Progressive disclosure matters most there, because small context windows
  cannot afford full skill bodies and every tool schema.

---

## 4. Rollout — each phase ships on its own

| Phase | Goal | Work | Done when |
|-------|------|------|-----------|
| **A. Stop the bleed** (small) | No unrequested generation | Put the `processor.py:240` auto-fire behind `workspace_on_drop` (default `suggest`); add a "Generate study guide" CTA with estimate; add the `ai_runs` table and log synthesis + chat usage | Dropping a file spends 0 generation tokens; `ai_runs` shows every run |
| **B. One harness** | Single path to models | Merge gateway into `services/ai`; multi-round loop; cache-friendly context assembly; synthesis = `harness.run(skill="study-guide")`; workspace chat via harness; regression eval tier | Rows 1–10 of §1.2 all go through one gateway; eval green |
| **C. Skill catalog + surfaces** | Workspace does more than one job | Skill folders + frontmatter; `load_skill` / `load_tools`; suggestion chips, `/` palette, selection menu, run card; `compare-sources`, `extract-to-database`, `analyze-database`, `add-source-section` | A user can pick any of 4+ skills from Workspace and each lands per its output contract |
| **D. Agents** | Notion Custom Agents | Saved TaskSpec + triggers (automations/scheduler/source-added) + scoped permissions + budgets + activity page; Batch API for background runs | A scheduled or event-triggered skill runs with a visible activity log and a budget cap |

---

## 5. Decisions needed from you
1. **Default on drop:** `suggest` (recommended), `nothing`, or keep `auto`.
2. **User skills storage:** skills as flagged notes (Notion-style, recommended) or the
   existing `skills_api` store.
3. **Model tier mapping:** which models back `fast` / `standard` / `deep` (today everything
   is Haiku 4.5).
4. **Output format experiment:** run the Markdown+fences vs HTML eval in Phase B, or defer.

## Sources
- Notion — Skills for Notion Agent: https://www.notion.com/help/skills-for-notion-agent
- Notion — Custom Agents: https://www.notion.com/help/custom-agents
- Notion — Custom skills release (2026-03-20): https://www.notion.com/releases/2026-03-20
- Notion — AI Autofill: https://www.notion.com/help/autofill
- Notion rebuilt its agent harness 4–5 times: https://finance.biggo.com/news/3782bf347ef2a2ee
- TechCrunch — Notion as agent hub: https://techcrunch.com/2026/05/13/notion-just-turned-its-workspace-into-a-hub-for-ai-agents/
- Claude Agent Skills overview: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- Progressive disclosure as a design pattern: https://www.newsletter.swirlai.com/p/agent-skills-progressive-disclosure
