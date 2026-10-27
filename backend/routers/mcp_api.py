"""GET/POST/PATCH/DELETE /mcp-servers — user-facing CRUD for MCP server configurations.

Also: GET /mcp-servers/{server_id}/tools — live tool discovery for the settings UI.
      GET /mcp-audit-log — recent audit log entries.
"""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from routers.ingest import get_user_id
from core.config import settings
from services.agent import mcp_pins
from services.agent.mcp_client import McpServerConfig, clear_discovery_cache, probe
from services import egress
from services.database import get_supabase

router = APIRouter(tags=["mcp"])


class ServerPayload(BaseModel):
    name: str
    transport: str
    command: str | None = None
    url: str | None = None
    trust_level: str = "read_only"


@router.get("/mcp-servers")
def list_servers(authorization: str = Header()):
    user_id = get_user_id(authorization)
    rows = (
        get_supabase()
        .table("mcp_servers")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at")
        .execute()
        .data
        or []
    )
    # The form only offers stdio where it can work (see settings.mcp_allow_stdio).
    return {"servers": rows, "stdio_allowed": settings.mcp_allow_stdio}


@router.post("/mcp-servers", status_code=201)
def add_server(payload: ServerPayload, authorization: str = Header()):
    user_id = get_user_id(authorization)
    try:
        McpServerConfig(
            name=payload.name,
            transport=payload.transport,
            command=payload.command,
            url=payload.url,
            enabled=True,
            trust_level=payload.trust_level,
        )
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    if payload.transport == "stdio" and not settings.mcp_allow_stdio:
        raise HTTPException(400, detail="stdio servers run a command on the server, so they only "
                                        "work when you run Second Brain yourself. Use an http server.")
    if payload.transport != "stdio":
        try:
            egress.check_url(payload.url or "")
        except egress.EgressBlocked as e:
            raise HTTPException(400, detail=str(e)) from None

    row = (
        get_supabase()
        .table("mcp_servers")
        .insert({
            "user_id": user_id,
            "name": payload.name,
            "transport": payload.transport,
            "command": payload.command,
            "url": payload.url,
            "trust_level": payload.trust_level,
        })
        .execute()
        .data[0]
    )
    clear_discovery_cache()   # a new server's tools must show up immediately
    return row


@router.patch("/mcp-servers/{server_id}")
def toggle_server(server_id: str, body: dict, authorization: str = Header()):
    user_id = get_user_id(authorization)
    allowed_keys = {"enabled", "trust_level"}
    update = {k: v for k, v in body.items() if k in allowed_keys}
    if not update:
        raise HTTPException(400, detail="Nothing to update")
    rows = (
        get_supabase()
        .table("mcp_servers")
        .update(update)
        .eq("id", server_id)
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(404, detail="Server not found")
    clear_discovery_cache()   # command, url or enabled changed → tools may have
    return rows[0]


@router.delete("/mcp-servers/{server_id}", status_code=204)
def delete_server(server_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    get_supabase().table("mcp_servers").delete().eq("id", server_id).eq("user_id", user_id).execute()
    clear_discovery_cache()   # a removed server must not keep offering tools


@router.get("/mcp-servers/{server_id}/tools")
async def list_server_tools(server_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    row = (
        get_supabase()
        .table("mcp_servers")
        .select("*")
        .eq("id", server_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
        .data
    )
    if not row:
        raise HTTPException(404, detail="Server not found")
    config = McpServerConfig(**row)
    # Settings shows what the server offers right now, or why it offers nothing:
    # a user who just fixed a broken URL must not be told the old story for five
    # minutes, and a typo must not look like a server with no tools.
    tools, error = await probe(config)
    if "approved_tools" not in row:                    # migration 032 not applied
        return {"tools": [{**t.to_llm_schema(), "status": mcp_pins.APPROVED}
                          for t in tools], "removed": [], "pinning": False, "error": error}
    approved = row.get("approved_tools")
    if approved is None and tools:
        # First look at this server: what the user sees now is what is trusted.
        approved = mcp_pins.pins_for(tools)
        mcp_pins.save(server_id, user_id, approved)
    return {**mcp_pins.review(tools, approved), "pinning": True, "error": error}


class ApprovePayload(BaseModel):
    #: tool name → the fingerprint the Settings page showed for it
    tools: dict[str, str]


@router.post("/mcp-servers/{server_id}/approve-tools")
async def approve_server_tools(server_id: str, body: ApprovePayload,
                               authorization: str = Header()):
    """Accept new or changed tools — exactly as the user saw them. A tool that
    changed again since the page loaded is refused and shown afresh."""
    user_id = get_user_id(authorization)
    row = (get_supabase().table("mcp_servers").select("*").eq("id", server_id)
           .eq("user_id", user_id).maybe_single().execute().data)
    if not row:
        raise HTTPException(404, detail="Server not found")
    if "approved_tools" not in row:
        raise HTTPException(409, detail="Tool approval needs database migration 032.")
    tools, error = await probe(McpServerConfig(**row))
    if error:
        raise HTTPException(502, detail=f"Could not reach the server to check its tools: {error}")
    pins, refused = mcp_pins.approve(row.get("approved_tools"), tools, body.tools)
    if not mcp_pins.save(server_id, user_id, pins):
        raise HTTPException(500, detail="Could not save the approval.")
    clear_discovery_cache()
    return {**mcp_pins.review(tools, pins), "refused": refused, "pinning": True, "error": None}


@router.get("/mcp-audit-log")
def get_audit_log(authorization: str = Header(), limit: int = 50):
    user_id = get_user_id(authorization)
    rows = (
        get_supabase()
        .table("mcp_audit_log")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
        or []
    )
    return {"entries": rows}
