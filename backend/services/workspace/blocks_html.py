"""A note's saved BlockNote blocks as the HTML dialect the study guide writes.

The shapes the synthesis prompt asks for and the scorer counts: a toggleable
heading is <details><summary><hN>, a callout is a div with data-type="callout"
wrapping its children, math is data-type="math". Used to compare a note as the
user left it with what the AI wrote (E12), and by the quality guard.
"""
from __future__ import annotations

from html import escape

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
