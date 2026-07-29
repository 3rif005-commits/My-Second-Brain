"""Workspace resource summary prompt.

Reuses the core mastery-guide system prompt (the app's canonical note style:
senior-student voice, source-order sections, overview callout + deep-dive toggle)
and extends it with what workspaces need: per-section sync anchors and
per-source-type input framing.
"""
from __future__ import annotations

from prompts.mastery_guide import SYSTEM_PROMPT as MASTERY_SYSTEM_PROMPT

ANCHOR_EXTENSION = """
WORKSPACE SYNC ANCHORS (mandatory for this note):
This note will be displayed side-by-side with its source and kept in sync.
Every <h2> section header MUST carry a data-anchor attribute that points to
where that section starts in the source:

- Video / audio source (input lines are prefixed [mm:ss] or [h:mm:ss]):
    <h2 data-importance="4" data-anchor="t:SECONDS">...</h2>
  SECONDS is the timestamp (in seconds, may be fractional) where the section's
  material begins. Use the timestamps from the input prefixes.

- Document / PDF source (input is tagged [page N]):
    <h2 data-importance="4" data-anchor="p:PAGE">...</h2>
  PAGE is the 1-based page number where the section's material begins.

- Website source (input is tagged [section N]):
    <h2 data-importance="4" data-anchor="s:INDEX">...</h2>
  INDEX is the section number where the material begins.

Anchors must be monotonically non-decreasing in document order.
Do not put data-anchor on any element other than <h2>.
Skip the interactive knowledge-check block for workspace summaries.
"""


def _framing(kind: str) -> str:
    if kind in ("youtube", "video"):
        return ("SOURCE TYPE: video transcript. Lines are prefixed with [mm:ss] "
                "timestamps. Sections follow the video's own progression.")
    if kind in ("pdf", "document"):
        return ("SOURCE TYPE: document. Text is tagged with [page N] markers. "
                "Sections follow the document's own structure.")
    return ("SOURCE TYPE: web article. Text is tagged with [section N] markers. "
            "Sections follow the article's own structure.")


def build_workspace_summary_prompt(source_text: str, title: str, kind: str) -> str:
    return f"""{MASTERY_SYSTEM_PROMPT}

{ANCHOR_EXTENSION}

---
Title: {title}
{_framing(kind)}

SOURCE MATERIAL:
{source_text[:24000]}
---

Generate the mastery guide HTML with data-anchor attributes now:"""
