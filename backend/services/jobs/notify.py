"""Tell the user a background job finished, via the existing bell."""
from __future__ import annotations

import asyncio
import logging

from services.db import notifications
from services.db.connection import get_pool
from services.jobs.worker import notification_for

logger = logging.getLogger(__name__)

#: how long the bell may take. The scheduler runs one jobs pass at a time, so a
#: database that never answers here would stop every later job from starting.
NOTIFY_TIMEOUT = 20.0


async def _write(events: list[dict]) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        for ev in events:
            n = notification_for(ev)
            await notifications.create_notification(
                conn, ev["job"]["user_id"], message=n["message"],
                link=n["link"], source=n["source"])


async def notify(events: list[dict], timeout: float = NOTIFY_TIMEOUT) -> None:
    """One bell entry per event. Never raises and never hangs: the job's own row
    is the record, and a bell that cannot be written must not undo a finished
    job or hold up the next one."""
    if not events:
        return
    try:
        await asyncio.wait_for(_write(events), timeout)
    except asyncio.TimeoutError:
        logger.error("job notifications timed out after %ss — the bell was not written", timeout)
    except Exception:                                    # noqa: BLE001
        logger.exception("could not write job notifications")
