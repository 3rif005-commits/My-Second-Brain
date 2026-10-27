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
from pathlib import Path

import yaml
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from routers.ingest import get_user_id
from services.agent.skills import Skill, SkillRegistry

router = APIRouter(prefix="/skills", tags=["skills"])

from prompts._skill_text import SKILLS_DIR as _BUNDLED_SKILLS_DIR  # noqa: E402
from services import skill_store  # noqa: E402


def _user_dir() -> Path:
    """The signed-in user's own skills, as a folder rebuilt from the database
    (services/skill_store.py) — get_user_id set the user. Written only through
    skill_store; never a folder shared between accounts."""
    return skill_store.user_skills_dir()


def _saving(fn, *args, **kwargs):
    """Run a skill_store write, turning its refusals into HTTP answers."""
    try:
        return fn(*args, **kwargs)
    except skill_store.SkillsUnavailable as e:
        raise HTTPException(409, detail=str(e)) from None
    except skill_store.SkillRejected as e:
        raise HTTPException(400, detail=str(e)) from None

_SAFE_NAME = re.compile(r"^[a-z0-9][a-z0-9\-]{1,62}$")
WHERE = ("chat", "selection", "assistant")
#: what a selection skill may do with its result — the only kind that has a
#: choice (a job always drafts a note; an assistant rule only shapes replies)
SELECTION_OUTPUTS = ("insert_below", "rewrite_selection")
#: where a skill keeps its reference files (both spellings exist on disk)
REF_DIRS = ("reference", "references")
_SAFE_FILE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-]{0,80}\.(md|txt)$")


def _where(s: Skill) -> str:
    if "selection" in s.surfaces:
        return "selection"
    if s.output and {"workspace", "chat"} & set(s.surfaces):
        return "chat"
    return "assistant"


def _surfaces_for(where: str, current: Skill | None,
                  output: str | None = None) -> tuple[list[str], str | None]:
    if where == "selection":
        if output in SELECTION_OUTPUTS:
            return ["selection"], output
        out = current.output if current and current.output in SELECTION_OUTPUTS else "insert_below"
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


def _files(name: str) -> list[str]:
    """Reference files of a skill, built-in and edited copies together — and
    always its "Your style" file (E12), which every skill reads."""
    from prompts._skill_text import STYLE_FILE
    found: set[str] = {STYLE_FILE}
    for root in (_BUNDLED_SKILLS_DIR / name, _user_dir() / name):
        for d in REF_DIRS:
            if (root / d).is_dir():
                found |= {f"{d}/{p.name}" for p in (root / d).iterdir()
                          if p.is_file() and _SAFE_FILE.match(p.name)}
    return sorted(found)


def _file_path(name: str, rel: str) -> Path:
    """Where a reference file is read from: the user's copy, else the
    built-in. Only a file the skill already has — the runtime reads those by
    name, so a new file would be one nothing uses."""
    if not _SAFE_NAME.match(name):
        raise HTTPException(400, detail="bad skill name")
    parts = rel.split("/")
    if len(parts) != 2 or parts[0] not in REF_DIRS or not _SAFE_FILE.match(parts[1]):
        raise HTTPException(400, detail="not a reference file of this skill")
    if rel not in _files(name):
        raise HTTPException(404, detail=f"'{rel}' is not a file of '{name}'")
    user = _user_dir() / name / rel
    bundled = _BUNDLED_SKILLS_DIR / name / rel
    return user if user.exists() else bundled


def _json(s: Skill, bundled: set[str], user: set[str]) -> dict:
    # A built-in counts as edited when the user's folder holds anything of it:
    # its instructions or only one of its reference files.
    if s.name in bundled and (s.name in user or (_user_dir() / s.name).exists()):
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
        "icon": s.icon,
        "files": _files(s.name),
        "source": source,
        # builtin | user | assistant | installed — what the skill may do
        # depends on it (services/agent/skills.py, Skill.trusted).
        "origin": s.origin,
        "can_reset": source == "edited",
        "can_delete": source == "user",
        # The study guide only — None hides the setting for every other skill.
        "multi_source": (s.multi_source or "auto") if s.name == MULTI_SOURCE_SKILL else None,
        # Old clients read these.
        "readonly": False,
        "tools": list(s.tools) if s.tools else None,
        "priority": s.priority,
    }


def _state() -> tuple[SkillRegistry, set[str], set[str]]:
    bundled = set(SkillRegistry.load([_BUNDLED_SKILLS_DIR]).names())
    mine = _user_dir()
    user = set(SkillRegistry.load([mine]).names())
    reg = SkillRegistry.load([_BUNDLED_SKILLS_DIR, mine])
    return reg, bundled, user


#: The one skill whose "Several sources" setting the runtime honours (E9).
MULTI_SOURCE_SKILL = "study-guide"
MULTI_SOURCE = ("auto", "single", "chapters")


def _write_user_skill(user_id: str, name: str, description: str, body: str, where: str,
                      base: Skill | None, icon: str | None = None,
                      output: str | None = None,
                      multi_source: str | None = None) -> None:
    surfaces, output = _surfaces_for(where, base, output)
    meta: dict = {"name": name, "description": description.strip()}
    icon = icon if icon is not None else (base.icon if base else None)
    if icon:
        meta["icon"] = icon
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
    ms = multi_source or (base.multi_source if base else None)
    if name == MULTI_SOURCE_SKILL and ms and ms != "auto":
        meta["multi_source"] = ms
    fm = yaml.safe_dump(meta, sort_keys=False, default_flow_style=None).strip()
    _saving(skill_store.put_files, user_id, name, {"SKILL.md": f"---\n{fm}\n---\n\n{body}\n"})


class SkillPayload(BaseModel):
    description: str
    body: str
    where: str | None = None
    icon: str | None = None
    #: selection skills only: "insert_below" or "rewrite_selection"
    output: str | None = None
    #: the study guide only: "auto" | "single" | "chapters" (E9)
    multi_source: str | None = None
    # Accepted from old clients, ignored.
    tools: list[str] | None = None
    priority: int = 0


class CreateSkillPayload(SkillPayload):
    name: str


def _check_output(where: str, output: str | None) -> None:
    """A result the skill's kind cannot have is refused, not silently stored."""
    if output is None:
        return
    allowed = SELECTION_OUTPUTS if where == "selection" else ("draft_note",) if where == "chat" else ()
    if output not in allowed:
        raise HTTPException(400, detail=f"a '{where}' skill cannot have the result '{output}'")


class FilePayload(BaseModel):
    content: str


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
    from prompts._skill_text import with_style
    return {"skills": [{"name": s.name, "description": s.description,
                        "output": s.output, "prompt": with_style(s.name, s.body)}
                       for s in selection_skills()]}


@router.get("/{name}/original")
def get_original(name: str, authorization: str = Header()):
    """The built-in version of an edited skill, to compare against."""
    get_user_id(authorization)
    _, bundled, _ = _state()
    if name not in bundled or not (_user_dir() / name).exists():
        raise HTTPException(404, detail=f"'{name}' has no edited version to compare")
    orig = SkillRegistry.load([_BUNDLED_SKILLS_DIR]).get(name)
    return {"name": name, "description": orig.description,
            "body": _raw_body(orig.source_path), "output": orig.output}


@router.get("/{name}/files/{rel:path}")
def read_file(name: str, rel: str, authorization: str = Header()):
    get_user_id(authorization)
    src = _file_path(name, rel)
    if not src.exists():
        # A "Your style" file nobody wrote yet: its explanation, nothing sent.
        from prompts._skill_text import STYLE_TEMPLATE
        return {"path": rel, "content": STYLE_TEMPLATE}
    return {"path": rel, "content": src.read_text(encoding="utf-8")}


@router.put("/{name}/files/{rel:path}")
def write_file(name: str, rel: str, payload: FilePayload, authorization: str = Header()):
    """Save the user's copy of a reference file; the built-in stays as it is
    and Reset (DELETE /skills/{name}) brings it back."""
    user_id = get_user_id(authorization)
    _file_path(name, rel)
    _saving(skill_store.put_files, user_id, name, {rel: payload.content})
    return {"path": rel, "content": payload.content}


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
    user_id = get_user_id(authorization)
    if not _SAFE_NAME.match(payload.name):
        raise HTTPException(400, detail="name must be lowercase-kebab-case, 2–63 chars")
    where = payload.where or "assistant"
    if where not in WHERE:
        raise HTTPException(400, detail=f"where must be one of {', '.join(WHERE)}")
    reg, bundled, user = _state()
    if reg.get(payload.name) is not None:
        raise HTTPException(409, detail=f"Skill '{payload.name}' already exists")
    _check_output(where, payload.output)
    _write_user_skill(user_id, payload.name, payload.description, payload.body, where, None,
                      icon=payload.icon, output=payload.output)
    reg, bundled, user = _state()
    return _json(reg.get(payload.name), bundled, user)


@router.put("/{name}")
def update_skill(name: str, payload: SkillPayload, authorization: str = Header()):
    """Save the user's version. For a built-in skill this is a copy that
    overrides it; Reset (DELETE) brings the original back."""
    user_id = get_user_id(authorization)
    if not _SAFE_NAME.match(name):
        raise HTTPException(400, detail="bad skill name")
    reg, bundled, user = _state()
    current = reg.get(name)
    if current is None:
        raise HTTPException(404, detail=f"Skill '{name}' not found")
    where = payload.where or _where(current)
    if where not in WHERE:
        raise HTTPException(400, detail=f"where must be one of {', '.join(WHERE)}")
    _check_output(where, payload.output)
    if payload.multi_source is not None:
        if name != MULTI_SOURCE_SKILL:
            raise HTTPException(400, detail="only the study guide has this setting")
        if payload.multi_source not in MULTI_SOURCE:
            raise HTTPException(400, detail=f"must be one of {', '.join(MULTI_SOURCE)}")
    _write_user_skill(user_id, name, payload.description, payload.body, where, current,
                      icon=payload.icon, output=payload.output,
                      multi_source=payload.multi_source)
    reg, bundled, user = _state()
    return _json(reg.get(name), bundled, user)


@router.post("/{name}/learn-style")
def learn_style(name: str, authorization: str = Header()):
    """Suggest style preferences from how the user edited this skill's
    results (E12) — any job whose result goes into a note. Suggestions only:
    the user accepts each into its reference/style.md."""
    user_id = get_user_id(authorization)
    reg, _, _ = _state()
    skill = reg.get(name)
    if skill is None:
        raise HTTPException(404, detail=f"Skill '{name}' not found")
    if _where(skill) != "chat":
        raise HTTPException(400, detail="only a job's results go into notes to learn from")
    from prompts._skill_text import skill_style
    from services.workspace import style_learning
    try:
        pairs = style_learning.gather_pairs(user_id, skill=name)
    except Exception as e:                          # noqa: BLE001
        if "ai_outputs" in str(e):
            return {"pairs": 0, "suggestions": [],
                    "reason": "Apply supabase/migrations/022_ai_outputs.sql first."}
        raise
    if not pairs:
        return {"pairs": 0, "suggestions": [],
                "reason": "No edited results yet. Put one in a note, "
                          "edit it your way, then come back."}
    suggestions = style_learning.learn_from_pairs(pairs, skill_style(name), user_id)
    return {"pairs": len(pairs), "suggestions": suggestions,
            "reason": None if suggestions else "Your edits show no consistent preference yet."}


@router.delete("/{name}", status_code=204)
def delete_skill(name: str, authorization: str = Header()):
    """Reset an edited built-in (the copy goes, the original is back), or
    delete a skill the user created. A built-in itself cannot be deleted."""
    user_id = get_user_id(authorization)
    if not _SAFE_NAME.match(name):
        raise HTTPException(400, detail="bad skill name")
    if not (_user_dir() / name).exists():
        _, bundled, _ = _state()
        if name in bundled:
            raise HTTPException(403, detail="Built-in skills cannot be deleted")
        raise HTTPException(404, detail=f"User skill '{name}' not found")
    _saving(skill_store.delete, user_id, name)
