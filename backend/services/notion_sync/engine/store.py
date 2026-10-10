"""Persistence for the identity map and runs (tables from migration 030).
Every query is scoped to the connection (and so to the user)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

CONTAINER = "container"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, db, user_id: str, connection_id: str):
        self.db, self.user_id, self.cid = db, user_id, connection_id

    # ---- mappings --------------------------------------------------------------
    def mapping(self, kind: str, local_id: str, sub: str = "") -> dict | None:
        rows = (self.db.table("notion_mappings").select("*").eq("connection_id", self.cid)
                .eq("local_kind", kind).eq("local_id", local_id).eq("local_sub", sub)
                .execute().data or [])
        return rows[0] if rows else None

    def mappings_for(self, kind: str, ids: list[str]) -> dict[str, dict]:
        if not ids:
            return {}
        rows = (self.db.table("notion_mappings").select("*").eq("connection_id", self.cid)
                .eq("local_kind", kind).in_("local_id", ids).execute().data or [])
        return {r["local_id"]: r for r in rows if not r.get("local_sub")}

    def begin_create(self, kind: str, local_id: str, sub: str = "",
                     parent: str | None = None) -> tuple[dict, bool]:
        """INSERT the mapping in state 'creating' BEFORE any create call.
        -> (row, created_by_us). The unique key arbitrates: a second worker
        loses and gets the existing row back."""
        existing = self.mapping(kind, local_id, sub)
        if existing:
            return existing, False
        try:
            row = (self.db.table("notion_mappings").insert({
                "user_id": self.user_id, "connection_id": self.cid, "local_kind": kind,
                "local_id": local_id, "local_sub": sub, "state": "creating",
                "create_token": str(uuid.uuid4()), "create_started_at": now(), "updated_at": now(),
                "notion_parent_id": parent}).execute().data or [None])[0]
        except Exception:
            row = None
        if row is None:                       # lost the race (unique violation)
            return self.mapping(kind, local_id, sub), False
        return row, True

    def cas(self, mapping_id: str, from_state: str, fields: dict) -> bool:
        """Compare-and-set on `state`. True when this caller won."""
        res = (self.db.table("notion_mappings")
               .update({**fields, "updated_at": now()})
               .eq("id", mapping_id).eq("state", from_state).execute().data or [])
        return bool(res)

    def update(self, mapping_id: str, fields: dict) -> None:
        (self.db.table("notion_mappings").update({**fields, "updated_at": now()})
         .eq("id", mapping_id).execute())

    def detached_page_ids(self, note_id: str) -> set[str]:
        """Pages of this note we deliberately stopped touching (a 'Keep both' original)."""
        rows = (self.db.table("notion_mappings").select("notion_id, local_sub").eq("connection_id", self.cid)
                .eq("local_kind", "note").eq("local_id", note_id).eq("state", "detached").execute().data or [])
        return {r["notion_id"] for r in rows if r.get("notion_id")}

    def forget_one(self, kind: str, local_id: str, sub: str = "") -> None:
        (self.db.table("notion_mappings").delete().eq("connection_id", self.cid).eq("local_kind", kind)
         .eq("local_id", local_id).eq("local_sub", sub).execute())

    def forget_all(self, kind: str | None = None) -> int:
        q = self.db.table("notion_mappings").delete().eq("connection_id", self.cid)
        if kind:
            q = q.eq("local_kind", kind)
        return len(q.execute().data or [])

    # ---- runs --------------------------------------------------------------------
    def new_run(self, scope: dict, plan: dict, released: list[str], trigger: str = "manual") -> dict:
        return (self.db.table("notion_runs").insert({
            "user_id": self.user_id, "connection_id": self.cid, "trigger": trigger,
            "scope": scope, "plan": plan, "released": released, "status": "queued"}).execute().data)[0]

    def begin_run(self, run_id: str) -> None:
        (self.db.table("notion_runs").update({"status": "running", "started_at": now()})
         .eq("id", run_id).execute())

    def runs(self, limit: int = 20) -> list[dict]:
        rows = (self.db.table("notion_runs").select("*").eq("connection_id", self.cid)
                .order("created_at", desc=True).limit(limit).execute().data or [])
        return rows

    def run(self, run_id: str) -> dict | None:
        rows = (self.db.table("notion_runs").select("*").eq("id", run_id).eq("connection_id", self.cid)
                .execute().data or [])
        return rows[0] if rows else None

    def run_items(self, run_id: str) -> list[dict]:
        return (self.db.table("notion_run_items").select("*").eq("run_id", run_id)
                .order("created_at").execute().data or [])

    def finish_run(self, run_id: str, status: str, counts: dict, requests: int) -> None:
        (self.db.table("notion_runs").update({
            "status": status, "counts": counts, "requests_used": requests,
            "finished_at": now()}).eq("id", run_id).execute())

    def new_item(self, run_id: str, note_id: str, action: str, mapping_id: str | None, kind: str = "note") -> dict:
        return (self.db.table("notion_run_items").insert({
            "user_id": self.user_id, "run_id": run_id, "mapping_id": mapping_id,
            "local_kind": kind, "local_id": note_id, "action": action,
            "status": "queued"}).execute().data)[0]

    def start_item(self, item_id: str) -> None:
        (self.db.table("notion_run_items").update({"status": "running", "attempts": 1, "updated_at": now()})
         .eq("id", item_id).execute())

    def finish_item(self, item_id: str, status: str, *, error_class: str | None = None,
                    error_code: str | None = None, message: str | None = None) -> None:
        (self.db.table("notion_run_items").update({
            "status": status, "error_class": error_class, "error_code": error_code,
            "message": message, "updated_at": now()}).eq("id", item_id).execute())
