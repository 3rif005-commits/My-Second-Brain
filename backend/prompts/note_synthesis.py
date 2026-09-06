"""Multi-source note synthesis prompt.

One note per session: every source attached to the note is fed in as its own
`=== SOURCE n ===` block and the model is asked to synthesize ACROSS them
(organize by concept, not by source). Anchors are source-indexed
(`data-anchor="2:p:14"`) so the client can map each section back to the right
source.

Replaces prompts/workspace_summary.py, which summarized exactly one resource.
Still built on the app's canonical note style (prompts/mastery_guide).
"""
from __future__ import annotations

from prompts.mastery_guide import SYSTEM_PROMPT as MASTERY_SYSTEM_PROMPT

# Characters of source text sent per synthesis, split across all sources.
#
# Was 24,000 — set when this ran on a free reasoning model that fell over on long
# input. Claude Haiku 4.5 holds a 200K-token context (~800K characters), so that
# cap was feeding it roughly 3% of what it can read and silently truncating a
# 40-page PDF around page 10. 180K characters is ~45K tokens: the whole of almost
# any lecture, still a fifth of the window, and about $0.05 of input per run.
# This is the first number to turn down if cost matters more than completeness.
TOTAL_SOURCE_BUDGET = 180_000

SYNTHESIS_EXTENSION = """
SYNTHESIZE ACROSS THE SOURCES — do not concatenate them:
- Organize the note by CONCEPT, in the order that teaches the topic best. The
  order of the source blocks below is an input order, not an outline.
- State shared material ONCE, anchored to the source that explains it best.
- Where sources genuinely disagree, say so explicitly and anchor both sides.
- Where one source completes another (a proof, a worked example, a diagram),
  bring them together in the same section.
- Open with a single <h1> naming the TOPIC the sources share — not the filename
  or channel name of any one source.
- WRONG OUTPUT: one <h2> per source, each summarizing that source in isolation.
  That is a concatenation, not a synthesis, and it is the failure mode to avoid.
"""

ANCHOR_EXTENSION = """
SOURCE-INDEXED SYNC ANCHORS (mandatory for this note):
This note is displayed beside its sources and kept in sync with them. Every
<h3> Section header MUST carry a data-anchor attribute of the form:

    <h3 data-anchor="SOURCE:TYPE:VALUE">...</h3>

- SOURCE is the 1-based index of the source the section is anchored to — the n
  from the "=== SOURCE n ===" block the material came from.
- TYPE and VALUE follow the TAG that source's own text actually carries — read
  it off the text, do not infer it from the kind of source:
    lines prefixed [mm:ss] or [h:mm:ss]  → t:SECONDS
      SECONDS is where the section's material begins, in seconds.
    text tagged [page N]                 → p:PAGE
      PAGE is the 1-based page where the material begins.
    text tagged [section N]              → s:INDEX
      INDEX is the section number where the material begins.

Worked examples: data-anchor="1:p:14"   data-anchor="2:t:754"   data-anchor="3:s:6"

Anchors must be monotonically non-decreasing WITHIN one source; across sources
they may jump freely (you are organizing by concept, not by source). Before you
finish, read your <h3> anchors back in order and check that per source: if one
goes backwards, the section is anchored to the wrong place — correct it to
where that section's material actually begins.
Do not put data-anchor on any element other than <h3>.
"""

FIGURE_EXTENSION = """
THE SOURCE'S FIGURES ARE ATTACHED TO THIS REQUEST:
Every diagram, chart and screenshot cropped out of the sources is included as an
image, each preceded by a line naming its source and page:
`[FIGURE — SOURCE 1, page 7]`. Look at them. They are not decoration — a slide
deck routinely puts its whole mechanism in a picture (a grid world, a block
diagram, a state machine, a labelled table) and says nothing about it in the
text you were given, so anything you can read only from the figure is content
that would otherwise be lost.

- Write what the figure SHOWS, in the section covering that page: the states in
  the grid and their rewards, the boxes in the diagram and the arrows between
  them, the axes of the plot and what it demonstrates. A figure that encodes a
  two-axis comparison is a <table> under SOURCE COVERAGE like any other.
- Anchor the section that uses a figure to the page the figure came from.
- Do not announce the figure ("as shown in the diagram on page 7", "the image
  depicts"). The reader has your notes, not the slides. State what it shows as
  fact.
- Skip a figure that carries no teaching content — a logo, a decorative photo,
  a portrait of the author. Not every crop is a figure.
"""

_NO_TEXT_BODY = ("(No transcript could be extracted for this source. The video "
                 "itself is attached to this request — watch it, derive your own "
                 "section timestamps, and use them as t: anchors for this source.)")


def _kind_framing(kind: str) -> str:
    if kind in ("youtube", "video"):
        return ("SOURCE TYPE: video transcript. Lines are prefixed with [mm:ss] "
                "timestamps.")
    if kind == "pdf":
        return "SOURCE TYPE: PDF document. Text is tagged with [page N] markers."
    if kind == "document":
        # Not page-tagged: a .md/.txt file has no pages, so it is split into
        # sections like a web article (services/workspace/sections.py). Saying
        # "[page N]" here would make the model emit p: anchors pointing at
        # nothing.
        return ("SOURCE TYPE: text/markdown document. Text is tagged with "
                "[section N] markers.")
    return "SOURCE TYPE: web article. Text is tagged with [section N] markers."


def _fmt_duration(seconds: float | None) -> str | None:
    if not seconds:
        return None
    total = int(seconds)
    if total >= 3600:
        return f"{total // 3600}:{(total % 3600) // 60:02d}:{total % 60:02d}"
    return f"{total // 60}:{total % 60:02d}"


def split_budget(lengths: list[int], total: int = TOTAL_SOURCE_BUDGET) -> list[int]:
    """Split `total` characters across sources: an even share each, with any
    unused share redistributed to the sources that can still use it (so one
    short website doesn't waste a slot)."""
    allots = [0] * len(lengths)
    hungry = [i for i, n in enumerate(lengths) if n > 0]
    pool = total
    while hungry:
        share = pool // len(hungry)
        satisfied = [i for i in hungry if lengths[i] <= share]
        if not satisfied:                      # everyone is capped at `share`
            for i in hungry:
                allots[i] = share
            break
        for i in satisfied:
            allots[i] = lengths[i]
            pool -= lengths[i]
        hungry = [i for i in hungry if i not in satisfied]
    return allots


def _source_block(index: int, source: dict, budget: int) -> str:
    kind = source["kind"]
    duration = _fmt_duration(source.get("duration"))
    label = f"{kind}, {duration}" if duration else kind
    text = (source.get("text") or "").strip()
    body = text[:budget] if text else _NO_TEXT_BODY
    return (f'=== SOURCE {index}: "{source["title"]}" ({label}) ===\n'
            f"{_kind_framing(kind)}\n{body}")


def build_note_synthesis_prompt(sources: list[dict],
                                total_budget: int = TOTAL_SOURCE_BUDGET,
                                has_figures: bool = False) -> str:
    budgets = split_budget([len((s.get("text") or "").strip()) for s in sources],
                           total_budget)
    blocks = [_source_block(i, s, b)
              for i, (s, b) in enumerate(zip(sources, budgets), start=1)]
    figures = FIGURE_EXTENSION if has_figures else ""
    return f"""{MASTERY_SYSTEM_PROMPT}

{SYNTHESIS_EXTENSION}

{ANCHOR_EXTENSION}
{figures}
---
SOURCE MATERIAL — {len(sources)} source(s) attached to this note:

{chr(10).join(blocks)}
---

Generate the synthesized mastery guide HTML, with one <h1> topic title and
source-indexed data-anchor attributes on every <h3>, now:"""
