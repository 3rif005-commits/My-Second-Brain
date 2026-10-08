"""M7: views (all creatable types), filters/sorts/groups, feed/map/form fallbacks, dashboards,
the default view, and re-sending."""
from services.notion_sync.planner import CHANGED, UNCHANGED
from tests.notion_sync.test_m6 import src_of, wrap


def db_with_views(world):
    db, ds = world.add_db("Tasks")
    world.add_prop(ds, "Kind", "select", {"options": [{"id": "o1", "name": "A"}, {"id": "o2", "name": "B"}]}, key="kind")
    world.add_prop(ds, "State", "status", {"options": [{"id": "s1", "name": "Todo", "group": "To-do"}, {"id": "s2", "name": "Done", "group": "Complete"}]}, key="st")
    world.add_prop(ds, "Hours", "number", key="hrs")
    world.add_prop(ds, "Due", "date", key="due")
    world.add_prop(ds, "OK", "checkbox", key="ok")
    world.add_row(ds, "r1", {"kind": wrap("select", "o1")})
    return db, ds


def notion_views(world, db):
    did = next(iter(world.notion.dbs))
    return [v for v in world.notion.views.values() if v["parent"]["database_id"] == did and not v.get("deleted")]


def by_name(world, db):
    return {v["name"]: v for v in notion_views(world, db)}


def pid(world, db, name):
    _, src = src_of(world, db)
    return src["ids"][name]


def test_every_creatable_view_type_arrives_and_the_default_view_goes(world):
    db, ds = db_with_views(world)
    world.add_view(ds, "Table", "table", {"hidden_properties": ["hrs"], "column_widths": {"kind": 240}, "show_vertical_lines": True,
                                           "group_by": {"property_key": "kind", "hide_empty_groups": True}}, position=0)
    world.add_view(ds, "Board", "board", {"group_by": {"property_key": "st", "mode": "option"}, "cover_size": "large"}, position=1)
    world.add_view(ds, "List", "list", {}, position=2)
    world.add_view(ds, "Gallery", "gallery", {"cover_size": "large"}, position=3)
    world.add_view(ds, "Calendar", "calendar", {"date_property_id": "due", "show_weekends": False}, position=4)
    world.add_view(ds, "Timeline", "timeline", {"date_property_id": "due", "preference": {"zoom_level": "month"}}, position=5)
    world.add_view(ds, "Chart", "chart", {"chart_type": "column", "x_axis": {"property_id": "kind"}, "y_axis": {"aggregator": "count"}}, position=6)
    world.add_view(ds, "Form", "form", {"questions": [{"property_key": "kind", "required": True}], "is_form_closed": False}, position=7)
    res, plan = world.send(databases=[db])
    assert all(i.status == "done" for i in res.items), [i.message for i in res.items]
    views = by_name(world, db)
    assert "Default view" not in views
    assert {n: v["type"] for n, v in views.items()} == {"Table": "table", "Board": "board", "List": "list", "Gallery": "gallery",
                                                         "Calendar": "calendar", "Timeline": "timeline", "Chart": "chart", "Form": "form"}
    t = views["Table"]["configuration"]
    assert t["group_by"]["property_id"] == pid(world, db, "Kind") and t["group_by"]["type"] == "select"
    hrs = next(p for p in t["properties"] if p["property_id"] == pid(world, db, "Hours"))
    kind = next(p for p in t["properties"] if p["property_id"] == pid(world, db, "Kind"))
    assert hrs["visible"] is False and kind["width"] == 240 and t["show_vertical_lines"] is True
    b = views["Board"]["configuration"]
    assert b["group_by"]["type"] == "status" and b["group_by"]["group_by"] == "option" and b["cover_size"] == "large"
    assert views["Calendar"]["configuration"]["date_property_id"] == pid(world, db, "Due")
    assert views["Chart"]["configuration"]["x_axis"] == {"type": "select", "property_id": pid(world, db, "Kind"), "sort": {"type": "manual"}}
    codes = {loss["code"] for loss in res.items[0].losses}
    assert "view_form_questions" in codes


def test_views_resend_makes_zero_writes_and_an_edit_patches_only_that_view(world):
    db, ds = db_with_views(world)
    v1 = world.add_view(ds, "One", "table", {}, position=0)
    world.add_view(ds, "Two", "list", {}, position=1)
    world.send(databases=[db])
    writes = world.notion.writes()
    assert world.plan(databases=[db]).to_dict()["nothing_to_send"]
    assert world.send(databases=[db])[0].items == [] and world.notion.writes() == writes
    v1["name"] = "One renamed"
    v1["filter"] = {"type": "condition", "property": "kind", "operator": "equals", "value": "o1"}
    v1["sorts"] = [{"property": "hrs", "direction": "desc"}]
    plan = world.plan(databases=[db])
    assert plan.items[0].state == CHANGED
    mark = len(world.notion.calls)
    world.send(databases=[db])
    patched = [c for c in world.notion.calls[mark:] if c[0] == "PATCH" and c[1].startswith("/views/")]
    created = [c for c in world.notion.calls[mark:] if c == ("POST", "/views")]
    assert len(patched) == 1 and not created
    v = by_name(world, db)["One renamed"]
    assert v["filter"] == {"property": pid(world, db, "Kind"), "select": {"equals": "A"}}      # id -> name
    assert v["sorts"] == [{"property": pid(world, db, "Hours"), "direction": "descending"}]


def test_filters_groups_and_relative_dates(world):
    db, ds = db_with_views(world)
    world.add_view(ds, "F", "table", {}, position=0, filter={"type": "group", "op": "and", "children": [
        {"type": "condition", "property": "hrs", "operator": "greater_than", "value": 2},
        {"type": "group", "op": "or", "children": [
            {"type": "condition", "property": "st", "operator": "equals", "value": "s1"},
            {"type": "condition", "property": "due", "operator": "past_week", "value": {}},
            {"type": "condition", "property": "ok", "operator": "equals", "value": True}]},
        {"type": "condition", "property": "kind", "operator": "is_empty", "value": None}]})
    world.send(databases=[db])
    f = by_name(world, db)["F"]["filter"]
    assert f["and"][0] == {"property": pid(world, db, "Hours"), "number": {"greater_than": 2}}
    ors = f["and"][1]["or"]
    assert ors[0] == {"property": pid(world, db, "State"), "status": {"equals": "Todo"}}
    assert ors[1] == {"property": pid(world, db, "Due"), "date": {"past_week": {}}}
    assert f["and"][2] == {"property": pid(world, db, "Kind"), "select": {"is_empty": True}}


def test_a_condition_on_a_missing_property_is_dropped_and_declared(world):
    db, ds = db_with_views(world)
    world.add_view(ds, "F", "table", {}, filter={"type": "condition", "property": "ghost", "operator": "equals", "value": 1},
                   sorts=[{"property": "ghost", "direction": "asc"}])
    res, plan = world.send(databases=[db])
    assert res.items[0].status == "done"
    assert "filter" not in by_name(world, db)["F"] and {"filter_dropped", "sort_dropped"} <= {loss["code"] for loss in res.items[0].losses}


def test_feed_map_and_headless_board_degrade_to_something_valid(world):
    db, ds = db_with_views(world)
    world.add_view(ds, "Feed", "feed", {}, position=0)
    world.add_view(ds, "Map", "map", {}, position=1)
    world.add_view(ds, "Board", "board", {}, position=2)                  # a board with no grouping
    world.add_view(ds, "Cal", "calendar", {}, position=3)                 # no date property
    res, _ = world.send(databases=[db])
    assert res.items[0].status == "done"
    v = by_name(world, db)
    assert v["Feed"]["type"] == "list" and v["Map"]["type"] == "table" and v["Board"]["type"] == "table" and v["Cal"]["type"] == "table"
    assert {"view_feed", "view_map", "view_board_ungrouped", "view_no_date"} <= {loss["code"] for loss in res.items[0].losses}


def test_dashboard_with_widgets(world):
    db, ds = db_with_views(world)
    a = world.add_view(ds, "Chart A", "chart", {"chart_type": "number", "y_axis": {"aggregator": "count"}}, position=0)
    b = world.add_view(ds, "List B", "list", {}, position=1)
    world.add_view(ds, "Board", "dashboard", {"rows": [{"id": "r1", "height": 320, "widgets": [
        {"id": "w1", "width": 6, "view_id": a["id"]}, {"id": "w2", "width": 6, "view_id": b["id"]},
        {"id": "w3", "width": 6, "view_id": "00000000-0000-0000-0000-000000000000"}]}]}, position=2)
    res, _ = world.send(databases=[db])
    assert res.items[0].status == "done"
    dash = next(v for v in world.notion.views.values() if v["type"] == "dashboard")
    widgets = [v for v in world.notion.views.values() if v.get("dashboard_view_id") == dash["id"]]
    assert sorted(w["name"] for w in widgets) == ["Chart A", "List B"]
    codes = {loss["code"] for loss in res.items[0].losses}
    assert {"view_widget_missing", "view_dashboard_layout"} <= codes
    writes = world.notion.writes()
    world.send(databases=[db])
    assert world.notion.writes() == writes


def test_a_database_with_no_views_keeps_notions_default(world):
    db, ds = db_with_views(world)
    world.send(databases=[db])
    assert list(by_name(world, db)) == ["Default view"]


def test_a_view_deleted_here_is_left_in_notion_never_deleted(world):
    db, ds = db_with_views(world)
    v1 = world.add_view(ds, "One", "table", {}, position=0)
    v2 = world.add_view(ds, "Two", "list", {}, position=1)
    world.send(databases=[db])
    world.db.tables["db_views"].remove(v2)
    world.send(databases=[db])
    assert set(by_name(world, db)) == {"One", "Two"}


def test_view_created_but_answer_lost_is_adopted(world):
    db, ds = db_with_views(world)
    world.add_view(ds, "One", "table", {}, position=0)
    world.add_view(ds, "Two", "list", {}, position=1)
    world.send(databases=[db])                                              # warm: db exists, views exist
    world.add_view(ds, "Three", "gallery", {}, position=2)
    world.notion.fail("POST /views", "timeout_after")
    res, _ = world.send(databases=[db])
    assert res.items[0].status == "failed"
    world.send(databases=[db])
    assert sorted(v["name"] for v in notion_views(world, db)) == ["One", "Three", "Two"]


# ---- inline databases sit in position (T3) --------------------------------------------------------

def P(text, i):
    return {"id": i, "type": "paragraph", "props": {}, "content": [{"type": "text", "text": text, "styles": {}}], "children": []}


def host_with_db(world):
    host = world.add_note(title="Host")
    db, ds = world.add_db("Inline", inline=True, host=host)
    world.add_row(ds, "row")
    host["content"] = [P("before", "a"), {"id": "d", "type": "database", "props": {"databaseId": db["id"], "viewId": ""},
                                           "content": [], "children": []}, P("after", "b")]
    return host, db


def page_kinds(world, host):
    out = []
    for b in world.notion.top_blocks(world.mapping(host)["notion_id"]):
        out.append("DB" if b["type"] == "child_database" else b["paragraph"]["rich_text"][0]["text"]["content"])
    return out


def test_an_inline_database_sits_between_the_blocks_it_was_between(world):
    host, db = host_with_db(world)
    res, _ = world.send(host, databases=[db])
    assert all(i.status == "done" for i in res.items), [i.message for i in res.items]
    assert page_kinds(world, host) == ["before", "DB", "after"]
    writes = world.notion.writes()
    assert world.send(host, databases=[db])[0].items == [] and world.notion.writes() == writes


def test_the_host_is_rearranged_when_its_database_arrives_later(world):
    host, db = host_with_db(world)
    res, plan = world.send(host)                                      # the database is not in Notion yet
    assert page_kinds(world, host) == ["before", "after"]
    assert "db_embed_pending" in {loss["code"] for loss in plan.items[-1].losses}
    world.send(databases=[db])                                        # …now it is, at the end of the page
    assert page_kinds(world, host)[-1] == "DB"
    assert world.plan(host).items[0].state == CHANGED                 # the host's hash noticed
    world.send(host)
    assert page_kinds(world, host) == ["before", "DB", "after"]
    assert world.plan(host).to_dict()["nothing_to_send"]


def test_editing_text_around_the_database_keeps_it_in_place(world):
    host, db = host_with_db(world)
    world.send(host, databases=[db])
    host["content"][0] = P("before, edited", "a")
    host["content"].append(P("last", "c"))
    world.send(host)
    assert page_kinds(world, host) == ["before, edited", "DB", "after", "last"]
    assert len([d for d in world.notion.dbs.values() if d["title"][0]["text"]["content"] == "Inline"]) == 1
