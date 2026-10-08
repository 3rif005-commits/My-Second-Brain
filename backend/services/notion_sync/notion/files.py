"""Getting file bytes from our storage, safely, and putting them into Notion.

Writers are pure, so a media block carries a placeholder; `NotionAdapter.materialize`
resolves it: public https files are linked (Notion fetches them), our own and
signed files are downloaded here and uploaded through the File Upload API
(verified T7/T8: single_part, 5 MiB on the free plan, extension allow-list).
"""
from __future__ import annotations

import ipaddress
import mimetypes
import re
import socket
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlparse

import httpx

DEFAULT_CAP = 5 * 1024 * 1024
_SIGNED = re.compile(r"(token=|X-Amz-Signature|X-Goog-Signature|Signature=|sig=)", re.I)


class FileUnavailable(Exception):
    """The URL cannot be fetched (expired signed URL, 4xx/5xx, blocked, not https)."""


class FileTooLarge(Exception):
    def __init__(self, size: int | None):
        super().__init__("file too large")
        self.size = size


@dataclass
class Fetched:
    data: bytes
    mime: str
    name: str


class FileSource(Protocol):
    def fetch(self, url: str, max_bytes: int, name_hint: str = "") -> Fetched: ...
    def is_public_link(self, url: str) -> bool: ...


def _blocked_ip(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return True
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return True
    return False


class HttpFileSource:
    def __init__(self, own_hosts: set[str] | frozenset[str] = frozenset(), transport: httpx.BaseTransport | None = None,
                 skip_ip_check: bool = False):
        self.own_hosts = {h.lower() for h in own_hosts if h}
        self._transport = transport
        self._skip_ip = skip_ip_check

    def is_public_link(self, url: str) -> bool:
        """True when Notion can fetch it itself: https, not ours, not signed."""
        u = urlparse(url)
        return (u.scheme == "https" and (u.hostname or "").lower() not in self.own_hosts
                and not _SIGNED.search(u.query or ""))

    def fetch(self, url: str, max_bytes: int, name_hint: str = "") -> Fetched:
        cur = url
        with httpx.Client(timeout=30, follow_redirects=False, transport=self._transport) as c:
            for _ in range(4):
                u = urlparse(cur)
                host = (u.hostname or "").lower()
                if u.scheme != "https" or not host:
                    raise FileUnavailable("not an https address")
                if host not in self.own_hosts and not self._skip_ip and _blocked_ip(host):
                    raise FileUnavailable("address not allowed")
                try:
                    with c.stream("GET", cur) as r:
                        if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                            cur = str(httpx.URL(cur).join(r.headers["location"]))
                            continue
                        if r.status_code >= 400:
                            raise FileUnavailable(f"HTTP {r.status_code}")
                        declared = r.headers.get("content-length")
                        if declared and declared.isdigit() and int(declared) > max_bytes:
                            raise FileTooLarge(int(declared))
                        buf = bytearray()
                        for chunk in r.iter_bytes():
                            buf += chunk
                            if len(buf) > max_bytes:
                                raise FileTooLarge(None)
                        mime = (r.headers.get("content-type") or "").split(";")[0].strip() or \
                            mimetypes.guess_type(u.path)[0] or "application/octet-stream"
                        name = name_hint or (u.path.rsplit("/", 1)[-1] or "file")
                        return Fetched(bytes(buf), mime, name)
                except httpx.HTTPError as e:
                    raise FileUnavailable(type(e).__name__) from e
        raise FileUnavailable("too many redirects")


def upload_name(name: str, mime: str) -> str:
    """A filename with an extension (Notion validates it)."""
    name = re.sub(r"[^\w.\- ()]", "_", name or "file")[:100] or "file"
    if "." not in name:
        name += mimetypes.guess_extension(mime or "") or ""
    return name


_SIGNED_PATH = re.compile(r"^/storage/v1/object/(?:sign|public|authenticated)/workspace-resources/(?P<path>.+)$")


def storage_path_of(url: str) -> str | None:
    """The storage path inside one of OUR signed URLs. A capture inserted into a note carries a
    24-hour signed URL (ledger B2); once it expires the URL is useless but the file is still in
    storage, so the mirror reads it by path instead of by the dead link."""
    from urllib.parse import unquote
    u = urlparse(url)
    m = _SIGNED_PATH.match(u.path or "")
    return unquote(m["path"]) if m else None


class CompositeFiles:
    """`storage:<path>` comes from our own storage (never a public link); everything else is a URL."""
    def __init__(self, http: FileSource, storage_fetch=None):
        self.http, self.storage_fetch = http, storage_fetch

    def is_public_link(self, url: str) -> bool:
        return False if url.startswith("storage:") else self.http.is_public_link(url)

    def fetch(self, url: str, max_bytes: int, name_hint: str = "") -> Fetched:
        if not url.startswith("storage:"):
            path = storage_path_of(url) if self.storage_fetch is not None else None
            host = (urlparse(url).hostname or "").lower()
            if path and host in self.http.own_hosts:
                url = "storage:" + path                      # skip the (possibly expired) signature
            else:
                return self.http.fetch(url, max_bytes, name_hint)
        if self.storage_fetch is None:
            raise FileUnavailable("no storage")
        path = url[len("storage:"):]
        try:
            data = self.storage_fetch(path)
        except Exception as e:
            raise FileUnavailable(type(e).__name__) from e
        if len(data) > max_bytes:
            raise FileTooLarge(len(data))
        base = path.rsplit("/", 1)[-1]
        name = name_hint if "." in (name_hint or "") else base      # Notion validates the extension
        return Fetched(data, mimetypes.guess_type(base)[0] or mimetypes.guess_type(name)[0] or "application/octet-stream", name)
