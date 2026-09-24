"""The Markdown variant of the note-synthesis prompt (experiment E6).

The shipped prompt asks for this app's own HTML dialect and runs to ~17KB of
instructions. This one asks for Markdown with a handful of fences — a format
every model has seen — and fits in about a tenth of that.

Two things change at once, which the experiment has to own rather than hide:
the OUTPUT FORMAT (HTML → Markdown) and the SPEC LENGTH (17KB → ~2KB). If the
variant wins, a follow-up has to separate them, because "Markdown is better"
and "our HTML spec is too long" are different conclusions with different fixes.

The source blocks are identical to the HTML variant's — same budget split, same
`[page N]` tags — so the input side of the comparison is unchanged.
"""
from __future__ import annotations

from prompts._skill_text import skill_reference

from prompts.note_synthesis import TOTAL_SOURCE_BUDGET, _source_block, split_budget

# The text lives in skills/study-guide/reference/markdown-variant.md; the
# constant is the text at import, prompts read it fresh (see mastery_guide).
MARKDOWN_SPEC = skill_reference("study-guide", "markdown-variant.md")


def build_markdown_synthesis_prompt(
    sources: list[dict],
    total_budget: int = TOTAL_SOURCE_BUDGET,
) -> str:
    budgets = split_budget([len((s.get("text") or "").strip()) for s in sources],
                           total_budget)
    blocks = [_source_block(i, s, b)
              for i, (s, b) in enumerate(zip(sources, budgets), start=1)]
    return f"""{skill_reference("study-guide", "markdown-variant.md")}

---
SOURCE MATERIAL — {len(sources)} source(s) attached to this note:

{chr(10).join(blocks)}
---

Write the synthesized study notes in Markdown now:"""

