"""Tell the user a background job finished, via the existing bell."""
from __future__ import annotations

import logging

from services.db import notifications
from services.db.connection import get_pool
from services.jobs.worker import notification_for

logger = logging.getLogger(__name__)


async def notify(events: list[dict]) -> None:
    """One bell entry per event. Never raises: the job's own row is the record,
    and a bell that cannot be written must not undo a finished job."""
    if not events:
        return
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            for ev in events:
                n = notification_for(ev)
                await notifications.create_notification(
                    conn, ev["job"]["user_id"], message=n["message"],
                    link=n["link"], source=n["source"])
    except Exception:                                    # noqa: BLE001
        logger.exception("could not write job notifications")
