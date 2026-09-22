"""The eval runner — one command, a table of numbers, a JSON report.

    python -m evals.run --config baseline --runs 3
    python -m evals.run --dry-run                 # no model calls, checks plumbing
    python -m evals.run --case md-bias-variance   # one case while iterating

Every run writes an `ai_runs` row tagged with (eval_config, eval_case), so cost
and tokens come from the same log the app uses in production — the eval cannot
drift away from what users actually pay.

What it measures: prompt → model → HTML → deterministic score. Extraction is
deliberately out of scope (the cases carry text directly), because extraction
quality is a different axis with its own experiment (E8), and mixing the two
makes a regression impossible to attribute.

Rules this file enforces, so a comparison means something:
  - expectations are ranges, and a case passes only if every one holds;
  - n runs per case, and the report carries the median plus the spread — these
    are sampled systems and n=1 has fooled this project before;
  - runs whose token counts were estimated rather than reported are flagged,
    and never averaged together with reported ones.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from evals.score_note import score_note

CORPUS = Path(__file__).parent / "corpus"
REPORTS = Path(__file__).parent / "reports"
EVAL_USER = "eval"          # no DB row; .env providers are used


@dataclass
class CaseResult:
    case_id: str
    run: int
    ok: bool
    failures: list[str]
    score: dict[str, Any]
    latency_ms: int
    error: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    usd: float | None = None
    #: False when the provider reported no usage and these are our estimate.
    #: Reported and estimated runs are never averaged together.
    usage_reported: bool = False
    model: str | None = None
    #: First part of what the model actually produced. Without it a failure is
    #: a number with no explanation, and the next session re-runs the case
    #: blind just to see the text.
    html_excerpt: str = ""
    #: Every provider attempt this run made, in order. A fallback chain that
    #: quietly answered with a different model would otherwise look like a
    #: result from the model you thought you were measuring.
    attempts: list[dict] = field(default_factory=list)


def load_manifest(path: Path | None = None) -> dict:
    return json.loads((path or (CORPUS / "manifest.json")).read_text())


def _source_blocks(case: dict) -> list[dict]:
    blocks = []
    for src in case["sources"]:
        text = (CORPUS / src["path"]).read_text(encoding="utf-8")
        blocks.append({"title": src["title"], "kind": src.get("kind", "document"),
                       "text": text})
    return blocks


def check(score, expect: dict, source_count: int) -> list[str]:
    """Every expectation that did NOT hold, in plain words."""
    d = score.as_dict()
    out: list[str] = []

    def less(key: str, actual, limit):
        out.append(f"{key} {actual} < {limit}")

    for key, limit in expect.items():
        if key.endswith("_min"):
            name = key[:-4]
            actual = {
                "heading_total": d["heading_total"],
                "callout_total": d["callout_total"],
                "math_blocks": d["math_blocks"],
                "tables": d["tables"],
                "toggles": d["toggles"],
                "toggles_with_body": d["toggles_with_body"],
                "grounding": d["grounding"],
                "anchor_validity": d["anchor_validity"],
                "must_mention_rate": d["must_mention_rate"],
                "sources_cited": len({a.split(":")[0] for a in score.anchors}),
            }.get(name)
            if actual is None:
                out.append(f"unknown expectation {key}")
            elif actual < limit:
                less(name, actual, limit)
        elif key.endswith("_max"):
            name = key[:-4]
            actual = {
                "unknown_callouts": len(d["unknown_callouts"]),
                "forbidden_hit": len(d["forbidden_hit"]),
                "anchor_problems": len(d["anchor_problems"]),
            }.get(name)
            if actual is None:
                out.append(f"unknown expectation {key}")
            elif actual > limit:
                out.append(f"{name} {actual} > {limit}")
        elif key.endswith("_exact"):
            name = key[:-6]
            actual = d["headings"].get(name, 0) if name.startswith("h") else None
            if actual != limit:
                out.append(f"{name} {actual} != {limit}")
    if score.forbidden_hit:
        out.append(f"forbidden text present: {score.forbidden_hit}")
    return out


def run_case(case: dict, config: str, run_index: int, dry_run: bool) -> CaseResult:
    from prompts.note_synthesis import build_note_synthesis_prompt
    from services.ai import usage as usage_log

    blocks = _source_blocks(case)
    prompt = build_note_synthesis_prompt(blocks)
    mark = len(usage_log.RECENT)
    started = time.monotonic()
    html, error = "", None

    if dry_run:
        # Plumbing check: score the sources themselves so the whole path runs
        # without spending anything. Never counts as a pass.
        html = "".join(f"<h3 data-anchor=\"{i}:s:1\">{b['title']}</h3>"
                       for i, b in enumerate(blocks, start=1))
    else:
        from services.ai.router import complete_with_fallback
        from services.workspace.synthesis import _strip_fences
        try:
            with usage_log.annotate(surface="eval", job="synthesis",
                                    trigger="eval", user_id=None,
                                    eval_case=case["id"], eval_config=config):
                html = _strip_fences(complete_with_fallback(
                    "summarize_text", EVAL_USER,
                    [{"role": "user", "content": prompt}], max_tokens=16000))
        except Exception as e:                      # noqa: BLE001
            error = f"{type(e).__name__}: {e}"[:300]

    latency_ms = int((time.monotonic() - started) * 1000)
    # Straight from the run log, so the eval's cost column and the app's own
    # spend numbers can never disagree.
    rows = [] if dry_run else list(usage_log.RECENT)[mark:]
    last = rows[-1] if rows else {}
    attempts = [{"model": r.get("model"), "status": r.get("status"),
                 "error": r.get("error")} for r in rows]
    score = score_note(html, source_count=len(blocks),
                       must_mention=case.get("must_mention"),
                       must_not_mention=case.get("must_not_mention"))
    failures = ["call failed: " + error] if error else check(
        score, case.get("expect", {}), len(blocks))
    if dry_run:
        failures = ["dry run — no model was called"]

    return CaseResult(case["id"], run_index, not failures, failures,
                      score.as_dict(), latency_ms, error,
                      input_tokens=last.get("input_tokens", 0),
                      output_tokens=last.get("output_tokens", 0),
                      usd=last.get("estimated_usd"),
                      usage_reported=bool(last.get("usage_reported")),
                      model=last.get("model"),
                      html_excerpt=(html or "")[:800],
                      attempts=attempts)


def summarise(results: list[CaseResult]) -> dict:
    by_case: dict[str, list[CaseResult]] = {}
    for r in results:
        by_case.setdefault(r.case_id, []).append(r)

    summary = {}
    for case_id, runs in by_case.items():
        spend = [r.usd for r in runs if r.usd is not None]
        summary[case_id] = {
            "runs": len(runs),
            "passed": sum(1 for r in runs if r.ok),
            "model": next((r.model for r in runs if r.model), None),
            "median_input_tokens": int(statistics.median(
                r.input_tokens for r in runs)),
            "median_output_tokens": int(statistics.median(
                r.output_tokens for r in runs)),
            "median_usd": round(statistics.median(spend), 4) if spend else None,
            "total_usd": round(sum(spend), 4) if spend else None,
            "usage_reported": all(r.usage_reported for r in runs),
            "models": sorted({r.model for r in runs if r.model}),
            "fallbacks": [a for r in runs for a in r.attempts
                          if a["status"] == "error"],
            "median_latency_ms": int(statistics.median(r.latency_ms for r in runs)),
            "median_headings": statistics.median(
                r.score["heading_total"] for r in runs),
            "median_math": statistics.median(r.score["math_blocks"] for r in runs),
            "median_grounding": statistics.median(
                r.score["grounding"] for r in runs),
            "failures": sorted({f for r in runs for f in r.failures}),
        }
    return summary


def print_table(summary: dict) -> None:
    head = (f"{'case':<26}{'pass':>6}{'head':>7}{'math':>6}{'grnd':>7}"
            f"{'in':>8}{'out':>8}{'usd':>9}{'ms':>8}  model")
    print(head)
    print("-" * len(head))
    total = 0.0
    for case_id, s in summary.items():
        usd = s["median_usd"]
        total += s["total_usd"] or 0.0
        print(f"{case_id:<26}{s['passed']}/{s['runs']:<4}"
              f"{s['median_headings']:>7}{s['median_math']:>6}"
              f"{s['median_grounding']:>7}{s['median_input_tokens']:>8}"
              f"{s['median_output_tokens']:>8}"
              f"{('$' + format(usd, '.4f')) if usd is not None else '—':>9}"
              f"{s['median_latency_ms']:>8}  "
              f"{'/'.join(m.split('/')[-1][:22] for m in s['models']) or '—'}")
    all_models = sorted({m for s in summary.values() for m in s["models"]})
    if len(all_models) > 1:
        print("\n  !! runs used MORE THAN ONE MODEL: " + ", ".join(all_models))
        print("     The provider chain fell back mid-run. These numbers are not"
              " one measurement —\n     fix the provider or split the report"
              " before comparing anything.")
    for case_id, s in summary.items():
        for f in s["fallbacks"]:
            print(f"  fallback in {case_id}: {f['model']} failed — {f['error']}")
    print(f"\n  spent this run: ${total:.4f}"
          + ("" if all(s["usage_reported"] for s in summary.values())
             else "  (some numbers are ESTIMATES — the provider reported none)"))
    print()
    for case_id, s in summary.items():
        if s["failures"]:
            print(f"{case_id}:")
            for f in s["failures"]:
                print(f"  - {f}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", default="baseline",
                    help="name this configuration — it is written to every run row")
    ap.add_argument("--runs", type=int, default=3,
                    help="runs per case; 1 is a demo, not a measurement")
    ap.add_argument("--case", action="append", help="limit to these case ids")
    ap.add_argument("--family", action="append", help="limit to these families")
    ap.add_argument("--dry-run", action="store_true",
                    help="no model calls — checks the corpus, scorer and report path")
    ap.add_argument("--manifest", type=Path, default=None)
    args = ap.parse_args(argv)

    manifest = load_manifest(args.manifest)
    cases = manifest["cases"]
    if args.case:
        cases = [c for c in cases if c["id"] in args.case]
    if args.family:
        cases = [c for c in cases if c.get("family") in args.family]
    if not cases:
        print("no cases matched", file=sys.stderr)
        return 2

    results: list[CaseResult] = []
    for case in cases:
        for i in range(args.runs):
            r = run_case(case, args.config, i, args.dry_run)
            results.append(r)
            print(f"  {case['id']} run {i + 1}/{args.runs}: "
                  f"{'ok' if r.ok else 'FAIL'} ({r.latency_ms} ms)", file=sys.stderr)

    summary = summarise(results)
    print_table(summary)

    REPORTS.mkdir(exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    report = REPORTS / f"{args.config}-{stamp}.json"
    report.write_text(json.dumps({
        "config": args.config,
        "runs_per_case": args.runs,
        "dry_run": args.dry_run,
        "summary": summary,
        "results": [r.__dict__ for r in results],
    }, indent=2))
    print(f"\nreport: {report}")

    return 0 if all(s["passed"] == s["runs"] for s in summary.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
