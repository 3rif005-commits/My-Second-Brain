"""Settings → Notion and "Send to Notion…": connect, plan (dry run), send, status.

Design: docs/notion-sync/DESIGN.md §6-7. The token is Fernet-encrypted at rest and
never returned; the API shows only "…last4".
"""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from routers.ingest import get_user_id
from services import secrets
from services.database import get_supabase
from services.notion_sync import connection as conn_mod
from services.notion_sync.engine.runner import Engine, connection_lock
from services.notion_sync.engine.store import Store, now
from services.notion_sync.notion.adapter import NotionAdapter, page_url
from services.notion_sync.notion.client import NotionClient
from services.notion_sync.notion.errors import NotConnected, NotionError, plain_message
from services.notion_sync.planner import plan_notes

router = APIRouter(prefix="/notion", tags=["notion"])


class ConnectBody(BaseModel):
    token: str = Field(min_length=8, max_length=500)


class RootBody(BaseModel):
    page_id: str


class SendBody(BaseModel):
    note_ids: list[str] = Field(min_length=1, max_length=200)
    released: list[str] = []


def _client(token: str) -> NotionClient:      # patched in tests
    return NotionClient(token)


def _need_conn(user_id: str):
    conn = conn_mod.load(get_supabase(), user_id)
    if conn is None:
        raise HTTPException(409, {"error": "Notion is not connected.", "error_code": "NOT_CONNECTED"})
    return conn


def _adapter(conn) -> NotionAdapter:
    try:
        return conn_mod.adapter_for(conn, _client(conn.token()))
    except NotConnected as e:
        raise HTTPException(409, {"error": str(e), "error_code": "PAUSED" if conn.status == "paused" else "NOT_CONNECTED"})
    except (secrets.SecretsUnavailable, secrets.SecretUnreadable):
        raise HTTPException(500, {"error": "The stored Notion token cannot be read. Reconnect.",
                                  "error_code": "SECRET_UNREADABLE"})


def _notion_error(e: NotionError) -> HTTPException:
    return HTTPException(502 if e.error_class == "retryable" else 400,
                         {"error": plain_message(e), "error_code": e.code.upper()})


def _public(conn, root_title: str | None = None) -> dict:
    return {"connected": True, "status": conn.status, "workspace_name": conn.workspace_name,
            "token_hint": conn.token_hint, "privacy_ceiling": conn.privacy_ceiling,
            "root": ({"id": conn.root_page_id, "title": root_title, "url": page_url(conn.root_page_id)}
                     if conn.root_page_id else None)}


@router.get("/status")
def status(detail: bool = False, authorization: str = Header(...)):
    """`detail=1` also asks Notion for the root page's title (one read)."""
    user_id = get_user_id(authorization)
    conn = conn_mod.load(get_supabase(), user_id)
    if conn is None:
        return {"connected": False}
    title = None
    if detail and conn.root_page_id and conn.status == "active":
        try:
            title = _adapter(conn).get_page(conn.root_page_id).title or None
        except Exception:
            title = None
    return _public(conn, title)


@router.post("/connect")
def connect(body: ConnectBody, authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    token = body.token.strip()
    client = _client(token)
    try:
        bot = NotionAdapter(client).whoami()
    except NotionError as e:
        if e.status in (401, 403):
            raise HTTPException(400, {"error": "Notion didn't accept that token. Copy it again from the connection's Configuration tab.",
                                      "error_code": "BAD_TOKEN"})
        raise _notion_error(e)
    if not bot.is_bot:
        raise HTTPException(400, {"error": "That token isn't an internal connection token (it must belong to a bot).",
                                  "error_code": "NOT_A_BOT"})
    try:
        sealed = secrets.encrypt(token)
    except secrets.SecretsUnavailable as e:
        raise HTTPException(500, {"error": str(e), "error_code": "SECRETS_UNAVAILABLE"})
    db = get_supabase()
    fields = {"workspace_id": bot.workspace_id, "workspace_name": bot.workspace_name, "bot_user_id": bot.bot_id,
              "token_ciphertext": sealed.ciphertext.decode(), "token_key_id": sealed.key_id,
              "token_hint": secrets.hint(token), "status": "active", "last_ok_at": now(), "updated_at": now()}
    existing = conn_mod.load(db, user_id)
    if existing:
        db.table("notion_connections").update(fields).eq("id", existing.id).execute()
    else:
        db.table("notion_connections").insert({"user_id": user_id, **fields}).execute()
    conn = conn_mod.load(db, user_id)
    return {**_public(conn), "pages": _pages(NotionAdapter(client))}


def _pages(adapter: NotionAdapter) -> list[dict]:
    return [{"id": p.id, "title": p.title, "icon": p.icon, "url": p.url, "top": p.top}
            for p in adapter.list_shared_pages()]


@router.get("/pages")
def pages(authorization: str = Header(...)):
    conn = _need_conn(get_user_id(authorization))
    try:
        return {"pages": _pages(_adapter(conn))}
    except NotionError as e:
        raise _notion_error(e)


@router.post("/root")
def set_root(body: RootBody, authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    conn = _need_conn(user_id)
    adapter = _adapter(conn)
    try:
        page = adapter.get_page(body.page_id)
    except NotionError as e:
        raise _notion_error(e)
    if page.unreachable:
        raise HTTPException(400, {"error": "Notion can't see that page. Share it with the connection first.",
                                  "error_code": "PAGE_NOT_SHARED"})
    forgotten = 0
    db = get_supabase()
    if conn.root_page_id and conn.root_page_id != body.page_id:
        # Notes already sent live under the old root and stay there; forgetting the
        # mappings means they are sent again, fresh, to the new one. Nothing in Notion is touched.
        forgotten = Store(db, user_id, conn.id).forget_all()
    db.table("notion_connections").update({"root_page_id": body.page_id, "updated_at": now()}).eq("id", conn.id).execute()
    out = _public(conn_mod.load(db, user_id), page.title)
    return {**out, "forgotten_mappings": forgotten}


@router.post("/disconnect")
def disconnect(authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    conn = conn_mod.load(get_supabase(), user_id)
    if conn:
        # Wipes the token and the identity map. Pages already in Notion are left alone.
        get_supabase().table("notion_connections").delete().eq("id", conn.id).execute()
    return {"connected": False, "reminder": "Also remove the connection in Notion (••• → Connections) to revoke the token there."}


@router.post("/plan")
def plan(body: SendBody, authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    conn = _need_conn(user_id)
    if not conn.root_page_id:
        raise HTTPException(409, {"error": "Pick the Notion page to send to first.", "error_code": "NO_ROOT"})
    adapter = _adapter(conn)
    p = plan_notes(get_supabase(), conn, adapter, body.note_ids, frozenset(body.released))
    return p.to_dict()


@router.post("/send")
def send(body: SendBody, authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    conn = _need_conn(user_id)
    if not conn.root_page_id:
        raise HTTPException(409, {"error": "Pick the Notion page to send to first.", "error_code": "NO_ROOT"})
    lock = connection_lock(conn.id)
    if not lock.acquire(blocking=False):
        raise HTTPException(409, {"error": "A send is already running.", "error_code": "BUSY"})
    try:
        adapter = _adapter(conn)
        released = frozenset(body.released)
        # Re-plan on the server: never trust a plan the browser sends back.
        p = plan_notes(get_supabase(), conn, adapter, body.note_ids, released)
        if not p.sendable:
            return {"status": "nothing_to_send", "items": [], "requests": 0, "plan": p.to_dict()}
        res = Engine(get_supabase(), conn, adapter).run(p.items, released)
        return {**res.to_dict(), "plan": p.to_dict()}
    finally:
        lock.release()


@router.get("/notes/{note_id}")
def note_status(note_id: str, authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    conn = conn_mod.load(get_supabase(), user_id)
    if conn is None:
        return {"connected": False, "state": "not_connected"}
    m = Store(get_supabase(), user_id, conn.id).mapping("note", note_id)
    if not m or not m.get("notion_id"):
        return {"connected": True, "state": "never_sent"}
    return {"connected": True, "state": m["state"], "notion_url": page_url(m["notion_id"]),
            "last_pushed_at": m.get("last_pushed_at"), "losses": m.get("losses") or [],
            "error": m.get("error_message")}
