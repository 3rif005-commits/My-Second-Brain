"""M3: hierarchy (tree of databases), note properties, mentions, moves, deletes → archive."""
from services.notion_sync.planner import CHANGED, DELETED, NEW, PRIVATE, UNCHANGED
from tests.notion_sync.conftest import T


def mention(nid, name):
    return {"type": "mention", "props": {"noteId": nid, "noteName": name}}


def page_title(world, pid):
    return world.notion._title_of(pid)


def children_titles(world, pid):
    return [(b["type"], (b.get("child_page") or b.get("child_database") or {}).get("title"))
            for b in world.notion.top_blocks(pid)]


def test_note_in_nested_collection_builds_the_tree(world):
    a = world.add_collection("Physics", icon="⚛️")
    b = world.add_collection("Optics", parent=a)
    n = world.add_note(title="Lenses", collection_id=b["id"])
    plan = world.plan(n)
    assert [(i.kind, i.title, i.state) for i in plan.items] == [
        ("collection", "Physics", NEW), ("collection", "Optics", NEW), ("note", "Lenses", NEW)]
    assert plan.items[2].path == "Physics › Optics"
    res, _ = world.send(n)
    assert [i.status for i in res.items] == ["done"] * 3
    root = world.notion.root
    assert children_titles(world, root) == [("child_page", "Physics")]
    phys = world.mapping(a)["notion_id"]
    assert world.notion.pages[phys]["icon"] == {"type": "emoji", "emoji": "⚛️"}
    assert ("child_page", "Optics") in children_titles(world, phys)
    optics = world.mapping(b)["notion_id"]
    assert [t for t, _ in children_titles(world, optics)] == ["child_database"]
    ds = world.mapping(n)["notion_parent_id"]
    assert world.notion.sources[ds]["db"] == world.notion.blocks[
        next(x for x in world.notion.pages[optics]["children"] if world.notion.blocks[x]["type"] == "child_database")]["id"]
    assert world.notion.page_ids_in(ds) == [world.mapping(n)["notion_id"]]


def test_second_send_of_a_tree_makes_zero_writes(world):
    a = world.add_collection("Physics")
    n = world.add_note(collection_id=a["id"])
    world.send(n)
    writes = world.notion.writes()
    plan = world.plan(n)
    assert all(i.state == UNCHANGED for i in plan.items) and plan.to_dict()["nothing_to_send"]
    res, _ = world.send(n)
    assert res.items == [] and world.notion.writes() == writes


def test_send_a_collection_with_everything_inside(world):
    a = world.add_collection("Physics")
    b = world.add_collection("Optics", parent=a)
    n1 = world.add_note(title="One", collection_id=a["id"])
    n2 = world.add_note(title="Two", collection_id=b["id"])
    other = world.add_note(title="Elsewhere")
    plan = world.plan(collections=[a])
    assert {i.title for i in plan.items} == {"Physics", "Optics", "One", "Two"}
    res, _ = world.send(collections=[a])
    assert all(i.status == "done" for i in res.items)
    assert world.mapping(other) is None
    assert world.mapping(n1)["notion_parent_id"] != world.mapping(n2)["notion_parent_id"]


def test_collection_description_is_a_paragraph_before_the_notes_database(world):
    a = world.add_collection("Physics", description="All about forces")
    n = world.add_note(collection_id=a["id"])
    world.send(n)
    kids = world.notion.top_blocks(world.mapping(a)["notion_id"])
    assert [b["type"] for b in kids] == ["paragraph", "child_database"]
    assert kids[0]["paragraph"]["rich_text"][0]["text"]["content"] == "All about forces"


def test_rename_and_icon_change_update_the_page_in_place(world):
    a = world.add_collection("Physics")
    n = world.add_note(collection_id=a["id"])
    world.send(n)
    pid = world.mapping(a)["notion_id"]
    a["name"], a["icon"] = "Physics II", "🔭"
    res, plan = world.send(n)
    assert plan.items[0].state == CHANGED and res.items[0].action == "update"
    assert page_title(world, pid) == "Physics II" and world.notion.pages[pid]["icon"]["emoji"] == "🔭"
    assert world.mapping(a)["notion_id"] == pid


def test_moving_a_collection_moves_its_page(world):
    a, b = world.add_collection("A"), world.add_collection("B")
    c = world.add_collection("C", parent=a)
    n = world.add_note(collection_id=c["id"])
    world.send(n)
    cid = world.mapping(c)["notion_id"]
    c["parent_id"] = b["id"]
    res, _ = world.send(n)
    assert all(i.status == "done" for i in res.items)
    assert world.notion.pages[cid]["parent"]["page_id"] == world.mapping(b)["notion_id"]
    assert ("child_page", "C") not in children_titles(world, world.mapping(a)["notion_id"])


def test_moving_a_note_between_collections_uses_the_move_api_no_duplicate(world):
    a, b = world.add_collection("A"), world.add_collection("B")
    n = world.add_note(collection_id=a["id"])
    world.send(n)
    pid = world.mapping(n)["notion_id"]
    n["collection_id"] = b["id"]
    plan = world.plan(n)
    assert next(i for i in plan.items if i.kind == "note").moved is True
    res, _ = world.send(n)
    assert all(i.status == "done" for i in res.items)
    ds_b = world.mapping(b)["notion_id"]
    assert world.mapping(n)["notion_id"] == pid                      # same page, moved
    assert world.notion.pages[pid]["parent"]["database_id"] in world.notion.dbs
    assert world.notion.page_ids_in(world.mapping(n)["notion_parent_id"]) == [pid]
    assert len([p for p in world.notion.pages.values() if p["parent"].get("type") == "data_source_id"]) == 1


def test_note_properties_are_real_columns(world):
    n = world.add_note(title="Props", topics=["optics", "a,b"], mastery_status="learning", source_type="pdf",
                       source_url="https://x.org/a.pdf", is_favorited=True, sensitivity="open",
                       created_at="2026-10-01T10:00:00+00:00", updated_at="2026-10-02T10:00:00+00:00")
    res, plan = world.send(n)
    props = world.notion.pages[world.mapping(n)["notion_id"]]["properties"]
    assert [o["name"] for o in props["Topics"]["multi_select"]] == ["optics", "a;b"]
    assert props["Mastery"]["select"]["name"] == "Learning" and props["Source URL"]["url"] == "https://x.org/a.pdf"
    assert props["Favorite"]["checkbox"] is True and props["Privacy"]["select"]["name"] == "Open"
    assert props["Created in Second Brain"]["date"]["start"].startswith("2026-10-01")
    assert "topic_adjusted" in {loss["code"] for loss in plan.items[0].losses}


def test_a_timestamp_alone_does_not_make_a_note_changed(world):
    n = world.add_note(updated_at="2026-10-02T10:00:00+00:00")
    world.send(n)
    n["updated_at"] = "2026-10-09T10:00:00+00:00"
    assert world.plan(n).items[0].state == UNCHANGED


def test_schema_is_kept_in_step_for_an_older_database(world):
    n1 = world.add_note()
    world.send(n1)
    ds = world.mapping(n1)["notion_parent_id"]
    del world.notion.sources[ds]["properties"]["Favorite"]
    del world.notion.sources[ds]["properties"]["Topics"]
    n2 = world.add_note()
    world.send(n2)
    assert {"Favorite", "Topics"} <= set(world.notion.sources[ds]["properties"])


# ---- mentions ------------------------------------------------------------------------------

def mention_ids(world, n):
    pid = world.mapping(n)["notion_id"]
    out = []
    for b in world.notion.top_blocks(pid):
        for t in b[b["type"]]["rich_text"]:
            if t["type"] == "mention":
                out.append(t["mention"]["page"]["id"])
    return out


def para_with(*inline):
    return [{"id": "p", "type": "paragraph", "props": {}, "content": list(inline), "children": []}]


def test_notes_that_mention_each_other_link_in_one_run(world):
    a, b = world.add_note(title="A"), world.add_note(title="B")
    a["content"] = para_with(T("see "), mention(b["id"], "B"))
    b["content"] = para_with(T("see "), mention(a["id"], "A"))
    res, _ = world.send(a, b)
    assert [i.status for i in res.items] == ["done", "done"]
    assert mention_ids(world, a) == [world.mapping(b)["notion_id"]]
    assert mention_ids(world, b) == [world.mapping(a)["notion_id"]]


def test_mention_of_an_unsent_note_is_text_and_relinks_when_it_arrives(world):
    a, b = world.add_note(title="A"), world.add_note(title="B")
    a["content"] = para_with(mention(b["id"], "B"))
    res, plan = world.send(a)
    assert mention_ids(world, a) == []
    assert "mention_unmirrored" in {loss["code"] for loss in plan.items[0].losses}
    assert world.plan(a).items[0].state == UNCHANGED
    world.send(b)                                                      # B arrives…
    p = world.plan(a)
    assert p.items[0].state == CHANGED                                 # …A is flagged: dependency edge
    world.send(a)
    assert mention_ids(world, a) == [world.mapping(b)["notion_id"]]
    assert world.plan(a).items[0].state == UNCHANGED


def test_mention_of_a_private_note_never_leaks_its_title(world):
    a, p = world.add_note(title="A"), world.add_note(title="Secret plans", sensitivity="private")
    a["content"] = para_with(mention(p["id"], "Secret plans"))
    res, plan = world.send(a)
    text = world.notion.top_blocks(world.mapping(a)["notion_id"])[0]["paragraph"]["rich_text"][0]["text"]["content"]
    assert text == "🔒 a private note" and "Secret" not in text
    assert world.mapping(p) is None and "mention_private" in {loss["code"] for loss in plan.items[0].losses}


def test_links_to_our_own_notes_are_rewritten_when_mapped(world):
    a, b = world.add_note(title="A"), world.add_note(title="B")
    world.send(b)
    a["content"] = para_with({"type": "link", "href": f"/brain/{b['id']}", "content": [T("see B")]})
    world.send(a)
    t = world.notion.top_blocks(world.mapping(a)["notion_id"])[0]["paragraph"]["rich_text"][0]["text"]
    assert t["link"]["url"] == "https://www.notion.so/" + world.mapping(b)["notion_id"].replace("-", "")


# ---- deletes → archive page, restore -----------------------------------------------------------

def test_deleted_note_is_listed_unchecked_and_moved_to_the_archive_only_when_ticked(world):
    n = world.add_note(title="Doomed")
    world.send(n)
    pid = world.mapping(n)["notion_id"]
    n["deleted_at"] = "2026-10-08T12:00:00+00:00"
    plan = world.plan(n)
    it = plan.items[0]
    assert it.state == DELETED and it.selected is False and plan.to_dict()["nothing_to_send"]
    writes = world.notion.writes()
    res, _ = world.send(n)
    assert res.items == [] and world.notion.writes() == writes         # unticked: nothing happens
    res, plan = world.send(n, archive=[n["id"]])
    assert res.items[0].status == "done" and res.items[0].action == "archive"
    arch = world.notion.pages[pid]["parent"]["page_id"]
    assert page_title(world, arch) == "🗄 Deleted in Second Brain"
    assert world.mapping(n)["state"] == "archived"
    assert world.notion.pages[pid]["in_trash"] is False                # never Notion's trash
    assert not [c for c in world.notion.calls if c[0] == "DELETE" and pid in c[1]]
    assert world.db.tables["notion_connections"][0]["archive_page_id"] == arch


def test_archive_page_is_created_once(world):
    a, b = world.add_note(), world.add_note()
    world.send(a, b)
    a["deleted_at"] = b["deleted_at"] = "2026-10-08T12:00:00+00:00"
    world.send(a, archive=[a["id"]])
    world.send(b, archive=[b["id"]])
    assert len([p for p in world.notion.pages.values() if world.notion._title_of(p["id"]) == "🗄 Deleted in Second Brain"]) == 1


def test_restoring_a_deleted_note_moves_it_back(world):
    n = world.add_note(title="Phoenix")
    world.send(n)
    pid = world.mapping(n)["notion_id"]
    ds = world.mapping(n)["notion_parent_id"]
    n["deleted_at"] = "2026-10-08T12:00:00+00:00"
    world.send(n, archive=[n["id"]])
    n["deleted_at"] = None
    plan = world.plan(n)
    assert plan.items[0].state == CHANGED and plan.items[0].restore is True
    res, _ = world.send(n)
    assert res.items[0].status == "done" and world.mapping(n)["state"] == "synced"
    assert world.notion.pages[pid]["parent"]["data_source_id"] == ds
    assert world.plan(n).items[0].state == UNCHANGED


def test_a_note_never_sent_and_deleted_is_just_missing(world):
    n = world.add_note(deleted_at="2026-10-08T12:00:00+00:00")
    assert world.plan(n).items[0].state == "missing"


# ---- crash recovery for pages --------------------------------------------------------------------------

def test_collection_page_created_but_answer_lost_is_adopted_not_duplicated(world):
    a = world.add_collection("Physics")
    n = world.add_note(collection_id=a["id"])
    world.notion.fail("POST /pages", "timeout_after")                   # first page create: lands, answer lost
    res, _ = world.send(n)
    assert res.items[0].status == "failed"            # the collection item saw the lost answer…
    assert world.mapping(n)["state"] == "synced"      # …and the note's own path reconciled it: adopted, not re-created
    res2, _ = world.send(n)
    assert res2.items == [] or all(i.status == "done" for i in res2.items)
    assert children_titles(world, world.notion.root).count(("child_page", "Physics")) == 1


def test_database_created_but_answer_lost_is_adopted(world):
    a = world.add_collection("Physics")
    n = world.add_note(collection_id=a["id"])
    world.notion.fail("POST /databases", "timeout_after")
    world.send(n)
    world.send(n)
    assert len(world.notion.dbs) == 1
    assert world.mapping(n)["state"] == "synced"


def test_a_failing_collection_blocks_only_its_notes(world):
    a = world.add_collection("Physics")
    inside, outside = world.add_note(collection_id=a["id"]), world.add_note(title="Outside")
    world.notion.fail("POST /pages", "500", times=2)      # the collection, then its note's own retry
    res, _ = world.send(inside, outside)
    by_title = {i.title: i.status for i in res.items}
    assert by_title["Outside"] == "done" and by_title["Physics"] == "failed" and by_title["A note"] == "failed"


def test_the_notes_table_opens_tidy_and_a_changed_view_is_left_alone(world):
    n = world.add_note(title="Lenses")
    world.send(n)
    did = next(iter(world.notion.dbs))
    views = [v for v in world.notion.views.values() if v["parent"]["database_id"] == did and not v.get("deleted")]
    assert [v["name"] for v in views] == ["All notes"]                        # renamed from "Default view"
    v = views[0]
    shown = {p["property_id"]: p["visible"] for p in v["configuration"]["properties"]}
    src = next(iter(world.notion.sources.values()))
    assert shown[src["ids"]["Name"]] and shown[src["ids"]["Edited in Second Brain"]]
    assert not shown[src["ids"]["SB ID"]] and not shown[src["ids"]["Created in Second Brain"]]
    assert v["sorts"] == [{"property": src["ids"]["Edited in Second Brain"], "direction": "descending"}]
    # a person who renamed the view keeps their version through later sends
    v["name"] = "My view"
    world.send(world.add_note(title="Second"))
    assert v["name"] == "My view"
