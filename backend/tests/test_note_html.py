"""AI-written notes rendered as "Heading" / "Unsupported block" (live check
2026-10-23): the tools stored whatever block JSON the model invented. Notes
are now written as HTML and converted here, to the same shapes BlockNote
0.48's own `tryParseHTMLToBlocks` produces (expected values below were taken
from it)."""
from unittest.mock import MagicMock, patch

import pytest

from services.agent.brain_tools import execute_brain_tool
from services.block_chunker import parse
from services.note_html import html_to_blocks, normalize_blocks

P = {"backgroundColor": "default", "textColor": "default", "textAlignment": "left"}


def bare(x):
    if isinstance(x, list):
        return [bare(i) for i in x]
    if isinstance(x, dict):
        return {k: bare(v) for k, v in x.items() if k != "id"}
    return x


def t(text, **styles):
    return {"type": "text", "text": text, "styles": styles}


def test_matches_blocknotes_own_parser():
    html = """<h1>T</h1><h4>Four</h4>
<p>a <strong>b</strong> <em>i</em> <code>c</code> <a href="https://x.com">link</a></p>
<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul><ol><li>n1</li></ol>
<ul><li><input type="checkbox" checked>done</li></ul>
<blockquote>quoted</blockquote><pre><code class="language-python">x = 1\ny</code></pre><hr>
<details><summary>Sum</summary><p>inside</p></details>
<details><summary><h3>Head toggle</h3></summary><p>in2</p></details>"""
    para = lambda c, ch=None: {"type": "paragraph", "props": P, "content": c, "children": ch or []}
    assert bare(html_to_blocks(html)) == [
        {"type": "heading", "props": {**P, "level": 1, "isToggleable": False}, "content": [t("T")], "children": []},
        {"type": "heading", "props": {**P, "level": 4, "isToggleable": False}, "content": [t("Four")], "children": []},
        para([t("a "), t("b", bold=True), t(" "), t("i", italic=True), t(" "), t("c", code=True), t(" "),
              {"type": "link", "href": "https://x.com", "content": [t("link")]}]),
        {"type": "bulletListItem", "props": P, "content": [t("one")], "children": [
            {"type": "bulletListItem", "props": P, "content": [t("nested")], "children": []}]},
        {"type": "bulletListItem", "props": P, "content": [t("two")], "children": []},
        {"type": "numberedListItem", "props": P, "content": [t("n1")], "children": []},
        {"type": "checkListItem", "props": {**P, "checked": True}, "content": [t("done")], "children": []},
        {"type": "quote", "props": {"backgroundColor": "default", "textColor": "default"},
         "content": [t("quoted")], "children": []},
        {"type": "codeBlock", "props": {"language": "python"}, "content": [t("x = 1\ny")], "children": []},
        {"type": "divider", "props": {}, "children": []},
        {"type": "toggleListItem", "props": P, "content": [t("Sum")], "children": [para([t("inside")])]},
        {"type": "heading", "props": {**P, "level": 3, "isToggleable": True}, "content": [t("Head toggle")],
         "children": [para([t("in2")])]},
    ]


def test_table_with_header_row():
    [tb] = html_to_blocks("<table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td></tr></table>")
    assert tb["type"] == "table" and tb["content"]["headerRows"] == 1
    assert tb["content"]["columnWidths"] == [None, None]
    rows = tb["content"]["rows"]
    assert [c["content"] for c in rows[1]["cells"]] == [[t("a")], []]     # short row padded


def test_app_dialect_callout_math_highlight_and_breaks():
    blocks = bare(html_to_blocks(
        '<div data-type="callout" data-callout-type="EXAM"><p>Watch <b>this</b></p></div>'
        '<div data-type="math">E=mc^2</div>'
        '<h2><span data-style-type="backgroundColor" data-value="red">Hot</span></h2>'
        '<p>line one<br>line two</p>'))
    assert blocks[0]["type"] == "callout" and blocks[0]["props"]["calloutType"] == "EXAM"
    assert blocks[0]["children"][0]["content"] == [t("Watch "), t("this", bold=True)]
    assert blocks[1] == {"type": "math", "props": {"latex": "E=mc^2"}, "children": []}
    assert blocks[2]["content"] == [t("Hot", backgroundColor="red")]
    assert blocks[3]["content"] == [t("line one\nline two")]


def test_unsafe_links_and_scripts_are_dropped():
    blocks = html_to_blocks('<p><a href="javascript:alert(1)">x</a></p><script>bad()</script>')
    assert bare(blocks) == [{"type": "paragraph", "props": P, "content": [t("x")], "children": []}]


def test_plain_text_and_loose_inline_become_paragraphs():
    assert [b["content"] for b in html_to_blocks("one\n\ntwo")] == [[t("one")], [t("two")]]
    assert [b["type"] for b in html_to_blocks("intro <b>bold</b><h2>H</h2>tail")] == \
        ["paragraph", "heading", "paragraph"]


def test_every_block_gets_an_id_so_citations_can_point_at_it():
    blocks = html_to_blocks("<h2>A</h2><ul><li>b<ul><li>c</li></ul></li></ul>")
    assert all(b["id"] for b in blocks) and blocks[1]["children"][0]["id"]


# The shapes a model actually sent in the live check.
def test_invented_block_shapes_become_real_blocks():
    out = normalize_blocks([
        {"type": "heading", "text": "Q-learning", "level": 2},
        {"type": "callout", "title": "Key idea", "children": [{"type": "paragraph", "text": "Bootstrap."}]},
        {"type": "details", "summary": "Why", "children": [{"type": "text", "text": "Because."}]},
        {"type": "bullet", "content": "item"},
        {"type": "h3", "content": [{"text": "Bold one", "bold": True}]},
        {"type": "mystery", "text": "kept, not dropped"},
    ])
    kinds = [b["type"] for b in out]
    assert kinds == ["heading", "callout", "toggleListItem", "bulletListItem", "heading", "paragraph"]
    assert out[0]["props"]["level"] == 2 and out[0]["content"] == [t("Q-learning")]
    assert out[1]["children"][0]["content"] == [t("Key idea", bold=True)]
    assert out[1]["children"][1]["content"] == [t("Bootstrap.")]
    assert out[2]["content"] == [t("Why")] and out[2]["children"][0]["type"] == "paragraph"
    assert out[4]["props"]["level"] == 3 and out[4]["content"] == [t("Bold one", bold=True)]
    assert out[5]["content"] == [t("kept, not dropped")]
    assert "Q-learning" in " ".join(c["chunk_text"] for c in parse(out))


def test_real_blocks_pass_through_with_their_ids():
    real = [{"id": "b1", "type": "paragraph", "props": dict(P),
             "content": [t("x"), {"type": "mention", "props": {"noteId": "n2"}}], "children": []},
            {"id": "b2", "type": "interactive", "props": {"title": "Quiz", "html": "<p/>"}, "children": []}]
    assert normalize_blocks(real) == real


@pytest.mark.asyncio
@patch("services.agent.brain_tools.get_supabase")
async def test_create_note_converts_html(mock_supa):
    table = MagicMock()
    mock_supa.return_value.table.return_value = table
    table.insert.return_value.execute.return_value.data = [{"id": "n"}]
    await execute_brain_tool("brain.create_note",
                             args={"title": "T", "html": "<h2>Big idea</h2><p>Body</p>"}, user_id="u")
    payload = table.insert.call_args[0][0]
    assert [b["type"] for b in payload["content"]] == ["heading", "paragraph"]
    assert payload["content_text"] == "Big idea\nBody"


@pytest.mark.asyncio
@patch("services.agent.brain_tools.get_supabase")
async def test_update_note_title_only_keeps_content(mock_supa):
    table = MagicMock()
    mock_supa.return_value.table.return_value = table
    table.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [{"id": "n"}]
    await execute_brain_tool("brain.update_note", args={"id": "n", "title": "New"}, user_id="u")
    assert table.update.call_args[0][0] == {"title": "New"}
    with pytest.raises(ValueError):
        await execute_brain_tool("brain.update_note", args={"id": "n"}, user_id="u")
