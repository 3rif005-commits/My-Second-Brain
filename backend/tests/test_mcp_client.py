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


# ── transports (live check 2026-10-24) ────────────────────────────────────────
# Every "http" server got "/sse" appended and was spoken to over SSE only, so a
# current server (Streamable HTTP, e.g. https://mcp.deepwiki.com/mcp, whose SSE
# endpoint now answers 410) could never connect — and settings showed no reason.

from services.agent import mcp_client as mc


def _record(monkeypatch, fail=()):
    calls = []

    def fake(kind):
        async def run(target, use):
            calls.append((kind, target))
            if kind in fail:
                raise ConnectionError(f"{kind} refused")
            return f"{kind} ok"
        return run

    monkeypatch.setattr(mc, "_streamable", fake("streamable"))
    monkeypatch.setattr(mc, "_sse", fake("sse"))
    monkeypatch.setattr(mc, "_stdio", fake("stdio"))
    return calls


async def _use(session):
    return session


@pytest.mark.asyncio
async def test_an_http_url_is_used_as_given_over_streamable_http(monkeypatch):
    calls = _record(monkeypatch)
    cfg = mc.McpServerConfig(name="dw", transport="http", url="https://mcp.deepwiki.com/mcp")
    assert await mc._with_session(cfg, _use) == "streamable ok"
    assert calls == [("streamable", "https://mcp.deepwiki.com/mcp")]


@pytest.mark.asyncio
async def test_an_sse_url_or_transport_goes_straight_to_sse(monkeypatch):
    calls = _record(monkeypatch)
    await mc._with_session(mc.McpServerConfig(name="a", transport="http", url="https://x.dev/sse"), _use)
    await mc._with_session(mc.McpServerConfig(name="b", transport="sse", url="https://y.dev/events"), _use)
    assert calls == [("sse", "https://x.dev/sse"), ("sse", "https://y.dev/events")]


@pytest.mark.asyncio
async def test_a_legacy_base_url_still_gets_the_old_sse_attempt(monkeypatch):
    calls = _record(monkeypatch, fail={"streamable"})
    cfg = mc.McpServerConfig(name="old", transport="http", url="http://localhost:3001/")
    assert await mc._with_session(cfg, _use) == "sse ok"
    assert calls[-1] == ("sse", "http://localhost:3001/sse")


@pytest.mark.asyncio
async def test_when_both_fail_the_streamable_error_is_the_one_shown(monkeypatch):
    _record(monkeypatch, fail={"streamable", "sse"})
    cfg = mc.McpServerConfig(name="dead", transport="http", url="https://dead.dev/mcp")
    tools, error = await mc.probe(cfg)
    assert tools == [] and error == "streamable refused"


@pytest.mark.asyncio
async def test_stdio_is_refused_where_it_is_not_allowed(monkeypatch):
    calls = _record(monkeypatch)
    monkeypatch.setattr(mc.settings, "mcp_allow_stdio", False)
    cfg = mc.McpServerConfig(name="sh", transport="stdio", command="rm -rf /")
    tools, error = await mc.probe(cfg)
    assert tools == [] and "only work when you run Second Brain yourself" in error
    assert calls == []                                   # nothing was ever started
    monkeypatch.setattr(mc.settings, "mcp_allow_stdio", True)
    assert await mc._with_session(cfg, _use) == "stdio ok"


def test_errors_are_unwrapped_from_task_groups():
    nested = ExceptionGroup("outer", [ExceptionGroup("inner", [OSError("Name or service not known")])])
    assert mc._readable(nested) == "Name or service not known"
    assert "30 s" in mc._readable(TimeoutError())


def test_the_api_refuses_stdio_and_bad_urls(monkeypatch):
    from fastapi import HTTPException

    from routers import mcp_api
    monkeypatch.setattr(mcp_api, "get_user_id", lambda auth: "u1")
    monkeypatch.setattr(mcp_api.settings, "mcp_allow_stdio", False)
    for body, msg in [
        (dict(name="sh", transport="stdio", command="bash -c x"), "run Second Brain yourself"),
        (dict(name="x", transport="http", url="mcp.deepwiki.com/mcp"), "https://"),
    ]:
        with pytest.raises(HTTPException) as e:
            mcp_api.add_server(mcp_api.ServerPayload(**body), authorization="Bearer x")
        assert e.value.status_code == 400 and msg in e.value.detail
