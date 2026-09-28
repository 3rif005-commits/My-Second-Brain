"""What a job costs and how it would run — shared by the API's "Run later" and
by a trigger firing on its own (source added, a schedule).

One function decides the price mode (batch / normal / local) and the number
shown; both callers use it, so a trigger never charges more than the number a
person would have seen for the same click.
"""
from __future__ import annotations

from services.ai.providers import Provider
from services.ai.router import pick
from services.agent.skills import Skill
from services.jobs import batch
from services.workspace import skill_run


class QueueError(ValueError):
    """A reason a person can read: why this skill cannot be queued right now."""


def eligible_skill(name: str) -> Skill | None:
    """A skill that can run unattended: it writes a document from the note's
    sources and needs no person. Selection skills edit the user's own text, so
    they stay live."""
    skill = skill_run.registry().get(name)
    if (skill is None or not skill.output
            or skill.output in skill_run.SELECTION_OUTPUTS
            or not (skill_run.CHAT_SURFACES & set(skill.surfaces))):
        return None
    return skill


def price(user_id: str, note_id: str, skill: Skill, focus: str = "") -> dict:
    """The decision a queued job is built from: mode, model, the price shown,
    and the live price it is judged against. Raises QueueError with the
    reason when the skill cannot run on this note right now."""
    priced = next((j for j in skill_run.chat_skills(note_id, user_id)
                   if j.get("skill") == skill.name), None) or {}
    if priced.get("runnable"):
        raise QueueError(f"{skill_run.job_title(skill.name)}: {priced['runnable']}.")
    provider: Provider | None = pick("summarize_text", user_id)
    live = priced.get("usd")
    if provider and provider.provider == "local":
        mode = "local"
    elif (batch.adapter_for(provider)
          and skill_run.batch_eligible(skill.name, len(skill_run.ready_sources(note_id)), focus)):
        mode = "batch"
    else:
        mode = "normal"
    shown = round(live * batch.DISCOUNT, 6) if mode == "batch" and live is not None else live
    return {"provider": provider, "price_mode": mode, "usd": shown, "live_usd": live,
            "model": priced.get("model")}
