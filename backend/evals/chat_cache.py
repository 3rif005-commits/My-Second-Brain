"""E3b: does a chat conversation reuse its cached start, on a given model?

    python -m evals.chat_cache --model claude-haiku-4-5 --marks     # PAID
    python -m evals.chat_cache --model claude-sonnet-5              # PAID

Four messages of one conversation through the real engine (run_turn), with an
in-memory brain whose search returns DIFFERENT notes each message — the case
that used to put new text at the very start of every request. Prints each
model call's input / cache write / cache read / cost, and the total.
"""
from __future__ import annotations

import argparse
import asyncio
from dataclasses import replace
from pathlib import Path

NOTES = [
    {"id": "n1", "title": "Bias and variance",
     "content_text": "Bias is error from wrong assumptions; variance is error "
                     "from sensitivity to the training set. Total error = "
                     "bias^2 + variance + irreducible noise."},
    {"id": "n2", "title": "Gradient descent",
     "content_text": "The learning rate sets the step size. Too large diverges, "
                     "too small crawls. Momentum averages past gradients."},
    {"id": "n3", "title": "Q-learning",
     "content_text": "Q(s,a) <- Q(s,a) + alpha * (r + gamma * max Q(s',a') - Q(s,a)). "
                     "The discount factor gamma weighs future reward."},
    {"id": "n4", "title": "Regularisation",
     "content_text": "L2 shrinks weights toward zero and trades variance for "
                     "bias; cross-validation picks its strength."},
]
QUESTIONS = [
    "In one sentence, what is the bias-variance trade-off?",
    "How does the learning rate relate to that?",
    "And what does gamma do in Q-learning?",
    "Which note would help me reduce variance?",
]


async def conversation(model: str | None) -> list[dict]:
    from evals.agent_case import run_agent_case
    from models.agent import Mode
    from services.agent.model import get_provider
    from services.agent.skills import SkillRegistry
    from services.ai import usage as usage_log

    registry = SkillRegistry.load([Path(__file__).parent.parent / "skills"])
    provider = get_provider(Mode.API, user_id="")
    if model:
        provider = replace(provider, chat_model=model)
    history: list[dict] = []
    calls: list[dict] = []
    for i, q in enumerate(QUESTIONS):
        # each message retrieves a different note: the per-message part changes
        case = {"query": q, "history": history,
                "notes": [dict(NOTES[i], retrieved=True)]}
        mark = len(usage_log.RECENT)
        with usage_log.annotate(surface="eval", job="agent", trigger="eval",
                                eval_case="chat-cache", eval_config="e3b"):
            out = await run_agent_case(case, provider, registry)
        for r in list(usage_log.RECENT)[mark:]:
            calls.append({"message": i + 1, **r})
        history = history + [{"role": "user", "content": q},
                             {"role": "assistant", "content": out.text or "(no text)"}]
    return calls


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model")
    ap.add_argument("--marks", action="store_true",
                    help="turn on the Anthropic/OpenRouter cache marks (AGENT_PROMPT_CACHE)")
    args = ap.parse_args(argv)
    from core.config import settings
    settings.agent_prompt_cache = args.marks

    calls = asyncio.run(conversation(args.model))
    print(f"{'msg':>3} {'model':<22}{'input':>7}{'write':>7}{'read':>7}{'out':>6}{'usd':>9}")
    total = 0.0
    for c in calls:
        usd = c.get("estimated_usd") or 0.0
        total += usd
        print(f"{c['message']:>3} {str(c.get('model'))[:21]:<22}{c.get('input_tokens', 0):>7}"
              f"{c.get('cache_write_tokens', 0):>7}{c.get('cache_read_tokens', 0):>7}"
              f"{c.get('output_tokens', 0):>6}{usd:>9.5f}")
    uncached = sum(c.get("input_tokens", 0) + c.get("cache_write_tokens", 0)
                   + c.get("cache_read_tokens", 0) for c in calls)
    read = sum(c.get("cache_read_tokens", 0) for c in calls)
    print(f"\ncalls {len(calls)} · total ${total:.5f} · input side {uncached} tokens,"
          f" {read} read from cache ({read / uncached:.0%})" if uncached else "")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
