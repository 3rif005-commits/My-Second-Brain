"""The Supabase client's PostgREST session must not be HTTP/2.

A long-lived h2 connection is ended by the server after enough streams, and
httpx does not retry the request that lands on it — the first live
compare-sources run died that way before it reached the model.
"""
from supabase import create_client

from services.database import _http1_postgrest


def _client():
    return create_client("https://example.supabase.co", "x" * 40)


def test_postgrest_session_is_http1_after_the_swap():
    c = _client()
    assert c.postgrest.session._transport._pool._http2 is True   # the default we replace
    _http1_postgrest(c)
    assert c.postgrest.session._transport._pool._http2 is False


def test_the_swap_keeps_url_auth_headers_and_timeout():
    c = _client()
    before = c.postgrest.session
    url, headers, timeout = before.base_url, dict(before.headers), before.timeout
    _http1_postgrest(c)
    after = c.postgrest.session
    assert after.base_url == url
    assert after.headers["apikey"] == headers["apikey"]
    assert after.headers["authorization"] == headers["authorization"]
    assert after.timeout == timeout
    # a relative path still resolves against the project
    assert str(after.build_request("GET", "/notes").url) == \
        "https://example.supabase.co/rest/v1/notes"
