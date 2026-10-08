"""How long does a big send take? Measured against the TEST workspace.

  cd backend && venv/bin/python -m evals.notion_scale --notes 40 [--blocks 20]

Sends N synthetic notes (in-memory DB; nothing of yours is read), then a 5% edit,
then a no-change send, and prints requests, seconds, requests/second and the
extrapolation to 500 and 10,000 notes. Everything it creates is moved to the test
workspace's trash at the end.
"""
from __future__ import annotations

import argparse
import json
import sys
import time

from core.config import settings
from evals.notion_m1_live import B, T
from services.notion_sync import connection as conn_mod
from services.notion_sync.engine.runner import Engine
from services.notion_sync.notion.adapter import NotionAdapter
from services.notion_sync.notion.client import NotionClient
from services.notion_sync.planner import plan_scope
from tests.fake_db import FakeDB


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--notes", type=int, default=40)
    ap.add_argument("--blocks", type=int, default=20)
    args = ap.parse_args()
    if not settings.notion_test_token:
        sys.exit("NOTION_TEST_TOKEN is not set in backend/.env")
    client = NotionClient(settings.notion_test_token)
    adapter = NotionAdapter(client)
    tops = [p for p in adapter.list_shared_pages() if p.top]
    if len(tops) != 1 or not tops[0].title.startswith("SB-TEST-"):
        sys.exit(f"Refusing to run: the shared root must be one page titled SB-TEST-… (found {[p.title for p in tops]})")
    root, bot, user = tops[0], adapter.whoami(), "scale-user"
    notes = [{"id": f"00000000-0000-4000-8000-{i:012d}", "user_id": user, "title": f"SB-TEST scale {i}", "collection_id": None,
              "sensitivity": "personal", "deleted_at": None,
              "content": [B("paragraph", [T(f"note {i} paragraph {k} " + "lorem ipsum " * 6)]) for k in range(args.blocks)]}
             for i in range(args.notes)]
    db = FakeDB(collections=[], notes=notes, notion_mappings=[], notion_runs=[], notion_run_items=[],
                notion_connections=[{"id": "scale-c", "user_id": user, "status": "active", "bot_user_id": bot.bot_id,
                                     "root_page_id": root.id, "privacy_ceiling": "personal", "token_ciphertext": "x", "token_hint": "…"}])
    conn = conn_mod.load(db, user)
    ids = [n["id"] for n in db.tables["notes"]]
    out: dict = {"notes": args.notes, "blocks_per_note": args.blocks}
    try:
        def phase(tag, edit=None):
            if edit:
                edit()
            t0, r0 = time.time(), client.requests
            plan = plan_scope(db, conn, adapter, note_ids=ids)
            t_plan = time.time() - t0
            res = Engine(db, conn, adapter).run(plan.items)
            dt = time.time() - t0
            out[tag] = {"plan_s": round(t_plan, 1), "total_s": round(dt, 1), "requests": client.requests - r0,
                        "writes": res.requests, "sent": len(res.items), "status": res.status,
                        "req_per_s": round((client.requests - r0) / dt, 2) if dt else 0}
        phase("first_send")
        phase("edit_5_percent", lambda: [n.__setitem__("content", n["content"] + [B("paragraph", [T("edited")])])
                                         for n in db.tables["notes"][:max(1, args.notes // 20)]])
        phase("no_change")
        per_note = out["first_send"]["requests"] / args.notes
        out["extrapolated"] = {f"{n}_notes": f"~{n * per_note:,.0f} requests, ~{n * per_note / 2.5 / 3600:.1f} h at 2.5 req/s" for n in (500, 10000)}
    finally:
        for b in adapter._children(root.id):
            if b["type"] == "child_database":
                client.delete(f"/blocks/{b['id']}")
        out["total_requests"] = client.requests
        print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
