"""asyncpg pool lifecycle for the database query engine.

A real `DATABASE_URL` (Supabase pooler connection string, port 6543) is
required at runtime once the query engine is exercised — approved
decision, see `docs/plans/2026-08-08-notion-databases.md` Global
Constraints. Until then (and while `settings.database_rows_enabled` is
False), nothing in this process calls `get_pool()`, so the missing
`DATABASE_URL` in this environment is harmless.
"""
import asyncpg
from core.config import settings

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        if not settings.database_url:
            raise RuntimeError(
                "DATABASE_URL is required for the database query engine. "
                "Use the Supabase pooler connection string (port 6543)."
            )
        _pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=10)
    return _pool


async def close_pool() -> None:
    """Close the asyncpg pool, if one was ever created.

    Safe to call even when `get_pool()` was never invoked in this process
    (e.g. because `database_rows_enabled` is False and nothing has touched
    the database query engine yet) — used as a FastAPI shutdown hook.
    """
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
