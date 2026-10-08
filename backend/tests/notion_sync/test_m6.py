"""M6: databases: schema (types, options, relations, rollups, formulas + snapshots), rows, values."""
from services.notion_sync.planner import CHANGED, NEW, UNCHANGED


def src_of(world, db):
    """The fake Notion data source of a sent database."""
    m = next(x for x in world.db.tables["notion_mappings"] if x["local_kind"] == "data_source" and x["local_id"] ==
             next(s["id"] for s in world.db.tables["db_data_sources"] if s["database_id"] == db["id"]))
    return m["notion_id"], world.notion.sources[m["notion_id"]]


def row_props(world, note):
    return world.notion.pages[world.mapping(note)["notion_id"]]["properties"]


def types(world, db):
    _, src = src_of(world, db)
    return {n: next(iter(sch)) for n, sch in src["properties"].items()}


def wrap(t, v):
    return {"type": t, t: v}


def task_db(world):
    db, ds = world.add_db("Tasks", icon="✅")
    pri = world.add_prop(ds, "Priority", "select", {"options": [{"id": "o1", "name": "High", "color": "red"}, {"id": "o2", "name": "Low", "color": "blue"}]}, key="pri")
    tags = world.add_prop(ds, "Tags", "multi_select", {"options": []}, key="tags")
    st = world.add_prop(ds, "State", "status", {"options": [{"id": "s1", "name": "Todo", "color": "gray", "group": "To-do"},
                                                          {"id": "s2", "name": "Doing", "color": "blue", "group": "In progress"},
                                                          {"id": "s3", "name": "Done", "color": "green", "group": "Complete"}]}, key="st")
    score = world.add_prop(ds, "Score", "number", {"format": "dollar"}, key="sc")
    due = world.add_prop(ds, "Due", "date", key="due")
    ok = world.add_prop(ds, "OK", "checkbox", key="ok")
    site = world.add_prop(ds, "Site", "url", key="site")
    notes = world.add_prop(ds, "Notes", "rich_text", key="nt")
    r1 = world.add_row(ds, "Write report", {"pri": wrap("select", "o1"), "tags": wrap("multi_select", ["a", "b,c"]),
                                          "st": wrap("status", "Doing"), "sc": wrap("number", 12.5),
                                          "due": wrap("date", {"start": "2026-10-09", "end": None, "time_zone": None}),
                                          "ok": wrap("checkbox", True), "site": wrap("url", "https://x.org"),
                                          "nt": wrap("rich_text", "hello")}, position=1)
    r2 = world.add_row(ds, "Second task", {}, position=2)
    return db, ds, r1, r2


def test_database_schema_and_rows_arrive_with_every_scalar_type(world):
    db, ds, r1, r2 = task_db(world)
    plan = world.plan(databases=[db])
    assert [(i.kind, i.state) for i in plan.items] == [("database", NEW), ("note", NEW), ("note", NEW)]
    res, _ = world.send(databases=[db])
    assert all(i.status == "done" for i in res.items), [i.message for i in res.items]
    assert types(world, db) == {"Title": "title", "Priority": "select", "Tags": "multi_select", "State": "status",
                                "Score": "number", "Due": "date", "OK": "checkbox", "Site": "url", "Notes": "rich_text",
                                "SB ID": "rich_text"}
    _, src = src_of(world, db)
    assert src["properties"]["Score"]["number"]["format"] == "dollar"
    assert [o["name"] for o in src["properties"]["Priority"]["select"]["options"]] == ["High", "Low"]
    p = row_props(world, r1)
    assert p["Priority"]["select"]["name"] == "High"                       # option id resolved to its name
    assert [o["name"] for o in p["Tags"]["multi_select"]] == ["a", "b;c"]  # commas cannot be in a tag
    assert p["State"]["status"]["name"] == "Doing" and p["Score"]["number"] == 12.5
    assert p["Due"]["date"]["start"] == "2026-10-09" and p["OK"]["checkbox"] is True
    assert p["Site"]["url"] == "https://x.org" and p["Notes"]["rich_text"][0]["text"]["content"] == "hello"
    assert world.notion._title_of(world.mapping(r1)["notion_id"]) == "Write report"
    assert next(iter(world.notion.dbs.values()))["title"][0]["text"]["content"] == "Tasks"
    assert world.notion.pages[world.mapping(r1)["notion_id"]]["parent"]["type"] == "data_source_id"


def test_second_send_of_a_database_makes_zero_writes(world):
    db, ds, r1, r2 = task_db(world)
    world.send(databases=[db])
    writes = world.notion.writes()
    plan = world.plan(databases=[db])
    assert all(i.state == UNCHANGED for i in plan.items) and plan.to_dict()["nothing_to_send"]
    res, _ = world.send(databases=[db])
    assert res.items == [] and world.notion.writes() == writes


def test_status_options_land_in_their_groups(world):
    db, ds, r1, r2 = task_db(world)
    world.send(databases=[db])
    _, src = src_of(world, db)
    groups = {g["name"]: g["option_ids"] for g in src["properties"]["State"]["status"].get("groups", [])}
    assert groups["In progress"] == ["o-Doing"] and groups["Complete"] == ["o-Done"]


def test_duplicate_property_names_and_unsendable_types_are_declared(world):
    db, ds = world.add_db("Odd")
    world.add_prop(ds, "Name", "rich_text", key="n1")
    world.add_prop(ds, "Name", "rich_text", key="n2")
    world.add_prop(ds, "Owner", "people", key="pp")
    world.add_prop(ds, "Go", "button", key="bt")
    world.add_row(ds, "r")
    res, plan = world.send(databases=[db])
    assert res.items[0].status == "done"
    assert {"Name", "Name (2)"} <= set(types(world, db))
    assert "Owner" not in types(world, db) and "Go" not in types(world, db)
    codes = {loss["code"] for loss in plan.items[0].losses}
    assert {"property_people_skipped", "property_button_skipped"} <= codes


def test_a_cleared_value_is_cleared_in_notion(world):
    db, ds, r1, r2 = task_db(world)
    world.send(databases=[db])
    rp = next(r for r in world.db.tables["db_row_props"] if r["note_id"] == r1["id"])
    rp["properties"].pop("sc")
    rp["properties"].pop("pri")
    res, _ = world.send(databases=[db])
    assert res.items[0].status == "done"
    p = row_props(world, r1)
    assert p["Score"]["number"] is None and p["Priority"]["select"] is None


def test_adding_renaming_and_removing_properties(world):
    db, ds, r1, r2 = task_db(world)
    world.send(databases=[db])
    props = world.db.tables["db_properties"]
    next(p for p in props if p["key"] == "sc")["name"] = "Budget"           # rename
    world.add_prop(ds, "Extra", "checkbox", key="ex")                          # add
    props.remove(next(p for p in props if p["key"] == "nt"))                   # remove: left alone in Notion
    res, plan = world.send(databases=[db])
    assert plan.items[0].state == CHANGED and plan.items[0].kind == "database"
    t = types(world, db)
    assert "Budget" in t and "Score" not in t and "Extra" in t and "Notes" in t   # never destructive
    assert row_props(world, r1)["Budget"]["number"] == 12.5


def test_title_icon_and_description_changes_update_the_database(world):
    db, ds, r1, r2 = task_db(world)
    world.send(databases=[db])
    db["title"], db["icon"] = "Tasks 2", "🔥"
    res, _ = world.send(databases=[db])
    assert res.items[0].status == "done"
    nd = next(iter(world.notion.dbs.values()))
    assert nd["title"][0]["text"]["content"] == "Tasks 2"


def test_a_database_without_a_table_or_missing_is_reported(world):
    plan = world.plan(databases=[{"id": "00000000-0000-0000-0000-000000000000"}])
    assert plan.items[0].state == "missing" and plan.items[0].kind == "database"


def test_extra_and_virtual_data_sources_are_declared(world):
    db, ds = world.add_db("Many")
    world.db.tables["db_data_sources"] += [
        {"id": "s2", "database_id": db["id"], "user_id": "user-1", "name": "Second", "system_kind": None, "position": 1},
        {"id": "s3", "database_id": db["id"], "user_id": "user-1", "name": "All", "system_kind": "notes", "position": 2}]
    world.add_row(ds, "r")
    plan = world.plan(databases=[db])
    assert {"extra_data_sources", "virtual_source"} <= {loss["code"] for loss in plan.items[0].losses}


# ---- relations, rollups, formulas ------------------------------------------------------------------

def linked_dbs(world):
    people, pds = world.add_db("People")
    tasks, tds = world.add_db("Tasks")
    world.add_prop(pds, "Age", "number", key="age")
    world.add_prop(tds, "Hours", "number", key="hrs")
    rid = "11111111-1111-1111-1111-111111111111"
    world.add_prop(tds, "Assignee", "relation", {"relation_id": rid, "side": "forward", "target_data_source_id": pds["id"]}, key="asg")
    world.add_prop(pds, "Tasks", "relation", {"relation_id": rid, "side": "reverse", "target_data_source_id": tds["id"]}, key="tks")
    world.add_prop(pds, "Total hours", "rollup", {"relation_key": "tks", "target_data_source_id": tds["id"], "target_key": "hrs",
                                                   "function": "sum"}, key="tot", result_type="number")
    world.add_prop(tds, "Double", "formula", {"expression": 'prop("Hours") * 2'}, key="dbl", result_type="number")
    ann = world.add_row(pds, "Ann", {"age": wrap("number", 30)}, computed={"tot": {"type": "number", "number": 7.0}})
    t1 = world.add_row(tds, "Build", {"hrs": wrap("number", 3)}, computed={"dbl": {"type": "number", "number": 6.0}})
    t2 = world.add_row(tds, "Test", {"hrs": wrap("number", 4)}, computed={"dbl": {"type": "number", "number": 8.0}})
    world.link(rid, t1, ann)
    world.link(rid, t2, ann)
    return (people, pds, ann), (tasks, tds, t1, t2), rid


def test_a_relation_pair_becomes_one_two_way_relation_with_rollup_and_formula(world):
    (people, pds, ann), (tasks, tds, t1, t2), rid = linked_dbs(world)
    res, plan = world.send(databases=[tasks])
    assert all(i.status == "done" for i in res.items), [(i.title, i.message) for i in res.items]
    titles = [(i.kind, i.title) for i in plan.items]
    assert ("database", "People") in titles and ("database", "Tasks") in titles          # the target is pulled in
    assert [i.title for i in plan.items if i.kind == "note"] == ["Build", "Test"]        # but not its rows
    tt, pt = types(world, tasks), types(world, people)
    assert tt["Assignee"] == "relation" and pt["Tasks"] == "relation"                    # ONE pair
    assert tt["Double"] == "formula" and pt["Total hours"] == "rollup"
    _, tsrc = src_of(world, tasks)
    assert tsrc["properties"]["Assignee"]["relation"]["type"] == "dual_property"
    assert tsrc["properties"]["Double"]["formula"]["expression"] == 'prop("Hours") * 2'
    # snapshots carry our computed values
    assert row_props(world, t1)["Double (SB value)"]["number"] == 6.0
    # people rows were not sent, so the relation values wait (and say so)
    assert row_props(world, t1)["Assignee"]["relation"] == []


def test_linked_rows_arrive_and_relation_values_follow(world):
    (people, pds, ann), (tasks, tds, t1, t2), rid = linked_dbs(world)
    world.send(databases=[tasks])
    p = world.plan(databases=[tasks])
    assert next(i for i in p.items if i.title == "Build").state == UNCHANGED
    res, _ = world.send(databases=[people])                                 # Ann arrives…
    assert all(i.status == "done" for i in res.items)
    plan = world.plan(databases=[tasks])
    assert {i.title for i in plan.items if i.state == CHANGED} == {"Build", "Test"}   # …the tasks that point at her are flagged
    world.send(databases=[tasks])
    ann_page = world.mapping(ann)["notion_id"]
    assert row_props(world, t1)["Assignee"]["relation"] == [{"id": ann_page}]
    assert world.plan(databases=[tasks]).to_dict()["nothing_to_send"]


def test_include_linked_sends_the_related_databases_and_their_rows(world):
    (people, pds, ann), (tasks, tds, t1, t2), rid = linked_dbs(world)
    res, plan = world.send(databases=[tasks], linked=True)
    assert {i.title for i in plan.items if i.kind == "note"} == {"Ann", "Build", "Test"}
    assert row_props(world, t1)["Assignee"]["relation"] == [{"id": world.mapping(ann)["notion_id"]}]


def test_one_way_relation_is_single_property(world):
    a, ads = world.add_db("A")
    b, bds = world.add_db("B")
    world.add_prop(ads, "To B", "relation", {"relation_id": "r1", "side": "forward", "target_data_source_id": bds["id"]}, key="tb")
    world.add_row(ads, "x")
    res, _ = world.send(databases=[a])
    _, src = src_of(world, a)
    assert src["properties"]["To B"]["relation"]["type"] == "single_property"


def test_self_relation_pair_sub_items(world):
    db, ds = world.add_db("Tree")
    world.add_prop(ds, "Parent item", "relation", {"relation_id": "rs", "side": "reverse", "target_data_source_id": ds["id"], "system": "sub_item"}, key="par")
    world.add_prop(ds, "Sub-item", "relation", {"relation_id": "rs", "side": "forward", "target_data_source_id": ds["id"], "system": "sub_item"}, key="sub")
    a, b = world.add_row(ds, "Parent"), world.add_row(ds, "Child")
    world.link("rs", a, b)
    res, _ = world.send(databases=[db])
    assert all(i.status == "done" for i in res.items)
    _, src = src_of(world, db)
    assert {"Parent item", "Sub-item"} <= set(src["properties"])
    assert row_props(world, a)["Sub-item"]["relation"] == [{"id": world.mapping(b)["notion_id"]}]
    assert row_props(world, b)["Parent item"]["relation"] == [{"id": world.mapping(a)["notion_id"]}]   # both sides say the same


def test_a_formula_notion_refuses_falls_back_to_the_snapshot(world):
    db, ds = world.add_db("F")
    world.add_prop(ds, "Bad", "formula", {"expression": 'prop("Nope") + 1'}, key="bad", result_type="number")
    world.add_row(ds, "r", computed={"bad": {"type": "number", "number": 1.0}})
    res, plan = world.send(databases=[db])
    assert res.items[0].status == "done"
    assert "Bad" not in types(world, db) and types(world, db)["Bad (SB value)"] == "number"
    assert "formula_rejected" in {loss["code"] for loss in res.items[0].losses}


def test_a_renamed_property_is_followed_inside_formulas(world):
    db, ds = world.add_db("R")
    world.add_prop(ds, "Cost", "number", key="c1")
    world.add_prop(ds, "Cost", "number", key="c2")                         # duplicate name -> "Cost (2)"
    world.add_prop(ds, "Twice", "formula", {"expression": 'prop("Cost") * 2'}, key="tw", result_type="number")
    world.add_row(ds, "r")
    world.send(databases=[db])
    _, src = src_of(world, db)
    assert "Twice" in src["properties"]


# ---- rows as notes -----------------------------------------------------------------------------------------

def test_sending_one_row_note_sends_its_database_schema_too(world):
    db, ds, r1, r2 = task_db(world)
    plan = world.plan(r1)
    assert [(i.kind, i.title) for i in plan.items] == [("database", "Tasks"), ("note", "Write report")]
    res, _ = world.send(r1)
    assert all(i.status == "done" for i in res.items)
    assert world.mapping(r2) is None


def test_row_body_is_the_notes_content(world):
    db, ds = world.add_db("Docs")
    n = world.add_row(ds, "Spec")
    n["content"] = [{"id": "p", "type": "paragraph", "props": {}, "content": [{"type": "text", "text": "the body", "styles": {}}], "children": []}]
    world.send(databases=[db])
    kids = world.notion.top_blocks(world.mapping(n)["notion_id"])
    assert kids[0]["paragraph"]["rich_text"][0]["text"]["content"] == "the body"


def test_a_row_edited_in_notion_is_held_back(world):
    db, ds, r1, r2 = task_db(world)
    world.send(databases=[db])
    world.notion.human_edit(world.mapping(r1)["notion_id"])
    rp = next(r for r in world.db.tables["db_row_props"] if r["note_id"] == r1["id"])
    rp["properties"]["sc"] = wrap("number", 99)
    plan = world.plan(databases=[db])
    assert next(i for i in plan.items if i.title == "Write report").state == "needs_you"


def test_inline_database_lives_under_its_host_note(world):
    host = world.add_note(title="Host")
    db, ds = world.add_db("Inline one", inline=True, host=host)
    world.add_row(ds, "r")
    world.send(databases=[db])
    host_page = world.mapping(host)["notion_id"]
    assert any(b["type"] == "child_database" for b in world.notion.top_blocks(host_page))


def test_database_created_but_answer_lost_is_adopted(world):
    db, ds, r1, r2 = task_db(world)
    world.notion.fail("POST /databases", "timeout_after")
    res, _ = world.send(databases=[db])
    assert res.items[0].status == "failed"          # the lost answer…
    res2, _ = world.send(databases=[db])             # …is reconciled (adopted, not re-created)
    assert all(i.status == "done" for i in res2.items) or res2.items == []
    assert len(world.notion.dbs) == 1


def test_private_row_is_not_sent_and_a_relation_to_it_is_dropped(world):
    db, ds = world.add_db("P")
    a = world.add_row(ds, "public row")
    secret = world.add_row(ds, "secret row")
    secret["sensitivity"] = "private"
    world.add_prop(ds, "Friend", "relation", {"relation_id": "rp", "side": "forward", "target_data_source_id": ds["id"]}, key="fr")
    world.link("rp", a, secret)
    res, plan = world.send(databases=[db])
    assert world.mapping(secret) is None
    assert row_props(world, a)["Friend"]["relation"] == []
