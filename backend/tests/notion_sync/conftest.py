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
            notes=[], notion_mappings=[], notion_runs=[], notion_run_items=[],
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

    def client(self) -> NotionClient:
        return NotionClient("secret", transport=self.notion.transport,
                            bucket=TokenBucket(rate=1000, burst=1000), sleep=self.sleeps.append)

    def engine(self) -> Engine:
        return Engine(self.db, self.conn(), NotionAdapter(self.client(), files=self.files))

    def plan(self, *notes, released=frozenset()):
        from services.notion_sync.planner import plan_notes
        eng = self.engine()
        return plan_notes(self.db, eng.conn, eng.adapter, [n["id"] for n in notes], released)

    def send(self, *notes, released=frozenset()):
        eng = self.engine()
        from services.notion_sync.planner import plan_notes
        plan = plan_notes(self.db, eng.conn, eng.adapter, [n["id"] for n in notes], released)
        return eng.run(plan.items, frozenset(released)), plan

    def mapping(self, note_):
        rows = [r for r in self.db.tables["notion_mappings"] if r["local_id"] == note_["id"]]
        return rows[0] if rows else None


@pytest.fixture
def world():
    return World()
