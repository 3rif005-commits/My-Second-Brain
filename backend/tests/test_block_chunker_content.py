"""E8b: tables, formulas and link text are searchable. They were skipped —
a table's content is a dict of rows, a formula lives in props.latex, and a
link nests its text — so a study guide's rates and equations were never
found by the chat."""
from services.block_chunker import parse


def _text(t):
    return [{"type": "text", "text": t, "styles": {}}]


def test_a_table_is_indexed_row_by_row():
    [chunk] = parse([{"id": "t", "type": "table", "content": {"type": "tableContent", "rows": [
        {"cells": [{"type": "tableCell", "content": _text("Metric")}, _text("COMPAS")]},
        {"cells": [{"type": "tableCell", "content": _text("False positive rate")}, _text("45%")]}]}}])
    assert chunk["chunk_text"] == "Metric | COMPAS\nFalse positive rate | 45%"


def test_a_formula_is_indexed():
    [chunk] = parse([{"id": "m", "type": "math", "props": {"latex": "TDE = Q_{obs} - Q_{exp}"}}])
    assert chunk["chunk_text"] == "TDE = Q_{obs} - Q_{exp}"


def test_link_text_is_kept():
    [chunk] = parse([{"id": "p", "type": "paragraph", "content": [
        {"type": "text", "text": "See"}, {"type": "link", "href": "x", "content": _text("the grid")}]}])
    assert chunk["chunk_text"] == "See the grid"


def test_empty_table_and_formula_are_skipped():
    assert parse([{"id": "t", "type": "table", "content": {"rows": []}},
                  {"id": "m", "type": "math", "props": {"latex": ""}}]) == []
