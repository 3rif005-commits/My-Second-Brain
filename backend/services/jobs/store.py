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
#: still asking something of the user, or still on its way
OPEN_STATES = ("queued", "submitted", "ready", "failed", "budget_blocked", "needs_you")
#: over — the history table
HISTORY_STATES = ("applied", "discarded", "cancelled", "expired", "skipped")
#: rows a person may delete from their history
DELETABLE = HISTORY_STATES + ("failed", "budget_blocked")
#: how long an unapplied result waits, and how long any row is kept
RESULT_DAYS, ROW_DAYS = 30, 90
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


def history(user_id: str, *, since: str, skill: str | None = None, trigger: str | None = None,
            status: str | None = None, limit: int = 300) -> list[dict]:
    q = (_t().select(LIST_COLUMNS).eq("user_id", user_id).gte("created_at", since)
         .in_("status", [status] if status in HISTORY_STATES else list(HISTORY_STATES)))
    if skill:
        q = q.eq("skill", skill)
    if trigger:
        q = q.eq("trigger", trigger)
    return q.order("created_at", desc=True).limit(limit).execute().data or []


def delete(job_id: str, user_id: str) -> bool:
    rows = (_t().delete().eq("id", job_id).eq("user_id", user_id)
            .in_("status", list(DELETABLE)).execute().data or [])
    return bool(rows)


def sweep(now: datetime) -> dict:
    """Retention: an unapplied result is kept 30 days, then its body is removed
    (the row stays, saying so); rows in a final state go after 90 days."""
    from datetime import timedelta
    stale = (_t().update({"status": "discarded", "result_html": None,
                          "discarded_at": now.isoformat(),
                          "error": f"Result removed after {RESULT_DAYS} days"})
             .eq("status", "ready").lte("finished_at", (now - timedelta(days=RESULT_DAYS)).isoformat())
             .execute().data or [])
    gone = (_t().delete().in_("status", list(HISTORY_STATES + ("failed", "budget_blocked")))
            .lte("created_at", (now - timedelta(days=ROW_DAYS)).isoformat()).execute().data or [])
    return {"results_removed": len(stale), "rows_deleted": len(gone)}


def count_open(user_id: str) -> dict:
    rows = (_t().select("status").eq("user_id", user_id)
            .in_("status", ["ready", "failed", "budget_blocked", "needs_you"]).execute().data or [])
    return {"ready": sum(r["status"] == "ready" for r in rows),
            "needs_you": sum(r["status"] != "ready" for r in rows)}


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
    """Jobs marked `submitted` with no batch id to poll, whose process died —
    a live run that never finished, or a batch that may have been sent."""
    return (_t().select("id,user_id,note_id,skill,price_mode,provider,started_at")
            .eq("status", "submitted").is_("provider_batch_id", "null")
            .lte("started_at", older_than_iso).execute().data or [])


def sent_batches() -> list[dict]:
    """Batches on their way: the provider has them, we are waiting to collect."""
    return (_t().select("*").eq("status", "submitted")
            .not_.is_("provider_batch_id", "null").execute().data or [])
