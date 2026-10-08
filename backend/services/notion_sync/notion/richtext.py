"""IR inline -> Notion rich_text. Lengths are counted in UTF-16 code units."""
from __future__ import annotations

import contextvars
import re

from services.portable import ir
from services.portable.losses import Loss

from .limits import (MAX_EQUATION_CHARS, MAX_RICH_TEXT_OBJECTS, MAX_TEXT_UNITS,
                     MAX_URL_CHARS)

COLORS = {"gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"}
LINK_SCHEMES = ("http://", "https://", "mailto:", "tel:")


#: Resolves links to other notes while a page is being written. `resolve(note_id)`
#: returns ("page", notion_page_id) | ("private", None) | ("unmirrored", None).
RESOLVER: contextvars.ContextVar = contextvars.ContextVar("notion_mention_resolver", default=None)
_NOTE_LINK = re.compile(r"(?:^|/)brain/([0-9a-fA-F]{8}-[0-9a-fA-F-]{27})(?:[/?#].*)?$")


def utf16_len(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def split_units(s: str, limit: int = MAX_TEXT_UNITS) -> list[str]:
    """Pieces of at most `limit` UTF-16 units; never splits a surrogate pair
    (an emoji) and never loses a character."""
    out, cur, n = [], [], 0
    for ch in s:
        w = 2 if ord(ch) > 0xFFFF else 1
        if n + w > limit:
            out.append("".join(cur))
            cur, n = [], 0
        cur.append(ch)
        n += w
    if cur or not out:
        out.append("".join(cur))
    return out


def color_of(marks: dict, losses: list[Loss]) -> str:
    fg, bg = marks.get("color"), marks.get("bg")
    if fg and fg not in COLORS:
        losses.append(Loss("approximated", f"The text colour “{fg}”.",
                           "The text uses the default colour.", "unknown_colour"))
        fg = None
    if bg and bg not in COLORS:
        losses.append(Loss("approximated", f"The highlight colour “{bg}”.",
                           "The text has no highlight.", "unknown_colour"))
        bg = None
    if bg:
        if fg:
            losses.append(Loss("lossy", "Text that has both a colour and a highlight.",
                               "Notion keeps the highlight and drops the text colour.",
                               "colour_and_highlight"))
        return f"{bg}_background"
    return fg or "default"


def _link(url: str, losses: list[Loss]) -> dict | None:
    m = _NOTE_LINK.search(url)
    res = RESOLVER.get()
    if m and res is not None:
        kind, pid = res(m.group(1).lower())
        if kind == "page":
            return {"url": "https://www.notion.so/" + pid.replace("-", "")}
        losses.append(Loss("approximated", "A link to another note that is not in Notion.",
                           "The text is kept without the link.", "note_link_unmirrored"))
        return None
    if len(url) > MAX_URL_CHARS or not url.lower().startswith(LINK_SCHEMES):
        losses.append(Loss("lossy", "A link Notion cannot store (too long, or not a web address).",
                           "The text is kept without the link.", "link_dropped"))
        return None
    return {"url": url}


def text_objects(text: str, marks: dict, link: str | None, losses: list[Loss]) -> list[dict]:
    ann = {}
    for m, key in (("bold", "bold"), ("italic", "italic"), ("underline", "underline"),
                   ("strike", "strikethrough"), ("code", "code")):
        if marks.get(m):
            ann[key] = True
    color = color_of(marks, losses)
    if color != "default":
        ann["color"] = color
    lk = _link(link, losses) if link else None
    out = []
    for piece in split_units(text):
        obj: dict = {"type": "text", "text": {"content": piece}}
        if lk:
            obj["text"]["link"] = lk
        if ann:
            obj["annotations"] = dict(ann)
        out.append(obj)
    return out


def rich_text(inline: list[ir.Inline], losses: list[Loss]) -> list[dict]:
    out: list[dict] = []
    for i in inline:
        if isinstance(i, ir.Text):
            if i.text:
                out.extend(text_objects(i.text, i.marks, i.link, losses))
        elif isinstance(i, ir.Equation):
            if len(i.latex) <= MAX_EQUATION_CHARS:
                out.append({"type": "equation", "equation": {"expression": i.latex}})
            else:
                out.extend(text_objects(i.latex, {"code": True}, None, losses))
                losses.append(Loss("approximated", "A formula longer than Notion allows inline.",
                                   "It appears as code.", "equation_too_long"))
        elif isinstance(i, ir.Mention):
            res = RESOLVER.get()
            kind, pid = res(i.target.id) if res else ("unmirrored", None)
            if kind == "page":
                out.append({"type": "mention", "mention": {"type": "page", "page": {"id": pid}}})
            elif kind == "private":
                out.extend(text_objects("🔒 a private note", {}, None, losses))
                losses.append(Loss("approximated", "A link to a private note.",
                                   "It shows as “a private note”; the title is not sent.", "mention_private"))
            else:
                out.extend(text_objects("@" + i.label, {}, None, losses))
                losses.append(Loss("approximated", f"A link to the note “{i.label}”, which is not in Notion yet.",
                                   "It shows as plain text until that note is sent.", "mention_unmirrored"))
    return out


def plain_rich(text: str) -> list[dict]:
    return [{"type": "text", "text": {"content": p}} for p in split_units(text)] if text else []


def chunk_objects(objs: list[dict], n: int = MAX_RICH_TEXT_OBJECTS) -> list[list[dict]]:
    """Split a rich_text array that is longer than Notion allows."""
    return [objs[i:i + n] for i in range(0, len(objs), n)] or [[]]
