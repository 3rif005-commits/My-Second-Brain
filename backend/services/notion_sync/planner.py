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
from services.notion_sync.engine import editcheck
from services.notion_sync.engine.resolver import MentionResolver, db_page_resolver, link_tags
from services.notion_sync.engine.store import Store
from services.notion_sync.notion.adapter import NotionAdapter, page_url
from services.notion_sync.notion import dbschema
from services.notion_sync.include import include_of
from services.notion_sync.readers.database import (database_of_source, database_to_ir, load_database,
                                                   relation_targets, relation_values, row_to_ir)
from services.notion_sync.readers import objects as objs
from services.notion_sync.readers.note import collection_to_ir, note_to_ir
from services.portable import ir
from services.portable.canonical import digest
from services.portable.losses import fidelity
from services.portable.markdown import to_markdown

# plan item states
NEW, CHANGED, UNCHANGED = "new", "changed", "unchanged"
PRIVATE, PAUSED, MISSING, DELETED = "private", "paused", "missing", "deleted"
NEEDS_YOU = "needs_you"
STATES = (NEW, CHANGED, UNCHANGED, PRIVATE, PAUSED, MISSING, DELETED, NEEDS_YOU)
RESOLUTIONS = ("overwrite", "copy", "recreate", "forget")   # "skip" is the default: nothing happens


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
    needs: dict | None = None       # why it needs you: edited in Notion / unreachable, with the diff
    resolution: str | None = None   # what you chose for it (RESOLUTIONS)

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in (
            "note_id", "title", "state", "kind", "fidelity", "losses", "est_requests", "notion_url",
            "mapping_id", "released", "selected", "restore", "moved", "path", "needs", "resolution")}

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


def database_scope(db, user: str, selected: list[str], include_linked: bool, row_dbs: list[str]) -> tuple[list[str], list[str], list[str]]:
    """-> (selected databases incl. linked ones, schema-only databases it needs, row note ids).
    Relations pull their target databases into the SCHEMA set (a relation needs its target to
    exist); `include_linked` also sends their rows."""
    def targets(dbid: str) -> list[str]:
        b = load_database(db, user, dbid)
        if b is None or not b.sources:
            return []
        out = []
        for ds in relation_targets([{"type": p["type"], "config": p.get("config") or {}} for p in b.props[b.sources[0]["id"]]]):
            t = database_of_source(db, ds)
            if t:
                out.append(t)
        return out

    chosen = list(dict.fromkeys(selected))
    schema_only: list[str] = []
    queue = list(chosen) + list(row_dbs)
    seen = set(queue)
    while queue:
        cur = queue.pop(0)
        for t in targets(cur):
            if t not in seen:
                seen.add(t)
                queue.append(t)
                if include_linked and cur in chosen:
                    chosen.append(t)
                else:
                    schema_only.append(t)
    schema_only = [d for d in dict.fromkeys(row_dbs + schema_only) if d not in chosen]
    rows: list[str] = []
    for dbid in chosen:
        b = load_database(db, user, dbid)
        if b and b.sources:
            rp = (db.table("db_row_props").select("note_id, position").eq("data_source_id", b.sources[0]["id"])
                  .eq("user_id", user).execute().data or [])
            rows += [str(r["note_id"]) for r in sorted(rp, key=lambda r: r.get("position") or 0)]
    return chosen, schema_only, rows


def plan_scope(db, conn: Connection, adapter: NotionAdapter, *, note_ids=(), collection_ids=(), database_ids=(),
               include_linked: bool = False,
               released=frozenset(), archive_ids=frozenset(), resolutions=None, check_edits: bool = True,
               collections_only=(), thread_ids=(), skill_names=(), sources: bool | None = None) -> Plan:
    resolutions = {str(k): v for k, v in (resolutions or {}).items() if v in RESOLUTIONS}
    user = conn.user_id
    store = Store(db, user, conn.id)
    colls = fetch_collections(db, user)
    tree = subtree(colls, [str(c) for c in collection_ids])
    explicit = list(dict.fromkeys(str(i) for i in note_ids))
    # --- databases: the ones asked for, what their relations need, and their rows
    explicit_rows: dict[str, str] = {}
    if explicit:
        for r in db.table("db_row_props").select("note_id, data_source_id").eq("user_id", user).in_("note_id", explicit).execute().data or []:
            dbid = database_of_source(db, str(r["data_source_id"]))
            if dbid:
                explicit_rows[str(r["note_id"])] = dbid
    chosen_dbs, schema_dbs, db_rows = database_scope(db, user, [str(d) for d in database_ids], include_linked,
                                                    sorted(set(explicit_rows.values())))
    explicit = list(dict.fromkeys(explicit + db_rows))

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
    for cid in (str(c) for c in collections_only):        # exactly these, without what is inside
        for a in ancestors(colls, cid):
            if a not in need:
                need.append(a)
    need.sort(key=lambda c: len(ancestors(colls, c)))

    cmaps = store.mappings_for("collection", need)
    nmaps = store.mappings_for("note", list(live) + list(trashed))
    will_exist = {i for i in live_order if not (nmaps.get(i) or {}).get("notion_id")}
    resolver = MentionResolver(db, store, user, conn.privacy_ceiling, released, will_exist)

    items: list[PlanItem] = []
    bundles: dict[str, object] = {}

    def bundle(dbid):
        if dbid not in bundles:
            bundles[dbid] = load_database(db, user, dbid)
        return bundles[dbid]

    dmaps = store.mappings_for("database", chosen_dbs + schema_dbs)
    for dbid in chosen_dbs + schema_dbs:
        b = bundle(dbid)
        if b is None or not b.sources:
            items.append(PlanItem(dbid, "(database not found)", MISSING, "database"))
            continue
        obj = database_to_ir(b)
        h = object_hash(obj, conn)
        m = dmaps.get(dbid)
        lay = dbschema.layout(obj.props["data_source"]["properties"])
        r = adapter.render(obj)
        exists = bool(m and m.get("notion_id") and m.get("state") in ("synced", "failed"))
        state = UNCHANGED if exists and m.get("local_hash") == h and m.get("state") == "synced" else CHANGED if exists else NEW
        losses = list(r.losses) + lay.losses
        items.append(PlanItem(dbid, "".join(t.text for t in obj.title), state, "database", fidelity(losses),
                              [x.to_dict() for x in losses],
                              0 if state == UNCHANGED else 4 + len(lay.relations) + len(lay.rollups) + len(lay.formulas),
                              page_url(m["notion_id"]) if exists else None, h, m["id"] if m else None,
                              path="Databases" + ("" if dbid in chosen_dbs else " (needed by a relation)")))

    for cid in need:
        row = colls[cid]
        obj = collection_to_ir(row)
        h = object_hash(obj, conn)
        m = cmaps.get(cid)
        r = adapter.render(obj)
        exists = bool(m and m.get("notion_id") and m.get("state") in ("synced", "failed"))
        state = UNCHANGED if exists and m.get("local_hash") == h and m.get("state") == "synced" \
            else CHANGED if exists else NEW
        needs, res_choice = None, None
        if state == CHANGED and check_edits:
            needs = editcheck.check(adapter, conn, m, to_markdown(obj.body))
            res_choice = resolutions.get(cid)
            if needs and res_choice not in ("overwrite", "recreate", "forget"):
                state = NEEDS_YOU
            elif needs:
                needs = None
        items.append(PlanItem(cid, row.get("name") or "Untitled folder", state, "collection",
                              fidelity(r.losses), [x.to_dict() for x in r.losses],
                              0 if state == UNCHANGED else 2 + len(r.blocks), page_url(m["notion_id"]) if exists else None,
                              h, m["id"] if m else None, path=path_of(colls, str(row.get("parent_id")) if row.get("parent_id") else None),
                              needs=needs, resolution=res_choice))

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
        rowdb = _row_database(db, user, nid)
        if rowdb:
            b = bundle(rowdb[0])
            if b is not None and b.sources:
                rp = (db.table("db_row_props").select("*").eq("note_id", nid).execute().data or [None])[0]
                obj = row_to_ir(obj, b, row, rp, relation_values(db, user, [_pd(p) for p in b.props[b.sources[0]["id"]]], nid))
        if sources if sources is not None else include_of(conn)["source_files"]:
            obj = objs.add_sources(db, user, obj, nid)
        h = object_hash(obj, conn, link_tags(obj, resolver))
        rendered = adapter.render(obj, resolver, db_page_resolver(store, m))
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
        needs, res_choice = None, None
        if state == CHANGED and check_edits and not restore and m.get("state") != "failed":
            needs = editcheck.check(adapter, conn, m, to_markdown(obj.body))
            res_choice = resolutions.get(nid)
            if needs and res_choice in RESOLUTIONS:
                needs = None
            elif needs:
                state = NEEDS_YOU
        elif state == CHANGED:
            res_choice = resolutions.get(nid)
        released_now = nid in released and not privacy.allows(conn.privacy_ceiling, level)
        items.append(PlanItem(nid, title, state, "note", fid, losses, est, url, h, m["id"] if m else None,
                              released=released_now, restore=restore,
                              moved=bool(exists and m.get("notion_parent_id") != _target_ds(store, conn, cid)),
                              path=path, needs=needs, resolution=res_choice))

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
    items += _object_items(db, conn, adapter, store, [str(t) for t in thread_ids], [str(s_) for s_ in skill_names], released)
    return Plan(items)


def _object_items(db, conn, adapter, store, thread_ids, skill_names, released) -> list[PlanItem]:
    """Chat threads and skills ("the rest of the brain")."""
    out: list[PlanItem] = []
    user = conn.user_id
    if thread_ids:
        rows = {str(r["id"]): r for r in (db.table("chat_threads").select("*").eq("user_id", user).in_("id", thread_ids)
                                          .execute().data or [])}
        tmaps = store.mappings_for("thread", thread_ids)
        for tid in thread_ids:
            row = rows.get(tid)
            if row is None:
                out.append(PlanItem(tid, "(chat not found)", MISSING, "thread"))
                continue
            title = objs.thread_title(row)
            m = tmaps.get(tid)
            cited = [str(c) for c in row.get("context_note_ids") or []]
            levels = {str(n["id"]): privacy.level_of(n) for n in (
                db.table("notes").select("id, sensitivity, local_only").eq("user_id", user).in_("id", cited).execute().data or [])} if cited else {}
            # a chat is as private as the most private note it cites; a note that cannot be found counts as private
            blocked = any(not privacy.allows(conn.privacy_ceiling, levels.get(c, "private")) for c in cited)
            if blocked and tid not in released:
                out.append(PlanItem(tid, title, PRIVATE, "thread", path="Chats"))
                continue
            obj = objs.thread_to_ir(row)
            h = object_hash(obj, conn)
            r = adapter.render(obj)
            exists = bool(m and m.get("notion_id") and m.get("state") in ("synced", "failed"))
            state = UNCHANGED if exists and m.get("local_hash") == h and m.get("state") == "synced" else CHANGED if exists else NEW
            out.append(PlanItem(tid, title, state, "thread", fidelity(r.losses), [x.to_dict() for x in r.losses],
                                0 if state == UNCHANGED else 3 + len(r.blocks), page_url(m["notion_id"]) if exists else None,
                                h, m["id"] if m else None, released=blocked and tid in released, path="Chats"))
    if skill_names:
        skills = objs.load_skills(objs.skill_dirs())
        smaps = store.mappings_for("skill", skill_names)
        for name in skill_names:
            sk = skills.get(name)
            if sk is None:
                out.append(PlanItem(name, name, MISSING, "skill"))
                continue
            obj = objs.skill_to_ir(name, sk)
            h = object_hash(obj, conn)
            r = adapter.render(obj)
            m = smaps.get(name)
            exists = bool(m and m.get("notion_id") and m.get("state") in ("synced", "failed"))
            state = UNCHANGED if exists and m.get("local_hash") == h and m.get("state") == "synced" else CHANGED if exists else NEW
            out.append(PlanItem(name, name, state, "skill", fidelity(r.losses), [x.to_dict() for x in r.losses],
                                0 if state == UNCHANGED else 3 + len(r.blocks), page_url(m["notion_id"]) if exists else None,
                                h, m["id"] if m else None, path="Skills"))
    return out


def _row_database(db, user: str, note_id: str):
    """-> (database id, data source id) if this note is a row of a real database."""
    r = (db.table("db_row_props").select("data_source_id").eq("note_id", note_id).eq("user_id", user).execute().data or [])
    if not r:
        return None
    dbid = database_of_source(db, str(r[0]["data_source_id"]))
    return (dbid, str(r[0]["data_source_id"])) if dbid else None


def _pd(p: dict) -> dict:
    from services.notion_sync.readers.database import prop_def
    return prop_def(p)


def _target_ds(store: Store, conn: Connection, cid: str | None) -> str | None:
    """The data source a note of collection `cid` belongs in, if it exists yet."""
    m = store.mapping("container", cid or conn.root_page_id or "", "notes_db")
    return m.get("notion_id") if m and m.get("state") == "synced" else None


def plan_notes(db, conn, adapter, note_ids, released=frozenset()) -> Plan:
    """M1 entry point: a list of notes."""
    return plan_scope(db, conn, adapter, note_ids=note_ids, released=released)
