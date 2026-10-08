"""ADR-06: update a body in place where possible; rebuild only when the structure changed."""
from tests.notion_sync.conftest import T


def P(text, i, **props):
    return {"id": i, "type": "paragraph", "props": props, "content": [T(text)], "children": []}


def calls_since(world, mark):
    return world.notion.calls[mark:]


def kinds(calls):
    out = {}
    for m, p in calls:
        if m in ("PATCH", "DELETE", "POST") and not p.endswith("/query") and p != "/search":
            key = f"{m} {'children' if p.endswith('/children') else 'block' if '/blocks/' in p else 'page'}"
            out[key] = out.get(key, 0) + 1
    return out


def page_texts(world, n):
    return ["".join(t["text"]["content"] for t in b[b["type"]].get("rich_text", [])) for b in
            world.notion.top_blocks(world.mapping(n)["notion_id"])]


def setup(world, content):
    n = world.add_note(content=content)
    world.send(n)
    return n, [b["id"] for b in world.notion.top_blocks(world.mapping(n)["notion_id"])]


def test_editing_one_paragraph_is_one_patch_and_keeps_its_id(world):
    n, ids = setup(world, [P("a", "1"), P("b", "2"), P("c", "3")])
    n["content"][1] = P("b edited", "2")
    mark = len(world.notion.calls)
    res, _ = world.send(n)
    assert res.items[0].status == "done"
    assert kinds(calls_since(world, mark)) == {"PATCH block": 1, "PATCH page": 1}   # the block + the page properties
    assert page_texts(world, n) == ["a", "b edited", "c"]
    assert [b["id"] for b in world.notion.top_blocks(world.mapping(n)["notion_id"])] == ids   # same blocks


def test_adding_a_block_at_the_end_only_appends(world):
    n, ids = setup(world, [P("a", "1"), P("b", "2")])
    n["content"].append(P("c", "3"))
    mark = len(world.notion.calls)
    world.send(n)
    k = kinds(calls_since(world, mark))
    assert k.get("PATCH children") == 1 and "DELETE block" not in k
    assert page_texts(world, n) == ["a", "b", "c"]
    assert [b["id"] for b in world.notion.top_blocks(world.mapping(n)["notion_id"])][:2] == ids


def test_removing_the_last_block_deletes_only_it(world):
    n, ids = setup(world, [P("a", "1"), P("b", "2"), P("c", "3")])
    n["content"].pop()
    mark = len(world.notion.calls)
    world.send(n)
    assert kinds(calls_since(world, mark)).get("DELETE block") == 1
    assert page_texts(world, n) == ["a", "b"]


def test_inserting_in_the_middle_rebuilds_and_is_still_correct(world):
    n, ids = setup(world, [P("a", "1"), P("c", "3")])
    n["content"].insert(1, {"id": "h", "type": "heading", "props": {"level": 2}, "content": [T("new heading")], "children": []})
    world.send(n)
    assert page_texts(world, n) == ["a", "new heading", "c"]
    assert len(world.mapping(n)["block_index"]["top"]) == 3


def test_changing_a_blocks_type_rebuilds(world):
    n, _ = setup(world, [P("a", "1"), P("b", "2")])
    n["content"][1] = {"id": "2", "type": "quote", "props": {}, "content": [T("b")], "children": []}
    world.send(n)
    assert [b["type"] for b in world.notion.top_blocks(world.mapping(n)["notion_id"])] == ["paragraph", "quote"]


def test_removing_a_colour_really_clears_it(world):
    n, _ = setup(world, [P("a", "1", textColor="red")])
    assert world.notion.top_blocks(world.mapping(n)["notion_id"])[0]["paragraph"]["color"] == "red"
    n["content"][0] = P("a", "1")
    world.send(n)
    assert world.notion.top_blocks(world.mapping(n)["notion_id"])[0]["paragraph"]["color"] == "default"


def test_changed_nested_content_rebuilds_that_page(world):
    tog = {"id": "t", "type": "toggleListItem", "props": {}, "content": [T("t")], "children": [P("inner", "i")]}
    n, _ = setup(world, [P("a", "1"), tog])
    n["content"][1] = {**tog, "children": [P("inner changed", "i")]}
    world.send(n)
    tree = world.notion.tree(world.notion.pages[world.mapping(n)["notion_id"]]["children"])
    assert tree[1]["toggle"]["children"][0]["paragraph"]["rich_text"][0]["text"]["content"] == "inner changed"


def test_an_unchanged_image_is_not_uploaded_again_when_text_changes(world):
    url = "https://files.sb.test/p/pic.png?token=1"
    world.files.blobs[url] = (b"x" * 50, "image/png")
    img = {"id": "im", "type": "image", "props": {"url": url, "name": "pic.png"}, "content": [], "children": []}
    n, _ = setup(world, [P("a", "1"), img])
    ups, fetched = len(world.notion.uploads), len(world.files.fetched)
    n["content"][0] = P("a edited", "1")
    world.send(n)
    assert len(world.notion.uploads) == ups and len(world.files.fetched) == fetched      # the image block was left alone
    assert page_texts(world, n)[0] == "a edited"


def test_a_legacy_index_without_hashes_rebuilds_safely(world):
    n, _ = setup(world, [P("a", "1"), P("b", "2")])
    m = world.mapping(n)
    m["block_index"]["top"] = [{"id": e["id"], "src": e["src"]} for e in m["block_index"]["top"]]    # an M1-era index
    n["content"][0] = P("a2", "1")
    world.send(n)
    assert page_texts(world, n) == ["a2", "b"]


def test_foreign_blocks_are_never_patched_or_deleted_by_a_diff(world):
    n, ids = setup(world, [P("a", "1")])
    pid = world.mapping(n)["notion_id"]
    foreign = world.notion._store_blocks([{"type": "paragraph", "paragraph": {"rich_text": []}}], pid, "page_id")[0]
    world.notion.pages[pid]["children"].append(foreign)
    n["content"][0] = P("a edited", "1")
    res, plan = world.send(n)
    assert plan.items[0].state == "needs_you"                             # held back, as in M4
    assert foreign in world.notion.pages[pid]["children"]


def test_a_parent_with_unchanged_children_is_patched_in_place_children_untouched(world):
    tog = {"id": "t", "type": "toggleListItem", "props": {}, "content": [T("title")], "children": [P("inner", "i")]}
    n, ids = setup(world, [P("a", "1"), tog])
    pid = world.mapping(n)["notion_id"]
    kid_before = world.notion.blocks[ids[1]]["children_ids"][:]
    n["content"][1] = {**tog, "content": [T("title edited")]}
    mark = len(world.notion.calls)
    world.send(n)
    assert kinds(calls_since(world, mark)) == {"PATCH block": 1, "PATCH page": 1}
    assert [b["id"] for b in world.notion.top_blocks(pid)] == ids
    assert world.notion.blocks[ids[1]]["children_ids"] == kid_before
    tree = world.notion.tree(world.notion.pages[pid]["children"])
    assert tree[1]["toggle"]["rich_text"][0]["text"]["content"] == "title edited"
    assert tree[1]["toggle"]["children"][0]["paragraph"]["rich_text"][0]["text"]["content"] == "inner"
