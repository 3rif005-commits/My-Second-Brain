"""Photo of a diagram → an editable Mermaid live block (ArtCraft study item 11).

VectorCraft traces bitmaps into curves; for notes the better result is *text*: a vision model
reads the whiteboard / hand-drawn / slide diagram and writes it as Mermaid, which the live
block renders and the user (or the AI) can edit. Runs on the switchboard's `vision` task, so it
uses whichever vision-capable provider the user has, under the note's privacy level.
"""
from __future__ import annotations

import re

MAX_IMAGE_BYTES = 8 * 1024 * 1024
IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}

DIAGRAM_PROMPT = (
    "This image shows a diagram (whiteboard, hand drawing, slide or screenshot). Rewrite it as "
    "Mermaid so it can be edited. Choose the closest Mermaid type (flowchart, sequenceDiagram, "
    "mindmap, timeline, classDiagram, stateDiagram-v2, erDiagram, gantt, pie). Keep every label "
    "as written. Output ONLY the Mermaid source starting with its keyword — no code fences, no "
    "explanation."
)

_MERMAID_START = re.compile(
    r"^(?:%%.*\n\s*)*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|"
    r"gantt|pie|mindmap|timeline|journey|quadrantChart|gitGraph|xychart-beta|block-beta)\b")


def clean_mermaid(text: str) -> str:
    """The model's reply as bare Mermaid source; ValueError when it isn't a diagram."""
    t = (text or "").strip()
    fenced = re.search(r"```[a-z0-9-]*\s*\n([\s\S]*?)\n?```", t, re.IGNORECASE)
    if fenced:
        t = fenced.group(1).strip()
    if not _MERMAID_START.match(t):
        raise ValueError("The model didn't return a diagram for this image.")
    return t


def diagram_from_image(image: bytes, mime: str, user_id: str) -> str:
    """Mermaid source for a diagram photo. Raises ValueError with a user-facing reason."""
    from services.ai.router import candidates, complete_with_fallback

    if mime not in IMAGE_MIMES:
        raise ValueError("Use a PNG, JPEG, WebP or GIF image.")
    if not image or len(image) > MAX_IMAGE_BYTES:
        raise ValueError("The image is empty or larger than 8 MB.")
    if not candidates("vision", user_id):
        raise ValueError("Turning a photo into a diagram needs an AI provider that can read "
                         "images (Settings → AI Providers), allowed for this note's privacy level.")
    try:
        reply = complete_with_fallback("vision", user_id, [{
            "role": "user",
            "content": [{"type": "text", "text": DIAGRAM_PROMPT},
                        {"type": "image", "data": image, "mime": mime}],
        }], max_tokens=2048)
    except RuntimeError as e:
        raise ValueError(str(e)[:300]) from e
    return clean_mermaid(reply)
