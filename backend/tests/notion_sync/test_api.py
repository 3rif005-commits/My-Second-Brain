"""The /notion API end to end over FastAPI's TestClient, with the fake Notion."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.notion_sync as api
from services import secrets
from tests.notion_sync.conftest import USER, World, note
from tests.notion_sync.fake_notion import BOT

H = {"Authorization": "Bearer t"}


@pytest.fixture
def env(monkeypatch):
    w = World()
    w.db.tables["notion_connections"].clear()          # start disconnected
    from cryptography.fernet import Fernet
    from core.config import settings
    monkeypatch.setattr(settings, "secrets_key", Fernet.generate_key().decode())
    monkeypatch.setattr(api, "get_user_id", lambda a: USER)
    monkeypatch.setattr(api, "get_supabase", lambda: w.db)
    monkeypatch.setattr(api, "_client", lambda token: w.client())
    app = FastAPI()
    app.include_router(api.router)
    return w, TestClient(app)


def connect(c):
    return c.post("/notion/connect", json={"token": "ntn_secret_token_1234"}, headers=H)


def test_status_when_not_connected(env):
    _, c = env
    assert c.get("/notion/status", headers=H).json() == {"connected": False}


def test_connect_stores_encrypted_token_and_returns_only_last4(env):
    w, c = env
    r = connect(c)
    assert r.status_code == 200
    body = r.json()
    assert body["token_hint"] == "…1234" and body["workspace_name"] == "Test WS" and body["root"] is None
    assert "ntn_secret" not in r.text
    row = w.db.tables["notion_connections"][0]
    assert row["token_ciphertext"] != "ntn_secret_token_1234" and "ntn_secret" not in row["token_ciphertext"]
    assert secrets.decrypt(row["token_ciphertext"].encode()) == "ntn_secret_token_1234"
    assert row["bot_user_id"] == BOT
    assert [p["title"] for p in body["pages"]] == ["SB-TEST-root"]


def test_connect_rejects_bad_token_and_non_bot(env, monkeypatch):
    import httpx
    w, c = env
    monkeypatch.setattr(api, "_client", lambda t: api.NotionClient(t, transport=httpx.MockTransport(
        lambda r: httpx.Response(401, json={"code": "unauthorized", "message": "x"}))))
    r = c.post("/notion/connect", json={"token": "ntn_bad_token_1"}, headers=H)
    assert r.status_code == 400 and r.json()["detail"]["error_code"] == "BAD_TOKEN"
    monkeypatch.setattr(api, "_client", lambda t: api.NotionClient(t, transport=httpx.MockTransport(
        lambda r: httpx.Response(200, json={"id": "u", "type": "person"}))))
    r = c.post("/notion/connect", json={"token": "ntn_person_tok_1"}, headers=H)
    assert r.json()["detail"]["error_code"] == "NOT_A_BOT"
    assert w.db.tables["notion_connections"] == []


def test_reconnect_updates_the_same_row(env):
    w, c = env
    connect(c); connect(c)
    assert len(w.db.tables["notion_connections"]) == 1


def test_root_pick_and_status_detail(env):
    w, c = env
    connect(c)
    r = c.post("/notion/root", json={"page_id": w.notion.root}, headers=H)
    assert r.status_code == 200 and r.json()["root"]["title"] == "SB-TEST-root"
    s = c.get("/notion/status?detail=true", headers=H).json()
    assert s["root"]["title"] == "SB-TEST-root"


def test_root_must_be_shared(env):
    _, c = env
    connect(c)
    r = c.post("/notion/root", json={"page_id": "00000000-0000-0000-0000-000000000000"}, headers=H)
    assert r.status_code == 400 and r.json()["detail"]["error_code"] == "PAGE_NOT_SHARED"


def test_plan_requires_connection_and_root(env):
    w, c = env
    n = w.add_note()
    assert c.post("/notion/plan", json={"note_ids": [n["id"]]}, headers=H).status_code == 409
    connect(c)
    r = c.post("/notion/plan", json={"note_ids": [n["id"]]}, headers=H)
    assert r.status_code == 409 and r.json()["detail"]["error_code"] == "NO_ROOT"


def ready(env):
    w, c = env
    connect(c)
    c.post("/notion/root", json={"page_id": w.notion.root}, headers=H)
    return w, c


def test_plan_send_resend_flow(env):
    w, c = ready(env)
    n = w.add_note()
    p = c.post("/notion/plan", json={"note_ids": [n["id"]]}, headers=H).json()
    assert p["items"][0]["state"] == "new" and not p["nothing_to_send"] and w.notion.writes() == 0
    r = c.post("/notion/send", json={"note_ids": [n["id"]]}, headers=H).json()
    assert r["status"] == "succeeded" and r["items"][0]["notion_url"].startswith("https://www.notion.so/")
    writes = w.notion.writes()
    r2 = c.post("/notion/send", json={"note_ids": [n["id"]]}, headers=H).json()
    assert r2["status"] == "nothing_to_send" and w.notion.writes() == writes
    st = c.get(f"/notion/notes/{n['id']}", headers=H).json()
    assert st["state"] == "synced" and st["notion_url"] == r["items"][0]["notion_url"]


def test_note_status_never_sent(env):
    w, c = ready(env)
    assert c.get("/notion/notes/abc", headers=H).json()["state"] == "never_sent"


def test_private_blocked_unless_released(env):
    w, c = ready(env)
    n = w.add_note(sensitivity="private")
    p = c.post("/notion/plan", json={"note_ids": [n["id"]]}, headers=H).json()
    assert p["items"][0]["state"] == "private"
    r = c.post("/notion/send", json={"note_ids": [n["id"]]}, headers=H).json()
    assert r["status"] == "nothing_to_send"
    assert not [x for x in w.notion.calls if x[0] == "POST" and x[1] == "/pages"]
    r = c.post("/notion/send", json={"note_ids": [n["id"]], "released": [n["id"]]}, headers=H).json()
    assert r["status"] == "succeeded"


def test_client_cannot_inject_a_plan(env):
    """The server re-plans: a private note is never sent just because the body says so."""
    w, c = ready(env)
    n = w.add_note(sensitivity="private")
    r = c.post("/notion/send", json={"note_ids": [n["id"]], "plan": {"items": [{"state": "new"}]}}, headers=H).json()
    assert r["status"] == "nothing_to_send"


def test_busy_send_is_refused(env):
    w, c = ready(env)
    n = w.add_note()
    from services.notion_sync.engine.runner import connection_lock
    lock = connection_lock(w.db.tables["notion_connections"][0]["id"])
    lock.acquire()
    try:
        r = c.post("/notion/send", json={"note_ids": [n["id"]]}, headers=H)
        assert r.status_code == 409 and r.json()["detail"]["error_code"] == "BUSY"
    finally:
        lock.release()


def test_paused_connection_is_refused(env):
    w, c = ready(env)
    w.db.tables["notion_connections"][0]["status"] = "paused"
    n = w.add_note()
    r = c.post("/notion/plan", json={"note_ids": [n["id"]]}, headers=H)
    assert r.status_code == 409 and r.json()["detail"]["error_code"] == "PAUSED"


def test_changing_root_forgets_mappings_only(env):
    w, c = ready(env)
    n = w.add_note()
    c.post("/notion/send", json={"note_ids": [n["id"]]}, headers=H)
    other = w.notion._new_page({"type": "workspace", "workspace": True}, "other")
    pages_before = len(w.notion.pages)
    r = c.post("/notion/root", json={"page_id": other}, headers=H).json()
    assert r["forgotten_mappings"] >= 1 and len(w.notion.pages) == pages_before     # Notion untouched
    assert c.post("/notion/plan", json={"note_ids": [n["id"]]}, headers=H).json()["items"][0]["state"] == "new"


def test_disconnect_wipes_token_and_mappings(env):
    w, c = ready(env)
    n = w.add_note()
    c.post("/notion/send", json={"note_ids": [n["id"]]}, headers=H)
    r = c.post("/notion/disconnect", headers=H).json()
    assert r["connected"] is False and w.db.tables["notion_connections"] == []
    assert c.get("/notion/status", headers=H).json() == {"connected": False}


def test_another_users_note_cannot_be_sent(env):
    w, c = ready(env)
    n = note(); n["user_id"] = "someone-else"
    w.db.tables["notes"].append(n)
    p = c.post("/notion/plan", json={"note_ids": [n["id"]]}, headers=H).json()
    assert p["items"][0]["state"] == "missing"
