"""Tests for `routers/db_import.py`'s `POST /db/import/csv` (Milestone 14, Task 47):
per-column type inference, the new-database write path (reusing `create_database`/
`create_property`/`update_property`/`create_row_core` directly), and the
`trigger_automations=False` bulk-import guard.

Runs against the local pgtest harness (localhost:55432) through the transaction-wrapped
`db_conn`/`test_user` fixtures (`tests/conftest.py`), rolled back on teardown -- same
convention as every other `test_db_*.py` file. NEVER touches
`core.config.settings.database_url` (the real Supabase project).
"""
from __future__ import annotations

import httpx
import pytest_asyncio

from main import app
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


def _csv_file(text: str, filename: str = "data.csv", content_type: str = "text/csv"):
    return {"file": (filename, text.encode("utf-8"), content_type)}


async def _import(client: httpx.AsyncClient, text: str, *, title: str | None = None, filename="data.csv"):
    data = {"database_title": title} if title is not None else {}
    res = await client.post("/db/import/csv", data=data, files=_csv_file(text, filename=filename))
    return res


async def _get_rows(client: httpx.AsyncClient, data_source_id: str) -> list[dict]:
    res = await client.get(f"/db/data-sources/{data_source_id}/rows")
    assert res.status_code == 200, res.text
    return res.json()["rows"]


async def _properties_by_name(client: httpx.AsyncClient, database_id: str) -> dict[str, dict]:
    res = await client.get(f"/db/databases/{database_id}")
    assert res.status_code == 200, res.text
    return {p["name"]: p for p in res.json()["properties"]}


# ===========================================================================
# Representative CSV: every inferable type + one empty cell per column
# ===========================================================================

_REPRESENTATIVE_CSV = (
    "Name,Age,Joined,Active,Priority,Notes\n"
    "Alice,30,2024-01-15,true,High,Loves tea\n"
    "Bob,,2024-02-20,false,Low,\n"
    "Carol,42,,yes,High,Some notes here\n"
)


async def test_representative_csv_infers_every_type_and_reports_per_column(client):
    res = await _import(client, _REPRESENTATIVE_CSV, title="Contacts")
    assert res.status_code == 201, res.text
    body = res.json()

    assert body["row_count"] == 3
    by_header = {c["header"]: c for c in body["columns"]}

    assert by_header["Name"]["inferred_type"] == "title"
    assert by_header["Name"]["non_empty_count"] == 3
    assert by_header["Name"]["empty_count"] == 0

    assert by_header["Age"]["inferred_type"] == "number"
    assert by_header["Age"]["non_empty_count"] == 2
    assert by_header["Age"]["empty_count"] == 1

    assert by_header["Joined"]["inferred_type"] == "date"
    assert by_header["Joined"]["non_empty_count"] == 2
    assert by_header["Joined"]["empty_count"] == 1

    assert by_header["Active"]["inferred_type"] == "checkbox"
    assert by_header["Active"]["non_empty_count"] == 3
    assert by_header["Active"]["empty_count"] == 0

    assert by_header["Priority"]["inferred_type"] == "select"
    assert by_header["Priority"]["non_empty_count"] == 3
    assert by_header["Priority"]["empty_count"] == 0

    assert by_header["Notes"]["inferred_type"] == "rich_text"
    assert by_header["Notes"]["non_empty_count"] == 2
    assert by_header["Notes"]["empty_count"] == 1

    # The database is real and reachable, and rows carry the actual typed values.
    props = await _properties_by_name(client, body["database_id"])
    rows = await _get_rows(client, props["Name"]["data_source_id"])
    assert len(rows) == 3

    by_title = {r["properties"][props["Name"]["key"]]["title"]: r for r in rows}
    alice = by_title["Alice"]
    assert alice["properties"][props["Age"]["key"]] == {"type": "number", "number": 30}
    assert alice["properties"][props["Active"]["key"]] == {"type": "checkbox", "checkbox": True}
    assert alice["properties"][props["Joined"]["key"]]["date"]["start"] == "2024-01-15"

    bob = by_title["Bob"]
    # Empty cell -> absent key, never a bare scalar (spec §3.3).
    assert props["Age"]["key"] not in bob["properties"]
    assert bob["properties"][props["Active"]["key"]] == {"type": "checkbox", "checkbox": False}

    carol = by_title["Carol"]
    assert props["Joined"]["key"] not in carol["properties"]
    assert carol["properties"][props["Active"]["key"]] == {"type": "checkbox", "checkbox": True}

    # Select: each row's stored value references a real option id configured on the
    # property, and "High" (2 rows) maps to the SAME option id both times.
    priority_prop = props["Priority"]
    option_ids = {opt["name"]: opt["id"] for opt in priority_prop["config"]["options"]}
    assert set(option_ids) == {"High", "Low"}
    assert alice["properties"][priority_prop["key"]] == {"type": "select", "select": option_ids["High"]}
    assert carol["properties"][priority_prop["key"]] == {"type": "select", "select": option_ids["High"]}
    assert bob["properties"][priority_prop["key"]] == {"type": "select", "select": option_ids["Low"]}


# ===========================================================================
# Mixed-type column falls back to rich_text
# ===========================================================================


async def test_mixed_number_and_text_column_falls_back_to_rich_text(client):
    csv_text = "Title,Value\nRow A,42\nRow B,hello\n"
    res = await _import(client, csv_text, title="Mixed")
    assert res.status_code == 201, res.text
    by_header = {c["header"]: c for c in res.json()["columns"]}
    assert by_header["Value"]["inferred_type"] == "rich_text"


# ===========================================================================
# Title column detection: by header name, and by first-column fallback
# ===========================================================================


async def test_title_column_detected_by_header_name_even_when_not_first(client):
    csv_text = "Priority,Name,Status\nHigh,Task A,Open\nLow,Task B,Open\n"
    res = await _import(client, csv_text, title="Tasks")
    assert res.status_code == 201, res.text
    body = res.json()
    by_header = {c["header"]: c for c in body["columns"]}
    assert by_header["Name"]["inferred_type"] == "title"
    assert by_header["Priority"]["inferred_type"] != "title"
    assert by_header["Status"]["inferred_type"] != "title"


async def test_title_column_falls_back_to_first_column_when_no_header_matches(client):
    csv_text = "Widget,Count\nGadget,5\nGizmo,7\n"
    res = await _import(client, csv_text, title="Inventory")
    assert res.status_code == 201, res.text
    body = res.json()
    by_header = {c["header"]: c for c in body["columns"]}
    assert by_header["Widget"]["inferred_type"] == "title"
    assert by_header["Count"]["inferred_type"] == "number"


# ===========================================================================
# Select: correct option count, rows reference the right option id
# ===========================================================================


async def test_select_column_gets_one_option_per_distinct_value(client):
    csv_text = "Name,Tag\nA,red\nB,green\nC,red\nD,blue\n"
    res = await _import(client, csv_text, title="Tags")
    assert res.status_code == 201, res.text
    props = await _properties_by_name(client, res.json()["database_id"])
    tag_prop = props["Tag"]
    assert tag_prop["type"] == "select"
    assert {opt["name"] for opt in tag_prop["config"]["options"]} == {"red", "green", "blue"}
    assert len(tag_prop["config"]["options"]) == 3


# ===========================================================================
# Malformed / non-UTF-8 upload -> 400, never 500
# ===========================================================================


async def test_non_utf8_upload_returns_400(client):
    bad_bytes = b"Name,Value\n\xff\xfeBroken,1\n"
    res = await client.post(
        "/db/import/csv",
        data={"database_title": "Bad"},
        files={"file": ("bad.csv", bad_bytes, "text/csv")},
    )
    assert res.status_code == 400
    assert res.status_code != 500


async def test_csv_with_no_header_row_returns_400(client):
    res = await client.post(
        "/db/import/csv",
        data={"database_title": "Empty"},
        files={"file": ("empty.csv", b"", "text/csv")},
    )
    assert res.status_code == 400


# ===========================================================================
# trigger_automations=False is actually honored (mutation-tested, same
# pattern as the M12 review's Finding 2 -- task-42 ledger).
# ===========================================================================


async def test_import_calls_create_row_core_with_trigger_automations_false(client, monkeypatch):
    """The real mutation test on the endpoint's own code path (not a same-behaviour
    proxy): spy on `db_import.create_row_core` and assert every call the import
    handler makes passes `trigger_automations=False` explicitly. If a future edit
    dropped the kwarg (reverting to `create_row_core`'s own default of `True`) or
    flipped it, this fails -- `kwargs.get(...)` returns `None`/`True` instead of the
    required `False`."""
    import routers.db_import as db_import_module

    calls: list[bool | None] = []
    original = db_import_module.create_row_core

    async def spy(*args, **kwargs):
        calls.append(kwargs.get("trigger_automations"))
        return await original(*args, **kwargs)

    monkeypatch.setattr(db_import_module, "create_row_core", spy)

    csv_text = "Name,Value\nA,1\nB,2\nC,3\n"
    res = await _import(client, csv_text, title="Spy")
    assert res.status_code == 201, res.text
    assert calls == [False, False, False]


async def test_trigger_automations_false_mutation_check_via_direct_call(client, db_conn, test_user):
    """Direct mutation test on the exact mechanism the brief calls for (task-42's
    Finding 2 pattern): create a data source + page_added automation FIRST, then call
    the import endpoint against a CSV that becomes rows on THAT SAME data source is not
    reachable through the public endpoint (import always makes a new database) -- so
    this exercises `create_row_core(..., trigger_automations=False)` the same way
    `db_import.import_csv` does, directly, and asserts zero notifications; a second
    call with the default (`trigger_automations=True`) against the same automation
    proves the automation itself is real and would have fired otherwise."""
    from services.db.rows import create_row_core

    db_row = await db_conn.fetchrow(
        "INSERT INTO db_databases (user_id, title) VALUES ($1, 'D') RETURNING id", test_user
    )
    ds_row = await db_conn.fetchrow(
        "INSERT INTO db_data_sources (database_id, user_id, name) VALUES ($1, $2, 'DS') RETURNING id",
        db_row["id"], test_user,
    )
    data_source_id = str(ds_row["id"])
    await db_conn.execute(
        """
        INSERT INTO db_automations
            (data_source_id, user_id, name, is_active, trigger_combinator, triggers, actions, position)
        VALUES ($1, $2, 'Notify', true, 'any', $3, $4, 0)
        """,
        data_source_id, test_user, [{"type": "page_added"}],
        [{"type": "send_notification", "message": "fired"}],
    )

    await create_row_core(db_conn, test_user, data_source_id, properties={}, trigger_automations=False)
    count_after_false = await db_conn.fetchval(
        "SELECT count(*) FROM db_notifications WHERE user_id = $1", test_user
    )
    assert count_after_false == 0

    await create_row_core(db_conn, test_user, data_source_id, properties={}, trigger_automations=True)
    count_after_true = await db_conn.fetchval(
        "SELECT count(*) FROM db_notifications WHERE user_id = $1", test_user
    )
    assert count_after_true == 1
