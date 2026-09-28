"""What a background job may spend, and the sentences that say so.

Three ceilings (spec §6). The per-job one already exists (`MAX_USD_PER_RUN`);
the monthly one is new and applies to background jobs only — a run the user is
watching is never blocked by it, because they can see what it costs. Both are
checked BEFORE the model is called, with the numbers in the message.

An unpriced model can never trip a ceiling (same rule as `Budget.would_exceed`):
refusing work because a price list is incomplete is the wrong failure. The
Activity page says "price unknown — no limit applies" beside such a job.
"""
from __future__ import annotations

from datetime import datetime, timezone

from services import database

DEFAULT_MONTHLY_CAP_USD = 5.00
MIN_CAP, MAX_CAP = 0.01, 1000.0
PREF_KEY = "background_jobs"
PAGE = 1000


def money(usd: float) -> str:
    """$0.62, $0.004 — the same rule the UI uses: under a cent shows 3 places."""
    return f"${usd:.3f}" if 0 < usd < 0.01 else f"${usd:.2f}"


def _profile(user_id: str) -> dict:
    rows = (database.get_supabase().table("profiles").select("id,preferences")
            .eq("id", user_id).limit(1).execute().data or [])
    return rows[0] if rows else {"id": user_id, "preferences": {}}


def get_monthly_cap(user_id: str) -> float:
    prefs = (_profile(user_id).get("preferences") or {}).get(PREF_KEY) or {}
    cap = prefs.get("monthly_cap_usd")
    return float(cap) if isinstance(cap, (int, float)) and cap >= MIN_CAP else DEFAULT_MONTHLY_CAP_USD


def set_monthly_cap(user_id: str, cap: float) -> float:
    if not (MIN_CAP <= cap <= MAX_CAP):
        raise ValueError(f"The monthly limit must be between {money(MIN_CAP)} and {money(MAX_CAP)}.")
    prefs = dict(_profile(user_id).get("preferences") or {})
    prefs[PREF_KEY] = {**(prefs.get(PREF_KEY) or {}), "monthly_cap_usd": round(cap, 2)}
    database.get_supabase().table("profiles").update({"preferences": prefs}).eq("id", user_id).execute()
    return round(cap, 2)


def month_start(now: datetime | None = None) -> datetime:
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def month_spend(user_id: str, now: datetime | None = None) -> float:
    """Everything this user's AI cost this calendar month (UTC), all surfaces —
    from the run log, so the cap is the real bill and not a subset of it."""
    since = month_start(now).isoformat()
    total, start = 0.0, 0
    while True:
        rows = (database.get_supabase().table("ai_runs").select("estimated_usd")
                .eq("user_id", user_id).gte("created_at", since)
                .range(start, start + PAGE - 1).execute().data or [])
        total += sum(float(r["estimated_usd"]) for r in rows if r.get("estimated_usd") is not None)
        if len(rows) < PAGE:
            return round(total, 6)
        start += PAGE


def trigger_month_spend(trigger_id: str, now: datetime | None = None) -> float:
    """What THIS trigger has spent so far this calendar month — a schedule's
    own $1/month default is judged against this, not the account total."""
    since = month_start(now).isoformat()
    total, start = 0.0, 0
    while True:
        rows = (database.get_supabase().table("ai_jobs").select("actual_usd")
                .eq("trigger_id", trigger_id).gte("created_at", since)
                .range(start, start + PAGE - 1).execute().data or [])
        total += sum(float(r["actual_usd"]) for r in rows if r.get("actual_usd") is not None)
        if len(rows) < PAGE:
            return round(total, 6)
        start += PAGE


def preflight(user_id: str, estimate_usd: float | None, cap_usd: float | None,
              now: datetime | None = None) -> str | None:
    """Why this job must not start, or None. The sentence is the job's error."""
    if estimate_usd is None:
        return None
    if cap_usd is not None and estimate_usd > cap_usd:
        return f"Not started — about {money(estimate_usd)} is over this job's {money(cap_usd)} limit"
    monthly = get_monthly_cap(user_id)
    spent = month_spend(user_id, now)
    if spent + estimate_usd > monthly:
        return (f"Not started — about {money(estimate_usd)} would pass your "
                f"{money(monthly)} monthly limit ({money(spent)} spent this month)")
    return None
