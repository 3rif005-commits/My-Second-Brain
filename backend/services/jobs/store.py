"""The `ai_jobs` table, and nothing else.

Every state change is one guarded UPDATE (`... WHERE status = <expected>`), so
two ticks, a double click, or a restart mid-run can never both win a job: the
loser gets no row back and stops.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from services import database

TABLE = "ai_jobs"
#: states a job can still be cancelled from
CANCELLABLE = ("queued", "submitted")
#: what the UI needs to list a job — never the full result body
LIST_COLUMNS = ("id,note_id,skill,focus,status,trigger,price_mode,run_after,"
                "shown_estimate_usd,cap_usd,model,ran_late,actual_usd,"
                "live_equivalent_usd,result_title,result_meta,error,cancel_reason,"
                "created_at,started_at,finished_at,applied_at,discarded_at")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _t():
    return database.get_supabase().table(TABLE)


def create(user_id: str, **fields: Any) -> dict:
    row = _t().insert({"user_id": user_id, **fields}).execute().data
    return row[0]


def get(job_id: str, user_id: str | None = None) -> dict | None:
    q = _t().select("*").eq("id", job_id)
    if user_id:
        q = q.eq("user_id", user_id)
    rows = q.limit(1).execute().data or []
    return rows[0] if rows else None


def list_for_user(user_id: str, *, note_id: str | None = None,
                  statuses: tuple[str, ...] | None = None, limit: int = 100) -> list[dict]:
    q = _t().select(LIST_COLUMNS).eq("user_id", user_id)
    if note_id:
        q = q.eq("note_id", note_id)
    if statuses:
        q = q.in_("status", list(statuses))
    return q.order("created_at", desc=True).limit(limit).execute().data or []


def due(now: str, limit: int = 5) -> list[dict]:
    return (_t().select("*").eq("status", "queued").lte("run_after", now)
            .order("run_after").limit(limit).execute().data or [])


def transition(job_id: str, expected: str | tuple[str, ...], **fields: Any) -> dict | None:
    """Move a job out of `expected`. Returns the updated row, or None when the
    job was not in that state (someone else got there first)."""
    q = _t().update(fields).eq("id", job_id)
    q = q.in_("status", list(expected)) if isinstance(expected, tuple) else q.eq("status", expected)
    rows = q.execute().data or []
    return rows[0] if rows else None


def stuck_running(older_than_iso: str) -> list[dict]:
    """Live jobs marked `submitted` whose process died (no batch id to poll)."""
    return (_t().select("id,user_id,note_id,skill,result_title").eq("status", "submitted")
            .is_("provider_batch_id", "null").lte("started_at", older_than_iso)
            .execute().data or [])
