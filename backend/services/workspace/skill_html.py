"""The answer of a skill that writes the editor's HTML dialect → what the editor applies.

A Markdown skill goes through md_to_blocks.py, which escapes everything it does
not recognise. A skill with `format: html` (the worksheet solver) writes the
study guide's dialect directly, so it can use what Markdown cannot say here: a
green answer band (`<p data-background-color="green">`), highlighted headings,
toggles holding numbered steps with equations inside them, code blocks.

Two things are still easier for a model to write one way and for the editor to
read another, and this module bridges them:

- Mid-sentence maths. Models write `$v = d/t$` without being asked; the editor's
  inline formula is `<span data-inline-content-type="inlineMath" data-latex=…>`
  (customBlocks.tsx InlineMathSpec, parsed by BlockNote). The LaTeX is also left
  as the span's text, so the sandboxed preview card shows it rather than a gap.
- Diagrams. `<pre><code class="language-mermaid">` becomes a live diagram
  block (an `interactive` block holding the Mermaid source), carried in the
  `data-sb-blocks` envelope the editor already restores (lib/embeddedBlocks.ts).

The model never writes that envelope itself: any it wrote is removed first, so
text in a source cannot smuggle a ready-made block into the note.
"""
from __future__ import annotations

import html
import json
import re

from services.workspace.synthesis import _strip_fences

# The same delimiter rules as the editor's paste path (notionPaste.ts
# INLINE_MATH): no space just inside either `$`, no `$` or newline within, and
# a `\$` is a literal dollar sign, never an opener.
_INLINE_MATH = re.compile(r"(?<![$\\])\$(?!\s)((?:[^$\n\\]|\\.)+?)(?<!\s)\$(?!\$)")
_DISPLAY_IN_TEXT = re.compile(r"(?<![$\\])\$\$(.+?)\$\$")
_LONE_DISPLAY = re.compile(r"<p>\s*\$\$([^<]+?)\$\$\s*</p>")
_NUMBER = re.compile(r"^-?\d+(?:[.,]\d+)*$")
_MATHY = re.compile(r"[A-Za-z\\^_{}=+\-*/()\[\]|<>]")

_TAG = re.compile(r"(<[^>]*>)")
_EMBED_ATTR = re.compile(r"""\sdata-sb-blocks\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)""", re.IGNORECASE)
_MERMAID = re.compile(
    r"<pre[^>]*>\s*<code[^>]*class=\"[^\"]*language-mermaid[^\"]*\"[^>]*>(.*?)</code>\s*</pre>",
    re.DOTALL | re.IGNORECASE)
# lib/liveRuntime.ts MERMAID_START: what the interactive block will draw.
_MERMAID_START = re.compile(
    r"^(?:%%.*\n\s*)*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|"
    r"erDiagram|gantt|pie|mindmap|timeline|journey|quadrantChart|gitGraph|xychart-beta|"
    r"sankey-beta|block-beta)\b")
_DIAGRAM_TITLES = {
    "flowchart": "Flowchart", "graph": "Graph", "sequenceDiagram": "Sequence diagram",
    "classDiagram": "Class diagram", "stateDiagram": "State diagram",
    "stateDiagram-v2": "State diagram", "erDiagram": "ER diagram", "mindmap": "Mind map",
    "timeline": "Timeline", "gantt": "Gantt chart", "pie": "Pie chart",
}


def _looks_like_math(latex: str) -> bool:
    """Letters or operators make a formula. A bare number counts too ("roots
    are $2$ and $3$"): a price cannot be one, because the delimiter rules
    already refuse "$5 and $10" (a space before the closing $)."""
    return bool(_MATHY.search(latex)) or bool(_NUMBER.match(latex))


def _math_span(latex: str) -> str:
    latex = html.unescape(latex).strip()
    return (f'<span data-inline-content-type="inlineMath" '
            f'data-latex="{html.escape(latex, quote=True)}">'
            f"{html.escape(latex, quote=False)}</span>")


def _inline_math_in_text(text: str) -> str:
    """One text node: every formula becomes a span, and what is left between
    them is prose, where a `\\$` is the writer's literal dollar sign."""
    found: list[tuple[int, int, str]] = [
        (m.start(), m.end(), m.group(1)) for m in _DISPLAY_IN_TEXT.finditer(text)]
    for m in _INLINE_MATH.finditer(text):
        if any(a <= m.start() < b for a, b, _ in found):
            continue
        # "$5-$10": a digit right after the closing `$` means it opened the next amount.
        if not _looks_like_math(m.group(1)) or text[m.end():m.end() + 1].isdigit():
            continue
        found.append((m.start(), m.end(), m.group(1)))
    out, cursor = [], 0
    for start, end, latex in sorted(found):
        out.append(text[cursor:start].replace("\\$", "$"))
        out.append(_math_span(latex))
        cursor = end
    out.append(text[cursor:].replace("\\$", "$"))
    return "".join(out)


def inline_math(doc: str) -> str:
    """`$…$` in the text of `doc` → inline formula spans.

    Text inside code, a display-maths block or an existing formula span is left
    alone: there a dollar sign is a shell prompt, a variable, or already maths.
    """
    doc = _LONE_DISPLAY.sub(
        lambda m: f'<div data-type="math">{html.escape(html.unescape(m.group(1)).strip(), quote=False)}</div>',
        doc)
    out: list[str] = []
    code_depth = 0
    skip_until: str | None = None      # the closing tag of a math div / formula span
    for part in _TAG.split(doc):
        if not part:
            continue
        if part.startswith("<"):
            low = part.lower()
            if re.match(r"<(pre|code)\b", low):
                code_depth += 1
            elif re.match(r"</(pre|code)\s*>", low):
                code_depth = max(0, code_depth - 1)
            elif skip_until is None and re.match(r"<div\b", low) and 'data-type="math"' in low:
                skip_until = "</div"
            elif skip_until is None and re.match(r"<span\b", low) and "data-inline-content-type" in low:
                skip_until = "</span"
            elif skip_until and low.startswith(skip_until):
                skip_until = None
            out.append(part)
        elif code_depth or skip_until or "$" not in part:
            out.append(part)
        else:
            out.append(_inline_math_in_text(part))
    return "".join(out)


_QUESTION = re.compile(r"(?=<h[34][\s>])", re.IGNORECASE)
_MERMAID_COMMENT = re.compile(r"^\s*%%.*$\n?", re.MULTILINE)


def _diagram_block(m: re.Match) -> str:
    source = _MERMAID_COMMENT.sub("", html.unescape(m.group(1))).strip()
    kind = _MERMAID_START.match(source)
    if not kind:
        return m.group(0)          # not something the block can draw: stays a code block
    block = {"type": "interactive",
             "props": {"title": _DIAGRAM_TITLES.get(kind.group(1), "Diagram"),
                       "html": source}}
    return f'<div data-sb-blocks="{html.escape(json.dumps([block]), quote=True)}"></div>'


def _last_diagram_only(part: str) -> str:
    """Some models (Nemotron, seen twice) draft a diagram, then write
    "%% Let me rebuild correctly" and draw it again, two or three times under
    one question. The last one is their corrected answer; the earlier drafts
    were wrong both times, and a wrong automaton in revision notes is worse
    than none."""
    found = list(_MERMAID.finditer(part))
    for m in reversed(found[:-1]):
        part = part[:m.start()] + part[m.end():]
    return part


def diagrams(doc: str) -> str:
    """Mermaid code blocks → live diagram blocks: one per question or part,
    without the model's %% notes."""
    doc = "".join(_last_diagram_only(p) for p in _QUESTION.split(doc))
    return _MERMAID.sub(_diagram_block, doc)


# The worksheet's rule boxes: the callout type is only a colour there, ranked
# by importance, and each level has a cap (SKILL.md, RULES & FORMULAS).
_RULE_BOX = re.compile(r'(<div data-type="callout" data-callout-type=")([A-Z]+)("\s+data-callout-icon="📐")')
_RULE_LEVELS = ["CAUTION", "WARNING", "IMPORTANT", "OVERVIEW", "NOTE"]
_RULE_CAPS = {"CAUTION": 2, "WARNING": 3}


def rule_caps(doc: str) -> str:
    """At most 2 red and 3 orange rule boxes. A box over its level's cap moves
    down one level (and on, if that one is full too). Models read the caps
    and still exceed them: Nemotron wrote 4 orange in one run."""
    used: dict[str, int] = {}

    def demote(m: re.Match) -> str:
        level = m.group(2)
        if level in _RULE_LEVELS:
            i = _RULE_LEVELS.index(level)
            while _RULE_LEVELS[i] in _RULE_CAPS and used.get(_RULE_LEVELS[i], 0) >= _RULE_CAPS[_RULE_LEVELS[i]]:
                i += 1
            level = _RULE_LEVELS[i]
        used[level] = used.get(level, 0) + 1
        return m.group(1) + level + m.group(3)

    return _RULE_BOX.sub(demote, doc)


def finish(answer: str) -> str:
    """The model's answer → the HTML the editor applies."""
    doc = _EMBED_ATTR.sub("", _strip_fences(answer))
    return inline_math(diagrams(rule_caps(doc)))
