"""Section splitting and tagging, shared by every section-anchored source.

A "section" is `{"index": int, "kind": "heading"|"text"|"image", "content": str}`
— the unit that `anchor_type="section"` anchors point at, so a note's chips can
jump back into the source.

Websites have had this since the beginning (trafilatura hands back a section
list). Markdown and plain-text files did not: `processor.py` tagged the whole
file `[page 1]`, so every chunk, every anchor and every chip on a 50-page
markdown file pointed at page 1 and forward/reverse sync did nothing. They are
split here instead, into the same shape, so they get real positions and can
reuse the website viewer as-is.
"""
from __future__ import annotations

import re

_HEADING = re.compile(r"^(#{1,6})\s+(.+)$")


def split_markdown_sections(raw: str) -> list[dict]:
    """Split markdown / plain text into sections on headings and blank lines.

    Plain text has no headings, which is fine — it falls through to
    paragraph-per-section, which is still far better than one section for the
    whole file.
    """
    items: list[tuple[str, str]] = []
    buf: list[str] = []

    def flush() -> None:
        text = "\n".join(buf).strip()
        buf.clear()
        if text:
            items.append(("text", text))

    for line in raw.splitlines():
        stripped = line.strip()
        match = _HEADING.match(stripped)
        if match:
            flush()
            items.append(("heading", match.group(2).strip()))
        elif not stripped:
            flush()
        else:
            buf.append(line)
    flush()

    return [{"index": i, "kind": kind, "content": content}
            for i, (kind, content) in enumerate(items)]


def tag_sections(sections: list[dict]) -> str:
    """`[section N]`-tagged text for the synthesis prompt.

    Headings keep a "## " marker for the same reason PDF headings do: the kind
    is already known here, and flattening it hands the model a wall of
    undifferentiated paragraphs while the prompt asks it to follow the source's
    own structure. Image sections carry a URL, not prose, so they are skipped.
    """
    return "\n".join(
        f"[section {s['index']}] " + ("## " if s["kind"] == "heading" else "") + s["content"]
        for s in sections if s["kind"] != "image"
    )


def sections_as_elements(sections: list[dict]) -> list[dict]:
    """Section list → `resource_elements` rows, the shape the website viewer
    renders and the send-to-note actions read."""
    return [
        {"page": 0,
         "element_type": ("image" if s["kind"] == "image"
                          else "heading" if s["kind"] == "heading" else "text"),
         "order_index": s["index"], "bbox": None,
         "content": s["content"], "image_bytes": None}
        for s in sections
    ]


def chunk_sections(sections: list[dict], max_chars: int = 1500) -> list[dict]:
    """Section-anchored chunks for grounded retrieval."""
    chunks: list[dict] = []
    idx = 0
    buf = ""
    start = 0
    last = 0
    for s in sections:
        if s["kind"] == "image":
            continue
        if not buf:
            start = s["index"]
        buf += s["content"] + "\n"
        last = s["index"]
        if len(buf) >= max_chars:
            chunks.append({"chunk_index": idx, "chunk_text": buf.strip(),
                           "anchor_type": "section",
                           "anchor_start": start, "anchor_end": last})
            idx += 1
            buf = ""
    if buf.strip():
        chunks.append({"chunk_index": idx, "chunk_text": buf.strip(),
                       "anchor_type": "section",
                       "anchor_start": start, "anchor_end": last})
    return chunks
