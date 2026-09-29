"""Apps connected through the remote MCP server, and the changes they ask for
(5.4, phase 2).

An app may ASK to edit or delete a note; the change waits here until the user
approves it in Settings → Connected apps. Approve applies it (a delete moves
the note to the Trash, restorable); Reject drops it. The app is told plainly
that nothing has changed until then (HARNESS.md: a held action is reported as
NOT done). Tables: mcp_pending_changes (migration 024), mcp_grants (023).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from services.database import get_supabase


class ChangeError(ValueError):
    """A request that cannot become a pending change, in words for the app."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _preview(text: str | None, limit: int = 280) -> str:
    """A short excerpt for a card, not the model-facing full text — "…" only
    when something was actually cut, never claimed otherwise."""
    text = (text or "").strip()
    return text[:limit] + "…" if len(text) > limit else text


def _note(user_id: str, note_id: str) -> dict | None:
    rows = (get_supabase().table("notes").select("id,title,content_text,deleted_at")
            .eq("id", note_id).eq("user_id", user_id).execute().data or [])
    return rows[0] if rows and not rows[0].get("deleted_at") else None


def propose(user_id: str, client_id: str, note_id: str, action: str,
            payload: dict | None = None, reason: str = "") -> dict:
    if action not in ("update", "delete"):
        raise ChangeError("Only 'update' and 'delete' can be asked for.")
    note = _note(user_id, note_id)
    if not note:
        raise ChangeError("No note with that id in this Second Brain.")
    row = get_supabase().table("mcp_pending_changes").insert({
        "user_id": user_id, "client_id": client_id, "note_id": note_id,
        "action": action, "payload": payload or {}, "reason": (reason or "")[:500],
    }).execute().data[0]
    out = {"change_id": row["id"], "status": "pending", "note_title": note["title"],
           "action": action,
           # Short previews for the MCP Apps card (harness 5.4) — the tool's own
           # response already has this text, so the view needs no extra call.
           "current_text_preview": _preview(note["content_text"])}
    if action == "update":
        out["new_text_preview"] = _preview((payload or {}).get("content_markdown"))
    return out


def status(user_id: str, client_id: str, change_id: str) -> dict | None:
    rows = (get_supabase().table("mcp_pending_changes").select("id,status,action,decided_at")
            .eq("id", change_id).eq("user_id", user_id).eq("client_id", client_id)
            .execute().data or [])
    return rows[0] if rows else None


def _client_names(client_ids: set[str]) -> dict[str, str]:
    if not client_ids:
        return {}
    rows = (get_supabase().table("mcp_clients").select("client_id,info")
            .in_("client_id", list(client_ids)).execute().data or [])
    return {r["client_id"]: (r["info"] or {}).get("client_name") or "An app" for r in rows}


def overview(user_id: str) -> dict[str, Any]:
    """What Settings → Connected apps shows: the apps with a live connection,
    and the changes waiting for the user."""
    db = get_supabase()
    now = _now()
    grants = (db.table("mcp_grants").select("client_id,created_at,expires_at")
              .eq("user_id", user_id).eq("kind", "refresh").eq("revoked", False)
              .gt("expires_at", now).execute().data or [])
    connected: dict[str, str] = {}
    for g in grants:                                 # the latest connection per app
        if g["client_id"] not in connected or g["created_at"] > connected[g["client_id"]]:
            connected[g["client_id"]] = g["created_at"]
    pending = (db.table("mcp_pending_changes").select("*")
               .eq("user_id", user_id).eq("status", "pending")
               .order("created_at", desc=True).limit(50).execute().data or [])
    names = _client_names(set(connected) | {p["client_id"] for p in pending})
    notes = {}
    if pending:
        rows = (db.table("notes").select("id,title,content_text")
                .in_("id", list({p["note_id"] for p in pending})).eq("user_id", user_id)
                .execute().data or [])
        notes = {r["id"]: r for r in rows}
    return {
        "apps": [{"client_id": c, "name": names.get(c, "An app"), "connected_at": t}
                 for c, t in sorted(connected.items(), key=lambda x: x[1], reverse=True)],
        "pending": [{
            "id": p["id"], "app": names.get(p["client_id"], "An app"),
            "action": p["action"], "note_id": p["note_id"], "reason": p.get("reason") or "",
            "note_title": (notes.get(p["note_id"]) or {}).get("title") or "Untitled",
            "current_text": ((notes.get(p["note_id"]) or {}).get("content_text") or "")[:4000],
            "new_title": (p.get("payload") or {}).get("title"),
            "new_text": ((p.get("payload") or {}).get("content_markdown") or "")[:4000],
            "created_at": p["created_at"],
        } for p in pending],
    }


def decide(user_id: str, change_id: str, approve: bool) -> dict:
    db = get_supabase()
    rows = (db.table("mcp_pending_changes").select("*").eq("id", change_id)
            .eq("user_id", user_id).eq("status", "pending").execute().data or [])
    if not rows:
        raise ChangeError("That change is no longer waiting.")
    change = rows[0]
    if approve:
        if not _note(user_id, change["note_id"]):
            raise ChangeError("The note is gone — nothing to change.")
        if change["action"] == "delete":
            # To the Trash, restorable — never a permanent delete.
            db.table("notes").update({"deleted_at": _now()}).eq("id", change["note_id"]) \
                .eq("user_id", user_id).execute()
        else:
            from mcp_remote.blocks import markdown_to_blocks
            from services.agent.brain_tools import _update_note
            p = change.get("payload") or {}
            args: dict[str, Any] = {"id": change["note_id"],
                                    "blocks": markdown_to_blocks(p.get("content_markdown") or "")}
            if p.get("title"):
                args["title"] = p["title"]
            _update_note(args, user_id)
    new_status = "approved" if approve else "rejected"
    db.table("mcp_pending_changes").update({"status": new_status, "decided_at": _now()}) \
        .eq("id", change_id).execute()
    return {"id": change_id, "status": new_status}


def disconnect(user_id: str, client_id: str) -> None:
    """Revoke every token of that app for this user; its waiting changes are
    rejected with it."""
    db = get_supabase()
    db.table("mcp_grants").update({"revoked": True}).eq("client_id", client_id) \
        .eq("user_id", user_id).execute()
    db.table("mcp_pending_changes").update({"status": "rejected", "decided_at": _now()}) \
        .eq("client_id", client_id).eq("user_id", user_id).eq("status", "pending").execute()
