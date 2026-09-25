"""Index every note that changed, whatever wrote it (E8).

Search can only find a note that has been indexed (note_chunks + a
descriptor). Indexing used to happen only from a 30-second timer in the note
editor, so notes written by the AI, an import, the workspace or the Android
app were never found by the chat (54 of 80 notes with text, first account
measured). This sweep reads the database — the one place every write lands —
for notes whose content changed since their last index
(`notes_needing_index`, migration 021) and indexes them.

Content, not time: `content_hash` is generated from title + text, and
`indexed_hash` is written by index_note itself (any caller: this sweep or
the editor's timer), so a note indexed once is not indexed twice. Indexing writes the
descriptor, which bumps `updated_at` — a time check would loop forever.

Until migration 021 is applied the RPC does not exist: the sweep says so once
and keeps quiet. Each note costs one short descriptor call (~$0.001) unless it
is local-only (no model at all); embeddings are local.
"""
from __future__ import annotations

import asyncio
import logging
import sys

from core.config import settings
from services.database import get_supabase

logger = logging.getLogger(__name__)

#: A note being typed is indexed once, when the typing stops.
QUIET_SECONDS = 120
#: Notes per sweep — bounds the spend of one pass.
BATCH = 20

_missing_warned = False


def sweep_once(limit: int = BATCH, quiet_seconds: int = QUIET_SECONDS) -> int:
    """Index up to `limit` changed notes. Returns how many were indexed."""
    global _missing_warned
    from services.indexer import index_note

    db = get_supabase()
    try:
        rows = db.rpc("notes_needing_index", {
            "quiet_seconds": quiet_seconds, "max_rows": limit}).execute().data or []
    except Exception as e:                          # noqa: BLE001
        if "notes_needing_index" in str(e) or "PGRST202" in str(e):
            if not _missing_warned:
                logger.warning("index sweep off: apply supabase/migrations/"
                               "021_note_index_tracking.sql (%s)", str(e)[:120])
                _missing_warned = True
            return 0
        raise
    done = 0
    for row in rows:
        note_id, user_id = str(row["id"]), str(row["user_id"])
        try:
            # index_note records the fingerprint it indexed (indexed_hash)
            if index_note(note_id, user_id):
                done += 1
        except Exception:                           # noqa: BLE001
            logger.exception("index sweep: note %s failed", note_id)
    if done:
        logger.info("index sweep: indexed %d note(s)", done)
    return done


async def run_forever(interval: float) -> None:
    while True:
        try:
            await asyncio.to_thread(sweep_once)
        except Exception:                           # noqa: BLE001
            logger.exception("index sweep failed; next try in %ss", interval)
        await asyncio.sleep(interval)


def start() -> asyncio.Task | None:
    """Start the sweep unless it is switched off or this is a test run."""
    interval = settings.index_sweep_seconds
    if interval <= 0 or "pytest" in sys.modules:
        return None
    return asyncio.get_running_loop().create_task(run_forever(interval))
