"""Is this model good enough to be the routing brain? (spec §8)

    python -m evals.routing_brain                 # the local model (llama.cpp on :8080)
    python -m evals.routing_brain --kind cloud    # PAID: ~50 tiny calls on the first cloud provider
    python -m evals.routing_brain --limit 10      # a quick look

Each of the 50 questions in corpus/routing_queries.json carries the slot YOU
would pick (edit the labels — the score is agreement with you). The brain sees
exactly what it sees in the app: the message, a few facts, the slot list and
the default instructions; never note text.

Pass bar, from the design: agreement >= 80% and median decision <= 1 s. A
brain that fails it is not an error in the app — it just means "rules only"
stays the better choice on this hardware.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import statistics
from collections import Counter
from pathlib import Path

from services.routing import brain, policy
from services.routing.rules import Signals

CASES = Path(__file__).parent / "corpus" / "routing_queries.json"
PASS_AGREEMENT = 0.80
PASS_MEDIAN_MS = 1000


def _provider(kind: str, user_id: str):
    p = policy.validate({"brain": {"kind": kind}})
    found = brain.brain_provider(p, user_id)
    if found is None:
        raise SystemExit(f"No provider for a {kind} brain — configure one first.")
    return found


async def run(kind: str, limit: int | None, timeout_ms: int, user_id: str) -> dict:
    cases = json.loads(CASES.read_text())["cases"][:limit]
    prov = _provider(kind, user_id)
    slots = list(policy.SLOTS)
    instructions = policy.DEFAULT_INSTRUCTIONS
    rows = []
    for c in cases:
        s = Signals(surface="chat", query=c["query"], query_chars=len(c["query"]),
                    est_tokens=len(c["query"]) // 4)
        d = await brain.decide(kind, prov, c["query"], s, slots, instructions, timeout_ms)
        rows.append({"query": c["query"], "want": c["slot"], "got": d.slot,
                     "ms": d.latency_ms, "error": d.error, "reason": d.reason})
        mark = "ok " if d.slot == c["slot"] else "XX "
        print(f"{mark}{c['slot']:>6} -> {str(d.slot):>6}  {d.latency_ms:>6} ms  {c['query'][:60]}"
              + (f"   [{d.error}]" if d.error else ""))
    n = len(rows)
    agree = sum(r["got"] == r["want"] for r in rows) / n
    ms = [r["ms"] for r in rows]
    confusion = Counter((r["want"], r["got"]) for r in rows if r["got"] != r["want"])
    report = {
        "brain": kind, "provider": prov.label or prov.provider, "model": prov.model,
        "cases": n, "agreement": round(agree, 3),
        "median_ms": int(statistics.median(ms)), "p95_ms": int(sorted(ms)[int(0.95 * (n - 1))]),
        "no_decision": sum(r["got"] is None for r in rows),
        "confusion": {f"{w}->{g}": k for (w, g), k in confusion.most_common()},
        "passes": agree >= PASS_AGREEMENT and statistics.median(ms) <= PASS_MEDIAN_MS,
        "rows": rows,
    }
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--kind", choices=["local", "cloud"], default="local")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--timeout-ms", type=int, default=20000,
                    help="generous on purpose: measure the speed, don't cut it off")
    ap.add_argument("--user-id", default="", help="for a cloud brain from your saved keys")
    args = ap.parse_args()
    report = asyncio.run(run(args.kind, args.limit, args.timeout_ms, args.user_id))
    out = Path(__file__).parent / "reports" / f"routing_brain_{args.kind}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(report, indent=1))
    print(f"\n{report['provider']} ({report['model'] or 'default'}): "
          f"agreement {report['agreement']:.0%} · median {report['median_ms']} ms · "
          f"p95 {report['p95_ms']} ms · no decision {report['no_decision']}")
    if report["confusion"]:
        print("misses:", ", ".join(f"{k} ×{v}" for k, v in report["confusion"].items()))
    print("PASS — worth turning on as the brain" if report["passes"]
          else f"FAIL — keep 'Rules only' (needs >= {PASS_AGREEMENT:.0%} and median <= {PASS_MEDIAN_MS} ms)")
    print(f"report: {out}")


if __name__ == "__main__":
    main()
