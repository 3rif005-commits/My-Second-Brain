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

from unittest.mock import patch

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
# Fix round (task-50, M14 combined review) -- 4 concrete malformed inputs
# that previously 500ed instead of 400ing.
# ===========================================================================


async def test_nan_infinity_column_never_reaches_postgres_as_a_number(client):
    """Fix 2.1: pre-fix, `_parse_number("NaN")` returned Python's `float('nan')` (a
    "successful" parse), so a column mixing ordinary numbers with "NaN"/"Infinity"/
    "-inf" was still classified `number`, and the eventual JSONB write 500ed with
    `asyncpg.exceptions.InvalidTextRepresentationError` (Postgres rejects `NaN`/
    `Infinity`, the non-standard literals `json.dumps` emits for a Python float that
    isn't finite). Post-fix, `_parse_number` returns `None` for these tokens -- the
    SAME "not actually a number" signal it already uses for a genuinely non-numeric
    cell -- so the column no longer satisfies `infer_column`'s `all(...)` check and
    falls back to a type that never crashes (proving the crash-inducing
    misclassification is gone, not just papered over with a try/except)."""
    csv_text = "Name,Value\nA,42\nB,NaN\nC,Infinity\nD,-inf\n"
    res = await _import(client, csv_text, title="Nums")
    assert res.status_code != 500
    assert res.status_code == 201, res.text
    by_header = {c["header"]: c for c in res.json()["columns"]}
    assert by_header["Value"]["inferred_type"] != "number"


async def test_null_byte_in_csv_returns_400_not_500(client):
    """Fix 2.2: a NUL byte anywhere in the file reaches Postgres as a cell value and
    500s with `asyncpg.exceptions.CharacterNotInRepertoireError` pre-fix."""
    csv_text = "Name,Value\nA\x00B,1\n"
    res = await client.post(
        "/db/import/csv",
        data={"database_title": "Bad"},
        files=_csv_file(csv_text),
    )
    assert res.status_code == 400
    detail = res.json()["detail"]
    assert "null byte" in detail
    # Never leaks a raw Postgres/Python traceback.
    assert "Traceback" not in detail
    assert "asyncpg" not in detail


async def test_field_larger_than_csv_limit_returns_400_not_500(client):
    """Fix 2.3: a single field over csv's default 128 KiB limit raises
    `_csv.Error: field larger than field limit`, mid-loop while iterating
    `csv.DictReader` -- not up front, so both `fieldnames` access and
    `list(reader)` must be guarded."""
    huge_field = "A" * 200_000
    csv_text = f"Name,Value\n{huge_field},1\n"
    res = await client.post(
        "/db/import/csv",
        data={"database_title": "Huge"},
        files=_csv_file(csv_text),
    )
    assert res.status_code == 400
    detail = res.json()["detail"]
    assert "could not be parsed" in detail
    assert "Traceback" not in detail


async def test_generic_postgres_error_during_import_returns_400_not_500(client, monkeypatch):
    """Fix 2.4: any other `asyncpg.PostgresError` surfacing from inside the write loop
    (the NaN/Infinity case is one instance of this general class) must be converted to
    a clean 400 -- proven here independent of any specific Postgres error class, by
    forcing `create_row_core` itself to raise one."""
    import asyncpg

    import routers.db_import as db_import_module

    async def boom(*args, **kwargs):
        raise asyncpg.PostgresError("simulated postgres failure")

    monkeypatch.setattr(db_import_module, "create_row_core", boom)

    csv_text = "Name,Value\nA,1\n"
    res = await _import(client, csv_text, title="Boom")
    assert res.status_code == 400
    detail = res.json()["detail"]
    assert "CSV import failed" in detail
    assert "Traceback" not in detail


# ===========================================================================
# Fix 3: a duplicate CSV header must be rejected before any write, not
# silently discard the title column's data.
# ===========================================================================


async def test_duplicate_header_is_rejected_before_any_database_is_created(client, db_conn):
    csv_text = "Name,Name\nfoo,bar\nfoo2,bar2\n"
    res = await client.post(
        "/db/import/csv",
        data={"database_title": "DupHeaders"},
        files=_csv_file(csv_text),
    )
    assert res.status_code == 400
    detail = res.json()["detail"]
    assert "unique" in detail.lower()
    assert "Name" in detail

    count = await db_conn.fetchval(
        "SELECT count(*) FROM db_databases WHERE title = $1", "DupHeaders"
    )
    assert count == 0


# ===========================================================================
# Fix 7: an oversized upload is rejected before any parsing starts.
# ===========================================================================


async def test_oversized_csv_upload_returns_400(client):
    from routers.db_import import MAX_UPLOAD_BYTES

    huge_bytes = b"x" * (MAX_UPLOAD_BYTES + 1)
    res = await client.post(
        "/db/import/csv",
        data={"database_title": "Huge"},
        files={"file": ("huge.csv", huge_bytes, "text/csv")},
    )
    assert res.status_code == 400
    assert "too large" in res.json()["detail"]


# ===========================================================================
# Fix 4.6 (task-50, M14 combined review) -- the per-row import loop must
# call try_index_note() for each imported row AFTER the transaction commits,
# not inside it.
# ===========================================================================


async def test_import_indexes_every_created_row_after_commit(client):
    """Proven via call recording rather than a real `get_supabase()` mock
    (this file's other tests don't stub the embedder/indexer at all) --
    `try_index_note` is `db_import.py`'s own imported name, patched at that
    call site directly. Confirms every row `create_row_core` actually
    created gets indexed exactly once -- the entire fix's point (previously
    NOTHING called `index_note` from this loop at all)."""
    import routers.db_import as db_import_module

    called_with: list[str] = []

    def fake_try_index_note(note_id, user_id):
        called_with.append(note_id)
        return True

    csv_text = "Name,Value\nA,1\nB,2\nC,3\n"
    with patch.object(db_import_module, "try_index_note", side_effect=fake_try_index_note):
        res = await _import(client, csv_text, title="IndexMe")
    assert res.status_code == 201, res.text

    props = await _properties_by_name(client, res.json()["database_id"])
    rows = await _get_rows(client, props["Name"]["data_source_id"])
    assert sorted(called_with) == sorted(r["id"] for r in rows)
    assert len(called_with) == 3


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
