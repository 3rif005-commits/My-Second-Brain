"""Tests for routers/databases.py: database/data-source/property/view CRUD
and the built-in "All Notes" virtual source (spec §6).

All tests run against the local pgtest harness (localhost:55432, migrations
001-014 applied — see repo root's `scripts/pgtest/up.sh`/`apply.sh`) through
a single transaction-wrapped `db_conn` that's rolled back on teardown (see
`tests/conftest.py`). `get_conn` and `get_user_id` are swapped for test
doubles via FastAPI's `app.dependency_overrides` — no header/JWT plumbing
needed, and no code path here can reach `core.config.settings.database_url`
(the real Supabase project).
"""
import re
import uuid
from pathlib import Path

import httpx
import pytest_asyncio

from main import app
from routers.databases import ALL_NOTES_ID
from routers.notes import get_user_id
from services.db.connection import get_conn
from services.db.properties.columns import COLUMN_BACKED


@pytest_asyncio.fixture
async def client(db_conn, test_user):
    async def _override_conn():
        yield db_conn

    app.dependency_overrides[get_conn] = _override_conn
    app.dependency_overrides[get_user_id] = lambda: test_user
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


async def _create_database(client: httpx.AsyncClient, title: str = "My DB") -> dict:
    res = await client.post("/db/databases", json={"title": title})
    assert res.status_code == 201, res.text
    return res.json()


# ---------------------------------------------------------------------------
# Creating a database
# ---------------------------------------------------------------------------

async def test_create_database_creates_exactly_one_data_source_and_one_default_table_view(
    client, db_conn, test_user
):
    body = await _create_database(client, "Reading List")

    assert body["database"]["title"] == "Reading List"
    assert body["data_source"]["system_kind"] is None
    assert body["data_source"]["is_virtual"] is False
    assert body["properties"] == []
    assert len(body["views"]) == 1
    assert body["views"][0]["type"] == "table"

    database_id = body["database"]["id"]
    ds_count = await db_conn.fetchval(
        "SELECT count(*) FROM db_data_sources WHERE database_id = $1", database_id
    )
    view_count = await db_conn.fetchval(
        "SELECT count(*) FROM db_views WHERE data_source_id = $1", body["data_source"]["id"]
    )
    assert ds_count == 1
    assert view_count == 1


async def test_get_database_round_trips_a_created_database(client):
    created = await _create_database(client)
    res = await client.get(f"/db/databases/{created['database']['id']}")
    assert res.status_code == 200
    body = res.json()
    assert body["database"]["id"] == created["database"]["id"]
    assert body["data_source"]["id"] == created["data_source"]["id"]
    assert body["views"][0]["id"] == created["views"][0]["id"]


async def test_get_database_404s_for_another_users_database(client, db_conn):
    created = await _create_database(client)

    other_user = str(uuid.uuid4())
    await db_conn.execute(
        "INSERT INTO auth.users (id, email) VALUES ($1, $2)", other_user, f"{other_user}@t.local"
    )
    app.dependency_overrides[get_user_id] = lambda: other_user
    res = await client.get(f"/db/databases/{created['database']['id']}")
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Property creation: unique keys, duplicate names allowed
# ---------------------------------------------------------------------------

async def test_creating_a_property_mints_a_unique_key(client):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]

    res = await client.post(
        f"/db/data-sources/{ds_id}/properties", json={"name": "Status", "type": "status"}
    )
    assert res.status_code == 201, res.text
    prop = res.json()
    assert re.fullmatch(r"[0-9A-Za-z]{8}", prop["key"])
    assert prop["storage"] == "jsonb"


async def test_second_property_with_same_name_succeeds_with_a_different_key(client):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]

    res1 = await client.post(
        f"/db/data-sources/{ds_id}/properties", json={"name": "Priority", "type": "select"}
    )
    res2 = await client.post(
        f"/db/data-sources/{ds_id}/properties", json={"name": "Priority", "type": "select"}
    )
    assert res1.status_code == 201 and res2.status_code == 201
    key1, key2 = res1.json()["key"], res2.json()["key"]
    assert key1 != key2
    assert res1.json()["name"] == res2.json()["name"] == "Priority"


async def test_property_key_collision_is_retried_not_a_500(client, monkeypatch):
    """A colliding key must not poison the rest of the request's
    transaction — the retry has to actually succeed with a fresh key, not
    just avoid crashing on the first attempt."""
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]

    first = await client.post(
        f"/db/data-sources/{ds_id}/properties", json={"name": "A", "type": "rich_text"}
    )
    existing_key = first.json()["key"]

    import routers.databases as databases_module

    keys = iter([existing_key, "freshKy1"])
    monkeypatch.setattr(databases_module, "mint_key", lambda: next(keys))

    res = await client.post(
        f"/db/data-sources/{ds_id}/properties", json={"name": "B", "type": "rich_text"}
    )
    assert res.status_code == 201, res.text
    assert res.json()["key"] == "freshKy1"


async def test_cannot_add_a_property_to_the_all_notes_virtual_source(client):
    res = await client.post(
        f"/db/data-sources/{ALL_NOTES_ID}/properties", json={"name": "X", "type": "text"}
    )
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# Renaming: name changes, key and row JSONB are untouched
# ---------------------------------------------------------------------------

async def test_renaming_a_property_leaves_key_and_row_jsonb_untouched(client, db_conn, test_user):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]

    prop_res = await client.post(
        f"/db/data-sources/{ds_id}/properties", json={"name": "Status", "type": "status"}
    )
    prop = prop_res.json()
    original_key = prop["key"]

    # A row whose JSONB uses this property's key, to prove the rename never
    # touches db_row_props.
    note = await db_conn.fetchrow(
        "INSERT INTO notes (user_id, title) VALUES ($1, 'N1') RETURNING id", test_user
    )
    original_properties = {original_key: {"type": "status", "status": "in_progress"}}
    await db_conn.execute(
        """
        INSERT INTO db_row_props (note_id, data_source_id, user_id, properties)
        VALUES ($1, $2, $3, $4)
        """,
        note["id"], ds_id, test_user, original_properties,
    )

    res = await client.patch(f"/db/properties/{prop['id']}", json={"name": "Progress"})
    assert res.status_code == 200, res.text
    renamed = res.json()
    assert renamed["name"] == "Progress"
    assert renamed["key"] == original_key

    row_after = await db_conn.fetchrow(
        "SELECT properties FROM db_row_props WHERE note_id = $1", note["id"]
    )
    assert row_after["properties"] == original_properties


async def test_rename_404s_for_unknown_property(client):
    res = await client.patch(f"/db/properties/{uuid.uuid4()}", json={"name": "X"})
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Deleting a property sweeps view filter/sorts/config.properties[]
# ---------------------------------------------------------------------------

async def test_deleting_a_property_sweeps_it_from_every_view(client, db_conn):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]
    view_id = created["views"][0]["id"]

    prop = (
        await client.post(
            f"/db/data-sources/{ds_id}/properties", json={"name": "Status", "type": "status"}
        )
    ).json()
    key = prop["key"]

    await db_conn.execute(
        """
        UPDATE db_views SET filter = $1, sorts = $2, config = $3 WHERE id = $4
        """,
        {"type": "condition", "property": key, "operator": "is_empty", "value": None},
        [{"property": key, "direction": "asc"}],
        {"properties": [{"property": key, "visible": True}]},
        view_id,
    )

    res = await client.delete(f"/db/properties/{prop['id']}")
    assert res.status_code == 204

    view_row = await db_conn.fetchrow(
        "SELECT filter, sorts, config FROM db_views WHERE id = $1", view_id
    )
    assert view_row["filter"] is None
    assert view_row["sorts"] == []
    assert view_row["config"] == {"properties": []}

    prop_count = await db_conn.fetchval(
        "SELECT count(*) FROM db_properties WHERE id = $1", prop["id"]
    )
    assert prop_count == 0


async def test_delete_404s_for_unknown_property(client):
    res = await client.delete(f"/db/properties/{uuid.uuid4()}")
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# The "All Notes" virtual source
# ---------------------------------------------------------------------------

async def test_all_notes_database_is_synthesized_and_flagged_virtual(client):
    res = await client.get(f"/db/databases/{ALL_NOTES_ID}")
    assert res.status_code == 200
    body = res.json()
    assert body["data_source"]["is_virtual"] is True
    assert body["data_source"]["system_kind"] == "notes"
    assert {p["key"] for p in body["properties"]} == {p.column for p in COLUMN_BACKED.values()}
    assert len(body["views"]) == 1 and body["views"][0]["type"] == "table"


async def test_all_notes_lists_the_users_notes_excludes_others_and_trashed(
    client, db_conn, test_user
):
    other_user = str(uuid.uuid4())
    await db_conn.execute(
        "INSERT INTO auth.users (id, email) VALUES ($1, $2)", other_user, f"{other_user}@t.local"
    )

    mine = await db_conn.fetchrow(
        "INSERT INTO notes (user_id, title, mastery_status, topics) "
        "VALUES ($1, 'Mine', 'learning', $2) RETURNING id",
        test_user, ["rust", "async"],
    )
    trashed = await db_conn.fetchrow(
        "INSERT INTO notes (user_id, title, deleted_at) VALUES ($1, 'Trashed', now()) RETURNING id",
        test_user,
    )
    others = await db_conn.fetchrow(
        "INSERT INTO notes (user_id, title) VALUES ($1, 'Not mine') RETURNING id", other_user
    )

    res = await client.get(f"/db/data-sources/{ALL_NOTES_ID}/rows")
    assert res.status_code == 200
    rows = res.json()["rows"]
    ids = {r["id"] for r in rows}

    assert str(mine["id"]) in ids
    assert str(trashed["id"]) not in ids
    assert str(others["id"]) not in ids

    mine_row = next(r for r in rows if r["id"] == str(mine["id"]))
    assert mine_row["properties"]["mastery_status"] == "learning"
    assert mine_row["properties"]["topics"] == ["rust", "async"]
    assert mine_row["properties"]["title"] == "Mine"


# ---------------------------------------------------------------------------
# Tenancy guard: every generated query scopes on user_id.
# ---------------------------------------------------------------------------

_ROUTER_PATH = Path(__file__).resolve().parents[1] / "routers" / "databases.py"
_VIEWS_PATH = Path(__file__).resolve().parents[1] / "services" / "db" / "views.py"
_SQL_KEYWORDS = ("SELECT", "INSERT", "UPDATE", "DELETE")


def _extract_sql_statements(path: Path) -> list[str]:
    """Every triple-quoted string in `path` whose first token is a SQL
    keyword. This repo's convention (see both files) is to write every SQL
    statement as its own triple-quoted string, so this is a complete scan
    of the actual queries, not a sample — and checking the *first token*
    (rather than a substring anywhere in the block) is what keeps this
    from also matching prose docstrings that happen to contain a SQL
    keyword as a word fragment (e.g. "Deletes" contains "DELETE")."""
    src = path.read_text()
    blocks = re.findall(r'"""(.*?)"""', src, re.S)
    statements = []
    for b in blocks:
        stripped = b.strip()
        first_word = stripped.split(None, 1)[0].upper() if stripped else ""
        if first_word in _SQL_KEYWORDS:
            statements.append(b)
    return statements


def test_every_query_in_databases_router_has_a_user_id_scope_predicate():
    statements = _extract_sql_statements(_ROUTER_PATH)
    assert len(statements) >= 8, "expected to find the router's SQL statements"
    for stmt in statements:
        assert "user_id" in stmt, f"query missing the user_id scope predicate:\n{stmt}"


def test_every_query_in_views_service_has_a_user_id_scope_predicate():
    statements = _extract_sql_statements(_VIEWS_PATH)
    assert len(statements) >= 2, "expected to find the views service's SQL statements"
    for stmt in statements:
        assert "user_id" in stmt, f"query missing the user_id scope predicate:\n{stmt}"
