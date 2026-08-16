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
    # A fresh database ships with a default "Title" property (product
    # decision after the review: a database with zero columns is inert) --
    # not an empty list.
    assert len(body["properties"]) == 1
    assert body["properties"][0]["name"] == "Title"
    assert body["properties"][0]["type"] == "title"
    assert re.fullmatch(r"[0-9A-Za-z]{8}", body["properties"][0]["key"])
    assert len(body["views"]) == 1
    assert body["views"][0]["type"] == "table"

    database_id = body["database"]["id"]
    ds_count = await db_conn.fetchval(
        "SELECT count(*) FROM db_data_sources WHERE database_id = $1", database_id
    )
    view_count = await db_conn.fetchval(
        "SELECT count(*) FROM db_views WHERE data_source_id = $1", body["data_source"]["id"]
    )
    prop_count = await db_conn.fetchval(
        "SELECT count(*) FROM db_properties WHERE data_source_id = $1", body["data_source"]["id"]
    )
    assert ds_count == 1
    assert view_count == 1
    assert prop_count == 1


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

    # Values are spec §3.3's discriminated wrapper, same shape as an
    # ordinary data source's db_row_props.properties entries (task-5
    # review finding 2) — not bare scalars.
    mine_row = next(r for r in rows if r["id"] == str(mine["id"]))
    assert mine_row["properties"]["mastery_status"] == {"type": "status", "status": "learning"}
    assert mine_row["properties"]["topics"] == {
        "type": "multi_select", "multi_select": ["rust", "async"]
    }
    assert mine_row["properties"]["title"] == {"type": "title", "title": "Mine"}


# ---------------------------------------------------------------------------
# Listing rows for an ordinary (non-virtual) data source — task-5 review
# finding 5: this path had zero test coverage, and depends on the jsonb
# codec registered in services/db/connection.py's _init_connection, so it's
# worth actually exercising rather than trusting by inspection.
# ---------------------------------------------------------------------------

async def test_list_rows_for_an_ordinary_data_source_round_trips_jsonb(
    client, db_conn, test_user
):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]

    prop = (
        await client.post(
            f"/db/data-sources/{ds_id}/properties", json={"name": "Status", "type": "status"}
        )
    ).json()

    note = await db_conn.fetchrow(
        "INSERT INTO notes (user_id, title) VALUES ($1, 'Row 1') RETURNING id", test_user
    )
    value = {prop["key"]: {"type": "status", "status": "in_progress"}}
    await db_conn.execute(
        """
        INSERT INTO db_row_props (note_id, data_source_id, user_id, properties)
        VALUES ($1, $2, $3, $4)
        """,
        note["id"], ds_id, test_user, value,
    )

    res = await client.get(f"/db/data-sources/{ds_id}/rows")
    assert res.status_code == 200
    rows = res.json()["rows"]
    assert len(rows) == 1
    assert rows[0]["id"] == str(note["id"])
    assert rows[0]["properties"] == value  # round-tripped through the jsonb codec intact


async def test_list_rows_404s_for_an_unknown_data_source(client):
    res = await client.get(f"/db/data-sources/{uuid.uuid4()}/rows")
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# list_rows has a hard cap (task-10 review finding 1) — neither branch had
# any LIMIT, so a user with hundreds/thousands of notes would fetch every
# matching row unconditionally on the one page Milestone 2 ships
# (/brain/db/all-notes). No pagination UI yet (Milestone 3+ scope) — just a
# sane cap on the query. The router's private `_ROWS_LIMIT` constant is
# monkeypatched down to a small number so the test doesn't need to actually
# insert hundreds of rows.
# ---------------------------------------------------------------------------

async def test_list_rows_caps_all_notes_at_the_hard_limit(
    client, db_conn, test_user, monkeypatch
):
    import routers.databases as databases_module

    monkeypatch.setattr(databases_module, "_ROWS_LIMIT", 3, raising=False)

    for i in range(5):
        await db_conn.execute(
            "INSERT INTO notes (user_id, title) VALUES ($1, $2)", test_user, f"Note {i}"
        )

    res = await client.get(f"/db/data-sources/{ALL_NOTES_ID}/rows")
    assert res.status_code == 200
    assert len(res.json()["rows"]) == 3


async def test_list_rows_caps_an_ordinary_data_source_at_the_hard_limit(
    client, db_conn, test_user, monkeypatch
):
    import routers.databases as databases_module

    monkeypatch.setattr(databases_module, "_ROWS_LIMIT", 3, raising=False)

    created = await _create_database(client)
    ds_id = created["data_source"]["id"]

    for i in range(5):
        note = await db_conn.fetchrow(
            "INSERT INTO notes (user_id, title) VALUES ($1, $2) RETURNING id",
            test_user, f"Row {i}",
        )
        await db_conn.execute(
            "INSERT INTO db_row_props (note_id, data_source_id, user_id) VALUES ($1, $2, $3)",
            note["id"], ds_id, test_user,
        )

    res = await client.get(f"/db/data-sources/{ds_id}/rows")
    assert res.status_code == 200
    assert len(res.json()["rows"]) == 3


# ---------------------------------------------------------------------------
# Creating a row (fix round 2, review finding 3) — without this, an ordinary
# data source has zero rows, permanently, and the PATCH endpoint below is
# unreachable end-to-end.
# ---------------------------------------------------------------------------

async def test_create_row_creates_a_note_and_a_row_props_in_one_transaction(
    client, db_conn
):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]

    res = await client.post(f"/db/data-sources/{ds_id}/rows")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["properties"] == {}

    note = await db_conn.fetchrow("SELECT id, title FROM notes WHERE id = $1", body["id"])
    assert note is not None
    assert note["title"] == "Untitled"

    row = await db_conn.fetchrow(
        "SELECT data_source_id, properties FROM db_row_props WHERE note_id = $1", body["id"]
    )
    assert row is not None
    assert str(row["data_source_id"]) == ds_id
    assert row["properties"] == {}


async def test_create_row_appends_stable_position_not_a_tie_at_zero(client, db_conn):
    # Without an explicit position, every created row defaulted to 0 --
    # list_rows's ORDER BY position was then an unbroken tie among them,
    # so rows could visibly reshuffle between GETs once 2+ existed.
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]

    first = (await client.post(f"/db/data-sources/{ds_id}/rows")).json()
    second = (await client.post(f"/db/data-sources/{ds_id}/rows")).json()
    third = (await client.post(f"/db/data-sources/{ds_id}/rows")).json()

    positions = await db_conn.fetch(
        "SELECT note_id, position FROM db_row_props WHERE data_source_id = $1 ORDER BY position",
        ds_id,
    )
    ordered_ids = [str(r["note_id"]) for r in positions]
    assert ordered_ids == [first["id"], second["id"], third["id"]]
    # Strictly increasing, not all tied at the column default of 0.
    values = [r["position"] for r in positions]
    assert values == sorted(values)
    assert len(set(values)) == 3


async def test_create_row_400s_for_the_all_notes_virtual_source(client):
    res = await client.post(f"/db/data-sources/{ALL_NOTES_ID}/rows")
    assert res.status_code == 400


async def test_create_row_404s_for_unknown_data_source(client):
    res = await client.post(f"/db/data-sources/{uuid.uuid4()}/rows")
    assert res.status_code == 404


async def test_create_row_404s_for_another_users_data_source(client, db_conn):
    # migration 001's on_auth_user_created trigger already inserts a
    # matching `profiles` row for every `auth.users` insert (see the
    # `test_user` fixture's own docstring) -- no separate insert needed.
    other_user = str(uuid.uuid4())
    await db_conn.execute(
        "INSERT INTO auth.users (id, email) VALUES ($1, $2)", other_user, f"{other_user}@t.local"
    )
    db_row = await db_conn.fetchrow(
        "INSERT INTO db_databases (user_id, title) VALUES ($1, 'Other') RETURNING id", other_user
    )
    ds_row = await db_conn.fetchrow(
        "INSERT INTO db_data_sources (database_id, user_id) VALUES ($1, $2) RETURNING id",
        db_row["id"], other_user,
    )
    res = await client.post(f"/db/data-sources/{ds_row['id']}/rows")
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Writing a row's property value (task-5 review finding 1) — blocking for
# the frontend's own planned test cases ("TableView renders 8 property
# types read-only, then editable"; "optimistic edit rolls back and toasts
# on a 500"), neither buildable without a way to write a cell.
# ---------------------------------------------------------------------------

async def test_update_row_property_writes_a_single_key_and_leaves_others_untouched(
    client, db_conn, test_user
):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]

    prop_a = (
        await client.post(
            f"/db/data-sources/{ds_id}/properties", json={"name": "Status", "type": "status"}
        )
    ).json()
    prop_b = (
        await client.post(
            f"/db/data-sources/{ds_id}/properties", json={"name": "Notes", "type": "rich_text"}
        )
    ).json()

    note = await db_conn.fetchrow(
        "INSERT INTO notes (user_id, title) VALUES ($1, 'Row 1') RETURNING id", test_user
    )
    initial = {
        prop_a["key"]: {"type": "status", "status": "not_started"},
        prop_b["key"]: {"type": "rich_text", "rich_text": "hello"},
    }
    await db_conn.execute(
        """
        INSERT INTO db_row_props (note_id, data_source_id, user_id, properties)
        VALUES ($1, $2, $3, $4)
        """,
        note["id"], ds_id, test_user, initial,
    )

    res = await client.patch(
        f"/db/data-sources/{ds_id}/rows/{note['id']}",
        json={"property_key": prop_a["key"], "value": {"type": "status", "status": "done"}},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["id"] == str(note["id"])
    assert body["properties"][prop_a["key"]] == {"type": "status", "status": "done"}
    assert body["properties"][prop_b["key"]] == {"type": "rich_text", "rich_text": "hello"}

    row_after = await db_conn.fetchrow(
        "SELECT properties FROM db_row_props WHERE note_id = $1", note["id"]
    )
    # The other property's value is byte-identical -- the write only ever
    # touches its own key (jsonb_set's third argument is the target path).
    assert row_after["properties"][prop_b["key"]] == initial[prop_b["key"]]
    assert row_after["properties"][prop_a["key"]] == {"type": "status", "status": "done"}


async def test_update_row_property_404s_for_unknown_property(client, db_conn, test_user):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]
    note = await db_conn.fetchrow(
        "INSERT INTO notes (user_id, title) VALUES ($1, 'Row 1') RETURNING id", test_user
    )
    await db_conn.execute(
        "INSERT INTO db_row_props (note_id, data_source_id, user_id) VALUES ($1, $2, $3)",
        note["id"], ds_id, test_user,
    )
    res = await client.patch(
        f"/db/data-sources/{ds_id}/rows/{note['id']}",
        json={"property_key": "doesNotEx", "value": {"type": "status", "status": "x"}},
    )
    assert res.status_code == 404


async def test_update_row_property_404s_for_an_unknown_row(client):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]
    prop = (
        await client.post(
            f"/db/data-sources/{ds_id}/properties", json={"name": "Status", "type": "status"}
        )
    ).json()

    res = await client.patch(
        f"/db/data-sources/{ds_id}/rows/{uuid.uuid4()}",
        json={"property_key": prop["key"], "value": {"type": "status", "status": "x"}},
    )
    assert res.status_code == 404


async def test_update_row_property_404s_for_another_users_row(client, db_conn, test_user):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]
    prop = (
        await client.post(
            f"/db/data-sources/{ds_id}/properties", json={"name": "Status", "type": "status"}
        )
    ).json()
    note = await db_conn.fetchrow(
        "INSERT INTO notes (user_id, title) VALUES ($1, 'Row 1') RETURNING id", test_user
    )
    await db_conn.execute(
        "INSERT INTO db_row_props (note_id, data_source_id, user_id, properties) "
        "VALUES ($1, $2, $3, '{}')",
        note["id"], ds_id, test_user,
    )

    other_user = str(uuid.uuid4())
    await db_conn.execute(
        "INSERT INTO auth.users (id, email) VALUES ($1, $2)", other_user, f"{other_user}@t.local"
    )
    app.dependency_overrides[get_user_id] = lambda: other_user

    res = await client.patch(
        f"/db/data-sources/{ds_id}/rows/{note['id']}",
        json={"property_key": prop["key"], "value": {"type": "status", "status": "x"}},
    )
    assert res.status_code == 404


async def test_update_row_property_404s_when_row_belongs_to_a_different_data_source(
    client, db_conn, test_user
):
    created1 = await _create_database(client, "DB1")
    created2 = await _create_database(client, "DB2")
    ds1_id = created1["data_source"]["id"]
    ds2_id = created2["data_source"]["id"]

    # Same name/type on both, so the mixup is caught even when the property
    # *shape* matches -- only the (data_source_id, key) pair actually differs.
    prop2 = (
        await client.post(
            f"/db/data-sources/{ds2_id}/properties", json={"name": "Status", "type": "status"}
        )
    ).json()

    note = await db_conn.fetchrow(
        "INSERT INTO notes (user_id, title) VALUES ($1, 'Row 1') RETURNING id", test_user
    )
    await db_conn.execute(
        "INSERT INTO db_row_props (note_id, data_source_id, user_id, properties) "
        "VALUES ($1, $2, $3, '{}')",
        note["id"], ds1_id, test_user,
    )

    # prop2's key only exists under ds2 -- but the row lives under ds1.
    res = await client.patch(
        f"/db/data-sources/{ds1_id}/rows/{note['id']}",
        json={"property_key": prop2["key"], "value": {"type": "status", "status": "x"}},
    )
    assert res.status_code == 404


async def test_update_row_property_is_not_implemented_for_all_notes(client):
    res = await client.patch(
        f"/db/data-sources/{ALL_NOTES_ID}/rows/{uuid.uuid4()}",
        json={"property_key": "topics", "value": {"type": "multi_select", "multi_select": []}},
    )
    assert res.status_code == 501


async def test_update_row_property_with_explicit_null_clears_the_key(
    client, db_conn, test_user
):
    # Review finding 1, fix round 2: `jsonb_set(properties, path, NULL, true)`
    # would set the *entire* NOT NULL `properties` column to SQL NULL, not
    # just this key -- a real NotNullViolationError verified against the
    # harness. An explicit top-level `null` must instead drop just the key
    # (`properties - key`), spec §3.3: "Absent key ≡ empty."
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]
    prop = (
        await client.post(
            f"/db/data-sources/{ds_id}/properties", json={"name": "Status", "type": "status"}
        )
    ).json()

    note = await db_conn.fetchrow(
        "INSERT INTO notes (user_id, title) VALUES ($1, 'Row 1') RETURNING id", test_user
    )
    await db_conn.execute(
        """
        INSERT INTO db_row_props (note_id, data_source_id, user_id, properties)
        VALUES ($1, $2, $3, $4)
        """,
        note["id"], ds_id, test_user, {prop["key"]: {"type": "status", "status": "done"}},
    )

    res = await client.patch(
        f"/db/data-sources/{ds_id}/rows/{note['id']}",
        json={"property_key": prop["key"], "value": None},
    )
    assert res.status_code == 200, res.text
    assert prop["key"] not in res.json()["properties"]

    row_after = await db_conn.fetchrow(
        "SELECT properties FROM db_row_props WHERE note_id = $1", note["id"]
    )
    # The column itself is still NOT NULL -- only the one key is gone.
    assert row_after["properties"] is not None
    assert prop["key"] not in row_after["properties"]


async def test_update_row_property_rejects_a_wrapper_whose_type_tag_mismatches_the_property(
    client, db_conn, test_user
):
    # task-10 review finding 2: `RowPropertyUpdate.value` is `Any` with no
    # shape validation, so a `status`-typed property could be PATCHed with a
    # `number` wrapper and get written into db_row_props.properties
    # verbatim — silently violating spec §3.3's invariant that every stored
    # value is a discriminated wrapper matching its property's declared
    # type, which Milestone 3's filter/sort compiler will assume holds.
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]
    prop = (
        await client.post(
            f"/db/data-sources/{ds_id}/properties", json={"name": "Status", "type": "status"}
        )
    ).json()

    note = await db_conn.fetchrow(
        "INSERT INTO notes (user_id, title) VALUES ($1, 'Row 1') RETURNING id", test_user
    )
    await db_conn.execute(
        "INSERT INTO db_row_props (note_id, data_source_id, user_id) VALUES ($1, $2, $3)",
        note["id"], ds_id, test_user,
    )

    res = await client.patch(
        f"/db/data-sources/{ds_id}/rows/{note['id']}",
        json={"property_key": prop["key"], "value": {"type": "number", "number": 42}},
    )
    assert res.status_code == 400

    row_after = await db_conn.fetchrow(
        "SELECT properties FROM db_row_props WHERE note_id = $1", note["id"]
    )
    assert prop["key"] not in row_after["properties"]  # rejected, never written


async def test_update_row_property_rejects_a_bare_scalar_value(client, db_conn, test_user):
    # Same invariant as above, but for a value that isn't even wrapped in a
    # dict at all (e.g. `{"property_key": "...", "value": "done"}`).
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]
    prop = (
        await client.post(
            f"/db/data-sources/{ds_id}/properties", json={"name": "Status", "type": "status"}
        )
    ).json()

    note = await db_conn.fetchrow(
        "INSERT INTO notes (user_id, title) VALUES ($1, 'Row 1') RETURNING id", test_user
    )
    await db_conn.execute(
        "INSERT INTO db_row_props (note_id, data_source_id, user_id) VALUES ($1, $2, $3)",
        note["id"], ds_id, test_user,
    )

    res = await client.patch(
        f"/db/data-sources/{ds_id}/rows/{note['id']}",
        json={"property_key": prop["key"], "value": "done"},
    )
    assert res.status_code == 400

    row_after = await db_conn.fetchrow(
        "SELECT properties FROM db_row_props WHERE note_id = $1", note["id"]
    )
    assert prop["key"] not in row_after["properties"]  # rejected, never written


async def test_update_row_property_requires_a_value_field(client, db_conn, test_user):
    # Review finding 1, fix round 2: `value` has no default (was `Any = None`,
    # now required) -- an omitted `value` is a 422 at the Pydantic layer, not
    # a NotNullViolationError 500 once it reaches `jsonb_set`.
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]
    note = await db_conn.fetchrow(
        "INSERT INTO notes (user_id, title) VALUES ($1, 'Row 1') RETURNING id", test_user
    )
    await db_conn.execute(
        "INSERT INTO db_row_props (note_id, data_source_id, user_id) VALUES ($1, $2, $3)",
        note["id"], ds_id, test_user,
    )
    res = await client.patch(
        f"/db/data-sources/{ds_id}/rows/{note['id']}",
        json={"property_key": "doesNotMatter"},
    )
    assert res.status_code == 422


# ---------------------------------------------------------------------------
# View updates (task-5 review finding 1: "there's also no view-update
# endpoint" -- column width/visibility/sort persistence has nowhere to go).
# ---------------------------------------------------------------------------

async def test_update_view_partially_updates_only_provided_fields(client):
    created = await _create_database(client)
    view_id = created["views"][0]["id"]

    res = await client.patch(f"/db/views/{view_id}", json={"name": "My View"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["name"] == "My View"
    assert body["type"] == "table"  # untouched
    assert body["is_locked"] is False  # untouched


async def test_update_view_can_persist_filter_sorts_and_config(client):
    created = await _create_database(client)
    view_id = created["views"][0]["id"]

    res = await client.patch(
        f"/db/views/{view_id}",
        json={
            "filter": {
                "type": "condition", "property": "a7Kd9x", "operator": "is_empty", "value": None,
            },
            "sorts": [{"property": "a7Kd9x", "direction": "asc"}],
            "config": {"frozen_column_index": 1},
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["filter"]["property"] == "a7Kd9x"
    assert body["sorts"] == [{"property": "a7Kd9x", "direction": "asc"}]
    assert body["config"] == {"frozen_column_index": 1}


async def test_update_view_drops_explicit_null_for_a_non_nullable_field_without_crashing(
    client,
):
    # Review finding 2, fix round 2: 5 of the 7 updatable fields (name,
    # config, sorts, is_locked, position) are NOT NULL columns. An explicit
    # `null` for one of them used to reach the database as a real
    # NotNullViolationError 500 -- verified against the harness. It must
    # instead be a no-op for that one field, with the rest of the same
    # request still applying, and only `icon`/`filter` may actually clear.
    created = await _create_database(client)
    view_id = created["views"][0]["id"]
    original_name = created["views"][0]["name"]

    res = await client.patch(
        f"/db/views/{view_id}",
        json={"name": None, "icon": "📊"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["name"] == original_name  # untouched, not nulled
    assert body["icon"] == "📊"  # the nullable field still applied


async def test_update_view_404s_for_unknown_view(client):
    res = await client.patch(f"/db/views/{uuid.uuid4()}", json={"name": "X"})
    assert res.status_code == 404


async def test_update_view_404s_for_another_users_view(client, db_conn):
    created = await _create_database(client)
    view_id = created["views"][0]["id"]

    other_user = str(uuid.uuid4())
    await db_conn.execute(
        "INSERT INTO auth.users (id, email) VALUES ($1, $2)", other_user, f"{other_user}@t.local"
    )
    app.dependency_overrides[get_user_id] = lambda: other_user

    res = await client.patch(f"/db/views/{view_id}", json={"name": "X"})
    assert res.status_code == 404


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


# A real scope predicate, not just a mention: `user_id = $3` (or similar).
# INSERTs don't have a WHERE predicate at all — their tenancy guarantee is
# that they write user_id as a column value, so those are checked
# separately (a plain "is the word present" substring check, which is
# exactly right for a column list: `INSERT INTO t (user_id, ...) VALUES
# (...)`). A loose "user_id" substring check on every statement would also
# pass on a comment or a column-list mention with no actual WHERE
# predicate, which is what this is tightening (task-5 review, minor
# finding 1).
_SCOPE_PREDICATE_RE = re.compile(r"user_id\s*=\s*\$\d+")


def _assert_has_scope_predicate(stmt: str) -> None:
    first_word = stmt.strip().split(None, 1)[0].upper()
    if first_word == "INSERT":
        assert re.search(r"\buser_id\b", stmt), f"INSERT never mentions user_id:\n{stmt}"
        return
    assert _SCOPE_PREDICATE_RE.search(stmt), f"query missing a real user_id = $N predicate:\n{stmt}"


def test_every_query_in_databases_router_has_a_user_id_scope_predicate():
    statements = _extract_sql_statements(_ROUTER_PATH)
    # Milestone 7 (task-21) added the relation/sub-item/dependency endpoints'
    # own SQL (35 total statements at that point, up from 8) — the floor is
    # raised so this sweep can't silently go vacuous if those endpoints'
    # queries are ever refactored away from the router without a matching
    # drop in this floor (this exact failure mode is why the floor exists
    # at all, per the brief: "extend the floor; do not leave the new
    # handlers outside the sweep").
    assert len(statements) >= 30, "expected to find the router's SQL statements"
    for stmt in statements:
        _assert_has_scope_predicate(stmt)


def test_every_query_in_views_service_has_a_user_id_scope_predicate():
    statements = _extract_sql_statements(_VIEWS_PATH)
    assert len(statements) >= 2, "expected to find the views service's SQL statements"
    for stmt in statements:
        _assert_has_scope_predicate(stmt)
