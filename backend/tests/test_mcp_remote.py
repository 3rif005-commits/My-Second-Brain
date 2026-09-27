"""The remote MCP server (5.4): another app gets in only after the user clicks
Allow, acts only as that user, and loses access when tokens are revoked."""
import base64
import hashlib
import json
import secrets
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest
from starlette.testclient import TestClient

from mcp_remote.oauth import MemoryStore
from mcp_remote.server import build

REDIRECT = "http://localhost:9999/callback"


@pytest.fixture
def server():
    store = MemoryStore()
    app, oauth = build(store, public_url="http://localhost:8765",
                       frontend_url="http://localhost:3000")
    with TestClient(app, base_url="http://localhost:8765") as client:
        yield client, store, oauth


def _register(c) -> str:
    r = c.post("/register", json={"redirect_uris": [REDIRECT], "client_name": "Test app",
                                  "token_endpoint_auth_method": "none",
                                  "grant_types": ["authorization_code", "refresh_token"],
                                  "response_types": ["code"]})
    assert r.status_code == 201, r.text
    return r.json()["client_id"]


def _pkce():
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def _authorize(c, client_id, challenge) -> str:
    r = c.get("/authorize", params={"response_type": "code", "client_id": client_id,
                                    "redirect_uri": REDIRECT, "code_challenge": challenge,
                                    "code_challenge_method": "S256", "state": "s1",
                                    "scope": "brain"}, follow_redirects=False)
    assert r.status_code == 302, r.text
    allow_page = r.headers["location"]
    assert allow_page.startswith("http://localhost:3000/mcp-connect?request=")
    return parse_qs(urlparse(allow_page).query)["request"][0]


def _allow(c, rid, user="u1", allow=True):
    with patch("routers.ingest.get_user_id", return_value=user):
        return c.post(f"/consent/{rid}", json={"allow": allow},
                      headers={"Authorization": "Bearer supabase-jwt"})


def _code_from(redirect: str) -> str:
    q = parse_qs(urlparse(redirect).query)
    assert q["state"] == ["s1"]
    return q["code"][0]


def _token(c, client_id, code, verifier):
    return c.post("/token", data={"grant_type": "authorization_code", "code": code,
                                  "redirect_uri": REDIRECT, "client_id": client_id,
                                  "code_verifier": verifier})


def _connect(c):
    client_id = _register(c)
    verifier, challenge = _pkce()
    rid = _authorize(c, client_id, challenge)
    code = _code_from(_allow(c, rid).json()["redirect"])
    tok = _token(c, client_id, code, verifier)
    assert tok.status_code == 200, tok.text
    return client_id, tok.json()


def _call(c, token, method, params=None):
    headers = {"Accept": "application/json, text/event-stream",
               "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = c.post("/mcp", headers=headers,
               json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})
    if r.status_code != 200:
        return r.status_code, r.text
    text = r.text
    data = next((json.loads(l[6:]) for l in text.splitlines() if l.startswith("data: ")), None) \
        or r.json()
    return r.status_code, data


def test_the_metadata_tells_an_app_where_to_log_in(server):
    c, _, _ = server
    meta = c.get("/.well-known/oauth-authorization-server").json()
    assert meta["authorization_endpoint"].endswith("/authorize")
    assert meta["registration_endpoint"].endswith("/register")
    assert "S256" in meta["code_challenge_methods_supported"]


def test_without_a_token_nothing_is_reachable(server):
    c, _, _ = server
    status, _ = _call(c, None, "tools/list")
    assert status == 401


def test_the_full_login_then_the_tools(server):
    c, store, _ = server
    _, tok = _connect(c)
    assert tok["token_type"] == "Bearer" and tok["refresh_token"]
    # stored only as hashes
    assert all(tok["access_token"] not in json.dumps(g) for g in store.grants.values())
    status, data = _call(c, tok["access_token"], "tools/list")
    assert status == 200, data
    names = {t["name"] for t in data["result"]["tools"]}
    assert names == {"search_notes", "list_notes", "get_note", "create_note"}


def test_the_tools_act_as_the_user_who_allowed(server):
    c, _, _ = server
    _, tok = _connect(c)
    seen = {}

    def fake_create(args, user_id):
        seen.update(args=args, user=user_id)
        return {"id": "n9", "title": args["title"]}
    with patch("services.agent.brain_tools._create_note", side_effect=fake_create):
        status, data = _call(c, tok["access_token"], "tools/call",
                             {"name": "create_note",
                              "arguments": {"title": "From Claude", "content_markdown": "# Hi\n- a\n- b"}})
    assert status == 200, data
    assert seen["user"] == "u1"                                  # the token's user, only
    assert [b["type"] for b in seen["args"]["blocks"]] == ["heading", "bulletListItem", "bulletListItem"]


def test_a_wrong_pkce_verifier_is_refused(server):
    c, _, _ = server
    client_id = _register(c)
    _, challenge = _pkce()
    rid = _authorize(c, client_id, challenge)
    code = _code_from(_allow(c, rid).json()["redirect"])
    assert _token(c, client_id, code, "not-the-verifier").status_code == 400


def test_a_code_works_once(server):
    c, _, _ = server
    client_id = _register(c)
    verifier, challenge = _pkce()
    rid = _authorize(c, client_id, challenge)
    code = _code_from(_allow(c, rid).json()["redirect"])
    assert _token(c, client_id, code, verifier).status_code == 200
    assert _token(c, client_id, code, verifier).status_code == 400


def test_refresh_rotates_and_the_old_one_dies(server):
    c, _, _ = server
    client_id, tok = _connect(c)
    r = c.post("/token", data={"grant_type": "refresh_token", "client_id": client_id,
                               "refresh_token": tok["refresh_token"]})
    assert r.status_code == 200 and r.json()["refresh_token"] != tok["refresh_token"]
    again = c.post("/token", data={"grant_type": "refresh_token", "client_id": client_id,
                                   "refresh_token": tok["refresh_token"]})
    assert again.status_code == 400


def test_deny_sends_the_app_an_error_and_no_code(server):
    c, _, _ = server
    client_id = _register(c)
    _, challenge = _pkce()
    rid = _authorize(c, client_id, challenge)
    q = parse_qs(urlparse(_allow(c, rid, allow=False).json()["redirect"]).query)
    assert q["error"] == ["access_denied"] and "code" not in q


def test_the_allow_page_needs_a_second_brain_login(server):
    c, _, _ = server
    client_id = _register(c)
    _, challenge = _pkce()
    rid = _authorize(c, client_id, challenge)
    with patch("routers.ingest.get_user_id", side_effect=Exception("bad jwt")):
        assert c.post(f"/consent/{rid}", json={"allow": True}).status_code == 401
        assert c.get(f"/consent/{rid}").status_code == 401
    with patch("routers.ingest.get_user_id", return_value="u1"):
        info = c.get(f"/consent/{rid}", headers={"Authorization": "Bearer x"}).json()
    assert info["client_name"] == "Test app" and info["redirect_host"] == "localhost:9999"


def test_markdown_becomes_blocks():
    from mcp_remote.blocks import markdown_to_blocks
    blocks = markdown_to_blocks("# Title\n\nSome **bold** text\nmore\n\n1. one\n> quote")
    assert [(b["type"], b["content"][0]["text"]) for b in blocks] == [
        ("heading", "Title"), ("paragraph", "Some bold text more"),
        ("numberedListItem", "one"), ("quote", "quote")]
