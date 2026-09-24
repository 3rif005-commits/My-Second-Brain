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
import re
import statistics
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from evals.score_note import score_note

#: Provider hiccups, not model behaviour. Retrying these is not hiding a
#: failure: a rate-limited call never produced a note to judge, and scoring it
#: as a bad note measures the queue rather than the prompt. Every other
#: failure — a refusal, a malformed answer, a budget stop — is a result.
_TRANSIENT = re.compile(
    r"overloaded|rate.?limit|429|timeout|timed out|temporarily|503|502|upstream",
    re.IGNORECASE)

CORPUS = Path(__file__).parent / "corpus"
REPORTS = Path(__file__).parent / "reports"
#: Deliberately empty, not a label: it reaches ai_runs.user_id, which is a uuid
#: column, and it reaches the saved-providers lookup, which is a query keyed on
#: one. "eval" broke both quietly.
EVAL_USER = ""
#: --keep-html: store every run's full note, not only failed ones.
KEEP_HTML = False


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
    #: The prompt variant this run used — "html" (shipped) or "md" (E6).
    variant: str = "html"
    #: First part of what the model actually produced. Without it a failure is
    #: a number with no explanation, and the next session re-runs the case
    #: blind just to see the text.
    html_excerpt: str = ""
    #: The whole note, kept only when the run failed — an 800-char excerpt
    #: cannot say why a guardrail fell (E6c: grounding 0.44, cause unseen).
    html_failed: str = ""
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
                # Depth floors (E6b): a pass-rate guardrail cannot see a note
                # that got shorter, so the real cases say how deep is enough.
                "anchors": d["anchors"],
                "text_chars": d["text_chars"],
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


def run_case(case: dict, config: str, run_index: int, dry_run: bool,
             model: str | None = None, variant: str = "html",
             max_tokens: int = 32000,
             retries: int = 2) -> CaseResult:
    if case.get("mode") == "agent":
        return _run_agent_case(case, config, run_index, dry_run, model)

    from prompts.note_synthesis import build_note_synthesis_prompt
    from prompts.note_synthesis_md import build_markdown_synthesis_prompt
    from services.ai import usage as usage_log

    blocks = _source_blocks(case)
    skill = None
    if case.get("skill"):
        # A skill case runs the skill's own prompt over the same source blocks
        # the app builds, and its Markdown is converted exactly as the app does.
        from services.workspace import skill_run
        skill = skill_run.registry().get(case["skill"])
        if skill is None:
            raise SystemExit(f"case {case['id']}: no skill named {case['skill']!r}")
        prompt = skill_run.build_prompt(skill, blocks)
    elif variant == "md":
        prompt = build_markdown_synthesis_prompt(blocks)
    else:
        prompt = build_note_synthesis_prompt(blocks)
    prompt_chars = len(prompt)
    mark = len(usage_log.RECENT)
    started = time.monotonic()
    html, error, truncated = "", None, False
    anchors_repaired = 0

    if dry_run:
        # Plumbing check: score the sources themselves so the whole path runs
        # without spending anything. Never counts as a pass.
        html = "".join(f"<h3 data-anchor=\"{i}:s:1\">{b['title']}</h3>"
                       for i, b in enumerate(blocks, start=1))
    else:
        from services.ai.router import complete_with_fallback
        from services.workspace.synthesis import _strip_fences
        for attempt in range(retries + 1):
            error = None
            try:
                with usage_log.annotate(surface="eval", job="synthesis",
                                        trigger="eval", user_id=None,
                                        eval_case=case["id"], eval_config=config):
                    html = _strip_fences(complete_with_fallback(
                        "summarize_text", EVAL_USER,
                        [{"role": "user", "content": prompt}], max_tokens=max_tokens,
                        model_override=model))
                from services.ai.client import last_call_truncated
                truncated = last_call_truncated()
                break
            except Exception as e:                  # noqa: BLE001
                error = f"{type(e).__name__}: {e}"[:300]
                if attempt < retries and _TRANSIENT.search(error):
                    wait = 10 * (attempt + 1)
                    print(f"    transient, retrying in {wait}s: {error[:70]}",
                          file=sys.stderr)
                    time.sleep(wait)
                    continue
                break

    if (variant == "md" or skill is not None) and html and not dry_run:
        # The editor is not part of the question: the variant is converted to
        # the same HTML the note pane parses, and scored by the same scorer.
        from services.workspace.md_to_blocks import markdown_to_html
        html = markdown_to_html(html)
        if variant == "md" and skill is None:
            from services.workspace.anchors import repair_anchors
            html, anchors_repaired = repair_anchors(html, blocks)

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
    if error:
        failures = ["call failed: " + error]
    elif not html.strip():
        # Distinct from "scored badly": a blank answer is a failed call wearing
        # a success, and reading it as six unmet expectations hides that.
        failures = ["the model returned no content"]
    else:
        failures = check(score, case.get("expect", {}), len(blocks))
        # Text the reader must never see, as regexes over the visible text —
        # e.g. the extractor's internal labels (DEF-01, INS-06) leaking into
        # prose, which the first live compare-sources note did.
        visible = re.sub(r"<[^>]+>", " ", html)
        for pattern in case.get("forbidden_patterns", []):
            hits = re.findall(pattern, visible)
            if hits:
                failures.append(f"forbidden {pattern!r}: {sorted(set(hits))[:5]}")
    if dry_run:
        failures = ["dry run — no model was called"]

    # Truncation is recorded, never scored away: a note cut off at the output
    # cap can clear every range while the reader lost the end of the lecture.
    return CaseResult(case["id"], run_index, not failures, failures,
                      {**score.as_dict(), "truncated": truncated,
                       "anchors_repaired": anchors_repaired,
                       **{f"count:{w}": len(re.findall(w, html or ""))
                          for w in case.get("count_words", [])}},
                      latency_ms, error,
                      input_tokens=last.get("input_tokens", 0),
                      output_tokens=last.get("output_tokens", 0),
                      usd=last.get("estimated_usd"),
                      usage_reported=bool(last.get("usage_reported")),
                      model=last.get("model"),
                      html_excerpt=(html or "")[:800],
                      html_failed=(html or "") if (failures or KEEP_HTML) else "",
                      attempts=attempts, variant=variant)


def _run_agent_case(case: dict, config: str, run_index: int, dry_run: bool,
                    model: str | None) -> CaseResult:
    """An agent case judges what the assistant DID, not what it wrote: which
    tools ran, what the brain looks like afterwards, and whether it answered."""
    import asyncio

    from evals.agent_case import check_agent, run_agent_case
    from services.agent.model import get_provider
    from services.agent.skills import SkillRegistry
    from services.ai import usage as usage_log
    from models.agent import Mode

    if dry_run:
        return CaseResult(case["id"], run_index, False,
                          ["dry run — no model was called"], {}, 0)

    started = time.monotonic()
    mark = len(usage_log.RECENT)
    registry = SkillRegistry.load([Path(__file__).parent.parent / "skills"])
    try:
        provider = get_provider(Mode.API, user_id="")
        if model:
            from dataclasses import replace
            provider = replace(provider, chat_model=model)
        with usage_log.annotate(surface="eval", job="agent", trigger="eval",
                                eval_case=case["id"], eval_config=config):
            outcome = asyncio.run(run_agent_case(case, provider, registry))
        failures = check_agent(case, outcome)
        text = outcome.text
    except Exception as e:                          # noqa: BLE001
        failures, text = [f"call failed: {type(e).__name__}: {e}"[:300]], ""

    rows = list(usage_log.RECENT)[mark:]
    spent = [r for r in rows if r.get("estimated_usd") is not None]
    return CaseResult(
        case["id"], run_index, not failures, failures,
        {"agent": True, "tools": getattr(locals().get("outcome"), "tools_called", []),
         # skill.load is answered by the engine, not the brain, so it never
         # shows in `tools`; the skill_active events are the only record of
         # which instructions the model actually worked under (E7).
         "skills": [e.get("name") for e in
                    getattr(locals().get("outcome"), "events", [])
                    if e.get("type") == "skill_active"]},
        int((time.monotonic() - started) * 1000),
        input_tokens=sum(r["input_tokens"] for r in rows),
        output_tokens=sum(r["output_tokens"] for r in rows),
        usd=sum(r["estimated_usd"] for r in spent) if spent else None,
        usage_reported=all(r.get("usage_reported") for r in rows) if rows else False,
        model=next((r["model"] for r in rows if r.get("model")), None),
        html_excerpt=text[:800],
        attempts=[{"model": r.get("model"), "status": r.get("status"),
                   "error": r.get("error")} for r in rows])


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
            "variant": runs[0].variant,
            "median_input_tokens": int(statistics.median(
                r.input_tokens for r in runs)),
            "truncated": sum(1 for r in runs if r.score.get("truncated")),
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
                r.score.get("heading_total", 0) for r in runs),
            "median_math": statistics.median(
                r.score.get("math_blocks", 0) for r in runs),
            "median_grounding": statistics.median(
                r.score.get("grounding", 1.0) for r in runs),
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
        if s.get("truncated"):
            print(f"  !! {case_id}: {s['truncated']}/{s['runs']} runs CUT OFF at "
                  f"the output cap — the note ends mid-way")
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
    ap.add_argument("--model",
                    help="run every case on this model id instead of the chain's "
                         "first choice — the honest way to compare two models, "
                         "since a report that mixes them measures neither")
    ap.add_argument("--retries", type=int, default=2,
                    help="retry a call that failed for a transient provider "
                         "reason (overloaded, rate limited, timeout) — a queue "
                         "is not a model behaviour; other failures stand")
    ap.add_argument("--variant", choices=("html", "md"), default="html",
                    help="which prompt to run: the shipped HTML dialect, or "
                         "E6's Markdown-with-fences variant (converted to the "
                         "same HTML before scoring, so the editor is not part "
                         "of the comparison)")
    ap.add_argument("--max-tokens", type=int, default=32000,
                    help="output cap for synthesis cases — matches the app's "
                         "OUTPUT_CAP (32000 since E13)")
    ap.add_argument("--keep-html", action="store_true",
                    help="keep every run's full note in the report (for reading)")
    ap.add_argument("--dry-run", action="store_true",
                    help="no model calls — checks the corpus, scorer and report path")
    ap.add_argument("--manifest", type=Path, default=None)
    args = ap.parse_args(argv)
    global KEEP_HTML
    KEEP_HTML = args.keep_html

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
            r = run_case(case, args.config, i, args.dry_run, model=args.model,
                         variant=args.variant, retries=args.retries,
                         max_tokens=args.max_tokens)
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
        "variant": args.variant,
        "model_override": args.model,
        "runs_per_case": args.runs,
        "dry_run": args.dry_run,
        "summary": summary,
        "results": [r.__dict__ for r in results],
    }, indent=2))
    print(f"\nreport: {report}")

    return 0 if all(s["passed"] == s["runs"] for s in summary.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
