"""Fixtures for the Notion sync tests: a fake Notion, a fake DB, a built engine."""
from __future__ import annotations

import uuid

import pytest

from services.notion_sync import connection as conn_mod
from services.notion_sync.engine.runner import Engine
from services.notion_sync.notion.adapter import NotionAdapter
from services.notion_sync.notion.client import NotionClient, TokenBucket
from tests.fake_db import FakeDB
from tests.notion_sync.fake_notion import BOT, FakeNotion

USER = "user-1"


class FakeFiles:
    """A FileSource: `blobs` maps url -> (bytes, mime) or an exception to raise."""
    def __init__(self, own=("files.sb.test",)):
        self.blobs: dict = {}
        self.own = set(own)
        self.fetched: list[str] = []

    def is_public_link(self, url):
        from urllib.parse import urlparse
        u = urlparse(url)
        return u.scheme == "https" and u.hostname not in self.own and "token=" not in (u.query or "")

    def fetch(self, url, max_bytes, name_hint=""):
        from services.notion_sync.notion.files import Fetched, FileTooLarge, FileUnavailable
        self.fetched.append(url)
        b = self.blobs.get(url)
        if b is None:
            raise FileUnavailable("404")
        if isinstance(b, Exception):
            raise b
        data, mime = b
        if len(data) > max_bytes:
            raise FileTooLarge(len(data))
        return Fetched(data, mime, name_hint or url.rsplit("/", 1)[-1].split("?")[0])


def T(text, **styles):
    return {"type": "text", "text": text, "styles": styles}


def note(title="A note", content=None, **kw):
    return {"id": str(uuid.uuid4()), "user_id": USER, "title": title, "icon": "📄",
            "content": content if content is not None else [
                {"id": "p1", "type": "paragraph", "props": {}, "content": [T("hello")], "children": []}],
            "sensitivity": "personal", "deleted_at": None, **kw}


class World:
    def __init__(self):
        self.notion = FakeNotion()
        self.db = FakeDB(
            collections=[], notes=[], db_databases=[], db_data_sources=[], db_properties=[], db_row_props=[],
            db_relation_links=[], notion_mappings=[], notion_runs=[], notion_run_items=[],
            notion_connections=[{"id": "c1", "user_id": USER, "status": "active", "bot_user_id": BOT,
                                 "root_page_id": self.notion.root, "privacy_ceiling": "personal",
                                 "token_ciphertext": "x", "token_hint": "…abcd", "workspace_name": "Test WS"}])
        self.sleeps: list[float] = []
        self.files = FakeFiles()

    def add_note(self, **kw) -> dict:
        n = note(**kw)
        self.db.tables["notes"].append(n)
        return n

    def conn(self):
        return conn_mod.load(self.db, USER)

    def client(self, gate=None) -> NotionClient:
        return NotionClient("secret", transport=self.notion.transport, gate=gate,
                            bucket=TokenBucket(rate=1000, burst=1000), sleep=self.sleeps.append)

    def engine(self) -> Engine:
        return Engine(self.db, self.conn(), NotionAdapter(self.client(), files=self.files))

    def plan(self, *notes, released=frozenset(), collections=(), archive=(), databases=(), linked=False):
        from services.notion_sync.planner import plan_scope
        eng = self.engine()
        return plan_scope(self.db, eng.conn, eng.adapter, note_ids=[n["id"] for n in notes],
                          collection_ids=[c["id"] for c in collections], released=released,
                          archive_ids=frozenset(archive), database_ids=[d["id"] for d in databases],
                          include_linked=linked)

    def send(self, *notes, released=frozenset(), collections=(), archive=(), databases=(), linked=False):
        eng = self.engine()
        from services.notion_sync.planner import plan_scope
        plan = plan_scope(self.db, eng.conn, eng.adapter, note_ids=[n["id"] for n in notes],
                          collection_ids=[c["id"] for c in collections], released=released,
                          archive_ids=frozenset(archive), database_ids=[d["id"] for d in databases],
                          include_linked=linked)
        return eng.run(plan.items, frozenset(released)), plan

    # ---- databases ---------------------------------------------------------------------------
    def add_db(self, title="Tasks", *, inline=False, host=None, icon=None, description=None):
        d = {"id": str(uuid.uuid4()), "user_id": USER, "title": title, "description": description or [], "icon": icon,
             "cover_url": None, "is_inline": inline, "parent_note_id": host["id"] if host else None,
             "is_locked": False, "position": 0, "deleted_at": None}
        ds = {"id": str(uuid.uuid4()), "database_id": d["id"], "user_id": USER, "name": "Default",
              "system_kind": None, "position": 0}
        self.db.tables["db_databases"].append(d)
        self.db.tables["db_data_sources"].append(ds)
        self.add_prop(ds, "Title", "title")
        return d, ds

    def add_prop(self, ds, name, type_, config=None, key=None, result_type=None):
        n = len([p for p in self.db.tables["db_properties"] if p["data_source_id"] == ds["id"]])
        p = {"id": str(uuid.uuid4()), "data_source_id": ds["id"], "user_id": USER, "key": key or f"k{n}{name[:3]}".replace(" ", ""),
             "name": name, "type": type_, "config": config or {}, "storage": "jsonb", "column_name": None,
             "result_type": result_type, "position": n, "description": None}
        self.db.tables["db_properties"].append(p)
        return p

    def add_row(self, ds, title, values=None, computed=None, position=0):
        n = self.add_note(title=title)
        self.db.tables["db_row_props"].append({"note_id": n["id"], "data_source_id": ds["id"], "user_id": USER,
                                                "properties": values or {}, "computed": computed or {}, "position": position})
        return n

    def link(self, relation_id, from_note, to_note, position=0):
        self.db.tables["db_relation_links"].append({"id": str(uuid.uuid4()), "user_id": USER, "relation_id": relation_id,
                                                    "from_row_id": from_note["id"], "to_row_id": to_note["id"], "position": position})

    def add_collection(self, name="Physics", parent=None, **kw) -> dict:
        c = {"id": str(uuid.uuid4()), "user_id": USER, "name": name, "icon": "📁", "color": "#6366f1",
             "description": None, "parent_id": parent["id"] if parent else None, "position": 0, **kw}
        self.db.tables["collections"].append(c)
        return c

    def mapping(self, note_):
        rows = [r for r in self.db.tables["notion_mappings"] if r["local_id"] == note_["id"] and not r.get("local_sub")]
        return rows[0] if rows else None


@pytest.fixture
def world():
    return World()
