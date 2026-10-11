"""Engine core: create protocol, idempotency, crash recovery, privacy."""
import json

from services.notion_sync.planner import CHANGED, NEW, PRIVATE, UNCHANGED
from tests.notion_sync.conftest import T, note


def page_of(world, n):
    return world.mapping(n)["notion_id"]


def test_first_send_creates_one_sub_page_with_body(world):
    n = world.add_note(title="Hello")
    res, plan = world.send(n)
    assert plan.items[0].state == NEW
    assert res.status == "succeeded" and res.items[0].status == "done"
    m = world.mapping(n)
    assert m["state"] == "synced" and m["local_hash"] and m["notion_id"]
    assert m["notion_parent_id"] == world.notion.root                  # a plain page under the root, no table
    assert world.notion.page_ids_in(world.notion.root) == [m["notion_id"]]
    assert world.notion.pages[m["notion_id"]]["parent"] == {"type": "page_id", "page_id": world.notion.root}
    blocks = world.notion.top_blocks(m["notion_id"])
    assert [b["type"] for b in blocks] == ["paragraph"]
    assert res.items[0].notion_url.endswith(m["notion_id"].replace("-", ""))
    # the run is recorded
    assert world.db.tables["notion_runs"][0]["status"] == "succeeded"
    assert world.db.tables["notion_run_items"][0]["status"] == "done"


def test_second_send_makes_zero_write_calls(world):
    n = world.add_note()
    world.send(n)
    before = len(world.notion.calls)
    plan = world.plan(n)
    assert plan.items[0].state == UNCHANGED and plan.to_dict()["nothing_to_send"]
    res, _ = world.send(n)
    assert len(world.notion.calls) == before          # not even a read
    assert res.items == [] and res.requests == 0


def test_idempotent_across_a_fresh_process(world):
    n = world.add_note()
    world.send(n)
    writes = world.notion.writes()
    world.send(n)                                       # new Engine, new client
    assert world.notion.writes() == writes


def test_changed_note_replaces_only_our_blocks(world):
    n = world.add_note()
    world.send(n)
    n["content"] = [{"id": "p1", "type": "paragraph", "props": {}, "content": [T("changed")], "children": []}]
    plan = world.plan(n)
    assert plan.items[0].state == CHANGED
    res, _ = world.send(n)
    assert res.items[0].status == "done" and res.items[0].action == "update"
    pid = page_of(world, n)
    texts = [b["paragraph"]["rich_text"] for b in world.notion.top_blocks(pid) if b["type"] == "paragraph"]
    assert [t[0]["text"]["content"] for t in texts if t] == ["changed"]
    assert len(world.notion.page_ids_in(world.mapping(n)["notion_parent_id"])) == 1


def test_never_deletes_foreign_blocks(world):
    """A block a person added in Notion is never removed by a normal send: the note is
    held back as 'edited in Notion' instead (M4 gives the three choices)."""
    n = world.add_note()
    world.send(n)
    pid = page_of(world, n)
    foreign = world.notion._store_blocks([{"type": "paragraph", "paragraph": {"rich_text": []}}], pid, "page_id")[0]
    world.notion.pages[pid]["children"].append(foreign)
    n["title"] = "renamed"
    res, plan = world.send(n)
    assert plan.items[0].state == "needs_you" and res.items == []
    assert not [c for c in world.notion.calls if c[0] == "DELETE"]
    assert foreign in world.notion.pages[pid]["children"]


def test_edited_in_notion_blocks_overwrite(world):
    n = world.add_note()
    world.send(n)
    world.notion.human_edit(page_of(world, n))
    n["content"] = [{"id": "p", "type": "paragraph", "props": {}, "content": [T("mine")], "children": []}]
    writes = world.notion.writes()
    res, plan = world.send(n)
    assert plan.items[0].state == "needs_you" and plan.items[0].needs["reason"] == "edited_in_notion"
    assert res.items == [] and world.notion.writes() == writes                 # nothing was touched


def test_engine_refuses_even_if_a_forged_plan_says_go(world):
    n = world.add_note()
    world.send(n)
    world.notion.human_edit(page_of(world, n))
    from services.notion_sync.planner import PlanItem
    res = world.engine().run([PlanItem(n["id"], "x", CHANGED)])
    assert res.items[0].status == "needs_you" and "changed in Notion" in res.items[0].message


def test_private_note_is_blocked_and_never_reaches_notion(world):
    n = world.add_note(sensitivity="private")
    plan = world.plan(n)
    assert plan.items[0].state == PRIVATE
    res, _ = world.send(n)
    assert res.items == [] and world.notion.calls == []


def test_private_note_released_for_one_run(world):
    n = world.add_note(sensitivity="private")
    res, plan = world.send(n, released=frozenset({n["id"]}))
    assert plan.items[0].released and res.items[0].status == "done"
    # next plan without release: blocked again, and it is unchanged -> still private
    assert world.plan(n).items[0].state == PRIVATE


def test_privacy_gate_at_adapter_boundary_even_if_plan_is_wrong(world):
    n = world.add_note(sensitivity="private")
    eng = world.engine()
    from services.notion_sync.planner import PlanItem
    forged = PlanItem(n["id"], "x", NEW)            # a plan that wrongly says "send"
    res = eng.run([forged])
    assert res.items[0].status == "skipped" and world.notion.calls == []


def test_open_and_personal_are_sent(world):
    a, b = world.add_note(sensitivity="open"), world.add_note(sensitivity="personal")
    res, _ = world.send(a, b)
    assert [i.status for i in res.items] == ["done", "done"]
    assert len(world.notion.page_ids_in(world.mapping(a)["notion_parent_id"])) == 2


def test_plain_notes_never_build_a_notes_table(world):
    a, b = world.add_note(), world.add_note()
    world.send(a)
    world.send(b)
    assert world.notion.dbs == {} and world.notion.sources == {}
    assert not [m for m in world.db.tables["notion_mappings"] if m["local_kind"] == "container"]
    assert sorted(world.notion.page_ids_in(world.notion.root)) == sorted([page_of(world, a), page_of(world, b)])


def test_missing_and_deleted_notes(world):
    n = world.add_note(deleted_at="2026-01-01")
    plan = world.plan(n)
    assert plan.items[0].state == "missing"


def test_long_note_with_nesting_and_many_blocks(world):
    kids = [{"id": f"k{i}", "type": "bulletListItem", "props": {}, "content": [T(f"item {i}")], "children": []}
            for i in range(130)]
    deep = {"id": "d0", "type": "toggleListItem", "props": {}, "content": [T("L0")], "children": [
        {"id": "d1", "type": "toggleListItem", "props": {}, "content": [T("L1")], "children": [
            {"id": "d2", "type": "toggleListItem", "props": {}, "content": [T("L2")], "children": [
                {"id": "d3", "type": "paragraph", "props": {}, "content": [T("L3")], "children": []}]}]}]}
    big = {"id": "big", "type": "paragraph", "props": {}, "content": [T("é😀" * 3000)], "children": []}
    n = world.add_note(content=[big, deep, *kids])
    res, _ = world.send(n)
    assert res.items[0].status == "done", res.items[0].message
    pid = page_of(world, n)
    tree = world.notion.tree(world.notion.pages[pid]["children"])
    text = "".join(o["text"]["content"] for o in tree[0]["paragraph"]["rich_text"])
    assert text == "é😀" * 3000                                  # split, never truncated
    assert len(tree) == 2 + 130
    lvl3 = tree[1]["toggle"]["children"][0]["toggle"]["children"][0]["toggle"]["children"][0]
    assert lvl3["paragraph"]["rich_text"][0]["text"]["content"] == "L3"


# ---- crash recovery: the create protocol --------------------------------------------------

def test_crash_after_create_timeout_adopts_existing_page_no_duplicate(world):
    n = world.add_note(title="Lost answer")
    world.send(world.add_note())                       # a first send, so the fault hits this note's create
    world.notion.fail("POST /pages", "timeout_after")  # row IS created, but the answer is lost
    res, _ = world.send(n)
    assert res.items[0].status == "failed" and "check what arrived" in res.items[0].message
    m = world.mapping(n)
    assert m["state"] == "creating" and not m.get("notion_id")      # written BEFORE the create
    res2, plan2 = world.send(n)                        # next send reconciles
    assert plan2.items[0].state == NEW
    assert res2.items[0].status == "done"
    titles = [world.notion._title_of(p) for p in world.notion.page_ids_in(world.notion.root)]
    assert titles.count("Lost answer") == 1            # exactly one page for the note


def test_crash_before_create_creates_it_next_time(world):
    n = world.add_note()
    world.send(world.add_note())
    world.notion.fail("POST /pages", "timeout_before")
    world.send(n)
    res2, _ = world.send(n)
    assert res2.items[0].status == "done"
    ds = world.mapping(n)["notion_parent_id"]
    assert len(world.notion.page_ids_in(ds)) == 2


def test_create_is_never_retried_blindly(world):
    n = world.add_note()
    world.send(world.add_note())
    world.notion.fail("POST /pages", "500")
    before = sum(1 for m, p in world.notion.calls if (m, p) == ("POST", "/pages"))
    res, _ = world.send(n)
    after = sum(1 for m, p in world.notion.calls if (m, p) == ("POST", "/pages"))
    assert after - before == 1 and res.items[0].status == "failed"


def test_same_title_pages_are_never_adopted(world):
    """A page someone made in Notion, or another note's page, with the same title is left alone."""
    a = world.add_note(title="Same")
    world.send(a)
    theirs = world.notion._new_page({"type": "page_id", "page_id": world.notion.root}, "Same")
    world.notion._register_child_page(theirs, world.notion.root)
    b = world.add_note(title="Same")
    res, _ = world.send(b)
    assert res.items[0].status == "done"
    assert page_of(world, b) not in (page_of(world, a), theirs)
    assert len(world.notion.page_ids_in(world.notion.root)) == 3


def _note_250(world):
    kids = [{"id": f"k{i}", "type": "paragraph", "props": {}, "content": [T(f"p{i}")], "children": []}
            for i in range(250)]
    n = world.add_note(content=kids)
    world.send(world.add_note())                       # warm the container
    return n


def _fail_nth_append(world, nth, mode, times=1):
    """Arm a fault on the nth PATCH .../children request from now."""
    import httpx
    state = {"n": 0}
    orig = world.notion.handle

    def handle(req):
        if req.method == "PATCH" and req.url.path.endswith("/children"):
            state["n"] += 1
            if state["n"] == nth:
                world.notion.fail("PATCH /blocks/.*/children", mode, times)
        return orig(req)
    world.notion.transport = httpx.MockTransport(handle)
    return orig


def test_append_timeout_after_apply_is_recognised_not_duplicated(world):
    n = _note_250(world)
    _fail_nth_append(world, 2, "timeout_after")          # 2nd chunk lands, the answer is lost
    res, _ = world.send(n)
    assert res.items[0].status == "done"
    pid = world.mapping(n)["notion_id"]
    assert len(world.notion.pages[pid]["children"]) == 250
    assert len(world.mapping(n)["block_index"]["top"]) == 250


def test_append_timeout_before_apply_is_resent_once(world):
    n = _note_250(world)
    _fail_nth_append(world, 2, "timeout_before")
    res, _ = world.send(n)
    assert res.items[0].status == "done"
    assert len(world.notion.pages[world.mapping(n)["notion_id"]]["children"]) == 250


def test_failed_body_resumes_without_duplicates(world):
    n = _note_250(world)
    orig = _fail_nth_append(world, 2, "500", times=2)      # 2nd chunk fails twice: run gives up
    res, _ = world.send(n)
    assert res.items[0].status == "failed"
    m = world.mapping(n)
    assert m["state"] == "failed" and not m.get("local_hash")
    pid = m["notion_id"]
    assert len(world.notion.pages[pid]["children"]) == 100       # first chunk is on the page
    import httpx
    world.notion.transport = httpx.MockTransport(orig)
    res2, _ = world.send(n)
    assert res2.items[0].status == "done"
    assert len(world.notion.pages[pid]["children"]) == 250       # replaced, no duplicates


def test_429_is_honoured_and_retried(world):
    n = world.add_note()
    world.notion.fail("POST /pages", "429")
    res, _ = world.send(n)
    assert res.items[0].status == "done"
    assert 1.0 in world.sleeps                            # Retry-After honoured


def test_token_revoked_is_needs_you(world):
    import httpx
    n = world.add_note()
    world.notion.transport = httpx.MockTransport(lambda r: httpx.Response(
        401, json={"object": "error", "status": 401, "code": "unauthorized", "message": "x"}))
    res, _ = world.send(n)
    assert res.items[0].status == "needs_you" and "Reconnect" in res.items[0].message


def test_paused_connection_sends_nothing(world):
    n = world.add_note()
    world.db.tables["notion_connections"][0]["status"] = "paused"
    eng = world.engine()
    from services.notion_sync.planner import PlanItem
    res = eng.run([PlanItem(n["id"], "x", NEW)])
    assert res.items[0].status == "skipped" and world.notion.calls == []


def test_losses_are_in_the_plan(world):
    n = world.add_note(content=[
        {"id": "h", "type": "heading", "props": {"level": 5}, "content": [T("small")], "children": []},
        {"id": "t", "type": "flashcard", "props": {}, "content": [], "children": []}])
    plan = world.plan(n)
    codes = {loss["code"] for loss in plan.items[0].losses}
    assert {"heading_level", "unsupported_block"} <= codes
    assert plan.items[0].fidelity == "lossy"
