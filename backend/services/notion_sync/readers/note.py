"""A notes row -> IR page; a collections row -> IR collection."""
from __future__ import annotations

from services.notion_sync.registry import read_blocks
from services.portable import ir
from services.portable.losses import Loss


def note_to_ir(row: dict) -> ir.Obj:
    title = (row.get("title") or "").strip() or "Untitled"
    cid = row.get("collection_id")
    return ir.Obj(
        kind="page", ref=ir.Ref("note", str(row["id"])),
        parent=ir.Ref("collection", str(cid)) if cid else None,
        title=[ir.Text(title)], icon=row.get("icon") or None,
        cover=row.get("cover_image_url") or None,
        props={"topics": list(row.get("topics") or []), "mastery": row.get("mastery_status"),
               "source_type": row.get("source_type"), "source_url": row.get("source_url"),
               "favorite": bool(row.get("is_favorited")),
               "privacy": row.get("sensitivity") or ("private" if row.get("local_only") else "personal")},
        # not hashed: a timestamp alone is not a reason to re-send
        meta={"created_at": row.get("created_at"), "updated_at": row.get("updated_at")},
        body=read_blocks(row.get("content") or []))


def collection_to_ir(row: dict) -> ir.Obj:
    name = (row.get("name") or "").strip() or "Untitled folder"
    body = []
    desc = (row.get("description") or "").strip()
    if desc:
        body.append(ir.Block("paragraph", inline=[ir.Text(desc)], src_id="description"))
    pid = row.get("parent_id")
    losses = []
    if row.get("color") and row["color"] != "#6366f1":
        losses.append(Loss("lossy", "The folder colour.", "Notion pages have no colour.", "collection_color"))
    return ir.Obj(kind="collection", ref=ir.Ref("collection", str(row["id"])),
                  parent=ir.Ref("collection", str(pid)) if pid else None,
                  title=[ir.Text(name)], icon=row.get("icon") or None, body=body, losses=losses)
