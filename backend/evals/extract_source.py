"""A PDF as the app would hand it to a study guide — for the eval corpus.

    python -m evals.extract_source <file.pdf> <out.extracted.txt>

The app's own path: pdf_elements.extract_pdf -> chunk_pages (what
resource_chunks store) -> the tagged text synthesis.source_text_from_chunks
rebuilds from those rows. Same steps, no database.
"""
from __future__ import annotations

import sys
from pathlib import Path


def extracted_text(pdf: str) -> str:
    from services.workspace.pdf_elements import chunk_pages, extract_pdf
    from services.workspace.processor import _pg_safe
    from services.workspace.synthesis import _anchor_tag

    pages = extract_pdf(pdf)["pages_text"]
    parts: list[str] = []
    last_tag = None
    for c in chunk_pages(pages):
        tag = _anchor_tag(c["anchor_type"], c["anchor_start"])
        if tag != last_tag:
            parts.append(tag)
            last_tag = tag
        parts.append(_pg_safe(c["chunk_text"]))
    return "\n".join(parts)


if __name__ == "__main__":
    Path(sys.argv[2]).write_text(extracted_text(sys.argv[1]), encoding="utf-8")
