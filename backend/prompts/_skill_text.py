"""Read prompt text from the skill folders, byte for byte.

The study guide's instructions live in `skills/study-guide/` — the Markdown
spec (the default path) as its SKILL.md body, the HTML dialect as a reference
file — so the one place a person edits a prompt is the skill, not a Python
string. The registry's loader strips whitespace; these readers do not, so the
prompt the model gets is exactly the text on disk.
"""
from __future__ import annotations

from pathlib import Path

SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"


def skill_body(name: str) -> str:
    raw = (SKILLS_DIR / name / "SKILL.md").read_text(encoding="utf-8")
    _, _, body = raw.partition("\n---\n")          # after the frontmatter
    return body[1:-1]                               # the blank line, the final newline


def skill_reference(name: str, file: str) -> str:
    return (SKILLS_DIR / name / "reference" / file).read_text(encoding="utf-8")[:-1]
