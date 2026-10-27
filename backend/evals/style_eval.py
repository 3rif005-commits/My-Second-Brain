"""E12 — learn a student's style from their edits, with a simulated student.

    python -m evals.style_eval                 # PAID ~$0.01: the learner only
    python -m evals.style_eval --generate 3    # PAID ~$0.17: + 3 guides with the style

The student has two clear habits, applied to five real AI guides (the three
Lecture 10 calibration guides and the two chaptered IML guides):
  1. deletes every ANALOGY box;
  2. ends each chapter with a short "Key takeaways" list.
Checks: (a) the learner suggests exactly these two, and nothing about the
topic; (b) with them in "Your style", new Lecture 10 guides have no analogy
box and a Key takeaways list in each chapter; (c) the quality guard against
the user-approved note still passes.

The style is written to a TEMPORARY skills folder for this process only — the
user's own skills (the database) are never touched.
"""
from __future__ import annotations

import argparse
import re
import tempfile
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).parent
GUIDES = sorted((HERE / "reference").glob("ml-lecture-10.baseline-2026-09-25-*.html")) \
    + sorted((HERE / "reference" / "e9").glob("chaptered-*.html"))

_DIV = re.compile(r"<(/?)div\b[^>]*>", re.I)


def remove_callouts(html: str, kind: str) -> str:
    """Delete every callout of one type, children included (depth-counted)."""
    out, pos = [], 0
    start_re = re.compile(rf'<div\b[^>]*data-callout-type="{kind}"[^>]*>', re.I)
    while True:
        m = start_re.search(html, pos)
        if not m:
            out.append(html[pos:])
            return "".join(out)
        out.append(html[pos:m.start()])
        depth, end = 1, m.end()
        for t in _DIV.finditer(html, m.end()):
            depth += -1 if t.group(1) else 1
            if depth == 0:
                end = t.end()
                break
        pos = end


def add_takeaways(html: str) -> str:
    """End each chapter with a Key takeaways list of its first concepts."""
    parts = re.split(r"(?=<h2\b)", html)
    out = []
    for part in parts:
        if part.lower().startswith("<h2"):
            concepts = [re.sub(r"<[^>]+>", "", c).strip()
                        for c in re.findall(r"<h5[^>]*>(.*?)</h5>", part, re.S)][:3]
            if concepts:
                items = "".join(f"<li>{c}</li>" for c in concepts)
                part = part + f"<h4>Key takeaways</h4><ul>{items}</ul>"
        out.append(part)
    return "".join(out)


def student_edit(html: str) -> str:
    return add_takeaways(remove_callouts(html, "ANALOGY"))


def adherence(html: str) -> dict:
    chapters = re.split(r"(?=<h2\b)", html)[1:]
    with_takeaways = sum(1 for c in chapters if re.search(r"key takeaways", c, re.I))
    return {"analogy_boxes": len(re.findall(r'data-callout-type="ANALOGY"', html)),
            "chapters": len(chapters), "with_takeaways": with_takeaways}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--generate", type=int, default=0,
                    help="also write this many Lecture 10 guides with the learned style")
    args = ap.parse_args(argv)

    from services.ai import usage as usage_log
    from services.workspace.style_learning import learn_from_pairs

    pairs = [(g.read_text(encoding="utf-8"), student_edit(g.read_text(encoding="utf-8")))
             for g in GUIDES]
    print(f"{len(pairs)} guides edited by the simulated student")
    for g, (a, b) in zip(GUIDES, pairs):
        print(f"  {g.name[:40]:42} before {adherence(a)}  after {adherence(b)}")

    mark = len(usage_log.RECENT)
    suggestions = learn_from_pairs(pairs)
    spent = sum(r.get("estimated_usd") or 0 for r in list(usage_log.RECENT)[mark:])
    print(f"\nlearner suggests (${spent:.4f}):")
    for s in suggestions:
        print(f"  - {s['preference']}   [{s['evidence']}]")
    found_analogy = any("analog" in s["preference"].lower() for s in suggestions)
    found_takeaways = any("takeaway" in s["preference"].lower() for s in suggestions)
    print(f"  found 'no analogy': {found_analogy} · found 'key takeaways': {found_takeaways}"
          f" · other suggestions: {len(suggestions) - found_analogy - found_takeaways}")

    if not args.generate:
        return 0
    accepted = [s["preference"] for s in suggestions
                if "analog" in s["preference"].lower() or "takeaway" in s["preference"].lower()]
    if not accepted:
        print("nothing to accept — no guide written")
        return 1
    from evals.quality_guard import REPORTS, compare, defects, generate, median_profile
    from evals.quality_guard import print_verdict, profile, reference_html
    with tempfile.TemporaryDirectory() as tmp:
        ref_dir = Path(tmp) / "study-guide" / "reference"
        ref_dir.mkdir(parents=True)
        (ref_dir / "style.md").write_text("\n".join(accepted) + "\n", encoding="utf-8")
        print(f"\nstyle accepted by the student:\n  " + "\n  ".join(accepted))
        htmls, cut, spent = [], [], 0.0
        with patch("prompts._skill_text.user_skills_dir", lambda: Path(tmp)):
            for i in range(args.generate):
                html, truncated, row = generate(cache=True)
                spent += row.get("estimated_usd") or 0
                REPORTS.mkdir(exist_ok=True)
                (REPORTS / f"style-eval-{i + 1}.html").write_text(html, encoding="utf-8")
                htmls.append(html)
                cut.append(truncated)
                print(f"  guide {i + 1}: {adherence(html)}")
    print(f"spent on guides ${spent:.4f}\n")
    profiles = [profile(h) for h in htmls]
    verdict = compare(median_profile(profiles), profile(reference_html()))
    verdict.problems += defects(profiles, cut)
    verdict.ok = verdict.ok and not verdict.problems
    print_verdict(verdict, profiles)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
