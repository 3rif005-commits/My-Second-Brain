"""HTML → the BlockNote blocks a note stores.

The AI writes notes through brain.create_note / brain.update_note. Asked for
block JSON, models invent their own (`{"type": "heading", "text": …}`,
`{"type": "details", …}`), and the editor showed those as an empty "Heading"
or "Unsupported block". Every model writes HTML well, and the study-guide path
already speaks one HTML dialect (callout divs, <details> toggles, math divs),
so the tools take that HTML and this module turns it into the exact block
shapes BlockNote 0.48's own parser produces (checked against
`editor.tryParseHTMLToBlocks`). It runs on the server so the note is right
for everything that reads it — search, the Android app, Notion sync — not
only once someone opens it in the editor.

`normalize_blocks` is the same safety net for callers that still send blocks:
real blocks (e.g. copied from brain.get_note) pass through, invented shapes
are coerced to real ones instead of being stored broken.
"""
from __future__ import annotations

import re
import uuid
from html.parser import HTMLParser
from typing import Any

CALLOUT_TYPES = {"OVERVIEW", "NOTE", "TIP", "IMPORTANT", "WARNING",
                 "CAUTION", "FORMULA", "ANALOGY", "EXAM"}
# What a model means when it names a callout by colour or mood instead of type.
_CALLOUT_ALIASES = {
    "blue": "OVERVIEW", "info": "NOTE", "gray": "NOTE", "grey": "NOTE",
    "green": "TIP", "success": "TIP", "hint": "TIP", "yellow": "IMPORTANT",
    "orange": "WARNING", "warn": "WARNING", "red": "CAUTION", "danger": "CAUTION",
    "error": "CAUTION", "purple": "FORMULA", "brown": "ANALOGY", "pink": "EXAM",
    "summary": "OVERVIEW", "key": "IMPORTANT",
}
COLORS = {"default", "gray", "brown", "red", "orange", "yellow", "green",
          "blue", "purple", "pink"}
_VOID = {"br", "hr", "img", "input", "meta", "link", "col", "source", "wbr"}
_DROP = {"script", "style", "head", "title", "noscript", "template", "iframe"}
_INLINE_TAGS = {"a", "b", "strong", "i", "em", "u", "s", "del", "strike", "code",
                "mark", "span", "br", "sub", "sup", "small", "abbr", "kbd", "label",
                "font", "cite", "q", "time", "var", "samp", "ins", "input"}
_BR = "\u2028"                           # a <br>, kept apart from source newlines
_LIST_ITEM = {"ul": "bulletListItem", "ol": "numberedListItem"}


class _Node:
    __slots__ = ("tag", "attrs", "children")

    def __init__(self, tag: str, attrs: dict[str, str]):
        self.tag = tag
        self.attrs = attrs
        self.children: list[_Node | str] = []


class _TreeBuilder(HTMLParser):
    """A forgiving DOM: unclosed tags close with their parent, stray end tags
    are ignored, <p> and <li> close when a sibling of their kind opens."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = _Node("root", {})
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        if tag in ("p", "li", "tr", "td", "th", "summary"):
            closes = {"p": {"p"}, "li": {"li", "p"}, "tr": {"tr", "td", "th"},
                      "td": {"td", "th"}, "th": {"td", "th"}, "summary": {"summary"}}[tag]
            while len(self.stack) > 1 and self.stack[-1].tag in closes:
                self.stack.pop()
        if tag not in _INLINE_TAGS and self.stack[-1].tag == "p":
            self.stack.pop()                    # a block can't live in a <p>
        node = _Node(tag, {k: (v or "") for k, v in attrs})
        self.stack[-1].children.append(node)
        if tag not in _VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in _VOID and self.stack[-1].tag == tag:
            self.stack.pop()

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def _parse(html: str) -> _Node:
    b = _TreeBuilder()
    b.feed(html or "")
    b.close()
    return b.root


# ── inline content ─────────────────────────────────────────────────────────

def _styles_for(node: _Node, styles: dict) -> dict:
    s = dict(styles)
    t = node.tag
    if t in ("b", "strong"):
        s["bold"] = True
    elif t in ("i", "em", "cite", "var"):
        s["italic"] = True
    elif t in ("u", "ins"):
        s["underline"] = True
    elif t in ("s", "del", "strike"):
        s["strike"] = True
    elif t in ("code", "kbd", "samp"):
        s["code"] = True
    elif t == "mark":
        s["backgroundColor"] = "yellow"
    elif t == "span":
        kind, value = node.attrs.get("data-style-type"), node.attrs.get("data-value")
        if kind in ("backgroundColor", "textColor") and value in COLORS:
            s[kind] = value
    return s


def _safe_href(href: str) -> str | None:
    href = (href or "").strip()
    if re.match(r"^(https?:|mailto:)", href, re.I) or href.startswith("/"):
        return href
    return None


def _inline(nodes: list, styles: dict | None = None) -> list[dict]:
    out: list[dict] = []
    styles = styles or {}
    for n in nodes:
        if isinstance(n, str):
            if n:
                out.append({"type": "text", "text": n, "styles": dict(styles)})
        elif n.tag in _DROP:
            continue
        elif n.tag == "br":
            out.append({"type": "text", "text": _BR, "styles": dict(styles)})
        elif n.tag == "input":
            continue
        elif n.tag == "a" and _safe_href(n.attrs.get("href", "")):
            inner = _inline(n.children, styles)
            if inner:
                out.append({"type": "link", "href": _safe_href(n.attrs["href"]),
                            "content": inner})
        else:
            out.extend(_inline(n.children, _styles_for(n, styles)))
    return out


def _tidy(items: list[dict], keep_space: bool = False) -> list[dict]:
    """Collapse HTML whitespace, merge equal-styled runs, trim the ends."""
    merged: list[dict] = []
    for it in items:
        if it["type"] == "text":
            text = it["text"] if keep_space else re.sub(r"[ \t\r\n\f]+", " ", it["text"])
            if merged and merged[-1]["type"] == "text" and merged[-1]["styles"] == it["styles"]:
                merged[-1]["text"] += text
            else:
                merged.append({"type": "text", "text": text, "styles": it["styles"]})
        else:
            it = dict(it, content=_tidy(it["content"], keep_space))
            merged.append(it)
    if not keep_space:
        # spaces around a line break, and at the very ends, are not content
        for i, it in enumerate(merged):
            if it["type"] == "text":
                it["text"] = re.sub(f" ?{_BR} ?", "\n", it["text"])
        if merged and merged[0]["type"] == "text":
            merged[0]["text"] = merged[0]["text"].lstrip(" ")
        if merged and merged[-1]["type"] == "text":
            merged[-1]["text"] = merged[-1]["text"].rstrip(" ")
    return [it for it in merged if it["type"] != "text" or it["text"]]


def _text_of(node: _Node | str) -> str:
    if isinstance(node, str):
        return node
    if node.tag in _DROP:
        return ""
    return "".join(_text_of(c) for c in node.children)


# ── blocks ─────────────────────────────────────────────────────────────────

def _props(kind: str, **extra) -> dict:
    if kind in ("quote",):
        base = {"backgroundColor": "default", "textColor": "default"}
    elif kind == "codeBlock":
        base = {"language": "text"}
    elif kind == "table":
        base = {"textColor": "default"}
    elif kind in ("divider", "callout", "math"):
        base = {}
    else:
        base = {"backgroundColor": "default", "textColor": "default",
                "textAlignment": "left"}
    base.update(extra)
    return base


def _block(kind: str, content: Any = None, children: list | None = None, **props) -> dict:
    b: dict[str, Any] = {"id": str(uuid.uuid4()), "type": kind,
                         "props": _props(kind, **props)}
    if content is not None:
        b["content"] = content
    b["children"] = children or []
    return b


def _is_inline(n: _Node | str) -> bool:
    return isinstance(n, str) or n.tag in _INLINE_TAGS


def _heading_level(tag: str) -> int | None:
    return int(tag[1]) if re.fullmatch(r"h[1-6]", tag) else None


def _list_item(li: _Node, kind: str) -> dict:
    inline_part = [c for c in li.children if _is_inline(c)]
    block_part = [c for c in li.children if not _is_inline(c)]
    checked = None
    for c in li.children:
        if isinstance(c, _Node) and c.tag == "input" and c.attrs.get("type") == "checkbox":
            checked = "checked" in c.attrs
    content = _tidy(_inline(inline_part))
    # "[ ] task" / "[x] task" written as text
    if checked is None and content and content[0]["type"] == "text":
        m = re.match(r"^\[([ xX])\]\s*", content[0]["text"])
        if m:
            checked = m.group(1) != " "
            content[0]["text"] = content[0]["text"][m.end():]
            content = [c for c in content if c["type"] != "text" or c["text"]]
    # <li><p>text</p>…</li>: the first paragraph is the item's own text
    if not content and block_part and isinstance(block_part[0], _Node) and block_part[0].tag == "p":
        content = _tidy(_inline(block_part[0].children))
        block_part = block_part[1:]
    children = _blocks(block_part)
    if checked is not None:
        return _block("checkListItem", content, children, checked=checked)
    return _block(kind, content, children)


def _table(node: _Node) -> dict | None:
    rows: list[list[_Node]] = []
    header = False

    def walk(n: _Node):
        nonlocal header
        for c in n.children:
            if not isinstance(c, _Node):
                continue
            if c.tag == "tr":
                cells = [x for x in c.children if isinstance(x, _Node) and x.tag in ("td", "th")]
                if not rows and cells and all(x.tag == "th" for x in cells):
                    header = True
                if cells:
                    rows.append(cells)
            elif c.tag in ("thead", "tbody", "tfoot"):
                if c.tag == "thead" and not rows:
                    header = True
                walk(c)

    walk(node)
    if not rows:
        return None
    width = max(len(r) for r in rows)
    content_rows = []
    for r in rows:
        cells = [{"type": "tableCell", "content": _tidy(_inline(c.children)),
                  "props": {"colspan": 1, "rowspan": 1, "backgroundColor": "default",
                            "textColor": "default", "textAlignment": "left"}} for c in r]
        while len(cells) < width:
            cells.append({"type": "tableCell", "content": [],
                          "props": {"colspan": 1, "rowspan": 1, "backgroundColor": "default",
                                    "textColor": "default", "textAlignment": "left"}})
        content_rows.append({"cells": cells})
    content: dict[str, Any] = {"type": "tableContent", "columnWidths": [None] * width,
                               "rows": content_rows}
    if header:
        content["headerRows"] = 1
    return _block("table", content)


def _callout_type(raw: str) -> str:
    raw = (raw or "").strip()
    if raw.upper() in CALLOUT_TYPES:
        return raw.upper()
    return _CALLOUT_ALIASES.get(raw.lower(), "NOTE")


def _element(n: _Node) -> list[dict]:
    t = n.tag
    if t in _DROP:
        return []
    level = _heading_level(t)
    if level:
        return [_block("heading", _tidy(_inline(n.children)), level=level, isToggleable=False)]
    if t == "p":
        content = _tidy(_inline(n.children))
        return [_block("paragraph", content)] if content else []
    if t in _LIST_ITEM:
        out = []
        for c in n.children:
            if isinstance(c, _Node) and c.tag == "li":
                out.append(_list_item(c, _LIST_ITEM[t]))
            elif isinstance(c, _Node) and c.tag in _LIST_ITEM:
                nested = _element(c)            # <ul><ul>…: belongs to the item above
                if out:
                    out[-1]["children"].extend(nested)
                else:
                    out.extend(nested)
        return out
    if t == "li":
        return [_list_item(n, "bulletListItem")]
    if t == "blockquote":
        parts = [c for c in n.children if not (isinstance(c, str) and not c.strip())]
        inline: list = []
        for i, c in enumerate(parts):
            if i and not _is_inline(c):
                inline.append("\n")
            inline.extend(c.children if isinstance(c, _Node) and not _is_inline(c) else [c])
        return [_block("quote", _tidy(_inline(inline)))]
    if t == "pre":
        code = next((c for c in n.children if isinstance(c, _Node) and c.tag == "code"), None)
        lang = "text"
        if code is not None:
            m = re.search(r"(?:language|lang)-([\w+#-]+)", code.attrs.get("class", ""))
            lang = m.group(1).lower() if m else (code.attrs.get("data-language") or "text")
        text = _text_of(code if code is not None else n).strip("\n")
        return [_block("codeBlock", [{"type": "text", "text": text, "styles": {}}] if text else [],
                       language=lang)]
    if t == "hr":
        return [_block("divider")]
    if t == "table":
        tb = _table(n)
        return [tb] if tb else []
    if t == "details":
        summary = next((c for c in n.children if isinstance(c, _Node) and c.tag == "summary"), None)
        rest = [c for c in n.children if c is not summary]
        children = _blocks(rest)
        if summary is not None:
            heading = next((c for c in summary.children if isinstance(c, _Node)
                            and _heading_level(c.tag)), None)
            if heading is not None:
                return [_block("heading", _tidy(_inline(heading.children)), children,
                               level=_heading_level(heading.tag), isToggleable=True)]
            return [_block("toggleListItem", _tidy(_inline(summary.children)), children)]
        return [_block("toggleListItem", [], children)]
    if t == "summary":
        return [_block("paragraph", _tidy(_inline(n.children)))]
    if n.attrs.get("data-type") == "callout" or t == "aside":
        children = _blocks(n.children) or [_block("paragraph", [])]
        return [_block("callout", None, children,
                       calloutType=_callout_type(n.attrs.get("data-callout-type", "")),
                       calloutIcon=n.attrs.get("data-callout-icon", ""))]
    if n.attrs.get("data-type") == "math":
        return [_block("math", None, latex=_text_of(n).strip())]
    if t == "img":
        url = _safe_href(n.attrs.get("src", ""))
        if not url:
            return []
        return [{"id": str(uuid.uuid4()), "type": "image",
                 "props": {"backgroundColor": "default", "textAlignment": "left",
                           "name": "", "url": url, "caption": n.attrs.get("alt", ""),
                           "showPreview": True},
                 "children": []}]
    if t == "input":
        return []
    # div, section, article, figure, body, html, …: just a container
    return _blocks(n.children)


def _blocks(nodes: list) -> list[dict]:
    out: list[dict] = []
    run: list = []

    def flush():
        content = _tidy(_inline(run))
        if content:
            out.append(_block("paragraph", content))
        run.clear()

    for n in nodes:
        if _is_inline(n):
            run.append(n)
        else:
            flush()
            out.extend(_element(n))
    flush()
    return out


def html_to_blocks(html: str) -> list[dict]:
    """The note's blocks for `html`. Never empty-handed for non-empty text:
    plain text with no tags becomes paragraphs."""
    if html and "<" not in html:
        return [_block("paragraph", [{"type": "text", "text": p.strip(), "styles": {}}])
                for p in re.split(r"\n\s*\n", html) if p.strip()]
    return _blocks(_parse(html).children)


# ── blocks a model wrote by hand ───────────────────────────────────────────

_TYPE_ALIASES = {
    "text": "paragraph", "p": "paragraph", "para": "paragraph",
    "bullet": "bulletListItem", "bulleted_list_item": "bulletListItem",
    "bulletlist": "bulletListItem", "list_item": "bulletListItem", "li": "bulletListItem",
    "bullet_list_item": "bulletListItem", "listitem": "bulletListItem",
    "numbered": "numberedListItem", "numbered_list_item": "numberedListItem",
    "numberedlist": "numberedListItem", "ordered": "numberedListItem",
    "todo": "checkListItem", "to_do": "checkListItem", "checkbox": "checkListItem",
    "task": "checkListItem", "checklist": "checkListItem",
    "toggle": "toggleListItem", "details": "toggleListItem", "collapsible": "toggleListItem",
    "code": "codeBlock", "code_block": "codeBlock", "pre": "codeBlock",
    "blockquote": "quote", "hr": "divider", "horizontalrule": "divider",
    "separator": "divider", "aside": "callout", "admonition": "callout",
    "equation": "math", "formula": "math", "latex": "math",
}
_KNOWN = {"paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem",
          "toggleListItem", "quote", "codeBlock", "divider", "table", "callout", "math",
          "image", "video", "audio", "file", "interactive", "database", "checkpoint",
          "button", "columnList", "column"}
_STYLE_KEYS = {"bold", "italic", "underline", "strike", "code", "textColor", "backgroundColor"}


def _norm_inline(content: Any) -> list[dict]:
    if content is None:
        return []
    if isinstance(content, str):
        return [{"type": "text", "text": content, "styles": {}}] if content else []
    if isinstance(content, dict):
        content = [content]
    out: list[dict] = []
    for it in content if isinstance(content, list) else []:
        if isinstance(it, str):
            out.extend(_norm_inline(it))
        elif isinstance(it, dict) and it.get("type") == "link":
            out.append({"type": "link", "href": str(it.get("href") or it.get("url") or ""),
                        "content": _norm_inline(it.get("content") or it.get("text"))})
        elif isinstance(it, dict) and it.get("type") in (None, "text"):
            styles = it.get("styles") if isinstance(it.get("styles"), dict) else {}
            styles = {**{k: it[k] for k in _STYLE_KEYS if k in it}, **styles}
            text = it.get("text", "")
            if isinstance(text, str) and text:
                out.append({"type": "text", "text": text, "styles": styles})
        elif isinstance(it, dict):
            out.append(it)                       # mention, inlineMath: the editor's own
    return out


def _loose_text(b: dict) -> Any:
    for k in ("content", "text", "title", "summary", "value", "label"):
        if b.get(k) not in (None, "", []):
            return b[k]
    return None


def _norm_block(b: Any) -> list[dict]:
    if isinstance(b, str):
        return html_to_blocks(b) if "<" in b else [_block("paragraph", _norm_inline(b))]
    if not isinstance(b, dict):
        return []
    if isinstance(b.get("html"), str) and not b.get("type"):
        return html_to_blocks(b["html"])
    raw = str(b.get("type") or "paragraph")
    props = dict(b.get("props") or {}) if isinstance(b.get("props"), dict) else {}
    level = None
    if re.fullmatch(r"h[1-6]|heading_?[1-6]", raw.lower()):
        level, kind = int(raw[-1]), "heading"
    else:
        kind = raw if raw in _KNOWN else _TYPE_ALIASES.get(raw.lower().replace("-", "_"),
                                                            _TYPE_ALIASES.get(raw.lower()))
    children = normalize_blocks(b.get("children")) if isinstance(b.get("children"), list) else []

    if kind is None:
        # A type we can't place: keep its words as a paragraph, never drop them.
        text = _loose_text(b)
        return ([_block("paragraph", _norm_inline(text))] if text else []) + children
    if kind in ("table", "image", "video", "audio", "file", "interactive", "database",
                "checkpoint", "button", "columnList", "column"):
        out = dict(b, type=kind, props=props, children=children)
        out.setdefault("id", str(uuid.uuid4()))
        return [out]
    if kind == "divider":
        return [_block("divider")]
    if kind == "math":
        latex = props.get("latex") or b.get("latex") or _loose_text(b) or ""
        return [_block("math", None, latex=latex if isinstance(latex, str) else "")]
    if kind == "callout":
        ctype = props.get("calloutType") or b.get("calloutType") or b.get("variant") \
            or props.get("color") or b.get("color") or ""
        text = _norm_inline(_loose_text(b))
        if text:
            # a callout holds no text of its own; its words go in its body
            if b.get("title") and b.get("title") == _loose_text(b):
                for it in text:
                    it.setdefault("styles", {})["bold"] = True
            children = [_block("paragraph", text)] + children
        return [_block("callout", None, children or [_block("paragraph", [])],
                       calloutType=_callout_type(str(ctype)),
                       calloutIcon=str(props.get("calloutIcon") or b.get("emoji")
                                       or b.get("icon") or ""))]
    content = _norm_inline(_loose_text(b)) if kind != "codeBlock" else None
    base = _props(kind)
    for k in base:
        if k in props:
            base[k] = props[k]
    if kind == "heading":
        lv = level or props.get("level") or b.get("level") or 2
        try:
            lv = min(max(int(lv), 1), 6)
        except (TypeError, ValueError):
            lv = 2
        base["level"] = lv
        base["isToggleable"] = bool(props.get("isToggleable") or b.get("isToggleable"))
    if kind == "checkListItem":
        base["checked"] = bool(props.get("checked") or b.get("checked"))
    if kind == "codeBlock":
        text = _loose_text(b)
        if isinstance(text, list):
            text = "".join(t.get("text", "") if isinstance(t, dict) else str(t) for t in text)
        content = [{"type": "text", "text": str(text), "styles": {}}] if text else []
        base["language"] = str(props.get("language") or b.get("language") or "text")
    out = {"id": b.get("id") or str(uuid.uuid4()), "type": kind, "props": base,
           "content": content, "children": children}
    return [out]


def normalize_blocks(blocks: Any) -> list[dict]:
    """Real BlockNote blocks, from whatever a model sent as `blocks`."""
    if isinstance(blocks, str):
        return html_to_blocks(blocks)
    if isinstance(blocks, dict):
        blocks = [blocks]
    return [x for b in (blocks or []) for x in _norm_block(b)]
