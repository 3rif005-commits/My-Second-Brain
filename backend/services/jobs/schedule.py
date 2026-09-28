"""A background job "on a schedule" — a `kind='schedule'` row in
`ai_job_triggers`, ticked by the same worker that runs `source_added`
triggers (`services/db/scheduler.py`).

`cadence` is exactly `db_row_templates.repeat_config`'s shape (frequency,
interval, weekdays, start_date, time_of_day, timezone — UTC only, this
codebase's one recurrence format), so `services/db/templates.py`'s
`next_occurrence`/`seed_next_run_at` are reused as-is rather than forked: the
month-length and weekly-search edge cases they already handle don't need a
second implementation to get right.

Their catch-up POLICY differs on purpose, though. A row template advances one
occurrence per tick, so it runs every missed period, one per minute, until
caught up. A background job spends real money per run, so a schedule left
untouched for a week must not fire seven times the moment the app wakes: only
the latest missed occurrence actually runs; the rest are logged as `skipped`
rows at $0, so the history says what happened without a surprise bill.
"""
from __future__ import annotations

import calendar
import logging
from datetime import date, datetime, timedelta, timezone

from services import database
from services.db.templates import TemplateConfigError, next_occurrence, seed_next_run_at
from services.jobs import caps, queue as job_queue, store
from services.workspace.synthesis import ready_sources, source_signature

logger = logging.getLogger(__name__)

CADENCES = ("daily", "weekly")
#: a completed job whose card was never opened counts against the 3-in-a-row pause
COMPLETED_STATES = ("ready", "applied")
UNOPENED_STREAK = 3


class ScheduleError(ValueError):
    """A reason a person can read: why this schedule cannot be saved."""


def _t():
    return database.get_supabase().table("ai_job_triggers")


def normalize_cadence(cadence: dict) -> dict:
    """The exact `repeat_config` shape `next_occurrence` expects, with today
    filled in as the anchor when none was given. Raises ScheduleError for
    anything this form doesn't offer (see spec §2.3: day or week, one time)."""
    cadence = dict(cadence or {})
    if cadence.get("frequency") not in CADENCES:
        raise ScheduleError("A schedule repeats daily or weekly.")
    if cadence["frequency"] == "weekly" and not cadence.get("weekdays"):
        raise ScheduleError("Pick which day of the week.")
    if not cadence.get("time_of_day"):
        raise ScheduleError("Pick a time.")
    cadence.setdefault("start_date", date.today().isoformat())
    cadence.setdefault("interval", 1)
    try:
        seed_next_run_at(cadence)                  # raises TemplateConfigError if malformed
    except TemplateConfigError as e:
        raise ScheduleError(str(e)) from e
    return cadence


def list_schedules(user_id: str) -> list[dict]:
    return (_t().select("*").eq("user_id", user_id).eq("kind", "schedule")
            .order("created_at").execute().data or [])


def create_schedule(user_id: str, note_id: str, skill: str, cadence: dict,
                    month_cap_usd: float = 1.00) -> dict:
    if job_queue.eligible_skill(skill) is None:
        raise ScheduleError(f"{skill!r} cannot run in the background.")
    cadence = normalize_cadence(cadence)
    row = {"user_id": user_id, "note_id": note_id, "kind": "schedule", "skill": skill,
           "cadence": cadence, "month_cap_usd": month_cap_usd,
           "next_check_at": seed_next_run_at(cadence).isoformat()}
    return _t().insert(row).execute().data[0]


def update_schedule(trigger_id: str, user_id: str, **fields) -> dict | None:
    """`skill`, `cadence`, `month_cap_usd`, `enabled` — whichever are passed.
    A new `cadence` reschedules `next_check_at` from now, not from wherever
    the old cadence had gotten to."""
    patch = dict(fields)
    if "cadence" in patch and patch["cadence"] is not None:
        cadence = normalize_cadence(patch["cadence"])
        patch["cadence"] = cadence
        patch["next_check_at"] = seed_next_run_at(cadence).isoformat()
    if "skill" in patch and patch["skill"] is not None and job_queue.eligible_skill(patch["skill"]) is None:
        raise ScheduleError(f"{patch['skill']!r} cannot run in the background.")
    rows = (_t().update(patch).eq("id", trigger_id).eq("user_id", user_id)
            .eq("kind", "schedule").execute().data or [])
    return rows[0] if rows else None


def delete_schedule(trigger_id: str, user_id: str) -> bool:
    rows = (_t().delete().eq("id", trigger_id).eq("user_id", user_id)
            .eq("kind", "schedule").execute().data or [])
    return bool(rows)


def resume(trigger_id: str, user_id: str) -> dict | None:
    """Clears a pause the user asked to lift. A month-cap pause clears itself
    next tick regardless (the new month's spend is $0); this just also lets
    the user jump the gun. An "unopened" pause only ever clears this way —
    and clearing the flag alone would not be enough: the same 3 unopened
    results are still the most recent 3, so the very next tick would just
    pause it again. Resuming also marks them opened, the same as if the user
    had gone and looked: it is the user's explicit "yes, run anyway"."""
    rows = (_t().update({"paused_reason": None, "paused_kind": None})
            .eq("id", trigger_id).eq("user_id", user_id).eq("kind", "schedule")
            .execute().data or [])
    if rows:
        (database.get_supabase().table("ai_jobs").update({"opened_at": store.now_iso()})
         .eq("trigger_id", trigger_id).in_("status", list(COMPLETED_STATES))
         .is_("opened_at", "null").execute())
    return rows[0] if rows else None


def _money_date(d: date) -> str:
    return f"{calendar.month_abbr[d.month]} {d.day}"


def _month_cap_message(cap: float, now: datetime) -> str:
    first_of_next = (date(now.year + (now.month == 12), now.month % 12 + 1, 1))
    return f"Paused — reached {caps.money(cap)} this month. Resumes {_money_date(first_of_next)}"


def _claim(trigger: dict, new_next_check_at: datetime) -> dict | None:
    """Guarded on the `next_check_at` this pass read, same reasoning as the
    source-added trigger's claim: a write that landed in between wins."""
    rows = (_t().update({"next_check_at": new_next_check_at.isoformat()})
            .eq("id", trigger["id"]).eq("next_check_at", trigger["next_check_at"])
            .execute().data or [])
    return rows[0] if rows else None


def _due_occurrences(cadence: dict, due_at: datetime, now: datetime) -> list[datetime]:
    """Every occurrence at-or-before `now`, starting at `due_at` (the time this
    trigger was already due) — in order. The last one is what actually runs;
    the rest were missed."""
    occurrences = [due_at]
    for _ in range(366):                            # a year of daily misses is more than enough headroom
        nxt = next_occurrence(cadence, occurrences[-1])
        if nxt > now:
            break
        occurrences.append(nxt)
    return occurrences


def due(now: datetime) -> list[dict]:
    return (_t().select("*").eq("kind", "schedule").eq("enabled", True)
            .not_.is_("next_check_at", "null").lte("next_check_at", now.isoformat())
            .execute().data or [])


def fire_due(now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    created = []
    for trigger in due(now):
        try:
            job = fire_one(trigger, now)
        except Exception:                                    # noqa: BLE001
            logger.exception("schedule %s failed to fire", trigger.get("id"))
            continue
        if job:
            created.append(job)
    return created


def _skip_row(trigger: dict, at: datetime, reason: str) -> None:
    store.create(trigger["user_id"], note_id=trigger["note_id"], skill=trigger["skill"], focus="",
                trigger="schedule", trigger_id=trigger["id"], status="skipped",
                run_after=at.isoformat(), finished_at=at.isoformat(), created_at=at.isoformat(),
                price_mode="normal", actual_usd=0, error=reason)


def _unopened_streak(trigger_id: str) -> bool:
    rows = (database.get_supabase().table("ai_jobs").select("opened_at,status")
            .eq("trigger_id", trigger_id).in_("status", list(COMPLETED_STATES))
            .order("created_at", desc=True).limit(UNOPENED_STREAK).execute().data or [])
    return len(rows) == UNOPENED_STREAK and all(not r.get("opened_at") for r in rows)


def fire_one(trigger: dict, now: datetime) -> dict | None:
    """Fires the latest due occurrence, in this order: catch up (log the
    missed ones, run only the last) → the note still exists → not paused for
    3 unopened results → nothing new since last time (skip, cheaply, before
    pricing anything) → priceable at all → within the trigger's monthly cap.
    Only after all of that does a job get created."""
    cadence = trigger["cadence"] or {}
    occurrences = _due_occurrences(cadence, datetime.fromisoformat(trigger["next_check_at"]), now)
    run_at, missed = occurrences[-1], occurrences[:-1]
    new_next = next_occurrence(cadence, run_at)
    if not _claim(trigger, new_next):
        return None                                # stale snapshot; the newer state will fire on its own

    for at in missed:
        _skip_row(trigger, at, "Skipped — missed while the app was off")

    note_id, user_id = trigger["note_id"], trigger["user_id"]
    note = (database.get_supabase().table("notes").select("id,deleted_at")
            .eq("id", note_id).limit(1).execute().data or [])
    if not note or note[0].get("deleted_at"):
        _t().update({"enabled": False, "paused_reason": "the note was deleted"}) \
            .eq("id", trigger["id"]).execute()
        return None

    if _unopened_streak(trigger["id"]):
        _t().update({"paused_kind": "unopened",
                     "paused_reason": "Paused — you haven't opened the last 3 results"}) \
            .eq("id", trigger["id"]).execute()
        return None

    sig = source_signature(note_id)
    if sig and sig == trigger.get("last_source_signature"):
        _skip_row(trigger, run_at, "Skipped — nothing new since last run")
        _t().update({"last_run_at": now.isoformat()}).eq("id", trigger["id"]).execute()
        return None

    skill = job_queue.eligible_skill(trigger["skill"])
    if skill is None:
        return None
    try:
        q = job_queue.price(user_id, note_id, skill, "")
    except job_queue.QueueError as e:
        _skip_row(trigger, run_at, f"Skipped — {e}")
        _t().update({"last_run_at": now.isoformat()}).eq("id", trigger["id"]).execute()
        return None

    cap = float(trigger.get("month_cap_usd") or 1.00)
    spent = caps.trigger_month_spend(trigger["id"], now)
    if q["usd"] is not None and spent + q["usd"] > cap:
        _t().update({"paused_kind": "month_cap", "paused_reason": _month_cap_message(cap, now)}) \
            .eq("id", trigger["id"]).execute()
        return None
    if trigger.get("paused_reason"):                 # a pause from a past tick no longer applies
        _t().update({"paused_reason": None, "paused_kind": None}).eq("id", trigger["id"]).execute()

    from core.config import settings
    ready_ids = sorted(str(s["id"]) for s in ready_sources(note_id))
    row = store.create(
        user_id, note_id=note_id, skill=skill.name, focus="", trigger="schedule",
        trigger_id=trigger["id"], run_after=run_at.isoformat(), created_at=run_at.isoformat(),
        price_mode=q["price_mode"], shown_estimate_usd=q["usd"],
        live_equivalent_usd=q["live_usd"] if q["price_mode"] == "batch" else None,
        cap_usd=settings.max_usd_per_run or None, model=q["model"],
        provider=q["provider"].provider if q["provider"] else None,
        source_ids=ready_ids, source_hash=sig)
    _t().update({"last_run_at": now.isoformat(), "last_source_signature": sig}) \
        .eq("id", trigger["id"]).execute()
    return row
