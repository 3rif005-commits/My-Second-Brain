"""Writers: unit tests and golden files (one input + expected Notion payload per type)."""
import json
from pathlib import Path

import pytest

from services.notion_sync import registry
from services.notion_sync.notion.languages import NOTION_LANGUAGES, map_language
from services.notion_sync.notion.writers import WRITERS, write_blocks
from services.portable import ir
from services.portable.losses import fidelity
from tests.notion_sync.conftest import T

GOLDEN = Path(__file__).parent / "golden"


def conv(*blocks):
    return write_blocks(registry.read_blocks(list(blocks)))


def blk(type_, content=None, props=None, children=None, id_="b"):
    return {"id": id_, "type": type_, "props": props or {}, "content": content if content is not None else [],
            "children": children or []}


def rt(r, i=0):
    return r.blocks[0][r.blocks[0]["type"]]["rich_text"][i]


def test_paragraph_annotations_and_colours():
    r = conv(blk("paragraph", [T("x", bold=True, italic=True, strike=True, underline=True, code=True,
                                  textColor="red")]))
    ann = rt(r)["annotations"]
    assert ann == {"bold": True, "italic": True, "strikethrough": True, "underline": True,
                   "code": True, "color": "red"}
    assert r.losses == []


def test_background_wins_over_text_colour_and_is_a_loss():
    r = conv(blk("paragraph", [T("x", textColor="red", backgroundColor="blue")]))
    assert rt(r)["annotations"]["color"] == "blue_background"
    assert [loss.code for loss in r.losses] == ["colour_and_highlight"]


def test_block_colour():
    r = conv(blk("quote", [T("x")], {"backgroundColor": "yellow"}))
    assert r.blocks[0]["quote"]["color"] == "yellow_background"


def test_link_ok_and_dropped():
    ok = conv(blk("paragraph", [{"type": "link", "href": "https://a.b/c", "content": [T("go")]}]))
    assert rt(ok)["text"]["link"] == {"url": "https://a.b/c"}
    bad = conv(blk("paragraph", [{"type": "link", "href": "/brain/123", "content": [T("go")]}]))
    assert "link" not in rt(bad)["text"] and bad.losses[0].code == "link_dropped"
    long = conv(blk("paragraph", [{"type": "link", "href": "https://a.b/" + "x" * 2100, "content": [T("go")]}]))
    assert long.losses[0].code == "link_dropped"


def test_headings():
    for lvl, want in ((1, "heading_1"), (3, "heading_3"), (4, "heading_4")):
        r = conv(blk("heading", [T("h")], {"level": lvl}))
        assert r.blocks[0]["type"] == want and r.losses == []
    r = conv(blk("heading", [T("h")], {"level": 6}))
    assert r.blocks[0]["type"] == "heading_4" and r.losses[0].code == "heading_level"
    assert fidelity(r.losses) == "approximated"


def test_toggleable_heading_keeps_children_inside():
    r = conv(blk("heading", [T("h")], {"level": 2, "isToggleable": True}, [blk("paragraph", [T("in")], id_="c")]))
    h = r.blocks[0]["heading_2"]
    assert h["is_toggleable"] is True and h["children"][0]["type"] == "paragraph"


def test_plain_heading_with_children_flattens_them():
    r = conv(blk("heading", [T("h")], {"level": 2}, [blk("paragraph", [T("in")], id_="c")]))
    assert [b["type"] for b in r.blocks] == ["heading_2", "paragraph"]
    assert "children" not in r.blocks[0]["heading_2"]
    assert r.losses[0].code == "children_flattened"


def test_lists_todo_toggle_with_children():
    r = conv(blk("bulletListItem", [T("a")], children=[blk("numberedListItem", [T("b")], {"start": 4}, id_="n")]))
    b = r.blocks[0]
    assert b["type"] == "bulleted_list_item"
    nested = b["bulleted_list_item"]["children"][0]["numbered_list_item"]
    assert "list_start_index" not in nested             # Notion rejects it (verified live)
    assert [loss.code for loss in r.losses] == ["list_start"]
    assert conv(blk("checkListItem", [T("a")], {"checked": True})).blocks[0]["to_do"]["checked"] is True
    assert conv(blk("toggleListItem", [T("a")])).blocks[0]["type"] == "toggle"


def test_divider_and_quote():
    assert conv(blk("divider")).blocks == [{"type": "divider", "divider": {}}]
    assert conv(blk("quote", [T("q")])).blocks[0]["type"] == "quote"


def test_alignment_is_a_declared_loss():
    r = conv(blk("paragraph", [T("x")], {"textAlignment": "center"}))
    assert [loss.code for loss in r.losses] == ["text_align"] and fidelity(r.losses) == "lossy"


def test_code_language_mapping_is_always_valid():
    for lang in ["python", "js", "ts", "JSX", "tsx", "c++", "cpp", "weird-lang", "", "text", "shell", "rust", "latex"]:
        r = conv(blk("codeBlock", [T("x")], {"language": lang}))
        assert r.blocks[0]["code"]["language"] in NOTION_LANGUAGES, lang


def test_code_language_exact_close_unknown():
    assert conv(blk("codeBlock", [T("x")], {"language": "python"})).losses == []
    close = conv(blk("codeBlock", [T("x")], {"language": "jsx"}))
    assert close.blocks[0]["code"]["language"] == "javascript" and close.losses[0].code == "code_language"
    assert close.blocks[0]["code"]["caption"][0]["text"]["content"] == "lang: jsx"
    unk = conv(blk("codeBlock", [T("x")], {"language": "cobol"}))
    assert unk.blocks[0]["code"]["language"] == "plain text"


def test_long_code_is_split_never_truncated():
    code = "x" * 450_000
    r = conv(blk("codeBlock", [T(code)], {"language": "python"}))
    assert len(r.blocks) == 3
    got = "".join(o["text"]["content"] for b in r.blocks for o in b["code"]["rich_text"])
    assert got == code and r.losses[0].code == "long_block_split"


def test_long_paragraph_over_100_objects_continues_in_following_paragraphs():
    runs = [T("a", bold=bool(i % 2)) for i in range(250)]       # 250 differing runs
    r = conv(blk("paragraph", runs))
    assert len(r.blocks) == 3 and r.losses[0].code == "long_block_split"
    total = sum(len(b["paragraph"]["rich_text"]) for b in r.blocks)
    assert total == 250


def test_opaque_writer_keeps_text_marker_and_raw_json():
    r = conv(blk("flashcard", [T("front")], {"back": "b"}))
    types = [b["type"] for b in r.blocks]
    assert types == ["paragraph", "callout", "toggle"]
    raw = r.blocks[2]["toggle"]["children"][0]["code"]["rich_text"][0]["text"]["content"]
    assert json.loads(raw)["props"] == {"back": "b"}
    assert any(loss.code == "unsupported_block" for loss in r.losses)


def test_missing_writer_degrades_to_opaque():
    b = ir.Block("embed", inline=[ir.Text("hi")])         # no writer yet
    r = write_blocks([b])
    assert r.blocks[1]["type"] == "callout" and r.losses[-1].code == "unsupported_block"


def test_writer_exception_becomes_opaque_mapper_error(monkeypatch):
    class Boom:
        handles = "ir:paragraph"
        version = 1

        def write(self, node, ctx):
            raise RuntimeError("boom")
    monkeypatch.setitem(WRITERS, "ir:paragraph", Boom())
    r = write_blocks([ir.Block("paragraph", inline=[ir.Text("keep")])])
    assert r.losses[-1].code == "mapper_error" and r.blocks[0]["paragraph"]["rich_text"][0]["text"]["content"] == "keep"


def test_inline_equation():
    r = conv(blk("paragraph", [{"type": "inlineMath", "props": {"latex": "x^2"}}]))
    assert rt(r) == {"type": "equation", "equation": {"expression": "x^2"}}


def test_every_writer_has_a_version_and_handles():
    for h, w in WRITERS.items():
        assert h == w.handles and isinstance(w.version, int)


# ---- golden files: input BlockNote -> expected IR -> expected Notion payload -------------------

def golden_cases():
    return sorted(p.name.removesuffix(".input.json") for p in GOLDEN.glob("*.input.json"))


@pytest.mark.parametrize("name", golden_cases())
def test_golden(name):
    src = json.loads((GOLDEN / f"{name}.input.json").read_text())
    blocks = registry.read_blocks(src)
    want_ir = json.loads((GOLDEN / f"{name}.ir.json").read_text())
    assert [b.to_dict() for b in blocks] == want_ir
    want = json.loads((GOLDEN / f"{name}.notion.json").read_text())
    assert write_blocks(blocks).blocks == want


def test_goldens_exist_for_every_m1_block_type():
    have = set(golden_cases())
    assert {"paragraph", "heading", "bullet_list", "numbered_list", "check_list", "toggle_list",
            "quote", "code", "divider", "inline_styles", "opaque"} <= have
