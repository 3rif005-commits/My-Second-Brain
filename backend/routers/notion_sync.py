"""Settings → Notion and "Send to Notion…": connect, plan (dry run), send, status.

Design: docs/notion-sync/DESIGN.md §6-7. The token is Fernet-encrypted at rest and
never returned; the API shows only "…last4".
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from routers.ingest import get_user_id
from services import secrets
from services.database import get_supabase
from services.notion_sync import connection as conn_mod
from services.notion_sync.engine import worker
from services.notion_sync.engine.runner import Engine, connection_lock
from services.notion_sync.engine.worker import kill_switch
from services.notion_sync.engine.store import Store, now
from services.notion_sync.notion.adapter import NotionAdapter, page_url
from services.notion_sync.notion.client import NotionClient
from services.notion_sync.notion.errors import NotConnected, NotionError, plain_message
from services.notion_sync.notion.version import NOTION_VERSION
from services.notion_sync import scope as scope_mod
from services.notion_sync.planner import plan_scope

router = APIRouter(prefix="/notion", tags=["notion"])


class ConnectBody(BaseModel):
    token: str = Field(min_length=8, max_length=500)


class RootBody(BaseModel):
    page_id: str


class SendBody(BaseModel):
    note_ids: list[str] = Field(default=[], max_length=500)
    collection_ids: list[str] = Field(default=[], max_length=50)        # "with everything inside"
    database_ids: list[str] = Field(default=[], max_length=50)          # the table, its schema and its rows
    include_linked: bool = False                                        # also the databases its relations point to
    thread_ids: list[str] = Field(default=[], max_length=500)           # chat threads (off by default in "everything")
    skill_names: list[str] = Field(default=[], max_length=100)
    sources: bool | None = None                                         # add each note's sources; None = the Settings switch
    released: list[str] = []                                           # private notes let through, this send only
    archive_ids: list[str] = []                                        # deleted notes to move to the archive page
    resolutions: dict[str, str] = {}                                    # id -> overwrite | copy | recreate | forget (default: skip)
    only_collection_ids: list[str] = Field(default=[], max_length=200)  # these folders themselves, not what is inside
    exclude: list[str] = Field(default=[], max_length=2000)             # ids the user unticked in the review
    background: bool = False                                           # return at once with a run id; watch GET /runs/{id}
    all: bool = False                                                   # the whole brain, per the Settings toggles (D5)


def _client(token: str, gate=None) -> NotionClient:      # patched in tests
    return NotionClient(token, gate=gate)


def _need_conn(user_id: str):
    conn = conn_mod.load(get_supabase(), user_id)
    if conn is None:
        raise HTTPException(409, {"error": "Notion is not connected.", "error_code": "NOT_CONNECTED"})
    return conn


def _adapter(conn) -> NotionAdapter:
    try:
        gate = kill_switch(get_supabase(), conn.id)            # the kill switch, before every request
        return conn_mod.adapter_for(conn, _client(conn.token(), gate))
    except NotConnected as e:
        raise HTTPException(409, {"error": str(e), "error_code": "PAUSED" if conn.status == "paused" else "NOT_CONNECTED"})
    except (secrets.SecretsUnavailable, secrets.SecretUnreadable):
        raise HTTPException(500, {"error": "The stored Notion token cannot be read. Reconnect.",
                                  "error_code": "SECRET_UNREADABLE"})


def _notion_error(e: NotionError, conn=None) -> HTTPException:
    if conn is not None and (e.status == 401 or e.code == "unauthorized"):
        get_supabase().table("notion_connections").update({"status": "error", "updated_at": now()}).eq("id", conn.id).execute()
    return HTTPException(502 if e.error_class == "retryable" else 400,
                         {"error": plain_message(e), "error_code": e.code.upper()})


def _public(conn, root_title: str | None = None) -> dict:
    return {"connected": True, "status": conn.status, "workspace_name": conn.workspace_name,
            "token_hint": conn.token_hint, "privacy_ceiling": conn.privacy_ceiling,
            "root": ({"id": conn.root_page_id, "title": root_title, "url": page_url(conn.root_page_id)}
                     if conn.root_page_id else None)}


def _expand(body: SendBody, conn) -> SendBody:
    """`all` -> the ids of the whole brain (the same on every call, so plan and send agree)."""
    if not body.all:
        return body
    inc = {**scope_mod.DEFAULT_INCLUDE, **(conn.row.get("include") or {})}
    notes, colls, dbs = scope_mod.all_scope(get_supabase(), conn.user_id, inc)
    from services.notion_sync.readers import objects as objs
    threads, skills = scope_mod.all_extras(get_supabase(), conn.user_id, inc, sorted(objs.load_skills(objs.skill_dirs())))
    return body.model_copy(update={"thread_ids": list(dict.fromkeys(body.thread_ids + threads)),
                                   "skill_names": list(dict.fromkeys(body.skill_names + skills)),
                                   "note_ids": list(dict.fromkeys(body.note_ids + notes)),
                                   "collection_ids": list(dict.fromkeys(body.collection_ids + colls)),
                                   "database_ids": list(dict.fromkeys(body.database_ids + dbs)), "all": False})


def _need_scope(body: SendBody) -> None:
    if not (body.note_ids or body.collection_ids or body.only_collection_ids or body.database_ids or body.thread_ids or body.skill_names or body.all):
        raise HTTPException(422, {"error": "Choose a note or a collection to send.", "error_code": "EMPTY_SCOPE"})


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
    _need_scope(body)
    body = _expand(body, conn)
    adapter = _adapter(conn)
    try:
        p = plan_scope(get_supabase(), conn, adapter, note_ids=body.note_ids, collection_ids=body.collection_ids,
                       database_ids=body.database_ids, include_linked=body.include_linked,
                       thread_ids=body.thread_ids, skill_names=body.skill_names, sources=body.sources,
                       collections_only=body.only_collection_ids, exclude=frozenset(body.exclude),
                       released=frozenset(body.released), archive_ids=frozenset(body.archive_ids),
                       resolutions=body.resolutions)
    except NotionError as e:
        raise _notion_error(e, conn)
    return p.to_dict()


def _send_blocking(body: SendBody, user_id: str, loop) -> dict:
    conn = _need_conn(user_id)
    if not conn.root_page_id:
        raise HTTPException(409, {"error": "Pick the Notion page to send to first.", "error_code": "NO_ROOT"})
    lock = connection_lock(conn.id)
    if not lock.acquire(blocking=False):
        raise HTTPException(409, {"error": "A send is already running.", "error_code": "BUSY"})
    handed_off = False
    try:
        db = get_supabase()
        adapter = _adapter(conn)
        released = frozenset(body.released)
        worker.recover_interrupted(db, Store(db, user_id, conn.id))
        # Re-plan on the server: never trust a plan the browser sends back.
        _need_scope(body)
        body = _expand(body, conn)
        try:
            p = plan_scope(db, conn, adapter, note_ids=body.note_ids, collection_ids=body.collection_ids,
                       database_ids=body.database_ids, include_linked=body.include_linked,
                       thread_ids=body.thread_ids, skill_names=body.skill_names, sources=body.sources,
                       collections_only=body.only_collection_ids, exclude=frozenset(body.exclude),
                           released=released, archive_ids=frozenset(body.archive_ids), resolutions=body.resolutions)
        except NotionError as e:
            raise _notion_error(e, conn)
        if not p.sendable:
            return {"status": "nothing_to_send", "items": [], "requests": 0, "plan": p.to_dict()}
        engine = Engine(db, conn, adapter)
        if not body.background:
            res = engine.run(p.items, released)
            return {**res.to_dict(), "plan": p.to_dict()}
        run, sendable, recs = engine.prepare(p.items, released)
        lock.release()                      # the worker takes it again for the whole run
        handed_off = True

        def finished(res):
            bad = sum(i.status in ("failed", "needs_you") for i in res.items)
            if bad and loop is not None:
                asyncio.run_coroutine_threadsafe(
                    worker.bell(user_id, run["id"], sum(i.status == "done" for i in res.items), bad), loop)
        worker.start_background(engine, run, sendable, recs, released, on_finish=finished)
        return {"status": "queued", "run_id": run["id"], "items": [], "requests": 0, "plan": p.to_dict()}
    finally:
        if not handed_off:
            lock.release()


@router.post("/send")
async def send(body: SendBody, authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    loop = asyncio.get_running_loop()
    return await asyncio.to_thread(_send_blocking, body, user_id, loop)


def _titles(db, user_id: str, items: list[dict]) -> dict[str, str]:
    notes = [i["local_id"] for i in items if i["local_kind"] == "note"]
    colls = [i["local_id"] for i in items if i["local_kind"] == "collection"]
    dbs = [i["local_id"] for i in items if i["local_kind"] == "database"]
    threads = [i["local_id"] for i in items if i["local_kind"] == "thread"]
    out: dict[str, str] = {i["local_id"]: i["local_id"] for i in items if i["local_kind"] == "skill"}
    if threads:
        from services.notion_sync.readers.objects import thread_title
        for r in db.table("chat_threads").select("*").eq("user_id", user_id).in_("id", threads).execute().data or []:
            out[str(r["id"])] = thread_title(r)
    if dbs:
        for r in db.table("db_databases").select("id, title").eq("user_id", user_id).in_("id", dbs).execute().data or []:
            out[str(r["id"])] = r.get("title") or "Untitled database"
    if notes:
        for r in db.table("notes").select("id, title").eq("user_id", user_id).in_("id", notes).execute().data or []:
            out[str(r["id"])] = (r.get("title") or "Untitled").strip() or "Untitled"
    if colls:
        for r in db.table("collections").select("id, name").eq("user_id", user_id).in_("id", colls).execute().data or []:
            out[str(r["id"])] = r.get("name") or "Untitled folder"
    return out


def _run_view(run: dict) -> dict:
    return {k: run.get(k) for k in ("id", "trigger", "status", "counts", "requests_used", "created_at",
                                    "started_at", "finished_at")}


@router.get("/runs")
def runs(limit: int = 20, authorization: str = Header(...)):
    """Activity: the history is the run rows."""
    user_id = get_user_id(authorization)
    conn = _need_conn(user_id)
    store = Store(get_supabase(), user_id, conn.id)
    worker.recover_interrupted(get_supabase(), store)
    return {"runs": [_run_view(r) for r in store.runs(min(max(limit, 1), 100))]}


@router.get("/runs/{run_id}")
def run_detail(run_id: str, authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    conn = _need_conn(user_id)
    store = Store(get_supabase(), user_id, conn.id)
    r = store.run(run_id)
    if r is None:
        raise HTTPException(404, {"error": "No such run.", "error_code": "NOT_FOUND"})
    items = store.run_items(run_id)
    titles = _titles(get_supabase(), user_id, items)
    return {**_run_view(r), "items": [{
        "id": i["id"], "kind": i["local_kind"], "local_id": i["local_id"], "title": titles.get(i["local_id"], ""),
        "action": i["action"], "status": i["status"], "error_class": i.get("error_class"),
        "message": i.get("message")} for i in items]}


@router.post("/runs/{run_id}/retry")
async def retry_failed(run_id: str, authorization: str = Header(...)):
    """A new run with only the items that failed (not the ones waiting for your choice)."""
    user_id = get_user_id(authorization)
    loop = asyncio.get_running_loop()

    def go():
        conn = _need_conn(user_id)
        store = Store(get_supabase(), user_id, conn.id)
        if store.run(run_id) is None:
            raise HTTPException(404, {"error": "No such run.", "error_code": "NOT_FOUND"})
        failed = [i for i in store.run_items(run_id) if i["status"] == "failed"]
        if not failed:
            return {"status": "nothing_to_send", "items": [], "requests": 0}
        lock = connection_lock(conn.id)
        if not lock.acquire(blocking=False):
            raise HTTPException(409, {"error": "A send is already running.", "error_code": "BUSY"})
        handed = False
        try:
            db = get_supabase()
            adapter = _adapter(conn)
            p = plan_scope(db, conn, adapter,
                           note_ids=[i["local_id"] for i in failed if i["local_kind"] == "note"],
                           collections_only=[i["local_id"] for i in failed if i["local_kind"] == "collection"],
                           database_ids=[i["local_id"] for i in failed if i["local_kind"] == "database"],
                           thread_ids=[i["local_id"] for i in failed if i["local_kind"] == "thread"],
                           skill_names=[i["local_id"] for i in failed if i["local_kind"] == "skill"],
                           released=frozenset(store.run(run_id).get("released") or []))
            if not p.sendable:
                return {"status": "nothing_to_send", "items": [], "requests": 0, "plan": p.to_dict()}
            engine = Engine(db, conn, adapter)
            run, sendable, recs = engine.prepare(p.items, frozenset(store.run(run_id).get("released") or []), "retry")
            lock.release()
            handed = True

            def finished(res):
                bad = sum(i.status in ("failed", "needs_you") for i in res.items)
                if bad:
                    asyncio.run_coroutine_threadsafe(
                        worker.bell(user_id, run["id"], sum(i.status == "done" for i in res.items), bad), loop)
            worker.start_background(engine, run, sendable, recs, frozenset(), on_finish=finished)
            return {"status": "queued", "run_id": run["id"], "items": [], "requests": 0}
        finally:
            if not handed:
                lock.release()
    return await asyncio.to_thread(go)


@router.post("/pause")
def pause_all(authorization: str = Header(...)):
    """The kill switch: nothing is sent until you resume. Takes effect before the next request."""
    return _set_status(get_user_id(authorization), "paused")


@router.post("/resume")
def resume_all(authorization: str = Header(...)):
    return _set_status(get_user_id(authorization), "active")


def _set_status(user_id: str, status: str) -> dict:
    conn = _need_conn(user_id)
    get_supabase().table("notion_connections").update({"status": status, "updated_at": now()}).eq("id", conn.id).execute()
    return _public(conn_mod.load(get_supabase(), user_id))


def _canary() -> dict | None:
    """The last daily-canary result (written by `python -m evals.notion_canary`), if there is one."""
    import json
    from pathlib import Path
    try:
        d = json.loads((Path.home() / ".secondbrain" / "notion_canary.json").read_text())
        return {"ok": d.get("ok"), "when": d.get("when"), "api_version": d.get("api_version"),
                "failed": [c["name"] for c in d.get("checks", []) if not c.get("ok")]}
    except Exception:
        return None


@router.get("/health")
def health(authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    conn = _need_conn(user_id)
    db = get_supabase()
    rows = db.table("notion_mappings").select("state").eq("connection_id", conn.id).execute().data or []
    states = {}
    for r in rows:
        states[r["state"]] = states.get(r["state"], 0) + 1
    recent = Store(db, user_id, conn.id).runs(20)
    return {"status": conn.status, "last_ok_at": conn.row.get("last_ok_at"), "api_version": NOTION_VERSION,
            "mappings": states, "failing": states.get("failed", 0),
            "rate_limit_waits_recent": sum((r.get("counts") or {}).get("rate_limit_waits", 0) for r in recent),
            "token_problem": conn.status == "error", "canary": _canary()}


class PauseBody(BaseModel):
    paused: bool


@router.post("/notes/{note_id}/pause")
def pause_note(note_id: str, body: PauseBody, authorization: str = Header(...)):
    """Stop mirroring one note (or resume): a page you curate by hand in Notion."""
    user_id = get_user_id(authorization)
    conn = _need_conn(user_id)
    store = Store(get_supabase(), user_id, conn.id)
    m = store.mapping("note", note_id)
    if not m or not m.get("notion_id"):
        raise HTTPException(409, {"error": "This note has not been sent to Notion.", "error_code": "NEVER_SENT"})
    store.update(m["id"], {"paused": body.paused})
    return {"note_id": note_id, "paused": body.paused}


@router.get("/notes/{note_id}")
def note_status(note_id: str, authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    conn = conn_mod.load(get_supabase(), user_id)
    if conn is None:
        return {"connected": False, "state": "not_connected"}
    m = Store(get_supabase(), user_id, conn.id).mapping("note", note_id)
    if not m or not m.get("notion_id"):
        return {"connected": True, "state": "never_sent"}
    return {"connected": True, "state": m["state"], "paused": bool(m.get("paused")), "notion_url": page_url(m["notion_id"]),
            "last_pushed_at": m.get("last_pushed_at"), "losses": m.get("losses") or [],
            "error": m.get("error_message")}


# ---- mirror status, auto-sync rules, what "everything" includes ---------------------------------------

@router.get("/mirror")
def mirror(authorization: str = Header(...)):
    """The state of every note and folder, for the sidebar dots and the header chip. No Notion calls."""
    user_id = get_user_id(authorization)
    conn = conn_mod.load(get_supabase(), user_id)
    if conn is None:
        return {"connected": False, "notes": {}, "collections": {}}
    return {"connected": True, "paused": conn.status == "paused", **scope_mod.mirror_map(get_supabase(), conn)}


class RuleBody(BaseModel):
    scope_kind: str = Field(pattern="^(note|collection|database|all)$")
    scope_id: str | None = None
    mode: str = Field(default="on_change", pattern="^(manual|on_change|daily)$")
    include: dict = {}


@router.get("/rules")
def list_rules(authorization: str = Header(...)):
    conn = _need_conn(get_user_id(authorization))
    return {"rules": [{k: r.get(k) for k in ("id", "scope_kind", "scope_id", "mode", "include", "created_at")}
                      for r in get_supabase().table("notion_rules").select("*").eq("connection_id", conn.id).execute().data or []]}


@router.post("/rules")
def add_rule(body: RuleBody, authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    conn = _need_conn(user_id)
    if (body.scope_kind == "all") != (body.scope_id is None):
        raise HTTPException(422, {"error": "A rule for everything has no id; any other rule needs one.", "error_code": "BAD_SCOPE"})
    db = get_supabase()
    existing = [r for r in db.table("notion_rules").select("*").eq("connection_id", conn.id).execute().data or []
                if r["scope_kind"] == body.scope_kind and r.get("scope_id") == body.scope_id]
    row = {"user_id": user_id, "connection_id": conn.id, "scope_kind": body.scope_kind, "scope_id": body.scope_id,
           "mode": body.mode, "include": body.include}
    if existing:
        db.table("notion_rules").update({"mode": body.mode, "include": body.include}).eq("id", existing[0]["id"]).execute()
        return {"id": existing[0]["id"], **{k: row[k] for k in ("scope_kind", "scope_id", "mode", "include")}}
    created = db.table("notion_rules").insert(row).execute().data[0]
    return {"id": created["id"], **{k: row[k] for k in ("scope_kind", "scope_id", "mode", "include")}}


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: str, authorization: str = Header(...)):
    conn = _need_conn(get_user_id(authorization))
    get_supabase().table("notion_rules").delete().eq("id", rule_id).eq("connection_id", conn.id).execute()
    return {"deleted": rule_id}


class IncludeBody(BaseModel):
    include: dict


@router.get("/include")
def get_include(authorization: str = Header(...)):
    conn = _need_conn(get_user_id(authorization))
    return {"include": {**scope_mod.DEFAULT_INCLUDE, **(conn.row.get("include") or {})}}


@router.put("/include")
def put_include(body: IncludeBody, authorization: str = Header(...)):
    """D5: what "everything" contains. Only the known switches are accepted."""
    conn = _need_conn(get_user_id(authorization))
    clean = {k: bool(v) for k, v in body.include.items() if k in scope_mod.DEFAULT_INCLUDE}
    merged = {**scope_mod.DEFAULT_INCLUDE, **(conn.row.get("include") or {}), **clean}
    get_supabase().table("notion_connections").update({"include": merged, "updated_at": now()}).eq("id", conn.id).execute()
    return {"include": merged}
