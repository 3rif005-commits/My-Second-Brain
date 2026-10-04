"""One `routing_decisions` row per routed request.

Telemetry never breaks a user-facing call: every failure here is swallowed
and logged once (the table may not exist until migration 029 is applied).
Rows hold reasons and counts — never message or note text.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

logger = logging.getLogger(__name__)
_warned = False


def record(user_id: str, route, *, surface: str, thread_id: str | None,
           message_id: str | None, signals: dict[str, Any], sent: int,
           withheld: int, released: int,
           override_of: str | None = None) -> str | None:
    """Write the decision; returns its id (None when it could not be written)."""
    global _warned
    from services.database import get_supabase

    row_id = str(uuid.uuid4())
    row = {
        "id": row_id, "user_id": user_id, "thread_id": thread_id,
        "message_id": message_id, "surface": surface, "slot": route.slot,
        "provider": route.provider.label or route.provider.provider,
        "model": route.provider.model, "decided_by": route.decided_by,
        "rule_id": route.rule_id, "reason": route.reason[:300],
        "confidence": route.confidence, "latency_ms": route.latency_ms,
        "signals": signals, "sent_count": sent, "withheld_count": withheld,
        "released_count": released,
        "override_of": override_of if _is_uuid(override_of) else None,
    }
    try:
        get_supabase().table("routing_decisions").insert(row).execute()
    except Exception as e:                              # noqa: BLE001
        if not _warned:
            logger.warning("routing_decisions not written (%s) — is migration "
                           "029 applied?", e)
            _warned = True
        return None
    return row_id


def recent(user_id: str, limit: int = 100, slot: str | None = None,
           decided_by: str | None = None) -> list[dict[str, Any]]:
    from services.database import get_supabase
    q = (get_supabase().table("routing_decisions").select("*")
         .eq("user_id", user_id))
    if slot:
        q = q.eq("slot", slot)
    if decided_by:
        q = q.eq("decided_by", decided_by)
    return q.order("created_at", desc=True).limit(min(limit, 500)).execute().data or []


def summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Headline numbers for the Activity tab."""
    n = len(rows)
    if not n:
        return {"count": 0, "local_pct": 0, "override_pct": 0, "withheld": 0,
                "by_slot": {}}
    by_slot: dict[str, int] = {}
    for r in rows:
        by_slot[r["slot"]] = by_slot.get(r["slot"], 0) + 1
    return {
        "count": n,
        "local_pct": round(100 * by_slot.get("local", 0) / n),
        "override_pct": round(100 * sum(1 for r in rows if r.get("override_of")) / n),
        "withheld": sum(int(r.get("withheld_count") or 0) for r in rows),
        "by_slot": by_slot,
    }


def _is_uuid(v: str | None) -> bool:
    try:
        uuid.UUID(str(v))
        return True
    except (TypeError, ValueError):
        return False
