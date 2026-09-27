"""The remote MCP server: your Second Brain for other apps (5.4).

    uvicorn mcp_remote.server:app --port 8765          (./app.sh starts it)

A separate small process on purpose: only THIS port goes through the public
tunnel, so the main backend's endpoints are never exposed. It serves:
  /mcp                    the MCP tools (Streamable HTTP), for a logged-in app
  /register /authorize /token /revoke and .well-known metadata (OAuth, the SDK)
  /consent/{id}           what the Allow page shows and does (needs your
                          Second Brain login)

Every tool acts for the user the token belongs to — never for an id the app
sends. Editing and deleting are not tools here: they need your approval in the
app (phase 2).
"""
from __future__ import annotations

import asyncio
import os
from urllib.parse import urlparse

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions, RevocationOptions
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.requests import Request
from starlette.responses import JSONResponse

from mcp_remote.oauth import SCOPE, SecondBrainOAuth, SupabaseStore

PUBLIC_URL = os.environ.get("MCP_PUBLIC_URL", "http://localhost:8765").rstrip("/")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000").rstrip("/")

def build(store, public_url: str = PUBLIC_URL, frontend_url: str = FRONTEND_URL):
    """(the ASGI app, the OAuth provider) — tests pass an in-memory store."""
    PUBLIC_URL, FRONTEND_URL = public_url.rstrip("/"), frontend_url.rstrip("/")  # noqa: N806
    oauth = SecondBrainOAuth(store, allow_page_url=f"{FRONTEND_URL}/mcp-connect")

    _public_host = urlparse(PUBLIC_URL).netloc
    mcp = FastMCP(
        "Second Brain",
        instructions=("The user's personal knowledge base. Search it before answering "
                      "questions about their studies or notes, cite notes by title with "
                      "their link, and save something only when the user asks to."),
        auth_server_provider=oauth,
        auth=AuthSettings(
            issuer_url=PUBLIC_URL,
            resource_server_url=f"{PUBLIC_URL}/mcp",
            required_scopes=[SCOPE],
            client_registration_options=ClientRegistrationOptions(
                enabled=True, valid_scopes=[SCOPE], default_scopes=[SCOPE]),
            revocation_options=RevocationOptions(enabled=True),
        ),
        streamable_http_path="/mcp",
        stateless_http=True,
        # The tunnel's host name reaches this process; it must be allowed.
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=sorted({"localhost:8765", "127.0.0.1:8765", _public_host}),
            allowed_origins=sorted({f"http://localhost:8765", PUBLIC_URL})),
    )


    def _user() -> str:
        token = get_access_token()
        user_id = getattr(token, "user_id", None)
        if not user_id:
            raise PermissionError("not signed in")
        return user_id


    def _link(note_id: str) -> str:
        return f"{FRONTEND_URL}/brain/{note_id}"


    # ── tools ───────────────────────────────────────────────────────────────────

    @mcp.tool()
    async def search_notes(query: str, limit: int = 8) -> list[dict]:
        """Search the user's notes by meaning and by words. Returns the best
        passages with the note's title and a link."""
        user_id = _user()

        def run():
            from services.embedder import embed
            from services.retriever import retrieve
            return retrieve(embed(query), user_id, query=query)
        hits = await asyncio.to_thread(run)
        out, seen = [], set()
        for h in hits:
            key = (h["id"], h["content_text"][:80])
            if key in seen:
                continue
            seen.add(key)
            out.append({"note_id": h["id"], "title": h["title"], "passage": h["content_text"],
                        "link": f"{FRONTEND_URL}{h['deep_link']}"})
            if len(out) >= max(1, min(limit, 15)):
                break
        return out


    @mcp.tool()
    async def list_notes(limit: int = 30) -> list[dict]:
        """The user's most recently edited notes: id, title, last edit, link."""
        user_id = _user()

        def run():
            from services.database import get_supabase
            return (get_supabase().table("notes").select("id,title,updated_at")
                    .eq("user_id", user_id).is_("deleted_at", "null")
                    .order("updated_at", desc=True).limit(max(1, min(limit, 100)))
                    .execute().data or [])
        rows = await asyncio.to_thread(run)
        return [{"note_id": r["id"], "title": r["title"] or "Untitled",
                 "updated_at": r["updated_at"], "link": _link(r["id"])} for r in rows]


    @mcp.tool()
    async def get_note(note_id: str) -> dict:
        """One note's full text, by its id (from search_notes or list_notes)."""
        user_id = _user()

        def run():
            from services.database import get_supabase
            return (get_supabase().table("notes").select("id,title,content_text,updated_at")
                    .eq("id", note_id).eq("user_id", user_id).is_("deleted_at", "null")
                    .execute().data or [])
        rows = await asyncio.to_thread(run)
        if not rows:
            return {"error": "No note with that id in this Second Brain."}
        r = rows[0]
        return {"note_id": r["id"], "title": r["title"] or "Untitled",
                "text": (r["content_text"] or "")[:30000], "updated_at": r["updated_at"],
                "link": _link(r["id"])}


    @mcp.tool()
    async def create_note(title: str, content_markdown: str) -> dict:
        """Save a NEW note in the user's Second Brain (Markdown: headings, lists,
        paragraphs). Use only when the user asks to save something. It never
        changes an existing note."""
        user_id = _user()

        def run():
            from mcp_remote.blocks import markdown_to_blocks
            from services.agent.brain_tools import _create_note
            return _create_note({"title": title.strip()[:200] or "Untitled",
                                 "blocks": markdown_to_blocks(content_markdown)}, user_id)
        row = await asyncio.to_thread(run)
        if not row:
            return {"error": "The note could not be saved."}
        return {"note_id": row["id"], "title": row["title"], "link": _link(row["id"])}


    # ── the Allow page's two calls (need the user's Second Brain login) ─────────

    def _signed_in(request: Request) -> str | None:
        from routers.ingest import get_user_id
        try:
            return get_user_id(request.headers.get("authorization", ""))
        except Exception:                              # noqa: BLE001
            return None


    @mcp.custom_route("/consent/{rid}", methods=["GET"])
    async def consent_info(request: Request) -> JSONResponse:
        if not await asyncio.to_thread(_signed_in, request):
            return JSONResponse({"error": "sign in first"}, status_code=401)
        info = await asyncio.to_thread(oauth.describe, request.path_params["rid"])
        if not info:
            return JSONResponse({"error": "This request expired. Start again from the app."},
                                status_code=404)
        return JSONResponse(info)


    @mcp.custom_route("/consent/{rid}", methods=["POST"])
    async def consent_answer(request: Request) -> JSONResponse:
        user_id = await asyncio.to_thread(_signed_in, request)
        if not user_id:
            return JSONResponse({"error": "sign in first"}, status_code=401)
        body = await request.json()
        rid = request.path_params["rid"]
        if body.get("allow") is True:
            redirect = await asyncio.to_thread(oauth.approve, rid, user_id)
        else:
            redirect = await asyncio.to_thread(oauth.deny, rid)
        if not redirect:
            return JSONResponse({"error": "This request expired. Start again from the app."},
                                status_code=404)
        return JSONResponse({"redirect": redirect})


    return mcp.streamable_http_app(), oauth


app, _oauth = build(SupabaseStore())
