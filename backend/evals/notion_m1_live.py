"""Live check of the Send-to-Notion core (M1) against the TEST workspace.

Safety (ROBUSTNESS §6): NOTION_TEST_TOKEN only; refuses to run unless exactly
one top-level page is shared and it is titled SB-TEST-…; the database (a fresh
"Notes" under that root) and everything in it is moved to the test workspace's
trash at the end. Uses an in-memory DB, so no real note and no real
connection row is read or written.

Run:  cd backend && venv/bin/python -m evals.notion_m1_live [--keep]
"""
from __future__ import annotations

import argparse
import json
import sys
import time

from core.config import settings
from services.notion_sync import connection as conn_mod
from services.notion_sync.engine.runner import Engine
from services.notion_sync.notion.adapter import NotionAdapter
from services.notion_sync.notion.client import NotionClient
from services.notion_sync.planner import plan_notes
from tests.fake_db import FakeDB


def T(text, **styles):
    return {"type": "text", "text": text, "styles": styles}


def B(type_, content=None, props=None, children=None, i=None):
    return {"id": i or f"{type_}-{abs(hash(json.dumps(content, default=str))) % 10**6}", "type": type_,
            "props": props or {}, "content": content if content is not None else [], "children": children or []}


def fixture_content():
    return [
        B("heading", [T("SB-TEST M1 fixture")], {"level": 1}),
        B("paragraph", [T("Plain, "), T("bold", bold=True), T(", "), T("italic", italic=True), T(", "),
                        T("underline", underline=True), T(", "), T("strike", strike=True), T(", "),
                        T("code", code=True), T(", "), T("red", textColor="red"), T(", "),
                        T("highlighted", backgroundColor="yellow"), T(" and a "),
                        {"type": "link", "href": "https://example.com", "content": [T("link", bold=True)]},
                        T(" and math "), {"type": "inlineMath", "props": {"latex": "E=mc^2"}}]),
        B("heading", [T("Heading 2")], {"level": 2}),
        B("heading", [T("Heading 3")], {"level": 3}),
        B("heading", [T("Heading 4")], {"level": 4}),
        B("heading", [T("Heading 5 (becomes 4)")], {"level": 5}),
        B("heading", [T("Heading 6 (becomes 4)")], {"level": 6}),
        B("heading", [T("Toggle heading")], {"level": 2, "isToggleable": True},
          [B("paragraph", [T("inside the toggle heading")])]),
        B("bulletListItem", [T("bullet one")], children=[B("bulletListItem", [T("nested bullet")])]),
        B("bulletListItem", [T("bullet two")]),
        B("numberedListItem", [T("number three")], {"start": 3}),
        B("numberedListItem", [T("number four")]),
        B("checkListItem", [T("done item")], {"checked": True}),
        B("checkListItem", [T("open item")]),
        B("toggleListItem", [T("a toggle")], children=[B("paragraph", [T("hidden body")])]),
        B("quote", [T("a quote")], {"backgroundColor": "blue"}),
        B("codeBlock", [T("def f(x):\n    return x * 2")], {"language": "python"}),
        B("codeBlock", [T("const a = <A/>;")], {"language": "jsx"}),
        B("divider"),
        B("paragraph", [T("centered text (alignment is lost)")], {"textAlignment": "center"}),
        B("paragraph", [T("emoji 😀 and RTL שלום " * 120)]),
        B("flashcard", [T("front of a future block type")], {"back": "back"}),
        B("paragraph", [T("last line")]),
    ]


# 1x1 transparent PNG
PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082")


class StaticFiles:
    """Pretends "our storage": every files.sb.test URL is a tiny PNG, so the real
    File Upload API is exercised without touching anything of yours."""
    def is_public_link(self, url):
        return "files.sb.test" not in url and url.startswith("https://") and "token=" not in url

    def fetch(self, url, max_bytes, name_hint=""):
        from services.notion_sync.notion.files import Fetched
        return Fetched(PNG, "image/png", name_hint or "pic.png")


def m2_content():
    own = "https://files.sb.test/p/pic.png?token=1"
    para = lambda t: B("paragraph", [T(t)])
    return [
        B("heading", [T("M2 fixture: every other block type")], {"level": 1}),
        B("table", {"type": "tableContent", "headerRows": 1, "rows": [
            {"cells": [[T("Name", bold=True)], [T("Value")]]},
            {"cells": [[T("alpha")], {"type": "tableCell", "props": {"colspan": 2, "backgroundColor": "red"}, "content": [T("merged cell")]}]},
            {"cells": [[T("beta")], [T("2")]]}]}),
        B("callout", None, {"calloutType": "WARNING"}, [para("a warning, with a child")]),
        B("callout", None, {"calloutType": "TIP", "calloutIcon": "🚀"}, [para("a tip with its own icon")]),
        B("columnList", None, None, [B("column", None, {"width": 1}, [para("left column")]),
                                      B("column", None, {"width": 2}, [para("right column, twice as wide")])]),
        B("math", None, {"latex": "\\int_0^1 x^2\\,dx = \\tfrac13"}),
        B("checkpoint", None, {"anchorType": "time", "value": "754", "label": "Key idea"}),
        B("button", None, {"label": "Make flashcards", "actionsJson": "[{\"skill\": \"flashcards\"}]"}),
        B("pageBreak"),
        B("image", None, {"url": "https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png",
                          "caption": "a public image (linked)"}),
        B("image", None, {"url": own, "name": "pic.png", "caption": "our own file (uploaded)"}),
        B("video", None, {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}),
        B("file", None, {"url": "https://files.sb.test/p/notes.zip?token=1", "name": "notes.zip"}),
        para("last line"),
    ]


def run_m3(client, adapter, root, bot) -> dict:
    """Tree of databases, properties, mentions, move, rename, delete -> archive."""
    from services.notion_sync.planner import plan_scope
    user = "live-user"
    mk = lambda i: f"00000000-0000-4000-8000-0000000000{i:02d}"
    colls = [{"id": mk(1), "user_id": user, "name": "SB-TEST Physics", "icon": "⚛️", "color": "#6366f1", "description": "All about forces", "parent_id": None, "position": 0},
             {"id": mk(2), "user_id": user, "name": "SB-TEST Optics", "icon": "🔭", "color": "#ff0000", "description": None, "parent_id": mk(1), "position": 0},
             {"id": mk(3), "user_id": user, "name": "SB-TEST Chemistry", "icon": "🧪", "color": "#6366f1", "description": None, "parent_id": None, "position": 1}]
    men = lambda nid, name: {"type": "mention", "props": {"noteId": nid, "noteName": name}}
    notes = [
        {"id": mk(11), "user_id": user, "title": "SB-TEST Lenses", "icon": "🔍", "collection_id": mk(2), "topics": ["optics", "a,b"], "mastery_status": "learning",
         "is_favorited": True, "sensitivity": "personal", "deleted_at": None, "created_at": "2026-10-01T10:00:00+00:00", "updated_at": "2026-10-02T10:00:00+00:00",
         "content": [B("paragraph", [T("see "), men(mk(12), "Mirrors"), T(" and the "), {"type": "link", "href": f"/brain/{mk(12)}", "content": [T("link form")]}])]},
        {"id": mk(12), "user_id": user, "title": "SB-TEST Mirrors", "icon": "🪞", "collection_id": mk(1), "sensitivity": "open", "deleted_at": None,
         "content": [B("paragraph", [T("back to "), men(mk(11), "Lenses"), T("; secret: "), men(mk(13), "Secret")])]},
        {"id": mk(13), "user_id": user, "title": "SB-TEST Secret", "collection_id": None, "sensitivity": "private", "deleted_at": None, "content": [B("paragraph", [T("hidden")])]},
        {"id": mk(14), "user_id": user, "title": "SB-TEST To be deleted", "collection_id": None, "sensitivity": "personal", "deleted_at": None, "content": [B("paragraph", [T("bye")])]},
    ]
    db = FakeDB(collections=colls, notes=notes, notion_mappings=[], notion_runs=[], notion_run_items=[],
                notion_connections=[{"id": "live-c", "user_id": user, "status": "active", "bot_user_id": bot.bot_id,
                                     "root_page_id": root.id, "privacy_ceiling": "personal", "token_ciphertext": "x", "token_hint": "…live"}])
    colls, notes = db.tables["collections"], db.tables["notes"]      # FakeDB copies what it is given
    conn = conn_mod.load(db, user)
    rep: dict = {}
    t = lambda tag, res: rep.__setitem__(tag, {"status": res.status, "requests": res.requests,
                                               "items": [(i.kind, i.title, i.status, i.action) for i in res.items]})
    def go(tag, **scope):
        p = plan_scope(db, conn, adapter, **scope)
        eng = Engine(db, conn, adapter)
        res = eng.run(p.items, frozenset(scope.get("released", ())))
        t(tag, res)
        return p
    p1 = go("1_send_tree", collection_ids=[mk(1)], note_ids=[mk(11), mk(12), mk(13), mk(14)])
    rep["1_plan_states"] = [(i.title, i.state) for i in p1.items]
    before = client.write_requests
    p2 = plan_scope(db, conn, adapter, collection_ids=[mk(1)], note_ids=[mk(11), mk(12)])
    rep["2_resend"] = {"nothing_to_send": p2.to_dict()["nothing_to_send"], "writes": client.write_requests - before}
    colls[0]["name"] = "SB-TEST Physics (renamed)"
    notes[0]["collection_id"] = mk(3)                                  # Lenses moves to Chemistry
    go("3_rename_and_move", collection_ids=[mk(1)], note_ids=[mk(11), mk(12)])
    notes[3]["deleted_at"] = "2026-10-08T12:00:00+00:00"
    go("4_send_deleted_unticked", note_ids=[mk(14)])
    go("4b_send_deleted_ticked", note_ids=[mk(14)], archive_ids=frozenset({mk(14)}))
    page = lambda n: next(x["notion_id"] for x in db.tables["notion_mappings"] if x["local_id"] == n and x["local_kind"] == "note")
    rep["mention_in_Mirrors"] = [t_["type"] for b in adapter._children(page(mk(12))) if b["type"] == "paragraph" for t_ in b["paragraph"]["rich_text"]]
    rep["props_of_Lenses"] = sorted(client.get(f"/pages/{page(mk(11))}")["properties"])
    return rep, db


def run_m4(client, adapter, root, bot) -> dict:
    """A person types in Notion: the next send is held back, and each choice does what it says.
    (The test token cannot act as a human, so a block our bot did not create stands in for the edit:
    the deep check treats both the same way.)"""
    from services.notion_sync.planner import plan_scope
    user = "live-user"
    nid = "00000000-0000-4000-8000-000000000041"
    note = {"id": nid, "user_id": user, "title": "SB-TEST M4 note", "collection_id": None, "sensitivity": "personal",
            "deleted_at": None, "content": [B("paragraph", [T("original text")])]}
    db = FakeDB(collections=[], notes=[note], notion_mappings=[], notion_runs=[], notion_run_items=[],
                notion_connections=[{"id": "live-c", "user_id": user, "status": "active", "bot_user_id": bot.bot_id,
                                     "root_page_id": root.id, "privacy_ceiling": "personal", "token_ciphertext": "x", "token_hint": "…"}])
    note = db.tables["notes"][0]
    conn = conn_mod.load(db, user)
    rep: dict = {}

    def go(tag, resolutions=None):
        p = plan_scope(db, conn, adapter, note_ids=[nid], resolutions=resolutions)
        res = Engine(db, conn, adapter).run(p.items)
        it = p.items[0]
        rep[tag] = {"state": it.state, "needs": (it.needs or {}).get("reason"), "result": [(i.status, i.action) for i in res.items],
                    "diff_ops": sorted({d["op"] for d in (it.needs or {}).get("diff", [])})}
        return p

    go("1_first_send")
    mp = lambda: next(x for x in db.tables["notion_mappings"] if x["local_kind"] == "note" and not x["local_sub"])
    page = mp()["notion_id"]
    client.patch(f"/blocks/{page}/children", {"children": [{"type": "paragraph", "paragraph": {"rich_text": [
        {"type": "text", "text": {"content": "typed by a person in Notion"}}]}}]}, create=True)
    note["content"] = [B("paragraph", [T("my newer text")])]
    before = client.write_requests
    go("2_held_back")
    rep["2_writes_while_held"] = client.write_requests - before
    go("3_keep_both", {nid: "copy"})
    rep["3_copy_is_new_page"] = mp()["notion_id"] != page
    rep["3_original_text"] = [t["plain_text"] for b in adapter._children(page) if b["type"] == "paragraph" for t in b["paragraph"]["rich_text"]]
    go("4_after_copy")
    copy_page = mp()["notion_id"]
    client.patch(f"/blocks/{copy_page}/children", {"children": [{"type": "paragraph", "paragraph": {"rich_text": [
        {"type": "text", "text": {"content": "another human edit"}}]}}]}, create=True)
    note["content"] = [B("paragraph", [T("third version")])]
    go("5_overwrite", {nid: "overwrite"})
    rep["5_text_after_overwrite"] = [t["plain_text"] for b in adapter._children(copy_page) if b["type"] == "paragraph" for t in b["paragraph"]["rich_text"]]
    rep["6_resend"] = {"state": plan_scope(db, conn, adapter, note_ids=[nid]).items[0].state}
    return rep, db


def run_m6(client, adapter, root, bot) -> dict:
    """Two linked databases: every scalar type, a two-way relation, a rollup, a formula (+ snapshots), rows."""
    from services.notion_sync.planner import plan_scope
    from tests.notion_sync.conftest import World
    w = World.__new__(World)
    user = "user-1"
    w.db = FakeDB(collections=[], notes=[], db_databases=[], db_data_sources=[], db_properties=[], db_row_props=[],
                  db_relation_links=[], db_views=[], notion_mappings=[], notion_runs=[], notion_run_items=[],
                  notion_connections=[{"id": "live-c", "user_id": user, "status": "active", "bot_user_id": bot.bot_id,
                                       "root_page_id": root.id, "privacy_ceiling": "personal", "token_ciphertext": "x", "token_hint": "…"}])
    wrap = lambda t, v: {"type": t, t: v}
    people, pds = w.add_db("SB-TEST People", icon="🧑")
    tasks, tds = w.add_db("SB-TEST Tasks", icon="✅")
    w.add_prop(pds, "Age", "number", key="age")
    w.add_prop(tds, "Hours", "number", {"format": "number_with_commas"}, key="hrs")
    w.add_prop(tds, "Priority", "select", {"options": [{"id": "o1", "name": "High", "color": "red"}, {"id": "o2", "name": "Low", "color": "blue"}]}, key="pri")
    w.add_prop(tds, "Tags", "multi_select", {"options": []}, key="tags")
    w.add_prop(tds, "State", "status", {"options": [{"id": "s1", "name": "Todo", "color": "gray", "group": "To-do"},
                                                    {"id": "s2", "name": "Doing", "color": "blue", "group": "In progress"},
                                                    {"id": "s3", "name": "Done", "color": "green", "group": "Complete"}]}, key="st")
    w.add_prop(tds, "Due", "date", key="due")
    w.add_prop(tds, "Done?", "checkbox", key="ok")
    w.add_prop(tds, "Site", "url", key="site")
    w.add_prop(tds, "Notes", "rich_text", key="nt")
    w.add_prop(tds, "Created", "created_time", key="ct")
    w.add_prop(tds, "Owner", "people", key="own")
    rid = "11111111-1111-4111-8111-111111111111"
    w.add_prop(tds, "Assignee", "relation", {"relation_id": rid, "side": "forward", "target_data_source_id": pds["id"]}, key="asg")
    w.add_prop(pds, "Tasks", "relation", {"relation_id": rid, "side": "reverse", "target_data_source_id": tds["id"]}, key="tks")
    w.add_prop(pds, "Total hours", "rollup", {"relation_key": "tks", "target_data_source_id": tds["id"], "target_key": "hrs", "function": "sum"}, key="tot", result_type="number")
    w.add_prop(tds, "Double", "formula", {"expression": 'prop("Hours") * 2'}, key="dbl", result_type="number")
    v = lambda *a, **k: w.add_view(tds, *a, **k)
    v("Everything", "table", {"hidden_properties": ["ok"], "column_widths": {"hrs": 140}, "show_vertical_lines": True,
                              "group_by": {"property_key": "pri", "hide_empty_groups": True}}, position=0,
      filter={"type": "group", "op": "and", "children": [
          {"type": "condition", "property": "hrs", "operator": "greater_than", "value": 1},
          {"type": "group", "op": "or", "children": [{"type": "condition", "property": "st", "operator": "equals", "value": "s1"},
                                                     {"type": "condition", "property": "due", "operator": "past_week", "value": {}}]}]},
      sorts=[{"property": "hrs", "direction": "desc"}])
    v("By status", "board", {"group_by": {"property_key": "st", "mode": "option"}, "cover_size": "large"}, position=1)
    v("Plain list", "list", {}, position=2)
    v("Cards", "gallery", {"cover_size": "large"}, position=3)
    v("When", "calendar", {"date_property_id": "due", "show_weekends": False}, position=4)
    v("Plan", "timeline", {"date_property_id": "due", "preference": {"zoom_level": "month"}}, position=5)
    cht = v("Per priority", "chart", {"chart_type": "column", "x_axis": {"property_id": "pri"}, "y_axis": {"aggregator": "count"}}, position=6)
    v("Intake", "form", {"questions": [{"property_key": "pri", "required": True}]}, position=7)
    v("News", "feed", {}, position=8)
    v("Overview", "dashboard", {"rows": [{"id": "r1", "height": 320, "widgets": [{"id": "w1", "width": 6, "view_id": cht["id"]}]}]}, position=9)
    ann = w.add_row(pds, "SB-TEST Ann", {"age": wrap("number", 30)}, computed={"tot": {"type": "number", "number": 7.0}})
    t1 = w.add_row(tds, "SB-TEST Build", {"hrs": wrap("number", 3), "pri": wrap("select", "o1"), "tags": wrap("multi_select", ["a", "b,c"]),
                                            "st": wrap("status", "Doing"), "due": wrap("date", {"start": "2026-10-09T10:00:00+00:00", "end": None, "time_zone": "Africa/Casablanca"}),
                                            "ok": wrap("checkbox", True), "site": wrap("url", "https://x.org"), "nt": wrap("rich_text", "hello")},
                   computed={"dbl": {"type": "number", "number": 6.0}}, position=1)
    t2 = w.add_row(tds, "SB-TEST Test", {"hrs": wrap("number", 4)}, computed={"dbl": {"type": "number", "number": 8.0}}, position=2)
    w.link(rid, t1, ann)
    w.link(rid, t2, ann)
    conn = conn_mod.load(w.db, user)
    rep: dict = {}

    def go(tag, **scope):
        p = plan_scope(w.db, conn, adapter, **scope)
        res = Engine(w.db, conn, adapter).run(p.items)
        rep[tag] = {"status": res.status, "requests": res.requests,
                    "items": [(i.kind, i.title, i.status, i.message[:80] if i.status != "done" else "ok") for i in res.items]}
        return p, res
    p, res = go("1_send_tasks_with_linked", database_ids=[tasks["id"]], include_linked=True)
    rep["1_losses"] = sorted({l["code"] for i in p.items for l in i.losses})
    before = client.write_requests
    p2 = plan_scope(w.db, conn, adapter, database_ids=[tasks["id"]], include_linked=True)
    rep["2_resend"] = {"nothing_to_send": p2.to_dict()["nothing_to_send"], "writes": client.write_requests - before}
    mp = {x["local_id"]: x for x in w.db.tables["notion_mappings"]}
    tp = client.get(f"/pages/{mp[t1['id']]['notion_id']}")["properties"]
    rep["task_row"] = {k: v.get("type") for k, v in tp.items()}
    rep["task_row_values"] = {"Priority": (tp["Priority"]["select"] or {}).get("name"), "State": (tp["State"]["status"] or {}).get("name"),
                              "Tags": [t["name"] for t in tp["Tags"]["multi_select"]], "Hours": tp["Hours"]["number"],
                              "Double": tp["Double"]["formula"], "Double (SB value)": tp["Double (SB value)"]["number"],
                              "Assignee": len(tp["Assignee"]["relation"]), "Due": tp["Due"]["date"]}
    ap = client.get(f"/pages/{mp[ann['id']]['notion_id']}")["properties"]
    rep["person_row"] = {"Tasks": len(ap["Tasks"]["relation"]), "Total hours": ap["Total hours"]["rollup"]}
    # an inline database sits between the blocks it sat between
    host = w.add_note(title="SB-TEST Host page")
    inl, ids_ = w.add_db("SB-TEST Inline", inline=True, host=host)
    w.add_row(ids_, "SB-TEST inline row")
    para_ = lambda t, i: {"id": i, "type": "paragraph", "props": {}, "content": [{"type": "text", "text": t, "styles": {}}], "children": []}
    host_row = next(n for n in w.db.tables["notes"] if n["id"] == host["id"])
    host_row["content"] = [para_("before the table", "a"), {"id": "d", "type": "database", "props": {"databaseId": inl["id"]}, "content": [], "children": []},
                           para_("after the table", "b")]
    go("2b_host_with_inline_db", note_ids=[host["id"]], database_ids=[inl["id"]])
    mp = {x["local_id"]: x for x in w.db.tables["notion_mappings"]}
    rep["inline_order"] = [("DB" if b["type"] == "child_database" else b["paragraph"]["rich_text"][0]["plain_text"]) for b in adapter._children(mp[host["id"]]["notion_id"])]
    dbn = mp[tasks["id"]]["notion_id"]
    views_now = [client.get(f"/views/{vid}") for vid in adapter.list_view_ids(dbn)]
    rep["views"] = sorted((x["name"], x["type"], bool(x.get("dashboard_view_id"))) for x in views_now)
    rep["view_filter_sample"] = next((x.get("filter") for x in views_now if x["name"] == "Everything"), None)
    before2 = client.write_requests
    plan_scope(w.db, conn, adapter, database_ids=[tasks["id"]])
    rep["views_resend_writes"] = client.write_requests - before2
    w.db.tables["db_properties"][:] = [p_ for p_ in w.db.tables["db_properties"] if p_["key"] != "nt"]
    next(p_ for p_ in w.db.tables["db_properties"] if p_["key"] == "hrs")["name"] = "Effort (h)"
    w.add_prop(tds, "Extra", "checkbox", key="ex")
    go("3_schema_edit", database_ids=[tasks["id"]])
    rep["3_names_after"] = sorted(client.get(f"/data_sources/{mp[tds['id']]['notion_id']}")["properties"])
    return rep, w.db


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--m2", action="store_true", help="send the M2 fixture (tables, callouts, columns, files, cover)")
    ap.add_argument("--m3", action="store_true", help="the hierarchy/mentions/move/archive scenario")
    ap.add_argument("--m4", action="store_true", help="edited-in-Notion protection: hold back, copy, overwrite")
    ap.add_argument("--m6", action="store_true", help="databases: schema, relations, rollup, formula, rows")
    ap.add_argument("--keep", action="store_true", help="do not trash the test pages afterwards")
    args = ap.parse_args()
    token = settings.notion_test_token
    if not token:
        sys.exit("NOTION_TEST_TOKEN is not set in backend/.env")
    client = NotionClient(token)
    adapter = NotionAdapter(client)
    pages = [p for p in adapter.list_shared_pages() if p.top]
    if len(pages) != 1 or not pages[0].title.startswith("SB-TEST-"):
        sys.exit(f"Refusing to run: the shared root must be one page titled SB-TEST-… (found {[p.title for p in pages]})")
    root = pages[0]
    bot = adapter.whoami()
    user = "live-user"
    if args.m3 or args.m4 or args.m6:
        report = {"root": root.title}
        try:
            r, db3 = (run_m4 if args.m4 else run_m6 if args.m6 else run_m3)(client, adapter, root, bot)
            report.update(r)
        finally:
            if not args.keep:
                trashed = []
                for b in adapter._children(root.id):
                    title = (b.get("child_page") or b.get("child_database") or {}).get("title", "")
                    if b["type"] == "child_database" or title.startswith(("SB-TEST", "🗄")):
                        client.delete(f"/blocks/{b['id']}")
                        trashed.append(title)
                report["cleanup_trashed"] = trashed
            report["total_requests"] = client.requests
        print(json.dumps(report, indent=1, ensure_ascii=False))
        return
    note = {"id": "00000000-0000-4000-8000-00000000m1ff", "user_id": user, "title": "SB-TEST M1 note",
            "icon": "🧪", "content": fixture_content(), "sensitivity": "personal", "deleted_at": None}
    if args.m2:
        note.update(title="SB-TEST M2 note", content=m2_content(),
                    cover_image_url="https://files.sb.test/p/cover.png?token=1")
        adapter.files = StaticFiles()
    db = FakeDB(notes=[note], notion_mappings=[], notion_runs=[], notion_run_items=[],
                notion_connections=[{"id": "live-c", "user_id": user, "status": "active", "bot_user_id": bot.bot_id,
                                     "root_page_id": root.id, "privacy_ceiling": "personal",
                                     "token_ciphertext": "x", "token_hint": "…live"}])
    conn = conn_mod.load(db, user)
    report: dict = {"root": root.title}
    container_id = None
    try:
        eng = Engine(db, conn, adapter)
        plan = plan_notes(db, conn, adapter, [note["id"]])
        item = plan.items[0]
        report["plan"] = {"state": item.state, "fidelity": item.fidelity, "est_requests": item.est_requests,
                          "losses": [loss["code"] for loss in item.losses]}
        t0 = time.time()
        res = eng.run(plan.items)
        report["send1"] = {"status": res.status, "requests": res.requests, "seconds": round(time.time() - t0, 1),
                           "items": [(i.status, i.message) for i in res.items], "url": res.items[0].notion_url}
        m = db.tables["notion_mappings"]
        page_id = next((x["notion_id"] for x in m if x["local_kind"] == "note"), None)
        if page_id:
            kids = adapter._children(page_id)
            report["readback_types"] = [k["type"] for k in kids]
            report["readback_text_len"] = sum(len(t.get("plain_text", "")) for k in kids if k["type"] == "paragraph"
                                              for t in k["paragraph"]["rich_text"])
        container_id = next((x["notion_parent_id"] for x in m if x["local_kind"] == "container"), None)

        before = client.write_requests
        plan2 = plan_notes(db, conn, adapter, [note["id"]])
        res2 = Engine(db, conn, adapter).run(plan2.items)
        report["send2"] = {"state": plan2.items[0].state, "write_calls": client.write_requests - before,
                           "nothing_to_send": plan2.to_dict()["nothing_to_send"], "items": len(res2.items)}

        db.tables["notes"][0]["content"].append(B("paragraph", [T("added after the first send")]))
        plan3 = plan_notes(db, conn, adapter, [note["id"]])
        res3 = Engine(db, conn, adapter).run(plan3.items)
        report["send3_changed"] = {"state": plan3.items[0].state, "status": res3.status,
                                   "items": [(i.status, i.action, i.message) for i in res3.items], "requests": res3.requests}
    finally:
        if container_id and not args.keep:
            # test cleanup only: trash the Notes database we created under the TEST root
            try:
                client.delete(f"/blocks/{container_id}")
                report["cleanup"] = "Notes database moved to trash"
            except Exception as e:                      # pragma: no cover
                report["cleanup"] = f"FAILED: {e}"
        report["total_requests"] = client.requests
    print(json.dumps(report, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
