"""services/egress.py — the SSRF guard on every URL a user chooses.

No network: name resolution is faked through socket.getaddrinfo and HTTP through
httpx.MockTransport. Every test that expects a refusal turns private addresses
off explicitly, because on a developer machine they are allowed by default.
"""
import ipaddress
import socket
import sys
import types

import httpx
import pytest

from services import egress


def _fake_dns(monkeypatch, table: dict[str, list[str]]):
    def getaddrinfo(host, port, *a, **kw):
        if host not in table:
            raise socket.gaierror(f"unknown host {host}")
        return [(socket.AF_INET6 if ":" in ip else socket.AF_INET, socket.SOCK_STREAM, 6, "",
                 (ip, 0)) for ip in table[host]]
    monkeypatch.setattr(egress.socket, "getaddrinfo", getaddrinfo)


@pytest.fixture(autouse=True)
def hosted(monkeypatch):
    """As on Render: private addresses refused."""
    monkeypatch.setattr(egress.settings, "egress_allow_private", False)
    egress._recent.clear()


# ── which addresses count as public ─────────────────────────────────────────

@pytest.mark.parametrize("ip", [
    "127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1",
    "::ffff:127.0.0.1",          # IPv4-mapped
    "::ffff:169.254.169.254",
    "2002:a9fe:a9fe::",          # 6to4 wrapping 169.254.169.254
    "64:ff9b::a9fe:a9fe",        # NAT64 wrapping 169.254.169.254
    "2001:0:4136:e378:8000:63bf:f5ff:fffe",  # Teredo, inner 10.0.0.1
])
def test_non_public_addresses(ip):
    assert not egress.is_public(ipaddress.ip_address(ip))


@pytest.mark.parametrize("ip", ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111",
                                "64:ff9b::5db8:d822"])  # NAT64 of a public address
def test_public_addresses(ip):
    assert egress.is_public(ipaddress.ip_address(ip))


# ── check_url ──────────────────────────────────────────────────────────────

def test_metadata_ip_literal_is_refused():
    with pytest.raises(egress.EgressBlocked, match="private or local"):
        egress.check_url("http://169.254.169.254/latest/meta-data/")


def test_a_name_that_resolves_private_is_refused(monkeypatch):
    _fake_dns(monkeypatch, {"evil.example": ["93.184.216.34", "10.0.0.7"]})
    # One private answer is enough: the connection could pick either.
    with pytest.raises(egress.EgressBlocked):
        egress.check_url("https://evil.example/mcp")


def test_localhost_is_refused(monkeypatch):
    _fake_dns(monkeypatch, {"localhost": ["127.0.0.1", "::1"]})
    with pytest.raises(egress.EgressBlocked):
        egress.check_url("http://localhost:8000/internal/search")


def test_public_name_passes(monkeypatch):
    _fake_dns(monkeypatch, {"example.com": ["93.184.216.34"]})
    egress.check_url("https://example.com/page")


@pytest.mark.parametrize("url", ["file:///etc/passwd", "gopher://x", "ftp://example.com",
                                 "javascript:alert(1)", "example.com", ""])
def test_only_http_and_https(url):
    with pytest.raises(egress.EgressBlocked):
        egress.check_url(url)


def test_https_only_when_asked(monkeypatch):
    _fake_dns(monkeypatch, {"example.com": ["93.184.216.34"]})
    with pytest.raises(egress.EgressBlocked, match="https://"):
        egress.check_url("http://example.com", schemes=("https",))


def test_unknown_host_is_a_readable_error(monkeypatch):
    _fake_dns(monkeypatch, {})
    with pytest.raises(egress.EgressBlocked, match="Could not find"):
        egress.check_url("https://no-such-host.example")


def test_private_allowed_on_your_own_machine(monkeypatch):
    monkeypatch.setattr(egress.settings, "egress_allow_private", True)
    egress.check_url("http://127.0.0.1:11434/v1")      # Ollama on localhost


def test_cached_check_skips_dns_only_after_a_real_pass(monkeypatch):
    _fake_dns(monkeypatch, {"api.example": ["93.184.216.34"]})
    egress.check_url("https://api.example/v1", cached=True)
    # The name now points inside (DNS rebinding). The cache vouches for a short
    # while only on the cached path; a real connection re-resolves.
    _fake_dns(monkeypatch, {"api.example": ["10.0.0.1"]})
    egress.check_url("https://api.example/v1", cached=True)
    with pytest.raises(egress.EgressBlocked):
        egress.check_url("https://api.example/v1")


def test_a_refused_name_is_never_cached(monkeypatch):
    _fake_dns(monkeypatch, {"api.example": ["10.0.0.1"]})
    for _ in range(2):
        with pytest.raises(egress.EgressBlocked):
            egress.check_url("https://api.example/v1", cached=True)


# ── fetch: redirects and the connected address ─────────────────────────────

def _mock_client(monkeypatch, handler):
    real = httpx.Client

    def client(*a, **kw):
        kw["transport"] = httpx.MockTransport(handler)
        return real(*a, **kw)
    monkeypatch.setattr(egress.httpx, "Client", client)


def test_fetch_follows_a_public_redirect(monkeypatch):
    _fake_dns(monkeypatch, {"a.example": ["93.184.216.34"], "b.example": ["1.1.1.1"]})

    def handler(req):
        if req.url.host == "a.example":
            return httpx.Response(302, headers={"location": "https://b.example/final"})
        return httpx.Response(200, html="<html><body>hello</body></html>")
    _mock_client(monkeypatch, handler)
    got = egress.fetch("https://a.example/start")
    assert got.url == "https://b.example/final" and "hello" in got.text


def test_fetch_refuses_a_redirect_into_the_private_network(monkeypatch):
    _fake_dns(monkeypatch, {"a.example": ["93.184.216.34"]})
    seen = []

    def handler(req):
        seen.append(str(req.url))
        return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data/"})
    _mock_client(monkeypatch, handler)
    with pytest.raises(egress.EgressBlocked):
        egress.fetch("https://a.example/start")
    assert seen == ["https://a.example/start"], "the private hop must never be requested"


def test_fetch_caps_the_size(monkeypatch):
    _fake_dns(monkeypatch, {"a.example": ["93.184.216.34"]})
    _mock_client(monkeypatch, lambda req: httpx.Response(200, content=b"x" * 5000))
    with pytest.raises(ValueError, match="too large"):
        egress.fetch("https://a.example/", max_bytes=1000)


def test_fetch_error_status_is_a_value_error(monkeypatch):
    _fake_dns(monkeypatch, {"a.example": ["93.184.216.34"]})
    _mock_client(monkeypatch, lambda req: httpx.Response(404))
    with pytest.raises(ValueError, match="404"):
        egress.fetch("https://a.example/")


def test_fetch_redirect_loop_ends(monkeypatch):
    _fake_dns(monkeypatch, {"a.example": ["93.184.216.34"]})
    _mock_client(monkeypatch, lambda req: httpx.Response(302, headers={"location": "/again"}))
    with pytest.raises(ValueError, match="Too many redirects"):
        egress.fetch("https://a.example/", max_redirects=3)


class _Stream:
    def __init__(self, addr):
        self.addr = addr

    def get_extra_info(self, key):
        return self.addr if key == "server_addr" else None


def _response_from(addr):
    r = httpx.Response(200, request=httpx.Request("GET", "https://rebind.example/"))
    r.extensions["network_stream"] = _Stream(addr)
    return r


def test_check_peer_catches_dns_rebinding():
    with pytest.raises(egress.EgressBlocked):
        egress.check_peer(_response_from(("10.1.2.3", 443)))
    egress.check_peer(_response_from(("93.184.216.34", 443)))
    egress.check_peer(httpx.Response(200, request=httpx.Request("GET", "https://x.example/")))


# ── the MCP SDK's client factory ───────────────────────────────────────────

async def test_guarded_mcp_client_refuses_a_private_redirect(monkeypatch):
    _fake_dns(monkeypatch, {"mcp.example": ["93.184.216.34"]})
    seen = []

    def handler(req):
        seen.append(req.url.host)
        if req.url.host == "mcp.example":
            return httpx.Response(307, headers={"location": "http://127.0.0.1:8000/internal/search"})
        return httpx.Response(200)
    client = egress.guarded_async_client_factory()
    client._transport = httpx.MockTransport(handler)
    async with client:
        with pytest.raises(egress.EgressBlocked):
            await client.post("https://mcp.example/mcp", json={})
    assert seen == ["mcp.example"]


# ── the places that use it ─────────────────────────────────────────────────

def test_mcp_server_with_a_private_url_cannot_be_added(monkeypatch):
    from fastapi.testclient import TestClient
    import main
    from routers import mcp_api
    monkeypatch.setattr(mcp_api, "get_user_id", lambda auth: "u1")
    monkeypatch.setattr(mcp_api, "get_supabase",
                        lambda: (_ for _ in ()).throw(AssertionError("must not insert")))
    r = TestClient(main.app).post(
        "/mcp-servers", headers={"authorization": "Bearer x"},
        json={"name": "meta", "transport": "http", "url": "http://169.254.169.254/mcp"})
    assert r.status_code == 400 and "private or local" in r.text


async def test_mcp_connection_is_refused_before_any_request(monkeypatch):
    from services.agent import mcp_client
    called = []
    monkeypatch.setattr(mcp_client, "_streamable", lambda url, use: called.append(url))
    cfg = mcp_client.McpServerConfig(name="x", transport="http", url="http://10.0.0.8/mcp")
    tools, error = await mcp_client.probe(cfg)
    assert tools == [] and "private or local" in error and called == []


def test_saved_ai_provider_pointing_inside_is_skipped(monkeypatch):
    from services.ai import providers
    rows = [{"provider": "openai_compatible", "api_key": "k", "base_url": "http://169.254.169.254/v1",
             "label": "bad"},
            {"provider": "anthropic", "api_key": "k2", "base_url": None, "label": "good"}]

    class Q:
        def __getattr__(self, name):
            return lambda *a, **k: self
        data = rows
    fake = types.SimpleNamespace(table=lambda name: Q())
    monkeypatch.setitem(sys.modules, "services.database",
                        types.SimpleNamespace(get_supabase=lambda: fake))
    got = providers._user_providers("u1")
    assert [p.label for p in got] == ["good"]


async def test_webhook_to_a_private_address_is_a_config_error(monkeypatch):
    from services.db import automations
    with pytest.raises(automations.ActionConfigError, match="private or local"):
        await automations._action_send_webhook(
            {"url": "http://127.0.0.1:6379/"}, ctx=None)


def test_article_import_fetches_only_through_the_guard(monkeypatch):
    """extract_url used trafilatura.fetch_url, which followed any URL anywhere."""
    sys.modules.setdefault("trafilatura", types.ModuleType("trafilatura"))
    from services import url_extractor
    fetched = []
    monkeypatch.setattr(url_extractor.egress, "fetch",
                        lambda url: fetched.append(url) or (_ for _ in ()).throw(
                            egress.EgressBlocked("refused")))
    with pytest.raises(egress.EgressBlocked):
        url_extractor.extract_url("http://169.254.169.254/?x=1")
    assert fetched == ["http://169.254.169.254/?x=1"]
