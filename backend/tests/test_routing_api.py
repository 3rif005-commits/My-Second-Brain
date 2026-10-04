"""Settings → Routing endpoints."""
import pytest
from fastapi.testclient import TestClient

import main
from routers import routing as routing_router
from services.ai.providers import Provider

pytestmark = pytest.mark.real_routing
H = {"Authorization": "Bearer t"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(routing_router, "get_user_id", lambda a: "u1")
    monkeypatch.setattr("services.ai.providers.list_providers", lambda uid: [
        Provider("anthropic", api_key="k", label="Anthropic",
                 capabilities={"text", "vision", "long_context"}),
        Provider("local", label="Local")])
    return TestClient(main.app)


def test_get_policy_falls_back_to_the_default(client):
    body = client.get("/routing/policy", headers=H).json()
    assert body["policy"] == body["default"]
    assert "local" in body["slots"]


def test_an_invalid_policy_is_a_400_naming_the_field(client):
    r = client.put("/routing/policy", headers=H,
                   json={"policy": {"default_slot": "turbo"}})
    assert r.status_code == 400 and "default_slot" in r.text


def test_saving_without_the_migration_says_so(client):
    r = client.put("/routing/policy", headers=H, json={"policy": {}})
    # conftest refuses Supabase: not a "relation does not exist", so a 500
    # with the reason; the 029 hint is covered below
    assert r.status_code == 500
    err = routing_router._storage_error(RuntimeError('relation "routing_policies" does not exist'))
    assert err.status_code == 503 and "029" in err.detail


def test_the_test_bench_uses_an_unsaved_draft(client):
    draft = {"rules": [{"id": "x", "kind": "message_matches", "value": "proof",
                        "use": "strong"}]}
    r = client.post("/routing/test", headers=H,
                    json={"query": "a proof please", "policy": draft}).json()
    assert r["slot"] == "strong" and r["decided_by"] == "rule" and r["rule_id"] == "x"
    assert "query" not in r["signals"]


def test_targets_show_what_each_slot_resolves_to(client):
    body = client.get("/routing/targets", headers=H).json()
    by_slot = {s["slot"]: s for s in body["slots"]}
    assert by_slot["local"]["label"].startswith("Local")
    assert by_slot["vision"]["label"] == "Anthropic"
    keys = {p["key"]: p for p in body["providers"]}
    assert keys["anthropic"]["ceiling"] == "personal"
    assert keys["local"]["ceiling"] == "private"
