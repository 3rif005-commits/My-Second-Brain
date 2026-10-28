"""Generate a 2-3 sentence AI descriptor for a note.

Used to populate notes.descriptor + notes.descriptor_embedding so the
two-pass retriever can find notes by topic before drilling into blocks.
"""
from __future__ import annotations


from models.agent import Mode
from services.ai import usage as usage_log
from services.ai.router import complete_with_fallback

_PROMPT = """\
You are summarizing a personal knowledge note for use in an AI retrieval system.
Write 2-3 sentences that describe what this note is about.
Be specific: mention the main topic, key concepts, and what a reader would learn.
Do not use phrases like "this note" or "this document".

Title: {title}
Content (first 2000 chars):
{content}

Descriptor:"""


def generate(note_title: str, blocks: list[str], user_id: str = "") -> str:
    """Return a 2-3 sentence descriptor string for the note.

    Falls back to "{title}. {first_block[:200]}" if the LLM is unreachable.
    """
    content = "\n\n".join(blocks)[:2000]

    try:
        with usage_log.annotate(surface="indexer", job="descriptor",
                                trigger="auto"):
            text = complete_with_fallback(
                "summarize_text", user_id,
                [{"role": "user",
                  "content": _PROMPT.format(title=note_title, content=content)}],
                max_tokens=120)
        return text.strip() or _fallback(note_title, blocks)
    except Exception:
        # A descriptor is a nicety; indexing must not fail for want of one.
        return _fallback(note_title, blocks)


def _fallback(title: str, blocks: list[str]) -> str:
    first = blocks[0][:200] if blocks else ""
    if first:
        return f"{title}. {first}"
    return f"{title}."
