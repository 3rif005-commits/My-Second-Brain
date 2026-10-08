"""Read a backup back. `plan` changes nothing. `apply` is NON-destructive: it creates everything as
NEW notes/folders/chats under a "Restored from backup <date>" folder; it never overwrites or deletes
what is there. (Database rows are not re-created automatically: `rows.csv` / `rows.jsonl` are in the
archive for that; the plan says so.)"""
from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from . import archive

NOTE_DROP = {"id", "user_id", "created_at", "updated_at", "fts", "content_hash", "indexed_hash", "embedding", "is_indexed"}


def plan(path: Path) -> dict:
    problems = archive.verify(path)
    m = archive.read_manifest(path)
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        rows = [json.loads(z.read(n)) for n in names if n.startswith("notes/") and n.endswith(".json") and not n.endswith(".ir.json")]
    live = [r for r in rows if not (r.get("note") or {}).get("deleted_at") and r.get("note")]
    return {"ok": not problems, "problems": problems, "created_at": m.get("created_at"), "counts": m.get("counts"),
            "would_create": {"folders": m["counts"]["collections"], "notes": len(live), "chats": m["counts"]["threads"]},
            "not_restored": {"database_rows": m["counts"]["rows"], "deleted_notes": m["counts"]["deleted_notes"],
                             "files": m["counts"]["files"],
                             "why": "Databases and files are in the archive (rows.csv, files/) but are not re-created automatically."},
            "never_overwrites": True}


def _remap(value, ids: dict[str, str]):
    """Links between notes (mentions) follow the new ids."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            out[k] = ids.get(v, v) if k == "noteId" and isinstance(v, str) else _remap(v, ids)
        return out
    if isinstance(value, list):
        return [_remap(v, ids) for v in value]
    return value


def apply(db, user_id: str, path: Path, *, now: datetime | None = None) -> dict:
    p = plan(path)
    if not p["ok"]:
        raise ValueError("The archive is damaged: " + "; ".join(p["problems"][:3]))
    now = now or datetime.now(timezone.utc)
    with zipfile.ZipFile(path) as z:
        colls = json.loads(z.read("collections.json"))
        notes = [json.loads(z.read(n)) for n in z.namelist() if n.startswith("notes/") and n.endswith(".json") and not n.endswith(".ir.json")]
        threads = [json.loads(z.read(n)) for n in z.namelist() if n.startswith("threads/")]
    top = db.table("collections").insert({"user_id": user_id, "name": f"Restored from backup {now:%Y-%m-%d}", "icon": "♻️"}).execute().data[0]
    cmap: dict[str, str] = {}
    pending = list(colls)
    for _ in range(len(colls) + 1):                                      # parents before children, whatever the order
        for c in list(pending):
            if c.get("parent_id") and c["parent_id"] not in cmap:
                continue
            row = db.table("collections").insert({
                "user_id": user_id, "name": c.get("name") or "Untitled folder", "icon": c.get("icon") or "📁", "color": c.get("color"),
                "description": c.get("description"), "position": c.get("position") or 0,
                "parent_id": cmap[c["parent_id"]] if c.get("parent_id") else top["id"]}).execute().data[0]
            cmap[c["id"]] = row["id"]
            pending.remove(c)
    ids: dict[str, str] = {}
    live = [r["note"] for r in notes if r.get("note") and not r["note"].get("deleted_at")]
    for n in live:                                                       # first pass: create (content is fixed in the second)
        body = {k: v for k, v in n.items() if k not in NOTE_DROP and k != "deleted_at"}
        body.update(user_id=user_id, collection_id=cmap.get(n.get("collection_id")) or top["id"], content=[])
        ids[n["id"]] = db.table("notes").insert(body).execute().data[0]["id"]
    for n in live:
        db.table("notes").update({"content": _remap(n.get("content") or [], ids)}).eq("id", ids[n["id"]]).eq("user_id", user_id).execute()
    made_threads = 0
    for t in threads:
        db.table("chat_threads").insert({"user_id": user_id, "title": t.get("title"), "messages": t.get("messages") or [],
                                         "context_note_ids": [ids[c] for c in t.get("context_note_ids") or [] if c in ids],
                                         "model_mode": t.get("model_mode")}).execute()
        made_threads += 1
    return {"folder_id": top["id"], "folders": len(cmap), "notes": len(ids), "chats": made_threads}
