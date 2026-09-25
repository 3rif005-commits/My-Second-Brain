"""Study-guide quality guard: is a new guide as good as the one the user approved?

    python -m evals.quality_guard --self-test          # free: the check checks itself
    python -m evals.quality_guard --html note.html     # free: score a saved guide
    python -m evals.quality_guard --generate           # PAID (~$0.06): write one now

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

The reference is the note's SAVED blocks (the editor drops `data-anchor` on
save), so anchors are checked on the new guide alone: they must exist and
resolve, not match a count.
"""
from __future__ import annotations

import argparse
import json
import math
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
    """What a reader gets, counted. `depth` is text per section: a guide can
    keep every heading and still say half as much under each."""
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
        "depth": round(s.text_chars / sections) if sections else 0,
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
              "callouts", "tables", "table_rows", "math", "text_chars", "depth"]


@dataclass
class Verdict:
    ok: bool
    rows: list[tuple[str, object, object, object, bool]]   # name, ref, new, floor, ok
    problems: list[str]


def compare(new: dict, ref: dict, *, truncated: bool = False,
            keep: float = KEEP, check_anchors: bool = True) -> Verdict:
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

    for name, bad in (
        ("exactly one title (h1)", new["h1"] != 1),
        ("unknown callout types", new["unknown_callouts"] > 0),
        ("page anchors on sections (grounding ≥ 0.8)",
         check_anchors and new["grounding"] < 0.8),
        ("every anchor resolves", check_anchors and new["anchor_validity"] < 1.0),
        ("cut off at the output cap", truncated),
    ):
        if bad:
            problems.append(name)
    return Verdict(not problems, rows, problems)


def print_verdict(v: Verdict, new: dict) -> None:
    print(f"{'':<18}{'approved':>9}{'new':>8}{'floor':>8}")
    for name, ref, got, floor, good in v.rows:
        print(f"{name:<18}{ref:>9}{got:>8}{floor:>8}  {'ok' if good else 'LOWER'}")
    print(f"{'anchors':<18}{'—':>9}{new['anchors']:>8}   grounding {new['grounding']},"
          f" valid {new['anchor_validity']}")
    print()
    if v.ok:
        print("PASS — at the approved level on every dimension.")
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
    """The saved reference carries no anchors (the editor drops them), so
    anchors are not checked here — only the dimensions it is compared on."""
    html = reference_html()
    ref = profile(html)
    same = compare(ref, ref, check_anchors=False)
    thin = compare(profile(_thinned(html)), ref, check_anchors=False)
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
    ap.add_argument("--html", type=Path, help="score a saved guide (free)")
    ap.add_argument("--generate", action="store_true",
                    help="write one guide now — PAID, about $0.06 on Haiku 4.5")
    ap.add_argument("--model", help="model id override for --generate")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()
    ref = profile(reference_html())
    if args.html:
        from services.workspace.md_to_blocks import TRUNCATION_NOTICE_HTML
        html = args.html.read_text(encoding="utf-8")
        truncated = TRUNCATION_NOTICE_HTML in html
    elif args.generate:
        html, truncated, row = generate(args.model)
        REPORTS.mkdir(exist_ok=True)
        out = REPORTS / f"quality-guard-{time.strftime('%Y%m%d-%H%M%S')}.html"
        out.write_text(html, encoding="utf-8")
        usd = row.get("estimated_usd")
        print(f"model {row.get('model')} · in {row.get('input_tokens')} · out "
              f"{row.get('output_tokens')} · "
              f"{'$' + format(usd, '.4f') if usd is not None else 'cost unknown'}"
              f"\nguide: {out}\n")
    else:
        ap.print_help()
        return 2
    new = profile(html)
    verdict = compare(new, ref, truncated=truncated)
    print_verdict(verdict, new)
    return 0 if verdict.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
