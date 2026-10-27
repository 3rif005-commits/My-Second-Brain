"""The /internal API trusts `user_id` from the body, so its key is its whole
security. A public key (unset, or the example value printed in this repo) must
never open it over a network — the OpenClaw lesson: a default that is fine on a
laptop is fatal on a server."""
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

import main
from routers import internal

LOOPBACK = ("127.0.0.1", 5000)
REMOTE = ("203.0.113.9", 5000)


@pytest.fixture
def stub_search(monkeypatch):
    monkeypatch.setattr(internal, "embed", lambda q: [0.0])
    monkeypatch.setattr(internal, "retrieve", lambda e, u: [])
    monkeypatch.setattr(internal.privacy, "for_outside_app", lambda rows, uid: rows)
    monkeypatch.setattr(internal, "get_supabase", lambda: MagicMock())


def _post(client_addr, key, extra_headers=None):
    c = TestClient(main.app, client=client_addr)
    headers = {"x-internal-key": key, **(extra_headers or {})}
    return c.post("/internal/search", headers=headers, json={"query": "q", "user_id": "u1"})


@pytest.mark.parametrize("public", ["", "changeme-internal-key"])
def test_public_key_is_refused_from_the_network(monkeypatch, stub_search, public):
    monkeypatch.setattr(internal.settings, "internal_api_key", public)
    r = _post(REMOTE, public)
    assert r.status_code == 503
    assert "INTERNAL_API_KEY" in r.json()["detail"]


def test_public_key_is_refused_through_a_proxy_even_from_loopback(monkeypatch, stub_search):
    # Render's proxy (or a local nginx) connects from loopback but forwards a
    # stranger's request; X-Forwarded-For marks it as not this machine.
    monkeypatch.setattr(internal.settings, "internal_api_key", "changeme-internal-key")
    r = _post(LOOPBACK, "changeme-internal-key", {"x-forwarded-for": "198.51.100.7"})
    assert r.status_code == 503


def test_example_key_still_works_on_this_machine(monkeypatch, stub_search):
    # The desktop MCP server beside a local backend keeps working.
    monkeypatch.setattr(internal.settings, "internal_api_key", "changeme-internal-key")
    assert _post(LOOPBACK, "changeme-internal-key").status_code == 200


def test_empty_key_never_matches_an_empty_header(monkeypatch, stub_search):
    monkeypatch.setattr(internal.settings, "internal_api_key", "")
    assert _post(LOOPBACK, "").status_code == 403


def test_real_key_works_from_anywhere_and_a_wrong_one_does_not(monkeypatch, stub_search):
    monkeypatch.setattr(internal.settings, "internal_api_key", "a-long-random-real-key")
    assert _post(REMOTE, "a-long-random-real-key").status_code == 200
    assert _post(REMOTE, "a-long-random-real-kez").status_code == 403
    assert _post(LOOPBACK, "changeme-internal-key").status_code == 403


def test_every_internal_route_that_reads_user_data_is_guarded():
    """A new /internal route that forgets the dependency would bypass all of the
    above. The JWT-guarded reindex routes are the only exceptions."""
    guarded, unguarded = [], []
    for route in main.app.routes:
        path = getattr(route, "path", "")
        if not path.startswith("/internal/"):
            continue
        deps = [d.call for d in route.dependant.dependencies]
        (guarded if internal.require_internal_key in deps else unguarded).append(path)
    assert guarded, "no guarded internal routes found"
    assert set(unguarded) <= {"/internal/reindex-note", "/internal/reindex"}, unguarded
