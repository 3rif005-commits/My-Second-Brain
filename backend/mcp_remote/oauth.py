"""OAuth for the remote MCP server: other apps act for you only after you
click Allow in Second Brain (5.4).

The MCP SDK serves the protocol (/register, /authorize, /token, /revoke and
the .well-known metadata); this provider decides. The flow:

  1. the app registers itself (dynamic client registration) — stored;
  2. /authorize sends YOUR browser to Second Brain's Allow page with a request
     id (the app's redirect URI, PKCE challenge and state are kept server-side);
  3. you click Allow (signed in) -> a one-time code for YOUR user id goes back
     to the app's redirect URI;
  4. the app trades the code (+ its PKCE verifier, checked by the SDK) for an
     access token (1 hour) and a refresh token (30 days, rotated on use).

Codes and tokens are stored only as SHA-256 hashes (migration 023).
"""
from __future__ import annotations

import hashlib
import secrets
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from mcp.server.auth.provider import (
    AccessToken, AuthorizationCode, AuthorizationParams, RefreshToken,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

SCOPE = "brain"
ACCESS_SECONDS = 3600
REFRESH_SECONDS = 30 * 24 * 3600
CODE_SECONDS = 300
REQUEST_SECONDS = 600


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


class Code(AuthorizationCode):
    user_id: str


class Refresh(RefreshToken):
    user_id: str


class Access(AccessToken):
    user_id: str


# ── storage ─────────────────────────────────────────────────────────────────

class Store(Protocol):
    def put_client(self, client_id: str, info: dict) -> None: ...
    def get_client(self, client_id: str) -> dict | None: ...
    def put_request(self, rid: str, client_id: str, params: dict, expires_at: float) -> None: ...
    def get_request(self, rid: str) -> dict | None: ...
    def delete_request(self, rid: str) -> None: ...
    def put_grant(self, row: dict) -> None: ...
    def get_grant(self, secret_hash: str) -> dict | None: ...
    def revoke(self, secret_hash: str) -> None: ...
    def revoke_all(self, client_id: str, user_id: str) -> None: ...


@dataclass
class MemoryStore:
    """For tests: the same rows, in dictionaries."""
    clients: dict = field(default_factory=dict)
    requests: dict = field(default_factory=dict)
    grants: dict = field(default_factory=dict)

    def put_client(self, client_id, info): self.clients[client_id] = info
    def get_client(self, client_id): return self.clients.get(client_id)
    def put_request(self, rid, client_id, params, expires_at):
        self.requests[rid] = {"id": rid, "client_id": client_id, "params": params,
                              "expires_at": expires_at}
    def get_request(self, rid): return self.requests.get(rid)
    def delete_request(self, rid): self.requests.pop(rid, None)
    def put_grant(self, row): self.grants[row["secret_hash"]] = dict(row)
    def get_grant(self, h): return self.grants.get(h)
    def revoke(self, h):
        if h in self.grants:
            self.grants[h]["revoked"] = True
    def revoke_all(self, client_id, user_id):
        for g in self.grants.values():
            if g["client_id"] == client_id and str(g["user_id"]) == str(user_id):
                g["revoked"] = True


class SupabaseStore:
    """The tables of migration 023, through the backend's service client."""

    def _db(self):
        from services.database import get_supabase
        return get_supabase()

    def put_client(self, client_id, info):
        self._db().table("mcp_clients").upsert({"client_id": client_id, "info": info}).execute()

    def get_client(self, client_id):
        rows = self._db().table("mcp_clients").select("info").eq("client_id", client_id).execute().data
        return rows[0]["info"] if rows else None

    def put_request(self, rid, client_id, params, expires_at):
        self._db().table("mcp_auth_requests").insert({
            "id": rid, "client_id": client_id, "params": params,
            "expires_at": _iso(expires_at)}).execute()

    def get_request(self, rid):
        rows = self._db().table("mcp_auth_requests").select("*").eq("id", rid).execute().data
        if not rows:
            return None
        return {**rows[0], "expires_at": _epoch(rows[0]["expires_at"])}

    def delete_request(self, rid):
        self._db().table("mcp_auth_requests").delete().eq("id", rid).execute()

    def put_grant(self, row):
        self._db().table("mcp_grants").insert({
            **row, "expires_at": _iso(row["expires_at"]) if row.get("expires_at") else None}).execute()

    def get_grant(self, h):
        rows = self._db().table("mcp_grants").select("*").eq("secret_hash", h).execute().data
        if not rows:
            return None
        r = rows[0]
        return {**r, "expires_at": _epoch(r["expires_at"]) if r.get("expires_at") else None}

    def revoke(self, h):
        self._db().table("mcp_grants").update({"revoked": True}).eq("secret_hash", h).execute()

    def revoke_all(self, client_id, user_id):
        (self._db().table("mcp_grants").update({"revoked": True})
         .eq("client_id", client_id).eq("user_id", user_id).execute())


def _iso(epoch: float) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


def _epoch(iso: str) -> float:
    from datetime import datetime
    return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()


# ── the provider ────────────────────────────────────────────────────────────

class SecondBrainOAuth:
    """OAuthAuthorizationServerProvider for the MCP SDK, plus the two things
    the Allow page needs: describe a request, and approve or deny it."""

    def __init__(self, store: Store, allow_page_url: str):
        self.store = store
        self.allow_page_url = allow_page_url

    # registration
    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        info = self.store.get_client(client_id)
        return OAuthClientInformationFull.model_validate(info) if info else None

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        self.store.put_client(client_info.client_id, client_info.model_dump(mode="json"))

    # /authorize: park the request, send the browser to the Allow page
    async def authorize(self, client: OAuthClientInformationFull,
                        params: AuthorizationParams) -> str:
        rid = secrets.token_urlsafe(24)
        self.store.put_request(rid, client.client_id, {
            "state": params.state, "scopes": params.scopes or [SCOPE],
            "code_challenge": params.code_challenge,
            "redirect_uri": str(params.redirect_uri),
            "redirect_uri_provided_explicitly": params.redirect_uri_provided_explicitly,
            "resource": params.resource,
        }, time.time() + REQUEST_SECONDS)
        return f"{self.allow_page_url}?request={rid}"

    def describe(self, rid: str) -> dict | None:
        """What the Allow page shows: which app asks, and for what."""
        req = self.store.get_request(rid)
        if not req or req["expires_at"] < time.time():
            return None
        info = self.store.get_client(req["client_id"]) or {}
        return {"client_name": info.get("client_name") or "An app",
                "client_uri": info.get("client_uri"),
                "redirect_host": _host(req["params"]["redirect_uri"])}

    def approve(self, rid: str, user_id: str) -> str | None:
        """Allow: a one-time code for this user, back to the app."""
        req = self.store.get_request(rid)
        self.store.delete_request(rid)
        if not req or req["expires_at"] < time.time():
            return None
        p = req["params"]
        code = secrets.token_urlsafe(32)
        self.store.put_grant({
            "secret_hash": _hash(code), "kind": "code", "client_id": req["client_id"],
            "user_id": user_id, "scopes": p["scopes"], "revoked": False,
            "params": {k: p[k] for k in ("code_challenge", "redirect_uri",
                                         "redirect_uri_provided_explicitly", "resource")},
            "expires_at": time.time() + CODE_SECONDS})
        return construct_redirect_uri(p["redirect_uri"], code=code, state=p["state"])

    def deny(self, rid: str) -> str | None:
        req = self.store.get_request(rid)
        self.store.delete_request(rid)
        if not req:
            return None
        p = req["params"]
        return construct_redirect_uri(p["redirect_uri"], error="access_denied",
                                      error_description="The user did not allow access.",
                                      state=p["state"])

    # codes and tokens
    def _live(self, secret: str, kind: str, client_id: str | None) -> dict | None:
        g = self.store.get_grant(_hash(secret))
        if not g or g["kind"] != kind or g.get("revoked"):
            return None
        if client_id is not None and g["client_id"] != client_id:
            return None
        if g.get("expires_at") and g["expires_at"] < time.time():
            return None
        return g

    async def load_authorization_code(self, client, authorization_code: str) -> Code | None:
        g = self._live(authorization_code, "code", client.client_id)
        if not g:
            return None
        p = g["params"]
        return Code(code=authorization_code, scopes=g["scopes"], expires_at=g["expires_at"],
                    client_id=g["client_id"], code_challenge=p["code_challenge"],
                    redirect_uri=p["redirect_uri"],
                    redirect_uri_provided_explicitly=p["redirect_uri_provided_explicitly"],
                    resource=p.get("resource"), user_id=str(g["user_id"]))

    def _issue(self, client_id: str, user_id: str, scopes: list[str]) -> OAuthToken:
        access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(40)
        now = time.time()
        for secret, kind, ttl in ((access, "access", ACCESS_SECONDS),
                                  (refresh, "refresh", REFRESH_SECONDS)):
            self.store.put_grant({"secret_hash": _hash(secret), "kind": kind,
                                  "client_id": client_id, "user_id": user_id,
                                  "scopes": scopes, "params": {}, "revoked": False,
                                  "expires_at": now + ttl})
        return OAuthToken(access_token=access, token_type="Bearer", expires_in=ACCESS_SECONDS,
                          scope=" ".join(scopes), refresh_token=refresh)

    async def exchange_authorization_code(self, client, authorization_code: Code) -> OAuthToken:
        self.store.revoke(_hash(authorization_code.code))          # one use only
        return self._issue(client.client_id, authorization_code.user_id,
                           authorization_code.scopes)

    async def load_refresh_token(self, client, refresh_token: str) -> Refresh | None:
        g = self._live(refresh_token, "refresh", client.client_id)
        if not g:
            return None
        return Refresh(token=refresh_token, client_id=g["client_id"], scopes=g["scopes"],
                       expires_at=int(g["expires_at"]) if g.get("expires_at") else None,
                       user_id=str(g["user_id"]))

    async def exchange_refresh_token(self, client, refresh_token: Refresh,
                                     scopes: list[str]) -> OAuthToken:
        self.store.revoke(_hash(refresh_token.token))              # rotated
        return self._issue(client.client_id, refresh_token.user_id,
                           scopes or refresh_token.scopes)

    async def load_access_token(self, token: str) -> Access | None:
        g = self._live(token, "access", None)
        if not g:
            return None
        return Access(token=token, client_id=g["client_id"], scopes=g["scopes"],
                      expires_at=int(g["expires_at"]) if g.get("expires_at") else None,
                      resource=None, user_id=str(g["user_id"]))

    async def revoke_token(self, token: Any) -> None:
        self.store.revoke(_hash(token.token))

    def disconnect(self, token: str, client_id: str, client_secret: str | None) -> None:
        """/revoke (RFC 7009): revoking ANY token of an app disconnects that
        app for that user — its access and refresh tokens alike. Unknown
        tokens are ignored (the RFC answers 200 either way). The MCP SDK's
        own handler required a client_secret field that public clients (chat
        apps) do not send, answered 400, and the token kept working."""
        info = self.store.get_client(client_id)
        if not info:
            return
        secret = info.get("client_secret")
        if secret and secret != client_secret:
            raise PermissionError("client authentication failed")
        g = self.store.get_grant(_hash(token))
        if g and g["client_id"] == client_id:
            self.store.revoke_all(client_id, str(g["user_id"]))


def _host(url: str) -> str:
    from urllib.parse import urlparse
    return urlparse(url).netloc or url
