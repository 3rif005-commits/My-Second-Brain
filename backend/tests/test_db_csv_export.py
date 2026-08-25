"""Tests for `GET /db/data-sources/{data_source_id}/export` (Milestone 14, task-48):
CSV export honouring the currently open view's filter/sort.

Spec: docs/superpowers/specs/2026-08-08-notion-databases-design.md §12 (research
§7.2/§10, "Markdown & CSV" export). Plan test case, line 471: "export honours the
current view's filters and sorts."

Runs against the local pgtest harness through the same transaction-wrapped `db_conn`/
`test_user` fixtures (`tests/conftest.py`) and `client`-fixture-building convention
`tests/test_databases_router.py`/`tests/test_databases_query_endpoint.py` already
established — reused verbatim, not duplicated with a different shape. NEVER touches
`core.config.settings.database_url` (the real Supabase project) — no code path here
can reach it.
"""
from __future__ import annotations

import csv
import io
import uuid

import httpx
import pytest_asyncio

from main import app
from routers.databases import ALL_NOTES_ID
from routers.notes import get_user_id
from services.db.connection import get_conn


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


async def _create_property(
    client: httpx.AsyncClient, ds_id: str, name: str, type_: str, config: dict | None = None
) -> dict:
    res = await client.post(
        f"/db/data-sources/{ds_id}/properties",
        json={"name": name, "type": type_, "config": config or {}},
    )
    assert res.status_code == 201, res.text
    return res.json()


async def _insert_row(db_conn, user_id: str, ds_id: str, properties: dict, *, title="Row") -> str:
    note = await db_conn.fetchrow(
        "INSERT INTO notes (user_id, title) VALUES ($1, $2) RETURNING id", user_id, title
    )
    await db_conn.execute(
        """
        INSERT INTO db_row_props (note_id, data_source_id, user_id, properties)
        VALUES ($1, $2, $3, $4)
        """,
        note["id"], ds_id, user_id, properties,
    )
    return str(note["id"])


async def _create_view(client: httpx.AsyncClient, ds_id: str, name: str = "Filtered view") -> dict:
    res = await client.post(f"/db/data-sources/{ds_id}/views", json={"name": name, "type": "table"})
    assert res.status_code == 201, res.text
    return res.json()


async def _patch_view(client: httpx.AsyncClient, view_id: str, patch: dict) -> dict:
    res = await client.patch(f"/db/views/{view_id}", json=patch)
    assert res.status_code == 200, res.text
    return res.json()


def _rows(csv_text: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(csv_text)))


# ---------------------------------------------------------------------------
# Unfiltered/unsorted view: every row exported, header order matches position.
# ---------------------------------------------------------------------------

async def test_unfiltered_view_exports_every_row_header_order_matches_position(
    client, db_conn, test_user
):
    created = await _create_database(client, "Reading List")
    ds_id = created["data_source"]["id"]
    default_view_id = created["views"][0]["id"]
    title_key = created["properties"][0]["key"]  # auto-created "Title" property, position 0

    author_prop = await _create_property(client, ds_id, "Author", "rich_text")
    year_prop = await _create_property(client, ds_id, "Year", "number")

    await _insert_row(
        db_conn, test_user, ds_id,
        {
            title_key: {"type": "title", "title": "Dune"},
            author_prop["key"]: {"type": "rich_text", "rich_text": "Herbert"},
            year_prop["key"]: {"type": "number", "number": 1965},
        },
    )
    await _insert_row(
        db_conn, test_user, ds_id,
        {
            title_key: {"type": "title", "title": "Foundation"},
            author_prop["key"]: {"type": "rich_text", "rich_text": "Asimov"},
            year_prop["key"]: {"type": "number", "number": 1951},
        },
    )

    res = await client.get(f"/db/data-sources/{ds_id}/export?view_id={default_view_id}")
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/csv")

    rows = _rows(res.text)
    assert rows[0] == ["id", "Title", "Author", "Year"]
    body_titles = {r[1] for r in rows[1:]}
    assert body_titles == {"Dune", "Foundation"}
    assert len(rows) == 3  # header + 2 rows


# ---------------------------------------------------------------------------
# A view with a real filter/sort exports only the matching rows, sorted.
# ---------------------------------------------------------------------------

async def test_filtered_sorted_view_exports_only_matching_rows_in_sorted_order(
    client, db_conn, test_user
):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]
    title_key = created["properties"][0]["key"]
    status_prop = await _create_property(client, ds_id, "Status", "select", config={
        "options": [
            {"id": "opt_done", "name": "Done", "color": "green"},
            {"id": "opt_todo", "name": "Todo", "color": "gray"},
        ]
    })
    year_prop = await _create_property(client, ds_id, "Year", "number")

    await _insert_row(
        db_conn, test_user, ds_id,
        {
            title_key: {"type": "title", "title": "Later"},
            status_prop["key"]: {"type": "select", "select": "opt_done"},
            year_prop["key"]: {"type": "number", "number": 2020},
        },
    )
    await _insert_row(
        db_conn, test_user, ds_id,
        {
            title_key: {"type": "title", "title": "Earlier"},
            status_prop["key"]: {"type": "select", "select": "opt_done"},
            year_prop["key"]: {"type": "number", "number": 2010},
        },
    )
    await _insert_row(
        db_conn, test_user, ds_id,
        {
            title_key: {"type": "title", "title": "Excluded"},
            status_prop["key"]: {"type": "select", "select": "opt_todo"},
            year_prop["key"]: {"type": "number", "number": 2015},
        },
    )

    view = await _create_view(client, ds_id)
    await _patch_view(
        client, view["id"],
        {
            "filter": {
                "type": "condition", "property": status_prop["key"],
                "operator": "equals", "value": "opt_done",
            },
            "sorts": [{"property": year_prop["key"], "direction": "asc"}],
        },
    )

    res = await client.get(f"/db/data-sources/{ds_id}/export?view_id={view['id']}")
    assert res.status_code == 200, res.text
    rows = _rows(res.text)
    assert rows[0] == ["id", "Title", "Status", "Year"]
    body = rows[1:]
    assert len(body) == 2
    assert [r[1] for r in body] == ["Earlier", "Later"]  # 2010 before 2020, ascending
    assert [r[2] for r in body] == ["Done", "Done"]  # resolved option label, not raw id


# ---------------------------------------------------------------------------
# A representative property-type set renders through format_property_value.
# ---------------------------------------------------------------------------

async def test_representative_property_types_render_through_format_property_value(
    client, db_conn, test_user
):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]
    default_view_id = created["views"][0]["id"]
    title_key = created["properties"][0]["key"]

    number_prop = await _create_property(client, ds_id, "Count", "number")
    date_prop = await _create_property(client, ds_id, "Due", "date")
    checkbox_prop = await _create_property(client, ds_id, "Done", "checkbox")
    select_prop = await _create_property(client, ds_id, "Priority", "select", config={
        "options": [{"id": "opt_hi", "name": "High", "color": "red"}]
    })
    multi_prop = await _create_property(client, ds_id, "Topics", "multi_select", config={
        "options": [
            {"id": "opt_a", "name": "rust", "color": "orange"},
            {"id": "opt_b", "name": "async", "color": "blue"},
        ]
    })
    text_prop = await _create_property(client, ds_id, "Notes", "rich_text")

    await _insert_row(
        db_conn, test_user, ds_id,
        {
            title_key: {"type": "title", "title": "Row 1"},
            number_prop["key"]: {"type": "number", "number": 42},
            date_prop["key"]: {"type": "date", "date": {"start": "2026-09-01T00:00:00Z"}},
            checkbox_prop["key"]: {"type": "checkbox", "checkbox": True},
            select_prop["key"]: {"type": "select", "select": "opt_hi"},
            multi_prop["key"]: {"type": "multi_select", "multi_select": ["opt_a", "opt_b"]},
            text_prop["key"]: {"type": "rich_text", "rich_text": "hello world"},
        },
    )

    res = await client.get(f"/db/data-sources/{ds_id}/export?view_id={default_view_id}")
    assert res.status_code == 200, res.text
    rows = _rows(res.text)
    header = rows[0]
    body = dict(zip(header, rows[1]))

    assert body["Count"] == "42"
    assert body["Due"] == "2026-09-01"
    assert body["Done"] == "Yes"
    assert body["Priority"] == "High"
    assert body["Topics"] == "rust, async"
    assert body["Notes"] == "hello world"


# ---------------------------------------------------------------------------
# Empty data source: header-only CSV, not an error.
# ---------------------------------------------------------------------------

async def test_empty_data_source_exports_header_only_csv(client):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]
    default_view_id = created["views"][0]["id"]

    res = await client.get(f"/db/data-sources/{ds_id}/export?view_id={default_view_id}")
    assert res.status_code == 200, res.text
    rows = _rows(res.text)
    assert rows == [["id", "Title"]]


# ---------------------------------------------------------------------------
# All Notes is explicitly not a supported export target -- 400, not a
# misleading 404/500.
# ---------------------------------------------------------------------------

async def test_all_notes_export_is_400_not_a_silent_success(client):
    res = await client.get(f"/db/data-sources/{ALL_NOTES_ID}/export?view_id={uuid.uuid4()}")
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# Cross-tenant: a view id belonging to another user 404s -- not a silent
# cross-tenant leak. Mutation-tested below (Milestone 2's own guard-test
# convention).
# ---------------------------------------------------------------------------

async def test_export_404s_for_a_view_id_belonging_to_another_user(client, db_conn, test_user):
    created = await _create_database(client, "Mine")
    ds_id = created["data_source"]["id"]
    own_view_id = created["views"][0]["id"]

    other_user = str(uuid.uuid4())
    await db_conn.execute(
        "INSERT INTO auth.users (id, email) VALUES ($1, $2)", other_user, f"{other_user}@t.local"
    )
    other_db = await db_conn.fetchrow(
        "INSERT INTO db_databases (user_id, title) VALUES ($1, 'Other') RETURNING id", other_user
    )
    other_ds = await db_conn.fetchrow(
        "INSERT INTO db_data_sources (database_id, user_id, name) VALUES ($1, $2, 'Default') RETURNING id",
        other_db["id"], other_user,
    )
    other_view = await db_conn.fetchrow(
        "INSERT INTO db_views (data_source_id, user_id, name, type) VALUES ($1, $2, 'Theirs', 'table') RETURNING id",
        other_ds["id"], other_user,
    )

    # Case 1: the caller's own data source, but a view id that belongs to another
    # user entirely (not even on this data source) -- must not resolve.
    res = await client.get(f"/db/data-sources/{ds_id}/export?view_id={other_view['id']}")
    assert res.status_code == 404

    # Case 2: the other user's OWN data source + their OWN view id -- the exact
    # shape a well-formed but not-owned request would take.
    res = await client.get(f"/db/data-sources/{other_ds['id']}/export?view_id={other_view['id']}")
    assert res.status_code == 404

    # Sanity: the caller's own view against their own data source still works,
    # proving the 404s above are the ownership check, not a broken route.
    res = await client.get(f"/db/data-sources/{ds_id}/export?view_id={own_view_id}")
    assert res.status_code == 200
