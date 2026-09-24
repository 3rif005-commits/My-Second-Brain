"""System + user prompt for generating BlockNote-compatible mastery guides."""
from prompts._skill_text import skill_body

# The text lives in skills/study-guide/SKILL.md (Settings → Skills).
SYSTEM_PROMPT = skill_body("study-guide")


def build_mastery_guide_prompt(source_text: str, title: str = "") -> str:
    title_line = f"Title: {title}\n\n" if title else ""
    return f"""{SYSTEM_PROMPT}

---
{title_line}SOURCE MATERIAL:
{source_text[:20000]}
---

Generate the mastery guide HTML now:"""
