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


def label_tables(sources: list[dict]) -> tuple[list[dict], dict[str, str]]:
    """Put a marker line above every pipe table in every source.

    Returns the relabelled sources and {marker: table text}. The source keeps
    its table — the model has to read it to know where it belongs — it just
    never has to write it.
    """
    tables: dict[str, str] = {}
    out: list[dict] = []
    for s_no, source in enumerate(sources, start=1):
        count = 0

        def _label(m: re.Match) -> str:
            nonlocal count
            parts = []
            for table in _split(m.group(1).rstrip()):
                count += 1
                key = marker(s_no, count)
                tables[key] = table
                parts.append(f"{key}\n{table}")
            return "\n\n".join(parts)

        out.append({**source, "text": _TABLE.sub(_label, source.get("text") or "")})
    return out, tables


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
    missing = [k for k in tables if k not in placed and (not offered or k in offered)]
    if missing:
        md = md.rstrip() + "\n\n## Tables from the slides\n\n" + "\n\n".join(
            tables[k] for k in missing) + "\n"
    return md
