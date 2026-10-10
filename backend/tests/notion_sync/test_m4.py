"""M4: protection against edits made in Notion; Overwrite / Skip / Keep both; per-item pause."""
from services.notion_sync.planner import CHANGED, NEEDS_YOU, NEW, PAUSED, UNCHANGED
from tests.notion_sync.conftest import T


def para(text, i="p"):
    return [{"id": i, "type": "paragraph", "props": {}, "content": [T(text)], "children": []}]


def texts(world, pid):
    return ["".join(t["text"]["content"] for t in b[b["type"]]["rich_text"])
            for b in world.notion.top_blocks(pid) if b["type"] == "paragraph"]


def edited_note(world, mine="mine"):
    n = world.add_note(content=para("original"))
    world.send(n)
    pid = world.mapping(n)["notion_id"]
    world.notion._store_blocks([{"type": "paragraph", "paragraph": {"rich_text": [
        {"type": "text", "text": {"content": "typed in Notion"}}]}}], pid, "page_id")
    world.notion.pages[pid]["children"] += [b for b in world.notion.blocks if world.notion.blocks[b].get("parent", {}).get("id") == pid
                                            and b not in world.notion.pages[pid]["children"]]
    world.notion.human_edit(pid)
    n["content"] = para(mine)
    return n, pid


def test_edited_in_notion_lands_in_needs_you_with_a_diff(world):
    n, pid = edited_note(world)
    it = world.plan(n).items[0]
    assert it.state == NEEDS_YOU and it.needs["reason"] == "edited_in_notion"
    assert it.needs["foreign_blocks"] == 1 and it.needs["edited_at"]
    ops = {d["op"] for d in it.needs["diff"]}
    assert {"notion", "ours"} <= ops
    assert any(d["op"] == "notion" and "typed in Notion" in d["text"] for d in it.needs["diff"])
    assert any(d["op"] == "ours" and d["text"] == "mine" for d in it.needs["diff"])


def test_skip_is_the_default_and_makes_no_writes(world):
    n, pid = edited_note(world)
    writes = world.notion.writes()
    res, plan = world.send(n)
    assert res.items == [] and world.notion.writes() == writes
    assert world.plan(n).items[0].state == NEEDS_YOU                     # it keeps asking


def test_overwrite_replaces_everything_including_what_was_typed_in_notion(world):
    n, pid = edited_note(world)
    plan = world.plan(n)
    res, _ = (lambda e, p: (e.run(p.items), p))(*(lambda eng: (eng, __import__("services.notion_sync.planner", fromlist=["x"]).plan_scope(
        world.db, eng.conn, eng.adapter, note_ids=[n["id"]], resolutions={n["id"]: "overwrite"})))(world.engine()))
    assert res.items[0].status == "done"
    assert texts(world, pid) == ["mine"]
    assert world.plan(n).items[0].state == UNCHANGED


def run_with(world, n, resolution):
    from services.notion_sync.planner import plan_scope
    eng = world.engine()
    plan = plan_scope(world.db, eng.conn, eng.adapter, note_ids=[n["id"]], resolutions={n["id"]: resolution})
    return eng.run(plan.items), plan


def test_keep_both_sends_a_copy_and_never_touches_the_edited_original(world):
    n, pid = edited_note(world)
    before = texts(world, pid)
    res, plan = run_with(world, n, "copy")
    assert res.items[0].status == "done"
    new_pid = world.mapping(n)["notion_id"]
    assert new_pid != pid
    assert texts(world, pid) == before                                  # original untouched
    assert texts(world, new_pid) == ["mine"]
    assert world.notion._title_of(new_pid).startswith("A note (from Second Brain, ")
    detached = [m for m in world.db.tables["notion_mappings"] if m["state"] == "detached"]
    assert len(detached) == 1 and detached[0]["notion_id"] == pid
    assert world.plan(n).items[0].state == UNCHANGED                    # the copy is now the mirror
    assert world.send(n)[0].items == []


def test_keep_both_does_not_adopt_the_original_as_the_copy(world):
    n, pid = edited_note(world)
    run_with(world, n, "copy")
    rows = world.notion.page_ids_in(world.mapping(n)["notion_parent_id"])
    assert len(rows) == 2 and pid in rows


def test_unreachable_page_needs_you_and_recreate_makes_a_new_one(world):
    n = world.add_note()
    world.send(n)
    pid = world.mapping(n)["notion_id"]
    world.notion.pages[pid]["in_trash"] = True
    n["title"] = "renamed"
    it = world.plan(n).items[0]
    assert it.state == NEEDS_YOU and it.needs["reason"] == "unreachable"
    res, _ = run_with(world, n, "recreate")
    assert res.items[0].status == "done" and world.mapping(n)["notion_id"] != pid


def test_forget_removes_only_our_record(world):
    n = world.add_note()
    world.send(n)
    pid = world.mapping(n)["notion_id"]
    world.notion.pages[pid]["in_trash"] = True
    n["title"] = "renamed"
    writes = world.notion.writes()
    res, _ = run_with(world, n, "forget")
    assert res.items[0].action == "forget" and world.mapping(n) is None and world.notion.writes() == writes


def test_a_collection_edited_in_notion_is_held_back_too(world):
    a = world.add_collection("Physics")
    n = world.add_note(collection_id=a["id"])
    world.send(n)
    world.notion.human_edit(world.mapping(a)["notion_id"])
    a["name"] = "Physics II"
    plan = world.plan(n)
    col = next(i for i in plan.items if i.kind == "collection")
    assert col.state == NEEDS_YOU
    res, _ = world.send(n)
    assert not any(i.kind == "collection" for i in res.items)
    assert world.notion._title_of(world.mapping(a)["notion_id"]) == "Physics"


def test_our_own_sub_pages_and_databases_are_not_foreign_blocks(world):
    a = world.add_collection("Physics")
    n = world.add_note(collection_id=a["id"])
    world.send(n)
    a["description"] = "now described"
    plan = world.plan(n)
    assert next(i for i in plan.items if i.kind == "collection").state == CHANGED


def test_a_later_edit_by_our_bot_does_not_hide_a_block_added_by_a_person(world):
    n, pid = edited_note(world)
    world.notion.pages[pid]["last_edited_by"] = {"object": "user", "id": "bot-0000"}      # masked
    it = world.plan(n).items[0]
    assert it.state == NEEDS_YOU and it.needs["foreign_blocks"] == 1


def test_pause_mirroring_for_one_note(world):
    n = world.add_note()
    world.send(n)
    world.mapping(n)["paused"] = True
    n["title"] = "renamed"
    plan = world.plan(n)
    assert plan.items[0].state == PAUSED and world.send(n)[0].items == []
