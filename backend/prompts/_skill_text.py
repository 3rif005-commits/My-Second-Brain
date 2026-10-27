"""Read prompt text from the skill folders, byte for byte.

The study guide's instructions live in `skills/study-guide/`: SKILL.md is the
user's HTML instructions (what runs by default), reference/markdown-variant.md
the opt-in Markdown path. A user's edited copy (Settings →
Skills) wins over the built-in file; reset deletes the copy and the original
is back. The registry's loader strips whitespace; these readers do not, so the
prompt the model gets is exactly the text on disk.
"""
from __future__ import annotations

from pathlib import Path

SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"


def user_skills_dir() -> Path:
    """The current user's own skills (services/skill_store.py): their folder,
    rebuilt from the database; an empty one when no user is set. Never a
    folder shared between accounts."""
    from services.skill_store import user_skills_dir as _dir
    return _dir()


def _first(*paths: Path) -> Path:
    return next((p for p in paths if p.exists()), paths[-1])


def skill_body(name: str) -> str:
    path = _first(user_skills_dir() / name / "SKILL.md", SKILLS_DIR / name / "SKILL.md")
    raw = path.read_text(encoding="utf-8")
    _, _, body = raw.partition("\n---\n")          # after the frontmatter
    return body[1:-1]                               # the blank line, the final newline


def skill_reference(name: str, file: str) -> str:
    path = _first(user_skills_dir() / name / "reference" / file,
                  SKILLS_DIR / name / "reference" / file)
    return path.read_text(encoding="utf-8")[:-1]


def skill_meta(name: str) -> dict:
    """The skill's settings (frontmatter), read at call time like its body —
    a change in Settings → Skills applies to the next run."""
    import yaml
    path = _first(user_skills_dir() / name / "SKILL.md", SKILLS_DIR / name / "SKILL.md")
    raw = path.read_text(encoding="utf-8")
    head, sep, _ = raw.partition("\n---\n")
    if not sep or not head.startswith("---"):
        return {}
    return yaml.safe_load(head[3:]) or {}


#: Every skill's "Your style" file (E12, all skills since 2026-09-27).
STYLE_FILE = "reference/style.md"

#: What a skill's style file holds before the user writes anything. Comments
#: are never sent to the model.
STYLE_TEMPLATE = """<!--
Your style — your preferences for this skill, in your own words, one per line.
Example: "Keep answers under five bullet points."
These lines are added after the skill's instructions, which stay as they are.
Text inside these comment marks is never sent to the AI.
-->
"""

_STYLE_BLOCK = """

YOUR STUDENT'S OWN STYLE — requirements they wrote or accepted in Settings →
Skills. Apply every one of them; where one conflicts with the instructions
above, the student's requirement wins:
{style}
"""

_STYLE_REMINDER = """

Before you write, re-read the student's own style — the result must meet it:
{style}"""


def skill_style(name: str) -> str:
    """A skill's "Your style" lines, comments removed; "" when none. Read at
    call time — a save in Settings applies to the next run."""
    import re
    try:
        path = _first(user_skills_dir() / name / STYLE_FILE, SKILLS_DIR / name / STYLE_FILE)
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return ""
    return re.sub(r"<!--.*?-->", "", raw, flags=re.S).strip()


def style_block(name: str) -> str:
    """The style as a block that follows a skill's instructions ("" if none)."""
    style = skill_style(name)
    return _STYLE_BLOCK.format(style=style) if style else ""


def style_reminder(name: str) -> str:
    """The style again, for the very end of a prompt (E12: an additive
    preference read only mid-prompt reached 1 chapter in 11; restated last,
    9 in 9)."""
    style = skill_style(name)
    return _STYLE_REMINDER.format(style=style) if style else ""


def with_style(name: str, body: str) -> str:
    """A skill's instructions followed by the user's style for it."""
    return body + style_block(name)
