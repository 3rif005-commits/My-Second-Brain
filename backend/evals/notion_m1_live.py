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


def main():
    ap = argparse.ArgumentParser()
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
    note = {"id": "00000000-0000-4000-8000-00000000m1ff", "user_id": user, "title": "SB-TEST M1 note",
            "icon": "🧪", "content": fixture_content(), "sensitivity": "personal", "deleted_at": None}
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
