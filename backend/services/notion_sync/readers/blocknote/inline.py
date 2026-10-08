"""BlockNote inline content -> IR inline."""
from __future__ import annotations

from services.portable import ir
from services.portable.losses import Loss

_MARKS = {"bold": "bold", "italic": "italic", "underline": "underline",
          "strike": "strike", "code": "code"}


def plain_of(content) -> str:
    """Plain text of any inline content (used for opaque fallbacks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, dict):                 # table content etc.
        return ""
    parts = []
    for item in content or []:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "text":
            parts.append(item.get("text", ""))
        elif isinstance(item.get("content"), list):
            parts.append(plain_of(item["content"]))
        elif item.get("type") == "mention":
            parts.append("@" + str((item.get("props") or {}).get("noteName", "")))
        elif item.get("type") == "inlineMath":
            parts.append(str((item.get("props") or {}).get("latex", "")))
    return "".join(parts)


def _marks(styles: dict | None) -> dict:
    marks: dict = {}
    for src, dst in _MARKS.items():
        if (styles or {}).get(src):
            marks[dst] = True
    color = (styles or {}).get("textColor")
    bg = (styles or {}).get("backgroundColor")
    if color and color != "default":
        marks["color"] = color
    if bg and bg != "default":
        marks["bg"] = bg
    return marks


def _merge(runs: list[ir.Text]) -> list[ir.Text]:
    """Adjacent runs with identical marks and link become one (stable IR)."""
    out: list[ir.Text] = []
    for r in runs:
        if out and out[-1].marks == r.marks and out[-1].link == r.link:
            out[-1] = ir.Text(out[-1].text + r.text, r.marks, r.link)
        else:
            out.append(r)
    return out


def read_inline(content, losses: list[Loss]) -> list[ir.Inline]:
    if isinstance(content, str):
        return [ir.Text(content)] if content else []
    if not isinstance(content, list):
        return []
    out: list[ir.Inline] = []
    for item in content or []:
        if not isinstance(item, dict):
            continue
        t = item.get("type")
        if t == "text":
            if item.get("text"):
                out.append(ir.Text(item["text"], _marks(item.get("styles"))))
        elif t == "link":
            href = item.get("href") or None
            for inner in item.get("content") or []:
                if isinstance(inner, dict) and inner.get("text"):
                    out.append(ir.Text(inner["text"], _marks(inner.get("styles")), href))
        elif t == "inlineMath":
            latex = str((item.get("props") or {}).get("latex", ""))
            if latex:
                out.append(ir.Equation(latex))
        elif t == "mention":
            name = str((item.get("props") or {}).get("noteName", "")) or "note"
            out.append(ir.Text("@" + name))
            losses.append(Loss("approximated",
                               f"A link to the note “{name}”.",
                               "It appears as plain text “@" + name + "”.",
                               "mention_as_text"))
        else:
            text = plain_of([item])
            if text:
                out.append(ir.Text(text))
            losses.append(Loss("lossy", f"Inline content of type “{t}”.",
                               "Only its text is kept.", "unknown_inline"))
    # merge adjacent text runs (equations / mentions break the run)
    merged: list[ir.Inline] = []
    run: list[ir.Text] = []
    for i in out:
        if isinstance(i, ir.Text):
            run.append(i)
        else:
            merged.extend(_merge(run))
            run = []
            merged.append(i)
    merged.extend(_merge(run))
    return merged
