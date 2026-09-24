"""System + user prompt for generating BlockNote-compatible mastery guides."""
from prompts._skill_text import skill_reference

# The text lives in skills/study-guide/reference/html-dialect.md — edit it there.
SYSTEM_PROMPT = skill_reference("study-guide", "html-dialect.md")


def build_mastery_guide_prompt(source_text: str, title: str = "") -> str:
    title_line = f"Title: {title}\n\n" if title else ""
    return f"""{SYSTEM_PROMPT}

---
{title_line}SOURCE MATERIAL:
{source_text[:20000]}
---

Generate the mastery guide HTML now:"""
