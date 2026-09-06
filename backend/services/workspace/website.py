"""Website resource extraction — trafilatura rich extraction into sections.

extract_website(url) → {
  "title": str,
  "meta": {author, thumbnail?},
  "sections": [{"index": int, "kind": "text"|"heading"|"image",
                "content": str,        # text, or image URL for kind=image
               }],
  "tagged_text": str,  # "[section N]" tagged text for summarization
}
"""
from __future__ import annotations

import trafilatura

# Re-exported: existing callers (and tests) import chunk_sections from here, and
# websites are still the main producer of section-anchored sources.
from services.workspace.sections import (chunk_sections, sections_as_elements,  # noqa: F401
                                         tag_sections)


def extract_website(url: str) -> dict:
    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        raise ValueError(f"Could not fetch URL: {url}")

    doc = trafilatura.bare_extraction(
        downloaded,
        include_images=True,
        include_formatting=True,
        include_links=False,
        include_tables=True,
        with_metadata=True,
    )
    if doc is None:
        raise ValueError("Could not extract readable content from the page.")

    # trafilatura ≥2.0 returns a Document object; older returns dict
    get = (lambda k: getattr(doc, k, None)) if not isinstance(doc, dict) else doc.get
    title = get("title") or url
    text = get("text") or ""
    if not text.strip():
        raise ValueError("Page had no readable text.")

    meta = {"author": get("author"), "thumbnail": get("image")}

    sections: list[dict] = []
    idx = 0
    for para in text.split("\n"):
        para = para.strip()
        if not para:
            continue
        if para.startswith("!["):  # markdown image from include_images
            src = para[para.find("(") + 1: para.rfind(")")] if "(" in para else ""
            if src:
                sections.append({"index": idx, "kind": "image", "content": src})
                idx += 1
            continue
        kind = "heading" if (para.startswith("#") and len(para) < 200) else "text"
        sections.append({"index": idx, "kind": kind, "content": para.lstrip("# ").strip()
                         if kind == "heading" else para})
        idx += 1

    return {"title": title, "meta": meta, "sections": sections,
            "tagged_text": tag_sections(sections)}
