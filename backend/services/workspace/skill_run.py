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
from datetime import datetime, timezone
from pathlib import Path

from core.config import settings
from prompts.note_synthesis import TOTAL_SOURCE_BUDGET, _source_block, split_budget
from services.agent.skills import Skill, SkillRegistry
from services.ai import budget as budget_guard
from services.ai import usage as usage_log
from services.ai.pricing import estimate_usd, tokens_from_chars
from services.ai.router import complete_with_fallback, pick
from services.ai.client import last_call_truncated
from services.workspace.md_to_blocks import TRUNCATION_NOTICE_MD, markdown_to_html
from services.workspace.synthesis import (
    OUTPUT_CAP, _strip_fences, _write, ready_sources, source_text_from_chunks,
)

logger = logging.getLogger(__name__)

SKILLS_DIR = Path(__file__).resolve().parent.parent.parent / "skills"
WORKSPACE_SURFACE = "workspace"


def registry() -> SkillRegistry:
    user_dir = Path.home() / ".secondbrain" / "skills"
    return SkillRegistry.load([SKILLS_DIR, user_dir])


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
    """Drop the extractor's ID column (DEF-01, C-02, INS-06…) from its tables.

    The IDs are bookkeeping for the extraction, and a model shown them writes
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
    return (f"{skill.body}\n\n"
            f"---\nSOURCE MATERIAL — {len(sources)} source(s) attached:\n\n"
            + "\n".join(blocks)
            + "\n---\n\nWrite it now:")


def _blocks_for(note_id: str) -> tuple[list[dict], list[str]]:
    sources = ready_sources(note_id)
    blocks = [{"title": s["title"], "kind": s["kind"],
               "text": source_text_from_chunks(s["id"]),
               "duration": (s.get("meta") or {}).get("duration")}
              for s in sources]
    return blocks, [s["id"] for s in sources]


def estimate(note_id: str, user_id: str, skill: Skill) -> dict:
    """What this skill would cost on this note. No model call."""
    blocks, source_ids = _blocks_for(note_id)
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
        "runnable": _runnable(skill, len(source_ids)),
    }


def _runnable(skill: Skill, source_count: int) -> str | None:
    """Why this skill cannot run right now, or None if it can."""
    if source_count == 0:
        return "no sources are ready yet"
    if skill.name == "compare-sources" and source_count < 2:
        return "comparing needs at least two sources"
    return None


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
        _write(note_id, user_id, {"status": "failed", "source_ids": source_ids,
                                  "error": str(e)[:500]})
