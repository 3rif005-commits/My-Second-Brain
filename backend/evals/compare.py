"""Compare two eval reports side by side.

    python -m evals.compare e6-html e6-md

Reading two JSON reports by eye is how a wrong conclusion gets written down.
This prints the deltas that decide an experiment — tokens, structure, pass rate
— and refuses to compare two runs that are not comparable.

Two refusals, both learned the hard way:
  - different models in the two arms is not an experiment, it is two
    measurements of different things;
  - a metric whose arms disagree on `usage_reported` mixes a provider's numbers
    with our estimate, and their difference means nothing.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPORTS = Path(__file__).parent / "reports"

# A slowdown counts only when it is big in both senses (PhotoCraft's perf budgets): more
# than 15 % AND more than half a second. Model latency is noisy, so either test alone flags
# runs that differ by luck.
SLOWER_SHARE = 0.15
SLOWER_MS = 500


def latest(config: str) -> dict:
    """The most recent report for a config name."""
    # Exact name + timestamp: a bare `{config}-*` also matched `{config}-b-…`,
    # silently comparing the wrong run (caught while aggregating E14).
    stamp = re.compile(rf"^{re.escape(config)}-\d{{8}}-\d{{6}}\.json$")
    matches = sorted(p for p in REPORTS.glob(f"{config}-*.json") if stamp.match(p.name))
    if not matches:
        raise SystemExit(f"no report found for config '{config}' in {REPORTS}")
    return json.loads(matches[-1].read_text())


def _models(report: dict) -> set[str]:
    return {m for s in report["summary"].values() for m in s.get("models", [])}


def _delta(a: float | None, b: float | None) -> str:
    if a in (None, 0) or b is None:
        return "—"
    change = (b - a) / a * 100
    return f"{change:+.0f}%"


def slower(a_ms: int | None, b_ms: int | None) -> bool | None:
    """True when B is slower than A by both margins; None when either wasn't measured
    (an unknown is said as unknown, never a made-up number)."""
    if a_ms is None or b_ms is None:
        return None
    return b_ms - a_ms > SLOWER_MS and b_ms > a_ms * (1 + SLOWER_SHARE)


def compare(a: dict, b: dict, a_name: str, b_name: str) -> int:
    models_a, models_b = _models(a), _models(b)
    if models_a != models_b:
        print("REFUSING: the arms used different models —")
        print(f"  {a_name}: {', '.join(sorted(models_a)) or '(none)'}")
        print(f"  {b_name}: {', '.join(sorted(models_b)) or '(none)'}")
        print("Two models is not an experiment. Re-run one arm with --model.")
        return 2

    print(f"A = {a_name}  (variant: {a.get('variant', 'html')}, "
          f"n={a.get('runs_per_case')})")
    print(f"B = {b_name}  (variant: {b.get('variant', 'html')}, "
          f"n={b.get('runs_per_case')})")
    print(f"model: {', '.join(sorted(models_a)) or 'unknown'}\n")

    head = (f"{'case':<24}{'pass A':>7}{'pass B':>8}{'out A':>8}{'out B':>8}"
            f"{'Δ out':>8}{'head A':>8}{'head B':>8}{'grnd A':>8}{'grnd B':>8}")
    print(head)
    print("-" * len(head))

    totals = {"out_a": 0, "out_b": 0, "pass_a": 0, "pass_b": 0, "runs": 0}
    slow: list[str] = []
    unmeasured: list[str] = []
    for case, sa in a["summary"].items():
        sb = b["summary"].get(case)
        if sb is None:
            print(f"{case:<24}  (missing from B)")
            continue
        totals["out_a"] += sa["median_output_tokens"]
        totals["out_b"] += sb["median_output_tokens"]
        totals["pass_a"] += sa["passed"]
        totals["pass_b"] += sb["passed"]
        totals["runs"] += sa["runs"]
        verdict = slower(sa.get("median_latency_ms"), sb.get("median_latency_ms"))
        if verdict is None:
            unmeasured.append(case)
        elif verdict:
            slow.append(f"{case} ({sa['median_latency_ms']:,} → {sb['median_latency_ms']:,} ms)")
        print(f"{case:<24}{sa['passed']}/{sa['runs']:<5}{sb['passed']}/{sb['runs']:<6}"
              f"{sa['median_output_tokens']:>8}{sb['median_output_tokens']:>8}"
              f"{_delta(sa['median_output_tokens'], sb['median_output_tokens']):>8}"
              f"{sa['median_headings']:>8}{sb['median_headings']:>8}"
              f"{sa['median_grounding']:>8}{sb['median_grounding']:>8}")

    print(f"\n  output tokens: {totals['out_a']:,} → {totals['out_b']:,} "
          f"({_delta(totals['out_a'], totals['out_b'])})")
    print(f"  cases passed:  {totals['pass_a']}/{totals['runs']} → "
          f"{totals['pass_b']}/{totals['runs']}")

    if slow:
        print(f"  SLOWER (>{SLOWER_SHARE:.0%} and >{SLOWER_MS} ms): {', '.join(slow)}")
    if unmeasured:
        print(f"  latency not measured in: {', '.join(unmeasured)}")

    # Checked per arm: merging the two summaries first would let one arm's
    # reported numbers mask the other's estimate for the same case.
    mixed = {f"{name}/{case}"
             for name, report in ((a_name, a), (b_name, b))
             for case, s in report["summary"].items()
             if not s.get("usage_reported", True)}
    if mixed:
        print(f"\n  note: estimated (not provider-reported) token counts in: "
              f"{', '.join(sorted(mixed))}")
        print("  Estimates and reported numbers are not the same measurement.")

    for name, report in ((a_name, a), (b_name, b)):
        failures = {f for s in report["summary"].values() for f in s["failures"]}
        if failures:
            print(f"\n  {name} failures:")
            for f in sorted(failures):
                print(f"    - {f}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("a", help="config name of the baseline arm")
    ap.add_argument("b", help="config name of the arm being tested")
    args = ap.parse_args(argv)
    return compare(latest(args.a), latest(args.b), args.a, args.b)


if __name__ == "__main__":
    raise SystemExit(main())
