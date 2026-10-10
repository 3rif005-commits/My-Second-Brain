"""Transport: auth header, pinned version, bucket, retry policy."""
import httpx
import pytest

from services.notion_sync.notion.client import NotionClient, TokenBucket
from services.notion_sync.notion.errors import AmbiguousWrite, NotionError, classify
from services.notion_sync.notion.version import NOTION_VERSION


def client(handler, sleeps=None, **kw):
    return NotionClient("tok", transport=httpx.MockTransport(handler),
                        bucket=TokenBucket(rate=1000, burst=1000),
                        sleep=(sleeps.append if sleeps is not None else (lambda s: None)), **kw)


def test_headers_and_version_pinned():
    seen = {}

    def h(req):
        seen.update(req.headers)
        return httpx.Response(200, json={})
    client(h).get("/users/me")
    assert seen["notion-version"] == NOTION_VERSION == "2026-03-11"
    assert seen["authorization"] == "Bearer tok"


def test_429_retry_after_honoured_for_any_verb():
    calls, sleeps = [], []

    def h(req):
        calls.append(1)
        if len(calls) < 3:
            return httpx.Response(429, headers={"Retry-After": "7"}, json={"code": "rate_limited"})
        return httpx.Response(200, json={"ok": 1})
    assert client(h, sleeps).post("/pages", {}, create=True) == {"ok": 1}
    assert sleeps == [7.0, 7.0] and len(calls) == 3


def test_create_not_retried_after_5xx():
    calls = []

    def h(req):
        calls.append(1)
        return httpx.Response(502, json={"code": "bad_gateway"})
    with pytest.raises(AmbiguousWrite):
        client(h).post("/pages", {}, create=True)
    assert len(calls) == 1


def test_create_not_retried_after_timeout():
    calls = []

    def h(req):
        calls.append(1)
        raise httpx.ReadTimeout("t", request=req)
    with pytest.raises(AmbiguousWrite):
        client(h).patch("/blocks/x/children", {}, create=True)
    assert len(calls) == 1


def test_read_retries_5xx_and_timeouts_then_succeeds():
    calls = []

    def h(req):
        calls.append(1)
        if len(calls) == 1:
            raise httpx.ConnectTimeout("t", request=req)
        if len(calls) == 2:
            return httpx.Response(503, json={})
        return httpx.Response(200, json={"v": 1})
    assert client(h).get("/pages/x") == {"v": 1} and len(calls) == 3


def test_read_post_query_is_retried_like_a_read():
    calls = []

    def h(req):
        calls.append(1)
        return httpx.Response(500, json={}) if len(calls) == 1 else httpx.Response(200, json={"results": []})
    assert client(h).post("/search", {}, read=True) == {"results": []}


def test_gives_up_after_six_attempts():
    calls = []

    def h(req):
        calls.append(1)
        return httpx.Response(500, json={})
    with pytest.raises(NotionError) as e:
        client(h).get("/pages/x")
    assert len(calls) == 6 and e.value.error_class == "retryable"


def test_error_body_and_classes():
    def h(req):
        return httpx.Response(400, json={"code": "validation_error", "message": "bad"})
    with pytest.raises(NotionError) as e:
        client(h).get("/x")
    assert (e.value.status, e.value.code, e.value.error_class) == (400, "validation_error", "permanent")
    assert classify(NotionError(401, "unauthorized")) == "needs_user"
    assert classify(NotionError(404, "object_not_found")) == "needs_user"
    assert classify(NotionError(429, "rate_limited")) == "retryable"


def test_token_bucket_paces_requests():
    t = {"now": 0.0}
    sleeps = []

    def sleep(s):
        sleeps.append(s)
        t["now"] += s
    b = TokenBucket(rate=2.5, burst=3, clock=lambda: t["now"], sleep=sleep)
    for _ in range(3):
        b.take()
    assert sleeps == []                                # burst of 3
    b.take()
    assert sleeps and abs(sleeps[0] - 0.4) < 1e-6      # 1 token / 2.5 per s


def test_counts_writes_not_reads():
    def h(req):
        return httpx.Response(200, json={})
    c = client(h)
    c.get("/a"); c.post("/search", {}, read=True); c.patch("/b", {}); c.delete("/c")
    assert c.requests == 4 and c.write_requests == 2
