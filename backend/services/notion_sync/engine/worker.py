"""Running a send in the background, and cleaning up after one that died.

One worker thread per run; one run per connection at a time (`connection_lock`).
The run and its items are rows, so progress is just reading them. A run whose
process died is found by `recover_interrupted`: nothing is "in flight" that no
thread is working on.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from datetime import datetime, timedelta, timezone

from services.notion_sync.engine.runner import Engine, connection_lock
from services.notion_sync.engine.store import Store, now
from services.notion_sync.notion.errors import SyncPaused

log = logging.getLogger(__name__)

LIVE_RUNS: set[str] = set()                 # runs a thread in THIS process is working on
STALE_AFTER = timedelta(minutes=2)


def kill_switch(db, connection_id: str, ttl: float = 1.0):
    """The gate the HTTP client calls before EVERY request. It reads the connection's
    status at most once per `ttl` seconds, so pausing stops a send within about a second."""
    state = {"at": 0.0}

    def gate() -> None:
        if time.monotonic() - state["at"] < ttl:
            return
        state["at"] = time.monotonic()
        rows = db.table("notion_connections").select("status").eq("id", connection_id).execute().data or []
        if rows and rows[0].get("status") == "paused":
            state["at"] = 0.0
            raise SyncPaused()
    return gate


def recover_interrupted(db, store: Store) -> int:
    """Runs left 'running'/'queued' by a process that is gone become 'partial'; the items
    they were on become retryable failures ("Retry failed" picks them up)."""
    fixed = 0
    for r in store.runs(50):
        if r["status"] not in ("queued", "running") or r["id"] in LIVE_RUNS:
            continue
        started = r.get("started_at") or r.get("created_at")
        try:
            age = datetime.now(timezone.utc) - datetime.fromisoformat(str(started).replace("Z", "+00:00"))
        except Exception:
            age = STALE_AFTER
        if age < STALE_AFTER:
            continue
        for it in store.run_items(r["id"]):
            if it["status"] in ("queued", "running"):
                store.finish_item(it["id"], "failed", error_class="retryable", error_code="interrupted",
                                  message="This was interrupted (the app restarted). Retry failed will send it.")
        store.finish_run(r["id"], "partial", r.get("counts") or {}, r.get("requests_used") or 0)
        fixed += 1
    return fixed


def start_background(engine: Engine, run: dict, sendable, recs, released, *, loop=None, on_finish=None) -> threading.Thread:
    """Execute a prepared run on its own thread. `on_finish(result)` is called from
    that thread; use `loop` + run_coroutine_threadsafe inside it for async work."""
    def work():
        lock = connection_lock(engine.conn.id)
        LIVE_RUNS.add(run["id"])
        with lock:
            try:
                res = engine.execute(run, sendable, recs, released)
                if on_finish:
                    on_finish(res)
            except Exception:
                log.exception("notion run %s crashed", run["id"])
                try:
                    engine.store.finish_run(run["id"], "failed", {}, 0)
                except Exception:
                    pass
            finally:
                LIVE_RUNS.discard(run["id"])
    t = threading.Thread(target=work, name=f"notion-run-{run['id'][:8]}", daemon=True)
    t.start()
    return t


async def bell(user_id: str, run_id: str, done: int, bad: int, timeout: float = 20.0) -> None:
    """One bell entry for a run that had problems (never for success, DESIGN §6.6)."""
    from services.db import notifications
    from services.db.connection import get_pool

    async def write():
        pool = await get_pool()
        async with pool.acquire() as conn:
            await notifications.create_notification(
                conn, user_id,
                message=f"Notion: {bad} item(s) need attention ({done} sent). Open Settings → Notion.",
                link="/brain/settings/notion", source=f"notion:run:{run_id}")
    try:
        await asyncio.wait_for(write(), timeout)
    except Exception:                                    # the run's own rows are the record
        log.exception("could not write the Notion bell entry")
