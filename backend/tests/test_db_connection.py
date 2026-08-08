"""Tests for the asyncpg pool lifecycle (services/db/connection.py).

No real DATABASE_URL is configured in this environment (Supabase pooler
connection string, port 6543, is not yet in backend/.env), so these tests
only cover what's testable without a live database: `get_pool()` raising
its documented RuntimeError when `settings.database_url` is empty (the
default), and `close_pool()` being a safe no-op when no pool was ever
created. Opening a real connection is explicitly out of scope here.
"""
import pytest

from services.db import connection


@pytest.fixture(autouse=True)
def _reset_pool():
    """Each test starts and ends with a clean module-level `_pool`, so
    tests can't leak state into each other via the module global."""
    connection._pool = None
    yield
    connection._pool = None


async def test_get_pool_raises_when_database_url_is_empty(monkeypatch):
    monkeypatch.setattr(connection.settings, "database_url", "")

    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        await connection.get_pool()


async def test_get_pool_error_mentions_the_pooler_port(monkeypatch):
    # The error message is the only guidance a developer gets when this
    # fires in a fresh checkout — assert it actually names the fix.
    monkeypatch.setattr(connection.settings, "database_url", "")

    with pytest.raises(RuntimeError, match="6543"):
        await connection.get_pool()


async def test_close_pool_is_a_safe_noop_when_never_created():
    assert connection._pool is None
    await connection.close_pool()
    assert connection._pool is None
