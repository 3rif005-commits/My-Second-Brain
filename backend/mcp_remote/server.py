"""The remote MCP server: your Second Brain for other apps (5.4).

    uvicorn mcp_remote.server:app --port 8765          (./app.sh starts it)

A separate small process on purpose: only THIS port goes through the public
tunnel, so the main backend's endpoints are never exposed. It serves:
  /mcp                    the MCP tools (Streamable HTTP), for a logged-in app
  /register /authorize /token /revoke and .well-known metadata (OAuth, the SDK)
  /consent/{id}           what the Allow page shows and does (needs your
                          Second Brain login)

Every tool acts for the user the token belongs to — never for an id the app
sends. Editing and deleting are only ASKED for: the change waits until you
approve it in Settings → Connected apps (phase 2).
"""
from __future__ import annotations

import asyncio
import os
from typing import Any
from urllib.parse import urlparse

from services import privacy
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions, RevocationOptions
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from mcp_remote.apps import MIME_TYPE as UI_MIME_TYPE
from mcp_remote.apps import PENDING_CHANGE_HTML, RESOURCE_URI as PENDING_CHANGE_URI
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
                      "questions about their studies or notes. Whenever you use a note, "
                      "cite it with its `cite` Markdown link — the link opens the exact "
                      "passage in Second Brain; never give a note's title without it. "
                      "Save something only when the user asks to."),
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


    # MCP Apps (SEP-1865): a card for a pending change, shown inline in the
    # host's chat when it supports the extension; a host that does not just
    # shows the tool's own text result instead (the spec's own fallback).
    @mcp.resource(
        PENDING_CHANGE_URI, name="pending_change_card",
        description="A read-only preview of a change waiting for the user's approval.",
        mime_type=UI_MIME_TYPE,
        meta={"ui": {"prefersBorder": True}},
    )
    def pending_change_resource() -> str:
        return PENDING_CHANGE_HTML


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
    async def search_notes(query: str, limit: int = 8) -> dict:
        """Search the user's notes by meaning and by words. Returns the best
        passages. Each has `cite`: a Markdown link to that exact passage in
        Second Brain — put it in your answer next to anything taken from it."""
        user_id = _user()

        def run():
            from services.embedder import embed
            from services.retriever import retrieve
            return retrieve(embed(query), user_id, query=query)
        hits = await asyncio.to_thread(run)
        # Private notes never leave this machine — this app is outside it.
        hits = await asyncio.to_thread(privacy.for_outside_app, hits, user_id)
        out, seen = [], set()
        for h in hits:
            key = (h["id"], h["content_text"][:80])
            if key in seen:
                continue
            seen.add(key)
            link = f"{FRONTEND_URL}{h['deep_link']}"
            title = h["title"] or "Untitled"
            out.append({"note_id": h["id"], "title": title, "passage": h["content_text"],
                        "link": link, "cite": f"[{title}]({link})"})
            if len(out) >= max(1, min(limit, 15)):
                break
        # Said inside the result, next to the passages: in the tool's
        # description alone, claude.ai's model gave titles without links.
        return {"cite_rule": ("In your answer, put each result's `cite` link next to "
                              "what you take from it — it opens that exact passage in "
                              "Second Brain."),
                "results": out}


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
        rows = await asyncio.to_thread(privacy.for_outside_app, rows, user_id)
        return [{"note_id": r["id"], "title": r["title"] or "Untitled",
                 "updated_at": r["updated_at"], "link": _link(r["id"]),
                 "cite": f"[{r['title'] or 'Untitled'}]({_link(r['id'])})"} for r in rows]


    @mcp.tool()
    async def get_note(note_id: str) -> dict:
        """One note's full text, by its id (from search_notes or list_notes).
        Cite it with the returned `cite` Markdown link."""
        user_id = _user()

        def run():
            from services.database import get_supabase
            return (get_supabase().table("notes").select("id,title,content_text,updated_at")
                    .eq("id", note_id).eq("user_id", user_id).is_("deleted_at", "null")
                    .execute().data or [])
        rows = await asyncio.to_thread(run)
        if rows and not await asyncio.to_thread(privacy.outside_app_may_see, note_id, user_id):
            return {"error": "That note is private: it stays on the user's device."}
        if not rows:
            return {"error": "No note with that id in this Second Brain."}
        r = rows[0]
        title = r["title"] or "Untitled"
        return {"note_id": r["id"], "title": title,
                "text": (r["content_text"] or "")[:30000], "updated_at": r["updated_at"],
                "link": _link(r["id"]), "cite": f"[{title}]({_link(r['id'])})"}


    @mcp.tool()
    async def list_note_sources(note_id: str) -> dict:
        """The sources attached to one note (PDFs, videos, web pages): id, title,
        kind, pages or duration, and how many figures, tables and formulas each
        has. Read them with find_source_elements."""
        user_id = _user()
        if not await asyncio.to_thread(privacy.outside_app_may_see, note_id, user_id):
            return {"error": "That note is private (or not found): its sources stay on the user's device."}
        from services.agent import source_tools
        out = await asyncio.to_thread(source_tools.list_sources, {},
                                      source_tools.SourceTurn(note_ids=[note_id], user_id=user_id))
        return {**out, "link": _link(note_id)}

    @mcp.tool()
    async def find_source_elements(note_id: str, source_id: str, page: int | None = None,
                                   type: str = "") -> dict:
        """A PDF source's figures, tables, formulas and headings, as text:
        tables as markdown, formulas as LaTeX, figures as a description when one
        has been written. `page` gives everything on one page; `type` is one of
        figure, table, formula, heading, text."""
        user_id = _user()
        if not await asyncio.to_thread(privacy.outside_app_may_see, note_id, user_id):
            return {"error": "That note is private (or not found): its sources stay on the user's device."}
        from services.agent import source_tools
        turn = source_tools.SourceTurn(note_ids=[note_id], user_id=user_id)
        try:
            return await asyncio.to_thread(source_tools.find_elements,
                                           {"source_id": source_id, "page": page, "type": type}, turn)
        except source_tools.SourceToolError as e:
            return {"error": str(e)}

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


    # Changing or deleting an existing note is only ever ASKED for: the user
    # approves it in Settings → Connected apps. Said plainly, so the app does
    # not report it as done (HARNESS.md: a held action is NOT done).
    _WAITING = ("NOT DONE YET — waiting for the user to approve it in Second Brain "
                "(Settings → Connected apps). Tell the user it is waiting for their "
                "approval; you can check later with check_change.")

    def _client() -> str:
        return get_access_token().client_id

    _APPROVAL_UI = {"ui": {"resourceUri": PENDING_CHANGE_URI}}

    def _reviewed(out: dict) -> dict:
        return {**out, "message": _WAITING, "review_url": f"{FRONTEND_URL}/brain/settings/connected-apps"}

    @mcp.tool(meta=_APPROVAL_UI, structured_output=True)
    async def update_note(note_id: str, content_markdown: str, title: str = "",
                          reason: str = "") -> dict[str, Any]:
        """ASK to replace an existing note's text (Markdown) and, optionally, its
        title. Nothing changes until the user approves it in Second Brain."""
        user_id, client_id = _user(), _client()
        payload = {"content_markdown": content_markdown}
        if title.strip():
            payload["title"] = title.strip()[:200]

        def run():
            from services import connected_apps as apps
            return apps.propose(user_id, client_id, note_id, "update", payload, reason)
        try:
            out = await asyncio.to_thread(run)
        except ValueError as e:
            return {"error": str(e)}
        return _reviewed(out)

    @mcp.tool(meta=_APPROVAL_UI, structured_output=True)
    async def delete_note(note_id: str, reason: str = "") -> dict[str, Any]:
        """ASK to move a note to the Trash. Nothing happens until the user
        approves it in Second Brain; a deleted note can be restored."""
        user_id, client_id = _user(), _client()

        def run():
            from services import connected_apps as apps
            return apps.propose(user_id, client_id, note_id, "delete", None, reason)
        try:
            out = await asyncio.to_thread(run)
        except ValueError as e:
            return {"error": str(e)}
        return _reviewed(out)

    @mcp.tool()
    async def check_change(change_id: str) -> dict:
        """Whether the user approved or rejected a change you asked for."""
        user_id, client_id = _user(), _client()

        def run():
            from services import connected_apps as apps
            return apps.status(user_id, client_id, change_id)
        row = await asyncio.to_thread(run)
        if not row:
            return {"error": "No change with that id from this app."}
        return {"change_id": row["id"], "status": row["status"], "action": row["action"]}

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


    async def revoke(request: Request):
        form = await request.form()
        token, client_id = form.get("token"), form.get("client_id")
        if not token or not client_id:
            return JSONResponse({"error": "invalid_request"}, status_code=400)
        try:
            await asyncio.to_thread(oauth.disconnect, str(token), str(client_id),
                                    form.get("client_secret"))
        except PermissionError:
            return JSONResponse({"error": "unauthorized_client"}, status_code=401)
        return Response(status_code=200, headers={"Cache-Control": "no-store"})

    app = mcp.streamable_http_app()
    # Ours first: the SDK's /revoke refused public clients (see disconnect).
    app.router.routes.insert(0, Route("/revoke", revoke, methods=["POST"]))
    return app, oauth


app, _oauth = build(SupabaseStore())
