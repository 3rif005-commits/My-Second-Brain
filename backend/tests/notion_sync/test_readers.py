"""Unit tests for every M1 reader (BlockNote -> IR)."""
from services.notion_sync import registry
from services.portable import ir


def T(text, **styles):
    return {"type": "text", "text": text, "styles": styles}


def blk(type_, content=None, props=None, children=None, id_="b1"):
    return {"id": id_, "type": type_, "props": props or {}, "content": content if content is not None else [],
            "children": children or []}


def read1(src):
    out = registry.read_block(src)
    assert len(out) == 1
    return out[0]


def test_paragraph_with_marks_and_merge():
    b = read1(blk("paragraph", [T("a", bold=True), T("b", bold=True), T("c")]))
    assert b.type == "paragraph"
    assert [(t.text, t.marks) for t in b.inline] == [("ab", {"bold": True}), ("c", {})]
    assert b.src_id == "b1"


def test_all_inline_marks_and_colours():
    b = read1(blk("paragraph", [T("x", bold=True, italic=True, underline=True, strike=True,
                                  code=True, textColor="red", backgroundColor="blue")]))
    assert b.inline[0].marks == {"bold": True, "italic": True, "underline": True,
                                 "strike": True, "code": True, "color": "red", "bg": "blue"}


def test_default_colours_are_not_marks():
    b = read1(blk("paragraph", [T("x", textColor="default")]))
    assert b.inline[0].marks == {}


def test_link_keeps_inner_styles():
    b = read1(blk("paragraph", [{"type": "link", "href": "https://a.b", "content": [T("go", bold=True)]}]))
    t = b.inline[0]
    assert (t.text, t.link, t.marks) == ("go", "https://a.b", {"bold": True})


def test_heading_levels_and_toggleable():
    for lvl in (1, 4, 6):
        assert read1(blk("heading", [T("h")], {"level": lvl})).attrs["level"] == lvl
    h = read1(blk("heading", [T("h")], {"level": 2, "isToggleable": True}, [blk("paragraph", [T("in")], id_="c")]))
    assert h.attrs["toggleable"] and h.children[0].type == "paragraph"


def test_heading_bad_level_defaults_to_1():
    assert read1(blk("heading", [T("h")], {"level": 9})).attrs["level"] == 1


def test_lists_todo_toggle_nesting():
    assert read1(blk("bulletListItem", [T("a")])).attrs == {"style": "bullet"}
    n = read1(blk("numberedListItem", [T("a")], {"start": 3}))
    assert n.type == "list_item" and n.attrs == {"style": "numbered", "start": 3}
    assert "start" not in read1(blk("numberedListItem", [T("a")], {"start": 1})).attrs
    assert read1(blk("checkListItem", [T("a")], {"checked": True})).attrs["checked"] is True
    assert read1(blk("checkListItem", [T("a")])).attrs["checked"] is False
    t = read1(blk("toggleListItem", [T("a")], children=[blk("bulletListItem", [T("k")], id_="k")]))
    assert t.type == "toggle" and t.children[0].type == "list_item"


def test_quote_divider():
    assert read1(blk("quote", [T("q")])).type == "quote"
    assert read1(blk("divider")).type == "divider"


def test_code_block_plain_text_and_language():
    b = read1(blk("codeBlock", [T("print(1)\nx")], {"language": "python"}))
    assert b.type == "code" and b.attrs["language"] == "python"
    assert b.inline[0].text == "print(1)\nx" and b.inline[0].marks == {}


def test_block_colour_and_alignment_attrs():
    b = read1(blk("paragraph", [T("x")], {"textColor": "red", "backgroundColor": "default", "textAlignment": "center"}))
    assert b.attrs == {"color": "red", "align": "center"}


def test_unknown_type_becomes_opaque_with_loss_and_never_throws():
    b = read1(blk("flashcard", [T("front")], {"back": "b"}))
    assert b.type == "opaque" and b.attrs["source_type"] == "flashcard"
    assert b.attrs["raw"]["props"] == {"back": "b"}
    assert b.inline[0].text == "front"
    assert b.losses[0].code == "unsupported_block"


def test_garbage_inputs_never_throw():
    for junk in (None, 5, "x", [], {"type": None}, {"type": "paragraph", "content": 7},
                 {"type": "paragraph", "content": [None, 3, {"type": "weird"}]},
                 {"type": "heading", "props": None}):
        out = registry.read_block(junk)
        assert out and all(isinstance(b, ir.Block) for b in out)


def test_reader_exception_becomes_opaque_mapper_error(monkeypatch):
    class Boom:
        handles = "blocknote:paragraph"
        version = 1

        def read(self, src, ctx):
            raise RuntimeError("boom")

    registry._load()
    monkeypatch.setitem(registry.READERS, "blocknote:paragraph", Boom())
    b = read1(blk("paragraph", [T("keep me")]))
    assert b.type == "opaque" and b.losses[0].code == "mapper_error" and b.inline[0].text == "keep me"


def test_mention_and_inline_math():
    src = blk("paragraph", [T("see "), {"type": "mention", "props": {"noteId": "n-1", "noteName": "Other"}},
                             {"type": "inlineMath", "props": {"latex": "x^2"}}])
    b = read1(src)
    men = [i for i in b.inline if isinstance(i, ir.Mention)]
    assert len(men) == 1 and men[0].target == ir.Ref("note", "n-1") and men[0].label == "Other"
    assert any(isinstance(i, ir.Equation) and i.latex == "x^2" for i in b.inline)
    assert b.losses == []                          # whether it can be a real link is the destination's call


def test_mention_without_a_note_id_is_text():
    b = read1(blk("paragraph", [{"type": "mention", "props": {"noteName": "Ghost"}}]))
    assert b.inline[0].text == "@Ghost"


def test_hash_is_stable_for_same_note():
    from services.portable.canonical import digest
    note = [blk("paragraph", [T("a", bold=True)]), blk("divider", id_="d")]
    assert digest([b.to_dict() for b in registry.read_blocks(note)]) == \
        digest([b.to_dict() for b in registry.read_blocks(note)])
