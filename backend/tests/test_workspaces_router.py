"""Tests for the workspaces router — auth-scoped CRUD, resource import state
machine (queued + background task), anchors replacement, capture guards."""
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

AUTH = {"Authorization": "Bearer fake"}


def _table_router(tables: dict):
    """get_supabase().table(name) → per-table MagicMock from `tables`."""
    db = MagicMock()
    db.table.side_effect = lambda name: tables.setdefault(name, MagicMock())
    return db


@pytest.fixture
def client():
    with patch("routers.workspaces.get_user_id", return_value="user-1"):
        from main import app
        yield TestClient(app)


def test_create_workspace(client):
    tables: dict = {}
    db = _table_router(tables)
    ws_row = {"id": "ws1", "name": "Physics", "icon": "🗂️", "user_id": "user-1"}
    with patch("routers.workspaces.get_supabase", return_value=db):
        tables["workspaces"] = MagicMock()
        tables["workspaces"].insert.return_value.execute.return_value.data = [ws_row]
        res = client.post("/workspaces", json={"name": "Physics"}, headers=AUTH)
    assert res.status_code == 200
    assert res.json()["name"] == "Physics"
    tables["workspaces"].insert.assert_called_once()


def test_get_workspace_404_when_not_owned(client):
    db = MagicMock()
    (db.table.return_value.select.return_value.eq.return_value.eq.return_value
     .is_.return_value.execute.return_value.data) = []
    with patch("routers.workspaces.get_supabase", return_value=db):
        res = client.get("/workspaces/nope", headers=AUTH)
    assert res.status_code == 404


def test_import_url_resource_queues_background_processing(client):
    ws_row = {"id": "ws1", "user_id": "user-1"}
    resource_row = {
        "id": "res1", "workspace_id": "ws1", "user_id": "user-1",
        "kind": "youtube", "title": "YouTube video", "status": "queued",
        "meta": {}, "summary_html": None,
    }
    db = MagicMock()
    (db.table.return_value.select.return_value.eq.return_value.eq.return_value
     .is_.return_value.execute.return_value.data) = [ws_row]
    db.table.return_value.insert.return_value.execute.return_value.data = [resource_row]

    with patch("routers.workspaces.get_supabase", return_value=db), \
         patch("routers.workspaces.process_resource") as proc:
        res = client.post(
            "/workspaces/ws1/resources",
            data={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
            headers=AUTH,
        )
    assert res.status_code == 200
    body = res.json()
    assert body["kind"] == "youtube"
    assert body["status"] == "queued"
    assert "summary_html" not in body  # public shape hides the blob
    proc.assert_called_once_with("res1")  # BackgroundTasks ran on response close


def test_import_rejects_unsupported_file(client):
    ws_row = {"id": "ws1", "user_id": "user-1"}
    db = MagicMock()
    (db.table.return_value.select.return_value.eq.return_value.eq.return_value
     .is_.return_value.execute.return_value.data) = [ws_row]
    with patch("routers.workspaces.get_supabase", return_value=db):
        res = client.post(
            "/workspaces/ws1/resources",
            files={"file": ("malware.exe", b"MZ", "application/octet-stream")},
            headers=AUTH,
        )
    assert res.status_code == 400


def test_import_requires_file_or_url(client):
    ws_row = {"id": "ws1", "user_id": "user-1"}
    db = MagicMock()
    (db.table.return_value.select.return_value.eq.return_value.eq.return_value
     .is_.return_value.execute.return_value.data) = [ws_row]
    with patch("routers.workspaces.get_supabase", return_value=db):
        res = client.post("/workspaces/ws1/resources", data={}, headers=AUTH)
    assert res.status_code == 400


def test_capture_rejected_for_non_video(client):
    resource = {"id": "res1", "user_id": "user-1", "kind": "pdf"}
    db = MagicMock()
    (db.table.return_value.select.return_value.eq.return_value.eq.return_value
     .execute.return_value.data) = [resource]
    with patch("routers.workspaces.get_supabase", return_value=db):
        res = client.post("/resources/res1/capture",
                          json={"type": "frame", "start": 10}, headers=AUTH)
    assert res.status_code == 400


def test_put_anchors_replaces_rows(client):
    tables: dict = {}
    db = _table_router(tables)
    notes_t = MagicMock()
    notes_t.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
        {"id": "n1"}]
    anchors_t = MagicMock()
    tables["notes"] = notes_t
    tables["note_anchors"] = anchors_t

    body = [
        {"block_id": "b1", "resource_id": "r1", "anchor_type": "time",
         "anchor_start": 12.5, "anchor_end": 12.5},
        {"block_id": "b2", "resource_id": "r1", "anchor_type": "time",
         "anchor_start": 90.0, "anchor_end": 90.0},
    ]
    with patch("routers.workspaces.get_supabase", return_value=db):
        res = client.put("/notes/n1/anchors", json=body, headers=AUTH)
    assert res.status_code == 200
    assert res.json()["count"] == 2
    anchors_t.delete.return_value.eq.return_value.execute.assert_called_once()
    inserted = anchors_t.insert.call_args[0][0]
    assert inserted[0]["block_id"] == "b1"
    assert inserted[0]["user_id"] == "user-1"


def test_put_anchors_404_for_foreign_note(client):
    db = MagicMock()
    (db.table.return_value.select.return_value.eq.return_value.eq.return_value
     .execute.return_value.data) = []
    with patch("routers.workspaces.get_supabase", return_value=db):
        res = client.put("/notes/other/anchors", json=[], headers=AUTH)
    assert res.status_code == 404


def test_ai_providers_key_never_echoed(client):
    row = {"id": "p1", "user_id": "user-1", "provider": "gemini",
           "label": "Gemini", "api_key": "secret-key-12345", "enabled": True}
    db = MagicMock()
    (db.table.return_value.select.return_value.eq.return_value.order.return_value
     .execute.return_value.data) = [dict(row)]
    with patch("routers.workspaces.get_supabase", return_value=db):
        res = client.get("/ai-providers", headers=AUTH)
    assert res.status_code == 200
    body = res.json()[0]
    assert "api_key" not in body
    assert body["api_key_hint"].endswith("2345")


def test_create_ai_provider_validates(client):
    db = MagicMock()
    with patch("routers.workspaces.get_supabase", return_value=db):
        res = client.post("/ai-providers",
                          json={"provider": "bogus", "api_key": "k"}, headers=AUTH)
        assert res.status_code == 400
        res2 = client.post("/ai-providers",
                           json={"provider": "openai_compatible", "api_key": "k"},
                           headers=AUTH)
        assert res2.status_code == 400  # base_url required
