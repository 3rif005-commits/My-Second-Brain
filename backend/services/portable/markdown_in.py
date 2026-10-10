"""Markdown -> IR blocks. Small on purpose: what chat answers and skill files actually use
(headings, paragraphs, lists, quotes, fenced code, rules, bold/italic/code/links). Anything it
does not recognise stays as text, so nothing is dropped."""
from __future__ import annotations

import re

from . import ir

_INLINE = re.compile(r"(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[[^\]]+\]\([^)\s]+\))")
_HEAD = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
_BUL = re.compile(r"^(\s*)[-*+]\s+(.*)$")
_NUM = re.compile(r"^(\s*)(\d+)[.)]\s+(.*)$")
_TODO = re.compile(r"^\[( |x|X)\]\s+(.*)$")


def inline(text: str) -> list[ir.Text]:
    out: list[ir.Text] = []
    for part in _INLINE.split(text):
        if not part:
            continue
        if part.startswith(("**", "__")) and part.endswith(("**", "__")) and len(part) > 4:
            out.append(ir.Text(part[2:-2], {"bold": True}))
        elif part.startswith("`") and part.endswith("`") and len(part) > 2:
            out.append(ir.Text(part[1:-1], {"code": True}))
        elif part.startswith("[") and "](" in part and part.endswith(")"):
            label, _, url = part[1:-1].partition("](")
            out.append(ir.Text(label, {}, url))
        elif part[0] in "*_" and part[-1] == part[0] and len(part) > 2:
            out.append(ir.Text(part[1:-1], {"italic": True}))
        else:
            out.append(ir.Text(part))
    merged: list[ir.Text] = []
    for t in out:
        if merged and merged[-1].marks == t.marks and merged[-1].link == t.link:
            merged[-1] = ir.Text(merged[-1].text + t.text, t.marks, t.link)
        else:
            merged.append(t)
    return merged


def blocks(md: str) -> list[ir.Block]:
    lines = (md or "").replace("\r\n", "\n").split("\n")
    out: list[ir.Block] = []
    para: list[str] = []
    stack: list[tuple[int, ir.Block]] = []          # (indent, list item) for nesting

    def flush():
        if para:
            out.append(ir.Block("paragraph", inline=inline(" ".join(s.strip() for s in para))))
            para.clear()

    def add_item(indent: int, b: ir.Block):
        while stack and stack[-1][0] >= indent:
            stack.pop()
        (stack[-1][1].children if stack else out).append(b)
        stack.append((indent, b))

    i = 0
    while i < len(lines):
        line = lines[i]
        if line.strip().startswith("```"):
            flush()
            stack.clear()
            lang = line.strip()[3:].strip()
            body = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                body.append(lines[i])
                i += 1
            code = "\n".join(body)
            out.append(ir.Block("code", attrs={"language": lang or "text"}, inline=[ir.Text(code)] if code else []))
        elif not line.strip():
            flush()
            stack.clear()
        elif (m := _HEAD.match(line)):
            flush()
            stack.clear()
            out.append(ir.Block("heading", attrs={"level": len(m[1])}, inline=inline(m[2])))
        elif re.fullmatch(r"\s*([-*_])(\s*\1){2,}\s*", line):
            flush()
            stack.clear()
            out.append(ir.Block("divider"))
        elif line.lstrip().startswith(">"):
            flush()
            stack.clear()
            q = [line.lstrip()[1:].strip()]
            while i + 1 < len(lines) and lines[i + 1].lstrip().startswith(">"):
                i += 1
                q.append(lines[i].lstrip()[1:].strip())
            out.append(ir.Block("quote", inline=inline(" ".join(q))))
        elif (m := _BUL.match(line)):
            flush()
            todo = _TODO.match(m[2])
            b = (ir.Block("todo", attrs={"checked": todo[1] in "xX"}, inline=inline(todo[2])) if todo
                 else ir.Block("list_item", attrs={"style": "bullet"}, inline=inline(m[2])))
            add_item(len(m[1]), b)
        elif (m := _NUM.match(line)):
            flush()
            add_item(len(m[1]), ir.Block("list_item", attrs={"style": "numbered"}, inline=inline(m[3])))
        else:
            if stack and line.startswith((" ", "\t")):          # a wrapped list line
                last = stack[-1][1]
                last.inline = inline("".join(t.text for t in last.inline) + " " + line.strip())
            else:
                stack.clear()
                para.append(line)
        i += 1
    flush()
    return out
