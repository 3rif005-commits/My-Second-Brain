"""How a link to another note is written: a real Notion mention when the target
is already in Notion, a text note when it is not, a lock when it is private.

The same resolver feeds the hash (as `tags`), so a note is re-sent exactly when
a link it contains changes from "not in Notion" to "in Notion" (a dependency
edge, DESIGN §6.1).
"""
from __future__ import annotations

import re

from services import privacy
from services.notion_sync.engine.store import Store
from services.portable import ir

_NOTE_LINK = re.compile(r"(?:^|/)brain/([0-9a-fA-F]{8}-[0-9a-fA-F-]{27})(?:[/?#].*)?$")


def link_targets(obj: ir.Obj) -> list[str]:
    """Ids of every note this page links to (mentions and /brain/<id> links)."""
    found: list[str] = []

    def inline(items):
        for i in items:
            if isinstance(i, ir.Mention):
                found.append(i.target.id)
            elif isinstance(i, ir.Text) and i.link:
                m = _NOTE_LINK.search(i.link)
                if m:
                    found.append(m.group(1).lower())

    inline(obj.title)
    for b in ir.walk(obj.body):
        inline(b.inline)
    return sorted(set(found))


class MentionResolver:
    def __init__(self, db, store: Store, user_id: str, ceiling: str, released=frozenset(),
                 will_exist=frozenset()):
        self.db, self.store, self.user_id = db, store, user_id
        self.ceiling, self.released, self.will_exist = ceiling, frozenset(released), frozenset(will_exist)
        self._levels: dict[str, str] = {}
        self._maps: dict[str, dict | None] = {}

    def _level(self, note_id: str) -> str:
        if note_id not in self._levels:
            try:
                rows = (self.db.table("notes").select("id, sensitivity, local_only").eq("id", note_id)
                        .eq("user_id", self.user_id).execute().data or [])
                level = privacy.level_of(rows[0]) if rows else "private"     # not found / not yours: closed
            except Exception:
                level = "private"                                           # fail closed
            self._levels[note_id] = level
        return self._levels[note_id]

    def _mapping(self, note_id: str) -> dict | None:
        if note_id not in self._maps:
            self._maps[note_id] = self.store.mapping("note", note_id)
        return self._maps[note_id]

    def forget(self, note_id: str) -> None:
        self._maps.pop(note_id, None)

    def __call__(self, note_id: str) -> tuple[str, str | None]:
        if not privacy.allows(self.ceiling, self._level(note_id)) and note_id not in self.released:
            return "private", None
        m = self._mapping(note_id)
        if m and m.get("notion_id") and m.get("state") in ("synced", "failed", "archived"):
            return "page", m["notion_id"]
        if note_id in self.will_exist:
            return "page", "pending"
        return "unmirrored", None

    def tags(self, obj: ir.Obj) -> list[tuple[str, str]]:
        return [(t, self(t)[0]) for t in link_targets(obj)]


def link_tags(obj: ir.Obj, resolver: "MentionResolver") -> list[tuple[str, str]]:
    """What a note's hash must notice: how each linked note would be written, and which related
    rows of a database are in Notion yet (a relation value arrives when its target does)."""
    tags = list(resolver.tags(obj))
    for v in ((obj.props.get("db") or {}).get("values") or {}).values():
        if v.get("type") == "relation":
            tags += [(f"rel:{t}", resolver(t)[0]) for t in v.get("value") or []]
    return sorted(tags)
