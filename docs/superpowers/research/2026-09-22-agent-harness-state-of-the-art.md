# The Full Potential of an Agent Harness — World Research + What It Means for Second Brain

> Research report, 2026-09-22. Companion to
> `docs/superpowers/specs/2026-09-13-ai-harness-skills-proposal.md`.
> Every number here has a source at the bottom. Where a claim is a vendor's own
> benchmark, it says so — treat those as directional, not laws.

---

## 0. The thesis, in one paragraph

The model is becoming a commodity; the harness is where the remaining leverage is. In a
controlled comparison across six foundation models, replacing conventional orchestration
with a well-designed harness cut **cost per task 41%** ($0.21 → $0.12), **latency 44%**
(48s → 27s) and **tokens per task 38%** (14.2k → 8.8k) while task quality held or improved
(0.78 → 0.81). Every model tested got cheaper (33–61%), and **the stronger the model, the
more the harness gave back** (correlation r = 0.99 between baseline model strength and
efficiency gain — the paper calls this "harness leverage"). Its conclusion: *the
orchestration layer moved cost per task more than the entire spread of the model menu did.*
Microsoft's SRE agent tells the same story from the quality side: rebuilt from 100+ bespoke
tools and prescriptive prompts into a filesystem with general tools, "Intent Met" on novel
incidents went **45% → 75%**.

For you this means: the harness is not a detour before the features. It *is* the feature
multiplier — and it applies identically to Claude, to Gemini, and to Gemma on your tablet.

---

## PART I — Anatomy of a harness: ten subsystems

For each: what it is, the state of the art, and what it would do for Second Brain.

### 1. Context assembly & caching — the cheapest wins in the whole stack

**State of the art.** Context is a *finite attention budget*, not a bucket. Transformers
relate every token to every other, so each added token dilutes attention on the rest. This
is "context rot", now standard vocabulary: accuracy drops as input grows across all major
models, with **30%+ accuracy drops** when the needed fact sits mid-window; on one monitoring
benchmark, recall fell **98.6% → 88%** simply by prepending 800k tokens of *benign* text.
The counter-practices:

- **Cache-shape discipline.** Order the request stable-first: frozen system prompt → stable
  tool list → scope material → volatile question. Any byte change invalidates everything
  after it. Cached reads cost ~0.1× and on most models don't count against input rate limits.
- **Mid-conversation operator messages** instead of editing the system prompt (keeps the
  cached prefix intact).
- **Minimum cacheable prefix is model-dependent and not monotonic**: 512 tokens on Opus 5,
  1024 on Sonnet 5, **4096 on Haiku 4.5**. A 3K-token prompt silently doesn't cache on Haiku.
- **Local models cache too**: `llama.cpp`'s server reuses KV cache via `cache_prompt`, slot
  similarity matching (default 50%), and `--slot-save-path` for persistence. Same discipline,
  no bill.

**For Second Brain.** Your `TOTAL_SOURCE_BUDGET` is 180,000 chars (~45K tokens) of source
text, and today it is re-sent, uncached, on every synthesis and every grounded-chat turn
against the same sources. Putting source text in a cached prefix makes workspace chat
roughly free after the first turn, and makes "re-synthesize" cheap. It also crosses the
Haiku 4096-token minimum easily, which the prompt alone does not.

### 2. Progressive disclosure — how you get 50 skills and 100 tools without paying for them

**State of the art.** Load names and descriptions (~100 tokens each); load bodies only on
demand. Anthropic's skills are folders whose metadata alone sits in context. Tool search
(`defer_loading`) appends schemas instead of swapping them, so the cache survives.
The extreme version — **code execution with MCP** — exposes tools as files in a filesystem
the model explores and calls from code: **150,000 → 2,000 tokens (98.7% reduction)** in
Anthropic's example, with intermediate results (e.g. a 10,000-row sheet filtered to 5)
never entering context at all.

Stripe measured the *shape* of this too: modular skill files beat one monolithic file by
**~10%** on their evals plus token savings, attributed to "lost in the middle".

**For Second Brain.** You have 15 brain tools + every MCP tool sent on every turn, and MCP
discovery runs per turn. Skill bodies are pasted whole. Progressive disclosure is how the
catalog grows from 3 skills to 30 without the context bill growing at all — and it matters
*most* for the tablet's Gemma, where the window is small.

### 3. Tool design (the agent-computer interface) — where teams spend more time than on prompts

**State of the art.**
- **Consolidate.** One `schedule_event` beats `list_users` + `list_events` + `create_event`.
  Ten focused tools beat fifty overlapping ones "because the model can hold the menu in its
  head". Anthropic's SWE-bench team spent more time on tools than on the prompt.
- **General beats bespoke at the extremes.** The Azure SRE rebuild replaced 100+ specialized
  tools with read/search/list/shell over a filesystem: +30 points on task success.
- **Namespace** (`asana_search` vs `jira_search`) so boundaries are legible.
- **Token-efficient responses**: pagination, filtering, truncation with a hint that teaches
  the next call ("Results limited to first 100. Use filters to narrow scope."). Claude Code
  caps tool responses at **25,000 tokens**.
- **A `response_format` parameter** (concise | detailed) lets the agent pay only for what it
  needs.
- **Error messages are steering, not diagnostics.** Stripe's experiments: guidance in
  dependency READMEs/AGENTS.md = **0% effect** (agents never read them); `warn` fields in API
  responses = **0% effect** (parsed the data, ignored the warning); **explicit errors = highly
  reliable** behaviour change. Their summary: hard mechanisms (errors, loaded context,
  blocking responses) steer; whispers (warnings, hints, adjacent files) don't.
- **Poka-yoke**: design arguments so mistakes are impossible (absolute paths, not relative).
- **Formats the model already knows.** Notion's harness rebuilds: custom JSON query API →
  models floundered; **SQLite syntax** fixed it. Custom XML document format failed;
  **Markdown** worked even with lossy conversion.

**For Second Brain.** Two direct implications. (a) Your `query_database` tool should speak
something SQL-shaped rather than a bespoke filter JSON. (b) Your synthesis asks the model to
emit BlockNote HTML with `data-*` attributes — a custom dialect, and your own notes record
its cost: unknown `data-callout-type` silently renders grey, `<blockquote><details>` discards
the body, and tightening rules collapsed math blocks 16 → 3. Markdown + `:::callout` fences
(which `lib/markdown/fences.ts` already parses) with a deterministic converter is the Notion
lesson applied to your app. Measure it; don't assume it.

### 4. The loop — from one round to a real control system

**State of the art.** The canonical ladder, simplest first: single call → prompt chaining →
routing → parallelization (sectioning/voting) → orchestrator-workers → evaluator-optimizer →
autonomous agent. Anthropic's advice is explicit: use the simplest tier that works, because
agents trade latency and cost for capability. Beyond that:

- **Verification loops**: run checks after actions; "success is silent, failures are verbose"
  — errors go back into the loop for self-correction.
- **Plan/execute separation** and **planner ≠ critic** (self-evaluation bias).
- **State machines** that constrain which tools are legal in which phase.
- **Durable execution**: checkpoints and resume instead of restart; long agents need it.
- **Task budgets**: give the model a token ceiling it can see, so it paces itself and lands
  gracefully instead of being cut off.
- **Parallel tool calls** returned in one message (splitting them trains the model to stop
  parallelizing). Anthropic's research system got **90% time reduction** by running 3–5
  subagents at once.

**For Second Brain.** Your `_stream_loop` executes tools but never returns results to the
model. Closing that loop is the single change that turns your engine from a "search + one
action" toy into something that can organize notes, fill a database, or research across
sources.

### 5. Context lifecycle — compaction, clearing, notes, sub-agents

**State of the art.** Four tools, chosen by task shape:
| Technique | Use when | Mechanics |
|---|---|---|
| **Tool-result clearing** (context editing) | Old tool outputs are dead weight | Clear results/thinking by threshold — no summarization |
| **Compaction** | Long back-and-forth nearing the window | Summarize history, preserving decisions, unresolved bugs, details; tune for recall first, then precision |
| **Structured note-taking** | Iterative work with milestones | Agent writes notes to files/memory outside the window (Claude's Pokémon runs held tallies and maps across thousands of steps) |
| **Sub-agent isolation** | Parallel exploration / reading-heavy fan-out | Each subagent explores widely, returns **1,000–2,000 tokens** distilled; detail stays out of the parent |

Plus the cheapest of all: **phase resets** — finish planning, start implementation in a fresh
context carrying a short summary.

**For Second Brain.** Long workspace chats and any future "research this topic across my
brain" feature need compaction + isolation. Also: a map-reduce over sources (per-source
extraction on the fast tier, one synthesis on the standard tier) is how you handle a
10-source drop without a 45K-token prompt.

### 6. Memory and self-improvement — the part that compounds

**State of the art.**
- **Tiered memory** is the reference architecture: Letta/MemGPT's core/archival/recall;
  mem0, Zep, and a wave of graph-based systems (MAGMA, cognee) claiming large retrieval and
  token-reduction gains.
- **ACE (Agentic Context Engineering)**, ICLR 2026: treat the context as an evolving
  **playbook** built by a generate → reflect → curate loop from *execution feedback only, no
  labels*. **+17.1% on AppWorld**, **+8.6%** on financial reasoning, with lower adaptation
  latency, and a smaller open model matching the top production agent on the leaderboard.
  Its key trick is *incremental structured updates* to avoid "context collapse" (rewriting a
  playbook wholesale degrades it).
- **The ratchet rule** for rules files: every line traces to a specific failure; keep it
  short (Addy Osmani: under ~60 lines, "a pilot's checklist, not a style guide").
- **Continual learning has three layers**: weights (expensive), harness behaviour, and
  context — the last two are where product teams actually improve.

**For Second Brain.** This is your unfair advantage: you already store the user's notes,
their edits, and their stated style (`docs/prompts/lesson-notes-notion-dialect.md`). An
ACE-style loop that diffs *what the model produced* against *what the user kept* and appends
one new rule to a learned style playbook would make the app's output converge on this user's
taste without any prompt engineering by you. Same machinery, second use: mine repeated chat
requests into proposed skills.

### 7. Retrieval as a tool, not a preprocessing step

**State of the art.** Static top-k stuffing is out; **just-in-time retrieval** is in — keep
lightweight identifiers (paths, queries, links) and let the agent load what it needs, using
metadata (folder names, timestamps, naming conventions) as signal. Quality upgrades that pay:
**contextual retrieval** (prepend document-level context to each chunk before embedding —
reported up to **67% fewer top-20 retrieval failures** when combined with reranking),
**late chunking**, **reranking** (Cohere/Voyage/Jina/BGE), and a **citation step** so answers
are auditable. A 2026 refrain worth heeding: agentic RAG is not automatically worth it —
measure against a plain pipeline.

**For Second Brain.** You already have chunks, anchors and citations — you're most of the way
to the good version. The upgrades that fit: contextual chunk prefixes (each chunk knows which
lecture/section it came from), a reranker before the model, and a **deterministic citation
verifier** that checks every `data-anchor` in a generated note actually resolves. That last
one costs no tokens and directly attacks the trust problem.

### 8. Governance: permissions, approvals, budgets — and the injection problem you already have

**State of the art.** Layered authorization: declarative allow/deny tool lists, intent-level
(not command-name) permissions, two-stage classifiers for auto-approval (fast single-token
pass, chain-of-thought on flagged actions), credential brokers so agents never hold secrets,
and audit trails. One measured finding: **per-action approval blocks ~20 percentage points
more overreach** than static policies, which tend to degenerate into runtime prompts anyway.

**Prompt injection is now the central agent security problem**, and the vulnerable shape is
exactly: *private data + untrusted content + ability to act or communicate outward*. In April
2026 researchers hijacked Claude Code, Gemini CLI and GitHub Copilot by planting instructions
in **GitHub PR titles**, and exfiltrated CI secrets. MCP multiplies this: tool descriptions,
server responses and metadata are all read by the model. The strongest architectural answer
is the **dual-LLM / quarantine pattern**: a privileged model holds tools but never reads
untrusted content; a quarantined model reads untrusted content but cannot act; only
structured summaries cross the boundary.

**For Second Brain — a concrete finding from your code.** Your agent engine injects retrieved
note text into the system prompt (`_build_knowledge_context_xml`) and offers write and delete
tools in the same turn. Note text comes from ingested PDFs, websites and YouTube transcripts
— attacker-controllable content. Your gate (`services/agent/permissions.py`) does block
external-tier writes and `local_only` notes, but the delete guard is
`if not args.get("confirm")` — **`confirm` is an argument the model supplies**, so an
instruction embedded in a PDF can ask for `confirm: true` and satisfy the gate. That is not a
human-in-the-loop; it's a speed bump. Fixes, in order: (a) confirmation must come from the
client/user, never from tool arguments; (b) mark retrieved source text as untrusted data and
never let a turn that read untrusted content call a write tool without explicit user
approval; (c) apply the same rule to MCP tool output.

### 9. Observability and evals — you cannot improve what you cannot see

**State of the art.** The transport layer has standardized on **OpenTelemetry GenAI semantic
conventions**: traces, metrics and logs, with token, cost and cache data on each span, tool
calls and MCP interactions as child spans, multi-agent runs rendered as waterfalls.
On top of that: **online evals** (LLM-as-judge scorers running on live traces so regressions
surface immediately), rubric-based judging (Anthropic's research rubric scores factual
accuracy, citation accuracy, completeness, source quality, tool efficiency), and the advice
to **start with ~20 test cases immediately** rather than waiting for a big eval set. Notion
runs three tiers: regression/CI (~100% pass), launch quality (80–90%), frontier (~30%,
shows headroom). Trace-level truth matters: an answer can be "correct" while the trace shows
eight retried tool calls, three stale retrievals and $42 of judge tokens.

**For Second Brain.** An `ai_runs` table plus per-run token/cost/cache/latency is the
prerequisite for every other decision in this report — including proving that the harness
work paid for itself.

### 10. Interop and distribution — MCP, skills, and the subscription bridge

**State of the art.** MCP is the connective tissue, and the **2026-07-28 spec** matters for
you specifically: server→client requests (sampling, elicitation) are redesigned as multi
round-trip requests; **MCP Apps** is now a formal extension for servers to deliver
**interactive UI** (dashboards, forms, visualizations) into host apps; and list responses
carry **cache hints and deterministic ordering** so clients can keep upstream prompt caches
stable. Skills are becoming a portable standard: **71,000+ community skills within five weeks**
of launch, with partner skills from Atlassian, Figma, Canva, Stripe and Notion. Google's A2A
covers agent-to-agent. Adjacent: `AGENTS.md` as a cross-vendor rules file.

**For Second Brain.** Two doors. Inward: you are an MCP *client* already. Outward: as a remote
MCP *server* with per-user OAuth, your app becomes a tool inside whatever the user already
pays for (Claude, ChatGPT, Copilot), and **MCP Apps** means you can render your own workspace
UI inside their chat. The same skills serve both sides.

---

## PART II — The small tricks, ranked by (measured gain ÷ effort)

| # | Trick | Reported effect | Effort |
|---|-------|-----------------|--------|
| 1 | Stable prefix ordering; no clocks/UUIDs/unsorted JSON in the cached part | cache reads ~0.1× cost; verify via `cache_read_input_tokens` | XS |
| 2 | Put source text in the cached prefix (chat + re-runs reuse it) | turns repeat turns nearly free | S |
| 3 | Cap tool responses (Claude Code: 25k tokens) + truncation hint | prevents context blowouts | XS |
| 4 | `response_format: concise \| detailed` on heavy tools | pay only for what's needed | XS |
| 5 | Rewrite tool errors as instructions ("use X format, you sent Y") | Stripe: errors steer reliably, warnings 0% | XS |
| 6 | Namespacing + fewer, consolidated tools | "10 focused > 50 overlapping" | S |
| 7 | Few-shot canonical examples instead of rule lists | better tool-call arg accuracy | S |
| 8 | Modular skill files over one monolith | ~+10% on Stripe's evals + token savings | S |
| 9 | Return all parallel tool results in ONE message | preserves parallel tool use | XS |
| 10 | Formats the model knows (SQL-ish queries, Markdown docs) | Notion: fixed "floundering" | M |
| 11 | Deterministic tool list order (and MCP cache hints) | keeps prompt cache alive | XS |
| 12 | Tool-result clearing / context editing on old turns | removes dead weight without summarizing | S |
| 13 | Compaction tuned recall-first, then precision | survives long sessions | M |
| 14 | Sub-agent returns 1–2k token summaries only | keeps parent context clean | M |
| 15 | Phase reset between plan and execute | avoids mid-session rot | XS |
| 16 | Task budget the model can see | graceful landing vs truncation | S |
| 17 | Effort/model tier per skill, not globally | cost down without quality loss | S |
| 18 | Batch API for background work | **50% discount** | S |
| 19 | Local: `cache_prompt`, slot reuse, `--slot-save-path` | avoids full prompt reprocessing on tablet | S |
| 20 | Structured outputs / constrained decoding instead of parsing prose | removes a whole class of failures | S |
| 21 | Deterministic post-checks (anchors resolve, schema valid, counts) | catches what judges miss, costs 0 tokens | S |
| 22 | Rules file as a ratchet: every line traces to a real failure, <60 lines | stops prompt bloat | XS |
| 23 | 20-case eval today beats a 200-case eval next month | Anthropic's explicit advice | S |

---

## PART III — What this unlocks for Second Brain (the ambitious list)

Ordered by value ÷ risk. Each names the harness subsystems it needs.

1. **Workspace as a job runner** (§2,3,4) — any skill over any source set, output contract
   decides placement. Converts a one-trick feature into a platform.
2. **Learned style playbook** (§6) — the app watches which parts of a generated note you keep
   or rewrite and appends rules to a per-user playbook (ACE-style incremental updates:
   +17.1% is the published analogue). Your notes stop needing prompt surgery from you.
3. **Citation verifier** (§7,9) — deterministic check that every anchor resolves and every
   claim carries one; zero tokens, direct trust win, and a regression metric you can chart.
4. **Nightly librarian** (§4,6,8, Batch API) — dedupe, propose links, surface mastery decay
   into a review queue (`set_mastery` already exists), all at the 50% batch rate, with an
   activity log and a budget cap.
5. **Database analyst** (§3,4) — SQL-shaped query tool + multi-round loop = "which topics am I
   weakest in, and build me a revision plan" over your own databases.
6. **Study coach loop** (§4) — evaluator-optimizer: generate quiz → grade the user's answer →
   update mastery → choose the next topic. This is the "second brain" promise, and it needs
   exactly the loop you're missing.
7. **Multi-source research agent** (§4,5) — orchestrator + isolated subagents. Worth it for
   breadth-first questions (+90.2% in Anthropic's research benchmark) but **15× the tokens of
   a chat** — so gate it behind an explicit, priced action.
8. **The subscription bridge** (§10) — remote MCP server + OAuth so users spend *their* Claude/
   ChatGPT quota, with MCP Apps rendering your workspace inside their chat.
9. **Local-first fast tier** (§1,3) — Gemma on the tablet for classification, routing, tagging
   and extraction with constrained decoding + KV-cache slots; cloud only for the heavy skills.
10. **Skill mining** (§6) — "you've asked for this 3 times; save it as a skill?" turns usage
    into a growing, user-owned capability set (and feeds the 71k-skill ecosystem pattern).
11. **Ingestion agent with quarantine** (§8) — untrusted source text is read by a tool-less
    model that emits structured facts; only those cross into the acting agent. Turns your
    biggest security exposure into a documented safety property.
12. **Cross-device continuity** (§9) — runs, budgets and activity visible on web and Android
    because the harness is server-side.

---

## PART IV — What *not* to do (each of these has burned someone)

- **Don't build 100 bespoke tools.** Azure went the other way and gained 30 points.
- **Don't default to multi-agent.** 15× tokens; fails where agents need shared context; most
  tasks aren't parallel.
- **Don't invent a data format.** Notion lost years to custom XML/JSON before Markdown/SQLite.
- **Don't whisper.** Guidance in files agents don't read, or warning fields they skip, is 0%.
- **Don't let self-improvement rewrite the whole playbook** — that's context collapse; append
  structured deltas.
- **Don't add loud rules without re-measuring the rest** — you already observed tables improve
  while math blocks collapsed 16 → 3.
- **Don't trust a model-supplied `confirm` flag as human approval** (see §8).
- **Don't auto-run expensive work.** The whole reason this started.

---

## PART V — The plan

### Stage 0 — Instrument and stop the bleed (days)
`ai_runs` table + token/cost/cache/latency per run; put the auto-synthesis behind a setting
(default *suggest*); "Generate study guide · ~45K tokens · ~$0.07" CTA. Pick 20 eval cases from
real sources now.
**Exit metric:** dropping a file spends 0 generation tokens; every run appears in `ai_runs`.

### Stage 1 — Core harness (the multiplier)
One gateway (`services/ai`) for all 10 call sites; multi-round tool loop; cache-shaped context
assembly; per-run budgets; permission gate hardened (client-side confirm, untrusted-content
rule); regression eval in CI.
**Exit metrics:** tokens/task and cost/task down ≥30% on the same tasks (the published harness
benchmark is 38%/41%); cache hit rate > 0 and rising; eval green.

### Stage 2 — Skills + progressive disclosure
Skill folders with frontmatter; metadata-only in the prefix; `load_skill` / tool groups; the
Workspace action bar, `/` palette and selection menu; skills 4–8 (`compare-sources`,
`extract-to-database`, `analyze-database`, `add-source-section`).
**Exit metric:** adding the 10th skill does not increase baseline prompt size.

### Stage 3 — Retrieval & verification quality
Contextual chunk prefixes, reranking, citation verifier, Markdown-vs-HTML output experiment —
each landed only if the eval moves.
**Exit metric:** retrieval-failure and anchor-resolution rates charted per release.

### Stage 4 — Memory, learned style, background agents
Learned style playbook (incremental updates); nightly librarian on the Batch API; saved
TaskSpecs with triggers, scopes, budgets and an activity page.
**Exit metric:** the share of generated notes accepted without edits goes up month over month.

### Stage 5 — Interop
Remote MCP server + per-user OAuth; MCP Apps UI; skills exposed as MCP prompts; Android calls
the same harness endpoints.

---

## Sources

**Harness economics & production lessons**
- The Harness Effect — token economics of orchestration design: https://arxiv.org/abs/2607.06906
- Awesome Harness Engineering (taxonomy, 100+ projects): https://github.com/ai-boost/awesome-harness-engineering
- Addy Osmani — Agent Harness Engineering: https://addyosmani.com/blog/agent-harness-engineering/
- Harness patterns / Azure SRE + Microsoft filesystem rebuild: https://tosea.ai/blog/loop-engineering-ai-agents-complete-guide-2026
- Notion rebuilt its agent harness 4–5 times: https://finance.biggo.com/news/3782bf347ef2a2ee

**Anthropic engineering**
- Effective context engineering for AI agents: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Building effective agents: https://www.anthropic.com/engineering/building-effective-agents
- Writing tools for agents: https://www.anthropic.com/engineering/writing-tools-for-agents
- Code execution with MCP (98.7% token cut): https://www.anthropic.com/engineering/code-execution-with-mcp
- Multi-agent research system (+90.2%, 15× tokens): https://www.anthropic.com/engineering/multi-agent-research-system
- Building agents with skills: https://claude.com/blog/building-agents-with-skills-equipping-agents-for-specialized-work

**Context rot, memory, self-improvement**
- Context rot overview + mitigations: https://www.morphllm.com/context-rot
- Context engineering reliability playbook 2026: https://www.digitalapplied.com/blog/context-engineering-agent-reliability-playbook-2026
- ACE — Agentic Context Engineering (ICLR 2026): https://arxiv.org/abs/2510.04618
- Externalization in LLM agents (memory/skills/protocols survey): https://arxiv.org/pdf/2604.08224
- Skill-mediated agents reference architecture: https://arxiv.org/pdf/2606.20631

**Tools, steering, retrieval**
- Stripe — You can't whisper at an AI agent: https://stripe.dev/blog/ai-steering-experiments
- Few-shot prompting for tool calling: https://blog.langchain.com/few-shot-prompting-to-improve-tool-calling-performance/
- RAG chunking / contextual retrieval / reranking playbook: https://www.digitalapplied.com/blog/rag-chunking-strategies-2026-retrieval-quality-playbook
- SoK: Agentic RAG: https://arxiv.org/pdf/2603.07379

**Security**
- Indirect prompt injection defense for production agents: https://webemyengineering.com/insights/indirect-prompt-injection-defense-production-agents/
- MCP prompt injection / tool poisoning: https://www.aptible.com/mcp-security/mcp-prompt-injection
- OWASP LLM prompt injection prevention: https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html

**Observability & evals**
- Agent observability complete guide 2026: https://www.braintrust.dev/articles/agent-observability-complete-guide-2026
- OpenTelemetry GenAI observability: https://opentelemetry.io/blog/2026/genai-observability/

**Protocol**
- MCP 2026-07-28 specification: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- MCP Apps (server-rendered UI): https://ecorpit.com/mcp-apps-server-rendered-ui-extension-build-guide-2026/

**Local inference**
- llama.cpp server KV cache reuse / slots: https://github.com/ggml-org/llama.cpp/discussions/13606
