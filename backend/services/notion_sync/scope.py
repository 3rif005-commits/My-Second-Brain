"""What "everything" means, and what the mirror looks like from the outside."""
from __future__ import annotations

from datetime import datetime, timezone

from services import privacy
from services.notion_sync.connection import Connection
from services.notion_sync.planner import ancestors, fetch_collections

DEFAULT_INCLUDE = {"collections": True, "notes": True, "databases": True, "embedded_files": True,
                   "source_files": False, "threads": False, "skills": False}


def _parse(ts) -> datetime | None:
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except Exception:
        return None


def row_note_ids(db, user_id: str) -> set[str]:
    """Notes that are rows of a user database (they travel with their database)."""
    rows = db.table("db_row_props").select("note_id").eq("user_id", user_id).execute().data or []
    return {str(r["note_id"]) for r in rows}


def all_scope(db, user_id: str, include: dict | None = None) -> tuple[list[str], list[str], list[str]]:
    """-> (note ids, root collection ids, database ids) of the whole brain, per the D5 toggles.
    Collections are sent as roots ("with everything inside"); loose notes are listed."""
    inc = {**DEFAULT_INCLUDE, **(include or {})}
    notes: list[str] = []
    colls: list[str] = []
    dbs: list[str] = []
    if inc["notes"]:
        rows = db.table("notes").select("id").eq("user_id", user_id).is_("deleted_at", "null").execute().data or []
        rows_of_dbs = row_note_ids(db, user_id)
        notes = [str(r["id"]) for r in rows if str(r["id"]) not in rows_of_dbs]
    if inc["collections"]:
        cs = fetch_collections(db, user_id)
        colls = [i for i, c in cs.items() if not c.get("parent_id")]
    if inc["databases"]:
        dbs = [str(r["id"]) for r in (db.table("db_databases").select("id").eq("user_id", user_id)
                                      .is_("deleted_at", "null").execute().data or [])]
    return notes, colls, dbs


def rule_scope(db, user_id: str, rule: dict, include: dict | None = None) -> tuple[list[str], list[str], list[str]]:
    kind, sid = rule.get("scope_kind"), rule.get("scope_id")
    if kind == "note":
        return [str(sid)], [], []
    if kind == "collection":
        return [], [str(sid)], []
    if kind == "database":
        return [], [], [str(sid)]
    return all_scope(db, user_id, {**(include or {}), **(rule.get("include") or {})})


def mirror_map(db, conn: Connection) -> dict:
    """Mirror state of every note and collection, for the sidebar dots and the header chip. Cheap
    (no Notion calls, no hashing): "changed" = edited after the last send."""
    user = conn.user_id
    notes = db.table("notes").select("id, collection_id, updated_at, sensitivity, local_only, deleted_at").eq("user_id", user).execute().data or []
    maps = db.table("notion_mappings").select("*").eq("connection_id", conn.id).execute().data or []
    nm = {m["local_id"]: m for m in maps if m["local_kind"] == "note" and not m.get("local_sub")}
    cm = {m["local_id"]: m for m in maps if m["local_kind"] == "collection" and not m.get("local_sub")}
    out_notes: dict[str, str] = {}
    for n in notes:
        nid = str(n["id"])
        m = nm.get(nid)
        if n.get("deleted_at"):
            if m and m.get("state") != "archived" and m.get("notion_id"):
                out_notes[nid] = "deleted"
            continue
        if not m or not m.get("notion_id"):
            if not privacy.allows(conn.privacy_ceiling, privacy.level_of(n)):
                out_notes[nid] = "private"
            continue
        if m.get("paused"):
            out_notes[nid] = "paused"
        elif m.get("state") == "failed" or m.get("error_code") in ("object_not_found", "edited_in_notion"):
            out_notes[nid] = "needs_you" if m.get("error_class") == "needs_user" else "failed"
        elif not privacy.allows(conn.privacy_ceiling, privacy.level_of(n)) and m.get("state") != "synced":
            out_notes[nid] = "private"
        elif (_parse(n.get("updated_at")) or datetime.min.replace(tzinfo=timezone.utc)) > \
                (_parse(m.get("last_pushed_at")) or datetime.min.replace(tzinfo=timezone.utc)) or not m.get("local_hash"):
            out_notes[nid] = "changed"
        else:
            out_notes[nid] = "synced"
    # a folder shows the worst state inside it (and its sub-folders)
    rank = {"failed": 6, "needs_you": 5, "changed": 4, "deleted": 3, "paused": 2, "private": 1, "synced": 0}
    colls = fetch_collections(db, user)
    worst: dict[str, str] = {}
    for n in notes:
        st = out_notes.get(str(n["id"]))
        if st is None or not n.get("collection_id"):
            continue
        for cid in ancestors(colls, str(n["collection_id"])):
            if cid not in worst or rank[st] > rank[worst[cid]]:
                worst[cid] = st
    out_colls: dict[str, str] = {}
    for cid in colls:
        m = cm.get(cid)
        own = None if not m or not m.get("notion_id") else ("failed" if m.get("state") == "failed" else "synced")
        sub = worst.get(cid)
        if own is None and sub is None:
            continue
        out_colls[cid] = sub if sub and (own is None or rank[sub] >= rank[own]) else own
    return {"notes": out_notes, "collections": out_colls}
