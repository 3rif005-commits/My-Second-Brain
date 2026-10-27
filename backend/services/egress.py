"""Outbound requests to an address a user chose: the one SSRF guard.

Sign-up is open, so "a user" is anyone. Without this, a signed-in stranger
could make the server call whatever it can reach and the internet cannot: the
cloud metadata service (169.254.169.254), Render's private network, the
server's own loopback. Every place that connects to a user-supplied URL goes
through here: website and article import, MCP servers, custom AI providers,
the automations webhook. (Pasted images have their own, older copy of the same
rule in routers/note_sources.py.)

The rule is OpenShell's default network policy: a connection to a private,
loopback, link-local, or otherwise non-public address is refused unless the
operator allowed it. Here the operator is `settings.egress_allow_private`,
which is on only when the app runs on your own machine — the same line the
stdio MCP setting draws — because there "private" means your own LAN, Ollama on
localhost, an MCP server you run.

Checked three times, because one check is not enough:
  1. every address the host name resolves to, before connecting;
  2. every redirect hop, the same way (a public URL may 302 to a private one);
  3. the address actually connected to, where the HTTP stack reports it, which
     catches DNS rebinding (a name that resolved public a moment ago and
     private now).
"""
from __future__ import annotations

import asyncio
import ipaddress
import socket
import threading
import time
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

import httpx

from core.config import settings

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address

_NAT64 = ipaddress.ip_network("64:ff9b::/96")

#: A browser-like agent: some sites refuse python-httpx outright, and
#: trafilatura (which these fetches replaced) sent one too.
USER_AGENT = "Mozilla/5.0 (compatible; SecondBrain/1.0; +https://second-brain-webmcp.vercel.app)"


class EgressBlocked(ValueError):
    """User-facing: why the app will not connect there. A ValueError, so the
    import routes that already turn ValueError into a 422 keep doing so."""


def _embedded_v4(ip: IPAddress) -> ipaddress.IPv4Address | None:
    """An IPv6 address that carries an IPv4 one reaches that IPv4 host:
    ::ffff:127.0.0.1, 2002:a9fe:a9fe:: (6to4), Teredo, 64:ff9b::a9fe:a9fe."""
    if ip.version != 6:
        return None
    if ip.ipv4_mapped:
        return ip.ipv4_mapped
    if ip.sixtofour:
        return ip.sixtofour
    if ip.teredo:
        return ip.teredo[1]
    if ip in _NAT64:
        return ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
    return None


def is_public(ip: IPAddress) -> bool:
    inner = _embedded_v4(ip)
    if inner is not None:
        return is_public(inner)
    # is_global is False for private, loopback, link-local, CGNAT (100.64/10),
    # documentation and reserved ranges; multicast is "global" in the stdlib's
    # sense but never a web server.
    return ip.is_global and not ip.is_multicast


def private_allowed() -> bool:
    return bool(settings.egress_allow_private)


def _parse(url: str, schemes: tuple[str, ...]) -> tuple[str, str]:
    parts = urlsplit((url or "").strip())
    scheme = parts.scheme.lower()
    if scheme not in schemes:
        allowed = " or ".join(f"{s}://" for s in schemes)
        raise EgressBlocked(f"The link must start with {allowed}")
    host = parts.hostname
    if not host:
        raise EgressBlocked("The link has no host name")
    return scheme, host


def _resolve(host: str) -> list[IPAddress]:
    try:
        return [ipaddress.ip_address(host)]
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise EgressBlocked(f"Could not find {host}") from None
    # A scoped IPv6 literal comes back as "fe80::1%eth0"; the scope is not part
    # of the address.
    return list({ipaddress.ip_address(i[4][0].split("%")[0]) for i in infos})


def _refuse(host: str) -> EgressBlocked:
    return EgressBlocked(f"{host} is a private or local address; the app does not "
                         "connect there.")


#: Use-time checks (every chat turn lists the user's providers) would otherwise
#: resolve DNS on every request. A short memory of "this host was public" keeps
#: them cheap; save-time checks and actual fetches never use it.
_RECENT_TTL = 30.0
_recent: dict[str, float] = {}
_recent_lock = threading.Lock()


def check_url(url: str, *, schemes: tuple[str, ...] = ("http", "https"),
              allow_private: bool | None = None, cached: bool = False) -> None:
    """Raise EgressBlocked unless `url` may be connected to.

    `cached=True` is for hot paths that only re-confirm a URL checked when it
    was saved; anything about to connect calls this uncached.
    """
    _, host = _parse(url, schemes)
    if private_allowed() if allow_private is None else allow_private:
        return
    if cached:
        with _recent_lock:
            if time.monotonic() - _recent.get(host, -_RECENT_TTL) < _RECENT_TTL:
                return
    addresses = _resolve(host)
    if not addresses or not all(is_public(ip) for ip in addresses):
        raise _refuse(host)
    with _recent_lock:
        _recent[host] = time.monotonic()


async def check_url_async(url: str, **kwargs) -> None:
    """check_url off the event loop: name resolution blocks."""
    await asyncio.to_thread(check_url, url, **kwargs)


def check_peer(response: httpx.Response, *, allow_private: bool | None = None) -> None:
    """The address the HTTP stack actually connected to (check 3). Absent when
    the transport does not report it, in which case checks 1 and 2 stand."""
    if private_allowed() if allow_private is None else allow_private:
        return
    stream = response.extensions.get("network_stream")
    addr = stream.get_extra_info("server_addr") if stream is not None else None
    if not addr:
        return
    try:
        ip = ipaddress.ip_address(str(addr[0]).split("%")[0])
    except ValueError:
        return
    if not is_public(ip):
        raise _refuse(response.request.url.host)


@dataclass
class Fetched:
    url: str              # after redirects
    status_code: int
    headers: httpx.Headers
    content: bytes

    @property
    def text(self) -> str:
        return httpx.Response(self.status_code, headers=self.headers,
                              content=self.content).text


_REDIRECTS = (301, 302, 303, 307, 308)


def fetch(url: str, *, max_bytes: int = 15_000_000, timeout: float = 20.0,
          max_redirects: int = 5, allow_private: bool | None = None,
          headers: dict[str, str] | None = None) -> Fetched:
    """GET a user-supplied URL with every check above. Raises EgressBlocked for
    a refused address, ValueError for anything else the user should read.
    `headers` go to every hop, so never put a credential in them."""
    current = url
    with httpx.Client(follow_redirects=False, timeout=timeout,
                      headers={"User-Agent": USER_AGENT, **(headers or {})}) as client:
        for _ in range(max_redirects + 1):
            check_url(current, allow_private=allow_private)
            try:
                with client.stream("GET", current) as resp:
                    check_peer(resp, allow_private=allow_private)
                    if resp.status_code in _REDIRECTS and resp.headers.get("location"):
                        current = urljoin(current, resp.headers["location"])
                        continue
                    if resp.status_code >= 400:
                        raise ValueError(f"The page answered {resp.status_code}: {current}")
                    declared = resp.headers.get("content-length")
                    if declared and declared.isdigit() and int(declared) > max_bytes:
                        raise ValueError("The page is too large to import")
                    body = bytearray()
                    for chunk in resp.iter_bytes():
                        body.extend(chunk)
                        if len(body) > max_bytes:
                            raise ValueError("The page is too large to import")
                    return Fetched(str(resp.url), resp.status_code, resp.headers, bytes(body))
            except httpx.HTTPError as e:
                raise ValueError(f"Could not fetch {current}: {e}") from None
    raise ValueError(f"Too many redirects from {url}")


def guarded_async_client_factory(headers: dict[str, str] | None = None,
                                 timeout: httpx.Timeout | None = None,
                                 auth: httpx.Auth | None = None) -> httpx.AsyncClient:
    """An httpx client for the MCP SDK (its `httpx_client_factory` hook) that
    checks every request — redirects included — before it is sent, and the
    connected address after. Same defaults as the SDK's own factory."""

    async def _before(request: httpx.Request) -> None:
        await check_url_async(str(request.url))

    async def _after(response: httpx.Response) -> None:
        check_peer(response)

    return httpx.AsyncClient(
        headers=headers, auth=auth, follow_redirects=True,
        timeout=timeout if timeout is not None else httpx.Timeout(30.0),
        event_hooks={"request": [_before], "response": [_after]})
