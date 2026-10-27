"""MCP client — connects to user-configured external MCP servers.

Discovers tools from each server, namespaces them as mcp.<server>.<tool>,
and dispatches calls. Logs each call to mcp_audit_log.
"""
from __future__ import annotations

import asyncio
import time

from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, model_validator

from core.config import settings
from services import egress
from services.text_hygiene import clean_schema, untrusted

#: Longer than any honest tool needs; a poisoned one hides its instructions in
#: the length.
DESCRIPTION_LIMIT = 1024


class McpServerConfig(BaseModel):
    id: str | None = None
    name: str
    transport: str          # 'stdio' | 'http' | 'sse'
    command: str | None = None
    url: str | None = None
    enabled: bool = True
    trust_level: str = "read_only"
    #: Runtime only, never stored: bare names of the tools the model was
    #: offered this turn (services/agent/mcp_pins.py). None = not pinned.
    usable: set[str] | None = None

    @model_validator(mode="after")
    def _check_transport_fields(self):
        if self.transport == "stdio" and not self.command:
            raise ValueError("stdio transport requires a command")
        if self.transport in ("http", "sse") and not self.url:
            raise ValueError(f"{self.transport} transport requires a url")
        return self


@dataclass
class McpToolSchema:
    name: str              # mcp.<server>.<tool>
    description: str
    input_schema: dict

    @classmethod
    def from_mcp_tool(cls, server_name: str, tool) -> "McpToolSchema":
        # The description and schema are prompt text the server controls
        # ("tool poisoning"): cleaned of invisible characters and capped.
        return cls(
            name=f"mcp.{server_name}.{tool.name}",
            description=untrusted(tool.description or "")[:DESCRIPTION_LIMIT],
            input_schema=clean_schema(tool.inputSchema or {"type": "object", "properties": {}}),
        )

    def to_llm_schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
        }


#: Discovery is a network round trip per server, and the engine asked for it on
#: every single turn — a three-server setup paid three connections before the
#: model saw a word. Tool lists change when a server is reconfigured, not
#: between two messages, so a short TTL is plenty. The MCP spec's own list
#: responses now carry cache hints for exactly this reason.
_DISCOVERY_TTL_SECONDS = 300
_discovery_cache: dict[str, tuple[float, list["McpToolSchema"]]] = {}


def _cache_key(config: McpServerConfig) -> str:
    """Anything that changes what the server offers busts the entry."""
    return "|".join(str(x) for x in (
        config.name, getattr(config, "url", ""), getattr(config, "command", ""),
        getattr(config, "args", ""), getattr(config, "transport", "")))


def clear_discovery_cache() -> None:
    """Called when a server is added, edited or toggled — the settings UI must
    not show a stale tool list."""
    _discovery_cache.clear()


async def discover_tools(config: McpServerConfig,
                         use_cache: bool = True) -> list[McpToolSchema]:
    """Connect to a server, list its tools, and return namespaced schemas.

    Returns [] if the server is unreachable (non-fatal). A failure is NOT
    cached: a server that was down a minute ago may be up now, and caching the
    empty list would keep its tools hidden for the whole TTL.
    """
    key = _cache_key(config)
    if use_cache:
        hit = _discovery_cache.get(key)
        if hit and time.monotonic() - hit[0] < _DISCOVERY_TTL_SECONDS:
            return hit[1]

    try:
        tools = await _list_tools(config)
    except Exception:
        return []

    schemas = [McpToolSchema.from_mcp_tool(config.name, t) for t in tools]
    _discovery_cache[key] = (time.monotonic(), schemas)
    return schemas


async def probe(config: McpServerConfig) -> tuple[list[McpToolSchema], str | None]:
    """Settings' "is it working?": the tools, or why there are none. The chat
    path keeps discover_tools' silent [] — one dead server must not break a turn —
    but the settings page used to show "no tools" for a typo'd URL with no reason."""
    try:
        tools = await _list_tools(config)
    except Exception as e:
        return [], _readable(e)
    schemas = [McpToolSchema.from_mcp_tool(config.name, t) for t in tools]
    _discovery_cache[_cache_key(config)] = (time.monotonic(), schemas)
    return schemas, None


async def call_tool(
    config: McpServerConfig,
    tool_name: str,         # bare name (without mcp.<server>. prefix)
    arguments: dict[str, Any],
) -> dict[str, Any]:
    """Call a tool on the server and return the result as a dict."""
    try:
        result = await _call_tool(config, tool_name, arguments)
        return {"content": result, "error": None}
    except Exception as e:
        return {"content": None, "error": _readable(e)}


# ── Transport implementations ──────────────────────────────────────────────

#: A server that never answers must not hold a chat turn (or the settings page) open.
_CONNECT_TIMEOUT_SECONDS = 30


class StdioNotAllowed(PermissionError):
    pass


def _readable(e: BaseException) -> str:
    """The SDK runs transports in anyio task groups, so the real error arrives
    wrapped in (nested) ExceptionGroups; show the innermost one."""
    while isinstance(e, BaseExceptionGroup) and e.exceptions:
        e = e.exceptions[0]
    if isinstance(e, TimeoutError):
        return f"No answer within {_CONNECT_TIMEOUT_SECONDS} s"
    return str(e) or type(e).__name__


async def _with_session(config: McpServerConfig, use):
    """Open a session over the server's transport and return `await use(session)`.

    URL servers: Streamable HTTP at the URL as given (what current servers speak),
    or SSE when the transport is "sse" or the URL ends in /sse. Older configs saved
    a base URL and this client appended "/sse"; when Streamable HTTP fails such a
    URL still gets that legacy SSE attempt, so nothing that worked stops working.
    """
    if config.transport == "stdio":
        if not settings.mcp_allow_stdio:
            raise StdioNotAllowed(
                "stdio servers run a command on the server, so they only work when you run "
                "Second Brain yourself. Use an http server here.")
        return await asyncio.wait_for(_stdio(config, use), _CONNECT_TIMEOUT_SECONDS)

    url = (config.url or "").strip()
    # The URL is the user's: refused here if it points at a private address,
    # and every request the SDK sends (redirects too) is re-checked by the
    # guarded client factory (services/egress.py).
    await egress.check_url_async(url)
    if config.transport == "sse" or url.rstrip("/").endswith("/sse"):
        return await asyncio.wait_for(_sse(url, use), _CONNECT_TIMEOUT_SECONDS)
    try:
        return await asyncio.wait_for(_streamable(url, use), _CONNECT_TIMEOUT_SECONDS)
    except Exception as first:
        try:
            return await asyncio.wait_for(_sse(url.rstrip("/") + "/sse", use),
                                          _CONNECT_TIMEOUT_SECONDS)
        except Exception:
            raise first from None


async def _stdio(config: McpServerConfig, use):
    from mcp import ClientSession
    from mcp.client.stdio import StdioServerParameters, stdio_client

    parts = (config.command or "").split()
    params = StdioServerParameters(command=parts[0], args=parts[1:])
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            return await use(session)


async def _sse(url: str, use):
    from mcp import ClientSession
    from mcp.client.sse import sse_client

    async with sse_client(
            url, httpx_client_factory=egress.guarded_async_client_factory) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            return await use(session)


async def _streamable(url: str, use):
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    async with streamablehttp_client(
            url, httpx_client_factory=egress.guarded_async_client_factory
    ) as (read, write, _session_id):
        async with ClientSession(read, write) as session:
            await session.initialize()
            return await use(session)


async def _list_tools(config: McpServerConfig):
    async def use(session):
        return (await session.list_tools()).tools
    return await _with_session(config, use)


async def _call_tool(config: McpServerConfig, name: str, args: dict):
    async def use(session):
        result = await session.call_tool(name, arguments=args)
        return [c.text if hasattr(c, "text") else str(c) for c in result.content]
    return await _with_session(config, use)


# ── Audit log ─────────────────────────────────────────────────────────────


def log_tool_call(
    user_id: str,
    server_name: str,
    tool_name: str,
    args: dict,
    result_code: str,
) -> None:
    """Persist MCP tool call to mcp_audit_log. Silent on failure."""
    try:
        from services.database import get_supabase
        get_supabase().table("mcp_audit_log").insert({
            "user_id": user_id,
            "server_name": server_name,
            "tool_name": tool_name,
            "args_json": args,
            "result_code": result_code,
        }).execute()
    except Exception:
        pass
