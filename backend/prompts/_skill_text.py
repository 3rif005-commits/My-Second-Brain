"""Read prompt text from the skill folders, byte for byte.

The study guide's instructions live in `skills/study-guide/`: SKILL.md is the
user's HTML instructions (what runs by default), reference/markdown-variant.md
the opt-in Markdown path. A user's edited copy in USER_SKILLS_DIR (Settings →
Skills) wins over the built-in file; reset deletes the copy and the original
is back. The registry's loader strips whitespace; these readers do not, so the
prompt the model gets is exactly the text on disk.
"""
from __future__ import annotations

from pathlib import Path

SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"
USER_SKILLS_DIR = Path.home() / ".secondbrain" / "skills"


def _first(*paths: Path) -> Path:
    return next((p for p in paths if p.exists()), paths[-1])


def skill_body(name: str) -> str:
    path = _first(USER_SKILLS_DIR / name / "SKILL.md", SKILLS_DIR / name / "SKILL.md")
    raw = path.read_text(encoding="utf-8")
    _, _, body = raw.partition("\n---\n")          # after the frontmatter
    return body[1:-1]                               # the blank line, the final newline


def skill_reference(name: str, file: str) -> str:
    path = _first(USER_SKILLS_DIR / name / "reference" / file,
                  SKILLS_DIR / name / "reference" / file)
    return path.read_text(encoding="utf-8")[:-1]
