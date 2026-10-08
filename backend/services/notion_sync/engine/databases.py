"""User databases: schema (phases 1-2 of DESIGN §6.1), then rows ride the note pipeline.

Phase 1 creates each database with its scalar properties. Phase 2 adds, across all the
databases of one send: relations (a pair becomes ONE two-way relation, T4), then rollups,
then formulas (they reference relations and each other), then status groups. Nothing is
ever removed from a Notion schema: a property deleted here is left in Notion (never
destructive), and a rename is applied by property id.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from services.notion_sync.engine.store import now
from services.notion_sync.notion import dbschema, views as viewmap
from services.notion_sync.notion.errors import AmbiguousWrite
from services.notion_sync.readers.database import Bundle, database_to_ir, load_database
from services.portable import ir
from services.portable.canonical import digest

log = logging.getLogger(__name__)

STATUS_GROUPS = ("To-do", "In progress", "Complete")


@dataclass
class DbState:
    local_id: str
    bundle: Bundle
    obj: ir.Obj
    defs: list[dict]
    layout: dbschema.Layout
    ds_local: str
    notion_db: str = ""
    notion_ds: str = ""
    have: dict = field(default_factory=dict)           # Notion property name -> {"id","type"}
    parent_page: str = ""
    created: bool = False
    finished: bool = False
    item_losses: list = field(default_factory=list)


class DatabaseMixin:
    """Mixed into Engine (needs .db, .store, .adapter, .conn, _root, _adopt_or_none, ...)."""

    def _db_state(self, db_id: str) -> DbState:
        cache = self.__dict__.setdefault("_dbstates", {})
        if db_id in cache:
            return cache[db_id]
        b = load_database(self.db, self.conn.user_id, db_id)
        if b is None or not b.sources:
            from services.notion_sync.engine.runner import ItemFailure
            raise ItemFailure("failed", "permanent", "no_database", "This database no longer exists or has no table.")
        obj = database_to_ir(b)
        defs = obj.props["data_source"]["properties"]
        st = DbState(db_id, b, obj, defs, dbschema.layout(defs), obj.props["data_source"]["id"])
        cache[db_id] = st
        return st

    def row_context(self, note_id: str):
        """-> (database id, data source id) when this note is a database row, else None."""
        rows = (self.db.table("db_row_props").select("data_source_id").eq("note_id", note_id)
                .eq("user_id", self.conn.user_id).execute().data or [])
        if not rows:
            return None
        ds = (self.db.table("db_data_sources").select("id, database_id, system_kind").eq("id", rows[0]["data_source_id"])
              .execute().data or [])
        if not ds or ds[0].get("system_kind"):
            return None
        return ds[0]["database_id"], ds[0]["id"]

    # ---- parent of a database ----------------------------------------------------------------
    def _db_parent_page(self, st: DbState) -> str:
        host = st.bundle.database.get("parent_note_id")
        if not host:
            return self._root()
        m = self.store.mapping("note", str(host))
        if m and m.get("notion_id"):
            return m["notion_id"]
        from services.notion_sync.engine.resolver import MentionResolver
        from services.notion_sync.planner import PlanItem, NEW, fetch_notes
        rows = fetch_notes(self.db, self.conn.user_id, [str(host)])
        if not rows:
            return self._root()
        resolver = MentionResolver(self.db, self.store, self.conn.user_id, self.conn.privacy_ceiling)
        self._shell(PlanItem(str(host), "", NEW), rows[str(host)], resolver)
        return self.store.mapping("note", str(host))["notion_id"]

    # ---- phase 1 -------------------------------------------------------------------------------
    def build_database(self, db_id: str) -> DbState:
        st = self._db_state(db_id)
        if st.notion_ds:
            return st
        st.parent_page = self._db_parent_page(st)
        m, ours = self.store.begin_create("database", db_id, parent=st.parent_page)
        mds = self.store.mapping("data_source", st.ds_local)
        r = self.adapter.materialize_cover(self.adapter.render(st.obj))
        title = "".join(t.text for t in st.obj.title)
        try:
            if m.get("state") in ("synced", "failed") and m.get("notion_id") and mds and mds.get("notion_id"):
                st.notion_db, st.notion_ds = m["notion_id"], mds["notion_id"]
            else:
                found = [] if ours else [d for d in self.adapter.find_databases(st.parent_page, title)]
                if found:
                    info = found[0]
                else:
                    info = self.adapter.create_database(st.parent_page, r, st.layout.initial,
                                                        inline=bool(st.obj.props.get("inline")))
                    st.created = True
                st.notion_db, st.notion_ds = info.database_id, info.data_source_id
                self.store.cas(m["id"], "creating", {"notion_id": info.database_id, "notion_kind": "database",
                                                     "notion_parent_id": st.parent_page, "state": "synced"})
                mds2, _ = self.store.begin_create("data_source", st.ds_local, parent=info.database_id)
                self.store.cas(mds2["id"], "creating", {"notion_id": info.data_source_id, "notion_kind": "data_source",
                                                        "notion_parent_id": info.database_id, "state": "synced"})
        except AmbiguousWrite:
            from services.notion_sync.engine.runner import _ambiguous
            raise _ambiguous()
        st.have = self.adapter.data_source_props(st.notion_ds)
        self._sync_scalar_schema(st)
        return st

    def _sync_scalar_schema(self, st: DbState) -> None:
        """Add what is missing and rename what was renamed here (by property id). Never removes."""
        mds = self.store.mapping("data_source", st.ds_local)
        recorded = ((mds or {}).get("block_index") or {}).get("props") or {}
        patch: dict = {}
        for key, rec in recorded.items():
            want = st.layout.names.get(key)
            cur = st.have.get(rec.get("name"))
            if want and cur and rec.get("name") != want and want not in st.have:
                patch[cur["id"]] = {"name": want}
        add = {n: s for n, s in st.layout.initial.items() if n not in st.have and n not in {v["name"] for v in patch.values()}
               and not any(rec.get("name") == n for rec in recorded.values())}
        if patch or add:
            self.adapter.patch_data_source(st.notion_ds, {**patch, **add})
            st.have = self.adapter.data_source_props(st.notion_ds)

    # ---- phase 2 -------------------------------------------------------------------------------
    def finish_schemas(self, states: list[DbState]) -> None:
        by_ds = {s.ds_local: s for s in states}
        recorded = {st.ds_local: (((self.store.mapping("data_source", st.ds_local) or {}).get("block_index") or {}).get("props") or {})
                    for st in states}
        self._xs = {}                                       # key -> hash of the spec we wrote, saved below
        # 1. relations (a forward/reverse pair is one two-way relation)
        for st in states:
            for rel in st.layout.relations:
                if rel["name"] in st.have:
                    continue
                tgt = by_ds.get(rel["target"]) or self._known_state(rel["target"])
                if tgt is None or not tgt.notion_ds:
                    st.layout.losses.append(dbschema.Loss("lossy", f"The relation “{rel['name']}” to a database that is not being sent.",
                                                          "It is not created in Notion.", "relation_target_missing"))
                    continue
                other = self._reverse_of(rel, by_ds, tgt)
                if other and other["name"] not in tgt.have:
                    spec = {"relation": {"data_source_id": tgt.notion_ds, "type": "dual_property",
                                         "dual_property": {"synced_property_name": other["name"]}}}
                elif other:
                    continue                      # the reverse side already exists: this one is its twin
                else:
                    spec = {"relation": {"data_source_id": tgt.notion_ds, "type": "single_property", "single_property": {}}}
                self.adapter.patch_data_source(st.notion_ds, {rel["name"]: spec})
                st.have = self.adapter.data_source_props(st.notion_ds)
                tgt.have = self.adapter.data_source_props(tgt.notion_ds) if tgt is not st else st.have
        # 2. rollups, 3. formulas
        for st in states:
            for ro in st.layout.rollups:
                rel_name = st.layout.names.get(ro["relation_key"])
                tgt = by_ds.get(ro["target_ds"]) or self._known_state(ro["target_ds"])
                tname = tgt.layout.names.get(ro["target_key"]) if tgt else None
                x = digest([rel_name, tname, ro["function"]])
                self._xs[(st.ds_local, ro["key"])] = x
                if ro["name"] in st.have and recorded[st.ds_local].get(ro["key"], {}).get("x") == x:
                    continue
                if not (rel_name and tname and rel_name in st.have):
                    st.layout.losses.append(dbschema.Loss("lossy", f"The rollup “{ro['name']}”.",
                                                          "It is not created in Notion; its value is kept in the “(SB value)” column.",
                                                          "rollup_not_created"))
                    continue
                self._try_property(st, ro["name"], {"rollup": {"relation_property_name": rel_name,
                                                               "rollup_property_name": tname, "function": ro["function"]}},
                                   "rollup_rejected")
        for st in states:
            for fo in st.layout.formulas:
                expr = dbschema.rewrite_expression(fo["expression"], st.layout.names, st.defs)
                x = digest(expr)
                self._xs[(st.ds_local, fo["key"])] = x
                if fo["name"] in st.have and recorded[st.ds_local].get(fo["key"], {}).get("x") == x:
                    continue
                self._try_property(st, fo["name"], {"formula": {"expression": expr}}, "formula_rejected")
        # 4. status groups (where each option sits: To-do / In progress / Complete)
        for st in states:
            self._apply_status_groups(st)
        for st in states:
            st.have = self.adapter.data_source_props(st.notion_ds)
            st.finished = True
            props = {k: {"name": n, "id": (st.have.get(n) or {}).get("id"),
                         **({"x": self._xs[(st.ds_local, k)]} if (st.ds_local, k) in self._xs else {})}
                     for k, n in st.layout.names.items()}
            m = self.store.mapping("data_source", st.ds_local)
            self.store.update(m["id"], {"block_index": {"v": 1, "props": props}, "last_pushed_at": now()})

    def _known_state(self, ds_local: str) -> DbState | None:
        """A data source already sent in an earlier run (its database is not in this one)."""
        m = self.store.mapping("data_source", ds_local)
        if not m or not m.get("notion_id"):
            return None
        src = (self.db.table("db_data_sources").select("database_id").eq("id", ds_local).execute().data or [])
        if not src:
            return None
        st = self._db_state(src[0]["database_id"])
        st.notion_ds, st.notion_db = m["notion_id"], m.get("notion_parent_id") or ""
        st.have = self.adapter.data_source_props(st.notion_ds)
        return st

    def _reverse_of(self, rel: dict, by_ds: dict, tgt: DbState) -> dict | None:
        for r in tgt.layout.relations:
            if r["relation_id"] and r["relation_id"] == rel["relation_id"] and r["key"] != rel["key"]:
                return r
        return None

    def _try_property(self, st: DbState, name: str, spec: dict, loss_code: str) -> None:
        from services.notion_sync.notion.errors import NotionError
        try:
            self.adapter.patch_data_source(st.notion_ds, {name: spec})
        except NotionError as e:
            if e.code != "validation_error":
                raise
            st.layout.losses.append(dbschema.Loss("approximated", f"Notion refused “{name}”.",
                                                  "Its value is kept in the “(SB value)” column.", loss_code))

    def _apply_status_groups(self, st: DbState) -> None:
        from services.notion_sync.notion.errors import NotionError
        for key, groups in st.layout.status_groups.items():
            name = st.layout.names[key]
            if not groups or all(g == "To-do" for g in groups.values()):
                continue
            try:
                ds = self.adapter.c.get(f"/data_sources/{st.notion_ds}")["properties"][name]["status"]
                ids = {o["name"]: o["id"] for o in ds.get("options", [])}
                spec = [{"name": gname, "option_ids": [ids[o] for o, g in groups.items() if g == gname and o in ids]}
                        for gname in STATUS_GROUPS]
                self.adapter.patch_data_source(st.notion_ds, {name: {"status": {"groups": spec}}})
            except (NotionError, KeyError):
                st.layout.losses.append(dbschema.Loss("approximated", f"Which group each option of “{name}” is in.",
                                                      "All options sit in “To-do”.", "status_groups"))


    # ---- views (M7) ------------------------------------------------------------------------------
    def sync_views(self, st: DbState) -> list:
        """Create/update this database's views. Runs after the schema (it needs property ids).
        Notion's own "Default view" is removed once ours exist; none of OUR views is ever deleted
        here (a view deleted in the app is left in Notion)."""
        from services.notion_sync.notion.errors import NotionError
        views = sorted(st.obj.props.get("views") or [], key=lambda v: v.get("position") or 0)
        losses: list = []
        if not views:
            return losses
        ids = {k: st.have[n]["id"] for k, n in st.layout.names.items() if n in st.have and st.have[n].get("id")}
        types = {d["key"]: d["type"] for d in st.defs}
        opts = {d["key"]: {o.get("id"): o.get("name") for o in (d.get("config") or {}).get("options") or []} for d in st.defs}
        resolver = getattr(self, "_view_resolver", None)
        ctx = viewmap.ViewCtx(ids, types, opts, (lambda nid: (resolver(nid)[1] if resolver and resolver(nid)[0] == "page" else None)))
        built = {v["id"]: viewmap.build(v, ctx) for v in views}
        wanted_widgets: dict[str, viewmap.Built] = {}
        made = 0
        for v in views:
            b = built[v["id"]]
            losses += b.losses
            if b.payload is None or v.get("type") == "dashboard":
                continue
            made += self._sync_one_view(st, "view", v["id"], b.payload)
        for v in views:
            b = built[v["id"]]
            if v.get("type") != "dashboard" or b.payload is None:
                continue
            dash = self._sync_one_view(st, "view", v["id"], b.payload, dashboard=True)
            made += dash
            dm = self.store.mapping("view", v["id"])
            for wid in b.widgets:
                wb = built.get(wid)
                if wb is None or wb.payload is None:
                    losses.append(viewmap.Loss("lossy", f"A widget of the dashboard “{v.get('name')}” that is not a view of this table.",
                                               "It is left out.", "view_widget_missing"))
                    continue
                self._sync_one_view(st, "widget", f"{v['id']}:{wid}", wb.payload, dashboard_notion_id=dm["notion_id"])
        if st.created and made:
            self._drop_default_view(st)
        return losses

    def _sync_one_view(self, st: DbState, kind: str, local_id: str, payload: dict, *, dashboard: bool = False,
                       dashboard_notion_id: str | None = None) -> int:
        h = digest(payload)
        m, ours = self.store.begin_create(kind, local_id, parent=st.notion_db)
        if m.get("state") == "synced" and m.get("notion_id"):
            if m.get("local_hash") == h:
                return 0
            self.adapter.patch_view(m["notion_id"], payload)
            self.store.update(m["id"], {"local_hash": h, "last_pushed_at": now()})
            return 0
        vid = None
        if not ours:                                         # reconcile: a view we may have created before a crash
            known = {x.get("notion_id") for x in self.db.table("notion_mappings").select("notion_id")
                     .eq("connection_id", self.conn.id).in_("local_kind", ["view", "widget"]).execute().data or []}
            for cand in self.adapter.list_view_ids(st.notion_db):
                if cand not in known and self.adapter.get_view(cand).get("name") == payload.get("name"):
                    vid = cand
                    break
        if vid is None:
            vid = (self.adapter.create_dashboard(st.notion_db, st.notion_ds, payload) if dashboard
                   else self.adapter.create_view(st.notion_db, st.notion_ds, payload, dashboard_id=dashboard_notion_id))
        self.store.cas(m["id"], "creating", {"notion_id": vid, "notion_kind": "view", "state": "synced",
                                             "local_hash": h, "last_pushed_at": now()})
        return 1

    def _drop_default_view(self, st: DbState) -> None:
        """The empty "Default view" Notion makes with every new database goes once ours exist."""
        mine = {x.get("notion_id") for x in self.db.table("notion_mappings").select("notion_id")
                .eq("connection_id", self.conn.id).in_("local_kind", ["view", "widget"]).execute().data or []}
        for vid in self.adapter.list_view_ids(st.notion_db):
            if vid not in mine and self.adapter.get_view(vid).get("name") == "Default view":
                self.adapter.delete_view(vid)
