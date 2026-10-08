"""Execute a confirmed plan: create protocol, update protocol, runs/items.

Synchronous in M1 (a background worker is M5). The create protocol is
ROBUSTNESS §4: the mapping row exists in `creating` BEFORE the create call, a
create with an unknown outcome is never repeated blindly, and a mapping left in
`creating` is reconciled (query by SB ID) before anything is created again.
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field

from services import privacy
from services.notion_sync import registry
from services.notion_sync.connection import Connection
from services.notion_sync.engine.store import CONTAINER, Store, now
from services.notion_sync.notion.adapter import NotionAdapter, Rendered, page_url
from services.notion_sync.notion.errors import AmbiguousWrite, NotionError, plain_message
from services.notion_sync.planner import NEW, CHANGED, PlanItem, note_hash, fetch_notes
from services.notion_sync.readers.note import note_to_ir
from services.portable import ir

log = logging.getLogger(__name__)

_locks: dict[str, threading.Lock] = {}


def connection_lock(connection_id: str) -> threading.Lock:
    """One send at a time per connection (ADR-12)."""
    return _locks.setdefault(connection_id, threading.Lock())


class ItemFailure(Exception):
    def __init__(self, status: str, error_class: str, code: str, message: str):
        super().__init__(message)
        self.status, self.error_class, self.code, self.message = status, error_class, code, message


@dataclass
class ItemResult:
    note_id: str
    title: str
    status: str                        # done | failed | needs_you | skipped
    action: str = ""
    message: str = ""
    notion_url: str | None = None
    losses: list[dict] = field(default_factory=list)

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


class Engine:
    def __init__(self, db, conn: Connection, adapter: NotionAdapter):
        self.db, self.conn, self.adapter = db, conn, adapter
        self.store = Store(db, conn.user_id, conn.id)

    # ---- the container: root "Notes" database (D1, M1) ----------------------------
    def ensure_container(self) -> str:
        """-> data source id of the root Notes database, creating it once."""
        root = self.conn.root_page_id
        if not root:
            raise ItemFailure("needs_you", "needs_user", "no_root", "Pick a Notion page to send to first.")
        m, ours = self.store.begin_create(CONTAINER, root, "notes_db", parent=root)
        if m.get("state") == "synced" and m.get("notion_id"):
            return m["notion_id"]
        # Still `creating` (first time, or left behind by a crash or a lost mapping):
        # look for a Notes database that already exists before creating one.
        found = self.adapter.find_notes_databases(root)
        if found:
            db = found[0]                                    # oldest; extras are left alone
            if len(found) > 1:
                log.warning("notion: %d 'Notes' databases under the root; adopting the oldest", len(found))
        else:
            try:
                db = self.adapter.create_notes_database(root)
            except AmbiguousWrite:
                raise ItemFailure("failed", "retryable", "ambiguous_create",
                                  plain_message(AmbiguousWrite("create", "")))
        self.store.cas(m["id"], "creating", {
            "notion_id": db.data_source_id, "notion_kind": "data_source",
            "notion_parent_id": db.database_id, "state": "synced", "last_pushed_at": now()})
        return db.data_source_id

    # ---- one note ----------------------------------------------------------------------
    def _page_from_mapping(self, m: dict, ds_id: str, note_id: str, r: Rendered) -> str:
        """The Notion page for a mapping in `creating`: adopt a row that already
        exists (crash after the create), else create it."""
        if m.get("notion_id"):
            return m["notion_id"]
        rows = self.adapter.find_rows(ds_id, note_id)
        if rows:
            page_id = rows[0][0]
            if len(rows) > 1:
                log.warning("notion: %d rows for note %s; adopting the oldest", len(rows), note_id)
        else:
            try:
                page_id = self.adapter.create_row(ds_id, r, note_id)
            except AmbiguousWrite:
                raise ItemFailure("failed", "retryable", "ambiguous_create",
                                  plain_message(AmbiguousWrite("create", "")))
        if not self.store.cas(m["id"], "creating", {
                "notion_id": page_id, "notion_kind": "page", "notion_parent_id": ds_id,
                "state": "synced", "local_hash": None}):
            self.store.update(m["id"], {"notion_id": page_id})
        return page_id

    def send_note(self, item: PlanItem, row: dict) -> ItemResult:
        obj: ir.Obj = note_to_ir(row)
        r = self.adapter.render(obj)
        h = note_hash(obj, self.conn)
        losses = [loss.to_dict() for loss in r.losses]
        action = "create"
        try:
            m = self.store.mapping("note", item.note_id)
            if m is None or not m.get("notion_id"):
                ds = self.ensure_container()
                m, _ = self.store.begin_create("note", item.note_id, parent=ds)
                page_id = self._page_from_mapping(m, ds, item.note_id, r)
                top: list[dict] = list((m.get("block_index") or {}).get("top") or [])
            else:
                action = "update"
                page_id = m["notion_id"]
                info = self.adapter.get_page(page_id)
                if info.unreachable:
                    raise ItemFailure("needs_you", "needs_user", "object_not_found",
                                      "This page is no longer reachable in Notion (deleted or unshared).")
                if self.conn.bot_user_id and info.last_edited_by and \
                        info.last_edited_by != self.conn.bot_user_id:
                    raise ItemFailure(
                        "needs_you", "needs_user", "edited_in_notion",
                        "This page was changed in Notion since the last send. Nothing was "
                        "overwritten. (Choosing what to keep arrives in a later update.)")
                self.adapter.update_properties(page_id, r)
                top = list((m.get("block_index") or {}).get("top") or [])

            def save_top():
                self.store.update(m["id"], {"block_index": {"v": 1, "top": top}})

            # remove only blocks we created earlier (ids from our own index)
            if top:
                def gone(bid):
                    top[:] = [e for e in top if e["id"] != bid]
                    save_top()
                self.adapter.delete_blocks([e["id"] for e in top], on_deleted=gone)

            def landed(entries):
                top.extend(entries)
                save_top()
            self.adapter.append_body(page_id, r, on_blocks=landed)

            fin = self.adapter.get_page(page_id)
            self.store.update(m["id"], {
                "state": "synced", "local_hash": h, "mapper_set_version": registry.mapper_set_version(),
                "ir_version": ir.IR_VERSION, "notion_last_edited_time": fin.last_edited_time,
                "notion_last_edited_by": fin.last_edited_by, "last_pushed_at": now(),
                "losses": losses, "error_class": None, "error_code": None, "error_message": None})
            return ItemResult(item.note_id, item.title, "done", action,
                              "Sent." if action == "create" else "Updated.",
                              page_url(page_id), losses)
        except ItemFailure:
            raise
        except AmbiguousWrite as e:
            raise ItemFailure("failed", "retryable", "ambiguous_write", plain_message(e))
        except NotionError as e:
            raise ItemFailure("needs_you" if e.error_class == "needs_user" else "failed",
                              e.error_class, e.code, plain_message(e))

    # ---- a run --------------------------------------------------------------------------
    def run(self, items: list[PlanItem], released: frozenset[str] = frozenset()) -> RunResult:
        sendable = [i for i in items if i.state in (NEW, CHANGED)]
        run = self.store.new_run({"note_ids": [i.note_id for i in items]},
                                 {"counts": {"send": len(sendable)}}, sorted(released))
        notes = fetch_notes(self.db, self.conn.user_id, [i.note_id for i in sendable])
        results: list[ItemResult] = []
        start_requests = self.adapter.c.requests
        # Privacy gate #2, at the adapter boundary: nothing above the ceiling
        # reaches Notion even if the plan was wrong (DESIGN §6.5).
        with privacy.scope(self.conn.privacy_ceiling, self.conn.user_id, released):
            for it in sendable:
                row = notes.get(it.note_id)
                rec = self.store.new_item(run["id"], it.note_id,
                                          "create" if it.state == NEW else "update", it.mapping_id)
                if row is None or not privacy.filter_rows([row]):
                    self.store.finish_item(rec["id"], "skipped", message="Not sent (private or deleted).")
                    results.append(ItemResult(it.note_id, it.title, "skipped", "",
                                              "Not sent: private or deleted."))
                    continue
                if self._paused():
                    self.store.finish_item(rec["id"], "skipped", message="Syncing is paused.")
                    results.append(ItemResult(it.note_id, it.title, "skipped", "", "Syncing is paused."))
                    continue
                try:
                    res = self.send_note(it, row)
                    self.store.finish_item(rec["id"], "done", message=res.message)
                except ItemFailure as f:
                    self._mark_mapping(it.note_id, f)
                    self.store.finish_item(rec["id"], f.status, error_class=f.error_class,
                                           error_code=f.code, message=f.message)
                    res = ItemResult(it.note_id, it.title, f.status, "", f.message)
                except Exception:                   # a bug must not take down the run
                    log.exception("notion send failed for note %s", it.note_id)
                    msg = "Something went wrong sending this note. Nothing was lost."
                    self.store.finish_item(rec["id"], "failed", error_class="permanent",
                                           error_code="internal", message=msg)
                    res = ItemResult(it.note_id, it.title, "failed", "", msg)
                results.append(res)
        done = sum(r.status == "done" for r in results)
        bad = sum(r.status in ("failed", "needs_you") for r in results)
        status = "succeeded" if bad == 0 else "partial" if done else "failed"
        used = self.adapter.c.requests - start_requests
        self.store.finish_run(run["id"], status, {"done": done, "problems": bad,
                                                  "skipped": len(results) - done - bad}, used)
        return RunResult(run["id"], status, results, used)

    def _paused(self) -> bool:
        rows = (self.db.table("notion_connections").select("status").eq("id", self.conn.id)
                .execute().data or [])
        return bool(rows) and rows[0].get("status") != "active"

    def _mark_mapping(self, note_id: str, f: ItemFailure) -> None:
        m = self.store.mapping("note", note_id)
        # a mapping still in `creating` stays there so the next send reconciles it
        if m and m.get("state") == "synced":
            self.store.update(m["id"], {"state": "failed" if f.status == "failed" else "synced",
                                        "error_class": f.error_class, "error_code": f.code,
                                        "error_message": f.message})
