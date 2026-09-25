"""E8b — does the app-wide chat ANSWER correctly from what its search returns?

    python -m evals.chat_answers --arm today --arm new      # PAID, ~$0.2

The brain: two real study-guide notes (corpus/notes/*.json). Each question
has a known fact (corpus/chat_questions.json) — in the text, in a table, or
in a formula. For each arm the notes are cut into blocks, searched the way
services/retriever.py pass 2 does (embedding fused with words, top 15), and
the question goes through the real chat engine (engine.run_turn, Haiku) with
those results as its knowledge context. The model may still open a whole note
with brain.get_note — its recovery path — so rounds and cost are recorded.

Arms:
  today — blocks as indexed before E8b (tables, formulas, link text skipped),
          each hit shown as its first 300 characters;
  new   — tables, formulas and links indexed, and each hit shown with its
          neighbours up to 700 characters (services/retriever.with_neighbours).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import re
from pathlib import Path

from evals.retrieval import _cos, embed_all

HERE = Path(__file__).parent
NOTES = {"nA": HERE / "corpus" / "notes" / "ml-slides-guide.json",
         "nB": HERE / "corpus" / "notes" / "ml-lecture-10-guide.json"}
QUESTIONS = HERE / "corpus" / "chat_questions.json"


def _legacy_parse(content) -> list[dict]:
    """The block chunker as it was before E8b: plain inline text only."""
    out: list[dict] = []

    def walk(blocks):
        for b in blocks or []:
            if not isinstance(b, dict) or b.get("type") == "horizontalRule":
                continue
            parts = [i.get("text", "") for i in (b.get("content") or [])
                     if isinstance(i, dict) and i.get("type") == "text"] \
                if isinstance(b.get("content"), list) else []
            text = " ".join(parts).strip()
            if text:
                out.append({"block_id": b.get("id", ""), "chunk_index": len(out),
                            "chunk_text": text})
            walk(b.get("children"))
    walk(content)
    return out


def blocks_for(arm: str) -> tuple[list[dict], dict[str, dict]]:
    from services.block_chunker import parse
    rows, notes = [], {}
    for nid, path in NOTES.items():
        note = json.loads(path.read_text(encoding="utf-8"))
        notes[nid] = {"id": nid, "title": note["title"],
                      "content_text": note.get("content_text") or ""}
        chunks = _legacy_parse(note["content"]) if arm == "today" else parse(note["content"])
        rows += [{**c, "note_id": nid} for c in chunks]
    return rows, notes


def search(arm: str, query: str, rows: list[dict], vecs: list, qvec) -> list[dict]:
    """services/retriever.py pass 2, on these rows, without a database."""
    from services.retriever import _fused_blocks, with_neighbours
    scored = sorted(range(len(rows)), key=lambda i: -_cos(qvec, vecs[i]))[:40]
    vector_rows = [{**rows[i], "dist": 1 - _cos(qvec, vecs[i])} for i in scored]
    hits = _fused_blocks(query, vector_rows, rows)
    if arm == "today":
        passages = [(h, (h.get("chunk_text") or "")[:300]) for h in hits]
    else:
        passages = with_neighbours(hits, rows)
    return [{"id": h["note_id"], "title": "", "deep_link": f"/brain/{h['note_id']}#{h['block_id']}",
             "content_text": text} for h, text in passages]


def _norm(text: str) -> str:
    text = text.replace("−", "-").replace("–", "-").lower()
    return re.sub(r"(?<=\d),(?=\d{3})", "", text)


def correct(answer: str, expect: list[list[str]]) -> bool:
    a = _norm(answer)
    return all(any(_norm(alt) in a for alt in group) for group in expect)


async def run(arms: list[str], model: str | None) -> dict:
    from dataclasses import replace

    from evals.agent_case import run_agent_case
    from models.agent import Mode
    from services.agent.model import get_provider
    from services.agent.skills import SkillRegistry
    from services.ai import usage as usage_log

    questions = json.loads(QUESTIONS.read_text(encoding="utf-8"))["questions"]
    registry = SkillRegistry.load([HERE.parent / "skills"])
    provider = get_provider(Mode.API, user_id="")
    if model:
        provider = replace(provider, chat_model=model)
    qvecs = embed_all([q["q"] for q in questions])
    report = {}
    for arm in arms:
        rows, notes = blocks_for(arm)
        vecs = embed_all([r["chunk_text"] for r in rows])
        results = []
        for q, qvec in zip(questions, qvecs):
            retrieved = search(arm, q["q"], rows, vecs, qvec)
            for r in retrieved:
                r["title"] = notes[r["id"]]["title"]
            case = {"query": q["q"], "notes": list(notes.values()), "retrieved": retrieved}
            mark = len(usage_log.RECENT)
            with usage_log.annotate(surface="eval", job="agent", trigger="eval",
                                    eval_case="chat-answers", eval_config=f"e8b-{arm}"):
                out = await run_agent_case(case, provider, registry)
            calls = list(usage_log.RECENT)[mark:]
            ok = correct(out.text, q["expect"])
            results.append({"q": q["q"], "where": q["where"], "ok": ok,
                            "opened_note": "brain.get_note" in out.tools_called,
                            "rounds": len(calls),
                            "input_tokens": sum(c.get("input_tokens", 0) + c.get("cache_read_tokens", 0)
                                                + c.get("cache_write_tokens", 0) for c in calls),
                            "usd": sum(c.get("estimated_usd") or 0 for c in calls),
                            "answer": out.text[:300],
                            "context_chars": sum(len(r["content_text"]) for r in retrieved)})
            print(f"  {arm:5} {'ok ' if ok else 'MISS'} {q['where']:5} rounds {len(calls)}"
                  f"{' +get_note' if results[-1]['opened_note'] else ''}  {q['q'][:60]}")
        report[arm] = results
    return report


def summary(report: dict) -> None:
    print(f"\n{'arm':6}{'correct':>9}{'table':>7}{'math':>6}{'text':>6}{'opened':>8}"
          f"{'rounds':>8}{'ctx chars':>11}{'in tok':>8}{'usd':>9}")
    for arm, rs in report.items():
        by = lambda w: f"{sum(r['ok'] for r in rs if r['where'] == w)}/{sum(r['where'] == w for r in rs)}"
        n = len(rs)
        print(f"{arm:6}{sum(r['ok'] for r in rs):>6}/{n:<2}{by('table'):>7}{by('math'):>6}{by('text'):>6}"
              f"{sum(r['opened_note'] for r in rs):>8}{sum(r['rounds'] for r in rs) / n:>8.2f}"
              f"{sum(r['context_chars'] for r in rs) / n:>11.0f}"
              f"{sum(r['input_tokens'] for r in rs) / n:>8.0f}{sum(r['usd'] for r in rs):>9.4f}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--arm", action="append", choices=("today", "new"))
    ap.add_argument("--model")
    ap.add_argument("--out", type=Path)
    args = ap.parse_args(argv)
    report = asyncio.run(run(args.arm or ["today", "new"], args.model))
    summary(report)
    out = args.out or HERE / "reports" / "chat-answers.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(report, indent=1))
    print(f"\nreport: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
