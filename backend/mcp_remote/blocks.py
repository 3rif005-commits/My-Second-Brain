"""Text from other apps as a Second Brain note (5.4).

Apps send Markdown or plain text; the editor stores BlockNote blocks. The
Markdown is rendered to HTML here and handed to services/note_html, the same
converter the chat AI's notes go through, so a note from another app keeps
its bold, links, code, tables and task lists instead of arriving as plain
paragraphs. Anything unrecognised stays as paragraph text rather than being
dropped.
"""
from __future__ import annotations

import html
import re

from services.note_html import html_to_blocks

_HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
_FENCE = re.compile(r"^\s*(`{3,}|~{3,})\s*([\w+#.-]*)")
_RULE = re.compile(r"^\s{0,3}([-*_])(\s*\1){2,}\s*$")
_ITEM = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$")
_TASK = re.compile(r"^\[([ xX])\]\s+(.*)$")
_QUOTE = re.compile(r"^\s*>\s?(.*)$")
_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$")

_CODE_SPAN = re.compile(r"(`+)(.+?)\1")
_LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
_BOLD = re.compile(r"\*\*(.+?)\*\*|__(.+?)__")
_ITALIC = re.compile(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)|(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w])")
_STRIKE = re.compile(r"~~(.+?)~~")


def _inline(text: str) -> str:
    """Markdown inline syntax → HTML. Code spans are cut out first so their
    contents stay literal."""
    codes: list[str] = []

    def keep(m):
        codes.append(f"<code>{html.escape(m.group(2).strip())}</code>")
        return f"\x00{len(codes) - 1}\x00"

    out = html.escape(_CODE_SPAN.sub(keep, text), quote=False)
    out = _LINK.sub(lambda m: f'<a href="{html.escape(m.group(2))}">{m.group(1)}</a>', out)
    out = _BOLD.sub(lambda m: f"<strong>{m.group(1) or m.group(2)}</strong>", out)
    out = _ITALIC.sub(lambda m: f"<em>{m.group(1) or m.group(2)}</em>", out)
    out = _STRIKE.sub(r"<s>\1</s>", out)
    return re.sub(r"\x00(\d+)\x00", lambda m: codes[int(m.group(1))], out)


def _cells(row: str) -> list[str]:
    row = row.strip()
    if row.startswith("|"):
        row = row[1:]
    if row.endswith("|"):
        row = row[:-1]
    return [c.strip() for c in row.split("|")]


def _list_html(items: list[tuple[int, str, str]]) -> str:
    """(indent, marker, text) lines → nested <ul>/<ol>."""
    out: list[str] = []
    stack: list[tuple[int, str]] = []          # (indent, tag)
    for indent, marker, text in items:
        tag = "ul" if marker in "-*+" else "ol"
        while stack and indent < stack[-1][0]:
            out.append(f"</li></{stack.pop()[1]}>")
        if stack and indent == stack[-1][0]:
            if tag != stack[-1][1]:
                out.append(f"</li></{stack.pop()[1]}><{tag}>")
                stack.append((indent, tag))
            else:
                out.append("</li>")
        else:
            out.append(f"<{tag}>")
            stack.append((indent, tag))
        if task := _TASK.match(text):
            checked = " checked" if task.group(1) != " " else ""
            out.append(f'<li><input type="checkbox"{checked}>{_inline(task.group(2))}')
        else:
            out.append(f"<li>{_inline(text)}")
    while stack:
        out.append(f"</li></{stack.pop()[1]}>")
    return "".join(out)


def markdown_to_html(md: str) -> str:
    lines = (md or "").replace("\r\n", "\n").split("\n")
    out: list[str] = []
    para: list[str] = []
    i = 0

    def flush():
        if para:
            out.append(f"<p>{_inline(' '.join(s.strip() for s in para))}</p>")
            para.clear()

    while i < len(lines):
        line = lines[i]
        if not line.strip():
            flush(); i += 1
        elif m := _FENCE.match(line):
            flush()
            fence, lang, body = m.group(1), m.group(2), []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith(fence):
                body.append(lines[i]); i += 1
            i += 1
            cls = f' class="language-{html.escape(lang)}"' if lang else ""
            out.append(f"<pre><code{cls}>{html.escape(chr(10).join(body))}</code></pre>")
        elif m := _HEADING.match(line):
            flush(); out.append(f"<h{len(m.group(1))}>{_inline(m.group(2))}</h{len(m.group(1))}>"); i += 1
        elif _RULE.match(line):
            flush(); out.append("<hr>"); i += 1
        elif "|" in line and i + 1 < len(lines) and _TABLE_SEP.match(lines[i + 1]) \
                and "-" in lines[i + 1]:
            flush()
            head = "".join(f"<th>{_inline(c)}</th>" for c in _cells(line))
            rows = [f"<tr>{head}</tr>"]
            i += 2
            while i < len(lines) and "|" in lines[i] and lines[i].strip():
                rows.append("<tr>" + "".join(f"<td>{_inline(c)}</td>"
                                             for c in _cells(lines[i])) + "</tr>")
                i += 1
            out.append(f"<table>{''.join(rows)}</table>")
        elif _ITEM.match(line):
            flush()
            items = []
            while i < len(lines) and (m := _ITEM.match(lines[i])):
                items.append((len(m.group(1).expandtabs(4)), m.group(2)[0], m.group(3).strip()))
                i += 1
            out.append(_list_html(items))
        elif _QUOTE.match(line):
            flush()
            body = []
            while i < len(lines) and (m := _QUOTE.match(lines[i])):
                body.append(m.group(1)); i += 1
            out.append(f"<blockquote>{_inline(' '.join(s.strip() for s in body if s.strip()))}</blockquote>")
        else:
            para.append(line); i += 1
    flush()
    return "".join(out)


def markdown_to_blocks(md: str) -> list[dict]:
    return html_to_blocks(markdown_to_html(md))
