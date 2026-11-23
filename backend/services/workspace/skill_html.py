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
_NUMBERS_ONLY = re.compile(r"^[\s\d.,%]+$")
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
    """A run of only digits and punctuation is a price, not a formula."""
    return not _NUMBERS_ONLY.match(latex) and bool(_MATHY.search(latex))


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


def _diagram_block(m: re.Match) -> str:
    source = html.unescape(m.group(1)).strip()
    kind = _MERMAID_START.match(source)
    if not kind:
        return m.group(0)          # not something the block can draw: stays a code block
    block = {"type": "interactive",
             "props": {"title": _DIAGRAM_TITLES.get(kind.group(1), "Diagram"),
                       "html": source}}
    return f'<div data-sb-blocks="{html.escape(json.dumps([block]), quote=True)}"></div>'


def diagrams(doc: str) -> str:
    """Mermaid code blocks → live diagram blocks."""
    return _MERMAID.sub(_diagram_block, doc)


def finish(answer: str) -> str:
    """The model's answer → the HTML the editor applies."""
    doc = _EMBED_ATTR.sub("", _strip_fences(answer))
    return inline_math(diagrams(doc))
