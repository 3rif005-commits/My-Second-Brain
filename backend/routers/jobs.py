"""Background jobs: queue a skill to run later, see the queue, cancel, apply.

The worker (`services/jobs/worker.py`) runs due jobs from the scheduler tick;
nothing here calls a model. Applying a result is done by the client through the
existing note-editing path — the job only records that it happened.
"""
from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException
from pydantic import BaseModel

from routers.ingest import get_user_id
from services.database import get_supabase
from services.jobs import batch, caps, queue as job_queue, schedule as job_schedule, stale, store, triggers, worker
from services.jobs.notify import notify
from services.workspace import skill_run
from services.workspace.synthesis import source_signature

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/jobs", tags=["jobs"])

#: a job cannot be queued for further out than this
MAX_DELAY = timedelta(days=14)


class QueueRequest(BaseModel):
    note_id: str
    skill: str
    focus: str = ""
    #: ISO time; omitted = as soon as the next tick
    run_after: str | None = None


class AppliedRequest(BaseModel):
    note_id: str | None = None


class TriggerRequest(BaseModel):
    skill: str | None = None   # None (or omitted) means "Suggest" — turn it off


class ScheduleRequest(BaseModel):
    note_id: str
    skill: str
    cadence: dict
    month_cap_usd: float = 1.00


class ScheduleUpdate(BaseModel):
    skill: str | None = None
    cadence: dict | None = None
    month_cap_usd: float | None = None
    enabled: bool | None = None


class SettingsRequest(BaseModel):
    monthly_cap_usd: float


def _fail(status: int, message: str):
    raise HTTPException(status_code=status, detail={"error": message})


def _own_note(note_id: str, user_id: str) -> dict:
    rows = (get_supabase().table("notes").select("id,title")
            .eq("id", note_id).eq("user_id", user_id).is_("deleted_at", "null")
            .limit(1).execute().data or [])
    if not rows:
        _fail(404, "Note not found")
    return rows[0]


def _job(job_id: str, user_id: str) -> dict:
    row = store.get(job_id, user_id)
    if not row:
        _fail(404, "Job not found")
    return row


def _brief(row: dict) -> dict:
    """A job without its result body — lists and receipts never carry the HTML."""
    return {k: v for k, v in row.items()
            if k not in ("result_html", "source_ids", "source_hash", "dedupe_key")}


def _quote(user_id: str, note_id: str, skill, focus: str) -> dict:
    """The router's error shape around the shared pricing decision
    (`services.jobs.queue.price`) — the same one both `/quote` and queueing
    use, so what a user is shown is what they get."""
    try:
        return job_queue.price(user_id, note_id, skill, focus)
    except job_queue.QueueError as e:
        _fail(400, str(e))


@router.get("/quote")
def quote_job(note_id: str, skill: str, authorization: str = Header(), focus: str = ""):
    """The price line's numbers, before anything is queued."""
    user_id = get_user_id(authorization)
    _own_note(note_id, user_id)
    sk = job_queue.eligible_skill(skill)
    if sk is None:
        _fail(400, f"{skill!r} cannot run in the background.")
    q = _quote(user_id, note_id, sk, focus)
    return {"price_mode": q["price_mode"], "usd": q["usd"], "live_usd": q["live_usd"],
            "model": q["model"]}


@router.post("")
def queue_job(body: QueueRequest, authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_note(body.note_id, user_id)
    skill = job_queue.eligible_skill(body.skill)
    if skill is None:
        _fail(400, f"{body.skill!r} cannot run in the background.")

    now = datetime.now(timezone.utc)
    run_after = now
    if body.run_after:
        try:
            run_after = datetime.fromisoformat(body.run_after.replace("Z", "+00:00"))
        except ValueError:
            _fail(400, "run_after is not a time.")
        if run_after.tzinfo is None:
            run_after = run_after.replace(tzinfo=timezone.utc)
        if run_after > now + MAX_DELAY:
            _fail(400, "A job can wait at most 14 days.")
        run_after = max(run_after, now)

    quote = _quote(user_id, body.note_id, skill, body.focus)
    from core.config import settings
    provider, live, mode, shown = (quote[k] for k in ("provider", "live_usd", "price_mode", "usd"))
    row = store.create(
        user_id, note_id=body.note_id, skill=skill.name, focus=body.focus.strip(),
        trigger="run_later", run_after=run_after.isoformat(), price_mode=mode,
        shown_estimate_usd=shown, live_equivalent_usd=live if mode == "batch" else None,
        cap_usd=settings.max_usd_per_run or None,
        model=quote["model"], provider=provider.provider if provider else None,
        source_hash=source_signature(body.note_id))
    return _brief(row)


@router.get("")
def list_jobs(authorization: str = Header(), note_id: str | None = None,
              status: str | None = None):
    user_id = get_user_id(authorization)
    statuses = tuple(s for s in (status or "").split(",") if s) or None
    return {"jobs": store.list_for_user(user_id, note_id=note_id, statuses=statuses)}


def _with_note_titles(rows: list[dict]) -> list[dict]:
    ids = sorted({r["note_id"] for r in rows if r.get("note_id")})
    titles: dict[str, str] = {}
    if ids:
        for n in (get_supabase().table("notes").select("id,title").in_("id", ids)
                  .execute().data or []):
            titles[n["id"]] = n.get("title") or "Untitled"
    return [{**r, "note_title": titles.get(r.get("note_id") or "")} for r in rows]


@router.get("/notes/{note_id}/trigger")
def get_trigger(note_id: str, authorization: str = Header()):
    """The rail's line for this note: off, or which skill runs when a source
    lands. `skills` lists what a trigger here may run, each with why not if
    it currently could not."""
    user_id = get_user_id(authorization)
    _own_note(note_id, user_id)
    row = triggers.get(note_id, user_id)
    offered = [{"skill": s["skill"], "title": skill_run.job_title(s["skill"]), "usd": s.get("usd"),
               "runnable": s.get("runnable")}
              for s in skill_run.chat_skills(note_id, user_id)
              if job_queue.eligible_skill(s["skill"]) is not None]
    return {"skill": row["skill"] if row else None, "skills": offered}


@router.put("/notes/{note_id}/trigger")
def put_trigger(note_id: str, body: TriggerRequest, authorization: str = Header()):
    """Turn the trigger on (or change its skill) with `skill`, or off by
    sending none — an explicit per-note choice; the global default
    (`workspace_on_drop`) stays `suggest` either way."""
    user_id = get_user_id(authorization)
    _own_note(note_id, user_id)
    if body.skill is None:
        triggers.clear_trigger(note_id, user_id)
        return {"skill": None}
    if job_queue.eligible_skill(body.skill) is None:
        _fail(400, f"{body.skill!r} cannot run in the background.")
    row = triggers.set_trigger(note_id, user_id, body.skill)
    return {"skill": row["skill"]}


def _schedule_brief(row: dict, note_title: str | None = None) -> dict:
    return {"id": row["id"], "note_id": row.get("note_id"), "note_title": note_title,
            "skill": row["skill"], "cadence": row.get("cadence"),
            "month_cap_usd": row.get("month_cap_usd"), "enabled": row.get("enabled"),
            "paused_reason": row.get("paused_reason"), "paused_kind": row.get("paused_kind"),
            "last_run_at": row.get("last_run_at"), "next_check_at": row.get("next_check_at"),
            "month_spent_usd": caps.trigger_month_spend(row["id"])}


@router.get("/schedules")
def list_schedules(authorization: str = Header()):
    user_id = get_user_id(authorization)
    rows = job_schedule.list_schedules(user_id)
    titles = {}
    ids = [r["note_id"] for r in rows if r.get("note_id")]
    if ids:
        for n in get_supabase().table("notes").select("id,title").in_("id", ids).execute().data or []:
            titles[n["id"]] = n.get("title") or "Untitled"
    return {"schedules": [_schedule_brief(r, titles.get(r.get("note_id"))) for r in rows]}


@router.post("/schedules")
def create_schedule(body: ScheduleRequest, authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_note(body.note_id, user_id)
    try:
        row = job_schedule.create_schedule(user_id, body.note_id, body.skill, body.cadence, body.month_cap_usd)
    except job_schedule.ScheduleError as e:
        _fail(400, str(e))
    return _schedule_brief(row)


@router.put("/schedules/{trigger_id}")
def put_schedule(trigger_id: str, body: ScheduleUpdate, authorization: str = Header()):
    user_id = get_user_id(authorization)
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        row = job_schedule.update_schedule(trigger_id, user_id, **fields)
    except job_schedule.ScheduleError as e:
        _fail(400, str(e))
    if not row:
        _fail(404, "Schedule not found")
    return _schedule_brief(row)


@router.delete("/schedules/{trigger_id}")
def remove_schedule(trigger_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    if not job_schedule.delete_schedule(trigger_id, user_id):
        _fail(404, "Schedule not found")
    return {"ok": True}


@router.post("/schedules/{trigger_id}/resume")
def resume_schedule(trigger_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    row = job_schedule.resume(trigger_id, user_id)
    if not row:
        _fail(404, "Schedule not found")
    return _schedule_brief(row)


@router.get("/activity")
def activity(authorization: str = Header(), skill: str | None = None,
             trigger: str | None = None, status: str | None = None, days: int = 30):
    """Everything the Activity page shows: what is open (any age), the history
    (filtered), and the header totals."""
    user_id = get_user_id(authorization)
    days = min(max(days, 1), store.ROW_DAYS)
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    # Four independent reads, each a round trip to the database: run them side by
    # side (the page took 3.4 s when they ran one after the other).
    with ThreadPoolExecutor(max_workers=4) as pool:
        f_open = pool.submit(store.list_for_user, user_id, statuses=store.OPEN_STATES, limit=100)
        f_hist = pool.submit(store.history, user_id, since=since, skill=skill, trigger=trigger, status=status)
        f_spent = pool.submit(caps.month_spend, user_id)
        f_cap = pool.submit(caps.get_monthly_cap, user_id)
        open_rows, history = f_open.result(), f_hist.result()
        month_spent, monthly_cap = f_spent.result(), f_cap.result()
    saved = sum((r.get("live_equivalent_usd") or 0) - (r.get("actual_usd") or 0)
                for r in history if r.get("price_mode") == "batch"
                and r.get("actual_usd") is not None and r.get("live_equivalent_usd") is not None
                and r["created_at"] >= caps.month_start().isoformat())
    return {
        "open": _with_note_titles(open_rows),
        "history": _with_note_titles(history),
        "month_spent_usd": month_spent,
        "monthly_cap_usd": monthly_cap,
        "saved_usd": round(max(saved, 0.0), 4),
    }


@router.get("/badge")
def badge(authorization: str = Header()):
    """How many results and problems are waiting — the sidebar's dot."""
    return store.count_open(get_user_id(authorization))


@router.get("/settings")
def get_settings(authorization: str = Header()):
    user_id = get_user_id(authorization)
    return {"monthly_cap_usd": caps.get_monthly_cap(user_id),
            "default_monthly_cap_usd": caps.DEFAULT_MONTHLY_CAP_USD,
            "min_usd": caps.MIN_CAP, "max_usd": caps.MAX_CAP,
            "month_spent_usd": caps.month_spend(user_id)}


@router.put("/settings")
def put_settings(body: SettingsRequest, authorization: str = Header()):
    user_id = get_user_id(authorization)
    try:
        cap = caps.set_monthly_cap(user_id, body.monthly_cap_usd)
    except ValueError as e:
        _fail(400, str(e))
    return {"monthly_cap_usd": cap, "month_spent_usd": caps.month_spend(user_id)}


@router.get("/{job_id}")
def get_job(job_id: str, authorization: str = Header()):
    """The full job, result included. Opening a ready result is what the
    "you never opened the last 3" rule counts. A ready job also carries
    `stale`: whether the sources it was made from have since changed."""
    user_id = get_user_id(authorization)
    row = _job(job_id, user_id)
    if row["status"] == "ready" and not row.get("opened_at"):
        store.transition(job_id, "ready", opened_at=store.now_iso())
    stale_note = None
    if row["status"] == "ready" and row.get("note_id"):
        try:
            stale_note = stale.check(row.get("source_hash"), row.get("source_ids") or [], row["note_id"])
        except Exception:                                        # noqa: BLE001
            logger.warning("job %s: staleness check failed", job_id, exc_info=True)
    return {**{k: v for k, v in row.items() if k not in ("source_hash", "dedupe_key")}, "stale": stale_note}


@router.get("/{job_id}/detail")
def job_detail(job_id: str, authorization: str = Header()):
    """What the Activity page's expanded row adds to the list row: which sources
    the job was made from."""
    user_id = get_user_id(authorization)
    row = _job(job_id, user_id)
    ids = row.get("source_ids") or []
    sources = []
    if ids:
        sources = [{"id": r["id"], "title": r.get("title") or "Untitled"} for r in
                   (get_supabase().table("note_resources").select("id,title")
                    .in_("id", ids).execute().data or [])]
    return {"sources": sources}


@router.delete("/{job_id}")
def delete_job(job_id: str, authorization: str = Header()):
    """Remove a finished job from the history (and any result it still holds)."""
    user_id = get_user_id(authorization)
    _job(job_id, user_id)
    if not store.delete(job_id, user_id):
        _fail(409, "A job that is waiting or running cannot be deleted — cancel it first.")
    return {"ok": True}


@router.post("/{job_id}/cancel")
def cancel_job(job_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    before = _job(job_id, user_id)
    # Cancelled while still waiting, nothing was spent; a running job may have
    # spent something already, so its cost stays unknown rather than "$0".
    extra = {"actual_usd": 0} if before["status"] == "queued" else {}
    row = store.transition(job_id, store.CANCELLABLE, status="cancelled",
                           finished_at=store.now_iso(), cancel_reason="by you", **extra)
    if not row:
        _fail(409, "This job has already finished.")
    if before.get("provider_batch_id"):
        # Tell the provider too. Best effort: the job is cancelled here either way,
        # and anything the provider had already finished is still charged.
        try:
            provider = worker._provider_for(before)
            adapter = batch.adapter_for(provider)
            if adapter:
                adapter.cancel(provider, before["provider_batch_id"])
        except Exception:                                # noqa: BLE001
            logger.warning("could not cancel batch %s at the provider", before["provider_batch_id"],
                           exc_info=True)
    return _brief(row)


@router.post("/{job_id}/accept-price")
def accept_price(job_id: str, background: BackgroundTasks, authorization: str = Header()):
    """Run a job at the higher price the user was just told about."""
    user_id = get_user_id(authorization)
    row = _job(job_id, user_id)
    meta = row.get("result_meta") or {}
    if row["status"] != "needs_you" or meta.get("now_usd") is None:
        _fail(409, "This job is not waiting for a price decision.")
    now = datetime.now(timezone.utc)
    queued = store.transition(
        job_id, "needs_you", status="queued", run_after=now.isoformat(),
        shown_estimate_usd=meta["now_usd"], price_mode=meta.get("now_mode") or "normal",
        error=None, result_meta={}, finished_at=None)
    if not queued:
        _fail(409, "This job is not waiting for a price decision.")
    background.add_task(_run_and_notify, queued, now)
    return _brief(queued)


@router.post("/{job_id}/run-now")
def run_now(job_id: str, background: BackgroundTasks, authorization: str = Header()):
    user_id = get_user_id(authorization)
    _job(job_id, user_id)
    now = datetime.now(timezone.utc)
    row = store.transition(job_id, "queued", run_after=now.isoformat())
    if not row:
        _fail(409, "This job is not waiting any more.")
    background.add_task(_run_and_notify, row, now)
    return _brief(row)


async def _run_and_notify(row: dict, now: datetime) -> None:
    try:
        event = await asyncio.to_thread(worker.run_one, row, now)
    except Exception:                                    # noqa: BLE001
        logger.exception("run-now job %s crashed", row.get("id"))
        return
    if event:
        await notify([event])


@router.post("/{job_id}/discard")
def discard_job(job_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    _job(job_id, user_id)
    row = store.transition(job_id, ("ready", "failed", "budget_blocked", "expired", "needs_you"),
                           status="discarded", discarded_at=store.now_iso(), result_html=None)
    if not row:
        _fail(409, "There is nothing to discard.")
    return _brief(row)


@router.post("/{job_id}/applied")
def mark_applied(job_id: str, body: AppliedRequest, authorization: str = Header()):
    """The client calls this after it put the result in a note."""
    user_id = get_user_id(authorization)
    _job(job_id, user_id)
    # The note now holds the text; keeping a second copy here would only grow the table.
    row = store.transition(job_id, "ready", status="applied", applied_at=store.now_iso(),
                           applied_note_id=body.note_id, result_html=None)
    if not row:
        _fail(409, "This result is not waiting to be applied.")
    return _brief(row)
