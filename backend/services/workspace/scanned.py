"""Scanned PDF pages → text, read by a vision model (ArtCraft study item 13).

PdfCraft OCRs scans with a bundled engine; we already route every model call through the
switchboard, so a page with no text layer is rendered and sent to the `vision` task instead —
any vision-capable provider the user has, under the note's privacy level. No setting: it
happens only for pages that have no text, at most MAX_PAGES per file.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

MAX_PAGES = 40
RENDER_DPI = 150

PAGE_PROMPT = (
    "This is one scanned page. Transcribe ALL of its text as markdown, in reading order. Keep "
    "headings as '## ', lists as '- ', tables as markdown tables and formulas as LaTeX between $. "
    "Output only the page's content — no comments. If the page has no text, output nothing."
)


class NoVision(Exception):
    """No vision-capable provider is allowed for this note."""


def read_scanned_pages(pdf_path: str, pages: list[int], user_id: str,
                       render=None, ask=None) -> dict[int, str]:
    """{page: markdown} for the given 1-based pages (first MAX_PAGES). Raises NoVision when no
    provider can read images. A page that fails is skipped, never fatal."""
    from services.ai.router import candidates, complete_with_fallback

    if not pages:
        return {}
    if not candidates("vision", user_id):
        raise NoVision()
    render = render or _render_page
    ask = ask or (lambda png: complete_with_fallback("vision", user_id, [{
        "role": "user", "content": [{"type": "text", "text": PAGE_PROMPT},
                                    {"type": "image", "data": png, "mime": "image/png"}],
    }], max_tokens=3000))
    out: dict[int, str] = {}
    for pno in pages[:MAX_PAGES]:
        try:
            text = (ask(render(pdf_path, pno)) or "").strip()
        except Exception as e:                           # noqa: BLE001
            logger.warning(f"scanned page {pno}: {e}")
            continue
        if text.startswith("```"):
            text = text.strip("`").split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        if text:
            out[pno] = text
    return out


def _render_page(pdf_path: str, pno: int) -> bytes:
    import fitz
    with fitz.open(pdf_path) as doc:
        return doc[pno - 1].get_pixmap(dpi=RENDER_DPI).tobytes("png")
