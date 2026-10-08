"""A notes row -> IR page (`Obj`)."""
from __future__ import annotations

from services.notion_sync.registry import read_blocks
from services.portable import ir


def note_to_ir(row: dict) -> ir.Obj:
    """`row` is a `notes` table row. Properties (topics, mastery, …) arrive in
    M2/M3; M1 sends title, icon and body."""
    title = (row.get("title") or "").strip() or "Untitled"
    return ir.Obj(
        kind="page", ref=ir.Ref("note", str(row["id"])),
        title=[ir.Text(title)], icon=row.get("icon") or None,
        body=read_blocks(row.get("content") or []))
