"""The user's Notion connection row, and a ready adapter for it."""
from __future__ import annotations

from dataclasses import dataclass

from services import secrets
from services.notion_sync.notion.adapter import NotionAdapter
from services.notion_sync.notion.client import NotionClient
from services.notion_sync.notion.errors import NotConnected


@dataclass
class Connection:
    id: str
    user_id: str
    bot_user_id: str | None
    root_page_id: str | None
    status: str
    privacy_ceiling: str
    token_ciphertext: str
    token_hint: str
    workspace_name: str | None
    row: dict

    def token(self) -> str:
        return secrets.decrypt(self.token_ciphertext.encode())


def load(db, user_id: str) -> Connection | None:
    rows = (db.table("notion_connections").select("*").eq("user_id", user_id)
            .execute().data or [])
    rows = [r for r in rows if r.get("status") != "revoked"]
    if not rows:
        return None
    r = rows[0]
    return Connection(
        id=r["id"], user_id=user_id, bot_user_id=r.get("bot_user_id"),
        root_page_id=r.get("root_page_id"), status=r.get("status") or "active",
        privacy_ceiling=r.get("privacy_ceiling") or "personal",
        token_ciphertext=r.get("token_ciphertext") or "", token_hint=r.get("token_hint") or "…",
        workspace_name=r.get("workspace_name"), row=r)


def adapter_for(conn: Connection, client: NotionClient | None = None, db=None) -> NotionAdapter:
    if conn.status == "paused":
        raise NotConnected("Syncing is paused.")
    if conn.status in ("revoked", "error"):
        raise NotConnected("Notion is disconnected. Reconnect to resume.")
    from urllib.parse import urlparse

    from core.config import settings
    from services.notion_sync.notion.files import HttpFileSource
    own = {urlparse(settings.supabase_url).hostname or ""}
    if client is None:
        gate = None
        if db is not None:
            from services.notion_sync.engine.worker import kill_switch
            gate = kill_switch(db, conn.id)
        client = NotionClient(conn.token(), gate=gate)
    return NotionAdapter(client, files=HttpFileSource(own))
