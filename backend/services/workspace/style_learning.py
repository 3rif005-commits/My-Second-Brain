"""Learn the student's style from how they edit AI study guides (E12).

Nothing here changes a guide by itself. It SUGGESTS preferences; the student
accepts or ignores each one in Settings → Skills → Study guide → Your style,
and only accepted lines (reference/style.md) reach the prompt — after the
study-guide instructions, which never change (HARNESS.md, the prompt
incident).

Pairs: what the AI put into a note (`ai_outputs`, migration 022) and the note
as the student left it. The editor converts HTML to blocks and back, so the
comparison uses what survives that faithfully: box types, tables, formulas,
headings, amount of text, and which passages were added or removed.
"""
from __future__ import annotations

import json
import logging
import re
from collections import Counter

from services.workspace.note_score import score_note

logger = logging.getLogger(__name__)

SKILL = "study-guide"
#: at most this many recent guides are compared
MAX_PAIRS = 10
#: a note must have been touched this long after the insert to count as edited
EDITED_AFTER_SECONDS = 60

LEARN_PROMPT = """You are helping a student tune how an AI writes their study guides.

Below, for each guide the AI wrote, is what the student changed afterwards:
counts of each structure before -> after, and samples of text they removed or
added. From these, suggest the student's STYLE PREFERENCES.

Rules:
- Only general preferences about form, structure, boxes, length, tone or
  what to include — never about the topic of one lecture.
- Only what the edits show consistently: with 2 or more guides, a preference
  must be supported by at least 2 of them.
- Each preference is one short instruction in the student's voice, e.g.
  "No analogy boxes." or "End each chapter with a short Key takeaways list."
- Skip preferences the student already has (listed below).
- Do not list a change that only follows from another one you list (adding
  a "Key takeaways" heading also adds a heading — that is not a second
  preference).
- At most 5. If nothing is consistent, return an empty list.

Answer with JSON only:
[{{"preference": "...", "evidence": "<which edits show it, in one line>"}}]

The student's current preferences:
{existing}

The edits:
{edits}"""

_TAGS = re.compile(r"<[^>]+>")
_UNIT = re.compile(r"<(p|li|h[1-6]|td)\b[^>]*>(.*?)</\1>", re.S | re.I)


def _units(html: str) -> list[str]:
    """Paragraph-sized passages, normalized for comparison."""
    out = []
    for _, inner in _UNIT.findall(html or ""):
        text = re.sub(r"\s+", " ", _TAGS.sub(" ", inner)).strip()
        if len(text) >= 3:
            out.append(text)
    return out


def _profile(html: str) -> dict:
    s = score_note(html or "")
    return {"chapters": s.headings.get("h2", 0), "sections": s.headings.get("h3", 0),
            "subheadings": sum(s.headings.get(h, 0) for h in ("h4", "h5", "h6")),
            "boxes": dict(sorted(s.callouts.items())), "tables": s.tables,
            "formulas": s.math_blocks, "text_chars": s.text_chars}


def describe_edits(ai_html: str, user_html: str) -> dict:
    """What the student changed: structure before -> after, and samples of
    passages they removed or added."""
    before, after = _profile(ai_html), _profile(user_html)
    a, u = Counter(x.lower() for x in _units(ai_html)), Counter(x.lower() for x in _units(user_html))
    orig = {x.lower(): x for x in _units(ai_html) + _units(user_html)}
    removed = [orig[k][:160] for k in (a - u)][:6]
    added = [orig[k][:160] for k in (u - a)][:6]
    return {"before": before, "after": after, "removed": removed, "added": added}


def changed(description: dict) -> bool:
    return description["before"] != description["after"] or bool(
        description["removed"] or description["added"])


def learn_from_pairs(pairs: list[tuple[str, str]], existing: str = "",
                     user_id: str = "") -> list[dict]:
    """[{preference, evidence}] from (AI version, student's version) pairs."""
    from services.ai.router import complete_with_fallback

    edits = [describe_edits(ai, mine) for ai, mine in pairs]
    edits = [e for e in edits if changed(e)]
    if not edits:
        return []
    listing = "\n\n".join(f"GUIDE {i}:\n{json.dumps(e, ensure_ascii=False)}"
                          for i, e in enumerate(edits, start=1))
    raw = complete_with_fallback(
        "summarize_text", user_id,
        [{"role": "user", "content": LEARN_PROMPT.format(
            existing=existing.strip() or "(none)", edits=listing)}],
        max_tokens=1200)
    match = re.search(r"\[.*\]", raw, re.S)
    try:
        items = json.loads(match.group(0)) if match else []
    except json.JSONDecodeError:
        return []
    have = existing.lower()
    out = []
    for it in items[:5]:
        pref = str(it.get("preference") or "").strip() if isinstance(it, dict) else ""
        if pref and pref.lower() not in have:
            out.append({"preference": pref, "evidence": str(it.get("evidence") or "").strip()})
    return out


def gather_pairs(user_id: str) -> list[tuple[str, str]]:
    """(AI version, the note as the student left it) for the recent guides
    that were edited after the insert."""
    from datetime import datetime, timedelta

    from services.database import get_supabase
    from services.workspace.blocks_html import blocks_to_html

    db = get_supabase()
    rows = (db.table("ai_outputs").select("note_id,html,created_at")
            .eq("user_id", user_id).eq("skill", SKILL)
            .order("created_at", desc=True).limit(MAX_PAIRS).execute().data or [])
    if not rows:
        return []
    notes = {str(n["id"]): n for n in (
        db.table("notes").select("id,content,updated_at,deleted_at")
        .in_("id", list({str(r["note_id"]) for r in rows})).eq("user_id", user_id)
        .execute().data or [])}
    pairs, seen = [], set()
    for r in rows:
        note = notes.get(str(r["note_id"]))
        if not note or note.get("deleted_at") or str(r["note_id"]) in seen:
            continue
        seen.add(str(r["note_id"]))                 # the latest guide per note
        inserted = datetime.fromisoformat(str(r["created_at"]).replace("Z", "+00:00"))
        touched = datetime.fromisoformat(str(note["updated_at"]).replace("Z", "+00:00"))
        if touched - inserted < timedelta(seconds=EDITED_AFTER_SECONDS):
            continue                                # never edited after the insert
        pairs.append((r["html"], blocks_to_html(note.get("content") or [])))
    return pairs
