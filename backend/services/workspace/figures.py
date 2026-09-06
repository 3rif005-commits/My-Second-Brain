"""Figure crops as image parts for the synthesis prompt.

The extractor already crops every embedded image out of a PDF and uploads it
(`resource_elements.image_path`), but until now those crops only ever reached
the VIEWER — `pages_text` is the sole path to the model, and a diagram has no
text. A lecture like the Q-learning deck carries its grid-world, its
value-function block diagram and its Q-table layout entirely as pictures, so the
model was writing notes about slides it could not see.

`figure_parts()` turns those crops into the `{"type": "image"}` parts that
`services.ai.client` already knows how to hand to Anthropic, Gemini and OpenAI.

Most crops in a slide deck are not figures. Measured on a real 17-slide lecture:
26 crops, but only NINE distinct images — the university logo alone accounted
for sixteen of them, once per slide. Sending the list as extracted spends the
whole budget on letterhead and can push the one diagram that matters (the
agent/environment loop on page 3, which appears nowhere in the text) past the
cap. So crops are deduplicated by content and anything repeating across pages is
dropped as page furniture before the cap is applied.
"""
from __future__ import annotations

import hashlib
import io
import logging
from collections import defaultdict

from services.database import get_supabase
from services.workspace import storage

logger = logging.getLogger(__name__)

# A lecture's worth of diagrams. Each downscaled crop costs roughly a thousand
# input tokens, so this is ~25K tokens on top of a ~45K-character prompt — a
# fraction of the window, and the cap that keeps a 200-page PDF from blowing it.
MAX_FIGURES = 24
# Long edge, in pixels. Vision models bill by area and gain nothing from a crop
# larger than they sample, so a slide diagram is downscaled to this before it is
# sent. Anything smaller is sent untouched.
MAX_EDGE = 1024
# Below this, a crop is a bullet glyph, a rule, or a separator — never a figure.
MIN_EDGE = 64
# Greyscale standard deviation below which a crop carries no picture at all.
# A slide template ships flat-filled rectangles as real embedded images: the
# title slide of the test deck contributes two 1024px-wide panels of one solid
# off-white. They survive every size and repetition test and are pure cost.
MIN_STDDEV = 6.0
# An identical image on this many distinct pages is a logo, a watermark, or a
# slide-template element. Real figures illustrate one point and appear once; the
# deck that motivated this repeated its letterhead on sixteen of seventeen
# slides. Counted in distinct PAGES, so a diagram used twice on one busy page is
# still a figure.
FURNITURE_PAGES = 4
# Crops fetched per note before deduplication. Deduplication needs the bytes, so
# this bounds what a 300-page PDF can cost us to look at; the cap on what is
# actually SENT is MAX_FIGURES.
SCAN_LIMIT = 150


def _downscale(data: bytes) -> bytes | None:
    """Shrink to MAX_EDGE, and reject crops that are not figures at all.

    Returns None for anything that should not be sent — too small to hold a
    diagram, or too flat to hold anything.
    """
    try:
        from PIL import Image, ImageStat
        im = Image.open(io.BytesIO(data))
        w, h = im.size
        if w < MIN_EDGE or h < MIN_EDGE:
            return None
        if ImageStat.Stat(im.convert("L")).stddev[0] < MIN_STDDEV:
            return None
        if max(w, h) <= MAX_EDGE:
            return data
        scale = MAX_EDGE / max(w, h)
        im = im.convert("RGB").resize((max(1, int(w * scale)), max(1, int(h * scale))))
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        return buf.getvalue()
    except Exception as e:
        logger.warning(f"figure downscale failed, sending as-is: {e}")
        return data


def _rows(source_id: str) -> list[dict]:
    return (get_supabase().table("resource_elements")
            .select("page,order_index,image_path")
            .eq("resource_id", source_id).eq("element_type", "image")
            .not_.is_("image_path", "null")
            .order("page").order("order_index").execute().data or [])


def _scan(source_ids: list[str]) -> list[dict]:
    """Fetch crops round-robin across sources, up to SCAN_LIMIT.

    Round-robin rather than in order: a 40-slide PDF attached beside a short
    article would otherwise use the whole scan before the article's one diagram
    was ever reached.
    """
    per_source: list[list[dict]] = []
    for sid in source_ids:
        try:
            per_source.append(_rows(sid))
        except Exception as e:
            logger.warning(f"source {sid}: could not list figures: {e}")
            per_source.append([])

    found: list[dict] = []
    for depth in range(max((len(r) for r in per_source), default=0)):
        for index, rows in enumerate(per_source, start=1):
            if len(found) >= SCAN_LIMIT:
                return found
            if depth >= len(rows):
                continue
            row = rows[depth]
            try:
                data = storage.download(row["image_path"])
            except Exception as e:
                logger.warning(f"figure {row['image_path']} unreadable: {e}")
                continue
            found.append({"source": index, "page": row["page"], "data": data,
                          "digest": hashlib.sha1(data).digest()})
    return found


def _keep(found: list[dict]) -> list[dict]:
    """Drop duplicates and page furniture, preserving scan order."""
    pages: dict[bytes, set] = defaultdict(set)
    for f in found:
        pages[f["digest"]].add((f["source"], f["page"]))

    out, seen, furniture = [], set(), 0
    for f in found:
        if f["digest"] in seen:
            continue
        seen.add(f["digest"])
        if len(pages[f["digest"]]) >= FURNITURE_PAGES:
            furniture += 1
            continue
        out.append(f)
    if furniture:
        logger.info(f"figures: dropped {furniture} repeated crop(s) as page "
                    f"furniture (logo, watermark, slide template)")
    return out


def figure_parts(source_ids: list[str], limit: int = MAX_FIGURES) -> list[dict]:
    """Content parts for every source's figures, best-effort.

    Each figure is preceded by a text part naming its source and page, so the
    model can tie the picture to the `[page N]` tagging in the text and anchor
    the section it writes about it.
    """
    if not source_ids:
        return []
    parts: list[dict] = []
    small = 0
    for f in _keep(_scan(source_ids)):
        if len(parts) // 2 >= limit:
            break
        data = _downscale(f["data"])
        if data is None:
            small += 1
            continue
        parts.append({"type": "text",
                      "text": f"[FIGURE — SOURCE {f['source']}, page {f['page']}]"})
        parts.append({"type": "image", "data": data, "mime": "image/png"})
    logger.info(f"figures: attaching {len(parts) // 2} crop(s) "
                f"({small} too small to be a figure)")
    return parts
