"""Markdown-with-fences → the BlockNote HTML dialect.

Experiment E6 asks whether the model writes better notes in a format it knows
than in this app's own HTML. The editor is not part of the question: whatever
the model produces has to arrive as the same HTML the note pane already parses,
so the apply path, the anchors and the scorer all stay exactly as they are.

The dialect the model is asked for is deliberately small:

    # Title                        → <h1>
    ## Chapter                     → <h2>
    ### Section {1:p:4}            → <h3 data-anchor="1:p:4">
    :::overview                    → <div data-type="callout"
    ...                                 data-callout-type="OVERVIEW">
    :::                                 <details><summary>Overview</summary>…
    :::tip / :::exam / …           → the other eight callout types
    $$ E = mc^2 $$                 → <div data-type="math">
    ?? Concept                     → <details><summary><h5>…</h5></summary>
    ...                                 …
    ??                                </details>
    | a | b |                      → <table>

Anything it does not recognise is passed through as a paragraph rather than
dropped: a note with an odd line in it beats a note with a hole in it.
"""
from __future__ import annotations

import html
import re

CALLOUT_TYPES = {
    "overview": "OVERVIEW", "note": "NOTE", "tip": "TIP",
    "important": "IMPORTANT", "warning": "WARNING", "caution": "CAUTION",
    "formula": "FORMULA", "analogy": "ANALOGY", "exam": "EXAM",
}

_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*(?:\{([^}]+)\})?\s*$")
_FENCE = re.compile(r"^:::\s*([a-zA-Z]*)\s*$")
_TOGGLE = re.compile(r"^\?\?\s*(.*)$")
_MATH = re.compile(r"^\$\$\s*(.*?)\s*\$\$$")
_TABLE_ROW = re.compile(r"^\|(.+)\|\s*$")
_TABLE_SEP = re.compile(r"^\|[\s:|-]+\|\s*$")
_BULLET = re.compile(r"^[-*]\s+(.*)$")
_INLINE = [
    (re.compile(r"\*\*(.+?)\*\*"), r"<strong>\1</strong>"),
    (re.compile(r"(?<!\*)\*([^*]+)\*(?!\*)"), r"<em>\1</em>"),
    (re.compile(r"`([^`]+)`"), r"<code>\1</code>"),
]


def _inline(text: str) -> str:
    out = html.escape(text, quote=False)
    for pattern, repl in _INLINE:
        out = pattern.sub(repl, out)
    return out


def _anchor_attr(anchor: str | None) -> str:
    """Only well-formed anchors become attributes. A malformed one is dropped
    rather than written out, because the scorer counts a broken anchor as a
    defect and an invented one would hide the model's mistake."""
    if anchor and re.fullmatch(r"\d+:[pts]:\d+(?:\.\d+)?", anchor.strip()):
        return f' data-anchor="{anchor.strip()}"'
    return ""


def markdown_to_html(md: str) -> str:
    lines = (md or "").replace("\r\n", "\n").split("\n")
    out: list[str] = []
    open_callout: str | None = None
    open_toggles = 0
    bullets_open = False
    table: list[list[str]] = []
    # A note has one title. A second `#` is a chapter written a level too
    # high (E6b: 2 of 9 Markdown runs), so it becomes an <h2> instead of a
    # second <h1> the editor would render as another document title.
    seen_title = False

    def close_bullets() -> None:
        nonlocal bullets_open
        if bullets_open:
            out.append("</ul>")
            bullets_open = False

    def flush_table() -> None:
        nonlocal table
        if not table:
            return
        header, *body = table
        out.append("<table><thead><tr>"
                   + "".join(f"<th>{_inline(c)}</th>" for c in header)
                   + "</tr></thead><tbody>")
        for row in body:
            out.append("<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in row)
                       + "</tr>")
        out.append("</tbody></table>")
        table = []

    for raw in lines:
        line = raw.rstrip()

        if _TABLE_ROW.match(line) and not _TABLE_SEP.match(line):
            close_bullets()
            table.append([c.strip() for c in line.strip().strip("|").split("|")])
            continue
        if _TABLE_SEP.match(line):
            continue            # the |---|---| separator carries no content
        flush_table()

        if not line.strip():
            close_bullets()
            continue

        fence = _FENCE.match(line)
        if fence:
            close_bullets()
            kind = fence.group(1).lower()
            if kind and open_callout is None:
                open_callout = CALLOUT_TYPES.get(kind, "NOTE")
                out.append(f'<div data-type="callout" data-callout-type="{open_callout}">')
                if open_callout == "OVERVIEW":
                    # The user's own reference style: a collapsible toggle
                    # inside the Overview box, never a wall of open text.
                    out.append("<details><summary>Overview</summary>")
            elif open_callout is not None:
                if open_callout == "OVERVIEW":
                    out.append("</details>")
                out.append("</div>")
                open_callout = None
            continue

        toggle = _TOGGLE.match(line)
        if toggle:
            close_bullets()
            title = toggle.group(1).strip()
            if title:
                level = "h6" if open_toggles else "h5"
                out.append(f"<details><summary><{level}>{_inline(title)}</{level}></summary>")
                open_toggles += 1
            elif open_toggles:
                out.append("</details>")
                open_toggles -= 1
            continue

        math = _MATH.match(line)
        if math:
            close_bullets()
            out.append(f'<div data-type="math">{html.escape(math.group(1), quote=False)}</div>')
            continue

        heading = _HEADING.match(line)
        if heading:
            close_bullets()
            level = len(heading.group(1))
            if level == 1:
                level = 2 if seen_title else 1
                seen_title = True
            out.append(f"<h{level}{_anchor_attr(heading.group(3))}>"
                       f"{_inline(heading.group(2))}</h{level}>")
            continue

        bullet = _BULLET.match(line)
        if bullet:
            if not bullets_open:
                out.append("<ul>")
                bullets_open = True
            out.append(f"<li>{_inline(bullet.group(1))}</li>")
            continue

        close_bullets()
        out.append(f"<p>{_inline(line.strip())}</p>")

    flush_table()
    close_bullets()
    # Close anything the model left open: an unbalanced document should still
    # render, and the scorer will show the structure it actually produced.
    while open_toggles:
        out.append("</details>")
        open_toggles -= 1
    if open_callout is not None:
        if open_callout == "OVERVIEW":
            out.append("</details>")
        out.append("</div>")

    return "\n".join(out)


#: Appended to a note whose model ran out of output tokens. Rendered by the
#: same converter as every note, so the editor shows a normal WARNING callout.
TRUNCATION_NOTICE_MD = """:::warning
This note was cut off: the model reached its length limit before finishing,
so the last section may end mid-way and later material is missing. Regenerate
with fewer sources, or split the sources across notes.
:::
"""
TRUNCATION_NOTICE_HTML = markdown_to_html(TRUNCATION_NOTICE_MD)
