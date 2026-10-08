"""The Notes database schema and a note's property values (D1: tree of databases).

Names are what you see in Notion. Our values are the source of truth; the two
"… in Second Brain" dates carry our real timestamps because Notion's own
created/edited times are Notion-owned (T10).
"""
from __future__ import annotations

from services.portable import ir
from services.portable.losses import Loss

from .richtext import plain_rich, split_units

TITLE_PROP = "Name"
SB_ID_PROP = "SB ID"
P_TOPICS, P_MASTERY, P_SOURCE = "Topics", "Mastery", "Source"
P_SOURCE_URL, P_FAVORITE, P_PRIVACY = "Source URL", "Favorite", "Privacy"
P_CREATED, P_EDITED = "Created in Second Brain", "Edited in Second Brain"

SCHEMA: dict[str, dict] = {
    TITLE_PROP: {"title": {}},
    SB_ID_PROP: {"rich_text": {}},
    P_TOPICS: {"multi_select": {}},
    P_MASTERY: {"select": {}},
    P_SOURCE: {"select": {}},
    P_SOURCE_URL: {"url": {}},
    P_FAVORITE: {"checkbox": {}},
    P_PRIVACY: {"select": {}},
    P_CREATED: {"date": {}},
    P_EDITED: {"date": {}},
}

MASTERY = {"not_started": "Not started", "learning": "Learning", "reviewing": "Reviewing", "mastered": "Mastered"}


def _opt(name: str) -> dict:
    return {"name": name}


def row_properties(obj: ir.Obj, losses: list[Loss]) -> dict:
    """Property values for a note's row (everything except the title and SB ID)."""
    p, m = obj.props, obj.meta
    out: dict = {}
    topics = []
    for t in p.get("topics") or []:
        clean = str(t).replace(",", ";").strip()[:100]
        if clean != str(t).strip():
            losses.append(Loss("approximated", f"The topic “{str(t)[:40]}”.",
                               "Notion tags cannot hold commas or exceed 100 characters; it was adjusted.",
                               "topic_adjusted"))
        if clean and clean not in topics:
            topics.append(clean)
    if len(topics) > 100:
        topics = topics[:100]
        losses.append(Loss("lossy", "More than 100 topics.", "Only the first 100 are sent.", "topics_capped"))
    out[P_TOPICS] = {"multi_select": [_opt(t) for t in topics]}
    if p.get("mastery") in MASTERY:
        out[P_MASTERY] = {"select": _opt(MASTERY[p["mastery"]])}
    if p.get("source_type"):
        out[P_SOURCE] = {"select": _opt(str(p["source_type"]).capitalize())}
    url = p.get("source_url") or ""
    if url.lower().startswith(("http://", "https://")) and len(url) <= 2000:
        out[P_SOURCE_URL] = {"url": url}
    elif url:
        losses.append(Loss("lossy", "A source address Notion cannot store as a link.",
                           "The Source URL column is left empty.", "source_url_dropped"))
    out[P_FAVORITE] = {"checkbox": bool(p.get("favorite"))}
    if p.get("privacy"):
        out[P_PRIVACY] = {"select": _opt(str(p["privacy"]).capitalize())}
    for key, name in (("created_at", P_CREATED), ("updated_at", P_EDITED)):
        if m.get(key):
            out[name] = {"date": {"start": str(m[key])}}
    return out


def title_value(text: str) -> dict:
    return {"title": [{"type": "text", "text": {"content": piece}} for piece in split_units(text or "Untitled")]}


def sb_id_value(sb_id: str) -> dict:
    return {"rich_text": plain_rich(sb_id)}
