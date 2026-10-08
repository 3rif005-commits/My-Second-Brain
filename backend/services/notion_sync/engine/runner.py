"""Execute a confirmed plan: create protocol, update protocol, runs/items.

Synchronous (a background worker is M5). The create protocol is ROBUSTNESS §4:
the mapping row exists in `creating` BEFORE the create call, a create with an
unknown outcome is never repeated blindly, and a mapping left in `creating` is
reconciled (query by SB ID / list the parent's children) before anything is
created again.

Order inside a run (DESIGN §6.1): collections (parents first) → one empty page
("shell") per new note → note bodies → archives. Shells exist before any body
is written, so notes that mention each other become real links in one run.
"""
from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from services import privacy
from services.notion_sync import registry
from services.notion_sync.connection import Connection
from services.notion_sync.engine.databases import DatabaseMixin
from services.notion_sync.engine.resolver import MentionResolver, link_tags
from services.notion_sync.engine.store import CONTAINER, Store, now
from services.notion_sync.notion import dbschema
from services.notion_sync.notion.adapter import (ARCHIVE_TITLE, NotionAdapter, Rendered, page_url)
from services.notion_sync.notion.properties import TITLE_PROP
from services.notion_sync.notion.errors import AmbiguousWrite, NotionError, SyncPaused, plain_message
from services.notion_sync.planner import (CHANGED, DELETED, NEW, PlanItem, fetch_collections, fetch_notes,
                                          object_hash)
from services.notion_sync.readers.database import relation_values, row_to_ir
from services.notion_sync.readers.note import collection_to_ir, note_to_ir
from services.portable import ir
from services.portable.losses import dedupe

log = logging.getLogger(__name__)

_locks: dict[str, threading.Lock] = {}


def connection_lock(connection_id: str) -> threading.Lock:
    """One send at a time per connection (ADR-12)."""
    return _locks.setdefault(connection_id, threading.Lock())


class ItemFailure(Exception):
    def __init__(self, status: str, error_class: str, code: str, message: str):
        super().__init__(message)
        self.status, self.error_class, self.code, self.message = status, error_class, code, message


def _ambiguous() -> ItemFailure:
    return ItemFailure("failed", "retryable", "ambiguous_create", plain_message(AmbiguousWrite("create", "")))


@dataclass
class ItemResult:
    note_id: str
    title: str
    status: str                        # done | failed | needs_you | skipped
    action: str = ""
    message: str = ""
    notion_url: str | None = None
    losses: list[dict] = field(default_factory=list)
    kind: str = "note"

    def to_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class RunResult:
    run_id: str
    status: str
    items: list[ItemResult]
    requests: int

    def to_dict(self) -> dict:
        return {"run_id": self.run_id, "status": self.status, "requests": self.requests,
                "items": [i.to_dict() for i in self.items]}


def _parse(ts: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except Exception:
        return None


class Engine(DatabaseMixin):
    def __init__(self, db, conn: Connection, adapter: NotionAdapter):
        self.db, self.conn, self.adapter = db, conn, adapter
        self.store = Store(db, conn.user_id, conn.id)
        self._colls: dict[str, dict] | None = None
        self._schema_ok: set[str] = set()
        self._suffix: dict[str, str] = {}       # note id -> title suffix, for 'Keep both' copies

    @property
    def colls(self) -> dict[str, dict]:
        if self._colls is None:
            self._colls = fetch_collections(self.db, self.conn.user_id)
        return self._colls

    # ---- the tree: collection pages, Notes databases, the archive ---------------------
    def _root(self) -> str:
        if not self.conn.root_page_id:
            raise ItemFailure("needs_you", "needs_user", "no_root", "Pick a Notion page to send to first.")
        return self.conn.root_page_id

    def _adopt_or_none(self, m: dict, ours: bool, found: list[tuple[str, str]]) -> str | None:
        """Reconcile a page we may have created before a crash: only candidates
        created since this mapping started (minus clock slack) count."""
        if ours:
            return None
        since = _parse(m.get("create_started_at"))
        ok = [pid for pid, created in found
              if since is None or (_parse(created) or since) >= since - timedelta(minutes=2)]
        if len(ok) > 1:
            log.warning("notion: %d candidate pages for one mapping; adopting the oldest", len(ok))
        return ok[0] if ok else None

    def ensure_collection_page(self, cid: str) -> str:
        """The Notion page of a collection, created (with its description) on first use."""
        row = self.colls.get(cid)
        if row is None:
            raise ItemFailure("failed", "permanent", "no_collection", "This folder no longer exists.")
        parent_page = self.ensure_collection_page(str(row["parent_id"])) if row.get("parent_id") else self._root()
        m, ours = self.store.begin_create("collection", cid, parent=parent_page)
        if m.get("state") in ("synced", "failed") and m.get("notion_id"):
            return m["notion_id"]
        obj = collection_to_ir(row)
        try:
            r = self.adapter.render(obj)
            page_id = m.get("notion_id") or self._adopt_or_none(
                m, ours, self.adapter.find_child_pages(parent_page, "".join(t.text for t in obj.title)))
            if not page_id:
                page_id = self.adapter.create_page(parent_page, r)
            self.store.cas(m["id"], "creating", {"notion_id": page_id, "notion_kind": "page",
                                                 "notion_parent_id": parent_page, "state": "synced"})
            top = self._append(m, page_id, r, [])
            self.store.update(m["id"], {"local_hash": object_hash(obj, self.conn), "last_pushed_at": now(),
                                        "mapper_set_version": registry.mapper_set_version(),
                                        "ir_version": ir.IR_VERSION, "block_index": {"v": 1, "top": top},
                                        "losses": [x.to_dict() for x in r.losses]})
            return page_id
        except AmbiguousWrite:
            raise _ambiguous()

    def ensure_container(self, cid: str | None) -> str:
        """-> data source id of the Notes database of collection `cid` (None = the root)."""
        parent_page = self.ensure_collection_page(cid) if cid else self._root()
        m, ours = self.store.begin_create(CONTAINER, cid or parent_page, "notes_db", parent=parent_page)
        if m.get("state") == "synced" and m.get("notion_id"):
            ds = m["notion_id"]
        else:
            found = self.adapter.find_notes_databases(parent_page)       # reconcile before creating
            if found:
                db = found[0]
                if len(found) > 1:
                    log.warning("notion: %d 'Notes' databases under one page; adopting the oldest", len(found))
            else:
                try:
                    db = self.adapter.create_notes_database(parent_page)
                except AmbiguousWrite:
                    raise _ambiguous()
            self.store.cas(m["id"], "creating", {
                "notion_id": db.data_source_id, "notion_kind": "data_source", "notion_parent_id": db.database_id,
                "state": "synced", "last_pushed_at": now()})
            ds = db.data_source_id
            self._schema_ok.add(ds)
        if ds not in self._schema_ok:
            self.adapter.ensure_schema(ds)                               # keep the schema in step
            self._schema_ok.add(ds)
        return ds

    def ensure_archive(self) -> str:
        """The "🗄 Deleted in Second Brain" page: deletes move here, never to Notion's trash."""
        root = self._root()
        m, ours = self.store.begin_create("archive", root, "", parent=root)
        if m.get("state") == "synced" and m.get("notion_id"):
            return m["notion_id"]
        try:
            page_id = self._adopt_or_none(m, ours, self.adapter.find_child_pages(root, ARCHIVE_TITLE))
            if not page_id:
                page_id = self.adapter.create_page(root, self.adapter.render(ir.Obj(
                    "page", ir.Ref("archive", "root"), title=[ir.Text(ARCHIVE_TITLE)], icon=None)))
        except AmbiguousWrite:
            raise _ambiguous()
        self.store.cas(m["id"], "creating", {"notion_id": page_id, "notion_kind": "page",
                                             "notion_parent_id": root, "state": "synced", "last_pushed_at": now()})
        self.db.table("notion_connections").update({"archive_page_id": page_id}).eq("id", self.conn.id).execute()
        return page_id

    # ---- bodies --------------------------------------------------------------------------
    def _on_top(self, m: dict):
        def save(top, pending=None):
            idx = {"v": 1, "top": top}
            if pending:
                idx["pending"] = pending
            self.store.update(m["id"], {"block_index": idx})          # no `pending` once a request lands
        return save

    def _append(self, m: dict, page_id: str, r: Rendered, top: list[dict]) -> list[dict]:
        """Write a brand-new body, keeping the mapping's block index exact after every request."""
        return self.adapter.sync_body(page_id, r, [], self._on_top(m))

    def _replace_body(self, m: dict, page_id: str, r: Rendered, everything: bool = False) -> list[dict]:
        """Bring the body up to date: in place where possible, a rebuild otherwise. Only blocks
        WE created (our index) are touched, unless the user chose Overwrite."""
        idx = m.get("block_index") or {}
        top = list(idx.get("top") or [])
        if idx.get("pending"):                                           # a send died mid-append: reclaim
            top += self.adapter.reclaim_pending(page_id, idx["pending"], {e["id"] for e in top})
            self.store.update(m["id"], {"block_index": {"v": 1, "top": top}})
        if everything:                  # the user chose Overwrite: blocks people added go too
            self.adapter.delete_all_top_level(page_id)
            top = []
            self.store.update(m["id"], {"block_index": {"v": 1, "top": []}})
        return self.adapter.sync_body(page_id, r, top, self._on_top(m))

    def _edit_check(self, page_id: str) -> None:
        info = self.adapter.get_page(page_id)
        if info.unreachable:
            raise ItemFailure("needs_you", "needs_user", "object_not_found",
                              "This page is no longer reachable in Notion (deleted or unshared).")
        if self.conn.bot_user_id and info.last_edited_by and info.last_edited_by != self.conn.bot_user_id:
            raise ItemFailure("needs_you", "needs_user", "edited_in_notion",
                              "This page was changed in Notion since the last send. Nothing was "
                              "overwritten. (Choosing what to keep arrives in a later update.)")

    # ---- a collection ----------------------------------------------------------------------
    def send_collection(self, item: PlanItem) -> ItemResult:
        cid = item.note_id
        row = self.colls.get(cid)
        if row is None:
            raise ItemFailure("failed", "permanent", "no_collection", "This folder no longer exists.")
        action = "create" if item.state == NEW else "update"
        try:
            if item.resolution == "forget":
                return self._forget(item, "collection")
            if item.resolution == "recreate":                    # the page is gone in Notion: start over
                self.store.forget_one("collection", cid)
                self.store.forget_one(CONTAINER, cid, "notes_db")
                action = "create"
            page_id = self.ensure_collection_page(cid)           # creates it (with its description) if new
            m = self.store.mapping("collection", cid)
            obj = collection_to_ir(row)
            h = object_hash(obj, self.conn)
            if m.get("local_hash") != h:                          # an update: rename, icon, description, move
                action = "update"
                r = self.adapter.render(obj)
                if item.resolution != "overwrite":
                    self._edit_check(page_id)
                self.adapter.update_properties(page_id, r, row=False)
                parent_page = self.ensure_collection_page(str(row["parent_id"])) if row.get("parent_id") else self._root()
                if m.get("notion_parent_id") != parent_page:
                    self.adapter.move_page(page_id, under_page=parent_page)
                    self.store.update(m["id"], {"notion_parent_id": parent_page})
                top = self._replace_body(m, page_id, r, everything=item.resolution == "overwrite")
                self.store.update(m["id"], {"local_hash": h, "block_index": {"v": 1, "top": top},
                                            "last_pushed_at": now(), "state": "synced", "error_class": None,
                                            "error_code": None, "error_message": None})
            return ItemResult(cid, item.title, "done", action, "Sent." if action == "create" else "Updated.",
                              page_url(page_id), [x.to_dict() for x in collection_to_ir(row).losses], "collection")
        except AmbiguousWrite as e:
            raise ItemFailure("failed", "retryable", "ambiguous_write", plain_message(e))
        except NotionError as e:
            raise self._notion_failure(e)

    # ---- a note ------------------------------------------------------------------------------
    def _notion_failure(self, e: NotionError) -> ItemFailure:
        # ids and the field path only: never the value Notion echoes back
        log.warning("notion error %s %s: %s", e.status, e.code, re.sub(r"instead was.*", "", e.message or "")[:300])
        if e.status == 401 or e.code == "unauthorized":
            # token revoked: the kill switch goes on by itself; mappings are kept for the reconnect
            self.db.table("notion_connections").update({"status": "error", "updated_at": now()}).eq("id", self.conn.id).execute()
        return ItemFailure("needs_you" if e.error_class == "needs_user" else "failed",
                           e.error_class, e.code, plain_message(e))

    def _destination(self, row: dict):
        """Where a note's page lives: a database's data source if it is a row, else the Notes
        database of its collection. -> (data source id, title property name, DbState | None)."""
        ctx = self.row_context(str(row["id"]))
        if ctx is not None:
            st = self.build_database(ctx[0])
            if not st.finished:
                self.finish_schemas([st])
            return st.notion_ds, st.layout.names[st.layout.title_key], st
        cid = str(row["collection_id"]) if row.get("collection_id") else None
        return self.ensure_container(cid), TITLE_PROP, None

    def _row_props(self, st, obj: ir.Obj, r: Rendered, resolver) -> None:
        """Fill a database row's property values (an empty one is an explicit clear)."""
        losses: list = []
        r.props = dbschema.row_values(st.layout, st.defs, obj.props["db"]["values"],
                                      lambda nid: (resolver(nid)[1] if resolver(nid)[0] == "page" and resolver(nid)[1] != "pending" else None),
                                      losses)
        r.losses = dedupe(list(r.losses) + losses)

    def _obj_for(self, row: dict, st, titled: bool = True) -> ir.Obj:
        obj = note_to_ir(self._titled(row) if titled else row)
        if st is not None:
            b = st.bundle
            rp = (self.db.table("db_row_props").select("*").eq("note_id", row["id"]).execute().data or [None])[0]
            obj = row_to_ir(obj, b, row, rp, self._links(st, str(row["id"])))
        return obj

    def _links(self, st, note_id: str) -> dict[str, list[str]]:
        return relation_values(self.db, self.conn.user_id, st.defs, note_id)

    def _shell(self, item: PlanItem, row: dict, resolver) -> None:
        """Create the empty page for a new note (title + SB ID), so links can point at it."""
        ds, title_prop, st = self._destination(row)
        m, _ = self.store.begin_create("note", item.note_id, parent=ds)
        if m.get("notion_id"):
            return
        obj = note_to_ir(self._titled(row))
        r = self.adapter.materialize_cover(self.adapter.render(obj, resolver))
        r.props = {}                                              # the shell has a title and an SB ID only
        skip = self.store.detached_page_ids(item.note_id)
        rows = [r for r in self.adapter.find_rows(ds, item.note_id) if r[0] not in skip]   # reconcile: a crash or a lost mapping
        if rows:
            page_id = rows[0][0]
            if len(rows) > 1:
                log.warning("notion: %d rows for note %s; adopting the oldest", len(rows), item.note_id)
        else:
            try:
                page_id = self.adapter.create_row(ds, r, item.note_id, title_prop)
            except AmbiguousWrite:
                raise _ambiguous()
        if not self.store.cas(m["id"], "creating", {"notion_id": page_id, "notion_kind": "page",
                                                    "notion_parent_id": ds, "state": "synced", "local_hash": None}):
            self.store.update(m["id"], {"notion_id": page_id})
        resolver.forget(item.note_id)

    def _titled(self, row: dict) -> dict:
        suffix = self._suffix.get(str(row["id"]))
        return {**row, "title": f"{(row.get('title') or 'Untitled').strip()}{suffix}"} if suffix else row

    def _forget(self, item: PlanItem, kind: str) -> ItemResult:
        """Stop tracking: the mapping goes, nothing in Notion is touched."""
        self.store.forget_one(kind, item.note_id)
        if kind == "collection":
            self.store.forget_one(CONTAINER, item.note_id, "notes_db")
        return ItemResult(item.note_id, item.title, "done", "forget",
                          "No longer tracked. The page in Notion was left alone.", None, kind=kind)

    def send_note(self, item: PlanItem, row: dict, resolver: MentionResolver) -> ItemResult:
        if item.resolution == "forget":
            return self._forget(item, "note")
        action = "create" if item.state == NEW else "update"
        try:
            ds, title_prop, st = self._destination(row)
            obj = self._obj_for(row, st)
            h_obj = self._obj_for(row, st, titled=False)         # hashed as the real note, even for a titled copy
            m = self.store.mapping("note", item.note_id)
            if m is None or not m.get("notion_id"):
                self._shell(item, row, resolver)
                m = self.store.mapping("note", item.note_id)
            page_id = m["notion_id"]
            h = object_hash(h_obj, self.conn, link_tags(h_obj, resolver))
            r = self.adapter.materialize_cover(self.adapter.render(obj, resolver))
            if st is not None:
                self._row_props(st, obj, r, resolver)
            if (action == "update" or m.get("local_hash")) and item.resolution != "overwrite":
                self._edit_check(page_id)
            if m.get("notion_parent_id") != ds:                    # moved to another collection, or restored
                self.adapter.move_page(page_id, under_source=ds)
                self.store.update(m["id"], {"notion_parent_id": ds})
            self.adapter.update_properties(page_id, r, title_prop=title_prop)
            top = self._replace_body(m, page_id, r, everything=item.resolution == "overwrite")
            losses = [loss.to_dict() for loss in dedupe(list(r.losses) + self.adapter.take_losses())]   # + what files taught us
            fin = self.adapter.get_page(page_id)
            self.store.update(m["id"], {
                "state": "synced", "local_hash": h, "mapper_set_version": registry.mapper_set_version(),
                "ir_version": ir.IR_VERSION, "notion_last_edited_time": fin.last_edited_time,
                "notion_last_edited_by": fin.last_edited_by, "last_pushed_at": now(), "block_index": {"v": 1, "top": top},
                "losses": losses, "error_class": None, "error_code": None, "error_message": None})
            return ItemResult(item.note_id, item.title, "done", action,
                              "Sent." if action == "create" else "Updated.", page_url(page_id), losses)
        except ItemFailure:
            raise
        except AmbiguousWrite as e:
            raise ItemFailure("failed", "retryable", "ambiguous_write", plain_message(e))
        except NotionError as e:
            raise self._notion_failure(e)

    def _finish_db_item(self, it: PlanItem, st) -> None:
        """Title/icon/description changes, then remember what we sent (so the next plan is a no-op)."""
        m = self.store.mapping("database", it.note_id)
        if it.state == CHANGED:
            r = self.adapter.materialize_cover(self.adapter.render(st.obj))
            from services.notion_sync.notion.richtext import plain_rich
            desc = plain_rich(st.obj.props.get("description") or "")
            self.adapter.patch_database(st.notion_db, r, desc)
        self.store.update(m["id"], {"state": "synced", "local_hash": object_hash(st.obj, self.conn),
                                    "mapper_set_version": registry.mapper_set_version(),
                                    "ir_version": ir.IR_VERSION, "last_pushed_at": now(),
                                    "losses": [x.to_dict() for x in st.layout.losses]})

    def _start_over(self, it: PlanItem) -> None:
        """'Send as a copy' / 'Create it again': the old mapping is retired, the note becomes a new page."""
        m = self.store.mapping("note", it.note_id)
        if m and it.resolution == "copy" and m.get("notion_id"):
            # the edited original is detached for good: never touched again
            self.store.update(m["id"], {"local_sub": f"detached:{m['notion_id']}", "state": "detached"})
            self._suffix[it.note_id] = f" (from Second Brain, {datetime.now(timezone.utc):%b} {datetime.now(timezone.utc).day})"
        elif m:
            self.store.forget_one("note", it.note_id)
        it.state = NEW

    def archive_note(self, item: PlanItem) -> ItemResult:
        """A note deleted here: move its page to the archive page (never to Notion's trash)."""
        try:
            m = self.store.mapping("note", item.note_id)
            if not m or not m.get("notion_id"):
                return ItemResult(item.note_id, item.title, "skipped", "", "Nothing to archive.")
            archive = self.ensure_archive()
            self.adapter.move_page(m["notion_id"], under_page=archive)
            self.store.update(m["id"], {"state": "archived", "notion_parent_id": archive, "last_pushed_at": now()})
            return ItemResult(item.note_id, item.title, "done", "archive",
                              "Moved to “Deleted in Second Brain”.", page_url(m["notion_id"]))
        except AmbiguousWrite as e:
            raise ItemFailure("failed", "retryable", "ambiguous_write", plain_message(e))
        except NotionError as e:
            raise self._notion_failure(e)

    # ---- a run ---------------------------------------------------------------------------------
    def prepare(self, items: list[PlanItem], released: frozenset[str] = frozenset(),
                trigger: str = "manual") -> tuple[dict, list[PlanItem], dict]:
        """Write the run and its queued items (so progress is visible at once)."""
        sendable = [i for i in items if i.sendable]
        run = self.store.new_run({"ids": [i.note_id for i in items]}, {"counts": {"send": len(sendable)}},
                                 sorted(released), trigger)
        recs = {}
        for it in sendable:
            action = "archive" if it.state == DELETED else ("create" if it.state == NEW else "update")
            recs[(it.kind, it.note_id)] = self.store.new_item(run["id"], it.note_id, action, it.mapping_id, it.kind)
        return run, sendable, recs

    def run(self, items: list[PlanItem], released: frozenset[str] = frozenset(), trigger: str = "manual") -> RunResult:
        run, sendable, recs = self.prepare(items, released, trigger)
        return self.execute(run, sendable, recs, released)

    def execute(self, run: dict, sendable: list[PlanItem], recs: dict, released: frozenset[str] = frozenset()) -> RunResult:
        self.store.begin_run(run["id"])
        notes = fetch_notes(self.db, self.conn.user_id, [i.note_id for i in sendable if i.kind == "note" and i.state != DELETED])
        start_requests = self.adapter.c.requests
        results: dict[tuple[str, str], ItemResult] = {}
        halted = {"paused": False}
        store_resolver = MentionResolver(self.db, self.store, self.conn.user_id, self.conn.privacy_ceiling, released,
                                         {i.note_id for i in sendable if i.kind == "note" and i.state == NEW})
        shell_failures: dict[str, ItemFailure] = {}

        def finish(it: PlanItem, fn):
            key = (it.kind, it.note_id)
            rec = recs[key]
            if halted["paused"] or self._paused():
                halted["paused"] = True
                self.store.finish_item(rec["id"], "skipped", message="Syncing is paused.")
                results[key] = ItemResult(it.note_id, it.title, "skipped", "", "Syncing is paused.", kind=it.kind)
                return
            self.store.start_item(rec["id"])
            try:
                res = fn()
                self.store.finish_item(rec["id"], res.status, message=res.message)
            except SyncPaused:                          # the kill switch fired between two requests
                halted["paused"] = True
                self.store.finish_item(rec["id"], "skipped", message="Syncing was paused; this will be retried.")
                results[key] = ItemResult(it.note_id, it.title, "skipped", "", "Syncing was paused.", kind=it.kind)
                return
            except ItemFailure as f:
                if it.kind == "note":
                    self._mark_mapping(it.note_id, f)
                self.store.finish_item(rec["id"], f.status, error_class=f.error_class, error_code=f.code,
                                       message=f.message)
                res = ItemResult(it.note_id, it.title, f.status, "", f.message, kind=it.kind)
            except Exception:                           # a bug must not take down the run
                log.exception("notion send failed for %s %s", it.kind, it.note_id)
                msg = "Something went wrong sending this item. Nothing was lost."
                self.store.finish_item(rec["id"], "failed", error_class="permanent", error_code="internal", message=msg)
                res = ItemResult(it.note_id, it.title, "failed", "", msg, kind=it.kind)
            results[key] = res

        # Privacy gate #2, at the adapter boundary: nothing above the ceiling reaches Notion
        # even if the plan was wrong (DESIGN §6.5).
        with privacy.scope(self.conn.privacy_ceiling, self.conn.user_id, released):
            # databases first: their tables must exist before any row or relation value is written
            db_states: list[tuple[PlanItem, object]] = []

            def build_db(it):
                st = self.build_database(it.note_id)
                db_states.append((it, st))
                return ItemResult(it.note_id, it.title, "done", "create" if st.created else "update",
                                  "Table ready.", page_url(st.notion_db), [], "database")
            for it in (i for i in sendable if i.kind == "database"):
                finish(it, lambda it=it: build_db(it))
            if db_states:
                try:
                    self.finish_schemas([st for _, st in db_states])
                    for it, st in db_states:
                        self._finish_db_item(it, st)
                        results[("database", it.note_id)].losses = [x.to_dict() for x in
                                                                    dedupe(list(st.layout.losses) + list(st.obj.losses))]
                except SyncPaused:
                    halted["paused"] = True
                except (NotionError, AmbiguousWrite) as e:
                    f = self._notion_failure(e) if isinstance(e, NotionError) else _ambiguous()
                    for it, _ in db_states:
                        self.store.finish_item(recs[("database", it.note_id)]["id"], f.status, error_class=f.error_class,
                                               error_code=f.code, message=f.message)
                        results[("database", it.note_id)] = ItemResult(it.note_id, it.title, f.status, "", f.message, kind="database")

            for it in (i for i in sendable if i.kind == "collection"):
                finish(it, lambda it=it: self.send_collection(it))

            for it in (i for i in sendable if i.kind == "note" and i.resolution in ("recreate", "copy")):
                self._start_over(it)

            def allowed(it):
                row = notes.get(it.note_id)
                return row if row is not None and privacy.filter_rows([row]) else None

            for it in (i for i in sendable if i.kind == "note" and i.state == NEW):      # phase: shells
                row = allowed(it)
                if row is None:
                    continue
                if self._paused():              # the kill switch is checked before any request
                    break
                try:
                    self._shell(it, row, store_resolver)
                except SyncPaused:
                    halted["paused"] = True
                    break
                except ItemFailure as f:
                    shell_failures[it.note_id] = f
                except AmbiguousWrite:
                    shell_failures[it.note_id] = _ambiguous()
                except NotionError as e:
                    shell_failures[it.note_id] = self._notion_failure(e)

            def do_note(it):
                row = allowed(it)
                if row is None:
                    return ItemResult(it.note_id, it.title, "skipped", "", "Not sent: private or deleted.")
                if it.note_id in shell_failures:
                    raise shell_failures[it.note_id]
                return self.send_note(it, row, store_resolver)

            for it in (i for i in sendable if i.kind == "note" and i.state != DELETED):
                finish(it, lambda it=it: do_note(it))
            for it in (i for i in sendable if i.state == DELETED):
                finish(it, lambda it=it: self.archive_note(it))

        ordered = [results[(i.kind, i.note_id)] for i in sendable if (i.kind, i.note_id) in results]
        done = sum(r.status == "done" for r in ordered)
        bad = sum(r.status in ("failed", "needs_you") for r in ordered)
        status = ("paused" if halted["paused"] else "succeeded" if bad == 0 else "partial" if done else "failed")
        used = self.adapter.c.requests - start_requests
        self.store.finish_run(run["id"], status, {"done": done, "problems": bad, "skipped": len(ordered) - done - bad,
                                                  "rate_limit_waits": self.adapter.c.rate_limit_waits}, used)
        if status == "succeeded" and done:
            self.db.table("notion_connections").update({"last_ok_at": now()}).eq("id", self.conn.id).execute()
        return RunResult(run["id"], status, ordered, used)

    def _paused(self) -> bool:
        rows = (self.db.table("notion_connections").select("status").eq("id", self.conn.id)
                .execute().data or [])
        return bool(rows) and rows[0].get("status") == "paused"      # the kill switch; "error" = bad token

    def _mark_mapping(self, note_id: str, f: ItemFailure) -> None:
        m = self.store.mapping("note", note_id)
        # a mapping still in `creating` stays there so the next send reconciles it
        if m and m.get("state") == "synced":
            self.store.update(m["id"], {"state": "failed" if f.status == "failed" else "synced",
                                        "error_class": f.error_class, "error_code": f.code,
                                        "error_message": f.message})
