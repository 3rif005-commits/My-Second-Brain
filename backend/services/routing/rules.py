"""Signals for one request, and the deterministic rules over them.

Rules run before the brain on purpose: they are cheap, predictable, and text
inside a retrieved PDF cannot argue them out of a decision.
"""
from __future__ import annotations

import logging
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Callable

logger = logging.getLogger(__name__)


@dataclass
class Signals:
    surface: str = "chat"
    query: str = ""
    query_chars: int = 0
    est_tokens: int = 0
    retrieved: int = 0
    #: retrieved notes that are private (the gate holds them back from cloud)
    private_hits: int = 0
    spend_today_usd: float | None = None

    def public(self) -> dict[str, Any]:
        """What the decision log and the UI may show — no message text."""
        d = asdict(self)
        d.pop("query")
        return d


def spend_today(user_id: str) -> float | None:
    """Today's AI spend (UTC) from the run log, or None when unknown."""
    if not user_id:
        return None
    from services.database import get_supabase
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0,
                                               microsecond=0).isoformat()
    try:
        rows = (get_supabase().table("ai_runs").select("estimated_usd")
                .eq("user_id", user_id).gte("created_at", start)
                .execute().data or [])
    except Exception as e:                              # noqa: BLE001
        logger.info("ai_runs unavailable for the spend rule (%s)", e)
        return None
    return float(sum(float(r.get("estimated_usd") or 0) for r in rows))


def _words(value: str) -> list[str]:
    return [w.strip().lower() for w in value.split(",") if w.strip()]


def matches(rule: dict[str, Any], s: Signals,
            spend: Callable[[], float | None] | None = None) -> bool:
    kind, value = rule["kind"], rule.get("value")
    if kind == "always":
        return True
    if kind == "message_matches":
        text = s.query.lower()
        return any(re.search(r"(?<!\w)" + re.escape(w) + r"(?!\w)", text)
                   for w in _words(str(value)))
    if kind == "context_over":
        return s.est_tokens > float(value)
    if kind == "surface_is":
        return s.surface in _words(str(value))
    if kind == "spend_today_over":
        if s.spend_today_usd is None and spend is not None:
            s.spend_today_usd = spend()
        # Unknown spend never trips the cap — same rule as the budget guard.
        return s.spend_today_usd is not None and s.spend_today_usd >= float(value)
    return False


def first_match(rules: list[dict[str, Any]], s: Signals,
                spend: Callable[[], float | None] | None = None
                ) -> dict[str, Any] | None:
    for r in rules:
        if r.get("enabled", True) and matches(r, s, spend):
            return r
    return None


def describe(rule: dict[str, Any]) -> str:
    """The rule as a sentence, for the route badge."""
    kind, v = rule["kind"], rule.get("value")
    if kind == "message_matches":
        return f"message mentions {v}"
    if kind == "context_over":
        return f"context over {int(float(v)):,} tokens"
    if kind == "surface_is":
        return f"from {v}"
    if kind == "spend_today_over":
        return f"today's spend reached ${float(v):.2f}"
    return kind
