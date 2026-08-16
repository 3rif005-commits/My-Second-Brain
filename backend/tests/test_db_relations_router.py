"""Tests for Milestone 7's HTTP seam (task-21): relation, sub-item and
dependency endpoints in `routers/databases.py`, plus the two seams task-21
wires into pre-existing endpoints -- `PropertyLookup.relation` feeding
`POST .../query`'s filter/sort compiler, and `update_row_property`'s
relation-write rejection + dependency date-shift cascade.

Runs against the local pgtest harness (localhost:55432, migrations 001-019
applied) through the same transaction-wrapped `db_conn`/`test_user`
fixtures and `client`-fixture-building convention
`tests/test_databases_router.py`/`tests/test_databases_query_endpoint.py`
already established -- reused verbatim, not duplicated with a different
shape. NEVER touches `core.config.settings.database_url` (the real
Supabase project) -- no code path here can reach it.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

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


async def _create_row(client: httpx.AsyncClient, db_conn, ds_id: str, *, title: str = "Row") -> str:
    res = await client.post(f"/db/data-sources/{ds_id}/rows")
    assert res.status_code == 201, res.text
    row_id = res.json()["id"]
    await db_conn.execute("UPDATE notes SET title = $1 WHERE id = $2", title, row_id)
    return row_id


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _dt(y: int, m: int, d: int) -> datetime:
    return datetime(y, m, d, tzinfo=UTC)


# ---------------------------------------------------------------------------
# POST /db/data-sources/{data_source_id}/relations
# ---------------------------------------------------------------------------


async def test_create_relation_two_way_creates_both_properties(client):
    tasks = await _create_database(client, "Tasks")
    projects = await _create_database(client, "Projects")

    res = await client.post(
        f"/db/data-sources/{tasks['data_source']['id']}/relations",
        json={
            "name": "Project",
            "target_data_source_id": projects["data_source"]["id"],
            "two_way": True,
            "reverse_name": "Tasks",
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["forward"]["name"] == "Project"
    assert body["forward"]["type"] == "relation"
    assert body["reverse"]["name"] == "Tasks"
    assert body["forward"]["config"]["relation_id"] == body["reverse"]["config"]["relation_id"]
    assert body["forward"]["config"]["side"] == "forward"
    assert body["reverse"]["config"]["side"] == "reverse"


async def test_create_relation_one_way_has_no_reverse(client):
    tasks = await _create_database(client, "Tasks")
    projects = await _create_database(client, "Projects")

    res = await client.post(
        f"/db/data-sources/{tasks['data_source']['id']}/relations",
        json={
            "name": "Related",
            "target_data_source_id": projects["data_source"]["id"],
            "two_way": False,
        },
    )
    assert res.status_code == 201, res.text
    assert res.json()["reverse"] is None


async def test_create_relation_two_way_without_reverse_name_is_400_not_500(client):
    tasks = await _create_database(client, "Tasks")
    projects = await _create_database(client, "Projects")

    res = await client.post(
        f"/db/data-sources/{tasks['data_source']['id']}/relations",
        json={
            "name": "Project",
            "target_data_source_id": projects["data_source"]["id"],
            "two_way": True,
        },
    )
    assert res.status_code == 400, res.text


async def test_create_relation_unknown_target_data_source_404(client):
    tasks = await _create_database(client, "Tasks")
    res = await client.post(
        f"/db/data-sources/{tasks['data_source']['id']}/relations",
        json={
            "name": "Project",
            "target_data_source_id": "00000000-0000-0000-0000-000000000000",
            "two_way": False,
        },
    )
    assert res.status_code == 404


async def test_create_relation_all_notes_as_source_400(client):
    projects = await _create_database(client, "Projects")
    res = await client.post(
        f"/db/data-sources/{ALL_NOTES_ID}/relations",
        json={"name": "X", "target_data_source_id": projects["data_source"]["id"], "two_way": False},
    )
    assert res.status_code == 400


async def test_create_relation_all_notes_as_target_400(client):
    tasks = await _create_database(client, "Tasks")
    res = await client.post(
        f"/db/data-sources/{tasks['data_source']['id']}/relations",
        json={"name": "X", "target_data_source_id": ALL_NOTES_ID, "two_way": False},
    )
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# DELETE /db/relations/{relation_id}
# ---------------------------------------------------------------------------


async def test_delete_relation_removes_pair_and_sweeps_links(client, db_conn):
    tasks = await _create_database(client, "Tasks")
    projects = await _create_database(client, "Projects")
    tasks_ds, projects_ds = tasks["data_source"]["id"], projects["data_source"]["id"]

    pair = await client.post(
        f"/db/data-sources/{tasks_ds}/relations",
        json={"name": "Project", "target_data_source_id": projects_ds, "two_way": True, "reverse_name": "Tasks"},
    )
    relation_id = pair.json()["forward"]["config"]["relation_id"]
    property_key = pair.json()["forward"]["key"]

    task_row = await _create_row(client, db_conn, tasks_ds, title="Task 1")
    project_row = await _create_row(client, db_conn, projects_ds, title="Project 1")
    link_res = await client.post(
        f"/db/data-sources/{tasks_ds}/rows/{task_row}/relations/{property_key}/links",
        json={"row_id": project_row},
    )
    assert link_res.status_code == 201, link_res.text

    del_res = await client.delete(f"/db/relations/{relation_id}")
    assert del_res.status_code == 204

    remaining_props = await db_conn.fetchval(
        "SELECT count(*) FROM db_properties WHERE config->>'relation_id' = $1", relation_id
    )
    remaining_links = await db_conn.fetchval(
        "SELECT count(*) FROM db_relation_links WHERE relation_id = $1::uuid", relation_id
    )
    assert remaining_props == 0
    assert remaining_links == 0

    # Re-GET-ing the (now-deleted) property's links 404s -- the property is gone.
    get_res = await client.get(f"/db/data-sources/{tasks_ds}/rows/{task_row}/relations/{property_key}")
    assert get_res.status_code == 404


async def test_delete_relation_unknown_id_404(client):
    res = await client.delete("/db/relations/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# The headline M7 case: a link created via the forward endpoint is visible
# from the reverse property, and deleting it from the reverse side removes
# it for both -- through the HTTP layer.
# ---------------------------------------------------------------------------


async def test_link_visible_from_reverse_and_deleting_from_reverse_removes_both(client, db_conn):
    tasks = await _create_database(client, "Tasks")
    projects = await _create_database(client, "Projects")
    tasks_ds, projects_ds = tasks["data_source"]["id"], projects["data_source"]["id"]

    pair = await client.post(
        f"/db/data-sources/{tasks_ds}/relations",
        json={"name": "Project", "target_data_source_id": projects_ds, "two_way": True, "reverse_name": "Tasks"},
    )
    forward_key = pair.json()["forward"]["key"]
    reverse_key = pair.json()["reverse"]["key"]

    task_row = await _create_row(client, db_conn, tasks_ds, title="Ship it")
    project_row = await _create_row(client, db_conn, projects_ds, title="Q3 Launch")

    add_res = await client.post(
        f"/db/data-sources/{tasks_ds}/rows/{task_row}/relations/{forward_key}/links",
        json={"row_id": project_row},
    )
    assert add_res.status_code == 201, add_res.text
    assert add_res.json()["rows"] == [{"id": project_row, "title": "Q3 Launch"}]

    # Visible from the reverse property, on the other row.
    reverse_get = await client.get(
        f"/db/data-sources/{projects_ds}/rows/{project_row}/relations/{reverse_key}"
    )
    assert reverse_get.status_code == 200
    assert reverse_get.json()["rows"] == [{"id": task_row, "title": "Ship it"}]

    # Delete from the reverse side.
    del_res = await client.delete(
        f"/db/data-sources/{projects_ds}/rows/{project_row}/relations/{reverse_key}/links/{task_row}"
    )
    assert del_res.status_code == 200
    assert del_res.json()["rows"] == []

    # Gone from the forward side too.
    forward_get = await client.get(
        f"/db/data-sources/{tasks_ds}/rows/{task_row}/relations/{forward_key}"
    )
    assert forward_get.json()["rows"] == []


async def test_get_relation_links_excludes_trashed_rows(client, db_conn):
    tasks = await _create_database(client, "Tasks")
    projects = await _create_database(client, "Projects")
    tasks_ds, projects_ds = tasks["data_source"]["id"], projects["data_source"]["id"]
    pair = await client.post(
        f"/db/data-sources/{tasks_ds}/relations",
        json={"name": "Project", "target_data_source_id": projects_ds, "two_way": False},
    )
    key = pair.json()["forward"]["key"]
    task_row = await _create_row(client, db_conn, tasks_ds)
    project_row = await _create_row(client, db_conn, projects_ds, title="Trashed")
    await client.post(
        f"/db/data-sources/{tasks_ds}/rows/{task_row}/relations/{key}/links",
        json={"row_id": project_row},
    )
    await db_conn.execute("UPDATE notes SET deleted_at = now() WHERE id = $1", project_row)

    res = await client.get(f"/db/data-sources/{tasks_ds}/rows/{task_row}/relations/{key}")
    assert res.status_code == 200
    assert res.json()["rows"] == []


async def test_set_relation_links_replaces_whole_list(client, db_conn):
    tasks = await _create_database(client, "Tasks")
    projects = await _create_database(client, "Projects")
    tasks_ds, projects_ds = tasks["data_source"]["id"], projects["data_source"]["id"]
    pair = await client.post(
        f"/db/data-sources/{tasks_ds}/relations",
        json={"name": "Project", "target_data_source_id": projects_ds, "two_way": False},
    )
    key = pair.json()["forward"]["key"]
    task_row = await _create_row(client, db_conn, tasks_ds)
    p1 = await _create_row(client, db_conn, projects_ds, title="P1")
    p2 = await _create_row(client, db_conn, projects_ds, title="P2")
    p3 = await _create_row(client, db_conn, projects_ds, title="P3")

    res1 = await client.put(
        f"/db/data-sources/{tasks_ds}/rows/{task_row}/relations/{key}", json={"row_ids": [p1, p2]}
    )
    assert res1.status_code == 200
    assert {r["id"] for r in res1.json()["rows"]} == {p1, p2}

    res2 = await client.put(
        f"/db/data-sources/{tasks_ds}/rows/{task_row}/relations/{key}", json={"row_ids": [p2, p3]}
    )
    assert res2.status_code == 200
    assert {r["id"] for r in res2.json()["rows"]} == {p2, p3}


async def test_set_relation_links_unknown_row_id_404(client, db_conn):
    tasks = await _create_database(client, "Tasks")
    projects = await _create_database(client, "Projects")
    tasks_ds, projects_ds = tasks["data_source"]["id"], projects["data_source"]["id"]
    pair = await client.post(
        f"/db/data-sources/{tasks_ds}/relations",
        json={"name": "Project", "target_data_source_id": projects_ds, "two_way": False},
    )
    key = pair.json()["forward"]["key"]
    task_row = await _create_row(client, db_conn, tasks_ds)

    res = await client.put(
        f"/db/data-sources/{tasks_ds}/rows/{task_row}/relations/{key}",
        json={"row_ids": ["00000000-0000-0000-0000-000000000000"]},
    )
    assert res.status_code == 404


async def test_add_relation_link_unknown_row_404(client, db_conn):
    tasks = await _create_database(client, "Tasks")
    projects = await _create_database(client, "Projects")
    tasks_ds, projects_ds = tasks["data_source"]["id"], projects["data_source"]["id"]
    pair = await client.post(
        f"/db/data-sources/{tasks_ds}/relations",
        json={"name": "Project", "target_data_source_id": projects_ds, "two_way": False},
    )
    key = pair.json()["forward"]["key"]
    task_row = await _create_row(client, db_conn, tasks_ds)
    res = await client.post(
        f"/db/data-sources/{tasks_ds}/rows/{task_row}/relations/{key}/links",
        json={"row_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert res.status_code == 404


async def test_remove_relation_link_idempotent(client, db_conn):
    tasks = await _create_database(client, "Tasks")
    projects = await _create_database(client, "Projects")
    tasks_ds, projects_ds = tasks["data_source"]["id"], projects["data_source"]["id"]
    pair = await client.post(
        f"/db/data-sources/{tasks_ds}/relations",
        json={"name": "Project", "target_data_source_id": projects_ds, "two_way": False},
    )
    key = pair.json()["forward"]["key"]
    task_row = await _create_row(client, db_conn, tasks_ds)
    project_row = await _create_row(client, db_conn, projects_ds)

    # Removing a link that was never created is still a clean 200/empty list.
    res = await client.delete(
        f"/db/data-sources/{tasks_ds}/rows/{task_row}/relations/{key}/links/{project_row}"
    )
    assert res.status_code == 200
    assert res.json()["rows"] == []


# ---------------------------------------------------------------------------
# All Notes rejected on every relation endpoint.
# ---------------------------------------------------------------------------


async def test_all_notes_rejected_on_every_relation_endpoint(client):
    real = await _create_database(client, "Real")
    real_ds = real["data_source"]["id"]
    fake_row = "00000000-0000-0000-0000-000000000000"
    fake_key = "abcdefgh"

    assert (await client.post(
        f"/db/data-sources/{ALL_NOTES_ID}/relations",
        json={"name": "X", "target_data_source_id": real_ds, "two_way": False},
    )).status_code == 400
    assert (await client.get(
        f"/db/data-sources/{ALL_NOTES_ID}/rows/{fake_row}/relations/{fake_key}"
    )).status_code == 400
    assert (await client.put(
        f"/db/data-sources/{ALL_NOTES_ID}/rows/{fake_row}/relations/{fake_key}", json={"row_ids": []}
    )).status_code == 400
    assert (await client.post(
        f"/db/data-sources/{ALL_NOTES_ID}/rows/{fake_row}/relations/{fake_key}/links",
        json={"row_id": fake_row},
    )).status_code == 400
    assert (await client.delete(
        f"/db/data-sources/{ALL_NOTES_ID}/rows/{fake_row}/relations/{fake_key}/links/{fake_row}"
    )).status_code == 400
    assert (await client.post(f"/db/data-sources/{ALL_NOTES_ID}/sub-items")).status_code == 400
    assert (await client.post(f"/db/data-sources/{ALL_NOTES_ID}/dependencies")).status_code == 400


# ---------------------------------------------------------------------------
# Sub-items / dependencies
# ---------------------------------------------------------------------------


async def test_enable_sub_items_creates_self_relation_with_documented_names(client, db_conn):
    db = await _create_database(client, "Tasks")
    ds_id = db["data_source"]["id"]
    res = await client.post(f"/db/data-sources/{ds_id}/sub-items")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["forward"]["name"] == "Sub-item"
    assert body["reverse"]["name"] == "Parent item"
    assert body["forward"]["config"]["system"] == "sub_item"
    assert body["forward"]["config"]["target_data_source_id"] == ds_id


async def test_enable_sub_items_twice_400_not_500_not_duplicate(client, db_conn):
    db = await _create_database(client, "Tasks")
    ds_id = db["data_source"]["id"]
    res1 = await client.post(f"/db/data-sources/{ds_id}/sub-items")
    assert res1.status_code == 201

    res2 = await client.post(f"/db/data-sources/{ds_id}/sub-items")
    assert res2.status_code == 400

    count = await db_conn.fetchval(
        "SELECT count(*) FROM db_properties WHERE data_source_id = $1 AND config->>'system' = 'sub_item'",
        ds_id,
    )
    assert count == 2  # exactly one pair (forward + reverse), not two


async def test_enable_dependencies_creates_self_relation(client):
    db = await _create_database(client, "Tasks")
    ds_id = db["data_source"]["id"]
    res = await client.post(f"/db/data-sources/{ds_id}/dependencies")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["forward"]["name"] == "Blocking"
    assert body["reverse"]["name"] == "Blocked by"
    assert body["forward"]["config"]["system"] == "dependency"


async def test_enable_dependencies_twice_400_not_500(client):
    db = await _create_database(client, "Tasks")
    ds_id = db["data_source"]["id"]
    assert (await client.post(f"/db/data-sources/{ds_id}/dependencies")).status_code == 201
    assert (await client.post(f"/db/data-sources/{ds_id}/dependencies")).status_code == 400


async def test_sub_items_and_dependencies_coexist_on_same_data_source(client):
    db = await _create_database(client, "Tasks")
    ds_id = db["data_source"]["id"]
    assert (await client.post(f"/db/data-sources/{ds_id}/sub-items")).status_code == 201
    assert (await client.post(f"/db/data-sources/{ds_id}/dependencies")).status_code == 201


# ---------------------------------------------------------------------------
# Cycle / depth errors surface as 400 with the path/depth in the body.
# ---------------------------------------------------------------------------


async def test_dependency_cycle_400_with_path_in_body(client, db_conn):
    db = await _create_database(client, "Tasks")
    ds_id = db["data_source"]["id"]
    pair = (await client.post(f"/db/data-sources/{ds_id}/dependencies")).json()
    forward_key = pair["forward"]["key"]

    a = await _create_row(client, db_conn, ds_id, title="A")
    b = await _create_row(client, db_conn, ds_id, title="B")
    ok = await client.post(
        f"/db/data-sources/{ds_id}/rows/{a}/relations/{forward_key}/links", json={"row_id": b}
    )
    assert ok.status_code == 201, ok.text

    cyc = await client.post(
        f"/db/data-sources/{ds_id}/rows/{b}/relations/{forward_key}/links", json={"row_id": a}
    )
    assert cyc.status_code == 400
    assert a in cyc.text and b in cyc.text
    assert "->" in cyc.text


async def test_sub_item_depth_error_400_with_depth_and_cap_in_body(client, db_conn):
    db = await _create_database(client, "Tasks")
    ds_id = db["data_source"]["id"]
    pair = (await client.post(f"/db/data-sources/{ds_id}/sub-items")).json()
    forward_key = pair["forward"]["key"]

    nodes = [await _create_row(client, db_conn, ds_id, title=f"n{i}") for i in range(11)]
    for i in range(9):
        res = await client.post(
            f"/db/data-sources/{ds_id}/rows/{nodes[i]}/relations/{forward_key}/links",
            json={"row_id": nodes[i + 1]},
        )
        assert res.status_code == 201, res.text

    too_deep = await client.post(
        f"/db/data-sources/{ds_id}/rows/{nodes[9]}/relations/{forward_key}/links",
        json={"row_id": nodes[10]},
    )
    assert too_deep.status_code == 400
    assert "10" in too_deep.text  # both the depth and the cap are 10 here


# ---------------------------------------------------------------------------
# PATCH row property refuses relation keys.
# ---------------------------------------------------------------------------


async def test_patch_row_property_on_relation_key_is_400(client, db_conn):
    tasks = await _create_database(client, "Tasks")
    projects = await _create_database(client, "Projects")
    tasks_ds, projects_ds = tasks["data_source"]["id"], projects["data_source"]["id"]
    pair = await client.post(
        f"/db/data-sources/{tasks_ds}/relations",
        json={"name": "Project", "target_data_source_id": projects_ds, "two_way": False},
    )
    key = pair.json()["forward"]["key"]
    task_row = await _create_row(client, db_conn, tasks_ds)

    res = await client.patch(
        f"/db/data-sources/{tasks_ds}/rows/{task_row}",
        json={"property_key": key, "value": {"type": "relation", "relation": []}},
    )
    assert res.status_code == 400
    # The relation's own db_row_props.properties key must never get written.
    stored = await db_conn.fetchval(
        "SELECT properties FROM db_row_props WHERE note_id = $1", task_row
    )
    assert key not in stored


# ---------------------------------------------------------------------------
# A relation filter through POST .../query returns the right row ids.
# ---------------------------------------------------------------------------


async def test_relation_filter_through_query_endpoint(client, db_conn):
    tasks = await _create_database(client, "Tasks")
    projects = await _create_database(client, "Projects")
    tasks_ds, projects_ds = tasks["data_source"]["id"], projects["data_source"]["id"]
    pair = await client.post(
        f"/db/data-sources/{tasks_ds}/relations",
        json={"name": "Project", "target_data_source_id": projects_ds, "two_way": False},
    )
    key = pair.json()["forward"]["key"]

    linked_task = await _create_row(client, db_conn, tasks_ds, title="Linked")
    unlinked_task = await _create_row(client, db_conn, tasks_ds, title="Unlinked")
    project_row = await _create_row(client, db_conn, projects_ds, title="P1")
    await client.post(
        f"/db/data-sources/{tasks_ds}/rows/{linked_task}/relations/{key}/links",
        json={"row_id": project_row},
    )

    res = await client.post(
        f"/db/data-sources/{tasks_ds}/query",
        json={"filter": {"type": "condition", "property": key, "operator": "contains", "value": project_row}},
    )
    assert res.status_code == 200, res.text
    row_ids = {r["id"] for r in res.json()["rows"]}
    assert row_ids == {linked_task}
    assert unlinked_task not in row_ids


async def test_relation_is_empty_filter_through_query_endpoint(client, db_conn):
    tasks = await _create_database(client, "Tasks")
    projects = await _create_database(client, "Projects")
    tasks_ds, projects_ds = tasks["data_source"]["id"], projects["data_source"]["id"]
    pair = await client.post(
        f"/db/data-sources/{tasks_ds}/relations",
        json={"name": "Project", "target_data_source_id": projects_ds, "two_way": False},
    )
    key = pair.json()["forward"]["key"]
    linked_task = await _create_row(client, db_conn, tasks_ds, title="Linked")
    unlinked_task = await _create_row(client, db_conn, tasks_ds, title="Unlinked")
    project_row = await _create_row(client, db_conn, projects_ds, title="P1")
    await client.post(
        f"/db/data-sources/{tasks_ds}/rows/{linked_task}/relations/{key}/links",
        json={"row_id": project_row},
    )

    res = await client.post(
        f"/db/data-sources/{tasks_ds}/query",
        json={"filter": {"type": "condition", "property": key, "operator": "is_empty"}},
    )
    assert res.status_code == 200, res.text
    row_ids = {r["id"] for r in res.json()["rows"]}
    assert row_ids == {unlinked_task}


async def test_relation_sort_through_query_endpoint_orders_by_link_count(client, db_conn):
    tasks = await _create_database(client, "Tasks")
    projects = await _create_database(client, "Projects")
    tasks_ds, projects_ds = tasks["data_source"]["id"], projects["data_source"]["id"]
    pair = await client.post(
        f"/db/data-sources/{tasks_ds}/relations",
        json={"name": "Project", "target_data_source_id": projects_ds, "two_way": False},
    )
    key = pair.json()["forward"]["key"]
    zero_links = await _create_row(client, db_conn, tasks_ds, title="Zero")
    one_link = await _create_row(client, db_conn, tasks_ds, title="One")
    p1 = await _create_row(client, db_conn, projects_ds, title="P1")
    await client.post(
        f"/db/data-sources/{tasks_ds}/rows/{one_link}/relations/{key}/links", json={"row_id": p1}
    )

    res = await client.post(
        f"/db/data-sources/{tasks_ds}/query",
        json={"sorts": [{"property": key, "direction": "desc"}]},
    )
    assert res.status_code == 200, res.text
    ids_in_order = [r["id"] for r in res.json()["rows"]]
    assert ids_in_order.index(one_link) < ids_in_order.index(zero_links)


# ---------------------------------------------------------------------------
# PATCH /db/relations/{relation_id}/dependency-settings
# ---------------------------------------------------------------------------


async def test_patch_dependency_settings_updates_config(client):
    db = await _create_database(client, "Tasks")
    ds_id = db["data_source"]["id"]
    date_prop = await _create_property(client, ds_id, "Due", "date")
    pair = (await client.post(f"/db/data-sources/{ds_id}/dependencies")).json()
    relation_id = pair["forward"]["config"]["relation_id"]

    res = await client.patch(
        f"/db/relations/{relation_id}/dependency-settings",
        json={
            "date_shift_mode": "Shift & maintain time between items",
            "avoid_weekends": True,
            "date_property_key": date_prop["key"],
        },
    )
    assert res.status_code == 200, res.text
    config = res.json()["config"]
    assert config["date_shift_mode"] == "Shift & maintain time between items"
    assert config["avoid_weekends"] is True
    assert config["date_property_key"] == date_prop["key"]


async def test_patch_dependency_settings_invalid_mode_400(client):
    db = await _create_database(client, "Tasks")
    ds_id = db["data_source"]["id"]
    pair = (await client.post(f"/db/data-sources/{ds_id}/dependencies")).json()
    relation_id = pair["forward"]["config"]["relation_id"]
    res = await client.patch(
        f"/db/relations/{relation_id}/dependency-settings",
        json={"date_shift_mode": "not a real mode"},
    )
    assert res.status_code == 400


async def test_patch_dependency_settings_non_date_property_key_400(client):
    db = await _create_database(client, "Tasks")
    ds_id = db["data_source"]["id"]
    text_prop = await _create_property(client, ds_id, "Notes", "rich_text")
    pair = (await client.post(f"/db/data-sources/{ds_id}/dependencies")).json()
    relation_id = pair["forward"]["config"]["relation_id"]
    res = await client.patch(
        f"/db/relations/{relation_id}/dependency-settings",
        json={"date_property_key": text_prop["key"]},
    )
    assert res.status_code == 400


async def test_patch_dependency_settings_unknown_relation_404(client):
    res = await client.patch(
        "/db/relations/00000000-0000-0000-0000-000000000000/dependency-settings",
        json={"avoid_weekends": True},
    )
    assert res.status_code == 404


async def test_patch_dependency_settings_rejects_ordinary_relation(client):
    tasks = await _create_database(client, "Tasks")
    projects = await _create_database(client, "Projects")
    pair = await client.post(
        f"/db/data-sources/{tasks['data_source']['id']}/relations",
        json={"name": "Project", "target_data_source_id": projects["data_source"]["id"], "two_way": False},
    )
    relation_id = pair.json()["forward"]["config"]["relation_id"]
    res = await client.patch(
        f"/db/relations/{relation_id}/dependency-settings", json={"avoid_weekends": True}
    )
    assert res.status_code == 404  # not a dependency-system pair


# ---------------------------------------------------------------------------
# A date write cascading a dependency shift, and a cascade failure rolling
# back the write.
# ---------------------------------------------------------------------------


def _wrap_date(dt: datetime) -> dict:
    return {"type": "date", "date": {"start": _iso(dt), "end": None, "time_zone": None}}


async def test_date_write_cascades_dependency_shift_and_returns_shifted_rows(client, db_conn):
    db = await _create_database(client, "Tasks")
    ds_id = db["data_source"]["id"]
    date_prop = await _create_property(client, ds_id, "Due", "date")
    date_key = date_prop["key"]
    pair = (await client.post(f"/db/data-sources/{ds_id}/dependencies")).json()
    relation_id = pair["forward"]["config"]["relation_id"]
    forward_key = pair["forward"]["key"]

    blocker = await _create_row(client, db_conn, ds_id, title="Blocker")
    blocked = await _create_row(client, db_conn, ds_id, title="Blocked")
    await client.post(
        f"/db/data-sources/{ds_id}/rows/{blocker}/relations/{forward_key}/links",
        json={"row_id": blocked},
    )
    await client.patch(
        f"/db/relations/{relation_id}/dependency-settings",
        json={"date_shift_mode": "Shift & maintain time between items", "date_property_key": date_key},
    )

    # Seed both dates directly (task-20's own test convention) via the
    # router itself, so the "old value" the cascade diffs against is the
    # one this same endpoint wrote.
    await client.patch(
        f"/db/data-sources/{ds_id}/rows/{blocker}",
        json={"property_key": date_key, "value": _wrap_date(_dt(2026, 8, 17))},
    )
    await client.patch(
        f"/db/data-sources/{ds_id}/rows/{blocked}",
        json={"property_key": date_key, "value": _wrap_date(_dt(2026, 8, 24))},
    )

    res = await client.patch(
        f"/db/data-sources/{ds_id}/rows/{blocker}",
        json={"property_key": date_key, "value": _wrap_date(_dt(2026, 8, 24))},  # +7 days
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["shifted_rows"] is not None
    assert len(body["shifted_rows"]) == 1
    shifted = body["shifted_rows"][0]
    assert shifted["id"] == blocked
    assert shifted["properties"][date_key]["date"]["start"] == _iso(_dt(2026, 8, 31))

    # And it's actually persisted, not just reported.
    stored = await db_conn.fetchval(
        "SELECT properties -> $1 -> 'date' ->> 'start' FROM db_row_props WHERE note_id = $2",
        date_key,
        blocked,
    )
    assert stored == _iso(_dt(2026, 8, 31))


async def test_date_write_with_no_dependency_configured_has_no_shifted_rows(client, db_conn):
    db = await _create_database(client, "Tasks")
    ds_id = db["data_source"]["id"]
    date_prop = await _create_property(client, ds_id, "Due", "date")
    row = await _create_row(client, db_conn, ds_id)

    res = await client.patch(
        f"/db/data-sources/{ds_id}/rows/{row}",
        json={"property_key": date_prop["key"], "value": _wrap_date(_dt(2026, 8, 17))},
    )
    assert res.status_code == 200, res.text
    assert res.json()["shifted_rows"] is None


async def test_cascade_failure_rolls_back_the_write(client, db_conn):
    db = await _create_database(client, "Tasks")
    ds_id = db["data_source"]["id"]
    date_prop = await _create_property(client, ds_id, "Due", "date")
    date_key = date_prop["key"]
    pair = (await client.post(f"/db/data-sources/{ds_id}/dependencies")).json()
    relation_id = pair["forward"]["config"]["relation_id"]
    forward_key = pair["forward"]["key"]

    blocker = await _create_row(client, db_conn, ds_id, title="Blocker")
    blocked = await _create_row(client, db_conn, ds_id, title="Blocked")
    await client.post(
        f"/db/data-sources/{ds_id}/rows/{blocker}/relations/{forward_key}/links",
        json={"row_id": blocked},
    )
    await client.patch(
        f"/db/relations/{relation_id}/dependency-settings",
        json={"date_shift_mode": "Shift & maintain time between items", "date_property_key": date_key},
    )
    original = _wrap_date(_dt(2026, 8, 17))
    await client.patch(
        f"/db/data-sources/{ds_id}/rows/{blocker}", json={"property_key": date_key, "value": original}
    )

    # A malformed downstream date (bypassing the router's own shallow
    # wrapper-shape validation via a direct write, the same test-setup
    # convention tests/test_db_relations.py uses) -- cascade_dependency_
    # shift's own _read_window/_parse_iso raises a plain ValueError when it
    # tries to read `blocked`'s window, which the router must map to a 400
    # and roll back rather than ever letting it 500 or partially apply.
    await db_conn.execute(
        """
        UPDATE db_row_props
        SET properties = jsonb_set(properties, $1, $2::jsonb, true)
        WHERE note_id = $3
        """,
        [date_key],
        {"type": "date", "date": {"start": "not-a-real-date", "end": None, "time_zone": None}},
        blocked,
    )

    res = await client.patch(
        f"/db/data-sources/{ds_id}/rows/{blocker}",
        json={"property_key": date_key, "value": _wrap_date(_dt(2026, 8, 24))},
    )
    assert res.status_code == 400, res.text

    # The whole write rolled back -- blocker's date is still the original.
    stored = await db_conn.fetchval(
        "SELECT properties -> $1 -> 'date' ->> 'start' FROM db_row_props WHERE note_id = $2",
        date_key,
        blocker,
    )
    assert stored == _iso(_dt(2026, 8, 17))
