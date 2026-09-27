"""Text from other apps as a Second Brain note (5.4).

Apps send Markdown or plain text; the editor stores BlockNote blocks. This
covers what chat apps write — headings, bullet and numbered lists, quotes and
paragraphs — and keeps anything else as a plain paragraph rather than dropping it.
"""
from __future__ import annotations

import re
import uuid

_HEADING = re.compile(r"^(#{1,3})\s+(.*)$")
_BULLET = re.compile(r"^\s*[-*+]\s+(.*)$")
_NUMBER = re.compile(r"^\s*\d+[.)]\s+(.*)$")
_QUOTE = re.compile(r"^\s*>\s?(.*)$")


def _text(t: str) -> list[dict]:
    t = re.sub(r"\*\*(.+?)\*\*|__(.+?)__", lambda m: m.group(1) or m.group(2), t)
    return [{"type": "text", "text": t, "styles": {}}] if t else []


def _block(kind: str, text: str, **props) -> dict:
    return {"id": str(uuid.uuid4()), "type": kind, "props": props,
            "content": _text(text), "children": []}


def markdown_to_blocks(md: str) -> list[dict]:
    blocks: list[dict] = []
    para: list[str] = []

    def flush():
        if para:
            blocks.append(_block("paragraph", " ".join(s.strip() for s in para)))
            para.clear()

    for line in (md or "").splitlines():
        if not line.strip():
            flush()
            continue
        if m := _HEADING.match(line):
            flush(); blocks.append(_block("heading", m.group(2).strip(), level=len(m.group(1))))
        elif m := _BULLET.match(line):
            flush(); blocks.append(_block("bulletListItem", m.group(1).strip()))
        elif m := _NUMBER.match(line):
            flush(); blocks.append(_block("numberedListItem", m.group(1).strip()))
        elif m := _QUOTE.match(line):
            flush(); blocks.append(_block("quote", m.group(1).strip()))
        else:
            para.append(line)
    flush()
    return blocks
