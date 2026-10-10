import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.storage_urls as su


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(su, "get_user_id", lambda a: "u1")
    signed = []
    monkeypatch.setattr(su.storage, "signed_url", lambda path, ttl: signed.append((path, ttl)) or f"https://x/new/{path}?token=t")
    app = FastAPI()
    app.include_router(su.router)
    return TestClient(app), signed


H = {"Authorization": "Bearer t"}
OLD = "https://x.supabase.co/storage/v1/object/sign/workspace-resources/{p}?token=EXPIRED"


def test_an_expired_link_to_my_own_file_gets_a_fresh_long_lived_one(client):
    c, signed = client
    r = c.post("/storage/fresh-url", json={"url": OLD.format(p="u1/r1/captures/frame.png")}, headers=H)
    assert r.status_code == 200 and r.json()["url"].startswith("https://x/new/u1/r1/captures/frame.png")
    assert signed == [("u1/r1/captures/frame.png", 10 * 365 * 24 * 3600)]


@pytest.mark.parametrize("url", [
    OLD.format(p="u2/r1/frame.png"),                      # someone else's file
    OLD.format(p="u1/../u2/secret.png"),                  # path trick
    "https://example.com/a.png",                          # not storage at all
    "https://x.supabase.co/storage/v1/object/sign/other-bucket/u1/a.png?token=1",
])
def test_only_my_own_stored_files_are_refreshed(client, url):
    c, signed = client
    assert c.post("/storage/fresh-url", json={"url": url}, headers=H).status_code == 404
    assert signed == []


def test_new_captures_are_long_lived():
    import inspect
    from services.workspace import media
    assert "10 * 365 * 24 * 3600" in inspect.getsource(media)
