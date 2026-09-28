"""Background jobs: queue a skill to run later, see the queue, cancel, apply.

The worker (`services/jobs/worker.py`) runs due jobs from the scheduler tick;
nothing here calls a model. Applying a result is done by the client through the
existing note-editing path — the job only records that it happened.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException
from pydantic import BaseModel

from routers.ingest import get_user_id
from services.ai.router import pick
from services.database import get_supabase
from services.jobs import batch, caps, store, worker
from services.jobs.notify import notify
from services.workspace import skill_run

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


def eligible_skill(name: str):
    """A skill that can run unattended: it writes a document from the note's
    sources and needs no person. Selection skills edit the user's own text, so
    they stay live."""
    skill = skill_run.registry().get(name)
    if (skill is None or not skill.output
            or skill.output in skill_run.SELECTION_OUTPUTS
            or not (skill_run.CHAT_SURFACES & set(skill.surfaces))):
        return None
    return skill


def _quote(user_id: str, note_id: str, skill, focus: str) -> dict:
    """What a job would cost and how it would run — the ONE decision both the
    price shown before the click and the job that is queued come from, so what
    the user is shown is what they get. A provider with a batch API and a job
    that is a single call go at half price; a local model is free; anything else
    runs at the normal price. Raises 400 with the reason when it cannot run."""
    priced = next((j for j in skill_run.chat_skills(note_id, user_id)
                   if j.get("skill") == skill.name), None) or {}
    if priced.get("runnable"):
        _fail(400, f"{skill_run.job_title(skill.name)}: {priced['runnable']}.")
    provider = pick("summarize_text", user_id)
    live = priced.get("usd")
    if provider and provider.provider == "local":
        mode = "local"
    elif (batch.adapter_for(provider)
          and skill_run.batch_eligible(skill.name, len(skill_run.ready_sources(note_id)), focus)):
        mode = "batch"
    else:
        mode = "normal"
    shown = round(live * batch.DISCOUNT, 6) if mode == "batch" and live is not None else live
    return {"provider": provider, "priced": priced, "live_usd": live, "price_mode": mode,
            "usd": shown, "model": priced.get("model")}


@router.get("/quote")
def quote_job(note_id: str, skill: str, authorization: str = Header(), focus: str = ""):
    """The price line's numbers, before anything is queued."""
    user_id = get_user_id(authorization)
    _own_note(note_id, user_id)
    sk = eligible_skill(skill)
    if sk is None:
        _fail(400, f"{skill!r} cannot run in the background.")
    q = _quote(user_id, note_id, sk, focus)
    return {"price_mode": q["price_mode"], "usd": q["usd"], "live_usd": q["live_usd"],
            "model": q["model"]}


@router.post("")
def queue_job(body: QueueRequest, authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_note(body.note_id, user_id)
    skill = eligible_skill(body.skill)
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
    provider, priced, live, mode, shown = (quote[k] for k in
                                           ("provider", "priced", "live_usd", "price_mode", "usd"))
    row = store.create(
        user_id, note_id=body.note_id, skill=skill.name, focus=body.focus.strip(),
        trigger="run_later", run_after=run_after.isoformat(), price_mode=mode,
        shown_estimate_usd=shown, live_equivalent_usd=live if mode == "batch" else None,
        cap_usd=settings.max_usd_per_run or None,
        model=quote["model"], provider=provider.provider if provider else None)
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


@router.get("/activity")
def activity(authorization: str = Header(), skill: str | None = None,
             trigger: str | None = None, status: str | None = None, days: int = 30):
    """Everything the Activity page shows: what is open (any age), the history
    (filtered), and the header totals."""
    user_id = get_user_id(authorization)
    days = min(max(days, 1), store.ROW_DAYS)
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    open_rows = store.list_for_user(user_id, statuses=store.OPEN_STATES, limit=100)
    history = store.history(user_id, since=since, skill=skill, trigger=trigger, status=status)
    saved = sum((r.get("live_equivalent_usd") or 0) - (r.get("actual_usd") or 0)
                for r in history if r.get("price_mode") == "batch"
                and r.get("actual_usd") is not None and r.get("live_equivalent_usd") is not None
                and r["created_at"] >= caps.month_start().isoformat())
    return {
        "open": _with_note_titles(open_rows),
        "history": _with_note_titles(history),
        "month_spent_usd": caps.month_spend(user_id),
        "monthly_cap_usd": caps.get_monthly_cap(user_id),
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
    "you never opened the last 3" rule (M5) counts."""
    user_id = get_user_id(authorization)
    row = _job(job_id, user_id)
    if row["status"] == "ready" and not row.get("opened_at"):
        store.transition(job_id, "ready", opened_at=store.now_iso())
    return {k: v for k, v in row.items() if k not in ("source_hash", "dedupe_key")}


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
    row = store.transition(job_id, ("ready", "failed", "budget_blocked", "expired"),
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
