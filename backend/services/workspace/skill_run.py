"""Run a skill over a note's sources.

Until now the workspace could do exactly one job: write a mastery guide. The
prompt for it lives in Python, the trigger lives in the settle guard, and
nothing else could ever be offered. This is the generic version — a skill's
body is the instruction, the note's sources are the material, and the result
lands in the same `note_synthesis` row the editor already knows how to apply.

Reusing that row is deliberate. The draft/apply flow, the replace-vs-append
dialog, the stale-draft guard and the anchor handling were all debugged the
hard way; a second parallel path would have to earn them again.

The existing mastery-guide synthesis is NOT routed through here yet: its prompt
file has uncommitted edits, and quietly rewiring a file someone is editing is
how work gets lost.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from core.config import settings
from prompts.note_synthesis import TOTAL_SOURCE_BUDGET, _source_block, split_budget
from services import privacy
from services.agent.skills import Skill, SkillRegistry
from services.ai import budget as budget_guard
from services.ai import usage as usage_log
from services.ai.pricing import estimate_usd, tokens_from_chars
from services.ai.router import complete_with_fallback, pick
from services.ai.client import last_call_truncated
from services.workspace.md_to_blocks import TRUNCATION_NOTICE_MD, markdown_to_html
from services.database import get_supabase
from services.workspace.synthesis import (
    OUTPUT_CAP, _strip_fences, _write, ready_sources, source_text_from_chunks,
)

logger = logging.getLogger(__name__)

SKILLS_DIR = Path(__file__).resolve().parent.parent.parent / "skills"
WORKSPACE_SURFACE = "workspace"


def registry() -> SkillRegistry:
    # The user's copies (Settings → Skills) override the built-ins.
    from prompts import _skill_text
    return SkillRegistry.load([_skill_text.SKILLS_DIR, _skill_text.user_skills_dir()])


def workspace_skills() -> list[Skill]:
    """The skills a workspace may offer as an action, best first.

    Declaring an `output` is the requirement, not the surface: a skill with no
    output is an instruction for the agent — cite-everything shapes how it
    answers — and there is nowhere for the workspace to put its result. Those
    stay available to the agent and out of the action bar.
    """
    return sorted((s for s in registry().for_surface(WORKSPACE_SURFACE) if s.output),
                  key=lambda s: (-s.priority, s.name))


#: What a selection skill may do with the selected text. Anything else has no
#: place in the editor's selection menu: a `draft_note` replaces a whole note.
SELECTION_OUTPUTS = ("insert_below", "rewrite_selection")


def selection_skills() -> list[Skill]:
    """Skills the editor's selection menu may offer, best first.

    Only skills that ASK for the selection surface: a skill with no
    `surfaces` is offered "anywhere" by the registry, which is right for an
    agent instruction and wrong for a button that edits the user's text.
    """
    return sorted((s for s in registry().all()
                   if "selection" in s.surfaces and s.output in SELECTION_OUTPUTS),
                  key=lambda s: (-s.priority, s.name))


_ID_HEADER = re.compile(r"^\|\s*ID\s*\|")
_ID_CELL = re.compile(r"^\|\s*[A-Z]{1,8}-\d{2,3}\s*\|")
_SEPARATOR_CELL = re.compile(r"^\|\s*:?-{3,}:?\s*\|")


def strip_extraction_ids(text: str) -> str:
    """Drop an ID column (DEF-01, C-02, INS-06…) from a source's tables.

    Some sources — AI-generated study guides especially — number every item,
    and a model shown those IDs writes
    them into prose ("Source 2 explicitly states INS-06"). Telling it not to
    did nothing (E14: 1/5 leaked before and after); removing them is the fix
    that cannot be ignored. Only a table whose header starts `|ID|` loses its
    first column, so any other table is left exactly as it was.
    """
    out, in_id_table = [], False
    for line in text.split("\n"):
        if _ID_HEADER.match(line):
            in_id_table = True
            out.append(_ID_HEADER.sub("|", line, count=1))
            continue
        if in_id_table and _SEPARATOR_CELL.match(line):
            out.append(_SEPARATOR_CELL.sub("|", line, count=1))
            continue
        if in_id_table and _ID_CELL.match(line):
            out.append(_ID_CELL.sub("|", line, count=1))
            continue
        if not line.startswith("|"):
            in_id_table = False
        out.append(line)
    return "\n".join(out)


def build_prompt(skill: Skill, sources: list[dict],
                 total_budget: int = TOTAL_SOURCE_BUDGET) -> str:
    """The skill's body, then the same source blocks every other job gets."""
    budgets = split_budget([len((s.get("text") or "").strip()) for s in sources],
                           total_budget)
    sources = [{**s, "text": strip_extraction_ids(s.get("text") or "")}
               for s in sources]
    blocks = [_source_block(i, s, b)
              for i, (s, b) in enumerate(zip(sources, budgets), start=1)]
    from prompts._skill_text import style_block, style_reminder
    # The user's own style for this skill follows its instructions and is
    # repeated at the very end (E12); nothing when they wrote none.
    return (f"{skill.body}{style_block(skill.name)}\n\n"
            f"---\nSOURCE MATERIAL — {len(sources)} source(s) attached:\n\n"
            + "\n".join(blocks)
            + "\n---\n\nWrite it now:" + style_reminder(skill.name))


def _blocks_for(note_id: str) -> tuple[list[dict], list[str]]:
    sources = ready_sources(note_id)
    blocks = [{"title": s["title"], "kind": s["kind"],
               "text": source_text_from_chunks(s["id"]),
               "duration": (s.get("meta") or {}).get("duration")}
              for s in sources]
    return blocks, [s["id"] for s in sources]


@privacy.reads_note
def estimate(note_id: str, user_id: str, skill: Skill,
             loaded: tuple[list[dict], list[str]] | None = None) -> dict:
    """What this skill would cost on this note. No model call. `loaded` is the
    note's (blocks, source_ids) when the caller already read them."""
    blocks, source_ids = loaded or _blocks_for(note_id)
    prompt_chars = len(build_prompt(skill, blocks))
    # Skills that write a whole note produce far more than ones that answer a
    # question; the ceiling is the honest figure to show before the click.
    output_chars = 40_000 if skill.output == "draft_note" else 8_000
    input_tokens = tokens_from_chars(prompt_chars)
    output_tokens = tokens_from_chars(output_chars)
    provider = pick("summarize_text", user_id)
    model = provider.model if provider else None
    return {
        "skill": skill.name,
        "description": skill.description,
        "output": skill.output,
        "confirm": skill.confirm,
        "ready_sources": len(source_ids),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "model": model,
        "usd": estimate_usd(model, input_tokens, output_tokens),
        "runnable": _runnable(skill, len(source_ids),
                              _unready(note_id) if len(source_ids) < 2 else ()),
    }


def _unready(note_id: str) -> list[dict]:
    """The note's sources that are not ready, with their state."""
    rows = (get_supabase().table("note_resources").select("title,status")
            .eq("note_id", note_id).neq("status", "ready")
            .order("order_index").execute().data or [])
    return rows


def _runnable(skill: Skill, source_count: int,
              unready: list[dict] | tuple = ()) -> str | None:
    """Why this skill cannot run right now, or None if it can.

    When a source is the reason, name it. "Comparing needs at least two
    sources" on a note with two sources — one of which FAILED processing — sent
    the user looking for a second source they had already added (seen live).
    """
    needed = 2 if skill.name == "compare-sources" else 1
    if source_count >= needed:
        return None
    failed = [u for u in unready if u.get("status") == "failed"]
    if failed:
        return f'"{failed[0].get("title") or "a source"}" failed to process — retry or remove it'
    if unready:
        return f'waiting for "{unready[0].get("title") or "a source"}" to finish processing'
    if source_count == 0:
        return "no sources are ready yet"
    return "comparing needs at least two sources"


@privacy.reads_note
def run_skill(note_id: str, user_id: str, skill_name: str,
              mode: str = "replace") -> None:
    """Run one skill over the note's sources and leave a draft behind.

    Failures are recorded on the synthesis row rather than raised: the client
    polls that row, and an exception here would leave it spinning forever.
    """
    skill = registry().get(skill_name)
    if skill is None:
        _write(note_id, user_id, {"status": "failed", "source_ids": [],
                                  "error": f"No skill named {skill_name!r}."})
        return

    blocks, source_ids = _blocks_for(note_id)
    blocked = _runnable(skill, len(source_ids))
    if blocked:
        _write(note_id, user_id, {"status": "failed", "source_ids": source_ids,
                                  "error": f"{skill.name}: {blocked}."})
        return

    _write(note_id, user_id, {"status": "running", "error": None,
                              "source_ids": source_ids})
    try:
        prompt = build_prompt(skill, blocks)
        with usage_log.annotate(surface="workspace", job="skill",
                                skill=skill.name, trigger="user",
                                note_id=note_id, user_id=user_id), \
             budget_guard.limit(settings.max_usd_per_run or None):
            budget_guard.check(estimate(note_id, user_id, skill)["usd"],
                               what=f"Running {skill.name}")
            answer = _strip_fences(complete_with_fallback(
                "summarize_text", user_id,
                [{"role": "user", "content": prompt}], max_tokens=OUTPUT_CAP))

        if not answer.strip():
            raise RuntimeError("The model returned nothing.")
        if last_call_truncated():
            logger.warning(f"note {note_id}: {skill.name} hit the output cap")
            answer = answer.rstrip() + "\n\n" + TRUNCATION_NOTICE_MD

        # Skills speak Markdown; the editor speaks the HTML dialect. One
        # converter, the same one E6 measures, sits between them.
        html = markdown_to_html(answer)
        _write(note_id, user_id, {"status": "ready", "html": html, "error": None,
                                  "source_ids": source_ids,
                                  "title_suggestion": None})
        logger.info(f"note {note_id}: {skill.name} produced {len(html)} chars")
    except Exception as e:                          # noqa: BLE001
        logger.warning(f"note {note_id}: {skill.name} failed: {e}")
        # Prefixed with the job, like the blocked path above: the row is shared
        # with the study guide, and the client's Retry must rerun THIS job —
        # it used to rerun the study guide, a different job at a different price.
        _write(note_id, user_id, {"status": "failed", "source_ids": source_ids,
                                  "error": f"{skill.name}: {e}"[:500]})


# ── skills in the workspace chat ─────────────────────────────────────────────
#
# The workspace runs its jobs from the chat panel (user decision, 2026-09-24):
# `/study-guide`, `/flashcards`, `/compare-sources`, or the model picks one. A
# run produces a RESULT the chat shows as a preview card with Insert / Replace;
# nothing is written into the note or its draft row until the user clicks.

STUDY_GUIDE = "study-guide"
CHAT_SURFACES = {"workspace", "chat"}


def job_title(name: str) -> str:
    return name.replace("-", " ").capitalize()


#: (note, user, ready source ids, skills) -> (jobs, when). Pricing reads every
#: source's full text; the answer only changes when the ready sources or the
#: skills do, so a workspace page load no longer pays that read each time.
_CHAT_JOBS_CACHE: dict[tuple, tuple[list[dict], float]] = {}
CHAT_JOBS_TTL = 600


def chat_skills(note_id: str, user_id: str) -> list[dict]:
    """Every job the chat can run on this note, priced, best first."""
    import time
    skills = sorted((s for s in registry().all()
                     if s.output and CHAT_SURFACES & set(s.surfaces)),
                    key=lambda s: (-s.priority, s.name))
    ready_ids = tuple(sorted(str(r["id"]) for r in ready_sources(note_id)))
    key = (note_id, user_id, ready_ids,
           tuple((s.name, s.description, s.surfaces, s.output, s.priority) for s in skills))
    hit = _CHAT_JOBS_CACHE.get(key)
    if hit and time.time() - hit[1] < CHAT_JOBS_TTL:
        return hit[0]
    jobs = _price_chat_jobs(note_id, user_id, skills)
    if len(_CHAT_JOBS_CACHE) > 200:
        _CHAT_JOBS_CACHE.clear()
    _CHAT_JOBS_CACHE[key] = (jobs, time.time())
    return jobs


def _price_chat_jobs(note_id: str, user_id: str, skills: list[Skill]) -> list[dict]:
    out = []
    # The note's text is read ONCE and every job is priced from it (reading it
    # per job made the AI panel's list take seconds to appear).
    loaded = _blocks_for(note_id)
    blocks, source_ids = loaded
    for s in skills:
        if s.name == STUDY_GUIDE:
            from services.workspace import synthesis
            lengths = [len(b.get("text") or "") for b in blocks]
            allotted = split_budget(lengths) if lengths else []
            source_chars = sum(min(n, a) for n, a in zip(lengths, allotted))
            input_tokens = tokens_from_chars(source_chars + synthesis._prompt_overhead_chars())
            output_tokens = synthesis._expected_output_tokens(source_chars)
            provider = pick("summarize_text", user_id)
            model = provider.model if provider else None
            out.append({"skill": s.name, "title": job_title(s.name),
                        "description": s.description,
                        "usd": estimate_usd(model, input_tokens, output_tokens),
                        "input_tokens": input_tokens, "output_tokens": output_tokens,
                        "runnable": _runnable(s, len(source_ids),
                                              _unready(note_id) if not source_ids else ())})
        else:
            e = estimate(note_id, user_id, s, loaded)
            out.append({**e, "title": job_title(s.name)})
    return out


#: The first word after `/study-guide` can choose how a guide from several
#: sources is written, for this run only (E9): "/study-guide deep …".
METHOD_WORDS = {"deep": "chapters", "chapters": "chapters", "chaptered": "chapters",
                "quick": "single", "single": "single", "one-pass": "single"}


def split_method(focus: str) -> tuple[str | None, str]:
    """("chapters" | "single" | None, the rest of the focus)."""
    words = (focus or "").strip().split(maxsplit=1)
    if words and words[0].lower() in METHOD_WORDS:
        return METHOD_WORDS[words[0].lower()], (words[1] if len(words) > 1 else "")
    return None, (focus or "").strip()


def _focused(prompt: str, focus: str) -> str:
    focus = (focus or "").strip()
    if not focus:
        return prompt
    return (f"{prompt}\n\nTHE STUDENT'S REQUEST, in their words: {focus}\n"
            "Follow every instruction above, and shape the result around it.")


@privacy.reads_note
def produce_skill_result(note_id: str, user_id: str, name: str,
                         focus: str = "", trigger: str = "user") -> dict:
    """Run one skill over the note's sources and RETURN the result.

    Raises ValueError with a reason a person can read when the job cannot run
    (unknown skill, not enough sources, over budget). The study guide runs on
    its own HTML dialect path — the user's instructions, unchanged — and every
    other skill on the Markdown path the skills are written for.
    """
    from services.ai import usage as usage_log
    skill = registry().get(name)
    if skill is None or not skill.output:
        raise ValueError(f"No job named {name!r}.")
    blocks, source_ids = _blocks_for(note_id)
    blocked = _runnable(skill, len(source_ids))
    if blocked:
        raise ValueError(f"{job_title(name)}: {blocked}.")

    mark = len(usage_log.RECENT)
    with usage_log.annotate(surface="workspace", job="skill", skill=name,
                            trigger=trigger, note_id=note_id, user_id=user_id), \
         budget_guard.limit(settings.max_usd_per_run or None):
        if name == STUDY_GUIDE:
            from prompts.note_synthesis import build_note_synthesis_prompt
            from services.workspace import synthesis
            from services.workspace.guide_check import check_guide
            chosen, focus = split_method(focus)
            method = synthesis.resolve_method(len(blocks), chosen)
            budget_guard.check(synthesis.estimate_synthesis(note_id, user_id, method)["usd"],
                               what="Writing the study guide")
            prompt = _focused(build_note_synthesis_prompt(blocks), focus)
            # `sources` lets the guide be written chapter by chapter (E9) —
            # without it this, the AI panel's path, always wrote one call.
            html = synthesis._complete(prompt, [], True, user_id, sources=blocks,
                                       method=method, focus=focus)
            truncated = last_call_truncated()
            check = check_guide(html, blocks, truncated)
            if truncated:
                from services.workspace.md_to_blocks import TRUNCATION_NOTICE_HTML
                html += TRUNCATION_NOTICE_HTML
        else:
            budget_guard.check(estimate(note_id, user_id, skill)["usd"],
                               what=f"Running {job_title(name)}")
            answer = _strip_fences(complete_with_fallback(
                "summarize_text", user_id,
                [{"role": "user", "content": _focused(build_prompt(skill, blocks), focus)}],
                max_tokens=OUTPUT_CAP))
            truncated = last_call_truncated()
            if not answer.strip():
                raise ValueError("The model returned nothing.")
            if truncated:
                answer = answer.rstrip() + "\n\n" + TRUNCATION_NOTICE_MD
            html = markdown_to_html(answer)
            check, method = None, None

    rows = list(usage_log.RECENT)[mark:]
    spent = [r["estimated_usd"] for r in rows if r.get("estimated_usd") is not None]
    return {"skill": name, "title": job_title(name), "html": html,
            "source_ids": source_ids, "truncated": truncated,
            # study guide only: how it was written, and the quality check
            "method": method, "check": check,
            "input_tokens": sum(r.get("input_tokens") or 0 for r in rows),
            "output_tokens": sum(r.get("output_tokens") or 0 for r in rows),
            "usd": round(sum(spent), 4) if spent else None}



# ── one request, sent later ──────────────────────────────────────────────────
#
# A provider's batch API answers ONE request at half price, some time later.
# A job can use it only if it is a single call: a flat instruction plus the
# note's sources, one document back. `batch_call` builds exactly the request
# `produce_skill_result` would have sent live, and `finish_batch` turns the
# answer into the same result — so a batch result and a live one are the same
# thing to the card, the apply flow and Undo.

@dataclass
class BatchCall:
    messages: list[dict]
    max_tokens: int
    source_ids: list[str]


def batch_eligible(name: str, source_count: int, focus: str = "") -> bool:
    """Is this job a single call? A study guide from many sources is written
    chapter by chapter (several calls, each needing the last) — it cannot be
    one batch request, so it runs live at the normal price and says so."""
    skill = registry().get(name)
    if skill is None or not skill.output:
        return False
    if name == STUDY_GUIDE:
        from services.workspace import synthesis
        chosen, _ = split_method(focus)
        return synthesis.resolve_method(source_count, chosen) == "single"
    return True


@privacy.reads_note
def batch_call(note_id: str, user_id: str, name: str, focus: str = "") -> BatchCall | None:
    """The request the job would send now, or None when it cannot be one call.
    Raises ValueError, with a reason, when it cannot run at all."""
    skill = registry().get(name)
    if skill is None or not skill.output:
        raise ValueError(f"No job named {name!r}.")
    blocks, source_ids = _blocks_for(note_id)
    blocked = _runnable(skill, len(source_ids))
    if blocked:
        raise ValueError(f"{job_title(name)}: {blocked}.")
    if not batch_eligible(name, len(blocks), focus):
        return None
    if name == STUDY_GUIDE:
        from prompts.note_synthesis import build_note_synthesis_prompt
        from services.workspace import synthesis
        _, focus = split_method(focus)
        prompt = _focused(build_note_synthesis_prompt(blocks), focus)
        return BatchCall(synthesis.synthesis_messages(prompt), OUTPUT_CAP, source_ids)
    return BatchCall([{"role": "user", "content": _focused(build_prompt(skill, blocks), focus)}],
                     OUTPUT_CAP, source_ids)


def finish_batch(name: str, text: str, truncated: bool,
                 blocks: list[dict] | None = None) -> dict:
    """The answer to a batch request → the same fields `produce_skill_result`
    returns (html, truncated, method, check). Raises ValueError with a reason a
    person can read when the answer is unusable."""
    if name == STUDY_GUIDE:
        from services.workspace import synthesis
        from services.workspace.guide_check import check_guide
        from services.workspace.md_to_blocks import TRUNCATION_NOTICE_HTML
        html = _strip_fences(text)
        if not synthesis._looks_like_a_mastery_guide(html):
            raise ValueError("The answer was not a complete study guide. "
                             "Run it now to try again at the normal price.")
        check = check_guide(html, blocks, truncated) if blocks else None
        if truncated:
            html += TRUNCATION_NOTICE_HTML
        return {"html": html, "truncated": truncated, "method": "single", "check": check}
    answer = _strip_fences(text)
    if not answer.strip():
        raise ValueError("The model returned nothing.")
    if truncated:
        answer = answer.rstrip() + "\n\n" + TRUNCATION_NOTICE_MD
    return {"html": markdown_to_html(answer), "truncated": truncated, "method": None, "check": None}
