"""Is a ready result still made from what the note's sources look like now?

A job stores its `source_hash` (the note's `source_signature` at queue time)
and the ids it read from. Comparing that snapshot to the note's current
signature says whether a source was deleted, or changed under it (added,
removed, or re-extracted) since. The note's own text is never part of this —
a background job is additive, so editing the note is never stale (spec §5).
"""
from __future__ import annotations

from services.database import get_supabase
from services.workspace.synthesis import source_signature


def parse_signature(sig: str) -> dict[str, str]:
    if not sig:
        return {}
    out = {}
    for part in sig.split(","):
        if ":" in part:
            sid, at = part.split(":", 1)
            out[sid] = at
    return out


def _title(source_id: str) -> str | None:
    rows = (get_supabase().table("note_resources").select("title")
            .eq("id", source_id).limit(1).execute().data or [])
    return rows[0].get("title") if rows else None


def check(stored_hash: str | None, source_ids: list[str], note_id: str) -> dict | None:
    """None when nothing has changed; otherwise {"reason", "message"}."""
    if not stored_hash:
        return None                                # queued before this feature, or never had sources
    current = parse_signature(source_signature(note_id))
    stored = parse_signature(stored_hash)

    missing = [sid for sid in source_ids if sid not in current]
    if missing:
        return {"reason": "deleted", "message": "Made from a source you have since deleted."}

    changed = [sid for sid in source_ids if stored.get(sid) != current.get(sid)]
    added = [sid for sid in current if sid not in stored]
    if not changed and not added:
        return None

    title = _title(changed[0]) if changed else None
    message = f'Made from an older version of "{title}".' if title \
        else "Made from an older version of your sources."
    return {"reason": "changed", "message": message}
