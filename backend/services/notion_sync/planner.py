"""The dry run: what would a send do, and what would be lost? No Notion calls.

scope = a list of note ids (M1). Each note is read -> IR -> hashed -> compared
with the identity map, then rendered (pure) so the losses are the ones the real
send would produce. An unchanged hash is a `noop`: re-sending makes zero
writes (ROBUSTNESS §4).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from services import privacy
from services.notion_sync import registry
from services.notion_sync.connection import Connection
from services.notion_sync.engine.store import Store
from services.notion_sync.notion.adapter import NotionAdapter, page_url
from services.notion_sync.readers.note import note_to_ir
from services.portable import ir
from services.portable.canonical import digest
from services.portable.losses import fidelity

# plan item states
NEW, CHANGED, UNCHANGED = "new", "changed", "unchanged"
PRIVATE, PAUSED, MISSING = "private", "paused", "missing"
SENDABLE = (NEW, CHANGED)


@dataclass
class PlanItem:
    note_id: str
    title: str
    state: str                      # new | changed | unchanged | private | paused | missing
    fidelity: str = "exact"         # exact | approximated | lossy
    losses: list[dict] = field(default_factory=list)
    est_requests: int = 0
    notion_url: str | None = None
    hash: str = ""
    mapping_id: str | None = None
    released: bool = False          # a private note let through for this run

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in (
            "note_id", "title", "state", "fidelity", "losses", "est_requests",
            "notion_url", "mapping_id", "released")}


@dataclass
class Plan:
    items: list[PlanItem]

    @property
    def sendable(self) -> list[PlanItem]:
        return [i for i in self.items if i.state in SENDABLE]

    def counts(self) -> dict:
        c = {s: 0 for s in (NEW, CHANGED, UNCHANGED, PRIVATE, PAUSED, MISSING)}
        for i in self.items:
            c[i.state] += 1
        return c

    def to_dict(self) -> dict:
        s = self.sendable
        return {"items": [i.to_dict() for i in self.items], "counts": self.counts(),
                "nothing_to_send": not s,
                "est_requests": sum(i.est_requests for i in s)}


def destination_config(conn: Connection) -> dict:
    """Part of every hash: sending somewhere else makes everything 'changed'."""
    return {"root": conn.root_page_id, "container": "notes_db"}


def note_hash(obj: ir.Obj, conn: Connection) -> str:
    return digest(obj.to_dict(), registry.mapper_set_version(), destination_config(conn))


def fetch_notes(db, user_id: str, note_ids: list[str]) -> dict[str, dict]:
    if not note_ids:
        return {}
    rows = (db.table("notes").select("*").eq("user_id", user_id).in_("id", note_ids)
            .is_("deleted_at", "null").execute().data or [])
    return {str(r["id"]): r for r in rows}


def plan_notes(db, conn: Connection, adapter: NotionAdapter, note_ids: list[str],
               released: set[str] | frozenset[str] = frozenset()) -> Plan:
    ids = list(dict.fromkeys(str(i) for i in note_ids))
    notes = fetch_notes(db, conn.user_id, ids)
    maps = Store(db, conn.user_id, conn.id).mappings_for("note", ids)
    items: list[PlanItem] = []
    for nid in ids:
        row = notes.get(nid)
        if row is None:
            items.append(PlanItem(nid, "(note not found)", MISSING))
            continue
        title = (row.get("title") or "").strip() or "Untitled"
        level = privacy.level_of(row)
        m = maps.get(nid)
        url = page_url(m["notion_id"]) if m and m.get("notion_id") else None
        if not privacy.allows(conn.privacy_ceiling, level) and nid not in released:
            items.append(PlanItem(nid, title, PRIVATE, notion_url=url))
            continue
        if m and m.get("paused"):
            items.append(PlanItem(nid, title, PAUSED, notion_url=url, mapping_id=m["id"]))
            continue
        obj = note_to_ir(row)
        h = note_hash(obj, conn)
        rendered = adapter.render(obj)
        losses = [loss.to_dict() for loss in rendered.losses]
        fid = fidelity(rendered.losses)
        exists = bool(m and m.get("notion_id") and m.get("state") in ("synced", "failed"))
        if exists and m.get("local_hash") == h and m.get("state") == "synced":
            state, est = UNCHANGED, 0
        elif exists:
            old = len((m.get("block_index") or {}).get("top") or [])
            state, est = CHANGED, adapter.estimate_requests(rendered, create=False, old_blocks=old) + 1
        else:
            state, est = NEW, adapter.estimate_requests(rendered, create=True) + 2
        items.append(PlanItem(
            nid, title, state, fid, losses, est, url, h, m["id"] if m else None,
            released=nid in released and not privacy.allows(conn.privacy_ceiling, level)))
    return Plan(items)
