"""Tests for `services/db/templates.py` + `routers/databases.py`'s template
endpoints (Milestone 12, task-37): row template CRUD, `is_default`
uniqueness, `instantiate_template`, `create_row`'s new default-template
auto-apply, and `next_occurrence`'s pure date arithmetic. Scheduler-tick
tests (`_tick_templates`) land in this same file in the next commit, once
`services/db/scheduler.py` exists.

Runs against the local pgtest harness (localhost:55432) through the
transaction-wrapped `db_conn`/`test_user` fixtures (`tests/conftest.py`),
rolled back on teardown — same convention as every other Milestone 2+ test
file in this suite. NEVER touches `core.config.settings.database_url` (the
real Supabase project). No `datetime.now()` anywhere in the `next_occurrence`
table — every reference instant is a fixed, hand-written `datetime(...)`,
per task-37-brief.md's explicit instruction.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import httpx
import pytest
import pytest_asyncio

from main import app
from routers.notes import get_user_id
from services.db.connection import get_conn
from services.db.templates import (
    DuplicateDefaultTemplateError,
    create_template,
    get_template,
    instantiate_template,
    next_occurrence,
)
from models.database import RowTemplateCreate, RowTemplateUpdate


# ===========================================================================
# Helpers
# ===========================================================================


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


async def _make_data_source(db_conn, user_id, *, name="DS"):
    db_row = await db_conn.fetchrow(
        "INSERT INTO db_databases (user_id, title) VALUES ($1, 'T') RETURNING id", user_id
    )
    ds_row = await db_conn.fetchrow(
        "INSERT INTO db_data_sources (database_id, user_id, name) VALUES ($1, $2, $3) RETURNING id",
        db_row["id"], user_id, name,
    )
    return str(ds_row["id"])


async def _insert_property(
    db_conn, user_id, data_source_id, key, name, type_,
    *, config=None, result_type=None, is_volatile=False,
):
    await db_conn.execute(
        """
        INSERT INTO db_properties (data_source_id, user_id, key, name, type, config, result_type, is_volatile)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
        data_source_id, user_id, key, name, type_, config or {}, result_type, is_volatile,
    )


def _formula_config(expression: str) -> dict:
    return {"expression": expression}


async def _insert_template(db_conn, user_id, data_source_id, **overrides) -> str:
    fields = {
        "name": "T",
        "icon": None,
        "properties": {},
        "content": [],
        "is_default": False,
        "repeat_config": None,
        "next_run_at": None,
        "position": 0,
    }
    fields.update(overrides)
    row = await db_conn.fetchrow(
        """
        INSERT INTO db_row_templates
            (data_source_id, user_id, name, icon, properties, content, is_default,
             repeat_config, next_run_at, position)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
        """,
        data_source_id, user_id, fields["name"], fields["icon"], fields["properties"],
        fields["content"], fields["is_default"], fields["repeat_config"],
        fields["next_run_at"], fields["position"],
    )
    return str(row["id"])


async def _other_user(db_conn) -> str:
    other_user = str(uuid.uuid4())
    await db_conn.execute(
        "INSERT INTO auth.users (id, email) VALUES ($1, $2)", other_user, f"{other_user}@t.local"
    )
    return other_user


# ===========================================================================
# CRUD + tenancy
# ===========================================================================


async def test_create_list_patch_delete_template_round_trips(client, db_conn, test_user):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]

    res = await client.post(
        f"/db/data-sources/{ds_id}/templates",
        json={"name": "Bug report", "properties": {}, "content": [{"type": "paragraph"}]},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "Bug report"
    assert body["content"] == [{"type": "paragraph"}]
    assert body["is_default"] is False
    assert body["data_source_id"] == ds_id
    template_id = body["id"]

    list_res = await client.get(f"/db/data-sources/{ds_id}/templates")
    assert list_res.status_code == 200
    assert [t["id"] for t in list_res.json()] == [template_id]

    fetched = await get_template(db_conn, test_user, template_id)
    assert fetched is not None
    assert fetched.name == "Bug report"

    patch_res = await client.patch(f"/db/templates/{template_id}", json={"name": "Renamed"})
    assert patch_res.status_code == 200
    assert patch_res.json()["name"] == "Renamed"
    # Partial: content untouched by a name-only patch.
    assert patch_res.json()["content"] == [{"type": "paragraph"}]

    del_res = await client.delete(f"/db/templates/{template_id}")
    assert del_res.status_code == 204
    assert await get_template(db_conn, test_user, template_id) is None


async def test_create_template_404s_for_another_users_data_source(client, db_conn):
    other_user = await _other_user(db_conn)
    ds_id = await _make_data_source(db_conn, other_user)
    res = await client.post(f"/db/data-sources/{ds_id}/templates", json={"name": "T"})
    assert res.status_code == 404


async def test_list_templates_excludes_another_users_templates(client, db_conn, test_user):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]
    other_user = await _other_user(db_conn)
    await _insert_template(db_conn, other_user, ds_id, name="Not mine")

    res = await client.get(f"/db/data-sources/{ds_id}/templates")
    assert res.status_code == 200
    assert res.json() == []


async def test_patch_delete_404_for_another_users_template(client, db_conn):
    other_user = await _other_user(db_conn)
    ds_id = await _make_data_source(db_conn, other_user)
    template_id = await _insert_template(db_conn, other_user, ds_id)

    patch_res = await client.patch(f"/db/templates/{template_id}", json={"name": "x"})
    assert patch_res.status_code == 404
    del_res = await client.delete(f"/db/templates/{template_id}")
    assert del_res.status_code == 404


async def test_patch_delete_404_for_unknown_template(client):
    unknown = str(uuid.uuid4())
    assert (await client.patch(f"/db/templates/{unknown}", json={"name": "x"})).status_code == 404
    assert (await client.delete(f"/db/templates/{unknown}")).status_code == 404


# ===========================================================================
# is_default uniqueness
# ===========================================================================


async def test_second_default_template_on_same_data_source_is_a_clean_400(client, db_conn):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]

    first = await client.post(
        f"/db/data-sources/{ds_id}/templates", json={"name": "A", "is_default": True}
    )
    assert first.status_code == 201, first.text

    second = await client.post(
        f"/db/data-sources/{ds_id}/templates", json={"name": "B", "is_default": True}
    )
    assert second.status_code == 400
    assert "default" in second.text.lower()


async def test_second_non_default_template_on_same_data_source_succeeds(client):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]

    first = await client.post(f"/db/data-sources/{ds_id}/templates", json={"name": "A"})
    assert first.status_code == 201
    second = await client.post(f"/db/data-sources/{ds_id}/templates", json={"name": "B"})
    assert second.status_code == 201


async def test_patch_to_is_default_true_conflicting_with_existing_default_is_400(client):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]

    default_res = await client.post(
        f"/db/data-sources/{ds_id}/templates", json={"name": "A", "is_default": True}
    )
    assert default_res.status_code == 201
    other_res = await client.post(f"/db/data-sources/{ds_id}/templates", json={"name": "B"})
    assert other_res.status_code == 201
    other_id = other_res.json()["id"]

    patch_res = await client.patch(f"/db/templates/{other_id}", json={"is_default": True})
    assert patch_res.status_code == 400


async def test_service_layer_raises_duplicate_default_template_error(db_conn, test_user):
    ds_id = await _make_data_source(db_conn, test_user)
    await create_template(db_conn, test_user, ds_id, RowTemplateCreate(name="A", is_default=True))
    with pytest.raises(DuplicateDefaultTemplateError):
        await create_template(db_conn, test_user, ds_id, RowTemplateCreate(name="B", is_default=True))


# ===========================================================================
# instantiate_template
# ===========================================================================


async def test_instantiate_template_merges_properties_and_copies_content_verbatim(
    db_conn, test_user
):
    ds_id = await _make_data_source(db_conn, test_user)
    await _insert_property(db_conn, test_user, ds_id, "statusKey", "Status", "status")
    body = RowTemplateCreate(
        name="Bug",
        properties={"statusKey": {"type": "status", "status": "todo"}},
        content=[{"type": "paragraph", "content": "template body"}],
    )
    template = await create_template(db_conn, test_user, ds_id, body)

    result = await instantiate_template(db_conn, test_user, template.id)
    assert result is not None
    assert result.properties == {"statusKey": {"type": "status", "status": "todo"}}

    note = await db_conn.fetchrow("SELECT content, title FROM notes WHERE id = $1", result.id)
    assert note["content"] == [{"type": "paragraph", "content": "template body"}]
    assert note["title"] == "Untitled"  # decision 4: title NOT set from the template's name


async def test_instantiate_template_drops_a_since_deleted_property_key(db_conn, test_user):
    ds_id = await _make_data_source(db_conn, test_user)
    await _insert_property(db_conn, test_user, ds_id, "goneKey", "Gone", "status")
    body = RowTemplateCreate(
        name="T", properties={"goneKey": {"type": "status", "status": "todo"}}
    )
    template = await create_template(db_conn, test_user, ds_id, body)
    # The property is deleted after the template captured it.
    await db_conn.execute("DELETE FROM db_properties WHERE data_source_id = $1", ds_id)

    result = await instantiate_template(db_conn, test_user, template.id)
    assert result is not None
    assert result.properties == {}  # dropped silently, not an error


async def test_instantiate_template_title_property_syncs_notes_title(db_conn, test_user):
    ds_id = await _make_data_source(db_conn, test_user)
    await _insert_property(db_conn, test_user, ds_id, "titleKey", "Name", "title")
    body = RowTemplateCreate(
        name="T", properties={"titleKey": {"type": "title", "title": "Captured Title"}}
    )
    template = await create_template(db_conn, test_user, ds_id, body)

    result = await instantiate_template(db_conn, test_user, template.id)
    note = await db_conn.fetchrow("SELECT title FROM notes WHERE id = $1", result.id)
    assert note["title"] == "Captured Title"


async def test_instantiate_template_runs_recompute_and_materialises_a_formula(db_conn, test_user):
    ds_id = await _make_data_source(db_conn, test_user)
    await _insert_property(db_conn, test_user, ds_id, "numKey", "Price", "number")
    await _insert_property(
        db_conn, test_user, ds_id, "fKey", "Doubled", "formula",
        config=_formula_config('prop("Price") * 2'), result_type="number",
    )
    body = RowTemplateCreate(
        name="T", properties={"numKey": {"type": "number", "number": 21.0}}
    )
    template = await create_template(db_conn, test_user, ds_id, body)

    result = await instantiate_template(db_conn, test_user, template.id)
    computed = await db_conn.fetchval(
        "SELECT computed FROM db_row_props WHERE note_id = $1", result.id
    )
    assert computed["fKey"] == {"type": "number", "number": 42.0}


async def test_instantiate_template_returns_none_for_unknown_or_foreign_template(db_conn, test_user):
    assert await instantiate_template(db_conn, test_user, str(uuid.uuid4())) is None
    other_user = await _other_user(db_conn)
    ds_id = await _make_data_source(db_conn, other_user)
    template_id = await _insert_template(db_conn, other_user, ds_id)
    assert await instantiate_template(db_conn, test_user, template_id) is None


async def test_instantiate_template_router_404s_for_unknown_template(client):
    res = await client.post(f"/db/templates/{uuid.uuid4()}/instantiate")
    assert res.status_code == 404


# ===========================================================================
# create_row: default-template auto-apply (task-37-brief.md decision 3)
# ===========================================================================


async def test_create_row_with_no_default_template_is_unchanged_blank_row(client):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]

    res = await client.post(f"/db/data-sources/{ds_id}/rows")
    assert res.status_code == 201, res.text
    assert res.json()["properties"] == {}


async def test_create_row_with_a_default_template_carries_its_properties_and_content(
    client, db_conn
):
    created = await _create_database(client)
    ds_id = created["data_source"]["id"]
    prop_key = created["properties"][0]["key"]  # the default "Title" property

    tmpl_res = await client.post(
        f"/db/data-sources/{ds_id}/templates",
        json={
            "name": "Default",
            "is_default": True,
            "properties": {prop_key: {"type": "title", "title": "From template"}},
            "content": [{"type": "paragraph", "content": "seeded"}],
        },
    )
    assert tmpl_res.status_code == 201, tmpl_res.text

    res = await client.post(f"/db/data-sources/{ds_id}/rows")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["properties"] == {prop_key: {"type": "title", "title": "From template"}}

    note = await db_conn.fetchrow("SELECT content, title FROM notes WHERE id = $1", body["id"])
    assert note["content"] == [{"type": "paragraph", "content": "seeded"}]
    assert note["title"] == "From template"


# ===========================================================================
# next_occurrence: pure date arithmetic, fixed reference datetimes only
# ===========================================================================


_UTC = timezone.utc


@pytest.mark.parametrize(
    "repeat_config,after,expected",
    [
        # Daily, interval 1: the very next day at the anchor's time.
        (
            {"frequency": "daily", "interval": 1, "start_date": "2026-01-01", "time_of_day": "09:00"},
            datetime(2026, 1, 5, 9, 0, tzinfo=_UTC),
            datetime(2026, 1, 6, 9, 0, tzinfo=_UTC),
        ),
        # Daily, interval 3: "every 3 days" (research §J.5.3's "Custom" example).
        (
            {"frequency": "daily", "interval": 3, "start_date": "2026-01-01", "time_of_day": "09:00"},
            datetime(2026, 1, 1, 9, 0, tzinfo=_UTC),
            datetime(2026, 1, 4, 9, 0, tzinfo=_UTC),
        ),
        # Weekly, Tue+Thu, roll-forward across a week boundary: after the
        # week's last occurrence (Thursday), the next one is next Tuesday.
        (
            {
                "frequency": "weekly", "interval": 1, "weekdays": [2, 4],
                "start_date": "2026-01-06", "time_of_day": "09:00",  # 2026-01-06 is a Tuesday
            },
            datetime(2026, 1, 8, 9, 0, tzinfo=_UTC),  # that week's Thursday occurrence
            datetime(2026, 1, 13, 9, 0, tzinfo=_UTC),  # following Tuesday
        ),
        # Weekly, interval 2: every OTHER week, skips the interleaving week.
        (
            {
                "frequency": "weekly", "interval": 2, "weekdays": [1],
                "start_date": "2026-01-05", "time_of_day": "09:00",  # Monday
            },
            datetime(2026, 1, 5, 9, 0, tzinfo=_UTC),
            datetime(2026, 1, 19, 9, 0, tzinfo=_UTC),  # 2 weeks later, not 1
        ),
        # Monthly, month-length edge: Jan 31 -> Feb 28 (2026 is not a leap year).
        (
            {"frequency": "monthly", "interval": 1, "start_date": "2026-01-31", "time_of_day": "09:00"},
            datetime(2026, 1, 31, 9, 0, tzinfo=_UTC),
            datetime(2026, 2, 28, 9, 0, tzinfo=_UTC),
        ),
        # Monthly, resumes the 31st once a long-enough month reappears.
        (
            {"frequency": "monthly", "interval": 1, "start_date": "2026-01-31", "time_of_day": "09:00"},
            datetime(2026, 2, 28, 9, 0, tzinfo=_UTC),
            datetime(2026, 3, 31, 9, 0, tzinfo=_UTC),
        ),
        # Monthly, interval 2: "every 2 months" (research §J.5.3's example).
        (
            {"frequency": "monthly", "interval": 2, "start_date": "2026-01-15", "time_of_day": "09:00"},
            datetime(2026, 1, 15, 9, 0, tzinfo=_UTC),
            datetime(2026, 3, 15, 9, 0, tzinfo=_UTC),
        ),
        # Yearly, leap-day anchor rolling into a non-leap year.
        (
            {"frequency": "yearly", "interval": 1, "start_date": "2024-02-29", "time_of_day": "00:00"},
            datetime(2024, 2, 29, 0, 0, tzinfo=_UTC),
            datetime(2025, 2, 28, 0, 0, tzinfo=_UTC),
        ),
        # Seeding: `after` well before the anchor -> the anchor itself.
        (
            {"frequency": "daily", "interval": 1, "start_date": "2026-06-01", "time_of_day": "09:00"},
            datetime(2026, 1, 1, 0, 0, tzinfo=_UTC),
            datetime(2026, 6, 1, 9, 0, tzinfo=_UTC),
        ),
    ],
)
def test_next_occurrence_table(repeat_config, after, expected):
    assert next_occurrence(repeat_config, after) == expected
