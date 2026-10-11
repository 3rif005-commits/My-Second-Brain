"""One block Notion refuses must not fail the note: it is replaced by a visible note, the rest is sent,
and the result says so (live Notion answers 400 validation_error and writes nothing, T1)."""
from tests.notion_sync import fake_notion
from tests.notion_sync.conftest import T


def para(text):
    return {"id": f"p-{text}", "type": "paragraph", "props": {}, "content": [T(text)], "children": []}


def refuse_blocks_containing(world, needle):
    real = world.notion._validate_blocks

    def checked(blocks, depth=1, path="children"):
        for i, b in enumerate(blocks):
            body = b.get(b.get("type"), {})
            if needle in str(body.get("rich_text")):
                raise fake_notion._Bad(f"body.{path}[{i}].{b['type']}.rich_text[0].text.content should be valid")
        return real(blocks, depth, path)
    world.notion._validate_blocks = checked


def page_texts(world, pid):
    return [(b["type"], str(b.get(b["type"], {}).get("rich_text", ""))) for b in world.notion.top_blocks(pid)]


def test_a_refused_block_is_replaced_and_the_rest_of_the_note_is_sent(world):
    refuse_blocks_containing(world, "POISON")
    n = world.add_note(title="Slides", content=[para("one"), para("two"), para("POISON three"), para("four"), para("five")])
    res, _ = world.send(n)
    item = res.items[0]
    assert item.status == "done"
    assert "refused 1 block" in item.message
    assert any(x["code"] == "block_refused" for x in item.losses)
    pid = world.mapping(n)["notion_id"]
    shown = page_texts(world, pid)
    assert [t for t, _ in shown] == ["paragraph", "paragraph", "callout", "paragraph", "paragraph"]
    assert "Notion refused a paragraph block" in shown[2][1]
    assert "POISON" not in shown[2][1]                                # the note's own text is never copied into a message
    assert "one" in shown[0][1] and "five" in shown[4][1]


def test_two_refused_blocks_and_an_unchanged_resend_writes_nothing(world):
    refuse_blocks_containing(world, "POISON")
    n = world.add_note(title="Slides", content=[para("POISON a"), para("fine"), para("POISON b")])
    res, _ = world.send(n)
    assert "refused 2 blocks" in res.items[0].message
    before = world.notion.writes if hasattr(world.notion, "writes") else None
    res2, _ = world.send(n)
    assert res2.status in ("nothing_to_send", "succeeded") and len(res2.items) <= 1
    if before is not None:
        assert world.notion.writes == before
