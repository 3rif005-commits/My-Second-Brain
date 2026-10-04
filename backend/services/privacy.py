"""The privacy gate: which notes may travel to which model.

Every note (and so every database row, and every source, which belongs to its
note) has a sensitivity level:

  open      — fine to send anywhere
  personal  — fine for cloud providers the user trusts (the default)
  private   — never leaves this machine

Each provider gets a *ceiling*: the local model may see everything, a trusted
cloud provider up to `personal`, an untrusted one only `open`. A request runs
inside `scope(ceiling)`, and everything that reads notes on its behalf —
retrieval for the prompt, the agent's search/get/list tools, database queries —
passes its rows through `filter_rows`, which drops what is above the ceiling
and records it as withheld.

This is code, not a prompt: no model output can raise a ceiling. The only way
past it is `released` — note ids the user let through once, which arrive from
the client the same way tool approvals do, on a channel retrieved text cannot
reach.

Fail closed: if the levels cannot be looked up, every row is treated as
private.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Iterable, Iterator

LEVELS = ("open", "personal", "private")
_RANK = {lvl: i for i, lvl in enumerate(LEVELS)}
DEFAULT_LEVEL = "personal"


def normalize(level: str | None) -> str:
    return level if level in _RANK else DEFAULT_LEVEL


def level_of(row: dict) -> str:
    """A note row's level. Rows read before migration 029 have only
    `local_only`; it means the same as private."""
    if row.get("sensitivity") in _RANK:
        return row["sensitivity"]
    return "private" if row.get("local_only") else DEFAULT_LEVEL


def allows(ceiling: str, level: str) -> bool:
    return _RANK[normalize(level)] <= _RANK[normalize(ceiling)]


def provider_key(p) -> str:
    """Stable name for trust settings: "anthropic", "gemini", or the host of an
    OpenAI-compatible gateway ("openrouter.ai") — a key differs per gateway,
    the provider kind does not."""
    if p.provider == "openai_compatible":
        host = (p.base_url or "").split("//")[-1].split("/")[0]
        return host or "openai_compatible"
    return p.provider


def ceiling_for(p, untrusted: Iterable[str] = ()) -> str:
    if p.provider == "local":
        return "private"
    if provider_key(p) in set(untrusted):
        return "open"
    return "personal"


@dataclass
class Scope:
    ceiling: str
    user_id: str
    released: frozenset[str] = frozenset()
    #: id -> title of every note held back during this request
    withheld: dict[str, str] = field(default_factory=dict)
    #: released ids that were actually sent
    released_used: set[str] = field(default_factory=set)
    sent: set[str] = field(default_factory=set)


_scope: ContextVar[Scope | None] = ContextVar("privacy_scope", default=None)


@contextmanager
def scope(ceiling: str, user_id: str,
          released: Iterable[str] = ()) -> Iterator[Scope]:
    s = Scope(ceiling=normalize(ceiling), user_id=user_id,
              released=frozenset(str(r) for r in released))
    token = _scope.set(s)
    try:
        yield s
    finally:
        _scope.reset(token)


def current() -> Scope | None:
    return _scope.get()


def fetch_levels(ids: list[str], user_id: str) -> dict[str, dict] | None:
    """{id: {"level", "title"}} per note id, or None when the lookup failed
    (callers fail closed). Falls back to `local_only` when migration 029 is not
    applied yet."""
    if not ids:
        return {}
    from services.database import get_supabase
    for cols in ("id, title, sensitivity, local_only", "id, title, local_only"):
        try:
            rows = (get_supabase().table("notes").select(cols)
                    .in_("id", ids).eq("user_id", user_id).execute().data or [])
        except Exception:
            continue
        return {str(r["id"]): {"level": level_of(r), "title": r.get("title") or ""}
                for r in rows}
    return None


def filter_rows(rows: list[dict], id_key: str = "id",
                title_key: str = "title") -> list[dict]:
    """Drop rows above the current scope's ceiling. Outside a scope (a call
    site not yet routed) rows pass unchanged."""
    s = _scope.get()
    if s is None or not rows:
        return rows
    if s.ceiling == "private":
        s.sent.update(str(r.get(id_key)) for r in rows if r.get(id_key))
        return rows
    ids = sorted({str(r[id_key]) for r in rows if r.get(id_key)})
    known = {str(r[id_key]): level_of(r) for r in rows
             if r.get(id_key) and ("sensitivity" in r or "local_only" in r)}
    missing = [i for i in ids if i not in known]
    looked_up = fetch_levels(missing, s.user_id) if missing else {}
    kept: list[dict] = []
    for r in rows:
        rid = str(r.get(id_key) or "")
        if not rid:
            kept.append(r)
            continue
        if looked_up is None and rid not in known:
            level = "private"                         # fail closed
        else:
            # A note not found under this user is not theirs to send.
            found = (looked_up or {}).get(rid)
            level = known.get(rid) or (found["level"] if found else "private")
        if allows(s.ceiling, level):
            kept.append(r)
            s.sent.add(rid)
        elif rid in s.released:
            kept.append(r)
            s.sent.add(rid)
            s.released_used.add(rid)
        else:
            title = r.get(title_key) or ((looked_up or {}).get(rid) or {}).get("title")
            s.withheld.setdefault(rid, str(title or "Untitled"))
    return kept


def check_note(note_id: str, title: str = "") -> bool:
    """True when one note may be sent under the current scope (records it as
    withheld when not)."""
    return bool(filter_rows([{"id": note_id, "title": title}]))


def refuse_note(note_id: str | None, user_id: str, provider) -> str | None:
    """For surfaces that send a whole open note to one fixed provider (the
    editor AI): a user-facing refusal when the note may not go there, else
    None. Uses the user's routing policy for provider trust."""
    if not note_id:
        return None
    from services.routing.policy import load
    ceiling = ceiling_for(provider, load(user_id)["privacy"]["untrusted"])
    if ceiling == "private":
        return None
    found = fetch_levels([note_id], user_id)
    level = "private" if found is None else (found.get(note_id) or {}).get("level", "private")
    if allows(ceiling, level):
        return None
    where = provider.label or provider.provider
    return (f"This note is {level}, and the editor AI runs on {where}, which "
            f"may only see {ceiling} notes. Change the note's privacy level, "
            "or ask about it in chat on Local.")
