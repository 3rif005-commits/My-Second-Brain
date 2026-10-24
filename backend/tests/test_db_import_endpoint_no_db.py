"""The whole CSV-import request path with the database calls stubbed, so it runs without
Postgres. The Postgres-backed tests can't run on every machine; a NameError in the endpoint
(the background-indexing change) reached the deployed site because nothing else covered it."""
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

import routers.db_import as db_import
from main import app
from routers.notes import get_user_id
from services.db.connection import get_conn


def _conn():
    conn = MagicMock()

    @asynccontextmanager
    async def tx():
        yield
    conn.transaction = tx
    return conn


def test_import_answers_201_with_select_names_and_indexes_rows_after_the_response():
    created = SimpleNamespace(
        database=SimpleNamespace(id="db1"), data_source=SimpleNamespace(id="ds1"),
        properties=[SimpleNamespace(id="p-title", key="title")])
    rows_written, indexed = [], []
    keys = iter(["k1", "k2", "k3"])

    async def fake_row(conn, user_id, ds, properties, trigger_automations, recompute_computed):
        # a brand-new database has nothing to recompute; doing it anyway made a
        # 3-row import take ~7 s on the deployed site
        assert trigger_automations is False and recompute_computed is False
        rows_written.append(properties)
        return SimpleNamespace(id=f"note{len(rows_written)}")

    app.dependency_overrides[get_user_id] = lambda: "user-1"
    app.dependency_overrides[get_conn] = _conn
    try:
        with patch.object(db_import, "create_database", AsyncMock(return_value=created)), \
             patch.object(db_import, "update_property", AsyncMock()), \
             patch.object(db_import, "create_property",
                          AsyncMock(side_effect=lambda *a, **k: SimpleNamespace(key=next(keys)))), \
             patch.object(db_import, "create_row_core", side_effect=fake_row), \
             patch.object(db_import, "try_index_note", side_effect=lambda n, u: indexed.append(n)):
            res = TestClient(app).post(
                "/db/import/csv",
                files={"file": ("t.csv", b"Title,Status\nA,Done\nB,Reading\nC,Done\n", "text/csv")})
    finally:
        app.dependency_overrides.clear()

    assert res.status_code == 201, res.text
    assert res.json()["row_count"] == 3
    assert "total;dur=" in res.headers["Server-Timing"]     # where a slow import's time went
    statuses = [p.get("k1") for p in rows_written]
    assert statuses == [{"type": "select", "select": "Done"}, {"type": "select", "select": "Reading"},
                        {"type": "select", "select": "Done"}]
    assert indexed == ["note1", "note2", "note3"]      # background task ran
