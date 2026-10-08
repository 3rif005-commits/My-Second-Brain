"""The daily canary (ROBUSTNESS §7.1): is Notion still doing what our code assumes?

  cd backend && venv/bin/python -m evals.notion_canary            # prints a report, exit code 1 on failure
  cron:  5 3 * * *  cd /path/backend && venv/bin/python -m evals.notion_canary --quiet

Uses NOTION_TEST_TOKEN only and refuses to run unless the one shared page is titled SB-TEST-…
(same guard as the live probe). It sends a fixture with every block type, a database with the
property types we create (a two-way relation, a rollup, a formula) and views, reads everything
back and checks it against what the writers say they sent, sends again and expects ZERO writes,
and moves everything it made to the test workspace's trash. The result goes to
~/.secondbrain/notion_canary.json, which Settings → Notion → Health shows.

A failure means "Notion's API behaviour changed (or we broke something)": syncing of unchanged
types keeps working; read the report before changing NOTION_VERSION (docs/notion-sync/NOTION_CHANGES.md).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from core.config import settings
from evals import notion_m1_live as live
from services.notion_sync import connection as conn_mod
from services.notion_sync.engine.runner import Engine
from services.notion_sync.notion.adapter import NotionAdapter
from services.notion_sync.notion.client import NotionClient
from services.notion_sync.notion.version import NOTION_VERSION
from services.notion_sync.planner import plan_scope
from services.notion_sync.readers.note import note_to_ir
from tests.fake_db import FakeDB

RESULT = Path.home() / ".secondbrain" / "notion_canary.json"


class Report:
    def __init__(self):
        self.checks: list[dict] = []

    def check(self, name: str, ok: bool, detail=None):
        self.checks.append({"name": name, "ok": bool(ok), **({"detail": detail} if detail is not None and not ok else {})})
        return ok

    @property
    def ok(self) -> bool:
        return all(c["ok"] for c in self.checks)


class CanaryFiles(live.StaticFiles):
    """Ours for everything, but `big.png` is 4 MiB: just under the free plan's 5 MiB cap (T7)."""
    def fetch(self, url, max_bytes, name_hint=""):
        from services.notion_sync.notion.files import Fetched
        if "big.png" in url:
            return Fetched(live.PNG + b"\0" * (4 * 1024 * 1024 - len(live.PNG)), "image/png", "big.png")
        return super().fetch(url, max_bytes, name_hint)


def _note_roundtrip(rep: Report, client, adapter, root, bot, tag: str, content, cover=None):
    user = "canary"
    note = {"id": f"00000000-0000-4000-8000-{abs(hash(tag)) % 10**12:012d}", "user_id": user, "title": f"SB-TEST canary {tag}",
            "icon": "🧪", "content": content, "sensitivity": "personal", "deleted_at": None,
            **({"cover_image_url": cover} if cover else {})}
    db = FakeDB(collections=[], notes=[note], notion_mappings=[], notion_runs=[], notion_run_items=[],
                notion_connections=[{"id": "canary-c", "user_id": user, "status": "active", "bot_user_id": bot.bot_id,
                                     "root_page_id": root.id, "privacy_ceiling": "personal", "token_ciphertext": "x", "token_hint": "…"}])
    conn = conn_mod.load(db, user)
    plan = plan_scope(db, conn, adapter, note_ids=[note["id"]])
    expected = [b["type"] for b in adapter.render(note_to_ir(db.tables["notes"][0])).blocks]
    res = Engine(db, conn, adapter).run(plan.items)
    rep.check(f"{tag}: send succeeds", res.status == "succeeded", [(i.status, i.message) for i in res.items])
    m = next((x for x in db.tables["notion_mappings"] if x["local_kind"] == "note"), None)
    if m and m.get("notion_id"):
        got = [b["type"] for b in adapter._children(m["notion_id"])]
        rep.check(f"{tag}: Notion holds the blocks we sent", got == expected, {"expected": expected, "got": got})
    before = client.write_requests
    again = plan_scope(db, conn, adapter, note_ids=[note["id"]])
    Engine(db, conn, adapter).run(again.items)
    rep.check(f"{tag}: sending again writes nothing", client.write_requests == before, client.write_requests - before)


def run(token: str) -> dict:
    client = NotionClient(token)
    adapter = NotionAdapter(client)
    rep = Report()
    started = time.time()
    tops = [p for p in adapter.list_shared_pages() if p.top]
    if len(tops) != 1 or not tops[0].title.startswith("SB-TEST-"):
        raise SystemExit(f"Refusing to run: the shared root must be one page titled SB-TEST-… (found {[p.title for p in tops]})")
    root, bot = tops[0], adapter.whoami()
    rep.check("API version pinned", NOTION_VERSION == "2026-03-11", NOTION_VERSION)
    rep.check("token belongs to a bot", bot.is_bot)
    try:
        _note_roundtrip(rep, client, adapter, root, bot, "text blocks", live.fixture_content())
        adapter.files = CanaryFiles()
        big = {"id": "big", "type": "file", "props": {"url": "https://files.sb.test/p/big.png?token=1", "name": "big.png"}, "content": [], "children": []}
        _note_roundtrip(rep, client, adapter, root, bot, "every other block + files", live.m2_content() + [big],
                        cover="https://files.sb.test/p/cover.png?token=1")
        r6, db6 = live.run_m6(client, adapter, root, bot)
        rep.check("databases: schema, relations, rollup, formula, views sent", r6["1_send_tasks_with_linked"]["status"] == "succeeded", r6["1_send_tasks_with_linked"])
        rep.check("databases: sending again writes nothing", r6["2_resend"]["writes"] == 0 and r6["views_resend_writes"] == 0, r6["2_resend"])
        pv = r6.get("person_row", {})
        rep.check("Notion computes our rollup", (pv.get("Total hours") or {}).get("number") == 7, pv)
        rep.check("Notion computes our formula", (r6.get("task_row_values", {}).get("Double") or {}).get("number") == 6, r6.get("task_row_values"))
        want = {"table", "board", "list", "gallery", "calendar", "timeline", "chart", "form", "dashboard"}
        rep.check("all view types are accepted", want <= {t for _, t, _ in r6.get("views", [])}, r6.get("views"))
    finally:
        for b in adapter._children(root.id):
            title = (b.get("child_page") or b.get("child_database") or {}).get("title", "")
            if b["type"] == "child_database" or title.startswith(("SB-TEST", "🗄", "💬", "🧠")):
                client.delete(f"/blocks/{b['id']}")
    return {"when": datetime.now(timezone.utc).isoformat(timespec="seconds"), "api_version": NOTION_VERSION, "ok": rep.ok,
            "seconds": round(time.time() - started, 1), "requests": client.requests, "checks": rep.checks}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quiet", action="store_true", help="print only failures")
    args = ap.parse_args()
    if not settings.notion_test_token:
        sys.exit("NOTION_TEST_TOKEN is not set in backend/.env")
    out = run(settings.notion_test_token)
    RESULT.parent.mkdir(parents=True, exist_ok=True)
    RESULT.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    failed = [c for c in out["checks"] if not c["ok"]]
    if not args.quiet or failed:
        print(json.dumps({**out, "checks": failed if args.quiet else out["checks"]}, indent=1, ensure_ascii=False))
    sys.exit(0 if out["ok"] else 1)


if __name__ == "__main__":
    main()
