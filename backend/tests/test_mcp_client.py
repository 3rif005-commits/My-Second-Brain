"""Tests for MCP client — tool discovery and call dispatch."""
from __future__ import annotations

from unittest.mock import MagicMock
import pytest
from services.agent.mcp_client import McpServerConfig, McpToolSchema


def _fake_tool(name: str, description: str) -> MagicMock:
    t = MagicMock()
    t.name = name
    t.description = description
    t.inputSchema = {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}
    return t


def test_mcp_tool_schema_namespace():
    tool = _fake_tool("search", "Search the web")
    schema = McpToolSchema.from_mcp_tool("websearch", tool)
    assert schema.name == "mcp.websearch.search"
    assert schema.description == "Search the web"
    assert schema.input_schema["properties"]["query"]["type"] == "string"


def test_mcp_server_config_validation():
    cfg = McpServerConfig(
        name="websearch",
        transport="http",
        url="http://localhost:3001",
        enabled=True,
        trust_level="read_only",
    )
    assert cfg.name == "websearch"


def test_mcp_server_config_stdio_requires_command():
    with pytest.raises(ValueError, match="command"):
        McpServerConfig(name="local", transport="stdio", url=None, command=None,
                        enabled=True, trust_level="read_only")


# ── discovery caching ────────────────────────────────────────────────────────
#
# The engine asked every configured server for its tool list on every single
# turn: three servers meant three connections before the model saw a word.

import pytest

from services.agent import mcp_client


@pytest.fixture(autouse=True)
def _clean_cache():
    mcp_client.clear_discovery_cache()
    yield
    mcp_client.clear_discovery_cache()


def _cfg(name="srv", command="run-me"):
    return McpServerConfig(id="1", user_id="u1", name=name,
                           transport="stdio", command=command,
                           trust_level="trusted", enabled=True)


class _Tool:
    def __init__(self, name):
        self.name = name
        self.description = ""
        self.inputSchema = {"type": "object", "properties": {}}


@pytest.mark.asyncio
async def test_a_second_turn_reuses_the_discovered_tools(monkeypatch):
    calls = []

    async def fake_list(config):
        calls.append(config.name)
        return [_Tool("search")]

    monkeypatch.setattr(mcp_client, "_list_tools", fake_list)

    first = await mcp_client.discover_tools(_cfg())
    second = await mcp_client.discover_tools(_cfg())

    assert len(calls) == 1                 # one connection, not two
    assert [t.name for t in first] == [t.name for t in second]


@pytest.mark.asyncio
async def test_a_failure_is_never_cached(monkeypatch):
    """A server that was down a minute ago may be up now; caching the empty
    list would hide its tools for the whole TTL."""
    attempts = []

    async def flaky(config):
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError("connection refused")
        return [_Tool("search")]

    monkeypatch.setattr(mcp_client, "_list_tools", flaky)

    assert await mcp_client.discover_tools(_cfg()) == []
    recovered = await mcp_client.discover_tools(_cfg())
    assert [t.name for t in recovered] == ["mcp.srv.search"]


@pytest.mark.asyncio
async def test_changing_the_command_is_a_different_entry(monkeypatch):
    calls = []

    async def fake_list(config):
        calls.append(config.command)
        return [_Tool("search")]

    monkeypatch.setattr(mcp_client, "_list_tools", fake_list)

    await mcp_client.discover_tools(_cfg(command="old"))
    await mcp_client.discover_tools(_cfg(command="new"))
    assert calls == ["old", "new"]


@pytest.mark.asyncio
async def test_the_settings_page_can_ask_for_the_live_truth(monkeypatch):
    calls = []

    async def fake_list(config):
        calls.append(1)
        return [_Tool("search")]

    monkeypatch.setattr(mcp_client, "_list_tools", fake_list)

    await mcp_client.discover_tools(_cfg())
    await mcp_client.discover_tools(_cfg(), use_cache=False)
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_the_cache_expires(monkeypatch):
    calls = []

    async def fake_list(config):
        calls.append(1)
        return [_Tool("search")]

    monkeypatch.setattr(mcp_client, "_list_tools", fake_list)
    monkeypatch.setattr(mcp_client, "_DISCOVERY_TTL_SECONDS", 0)

    await mcp_client.discover_tools(_cfg())
    await mcp_client.discover_tools(_cfg())
    assert len(calls) == 2
