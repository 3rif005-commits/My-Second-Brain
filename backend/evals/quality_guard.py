"""Study-guide quality guard: is a new guide as good as the one the user approved?

    python -m evals.quality_guard --self-test          # free: the check checks itself
    python -m evals.quality_guard --html a.html b.html c.html   # free: saved guides
    python -m evals.quality_guard --generate           # PAID (~$0.16): write 3 now

Why this exists: an experiment once rewrote the study-guide instructions to
raise the eval scoreboard, and the notes got plainer. The scoreboard asked
"does it have a table, an anchor, a callout?" — a yes/no floor — so a guide
with half the boxes and half the depth still passed. The user saw it on real
slides before any number did.

This check asks a different question: compared with the guide the user
approved (ML Lecture 10, pre-harness instructions, saved 2026-09-24), how much
of each thing does the new guide keep? Every dimension is a ratio against that
reference, so "fewer callouts than you liked" is a failure even when there are
still some.

It never edits the study-guide instructions and never judges them — it only
reports. A prompt change the user makes can fail it; that is information for
the user, not a reason to change their text.

One guide is not a verdict. Three runs of the user's own unchanged
instructions (2026-09-25) gave 3 to 8 tables and 6 to 15 math blocks; one of
them fell under the floors by luck. So the verdict is on the MEDIAN of n runs
(3 by default), and a single run is reported as a hint only. The median of
those three passes every floor — that is the calibration.

The reference is the note's SAVED blocks (the editor drops `data-anchor` on
save), so anchors are checked on the new guide alone: they must exist and
resolve, not match a count.
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import re
import sys
import time
from dataclasses import dataclass
from html import escape
from pathlib import Path

from evals.score_note import NoteScore, score_note

HERE = Path(__file__).parent
REFERENCE = HERE / "reference" / "ml-lecture-10.approved.json"
SOURCE = HERE / "corpus" / "sources" / "iml-lecture-10.extracted.txt"
SOURCE_TITLE = "Machine Learning Lecture 10 - Reinforcement Learning"
REPORTS = HERE / "reports"

#: A new guide keeps at least this share of the reference on every counted
#: dimension. Set BEFORE the first measured run: the model is sampled, so
#: equal is not the bar, but losing a third of the boxes or the depth is what
#: "plainer" looked like.
KEEP = 0.7

#: Concepts the approved guide teaches (read off its section headings). A new
#: guide that drops one has dropped a part of the lecture, not a detail.
CONCEPTS = [
    "supervised", "unsupervised", "agent", "environment", "reward",
    "exploration", "exploitation", "value function", "Q-value", "Q-learning",
    "Bellman", "discount factor", "temporal difference", "learning rate",
    "episode", "converge", "policy",
]


# ── the reference: BlockNote blocks → the HTML the scorer reads ─────────────

def _inline(content) -> str:
    if isinstance(content, str):
        return escape(content)
    out = []
    for item in content or []:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "text":
            out.append(escape(item.get("text", "")))
        else:                                   # link and other wrappers
            out.append(_inline(item.get("content")))
    return "".join(out)


def _table(content: dict) -> str:
    rows = []
    for row in (content or {}).get("rows", []):
        cells = []
        for cell in row.get("cells", []):
            inner = cell.get("content") if isinstance(cell, dict) else cell
            cells.append(f"<td>{_inline(inner)}</td>")
        rows.append("<tr>" + "".join(cells) + "</tr>")
    return "<table>" + "".join(rows) + "</table>"


def blocks_to_html(blocks: list[dict]) -> str:
    """The shapes the synthesis prompt asks for and the scorer counts: a
    toggleable heading is <details><summary><hN>, a callout is a div with
    data-type="callout" wrapping its children, math is data-type="math"."""
    out = []
    for b in blocks:
        kind, props = b.get("type"), b.get("props") or {}
        text = _inline(b.get("content")) if kind != "table" else ""
        kids = blocks_to_html(b.get("children") or [])
        if kind == "heading":
            level = int(props.get("level", 2))
            tag = f"<h{level}>{text}</h{level}>"
            out.append(f"<details><summary>{tag}</summary>{kids}</details>"
                       if props.get("isToggleable") else tag + kids)
        elif kind == "toggleListItem":
            out.append(f"<details><summary>{text}</summary>{kids}</details>")
        elif kind == "callout":
            ctype = escape(str(props.get("calloutType", "")))
            out.append(f'<div data-type="callout" data-callout-type="{ctype}">'
                       f"<p>{text}</p>{kids}</div>")
        elif kind == "math":
            out.append(f'<div data-type="math">{escape(props.get("latex", ""))}</div>'
                       + kids)
        elif kind == "table":
            out.append(_table(b.get("content")) + kids)
        elif kind in ("bulletListItem", "numberedListItem"):
            out.append(f"<li>{text}{kids}</li>")
        elif kind == "quote":
            out.append(f"<blockquote>{text}</blockquote>{kids}")
        else:
            out.append(f"<p>{text}</p>{kids}")
    return "".join(out)


def reference_html() -> str:
    return blocks_to_html(json.loads(REFERENCE.read_text(encoding="utf-8"))["blocks"])


# ── the profile and the comparison ──────────────────────────────────────────

def _visible(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).lower()


def profile(html: str) -> dict:
    """What a reader gets, counted. Depth is total text, not text per
    section: the same prompt wrote 9 to 20 sections, and its longest guide
    (more text than the approved one) looked shallowest per section."""
    s: NoteScore = score_note(html, source_count=1)
    h = s.headings
    sections = h.get("h3", 0)
    text = _visible(html)
    return {
        "chapters": h.get("h2", 0),
        "sections": sections,
        "subsections": h.get("h4", 0) + h.get("h5", 0) + h.get("h6", 0),
        "toggles_with_body": s.toggles_with_body,
        "callouts": s.callout_total,
        "callout_kinds": len([k for k in s.callouts if k not in s.unknown_callouts]),
        "tables": s.tables,
        "table_rows": s.table_rows,
        "math": s.math_blocks,
        "text_chars": s.text_chars,
        "concepts": sum(1 for c in CONCEPTS if c.lower() in text),
        # absolute checks, on the new guide only
        "h1": h.get("h1", 0),
        "unknown_callouts": len(s.unknown_callouts),
        "anchors": len(s.anchors),
        "grounding": round(s.grounding, 3),
        "anchor_validity": round(s.anchor_validity, 3),
        "_missed_concepts": [c for c in CONCEPTS if c.lower() not in text],
    }


#: Compared as a share of the reference. Kinds of box are compared as a
#: difference instead: 8 kinds → 5 is a plainer note even at 70%.
RATIO_KEYS = ["chapters", "sections", "subsections", "toggles_with_body",
              "callouts", "tables", "table_rows", "math", "text_chars"]


@dataclass
class Verdict:
    ok: bool
    rows: list[tuple[str, object, object, object, bool]]   # name, ref, new, floor, ok
    problems: list[str]


def median_profile(profiles: list[dict]) -> dict:
    """The typical guide of n runs. A concept counts as missed only when most
    runs missed it."""
    out = {k: statistics.median_low(p[k] for p in profiles)
           for k in profiles[0] if not k.startswith("_")}
    out["_missed_concepts"] = [c for c in CONCEPTS
                               if sum(c in p["_missed_concepts"] for p in profiles)
                               > len(profiles) / 2]
    return out


def defects(profiles: list[dict], truncated: list[bool]) -> list[str]:
    """Faults on ANY run, not the median: one guide cut off or with an invented
    box type is a guide a user would have received."""
    out = []
    for i, (p, cut) in enumerate(zip(profiles, truncated), start=1):
        for name, bad in (
            ("not exactly one title (h1)", p["h1"] != 1),
            ("unknown callout types", p["unknown_callouts"] > 0),
            ("sections without page anchors (grounding < 0.8)", p["grounding"] < 0.8),
            ("an anchor that does not resolve", p["anchor_validity"] < 1.0),
            ("cut off at the output cap", cut),
        ):
            if bad:
                out.append(f"run {i}: {name}")
    return out


def compare(new: dict, ref: dict, *, keep: float = KEEP) -> Verdict:
    """`new` is one profile or a median_profile. Absolute defects of the
    runs themselves come from `defects`."""
    rows, problems = [], []
    for key in RATIO_KEYS:
        floor = math.ceil(ref[key] * keep) if ref[key] else 0
        good = new[key] >= floor
        rows.append((key, ref[key], new[key], floor, good))
        if not good:
            problems.append(f"{key}: {new[key]} < {floor} "
                            f"({new[key] / ref[key]:.0%} of the approved guide)")
    kinds_floor = max(1, ref["callout_kinds"] - 2)
    good = new["callout_kinds"] >= kinds_floor
    rows.append(("callout_kinds", ref["callout_kinds"], new["callout_kinds"],
                 kinds_floor, good))
    if not good:
        problems.append(f"callout_kinds: {new['callout_kinds']} < {kinds_floor}")
    good = new["concepts"] >= ref["concepts"]
    rows.append(("concepts", ref["concepts"], new["concepts"], ref["concepts"], good))
    if not good:
        problems.append("concepts missing: " + ", ".join(new["_missed_concepts"]))

    return Verdict(not problems, rows, problems)


def print_verdict(v: Verdict, profiles: list[dict]) -> None:
    runs = "".join(f"{'run' + str(i):>7}" for i in range(1, len(profiles) + 1))
    print(f"{'':<18}{'approved':>9}{runs}{'median':>8}{'floor':>7}")
    for (name, ref, got, floor, good) in v.rows:
        per = "".join(f"{p[name]:>7}" for p in profiles)
        print(f"{name:<18}{ref:>9}{per}{got:>8}{floor:>7}  {'ok' if good else 'LOWER'}")
    print(f"{'anchors':<18}{'—':>9}" + "".join(f"{p['anchors']:>7}" for p in profiles))
    print()
    if len(profiles) < 3:
        print(f"(n={len(profiles)}: a hint, not a verdict — the same prompt varies"
              " more than the floors between two runs)")
    if v.ok:
        print("PASS — the typical guide is at the approved level on every dimension.")
    else:
        print("FAIL — below the approved guide:")
        for p in v.problems:
            print(f"  - {p}")


# ── entry points ────────────────────────────────────────────────────────────

def _thinned(html: str) -> str:
    """The reference with every other callout and every table removed — what
    'plainer' looked like. The self-test must fail it."""
    callouts = iter(range(10_000))
    html = re.sub(r'<div data-type="callout".*?</div>',
                  lambda m: "" if next(callouts) % 2 == 0 else m.group(0),
                  html, flags=re.DOTALL)
    return re.sub(r"<table>.*?</table>", "", html, flags=re.DOTALL)


def self_test() -> int:
    """The approved guide must pass against itself, and a thinned copy of
    it must fail — otherwise the guard cannot see what it exists for."""
    html = reference_html()
    ref = profile(html)
    same = compare(ref, ref)
    thin = compare(profile(_thinned(html)), ref)
    print("approved vs itself:", "PASS" if same.ok else f"FAIL {same.problems}")
    print("approved, thinned: ", "FAIL, as it should" if not thin.ok
          else "PASS — the guard is blind")
    for p in thin.problems:
        print(f"  - {p}")
    return 0 if same.ok and not thin.ok else 1


def generate(model: str | None = None) -> tuple[str, bool, dict]:
    """One guide from the Lecture 10 slides through the app's own path: the
    study-guide prompt as it is on disk right now, the provider chain, the
    32K cap. Returns (html, truncated, cost row)."""
    from prompts.note_synthesis import build_note_synthesis_prompt
    from services.ai import usage as usage_log
    from services.ai.client import last_call_truncated
    from services.ai.router import complete_with_fallback
    from services.workspace.synthesis import OUTPUT_CAP, _strip_fences

    blocks = [{"title": SOURCE_TITLE, "kind": "pdf",
               "text": SOURCE.read_text(encoding="utf-8")}]
    prompt = build_note_synthesis_prompt(blocks, has_figures=False)
    mark = len(usage_log.RECENT)
    with usage_log.annotate(surface="eval", job="synthesis", trigger="eval",
                            user_id=None, eval_case="quality-guard",
                            eval_config="quality-guard"):
        html = _strip_fences(complete_with_fallback(
            "summarize_text", "", [{"role": "user", "content": prompt}],
            max_tokens=OUTPUT_CAP, model_override=model))
    truncated = last_call_truncated()
    rows = list(usage_log.RECENT)[mark:]
    return html, truncated, (rows[-1] if rows else {})


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--html", type=Path, nargs="+", help="score saved guides (free)")
    ap.add_argument("--generate", action="store_true",
                    help="write --runs guides now — PAID, about $0.055 each on Haiku 4.5")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--model", help="model id override for --generate")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()
    ref = profile(reference_html())
    htmls: list[str] = []
    truncated: list[bool] = []
    if args.html:
        from services.workspace.md_to_blocks import TRUNCATION_NOTICE_HTML
        for path in args.html:
            htmls.append(path.read_text(encoding="utf-8"))
            truncated.append(TRUNCATION_NOTICE_HTML in htmls[-1])
    elif args.generate:
        REPORTS.mkdir(exist_ok=True)
        spent = 0.0
        for i in range(args.runs):
            html, cut, row = generate(args.model)
            out = REPORTS / f"quality-guard-{time.strftime('%Y%m%d-%H%M%S')}.html"
            out.write_text(html, encoding="utf-8")
            usd = row.get("estimated_usd")
            spent += usd or 0.0
            print(f"run {i + 1}: {row.get('model')} · in {row.get('input_tokens')}"
                  f" · out {row.get('output_tokens')} · "
                  f"{'$' + format(usd, '.4f') if usd is not None else 'cost unknown'}"
                  f" · {out}")
            htmls.append(html)
            truncated.append(cut)
        print(f"spent ${spent:.4f}\n")
    else:
        ap.print_help()
        return 2
    profiles = [profile(h) for h in htmls]
    verdict = compare(median_profile(profiles), ref)
    faults = defects(profiles, truncated)
    verdict.problems += faults
    verdict.ok = verdict.ok and not faults
    print_verdict(verdict, profiles)
    return 0 if verdict.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
