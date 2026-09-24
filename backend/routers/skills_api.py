"""Settings → Skills: every skill the app runs, readable and editable.

User decision (2026-09-24): every skill is listed — the built-in folder skills
(study guide, compare sources, define terms…) as well as the old single-file
ones. Editing a built-in saves the user's own copy, which wins over the
original; Reset deletes the copy and the original is back. A skill has one
plain "where it runs":

  chat       — a job in the workspace chat (/name) and the editor's "/" menu
  selection  — an action in the AI menu over selected text
  assistant  — instructions the chat assistant follows when relevant

User copies and user skills are folders: <name>/SKILL.md, with the frontmatter
the registry reads.
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

import yaml
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from routers.ingest import get_user_id
from services.agent.skills import Skill, SkillRegistry

router = APIRouter(prefix="/skills", tags=["skills"])

from prompts._skill_text import SKILLS_DIR as _BUNDLED_SKILLS_DIR  # noqa: E402
from prompts._skill_text import USER_SKILLS_DIR as _USER_SKILLS_DIR  # noqa: E402

_SAFE_NAME = re.compile(r"^[a-z0-9][a-z0-9\-]{1,62}$")
WHERE = ("chat", "selection", "assistant")


def _where(s: Skill) -> str:
    if "selection" in s.surfaces:
        return "selection"
    if s.output and {"workspace", "chat"} & set(s.surfaces):
        return "chat"
    return "assistant"


def _surfaces_for(where: str, current: Skill | None) -> tuple[list[str], str | None]:
    if where == "selection":
        out = current.output if current and current.output in ("insert_below", "rewrite_selection") else "insert_below"
        return ["selection"], out
    if where == "chat":
        return ["workspace"], (current.output if current and current.output == "draft_note" else "draft_note")
    return [], None


def _raw_body(path: Path) -> str:
    """The body exactly as on disk — the registry strips whitespace, and a
    prompt saved back unchanged must stay byte-identical."""
    raw = path.read_text(encoding="utf-8")
    m = re.match(r"^---\s*\n.*?\n---\s*\n(.*)", raw, re.DOTALL)
    body = m.group(1) if m else raw
    if body.startswith("\n"):
        body = body[1:]
    return body[:-1] if body.endswith("\n") else body


def _json(s: Skill, bundled: set[str], user: set[str]) -> dict:
    if s.name in user and s.name in bundled:
        source = "edited"
    elif s.name in user:
        source = "user"
    else:
        source = "bundled"
    return {
        "name": s.name,
        "title": s.name.replace("-", " ").capitalize(),
        "description": s.description,
        "body": _raw_body(s.source_path),
        "where": _where(s),
        "output": s.output,
        "source": source,
        "can_reset": source == "edited",
        "can_delete": source == "user",
        # Old clients read these.
        "readonly": False,
        "tools": list(s.tools) if s.tools else None,
        "priority": s.priority,
    }


def _state() -> tuple[SkillRegistry, set[str], set[str]]:
    bundled = set(SkillRegistry.load([_BUNDLED_SKILLS_DIR]).names())
    user = set(SkillRegistry.load([_USER_SKILLS_DIR]).names()) if _USER_SKILLS_DIR.exists() else set()
    reg = SkillRegistry.load([_BUNDLED_SKILLS_DIR, _USER_SKILLS_DIR])
    return reg, bundled, user


def _write_user_skill(name: str, description: str, body: str, where: str,
                      base: Skill | None) -> None:
    surfaces, output = _surfaces_for(where, base)
    meta: dict = {"name": name, "description": description.strip()}
    if surfaces:
        meta["surfaces"] = surfaces
    if base and base.inputs:
        meta["inputs"] = base.inputs
    elif where == "chat":
        meta["inputs"] = "sources"
    elif where == "selection":
        meta["inputs"] = "selection"
    if output:
        meta["output"] = output
    meta["model_tier"] = base.model_tier if base and base.model_tier else "standard"
    meta["auto"] = False
    meta["confirm"] = base.confirm if base else (where == "chat")
    if base and base.priority:
        meta["priority"] = base.priority
    if base and base.tools:
        meta["tools"] = list(base.tools)
    folder = _USER_SKILLS_DIR / name
    folder.mkdir(parents=True, exist_ok=True)
    fm = yaml.safe_dump(meta, sort_keys=False, default_flow_style=None).strip()
    (folder / "SKILL.md").write_text(f"---\n{fm}\n---\n\n{body}\n", encoding="utf-8")
    legacy = _USER_SKILLS_DIR / f"{name}.md"        # an old single-file copy
    if legacy.exists():
        legacy.unlink()


class SkillPayload(BaseModel):
    description: str
    body: str
    where: str | None = None
    # Accepted from old clients, ignored.
    tools: list[str] | None = None
    priority: int = 0


class CreateSkillPayload(SkillPayload):
    name: str


@router.get("")
def list_skills(authorization: str = Header()):
    get_user_id(authorization)
    reg, bundled, user = _state()
    order = {"chat": 0, "selection": 1, "assistant": 2}
    skills = sorted(reg.all(), key=lambda s: (order[_where(s)], s.name))
    return {"skills": [_json(s, bundled, user) for s in skills]}


@router.get("/surface/selection")
def list_selection_skills(authorization: str = Header()):
    """What the editor's selection menu offers. The body travels with it: the
    menu sends it as the prompt through the same logged, budgeted passthrough
    every other editor AI request uses, so there is no second model path."""
    get_user_id(authorization)
    from services.workspace.skill_run import selection_skills
    return {"skills": [{"name": s.name, "description": s.description,
                        "output": s.output, "prompt": s.body}
                       for s in selection_skills()]}


@router.get("/{name}")
def get_skill(name: str, authorization: str = Header()):
    get_user_id(authorization)
    reg, bundled, user = _state()
    s = reg.get(name)
    if s is None:
        raise HTTPException(404, detail=f"Skill '{name}' not found")
    return _json(s, bundled, user)


@router.post("", status_code=201)
def create_skill(payload: CreateSkillPayload, authorization: str = Header()):
    get_user_id(authorization)
    if not _SAFE_NAME.match(payload.name):
        raise HTTPException(400, detail="name must be lowercase-kebab-case, 2–63 chars")
    where = payload.where or "assistant"
    if where not in WHERE:
        raise HTTPException(400, detail=f"where must be one of {', '.join(WHERE)}")
    reg, bundled, user = _state()
    if reg.get(payload.name) is not None:
        raise HTTPException(409, detail=f"Skill '{payload.name}' already exists")
    _write_user_skill(payload.name, payload.description, payload.body, where, None)
    reg, bundled, user = _state()
    return _json(reg.get(payload.name), bundled, user)


@router.put("/{name}")
def update_skill(name: str, payload: SkillPayload, authorization: str = Header()):
    """Save the user's version. For a built-in skill this is a copy that
    overrides it; Reset (DELETE) brings the original back."""
    get_user_id(authorization)
    if not _SAFE_NAME.match(name):
        raise HTTPException(400, detail="bad skill name")
    reg, bundled, user = _state()
    current = reg.get(name)
    if current is None:
        raise HTTPException(404, detail=f"Skill '{name}' not found")
    where = payload.where or _where(current)
    if where not in WHERE:
        raise HTTPException(400, detail=f"where must be one of {', '.join(WHERE)}")
    _write_user_skill(name, payload.description, payload.body, where, current)
    reg, bundled, user = _state()
    return _json(reg.get(name), bundled, user)


@router.delete("/{name}", status_code=204)
def delete_skill(name: str, authorization: str = Header()):
    """Reset an edited built-in (the copy goes, the original is back), or
    delete a skill the user created. A built-in itself cannot be deleted."""
    get_user_id(authorization)
    if not _SAFE_NAME.match(name):
        raise HTTPException(400, detail="bad skill name")
    folder, legacy = _USER_SKILLS_DIR / name, _USER_SKILLS_DIR / f"{name}.md"
    if not folder.exists() and not legacy.exists():
        reg, bundled, _ = _state()
        if name in bundled:
            raise HTTPException(403, detail="Built-in skills cannot be deleted")
        raise HTTPException(404, detail=f"User skill '{name}' not found")
    if folder.exists():
        shutil.rmtree(folder)
    if legacy.exists():
        legacy.unlink()
