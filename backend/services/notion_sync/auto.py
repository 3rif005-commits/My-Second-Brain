"""Auto-sync: rules (per note / collection / database / everything) that send changes without
being asked, on a schedule (DESIGN §6.4).

Hard limits, enforced here and tested: auto-sync NEVER releases a private note (D4), never
overwrites a page edited in Notion (those wait as "needs you"), never archives a deleted note
(D2), and backs off an item that failed (so a broken note is not retried every minute).
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone

from services.notion_sync import connection as conn_mod
from services.notion_sync.engine.runner import Engine, connection_lock
from services.notion_sync.engine.store import Store
from services.notion_sync.engine.worker import LIVE_RUNS, kill_switch, recover_interrupted
from services.notion_sync.notion.client import NotionClient
from services.notion_sync.planner import NEEDS_YOU, Plan, plan_scope
from services.notion_sync.scope import DEFAULT_INCLUDE, _parse, rule_scope

log = logging.getLogger(__name__)

DEBOUNCE = timedelta(minutes=10)         # on_change waits this long after the last edit
FAIL_BACKOFF = timedelta(minutes=15)
MAX_ITEMS_PER_TICK = 40


def due_notes(db, conn, ids: list[str], now: datetime, *, daily: bool) -> list[str]:
    """Notes in scope worth planning now: never sent, or edited after their last send (and, for
    on_change, quiet for DEBOUNCE). A failed item waits FAIL_BACKOFF."""
    if not ids:
        return []
    rows = db.table("notes").select("id, updated_at").eq("user_id", conn.user_id).in_("id", ids).is_("deleted_at", "null").execute().data or []
    maps = {m["local_id"]: m for m in db.table("notion_mappings").select("*").eq("connection_id", conn.id)
            .eq("local_kind", "note").execute().data or [] if not m.get("local_sub")}
    out = []
    for r in rows:
        nid = str(r["id"])
        m = maps.get(nid)
        upd = _parse(r.get("updated_at"))
        if m and m.get("state") in ("failed", "creating") and (_parse(m.get("updated_at")) or now) > now - FAIL_BACKOFF:
            continue
        if m and m.get("paused"):
            continue
        sent = _parse(m.get("last_pushed_at")) if m else None
        changed = m is None or not m.get("notion_id") or not m.get("local_hash") or (upd and sent and upd > sent)
        if not changed:
            continue
        if not daily and upd and upd > now - DEBOUNCE:
            continue
        out.append(nid)
    return out


def rules_for(db, conn) -> list[dict]:
    return db.table("notion_rules").select("*").eq("connection_id", conn.id).execute().data or []


def daily_due(store: Store, now: datetime) -> bool:
    for r in store.runs(30):
        if r.get("trigger") == "auto" and (r.get("scope") or {}).get("mode") == "daily":
            t = _parse(r.get("started_at") or r.get("created_at"))
            if t and t > now - timedelta(hours=23, minutes=30):
                return False
    return True


def tick_connection(db, conn, client_factory, now: datetime) -> dict | None:
    """One auto-sync pass for one connection. -> a summary, or None when there was nothing to do."""
    if conn.status != "active" or not conn.root_page_id:
        return None
    rules = [r for r in rules_for(db, conn) if r.get("mode") in ("on_change", "daily")]
    if not rules:
        return None
    store = Store(db, conn.user_id, conn.id)
    recover_interrupted(db, store)
    lock = connection_lock(conn.id)
    if not lock.acquire(blocking=False):
        return None
    try:
        modes = {"on_change"} | ({"daily"} if daily_due(store, now) else set())
        note_ids: list[str] = []
        coll_ids: list[str] = []
        db_ids: list[str] = []
        include = {**DEFAULT_INCLUDE, **(conn.row.get("include") or {})}
        for r in rules:
            if r["mode"] not in modes:
                continue
            ns, cs, ds = rule_scope(db, conn.user_id, r, include)
            note_ids += due_notes(db, conn, ns, now, daily=r["mode"] == "daily") if ns else []
            if cs:
                note_ids += due_notes(db, conn, _notes_under(db, conn.user_id, cs), now, daily=r["mode"] == "daily")
            db_ids += ds
        note_ids = list(dict.fromkeys(note_ids))[:MAX_ITEMS_PER_TICK]
        if not note_ids and not (db_ids and "daily" in modes):
            return None
        adapter = conn_mod.adapter_for(conn, client_factory(conn, kill_switch(db, conn.id)))
        plan = plan_scope(db, conn, adapter, note_ids=note_ids, database_ids=db_ids if "daily" in modes else [])
        items = [i for i in plan.items if i.sendable][:MAX_ITEMS_PER_TICK]
        if not items:
            waiting = sum(i.state == NEEDS_YOU for i in plan.items)
            return {"sent": 0, "needs_you": waiting} if waiting else None
        engine = Engine(db, conn, adapter)
        run, sendable, recs = engine.prepare(items, frozenset(), "auto")      # never released, never resolved
        db.table("notion_runs").update({"scope": {"mode": "daily" if "daily" in modes else "on_change",
                                                  "rules": [r["id"] for r in rules]}}).eq("id", run["id"]).execute()
        LIVE_RUNS.add(run["id"])
        try:
            res = engine.execute(run, sendable, recs, frozenset())
        finally:
            LIVE_RUNS.discard(run["id"])
        return {"sent": sum(i.status == "done" for i in res.items), "failed": sum(i.status == "failed" for i in res.items),
                "needs_you": sum(i.status == "needs_you" for i in res.items), "run_id": run["id"], "status": res.status}
    finally:
        lock.release()


def _notes_under(db, user_id: str, collection_ids: list[str]) -> list[str]:
    from services.notion_sync.planner import fetch_collections, subtree
    tree = subtree(fetch_collections(db, user_id), collection_ids)
    if not tree:
        return []
    rows = db.table("notes").select("id").eq("user_id", user_id).in_("collection_id", tree).is_("deleted_at", "null").execute().data or []
    return [str(r["id"]) for r in rows]


def default_client(conn, gate):
    return NotionClient(conn.token(), gate=gate)


def run_due(db=None, client_factory=default_client, now: datetime | None = None) -> list[dict]:
    """The scheduler's entry point: one pass over every active connection."""
    if db is None:
        from services.database import get_supabase
        db = get_supabase()
    now = now or datetime.now(timezone.utc)
    out = []
    for r in db.table("notion_connections").select("*").eq("status", "active").execute().data or []:
        try:
            conn = conn_mod.load(db, r["user_id"])
            if conn is None:
                continue
            res = tick_connection(db, conn, client_factory, now)
            if res:
                out.append({"connection": conn.id, **res})
        except Exception:
            log.exception("notion auto-sync failed for connection %s", r.get("id"))
    return out
