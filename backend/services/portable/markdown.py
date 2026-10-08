"""IR -> markdown, for humans: the "what we would send" side of the changed-in-the-destination
diff, and (later) the readable copy in the backup archive. Not a round-trip format."""
from __future__ import annotations

import re

from . import ir

_ESC = re.compile(r"([\\*_`~\[\]])")


def _inline(items) -> str:
    out = []
    for i in items:
        if isinstance(i, ir.Text):
            t = _ESC.sub(r"\\\1", i.text)
            m = i.marks
            if m.get("code"):
                t = f"`{i.text}`"
            if m.get("bold"):
                t = f"**{t}**"
            if m.get("italic"):
                t = f"*{t}*"
            if m.get("strike"):
                t = f"~~{t}~~"
            if i.link:
                t = f"[{t}]({i.link})"
            out.append(t)
        elif isinstance(i, ir.Mention):
            out.append(f"@{i.label}")
        elif isinstance(i, ir.Equation):
            out.append(f"${i.latex}$")
    return "".join(out)


def _block(b: ir.Block, depth: int, n: int) -> list[str]:
    pad = "  " * depth
    t = b.type
    text = _inline(b.inline)
    lines: list[str]
    if t == "heading":
        lines = [f"{'#' * min(b.attrs.get('level', 1), 6)} {text}"]
    elif t == "list_item":
        mark = f"{b.attrs.get('start', n)}." if b.attrs.get("style") == "numbered" else "-"
        lines = [f"{pad}{mark} {text}"]
    elif t == "todo":
        lines = [f"{pad}- [{'x' if b.attrs.get('checked') else ' '}] {text}"]
    elif t == "toggle":
        lines = [f"{pad}<details><summary>{text}</summary>"]
    elif t == "quote":
        lines = [f"> {text}"]
    elif t == "code":
        lines = [f"```{b.attrs.get('language', '')}", text, "```"]
    elif t == "divider":
        lines = ["---"]
    elif t == "equation":
        lines = [f"$${b.attrs.get('latex', '')}$$"]
    elif t == "callout":
        lines = [f"> {b.attrs.get('icon', '')} callout"]
    elif t == "table":
        lines = []
        for r in b.children:
            lines.append("| " + " | ".join(_inline(c.inline) for c in r.children) + " |")
    elif t == "media":
        lines = [f"![{text}]({b.attrs.get('url', '')})"]
    elif t == "opaque":
        lines = [f"[{b.attrs.get('source_type', 'block')}] {text}".strip()]
    else:
        lines = [f"{pad}{text}"]
    if t != "table":
        for k, c in enumerate(b.children, 1):
            lines += _block(c, depth + 1, k)
    if t == "toggle":
        lines.append(f"{pad}</details>")
    return lines


def to_markdown(blocks: list[ir.Block]) -> str:
    out: list[str] = []
    n = 0
    for b in blocks:
        n = n + 1 if b.type == "list_item" and b.attrs.get("style") == "numbered" else 1
        out += _block(b, 0, n)
    return "\n".join(out)
