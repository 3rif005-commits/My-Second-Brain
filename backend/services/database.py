import httpx
from supabase import create_client, Client
from core.config import settings

_client: Client | None = None


def _http1_postgrest(client: Client) -> None:
    """Give the PostgREST client an HTTP/1.1 session instead of its default h2.

    One process-wide client means one long-lived HTTP/2 connection, and the
    server ends those (GOAWAY) after enough streams. httpx does not retry a
    terminated h2 connection, so the unlucky request fails with
    `ConnectionTerminated error_code:1, last_stream_id:701` — which is how the
    first live compare-sources run died before reaching the model, while the
    page was polling the same client every three seconds. A sync client gains
    nothing from multiplexing; HTTP/1.1 connections are replaced cleanly.
    """
    old = client.postgrest.session
    client.postgrest.session = httpx.Client(
        base_url=old.base_url, headers=old.headers, timeout=old.timeout,
        follow_redirects=True, http2=False)
    old.close()


def _http1_storage(client: Client) -> None:
    """The same swap for Storage, whose client also defaults to h2.

    Source processing uploads every page image through one client, and those
    uploads died with `ConnectionTerminated error_code:9` / `Server
    disconnected` — the source then failed and the AI panel had no jobs to
    offer. The bucket proxies read `_client`, the client itself `session`.
    """
    storage = client.storage
    old = storage.session
    new = httpx.Client(headers=old.headers, timeout=old.timeout,
                       follow_redirects=True, http2=False)
    storage.session = storage._client = new
    old.close()


def get_supabase() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        _http1_postgrest(_client)
        _http1_storage(_client)
    return _client
