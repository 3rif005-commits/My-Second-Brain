# E3b — chat requests that any provider can cache

**Status:** decided 2026-09-25 — order always on; marks ON by default (`AGENT_PROMPT_CACHE`). Spent $0.17.

## Why (user, 2026-09-25)
"We are not tied to Haiku — the user can use any model, even not Claude."
E3's first note said chat could not cache because a Haiku chat call (3.2K
tokens) is under Haiku's 4,096 minimum. That judged one model. Providers cache
differently:

| provider | how | what we must do |
|---|---|---|
| Anthropic | only marked blocks; min 512–4,096 tokens by model | mark; order |
| OpenAI, DeepSeek, Gemini, most OpenAI-compatible | automatically, on an identical request START | order |
| OpenRouter → Anthropic / Gemini models | marked parts | mark; order |
| llama.cpp (local) | reuses the stored prompt start (`--cache-prompt`, on by default) — saves CPU prefill time | order |

## What changes
1. **Order (all providers, always on).** The retrieved notes, pasted skills
   and workspace source excerpts were inside the system prompt, so every
   request was new from its first line. They now ride in a `<turn_context>`
   block AFTER the latest user message's text. The system prompt is the same
   on every message (and for every user); the next message shares the
   request up to the end of the previous question. Same notices: retrieved
   material is still announced as data.
2. **Marks (`AGENT_PROMPT_CACHE`, off until this card decides).** Anthropic:
   `cache_control` on the system prompt and on the last block of the last
   message. OpenRouter: the same on `anthropic/*` and `google/*` models only.
3. **Accounting.** OpenAI-style `cached_tokens` (and DeepSeek's
   `prompt_cache_hit_tokens`) are inside `prompt_tokens`; the log billed them
   twice. They are now split out, as Anthropic reports them.

## Metric
- **Primary:** share of input tokens read from cache over a 4-message
  conversation whose search returns a different note each message
  (`python -m evals.chat_cache`), and its cost against the same token counts
  at full price (exact: the counts are the provider's).
- **Guardrail:** the agent eval family (3 cases: find-and-update, refuses an
  unapproved edit — the injection gate —, needs-a-skill), n=3 on Haiku with
  the new order and marks on. Before: 9/9.

## Arms and cost (~$0.10)
- Haiku 4.5, marks on (min 4,096: expect reads only once the conversation
  grows) — ~$0.015.
- Sonnet 5, marks on (min 1,024: expect reads from message 2) — ~$0.04.
- Guardrail, agent family n=3 on Haiku — ~$0.04.
No marks-off arm: Anthropic never caches unmarked, so its cost is the same
token counts at full price.

## Decision rule
- The order stays in any case — it costs nothing and is what every
  automatic cache needs — unless the guardrail drops below 9/9.
- Marks go ON by default if cache reads appear on at least one model and the
  conversation's total cost is lower than at full price, with the guardrail
  at 9/9.

## Result
`python -m evals.chat_cache` — 4 messages, a different note retrieved each time.

**Sonnet 5, first try ($0.041):** from message 2 the fixed start was read
(2,889 tokens, 45% of input) — but every message WROTE a new entry that the
next never read. Cause: the mark sat at the end of the message, after the
retrieved context, and the next message replays the question WITHOUT it, so
no cached entry ended where the two requests still agreed.
**Fix:** for Anthropic (and OpenRouter's Anthropic/Gemini) the latest
question and its `<turn_context>` are sent as two blocks, and the mark ends at
the question; in a tool round the newest tool result is marked too.

**Sonnet 5, after the fix ($0.028):**

| msg | input | write | read | out |
|---|---|---|---|---|
| 1 | 1,922 | 91 | 2,889 | 100 |
| 2 | 1,908 | 113 | 2,980 | 316 |
| 3 | 1,421 | 245 | 3,093 | 682 |
| 4 | 915 | 345 | 3,338 | 58 |

64% of input read from cache; $0.0283 against $0.0501 for the same tokens
at full price (**−43%**). Message 1 read the fixed start left by the previous
run — the normal case, since it is the same for every conversation and user.

**Haiku 4.5 ($0.018):** 3.6–4.1K tokens a call, under its 4,096 minimum:
nothing written, nothing read, cost = full price exactly. A mark below the
minimum costs nothing — which is what makes marking always safe.

**Guardrail ($0.090):** agent family n=3 on Haiku, new order + marks: **9/9**
(find-and-update 3/3, refuses-unapproved-edit 3/3, needs-a-skill 3/3). All 22
calls under 4,096 → no cache, cost at full price.

**In the app:** `one-ai-live` on the running app with marks on — cited answer
with source chips (the excerpts now ride at the end of the message), Insert +
Undo, "Delete this note" refused.

**Not measured here:** OpenAI / DeepSeek / Gemini / llama.cpp automatic
caching (no key or no model running); covered by the prefix tests — the system
prompt is identical whatever was retrieved, and message N+1 starts with
message N up to the end of its question.

**Decision (rule set before the run):** reads on Sonnet 5, cost −43%,
guardrail 9/9 → marks ON by default; the order stays.
