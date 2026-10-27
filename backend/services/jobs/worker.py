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

from services import privacy
from services import database
from services.ai import budget as budget_guard
from services.ai import usage as usage_log
from services.ai.providers import Provider, list_providers
from services.ai.router import pick
from services.jobs import batch, caps, store
from services.workspace import skill_run

logger = logging.getLogger(__name__)

#: a job that starts this long after its time reports "ran late" (app was closed)
LATE_AFTER = timedelta(minutes=5)
#: a live job still "submitted" this long after it started lost its process
STUCK_AFTER = timedelta(minutes=30)
#: a price that rose more than this since it was queued waits for the user
PRICE_RISE_LIMIT = 1.25
#: a provider that does not answer at submit is asked again, this many times
SUBMIT_ATTEMPTS = 3
SUBMIT_RETRY = timedelta(minutes=5)
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


#: the retention sweep is cheap but not per-minute cheap
SWEEP_EVERY = timedelta(hours=6)
_last_sweep: datetime | None = None


def maybe_sweep(now: datetime) -> None:
    global _last_sweep
    if _last_sweep is not None and now - _last_sweep < SWEEP_EVERY:
        return
    _last_sweep = now
    try:
        done = store.sweep(now)
        if any(done.values()):
            logger.info("jobs retention: %s", done)
    except Exception:                                    # noqa: BLE001
        logger.exception("jobs retention sweep failed")


def run_due(now: datetime | None = None) -> list[dict]:
    """Recover stuck jobs, then run what is due. Returns one event per job that
    reached a state the user should hear about:
    {"kind": "ready"|"failed"|"budget_blocked"|"cancelled", "job": row, "note_title": str}."""
    now = now or datetime.now(timezone.utc)
    maybe_sweep(now)
    events = recover_stuck(now)
    events += poll_batches(now)
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
    """A job left `submitted` with nothing to poll. A live run died with the
    process: fail it. A batch may have been SENT before the process died: look
    for it at the provider before giving up, so it is neither lost nor sent twice."""
    events = []
    for job in store.stuck_running(_iso(now - STUCK_AFTER)):
        if job.get("price_mode") == "batch":
            found = _reconcile(job)
            if found == "wait":
                continue
            if found:
                store.transition(job["id"], "submitted", provider_batch_id=found)
                continue
        row = store.transition(
            job["id"], "submitted", status="failed", finished_at=store.now_iso(),
            error="The app stopped while this was running. Nothing was saved. Try again.")
        if row:
            events.append({"kind": "failed", "job": row,
                           "note_title": (_note(row.get("note_id")) or {}).get("title") or ""})
    return events


def _reconcile(job: dict) -> str | None:
    """The id of the batch this job sent, "wait" while a candidate is still being
    processed, None when nothing was sent. Batches carry no metadata, so a
    candidate is any batch created since the job started; its results say whose
    it is (each request's custom_id is the job's id)."""
    provider = _provider_for(job)
    adapter = batch.adapter_for(provider)
    if adapter is None:
        return None
    since = _parse(job["started_at"]) - timedelta(minutes=1)
    waiting = False
    try:
        for b in adapter.recent(provider):
            created = b.get("created_at")
            if created and _parse(created) < since:
                continue
            if b.get("processing_status") != "ended":
                waiting = True
                continue
            if job["id"] in adapter.collect(provider, b["id"]):
                return b["id"]
    except Exception:                                    # noqa: BLE001
        logger.warning("job %s: could not look for its batch", job.get("id"), exc_info=True)
        return "wait"
    return "wait" if waiting else None


def _provider_for(job: dict) -> Provider | None:
    """The provider that holds this job's batch: the one it was sent to."""
    try:
        for p in list_providers(job["user_id"]):
            if p.provider == (job.get("provider") or "anthropic") and batch.adapter_for(p):
                return p
    except Exception:                                    # noqa: BLE001
        logger.warning("job %s: could not read providers", job.get("id"), exc_info=True)
    return None


def run_one(job: dict, now: datetime) -> dict | None:
    """One due job. It reads its note's sources, so the note's privacy level
    rules out providers before one is planned or sent to."""
    with privacy.handling([job.get("note_id")], str(job.get("user_id") or "")):
        return _run_one(job, now)


def _run_one(job: dict, now: datetime) -> dict | None:
    """As the job's user, so it reads that user's own skills
    (services/skill_store.py): no request is here to name them."""
    from services.skill_store import as_user
    with as_user(job.get("user_id")):
        return _run_one_as_user(job, now)


def _run_one_as_user(job: dict, now: datetime) -> dict | None:
    note = _note(job.get("note_id"))
    if note is None:
        row = store.transition(job["id"], "queued", status="cancelled",
                               finished_at=store.now_iso(), actual_usd=0,
                               cancel_reason="the note was deleted")
        return {"kind": "cancelled", "job": row, "note_title": ""} if row else None

    late = now - _parse(job["run_after"]) > LATE_AFTER
    claimed = store.transition(job["id"], "queued", status="submitted",
                               started_at=store.now_iso(), ran_late=late,
                               attempts=(job.get("attempts") or 0) + 1)
    if not claimed:                       # cancelled, or another tick got it
        return None

    title = note.get("title") or ""
    plan = plan_for(job)
    # Before the model is asked: the price NOW (the model or the sources may have
    # changed since it was queued) against this job's limit and the monthly one.
    why = caps.preflight(job["user_id"], plan["usd"], job.get("cap_usd"), now)
    if why:
        # Refused before the model: it cost nothing, and the row says so.
        row = store.transition(job["id"], "submitted", status="budget_blocked",
                               finished_at=store.now_iso(), error=why, actual_usd=0)
        return {"kind": "budget_blocked", "job": row, "note_title": title} if row else None
    # The price the user agreed to is the one they were shown. A rise of more
    # than a quarter — the model changed, batch is gone, the sources grew — is
    # theirs to accept; a smaller one, or a fall, is not worth asking about.
    shown = job.get("shown_estimate_usd")
    if shown and plan["usd"] is not None and plan["usd"] > shown * PRICE_RISE_LIMIT:
        was, now_usd = caps.money(shown), caps.money(plan["usd"])
        row = store.transition(
            job["id"], "submitted", status="needs_you", finished_at=None,
            error=f"Price went up: about {now_usd} now (was about {was})"
                  + (f" — it will run on {plan['model']}" if plan.get("model") else ""),
            result_meta={"was_usd": shown, "now_usd": plan["usd"], "now_mode": plan["mode"]})
        return {"kind": "needs_you", "job": row, "note_title": title} if row else None

    if plan["mode"] == "batch":
        return _submit_batch(job, plan, title, now)
    return _run_live(job, plan, title)


def _submit_batch(job: dict, plan: dict, title: str, now: datetime) -> dict | None:
    """Send the job as a batch request and leave it `submitted` with the batch
    id. The result is collected by `poll_batches` — minutes or hours later."""
    try:
        call = skill_run.batch_call(job["note_id"], job["user_id"], job["skill"], job.get("focus") or "")
        if call is None:                       # not a single call after all: normal price, live
            return _run_live(job, {**plan, "mode": "normal"}, title)
        batch_id = plan["adapter"].submit(plan["provider"], job["id"], call.messages, call.max_tokens)
    except ValueError as e:                    # cannot run at all: say why
        row = store.transition(job["id"], "submitted", status="failed",
                               finished_at=store.now_iso(), error=str(e)[:500], actual_usd=0)
        return {"kind": "failed", "job": row, "note_title": title} if row else None
    except Exception as e:                               # noqa: BLE001
        # The provider did not take it. Ask again a little later, a few times;
        # never switch to another provider or the live price on our own.
        logger.warning("job %s: batch submit failed: %s", job["id"], e)
        attempts = job.get("attempts") or 0
        if attempts + 1 < SUBMIT_ATTEMPTS:
            row = store.transition(job["id"], "submitted", status="queued",
                                   run_after=(now + SUBMIT_RETRY).isoformat(), error=str(e)[:300])
            return None
        row = store.transition(job["id"], "submitted", status="failed", finished_at=store.now_iso(),
                               error=f"{plan['provider'].label or plan['provider'].provider} did not answer: {str(e)[:200]}",
                               actual_usd=0)
        return {"kind": "failed", "job": row, "note_title": title} if row else None
    store.transition(job["id"], "submitted", provider_batch_id=batch_id, price_mode="batch",
                     model=plan["model"], provider=plan["provider"].provider,
                     source_ids=call.source_ids, live_equivalent_usd=plan["live_usd"], error=None)
    return None


def _run_live(job: dict, plan: dict, title: str) -> dict | None:
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
        result_html=result["html"], result_title=result["title"], price_mode=plan["mode"],
        result_meta=meta, source_ids=result.get("source_ids") or [],
        actual_usd=result.get("usd"), error=None)
    # Cancelled while the model was working: the money is spent, the result is
    # dropped, and the row already says cancelled.
    return {"kind": "ready", "job": row, "note_title": title} if row else None


def poll_batches(now: datetime) -> list[dict]:
    """Ask the provider about every batch we are waiting for; collect the ones
    that ended. Runs each tick; one call per waiting batch."""
    events = []
    for job in store.sent_batches():
        try:
            ev = _collect(job)
        except Exception:                                # noqa: BLE001
            logger.exception("job %s: collecting its batch failed", job.get("id"))
            continue
        if ev:
            events.append(ev)
    return events


def _collect(job: dict) -> dict | None:
    provider = _provider_for(job)
    adapter = batch.adapter_for(provider)
    title = (_note(job.get("note_id")) or {}).get("title") or ""
    if adapter is None:
        row = store.transition(job["id"], "submitted", status="failed", finished_at=store.now_iso(),
                               error="The provider key for this batch was removed, so its "
                                     "result cannot be collected.")
        return {"kind": "failed", "job": row, "note_title": title} if row else None
    if adapter.poll(provider, job["provider_batch_id"]).state != "ended":
        return None
    outcome = adapter.collect(provider, job["provider_batch_id"]).get(job["id"])
    if outcome is None or outcome.kind == "expired":
        row = store.transition(
            job["id"], "submitted", status="expired", finished_at=store.now_iso(), actual_usd=0,
            error="Not finished within 24 hours by the provider. Nothing was charged.")
        return {"kind": "expired", "job": row, "note_title": title} if row else None
    if outcome.kind == "canceled":
        row = store.transition(job["id"], "submitted", status="cancelled",
                               finished_at=store.now_iso(), cancel_reason="the provider cancelled it")
        return {"kind": "cancelled", "job": row, "note_title": title} if row else None
    if outcome.kind == "errored":
        row = store.transition(job["id"], "submitted", status="failed", finished_at=store.now_iso(),
                               error=f"The provider rejected the request: {outcome.error}", actual_usd=0)
        return {"kind": "failed", "job": row, "note_title": title} if row else None

    # It succeeded, so it is paid for — recorded before anything can go wrong with the text.
    paid, live = usage_log.record_batch_run(
        provider.provider, job.get("model"), user_id=job["user_id"], note_id=job.get("note_id"),
        skill=job["skill"], input_tokens=outcome.input_tokens, output_tokens=outcome.output_tokens,
        cache_read_tokens=outcome.cache_read_tokens, cache_write_tokens=outcome.cache_write_tokens,
        discount=batch.DISCOUNT)
    truncated = outcome.stop_reason == "max_tokens"
    try:
        blocks = skill_run._blocks_for(job["note_id"])[0] if job.get("note_id") else None
    except Exception:                                    # noqa: BLE001
        blocks = None
    try:
        done = skill_run.finish_batch(job["skill"], outcome.text, truncated, blocks)
    except ValueError as e:
        row = store.transition(job["id"], "submitted", status="failed", finished_at=store.now_iso(),
                               error=str(e)[:500], actual_usd=paid, live_equivalent_usd=live)
        return {"kind": "failed", "job": row, "note_title": title} if row else None
    meta = {**{k: done.get(k) for k in ("truncated", "method", "check")},
            "input_tokens": outcome.input_tokens, "output_tokens": outcome.output_tokens}
    row = store.transition(
        job["id"], "submitted", status="ready", finished_at=store.now_iso(),
        result_html=done["html"], result_title=skill_run.job_title(job["skill"]),
        result_meta=meta, actual_usd=paid, live_equivalent_usd=live, error=None)
    return {"kind": "ready", "job": row, "note_title": title} if row else None


def plan_for(job: dict) -> dict:
    """The plan under the job's note's privacy level (a private note plans on
    the local model). See _plan_for."""
    with privacy.handling([job.get("note_id")], str(job.get("user_id") or "")):
        return _plan_for(job)


def _plan_for(job: dict) -> dict:
    """How this job would run if it started now, and what that costs: the price
    mode, the provider and model, the amount at that mode, and the live amount.
    Any failure to look falls back to the normal price with the queued estimate —
    a stale number is better than none, and batch is never assumed."""
    live = _estimate_now(job)
    plan = {"mode": "normal", "usd": live, "live_usd": live, "provider": None,
            "adapter": None, "model": job.get("model")}
    try:
        provider = pick("summarize_text", job["user_id"])
        if provider is None:
            return plan
        plan["provider"], plan["model"] = provider, provider.model
        if provider.provider == "local":
            plan["mode"] = "local"
            return plan
        adapter = batch.adapter_for(provider)
        n = len(skill_run.ready_sources(job["note_id"]))
        if adapter and skill_run.batch_eligible(job["skill"], n, job.get("focus") or ""):
            plan.update(mode="batch", adapter=adapter,
                        usd=None if live is None else round(live * batch.DISCOUNT, 6))
    except Exception:                                    # noqa: BLE001
        logger.warning("job %s: could not plan, running at the normal price", job.get("id"),
                       exc_info=True)
    return plan


def _estimate_now(job: dict) -> float | None:
    """What this job would cost if it started now; the price shown at queue time
    when the estimate cannot be made (better a stale number than none)."""
    try:
        priced = next((j for j in skill_run.chat_skills(job["note_id"], job["user_id"])
                       if j.get("skill") == job["skill"]), None)
        if priced is not None:
            return priced.get("usd")
    except Exception:                                    # noqa: BLE001
        logger.warning("job %s: could not re-price, using the queued estimate", job.get("id"),
                       exc_info=True)
    return job.get("shown_estimate_usd")


def notification_for(event: dict) -> dict:
    """The bell entry for an event: message, link, source."""
    job, kind = event["job"], event["kind"]
    what = skill_run.job_title(job["skill"])
    target = f' for "{event["note_title"]}"' if event.get("note_title") else ""
    link = f"/brain/workspace/{job['note_id']}?job={job['id']}" if job.get("note_id") else None
    message = {
        "expired": f"{what}{target}: not finished within 24 hours — nothing was charged",
        "needs_you": f"{what}{target}: {job.get('error') or 'the price changed'}",
        "ready": f"{what}{target} is ready",
        "failed": f"{what}{target} failed — {job.get('error') or 'unknown error'}",
        "budget_blocked": f"{what}{target}: {job.get('error') or 'not started — over the limit'}",
        "cancelled": f"{what}{target} was cancelled — {job.get('cancel_reason') or ''}".rstrip(" —"),
    }[kind]
    return {"message": message[:300], "link": link, "source": f"job:{job['id']}"}
