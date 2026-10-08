"""The dry run: what would a send do, and what would be lost? No Notion calls.

Scope = notes and/or collections ("with everything inside"). Each item is read ->
IR -> hashed -> compared with the identity map, then rendered (pure) so the
losses are the ones the real send would produce. An unchanged hash is a `noop`:
re-sending makes zero writes (ROBUSTNESS §4).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from services import privacy
from services.notion_sync import registry
from services.notion_sync.connection import Connection
from services.notion_sync.engine.resolver import MentionResolver
from services.notion_sync.engine.store import Store
from services.notion_sync.notion.adapter import NotionAdapter, page_url
from services.notion_sync.readers.note import collection_to_ir, note_to_ir
from services.portable import ir
from services.portable.canonical import digest
from services.portable.losses import fidelity

# plan item states
NEW, CHANGED, UNCHANGED = "new", "changed", "unchanged"
PRIVATE, PAUSED, MISSING, DELETED = "private", "paused", "missing", "deleted"
STATES = (NEW, CHANGED, UNCHANGED, PRIVATE, PAUSED, MISSING, DELETED)


@dataclass
class PlanItem:
    note_id: str                    # the item's local id (a note or a collection)
    title: str
    state: str                      # see STATES
    kind: str = "note"              # note | collection
    fidelity: str = "exact"         # exact | approximated | lossy
    losses: list[dict] = field(default_factory=list)
    est_requests: int = 0
    notion_url: str | None = None
    hash: str = ""
    mapping_id: str | None = None
    released: bool = False          # a private note let through for this run
    selected: bool = True           # deletes are listed UNCHECKED (D2)
    restore: bool = False           # a note that was archived and is back
    moved: bool = False             # sent to a different collection than before
    path: str = ""                  # "Physics › Optics"

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in (
            "note_id", "title", "state", "kind", "fidelity", "losses", "est_requests", "notion_url",
            "mapping_id", "released", "selected", "restore", "moved", "path")}

    @property
    def sendable(self) -> bool:
        return self.state in (NEW, CHANGED) or (self.state == DELETED and self.selected)


@dataclass
class Plan:
    items: list[PlanItem]

    @property
    def sendable(self) -> list[PlanItem]:
        return [i for i in self.items if i.sendable]

    def counts(self) -> dict:
        c = {s: 0 for s in STATES}
        for i in self.items:
            c[i.state] += 1
        return c

    def to_dict(self) -> dict:
        s = self.sendable
        return {"items": [i.to_dict() for i in self.items], "counts": self.counts(),
                "nothing_to_send": not s, "est_requests": sum(i.est_requests for i in s)}


def destination_config(conn: Connection) -> dict:
    """Part of every hash: sending somewhere else makes everything 'changed'."""
    return {"root": conn.root_page_id, "layout": "tree-of-databases"}


def object_hash(obj: ir.Obj, conn: Connection, link_tags=()) -> str:
    d = obj.to_dict()
    d.pop("meta", None)             # timestamps are carried along but never decide "changed"
    return digest(d, registry.mapper_set_version(), destination_config(conn), sorted(link_tags))


note_hash = object_hash


def fetch_notes(db, user_id: str, note_ids: list[str], *, deleted: bool = False) -> dict[str, dict]:
    if not note_ids:
        return {}
    q = db.table("notes").select("*").eq("user_id", user_id).in_("id", note_ids)
    q = q.not_.is_("deleted_at", "null") if deleted else q.is_("deleted_at", "null")
    return {str(r["id"]): r for r in (q.execute().data or [])}


def fetch_collections(db, user_id: str) -> dict[str, dict]:
    rows = db.table("collections").select("*").eq("user_id", user_id).execute().data or []
    return {str(r["id"]): r for r in rows}


def subtree(colls: dict[str, dict], roots: list[str]) -> list[str]:
    """`roots` and every collection below them, parents before children."""
    out, queue = [], [r for r in roots if r in colls]
    while queue:
        cur = queue.pop(0)
        if cur in out:
            continue
        out.append(cur)
        queue += sorted((i for i, c in colls.items() if str(c.get("parent_id")) == cur),
                        key=lambda i: (colls[i].get("position") or 0, colls[i].get("name") or ""))
    return out


def ancestors(colls: dict[str, dict], cid: str | None) -> list[str]:
    """Parent chain of `cid` (inclusive), root-most first."""
    chain, seen = [], set()
    while cid and cid in colls and cid not in seen:
        seen.add(cid)
        chain.append(cid)
        cid = str(colls[cid].get("parent_id")) if colls[cid].get("parent_id") else None
    return chain[::-1]


def path_of(colls: dict[str, dict], cid: str | None) -> str:
    return " › ".join(colls[c].get("name") or "Untitled folder" for c in ancestors(colls, cid))


def plan_scope(db, conn: Connection, adapter: NotionAdapter, *, note_ids=(), collection_ids=(),
               released=frozenset(), archive_ids=frozenset()) -> Plan:
    user = conn.user_id
    store = Store(db, user, conn.id)
    colls = fetch_collections(db, user)
    tree = subtree(colls, [str(c) for c in collection_ids])
    explicit = list(dict.fromkeys(str(i) for i in note_ids))

    live: dict[str, dict] = {}
    trashed: dict[str, dict] = {}
    if tree:
        rows = (db.table("notes").select("*").eq("user_id", user).in_("collection_id", tree).execute().data or [])
        for r in rows:
            (trashed if r.get("deleted_at") else live)[str(r["id"])] = r
    live.update(fetch_notes(db, user, explicit))
    trashed.update(fetch_notes(db, user, explicit, deleted=True))
    order = explicit + [i for i in sorted(live, key=lambda i: (live[i].get("position") or 0, live[i].get("title") or ""))
                        if i not in explicit]
    live_order = [i for i in order if i in live]
    missing = [i for i in explicit if i not in live and i not in trashed]

    need: list[str] = []
    for cid in tree + [c for nid in live_order for c in ancestors(colls, live[nid].get("collection_id") and str(live[nid]["collection_id"]))]:
        if cid not in need:
            need.append(cid)
    need.sort(key=lambda c: len(ancestors(colls, c)))

    cmaps = store.mappings_for("collection", need)
    nmaps = store.mappings_for("note", list(live) + list(trashed))
    will_exist = {i for i in live_order if not (nmaps.get(i) or {}).get("notion_id")}
    resolver = MentionResolver(db, store, user, conn.privacy_ceiling, released, will_exist)

    items: list[PlanItem] = []
    for cid in need:
        row = colls[cid]
        obj = collection_to_ir(row)
        h = object_hash(obj, conn)
        m = cmaps.get(cid)
        r = adapter.render(obj)
        exists = bool(m and m.get("notion_id") and m.get("state") in ("synced", "failed"))
        state = UNCHANGED if exists and m.get("local_hash") == h and m.get("state") == "synced" \
            else CHANGED if exists else NEW
        items.append(PlanItem(cid, row.get("name") or "Untitled folder", state, "collection",
                              fidelity(r.losses), [x.to_dict() for x in r.losses],
                              0 if state == UNCHANGED else 2 + len(r.blocks), page_url(m["notion_id"]) if exists else None,
                              h, m["id"] if m else None, path=path_of(colls, str(row.get("parent_id")) if row.get("parent_id") else None)))

    for nid in live_order:
        row = live[nid]
        title = (row.get("title") or "").strip() or "Untitled"
        level = privacy.level_of(row)
        m = nmaps.get(nid)
        url = page_url(m["notion_id"]) if m and m.get("notion_id") else None
        cid = str(row["collection_id"]) if row.get("collection_id") else None
        path = path_of(colls, cid)
        if not privacy.allows(conn.privacy_ceiling, level) and nid not in released:
            items.append(PlanItem(nid, title, PRIVATE, notion_url=url, path=path))
            continue
        if m and m.get("paused"):
            items.append(PlanItem(nid, title, PAUSED, notion_url=url, mapping_id=m["id"], path=path))
            continue
        obj = note_to_ir(row)
        h = object_hash(obj, conn, resolver.tags(obj))
        rendered = adapter.render(obj, resolver)
        fid = fidelity(rendered.losses)
        losses = [x.to_dict() for x in rendered.losses]
        restore = bool(m and m.get("state") == "archived")
        exists = bool(m and m.get("notion_id") and m.get("state") in ("synced", "failed", "archived"))
        if exists and m.get("local_hash") == h and m.get("state") == "synced":
            state, est = UNCHANGED, 0
        elif exists:
            old = len((m.get("block_index") or {}).get("top") or [])
            state, est = CHANGED, adapter.estimate_requests(rendered, create=False, old_blocks=old) + 2
        else:
            state, est = NEW, adapter.estimate_requests(rendered, create=True) + 3
        released_now = nid in released and not privacy.allows(conn.privacy_ceiling, level)
        items.append(PlanItem(nid, title, state, "note", fid, losses, est, url, h, m["id"] if m else None,
                              released=released_now, restore=restore,
                              moved=bool(exists and m.get("notion_parent_id") != _target_ds(store, conn, cid)),
                              path=path))

    for nid, row in trashed.items():
        m = nmaps.get(nid)
        if m and m.get("notion_id") and m.get("state") != "archived":
            items.append(PlanItem(nid, (row.get("title") or "Untitled").strip(), DELETED, "note",
                                  notion_url=page_url(m["notion_id"]), mapping_id=m["id"],
                                  selected=nid in archive_ids, path=path_of(colls, str(row["collection_id"]) if row.get("collection_id") else None)))
        elif nid in explicit:
            items.append(PlanItem(nid, (row.get("title") or "Untitled").strip(), MISSING))   # in the trash, never sent
    for nid in missing:
        items.append(PlanItem(nid, "(note not found)", MISSING))
    return Plan(items)


def _target_ds(store: Store, conn: Connection, cid: str | None) -> str | None:
    """The data source a note of collection `cid` belongs in, if it exists yet."""
    m = store.mapping("container", cid or conn.root_page_id or "", "notes_db")
    return m.get("notion_id") if m and m.get("state") == "synced" else None


def plan_notes(db, conn, adapter, note_ids, released=frozenset()) -> Plan:
    """M1 entry point: a list of notes."""
    return plan_scope(db, conn, adapter, note_ids=note_ids, released=released)
