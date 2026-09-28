"""Run the jobs that are due.

Called once a minute by the scheduler. Everything here is synchronous (the
scheduler hands it to a thread) and returns what happened, so the caller can
tell the user without this module knowing how notifications are stored.

Additive only, enforced by construction: the only writes in this file go
through `store` (the job's own row) and the model call inside
`produce_skill_result`, which returns text. There is no handle to notes here.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from services import database
from services.ai import budget as budget_guard
from services.jobs import store
from services.workspace import skill_run

logger = logging.getLogger(__name__)

#: a job that starts this long after its time reports "ran late" (app was closed)
LATE_AFTER = timedelta(minutes=5)
#: a live job still "submitted" this long after it started lost its process
STUCK_AFTER = timedelta(minutes=30)
#: at most this many jobs per tick — one long job must not starve the tick
PER_TICK = 3


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _note(note_id: str | None) -> dict | None:
    """The note a job belongs to, or None when it is gone or in the Trash."""
    if not note_id:
        return None
    rows = (database.get_supabase().table("notes").select("id,title,deleted_at")
            .eq("id", note_id).limit(1).execute().data or [])
    if not rows or rows[0].get("deleted_at"):
        return None
    return rows[0]


def run_due(now: datetime | None = None) -> list[dict]:
    """Recover stuck jobs, then run what is due. Returns one event per job that
    reached a state the user should hear about:
    {"kind": "ready"|"failed"|"budget_blocked"|"cancelled", "job": row, "note_title": str}."""
    now = now or datetime.now(timezone.utc)
    events = recover_stuck(now)
    for job in store.due(_iso(now), limit=PER_TICK):
        try:
            ev = run_one(job, now)
        except Exception:                                # noqa: BLE001
            logger.exception("job %s crashed the worker", job.get("id"))
            continue
        if ev:
            events.append(ev)
    return events


def recover_stuck(now: datetime) -> list[dict]:
    events = []
    for job in store.stuck_running(_iso(now - STUCK_AFTER)):
        row = store.transition(
            job["id"], "submitted", status="failed", finished_at=store.now_iso(),
            error="The app stopped while this was running. Nothing was saved. Try again.")
        if row:
            events.append({"kind": "failed", "job": row,
                           "note_title": (_note(row.get("note_id")) or {}).get("title") or ""})
    return events


def run_one(job: dict, now: datetime) -> dict | None:
    note = _note(job.get("note_id"))
    if note is None:
        row = store.transition(job["id"], "queued", status="cancelled",
                               finished_at=store.now_iso(),
                               cancel_reason="the note was deleted")
        return {"kind": "cancelled", "job": row, "note_title": ""} if row else None

    late = now - _parse(job["run_after"]) > LATE_AFTER
    claimed = store.transition(job["id"], "queued", status="submitted",
                               started_at=store.now_iso(), ran_late=late,
                               attempts=(job.get("attempts") or 0) + 1)
    if not claimed:                       # cancelled, or another tick got it
        return None

    title = note.get("title") or ""
    try:
        result = skill_run.produce_skill_result(
            job["note_id"], job["user_id"], job["skill"], job.get("focus") or "",
            trigger="background")
    except budget_guard.BudgetExceeded as e:
        row = store.transition(job["id"], "submitted", status="budget_blocked",
                               finished_at=store.now_iso(), error=str(e)[:500])
        return {"kind": "budget_blocked", "job": row, "note_title": title} if row else None
    except Exception as e:                               # noqa: BLE001
        logger.warning("job %s (%s) failed: %s", job["id"], job["skill"], e)
        row = store.transition(job["id"], "submitted", status="failed",
                               finished_at=store.now_iso(), error=str(e)[:500])
        return {"kind": "failed", "job": row, "note_title": title} if row else None

    meta = {k: result.get(k) for k in
            ("truncated", "method", "check", "input_tokens", "output_tokens")}
    row = store.transition(
        job["id"], "submitted", status="ready", finished_at=store.now_iso(),
        result_html=result["html"], result_title=result["title"],
        result_meta=meta, source_ids=result.get("source_ids") or [],
        actual_usd=result.get("usd"), error=None)
    # Cancelled while the model was working: the money is spent, the result is
    # dropped, and the row already says cancelled.
    return {"kind": "ready", "job": row, "note_title": title} if row else None


def notification_for(event: dict) -> dict:
    """The bell entry for an event: message, link, source."""
    job, kind = event["job"], event["kind"]
    what = skill_run.job_title(job["skill"])
    target = f' for "{event["note_title"]}"' if event.get("note_title") else ""
    link = f"/brain/workspace/{job['note_id']}?job={job['id']}" if job.get("note_id") else None
    message = {
        "ready": f"{what}{target} is ready",
        "failed": f"{what}{target} failed — {job.get('error') or 'unknown error'}",
        "budget_blocked": f"{what}{target} was not started — {job.get('error') or 'over the limit'}",
        "cancelled": f"{what}{target} was cancelled — {job.get('cancel_reason') or ''}".rstrip(" —"),
    }[kind]
    return {"message": message[:300], "link": link, "source": f"job:{job['id']}"}
