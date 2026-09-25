"""After every study guide: did each source get its share, is the form right?

No model, no cost — counts over the guide the model wrote. The result rides
on the job's result card; nothing is blocked or rewritten. When a source came
out thin the card offers to write the guide again chapter by chapter (E9), and
the user decides.

"Thin" is calibrated on real slides (IML 08/09/10, E9): guide text per source
character was 1.19-1.96 for a lecture written alone, 1.69-2.72 chapter by
chapter, and 0.89-1.37 for three lectures in one call. Below 1.0 is flagged.
A dense source (a book chapter) is legitimately shorter per character, so the
rule is applied only to slide-like sources — under 1,500 characters per page.
"""
from __future__ import annotations

import re

from services.workspace.note_score import CALLOUT_TYPES, score_note

#: guide text per source character under which a slide-like source is "thin"
THIN_BELOW = 1.0
#: characters per page under which a source reads as slides
SLIDE_LIKE_BELOW = 1500

_H = re.compile(r"<(h[23])\b([^>]*)>", re.I)
_ANCHOR = re.compile(r'data-anchor="(\d+):[pts]:[\d.]+"')
_PAGE = re.compile(r"^\[page \d+\]$", re.M)


def per_source(html: str, n_sources: int) -> dict[int, dict]:
    """Depth of the sections anchored to each source (1-based): a section is
    an <h3> with a source anchor, running to the next <h3>/<h2>."""
    cuts = [(m.start(), m.group(1).lower(), m.group(2)) for m in _H.finditer(html or "")]
    parts: dict[int, list[str]] = {i: [] for i in range(1, n_sources + 1)}
    for k, (start, tag, attrs) in enumerate(cuts):
        if tag != "h3":
            continue
        a = _ANCHOR.search(attrs)
        if not a or int(a.group(1)) not in parts:
            continue
        end = cuts[k + 1][0] if k + 1 < len(cuts) else len(html)
        parts[int(a.group(1))].append(html[start:end])
    out = {}
    for i, sections in parts.items():
        joined = "".join(sections)
        s = score_note(joined)
        out[i] = {"sections": len(sections), "text_chars": s.text_chars,
                  "concepts": len(re.findall(r"<h5\b", joined, re.I)),
                  "tables": s.tables, "math": s.math_blocks, "callouts": s.callout_total}
    return out


def _chapters_without_overview(html: str) -> int:
    chapters = re.split(r"<h2\b", html or "", flags=re.I)[1:]
    return sum(1 for c in chapters if 'data-callout-type="OVERVIEW"' not in c)


def check_guide(html: str, sources: list[dict], truncated: bool = False) -> dict:
    """{sources: [...], thin: [titles], problems: [...]} for the result card."""
    n = len(sources)
    depth = per_source(html, n)
    rows, thin = [], []
    for i, src in enumerate(sources, start=1):
        text = src.get("text") or ""
        pages = max(1, len(_PAGE.findall(text)))
        chars = len(text)
        d = depth[i]
        ratio = d["text_chars"] / chars if chars else None
        slide_like = chars / pages < SLIDE_LIKE_BELOW
        is_thin = bool(slide_like and ratio is not None and ratio < THIN_BELOW)
        rows.append({"title": src.get("title") or f"Source {i}", "pages": pages,
                     "sections": d["sections"], "concepts": d["concepts"],
                     "depth": round(ratio, 2) if ratio is not None else None,
                     "thin": is_thin})
        if is_thin:
            thin.append(rows[-1]["title"])

    s = score_note(html or "", source_count=n)
    problems = []
    if s.headings.get("h1", 0) != 1:
        problems.append("the guide should have exactly one title")
    missing = _chapters_without_overview(html)
    if missing:
        problems.append(f"{missing} chapter(s) without an Overview box")
    if s.unknown_callouts:
        problems.append(f"box types the editor does not know: {sorted(set(s.unknown_callouts))}")
    if s.grounding < 0.8:
        problems.append("some sections have no page link to their source")
    if s.anchor_validity < 1.0:
        problems.append("some page links point nowhere ("
                        + "; ".join(s.anchor_problems[:3]) + ")")
    if truncated:
        problems.append("cut off at the length limit")
    return {"sources": rows, "thin": thin, "problems": problems,
            "known_boxes": sorted(CALLOUT_TYPES)}
