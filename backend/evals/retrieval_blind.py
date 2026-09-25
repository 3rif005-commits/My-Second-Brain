"""Write a SECOND retrieval question set, blind to the first (E8 bias check).

    python -m evals.retrieval_blind        # PAID: one Haiku call, ~$0.03

The hand-written set (retrieval_questions.json) was written by someone who had
just read the pages, and may reuse their words without meaning to — which
favours word matching. Here a model gets each page and must ask about it
WITHOUT its distinctive words. Output: corpus/retrieval_questions_blind.json,
gold = the page the question was written from (other pages may answer too, so
every variant is under-credited alike).
"""
from __future__ import annotations

import json
import re

from evals.retrieval import CORPUS, QUESTIONS, load

OUT = CORPUS / "retrieval_questions_blind.json"

PROMPT = """You are helping test a search engine over lecture pages.

For EACH page below, write ONE question a student might type to find that page
later. Rules:
- The question must be answerable from that page.
- Do NOT reuse the page's distinctive words (technical terms, names, numbers,
  headings). Use everyday words and synonyms, the way a student who forgot the
  exact terms would ask. Common words (what, how, why, the, a) are fine.
- Skip pages that are only a title, an agenda, an index, a table of IDs or a
  list of figures — output nothing for them.
- One short question per page, at most 20 words.

Answer with JSON only: a list of {{"id": "<page id>", "q": "<question>"}}.

{pages}"""


def main() -> int:
    from services.ai import usage as usage_log
    from services.ai.router import complete_with_fallback

    pieces, _ = load()
    spec = json.loads(QUESTIONS.read_text(encoding="utf-8"))
    pages = "\n\n".join(f"=== PAGE {p.source}:{p.page} ===\n{p.text[:1500]}" for p in pieces)
    mark = len(usage_log.RECENT)
    with usage_log.annotate(surface="eval", job="retrieval-blind", trigger="eval",
                            eval_case="e8-blind", eval_config="e8"):
        raw = complete_with_fallback(
            "summarize_text", "", [{"role": "user", "content": PROMPT.format(pages=pages)}],
            max_tokens=8000, model_override="claude-haiku-4-5")
    rows = list(usage_log.RECENT)[mark:]
    match = re.search(r"\[.*\]", raw, flags=re.S)
    items = json.loads(match.group(0)) if match else []
    questions = []
    for it in items:
        src, _, page = str(it.get("id", "")).partition(":")
        if src in spec["sources"] and page.isdigit() and it.get("q"):
            questions.append({"q": it["q"].strip(), "style": "blind",
                              "gold": [[src, int(page)]]})
    OUT.write_text(json.dumps({
        "version": 1,
        "note": ("Written by claude-haiku-4-5 from each page, told not to reuse the "
                 "page's distinctive words (evals/retrieval_blind.py, 2026-09-25). "
                 "Gold = the page it was written from."),
        "sources": spec["sources"], "questions": questions}, indent=1, ensure_ascii=False))
    usd = sum(r.get("estimated_usd") or 0 for r in rows)
    print(f"{len(questions)} questions from {len(pieces)} pages · ${usd:.4f} · {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
