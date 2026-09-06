"""PDF element extraction — PyMuPDF only (no ML; runs in ms on CPU).

extract_pdf(path) → {
  "page_count": int,
  "page_sizes": [[w, h], ...],            # PDF points, per page
  "pages_text": ["[page 1]\\n...", ...],  # page-tagged text for summarization,
                                          # tables inlined as markdown and
                                          # headings marked "## " (see below)
  "elements": [                           # selectable viewer elements
     {"page": 1-based, "element_type": "text|heading|image|table|formula",
      "order_index": int, "bbox": [x0,y0,x1,y1], "content": str|None,
      "image_bytes": bytes|None}
  ],
}

Heuristics:
- headings: span size ≥ 1.35 × page median font size
- tables:   page.find_tables() (lines strategy) → markdown content + bbox
- images:   page image xrefs → PNG bytes + bbox
- formulas: blocks dominated by math fonts (CMMI/CMSY/CMEX/*Math*/Symbol) or
            high math-symbol density → rendered PNG crop for vision OCR

`pages_text` is what actually reaches the model (processor.py chunks it, and
synthesis.py reassembles those chunks into the prompt), so anything missing
from it is invisible to the AI no matter what `elements` holds:

- TABLES are inlined into it as markdown. They are excluded from the text
  blocks below to avoid double-counting, and for a long time that left a
  silent HOLE where every table had been — the model read the prose above and
  below a comparison table and nothing in between. They are spliced back at
  their vertical position rather than appended, so a table still reads where
  it belongs.
- HEADINGS are prefixed with "## ". The heading/body distinction is detected
  here anyway; flattening it threw away the document's own structure, while
  the prompt asks the model to follow that structure. One prefix restores it.

Text-block ORDER is left exactly as PyMuPDF returns it — deliberately. Sorting
by vertical position would interleave the columns of a two-column paper, which
is worse than the order we already have.
"""
from __future__ import annotations

import collections
import re
import statistics
import unicodedata

_MATH_FONT = re.compile(r"cmmi|cmsy|cmex|math|symbol|msam|msbm", re.I)
_MATH_CHARS = set("∫∑∏√∞≈≠≤≥±×÷∂∇∈∉⊂⊃∪∩→⇒⇔αβγδεζηθλμπρστφχψωΩΔΣΠ")

# ---- text repair -----------------------------------------------------------
#
# PowerPoint-exported PDFs (the common shape for a lecture deck) do not encode
# maths as text — they encode the GLYPHS, and the codepoints land wherever the
# subsetted font put them. Two mojibake families show up constantly, and both
# decode exactly rather than heuristically:
#
#   subscripts -> the Odia block. "observed" arrives as "୭ୠୱୣ୰୴ୣୢ", a clean
#     linear offset from U+0B5F ('a'), verified character-by-character against a
#     real deck. The run IS a subscript, so it is re-emitted as "_observed".
#   bold/italic maths -> the Mathematical Alphanumeric Symbols block. "max"
#     arrives as "𝒎𝒂𝒙" and "0.85" as "𝟎.𝟖𝟓"; NFKC maps both back.
#
# Without this the Bellman equation reached the model as
#   Q(S1, down) ୭ୠୱୣ୰୴ୣୢ = R(S4) + γ max   ୟ Q(S4, a)
# which is not something to write a note from.
_SUBSCRIPT_FIRST, _SUBSCRIPT_LAST = 0x0B5F, 0x0B78   # 'a'..'z'

# Symbol/Wingdings glyphs land in the private use area carrying no Unicode
# meaning at all. Only the ones actually observed are translated; any other PUA
# glyph becomes a space, because there is no text in it to recover.
_PUA_TEXT = {"\uf0e0": "->", "\uf0b7": "-", "\uf0a7": "-", "\uf06e": "-"}

# Presence of either mojibake family in the RAW text is also the only usable
# signal that a PowerPoint block is an equation — `_MATH_FONT` looks for TeX
# font names that a .pptx export never has, which is why formula detection
# found exactly zero equations in a lecture built entirely on them.
_GLYPH_MATH = re.compile(r"[\u0B5F-\u0B78\U0001D400-\U0001D7FF]")


def repair_text(text: str) -> str:
    """Undo PDF glyph-encoding damage. Safe on already-clean text."""
    if not text:
        return text
    out: list[str] = []
    run: list[str] = []

    def flush() -> None:
        if run:
            out.append("_" + "".join(run))
            run.clear()

    for ch in text:
        code = ord(ch)
        if _SUBSCRIPT_FIRST <= code <= _SUBSCRIPT_LAST:
            run.append(chr(ord("a") + code - _SUBSCRIPT_FIRST))
            continue
        flush()
        if ch in _PUA_TEXT:
            out.append(_PUA_TEXT[ch])
        elif 0xE000 <= code <= 0xF8FF:
            out.append(" ")
        else:
            out.append(ch)
    flush()
    # NFKC is what turns the Mathematical Alphanumeric block back into ASCII.
    return unicodedata.normalize("NFKC", "".join(out))


def _math_density(text: str) -> float:
    if not text:
        return 0.0
    hits = sum(1 for ch in text if ch in _MATH_CHARS)
    return hits / len(text)


def extract_pdf(path: str, max_pages: int = 300) -> dict:
    import fitz  # pymupdf

    doc = fitz.open(path)
    page_count = min(doc.page_count, max_pages)

    pages_text: list[str] = []
    page_sizes: list[list[float]] = []
    elements: list[dict] = []

    # Document-wide type metrics, in ONE pass (this walks every span in the
    # file, so it is not worth doing twice):
    #   doc_median — median span size. Per-page medians are skewed on sparse
    #     pages (a title page's median IS the title size), so headings there
    #     would never clear a per-page threshold.
    #   doc_body   — the MODAL block size: the size most blocks are set in, which
    #     is the real body size. The median is pulled around by how much text
    #     each size happens to carry; the mode is not.
    all_sizes: list[float] = []
    block_sizes: list[float] = []
    for pno in range(page_count):
        for block in doc[pno].get_text("dict").get("blocks", []):
            if block.get("type") != 0:
                continue
            spans = [sp for ln in block.get("lines", []) for sp in ln.get("spans", [])]
            if not spans:
                continue
            all_sizes.extend(sp["size"] for sp in spans)
            block_sizes.append(round(max(sp["size"] for sp in spans), 1))
    doc_median = statistics.median(all_sizes) if all_sizes else 10.0
    doc_body = (collections.Counter(block_sizes).most_common(1)[0][0]
                if block_sizes else doc_median)

    for pno in range(page_count):
        page = doc[pno]
        page_sizes.append([page.rect.width, page.rect.height])
        order = 0

        # ---- tables first (so their regions can be excluded from text blocks)
        table_rects = []
        table_blocks: list[tuple[float, str]] = []   # (top, markdown)
        try:
            tabs = page.find_tables()
            for t in tabs.tables:
                bbox = list(t.bbox)
                table_rects.append(fitz.Rect(bbox))
                try:
                    md = repair_text(t.to_markdown())
                except Exception:
                    md = ""
                elements.append({
                    "page": pno + 1, "element_type": "table", "order_index": order,
                    "bbox": bbox, "content": md, "image_bytes": None,
                })
                if md.strip():
                    table_blocks.append((bbox[1], md.strip()))
                order += 1
        except Exception:
            pass

        # ---- images
        try:
            for img in page.get_images(full=True):
                xref = img[0]
                try:
                    rects = page.get_image_rects(xref)
                    if not rects:
                        continue
                    r = rects[0]
                    if r.width < 24 or r.height < 24:
                        continue  # skip decorative specks
                    pix = fitz.Pixmap(doc, xref)
                    if pix.n - pix.alpha > 3:
                        pix = fitz.Pixmap(fitz.csRGB, pix)
                    elements.append({
                        "page": pno + 1, "element_type": "image", "order_index": order,
                        "bbox": [r.x0, r.y0, r.x1, r.y1], "content": None,
                        "image_bytes": pix.tobytes("png"),
                    })
                    order += 1
                except Exception:
                    continue
        except Exception:
            pass

        # ---- text blocks (dict mode: bbox + font info per span)
        d = page.get_text("dict")
        median_size = doc_median
        page_spans = [sp for blk in d.get("blocks", []) if blk.get("type") == 0
                      for ln in blk.get("lines", []) for sp in ln.get("spans", [])]
        page_max = max((sp["size"] for sp in page_spans), default=0.0)
        page_height = page.rect.height

        page_lines: list[str] = []
        line_tops: list[float] = []      # parallel to page_lines, for table splicing
        for block in d.get("blocks", []):
            if block.get("type") != 0:
                continue
            bbox = list(block["bbox"])
            brect = fitz.Rect(bbox)
            if any(brect.intersects(tr) for tr in table_rects):
                continue  # covered by a table element

            spans = [s for line in block.get("lines", []) for s in line.get("spans", [])]
            raw_text = " ".join(s["text"] for s in spans).strip()
            text = repair_text(raw_text)
            if not text:
                continue

            math_fonts = sum(1 for s in spans if _MATH_FONT.search(s.get("font", "")))
            is_formula = (
                (math_fonts / max(len(spans), 1) > 0.4)
                or _math_density(text) > 0.15
                # PowerPoint equations carry no TeX font name and few maths
                # symbols — what gives them away is the glyph-encoded subscript
                # or bold-maths run. Paired with "=" so a heading that merely
                # contains one such character isn't swallowed as an equation.
                or (bool(_GLYPH_MATH.search(raw_text)) and "=" in text)
            )
            max_size = max((s["size"] for s in spans), default=median_size)
            # Two rules, unioned — one alone gets a whole document class wrong.
            #
            # The global ratio rule finds headings anywhere on a page and is what
            # prose documents need. It CANNOT find slide titles: measured on a
            # real lecture deck, titles are 14.3pt against 12.8pt body — a 1.12x
            # step, nowhere near 1.35 — so it marked 3 headings in 17 slides and
            # the model got no structure at all.
            #
            # The slide rule takes the largest text on a page, near its top, when
            # that size stands above the document's body size. Loosening the
            # global ratio instead was tried and is far worse: at 1.04x it marked
            # 102 of 339 blocks, because the title size is reused for body text.
            is_heading = (not is_formula) and len(text) < 200 and (
                max_size >= median_size * 1.35
                or (
                    max_size >= page_max - 0.5
                    and page_max > doc_body * 1.05
                    and len(text) < 100
                    and bbox[1] < page_height * 0.5
                )
            )

            # Marked, not just detected: the model is asked to follow the
            # document's own structure, so it has to be able to see it.
            page_lines.append(f"## {text}" if is_heading else text)
            line_tops.append(bbox[1])

            if is_formula:
                try:
                    pix = page.get_pixmap(clip=brect, dpi=200)
                    img_bytes = pix.tobytes("png")
                except Exception:
                    img_bytes = None
                elements.append({
                    "page": pno + 1, "element_type": "formula", "order_index": order,
                    "bbox": bbox, "content": text, "image_bytes": img_bytes,
                })
            else:
                elements.append({
                    "page": pno + 1,
                    "element_type": "heading" if is_heading else "text",
                    "order_index": order,
                    "bbox": bbox, "content": text, "image_bytes": None,
                })
            order += 1

        # Put each table back where it sits on the page: before the first line
        # that starts below it. Insertion (rather than a global re-sort) is what
        # keeps the text blocks in PyMuPDF's own order.
        for top, md in sorted(table_blocks, key=lambda t: t[0]):
            idx = next((i for i, y in enumerate(line_tops) if y > top), len(page_lines))
            page_lines.insert(idx, md)
            line_tops.insert(idx, top)

        pages_text.append(f"[page {pno + 1}]\n" + "\n".join(page_lines))

    doc.close()
    return {
        "page_count": page_count,
        "page_sizes": page_sizes,
        "pages_text": pages_text,
        "elements": elements,
    }


def chunk_pages(pages_text: list[str], max_chars: int = 1500) -> list[dict]:
    """Page-anchored chunks for grounded retrieval."""
    chunks: list[dict] = []
    idx = 0
    for pno, ptext in enumerate(pages_text, start=1):
        body = re.sub(r"^\[page \d+\]\n?", "", ptext)
        if not body.strip():
            continue
        # split long pages at paragraph boundaries
        buf = ""
        for para in body.split("\n"):
            if len(buf) + len(para) > max_chars and buf:
                chunks.append({"chunk_index": idx, "chunk_text": buf.strip(),
                               "anchor_type": "page", "anchor_start": pno, "anchor_end": pno})
                idx += 1
                buf = ""
            buf += para + "\n"
        if buf.strip():
            chunks.append({"chunk_index": idx, "chunk_text": buf.strip(),
                           "anchor_type": "page", "anchor_start": pno, "anchor_end": pno})
            idx += 1
    return chunks
