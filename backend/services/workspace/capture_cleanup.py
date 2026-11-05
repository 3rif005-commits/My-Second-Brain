"""Remove the AI's captures that never made it into a note.

The AI's capture tools (services/agent/source_tools.py) save a frame, clip or
audio file before the user decides to Insert it; a capture the user never
inserts would stay in Storage for good. Those files are named `ai-…`
(`AI_CAPTURE_PREFIX`). Once one is older than `KEEP_DAYS` and no note of its
owner mentions its path — trashed notes included — it is removed.

The viewer's own captures (no prefix) are never touched: they go straight
into a note when made.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone

from services.database import get_supabase
from services.workspace import storage

logger = logging.getLogger(__name__)

KEEP_DAYS = 7
PREFIX = "ai-"
#: How often a running server sweeps (Render's free plan sleeps; every wake sweeps too).
EVERY_SECONDS = 24 * 3600
_VIDEO_KINDS = ("video", "youtube")


def _created(obj: dict) -> datetime | None:
    raw = obj.get("created_at") or (obj.get("metadata") or {}).get("lastModified")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None


def _notes_text(db, user_id: str) -> str:
    """Every note of the user as one string, to look paths up in."""
    parts: list[str] = []
    start = 0
    while True:
        rows = (db.table("notes").select("content").eq("user_id", user_id)
                .range(start, start + 199).execute().data or [])
        parts += [str(r.get("content") or "") for r in rows]
        if len(rows) < 200:
            return "\n".join(parts)
        start += 200


def sweep(now: datetime | None = None) -> list[str]:
    """Remove unused old AI captures; returns the paths removed."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=KEEP_DAYS)
    db = get_supabase()
    sources = (db.table("note_resources").select("id,user_id")
               .in_("kind", list(_VIDEO_KINDS)).execute().data or [])
    candidates: dict[str, list[str]] = {}
    for s in sources:
        folder = f"{s['user_id']}/{s['id']}/captures"
        try:
            objs = db.storage.from_(storage.BUCKET).list(folder) or []
        except Exception as e:                               # noqa: BLE001
            logger.debug(f"capture cleanup: cannot list {folder}: {e}")
            continue
        for o in objs:
            made = _created(o)
            if str(o.get("name", "")).startswith(PREFIX) and made and made < cutoff:
                candidates.setdefault(str(s["user_id"]), []).append(f"{folder}/{o['name']}")
    removed: list[str] = []
    for user_id, paths in candidates.items():
        text = _notes_text(db, user_id)
        unused = [p for p in paths if p.rsplit("/", 1)[-1] not in text]
        if unused:
            storage.remove(unused)
            removed += unused
    if removed:
        logger.info(f"capture cleanup: removed {len(removed)} unused AI capture(s)")
    return removed


def _loop(stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            sweep()
        except Exception as e:                               # noqa: BLE001 — try again next time
            logger.warning(f"capture cleanup failed: {e}")
        stop.wait(EVERY_SECONDS)


def start() -> threading.Event:
    stop = threading.Event()
    threading.Thread(target=_loop, args=(stop,), daemon=True, name="capture-cleanup").start()
    return stop
