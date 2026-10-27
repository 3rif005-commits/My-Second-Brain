""""When I add a source here": a per-note trigger that queues a background
job once the note's sources have settled.

One trigger per note (migration 027's own unique index), so the rail is a
single line: off, or one skill. A source settling PUSHES the fire time
forward (`touch_settle`), so dropping several files in one sitting produces
one job, not one per file — the same "wait until nothing is pending" idea
`services/workspace/synthesis.py`'s settle guard already uses, with a delay
added so a second file has time to land before the first one fires alone.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from services import database
from services.jobs import queue as job_queue
from services.jobs import store
from services.workspace.synthesis import _PENDING, ready_sources, source_signature

logger = logging.getLogger(__name__)

#: how long to wait, after the LAST source settles, before firing
SETTLE_DELAY = timedelta(minutes=2)
#: an open job in one of these states already covers its dedupe key
COVERED_STATES = ("queued", "submitted", "ready")


def _t():
    return database.get_supabase().table("ai_job_triggers")


def get(note_id: str, user_id: str | None = None) -> dict | None:
    q = _t().select("*").eq("note_id", note_id).eq("kind", "source_added")
    if user_id:
        q = q.eq("user_id", user_id)
    rows = q.limit(1).execute().data or []
    return rows[0] if rows else None


def set_trigger(note_id: str, user_id: str, skill: str) -> dict:
    """Turn the trigger on for this note, or change its skill. Upserts on the
    note (migration 027's unique index), so re-picking a skill edits the same
    row rather than leaving an old one behind."""
    existing = get(note_id, user_id)
    if existing:
        row = _t().update({"skill": skill, "enabled": True, "paused_reason": None}) \
            .eq("id", existing["id"]).execute().data
        return row[0] if row else existing
    return _t().insert({"note_id": note_id, "user_id": user_id, "kind": "source_added",
                        "skill": skill}).execute().data[0]


def clear_trigger(note_id: str, user_id: str) -> bool:
    """Back to Suggest: the trigger is removed, not just disabled — a note with
    no opinion should have no row, per the spec's "nothing runs for a note the
    user did not set up"."""
    rows = _t().delete().eq("note_id", note_id).eq("user_id", user_id) \
        .eq("kind", "source_added").execute().data or []
    return bool(rows)


def touch_settle(note_id: str, now: datetime | None = None) -> None:
    """Called whenever a source on this note finishes processing (ready or
    failed). A no-op unless this note has an enabled trigger; otherwise pushes
    its fire time to `now + SETTLE_DELAY`, debouncing a batch of sources."""
    now = now or datetime.now(timezone.utc)
    _t().update({"next_check_at": (now + SETTLE_DELAY).isoformat()}) \
        .eq("note_id", note_id).eq("kind", "source_added").eq("enabled", True).execute()


def due(now: datetime) -> list[dict]:
    return (_t().select("*").eq("kind", "source_added").eq("enabled", True)
            .not_.is_("next_check_at", "null").lte("next_check_at", now.isoformat())
            .execute().data or [])


def _claim(trigger: dict) -> dict | None:
    """Clear `next_check_at`, guarded on the value this pass read: if a source
    settled again in between (pushing it further out), someone else's write
    wins and this pass backs off rather than firing on a stale snapshot."""
    rows = (_t().update({"next_check_at": None}).eq("id", trigger["id"])
            .eq("next_check_at", trigger["next_check_at"]).execute().data or [])
    return rows[0] if rows else None


def fire_due(now: datetime | None = None) -> list[dict]:
    """Fire every trigger whose debounce has elapsed. Returns the jobs created
    (empty jobs are not an error: nothing ready, or already covered)."""
    now = now or datetime.now(timezone.utc)
    created = []
    for trigger in due(now):
        try:
            job = fire_one(trigger, now)
        except Exception:                                    # noqa: BLE001
            logger.exception("trigger %s failed to fire", trigger.get("id"))
            continue
        if job:
            created.append(job)
    return created


def fire_one(trigger: dict, now: datetime) -> dict | None:
    """As the job's user, so it reads that user's own skills
    (services/skill_store.py): no request is here to name them."""
    from services.skill_store import as_user
    with as_user(trigger.get("user_id")):
        return _fire_one_as_user(trigger, now)


def _fire_one_as_user(trigger: dict, now: datetime) -> dict | None:
    if not _claim(trigger):
        return None                                # stale snapshot; the newer touch will fire later
    note_id, user_id, skill_name = trigger["note_id"], trigger["user_id"], trigger["skill"]

    note = (database.get_supabase().table("notes").select("id,deleted_at")
            .eq("id", note_id).limit(1).execute().data or [])
    if not note or note[0].get("deleted_at"):
        clear_trigger(note_id, user_id)
        return None

    pending = (database.get_supabase().table("note_resources").select("id")
               .eq("note_id", note_id).in_("status", list(_PENDING)).execute().data or [])
    if pending:
        touch_settle(note_id, now)                 # something is still landing; wait for it too
        return None

    ready_ids = sorted(str(s["id"]) for s in ready_sources(note_id))
    if not ready_ids:
        return None                                # every source failed; nothing to run on

    skill = job_queue.eligible_skill(skill_name)
    if skill is None:
        logger.warning("trigger %s: skill %r is no longer eligible", trigger["id"], skill_name)
        return None
    dedupe_key = f"{skill_name}:{note_id}:{','.join(ready_ids)}"

    covered = store.list_for_user(user_id, note_id=note_id, statuses=COVERED_STATES)
    existing = next((j for j in covered if j.get("dedupe_key") == dedupe_key), None)
    if existing:
        _t().update({"last_run_at": now.isoformat()}).eq("id", trigger["id"]).execute()
        return None                                # this exact source set is already covered

    try:
        q = job_queue.price(user_id, note_id, skill, "")
    except job_queue.QueueError as e:
        logger.info("trigger %s: %s", trigger["id"], e)
        return None

    from core.config import settings
    row = store.create(
        user_id, note_id=note_id, skill=skill.name, focus="", trigger="source_added",
        trigger_id=trigger["id"], run_after=now.isoformat(), price_mode=q["price_mode"],
        shown_estimate_usd=q["usd"], live_equivalent_usd=q["live_usd"] if q["price_mode"] == "batch" else None,
        cap_usd=settings.max_usd_per_run or None, model=q["model"],
        provider=q["provider"].provider if q["provider"] else None,
        source_ids=ready_ids, dedupe_key=dedupe_key, source_hash=source_signature(note_id))
    _t().update({"last_run_at": now.isoformat()}).eq("id", trigger["id"]).execute()
    return row
