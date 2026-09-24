"""Carry source tables into a note verbatim, instead of asking a model to retype them.

On real lecture slides the app's extraction yields 23 pipe tables for two
decks; the HTML path kept 9–14 of them and the Markdown path 6–10 (E6c). A
table the model paraphrases or skips is the part of a slide a student needs
most. So each source table is labelled `[[TABLE s.k]]` in the prompt, the model
places a table by writing its marker on a line of its own, and this module puts
the exact table there afterwards. Any table the model never placed is appended
at the end, so none can be lost.
"""
from __future__ import annotations

import html
import re

# A pipe table: a header row, a separator row, then any number of body rows.
_TABLE = re.compile(
    r"(?m)^(\|[^\n]*\|[ \t]*\n\|[ \t:|-]*-[ \t:|-]*\|[ \t]*(?:\n\|[^\n]*\|[ \t]*)*)")
_MARKER = re.compile(r"(?m)^[ \t]*\[\[TABLE (\d+)\.(\d+)\]\][ \t]*$")
_SEPARATOR = re.compile(r"^\|[ \t:|-]*-[ \t:|-]*\|[ \t]*$")


def _split(block: str) -> list[str]:
    """One regex match can hold several tables written back to back with no
    blank line between them: a new table starts at any row followed by a
    separator row. (Two slide decks: 23 tables, 16 matches, before this.)"""
    lines = block.split("\n")
    starts = [i for i in range(len(lines) - 1)
              if _SEPARATOR.match(lines[i + 1]) and not _SEPARATOR.match(lines[i])]
    starts = starts or [0]
    starts[0] = 0
    return ["\n".join(lines[a:b]).rstrip()
            for a, b in zip(starts, starts[1:] + [len(lines)])]


def marker(source_no: int, table_no: int) -> str:
    return f"[[TABLE {source_no}.{table_no}]]"


_PAGE_TAG = re.compile(r"\[page (\d+)\]")

class Tables(dict):
    """{marker: table text}, plus `pages`: {marker: (source, page)} — carried
    with the tables of ONE run. (A module-level map would mix two notes
    generating at once: every note's first table is [[TABLE 1.1]].)"""

    def __init__(self) -> None:
        super().__init__()
        self.pages: dict[str, tuple[int, int]] = {}


def label_tables(sources: list[dict]) -> tuple[list[dict], dict[str, str]]:
    """Put a marker line above every pipe table in every source.

    Returns the relabelled sources and {marker: table text}. The source keeps
    its table — the model has to read it to know where it belongs — it just
    never has to write it.
    """
    tables = Tables()
    out: list[dict] = []
    for s_no, source in enumerate(sources, start=1):
        count = 0

        text = source.get("text") or ""

        def _label(m: re.Match) -> str:
            nonlocal count
            pages = _PAGE_TAG.findall(text, 0, m.start())
            parts = []
            for table in _split(m.group(1).rstrip()):
                count += 1
                key = marker(s_no, count)
                tables[key] = table
                if pages:
                    tables.pages[key] = (s_no, int(pages[-1]))
                parts.append(f"{key}\n{table}")
            return "\n\n".join(parts)

        out.append({**source, "text": _TABLE.sub(_label, text)})
    return out, tables


_HTML_TABLE = re.compile(r"<table>.*?</table>", re.S)
_HTML_CELL = re.compile(r"<t[hd][^>]*>(.*?)</t[hd]>", re.S)


def _norm(cell: str) -> str:
    # Unescape first: a source cell's "<br>" and a rendered cell's "&lt;br&gt;"
    # (or a space) must compare equal, or every carried table looks missing.
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(cell))).strip().lower()


def _cells_md(table: str) -> set[str]:
    cells = set()
    for line in table.split("\n"):
        if _SEPARATOR.match(line):
            continue
        cells.update(_norm(c) for c in line.strip().strip("|").split("|"))
    return {c for c in cells if c}


def _already_there(table: str, note_tables: list[set[str]]) -> bool:
    """The model retyped this table instead of placing its marker. Appending
    the source copy as well gave the reader the same table twice (E6d: 46
    tables, 33 distinct)."""
    cells = _cells_md(table)
    return bool(cells) and any(len(cells & t) >= 0.8 * len(cells) for t in note_tables)


def carry_tables(md: str, tables: dict[str, str], offered: str = "") -> str:
    """Replace each marker line with its table; append the ones never placed.

    `offered` is the prompt: a table whose marker was cut off by the source
    budget was never shown to the model, so it is not appended either.
    """
    placed: set[str] = set()

    def _place(m: re.Match) -> str:
        key = marker(int(m.group(1)), int(m.group(2)))
        if key not in tables:
            return ""                     # an invented marker: drop the line
        placed.add(key)
        return tables[key]

    md = _MARKER.sub(_place, md or "")
    note_tables = [_cells_md(m.group(1)) for m in _TABLE.finditer(md)]
    missing = [k for k in tables if k not in placed and (not offered or k in offered)
               and not _already_there(tables[k], note_tables)]
    md, missing = _place_by_page_md(md, missing, tables)
    if missing:
        md = md.rstrip() + "\n\n## Tables from the slides\n\n" + "\n\n".join(
            tables[k] for k in missing) + "\n"
    return md


_HTML_MARKER = re.compile(
    r"(?:<p>\s*)?\[\[TABLE (\d+)\.(\d+)\]\](?:\s*</p>)?")


def carry_tables_html(html: str, tables: dict[str, str], offered: str = "") -> str:
    """The HTML-dialect twin of `carry_tables`: a marker (bare or alone in a
    <p>) becomes the exact source table, rendered by the same converter the
    Markdown path uses; unplaced tables are appended under their own chapter."""
    from services.workspace.md_to_blocks import markdown_to_html
    placed: set[str] = set()

    def _place(m: re.Match) -> str:
        key = marker(int(m.group(1)), int(m.group(2)))
        if key not in tables:
            return ""
        placed.add(key)
        return markdown_to_html(tables[key])

    html = _HTML_MARKER.sub(_place, html or "")
    note_tables = [{c for c in (_norm(x) for x in _HTML_CELL.findall(t)) if c}
                   for t in _HTML_TABLE.findall(html)]
    missing = [k for k in tables if k not in placed and (not offered or k in offered)
               and not _already_there(tables[k], note_tables)]
    html, missing = _place_by_page_html(html, missing, tables, markdown_to_html)
    if missing:
        html += "<h2>Tables from the slides</h2>" + "".join(
            markdown_to_html(tables[k]) for k in missing)
    return html


_H3_ANCHOR = re.compile(r'<h3[^>]*data-anchor="(\d+):p:(\d+)"[^>]*>')
_NEXT_SECTION = re.compile(r"<h[123][\s>]")


def _home(key: str, sections: list[tuple[int, int, int]],
          pages: dict[str, tuple[int, int]]) -> int | None:
    """Index of the section for this table: same source, nearest page at or
    before the table's page."""
    where = pages.get(key)
    if not where:
        return None
    src, page = where
    best = None
    for i, (s_no, p_no, _) in enumerate(sections):
        if s_no == src and p_no <= page and (best is None or p_no >= sections[best][1]):
            best = i
    return best


def _place_by_page_html(html: str, missing: list[str], tables: dict[str, str],
                        render) -> tuple[str, list[str]]:
    """An unplaced table goes at the end of the section anchored to its page
    rather than into an appendix far from the text about it (E6d live: 15 of
    32 tables ended up in the appendix)."""
    sections = [(int(m.group(1)), int(m.group(2)), m.end())
                for m in _H3_ANCHOR.finditer(html)]
    inserts: dict[int, list[str]] = {}
    left: list[str] = []
    for key in missing:
        i = _home(key, sections, getattr(tables, "pages", {}))
        if i is None:
            left.append(key)
            continue
        nxt = _NEXT_SECTION.search(html, sections[i][2])
        inserts.setdefault(nxt.start() if nxt else len(html), []).append(render(tables[key]))
    for pos in sorted(inserts, reverse=True):
        html = html[:pos] + "".join(inserts[pos]) + html[pos:]
    return html, left


_MD_SECTION = re.compile(r"(?m)^###[ \t]+.*\{(\d+):p:(\d+)\}[ \t]*$")
_MD_NEXT = re.compile(r"(?m)^#{1,3}[ \t]")


def _place_by_page_md(md: str, missing: list[str],
                      tables: dict[str, str]) -> tuple[str, list[str]]:
    """The Markdown twin of `_place_by_page_html`: an unplaced table goes at
    the end of the `### … {s:p:N}` section for its page."""
    sections = [(int(m.group(1)), int(m.group(2)), m.end()) for m in _MD_SECTION.finditer(md)]
    inserts: dict[int, list[str]] = {}
    left: list[str] = []
    for key in missing:
        i = _home(key, sections, getattr(tables, "pages", {}))
        if i is None:
            left.append(key)
            continue
        nxt = _MD_NEXT.search(md, sections[i][2] + 1)
        inserts.setdefault(nxt.start() if nxt else len(md), []).append(tables[key])
    for pos in sorted(inserts, reverse=True):
        block = "\n\n" + "\n\n".join(inserts[pos]) + "\n\n"
        md = md[:pos].rstrip("\n") + block + md[pos:]
    return md, left
