"""E9 — does each lecture keep its depth when a guide covers several?

    python -m evals.multi_source solo 08 --runs 2        # PAID: one lecture alone
    python -m evals.multi_source combined 08 09 10       # PAID: the app's one call
    python -m evals.multi_source report                  # free: the comparison

A guide is written through the app's own path (the study-guide instructions
as they are on disk — never edited here — the synthesis/anchor rules, the
provider chain, the 32K cap). Each guide is saved in reports/multi-source/.

Per-lecture depth: every <h3> carries a source anchor ("2:p:14"); a section
runs to the next <h3>/<h2>. The text, tables, formulas and boxes of the
sections anchored to lecture i are its share of the guide, compared with the
guide written for lecture i alone.
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import time
from pathlib import Path

from evals.score_note import score_note

HERE = Path(__file__).parent
SOURCES = HERE / "corpus" / "sources"
OUT = HERE / "reports" / "multi-source"
TITLES = {
    "08": "Machine Learning Lecture 08 - Ensembles",
    "09": "Machine Learning Lecture 09 - Unsupervised Learning",
    "10": "Machine Learning Lecture 10 - Reinforcement Learning",
    "11": "Machine Learning Lecture 11 - Bias, Fairness & Ethics",
}


def blocks(lectures: list[str]) -> list[dict]:
    return [{"title": TITLES[n], "kind": "pdf",
             "text": (SOURCES / f"iml-lecture-{n}.extracted.txt").read_text(encoding="utf-8")}
            for n in lectures]


def write_guide(lectures: list[str], method: str = "single") -> dict:
    """One guide. `single` is the app today: every source in one call."""
    from prompts.note_synthesis import build_note_synthesis_prompt
    from services.ai import usage as usage_log
    from services.ai.client import last_call_truncated
    from services.ai.router import complete_with_fallback
    from services.workspace.synthesis import OUTPUT_CAP, _strip_fences, synthesis_messages

    srcs = blocks(lectures)
    mark = len(usage_log.RECENT)
    started = time.monotonic()
    with usage_log.annotate(surface="eval", job="synthesis", trigger="eval",
                            eval_case="multi-source", eval_config=f"e9-{method}"):
        if method == "single":
            html = _strip_fences(complete_with_fallback(
                "summarize_text", "", synthesis_messages(build_note_synthesis_prompt(srcs)),
                max_tokens=OUTPUT_CAP))
            truncated = last_call_truncated()
        else:
            from services.workspace.chaptered import synthesize_chaptered
            done = synthesize_chaptered(srcs, user_id="")
            if done is None:
                raise SystemExit("the chapter plan failed — nothing to measure")
            html, truncated = done
    rows = list(usage_log.RECENT)[mark:]
    return {"lectures": lectures, "method": method, "html": html, "truncated": truncated,
            "seconds": round(time.monotonic() - started),
            "calls": len(rows),
            "input_tokens": sum(r.get("input_tokens", 0) + r.get("cache_read_tokens", 0)
                                + r.get("cache_write_tokens", 0) for r in rows),
            "output_tokens": sum(r.get("output_tokens", 0) for r in rows),
            "usd": round(sum(r.get("estimated_usd") or 0 for r in rows), 4)}


from services.workspace.guide_check import per_source  # noqa: E402  (the app's own measure)


def save(result: dict) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    name = f"{result['method']}-{'-'.join(result['lectures'])}-{time.strftime('%Y%m%d-%H%M%S')}"
    (OUT / f"{name}.html").write_text(result["html"], encoding="utf-8")
    meta = {k: v for k, v in result.items() if k != "html"}
    (OUT / f"{name}.json").write_text(json.dumps(meta, indent=1))
    return OUT / f"{name}.html"


def load_runs() -> list[dict]:
    runs = []
    for meta in sorted(OUT.glob("*.json")):
        m = json.loads(meta.read_text())
        m["html"] = meta.with_suffix(".html").read_text(encoding="utf-8")
        runs.append(m)
    return runs


def report() -> None:
    runs = load_runs()
    solo: dict[str, list[dict]] = {}
    for r in runs:
        if len(r["lectures"]) == 1:
            solo.setdefault(r["lectures"][0], []).append(per_source(r["html"], 1)[1])
    keys = ("text_chars", "tables", "math", "callouts")
    print("SOLO (median per lecture)")
    med = {}
    for lec, rs in sorted(solo.items()):
        med[lec] = {k: statistics.median(x[k] for x in rs) for k in keys}
        print(f"  L{lec} n={len(rs)}  " + "  ".join(f"{k} {med[lec][k]:.0f}" for k in keys))
    print("\nMULTI-SOURCE (each lecture's share, % of its solo median)")
    for r in runs:
        if len(r["lectures"]) < 2:
            continue
        ps = per_source(r["html"], len(r["lectures"]))
        s = score_note(r["html"])
        print(f"  {r['method']:10} {'+'.join(r['lectures'])}  ${r['usd']:.3f}  out {r['output_tokens']}"
              f"  calls {r['calls']}{'  TRUNCATED' if r['truncated'] else ''}  {r['seconds']}s"
              f"  total text {s.text_chars}")
        for i, lec in enumerate(r["lectures"], start=1):
            d = ps[i]
            ratio = {k: (d[k] / med[lec][k] if med.get(lec) and med[lec][k] else float("nan"))
                     for k in keys}
            print(f"      L{lec}: sections {d['sections']:2}  " + "  ".join(
                f"{k} {d[k]:>5} ({ratio[k]:.0%})" for k in keys))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("what", choices=("solo", "combined", "chaptered", "report"))
    ap.add_argument("lectures", nargs="*")
    ap.add_argument("--runs", type=int, default=1)
    args = ap.parse_args(argv)
    if args.what == "report":
        report()
        return 0
    method = "chaptered" if args.what == "chaptered" else "single"
    for _ in range(args.runs):
        res = write_guide(args.lectures, method)
        path = save(res)
        print(f"{args.what} {'+'.join(args.lectures)}: ${res['usd']:.4f}, out {res['output_tokens']},"
              f" {res['seconds']}s{' TRUNCATED' if res['truncated'] else ''} -> {path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
