# 3.4 — Gateway merge (step A: agent provider selection + run log)

Date: 2026-09-23 · Not an experiment card: no metric moves, it is plumbing.

**What changed.** `services/agent/model.get_endpoint` no longer reads
`settings.api_provider` on its own. It asks `services/ai.router.candidates()`
for the same chain the workspace and eval runner use, filters to providers
whose wire format the engine speaks (`OPENAI_DIALECT`), and refuses with a
reason when none qualifies. Agent turns are wrapped in `usage_log.annotate` +
`track`, one run row per round, with usage parsed off the stream where the
gateway reports it.

**The bug this found.** The old `anthropic` branch returned
`https://api.anthropic.com/v1/messages` while the engine sends OpenAI
chat-completions JSON with `tools`. Setting `API_PROVIDER=anthropic` — the
obvious thing to do after making Claude primary everywhere else — produced an
agent that failed on its first request. It was never hit in production only
because the setting still defaulted to `openrouter`.

**What is still split** (step B, needs no credits to write, only to verify):
- `services/ai/client` cannot do tool calls, so Claude cannot drive the agent.
  Teaching it the Anthropic tool dialect deletes `OPENAI_DIALECT` and with it
  the refusal above.
- `services/llm.py` (legacy ingest) still has its own OpenRouter/Gemini paths.
- `frontend/app/api/ai/route.ts` still calls Gemini directly from Next.js, so
  BlockNote's inline AI spends tokens no run row ever sees.
