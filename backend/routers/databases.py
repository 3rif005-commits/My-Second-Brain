"""Router for Notion-style databases: database/data-source/property/view
CRUD, plus the built-in "All Notes" virtual source (spec §6).

Spec: docs/superpowers/specs/2026-08-08-notion-databases-design.md §3, §6, §10.
Plan: docs/plans/2026-08-08-notion-databases.md, Milestone 2.

Tenancy: asyncpg connects with the service role (RLS does not apply on this
path — spec §8.3), so every query below carries an explicit `user_id = $N`
predicate as the enforcement boundary. `tests/test_databases_router.py`'s
guard test scans this file's source for exactly that.

"All Notes" (spec §6): addressed by the fixed slug `"all-notes"` rather
than a UUID. It is virtual — no `db_databases`/`db_data_sources`/
`db_properties`/`db_views` row exists for it — so every endpoint here
special-cases that slug *before* touching the database, and synthesizes
the response in memory from `COLUMN_BACKED` (services/db/properties/
columns.py) instead.
"""
from __future__ import annotations

import uuid as uuid_lib
from datetime import datetime, timezone
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

from models.database import (
    DatabaseCreate,
    DatabaseDetailResponse,
    DatabaseResponse,
    DataSourceResponse,
    PropertyCreate,
    PropertyRename,
    PropertyResponse,
    RowsResponse,
    ViewResponse,
)
from routers.notes import get_user_id
from services.db.connection import get_conn
from services.db.keys import mint_key
from services.db.properties.base import REGISTRY
from services.db.properties.columns import COLUMN_BACKED
from services.db.views import sweep_property_from_views

router = APIRouter(prefix="/db", tags=["databases"])

# The well-known slug for the virtual "All Notes" data source (spec §6).
# Never a real UUID, so every path below checks for it first.
ALL_NOTES_ID = "all-notes"

# db_properties.key collisions are astronomically unlikely (8-char base62,
# ~2.2e14 keyspace — spec §4.2) but not impossible; retry a few times with a
# freshly minted key rather than ever surfacing a collision as a user-facing
# 500.
_KEY_MINT_ATTEMPTS = 5


def _jsonify(value: Any) -> Any:
    """Coerce a raw `notes`-column value to a JSON-safe primitive for the
    All Notes rows endpoint (`asyncpg` returns `datetime`/`uuid.UUID` for
    those column types, neither of which is a plain JSON scalar)."""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, uuid_lib.UUID):
        return str(value)
    return value


def _row(record: asyncpg.Record) -> dict[str, Any]:
    """`dict(record)` with every `uuid.UUID` value stringified — asyncpg
    decodes `uuid` columns to `uuid.UUID` objects, but every `*Response`
    model in `models/database.py` declares id/fk fields as plain `str`
    (matching the rest of this app's convention — see `models/note.py`),
    so every `Model(**_row(record))` call needs this rather than the bare
    `dict(record)`."""
    return {
        k: (str(v) if isinstance(v, uuid_lib.UUID) else v) for k, v in dict(record).items()
    }


def _parse_uuid_or_404(value: str, what: str) -> str:
    """Validate a path param looks like a UUID before it ever reaches
    asyncpg — an unparseable UUID sent straight to asyncpg raises
    `DataError`, not a clean 404. Returns `value` unchanged (asyncpg
    accepts a plain `str` for a `uuid` parameter); this only guards the
    format."""
    try:
        uuid_lib.UUID(value)
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")
    return value


def _all_notes_database(user_id: str) -> DatabaseDetailResponse:
    """Synthesize the "All Notes" virtual source's response in memory —
    spec §6: "no db_row_props rows, no backfill migration at all." Same
    reasoning applies one level up: no db_databases/db_data_sources/
    db_properties/db_views rows either. Properties come straight from
    COLUMN_BACKED, in its declared order.
    """
    now = datetime.now(timezone.utc)
    database = DatabaseResponse(
        id=ALL_NOTES_ID,
        user_id=user_id,
        title="All Notes",
        description=[],
        icon="🧠",
        cover_url=None,
        is_inline=False,
        parent_note_id=None,
        is_locked=True,
        position=0,
        created_at=now,
        updated_at=now,
        deleted_at=None,
    )
    data_source = DataSourceResponse(
        id=ALL_NOTES_ID,
        database_id=ALL_NOTES_ID,
        user_id=user_id,
        name="All Notes",
        system_kind="notes",
        position=0,
        created_at=now,
        is_virtual=True,
    )
    properties = [
        PropertyResponse(
            id=f"col_{name}",
            data_source_id=ALL_NOTES_ID,
            user_id=user_id,
            key=prop.column,
            name=name.replace("_", " ").title(),
            type=prop.type,
            config={},
            description=None,
            storage="column",
            column_name=prop.column,
            result_type=None,
            is_volatile=False,
            position=i,
            created_at=now,
        )
        for i, (name, prop) in enumerate(COLUMN_BACKED.items())
    ]
    views = [
        ViewResponse(
            id=f"{ALL_NOTES_ID}-table",
            data_source_id=ALL_NOTES_ID,
            user_id=user_id,
            name="All Notes",
            icon=None,
            type="table",
            config={},
            filter=None,
            sorts=[],
            is_locked=False,
            position=0,
        )
    ]
    return DatabaseDetailResponse(
        database=database, data_source=data_source, properties=properties, views=views
    )


@router.post(
    "/databases", response_model=DatabaseDetailResponse, status_code=status.HTTP_201_CREATED
)
async def create_database(
    body: DatabaseCreate,
    user_id: str = Depends(get_user_id),
    conn: asyncpg.Connection = Depends(get_conn),
) -> DatabaseDetailResponse:
    """One database + one (ordinary, `system_kind=NULL`) data source + one
    default table view, all in one transaction — spec §3.1: "The UI
    initially creates exactly one data source per database.\""""
    async with conn.transaction():
        db_row = await conn.fetchrow(
            """
            INSERT INTO db_databases (user_id, title, icon)
            VALUES ($1, $2, $3)
            RETURNING *
            """,
            user_id,
            body.title,
            body.icon,
        )
        ds_row = await conn.fetchrow(
            """
            INSERT INTO db_data_sources (database_id, user_id, name)
            VALUES ($1, $2, $3)
            RETURNING *
            """,
            db_row["id"],
            user_id,
            "Default",
        )
        view_row = await conn.fetchrow(
            """
            INSERT INTO db_views (data_source_id, user_id, name, type)
            VALUES ($1, $2, $3, 'table')
            RETURNING *
            """,
            ds_row["id"],
            user_id,
            "Default view",
        )
    return DatabaseDetailResponse(
        database=DatabaseResponse(**_row(db_row)),
        data_source=DataSourceResponse(**_row(ds_row), is_virtual=False),
        properties=[],
        views=[ViewResponse(**_row(view_row))],
    )


@router.get("/databases/{database_id}", response_model=DatabaseDetailResponse)
async def get_database(
    database_id: str,
    user_id: str = Depends(get_user_id),
    conn: asyncpg.Connection = Depends(get_conn),
) -> DatabaseDetailResponse:
    if database_id == ALL_NOTES_ID:
        return _all_notes_database(user_id)

    database_id = _parse_uuid_or_404(database_id, "database")

    db_row = await conn.fetchrow(
        """
        SELECT * FROM db_databases
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
        """,
        database_id,
        user_id,
    )
    if db_row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "database not found")

    # M2 always creates exactly one data source per database (spec §3.1);
    # take the first by position for the (future) multi-data-source case.
    ds_row = await conn.fetchrow(
        """
        SELECT * FROM db_data_sources
        WHERE database_id = $1 AND user_id = $2
        ORDER BY position, created_at
        LIMIT 1
        """,
        db_row["id"],
        user_id,
    )
    if ds_row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "data source not found")

    prop_rows = await conn.fetch(
        """
        SELECT * FROM db_properties
        WHERE data_source_id = $1 AND user_id = $2
        ORDER BY position, created_at
        """,
        ds_row["id"],
        user_id,
    )
    view_rows = await conn.fetch(
        """
        SELECT * FROM db_views
        WHERE data_source_id = $1 AND user_id = $2
        ORDER BY position
        """,
        ds_row["id"],
        user_id,
    )
    return DatabaseDetailResponse(
        database=DatabaseResponse(**_row(db_row)),
        data_source=DataSourceResponse(**_row(ds_row), is_virtual=False),
        properties=[PropertyResponse(**_row(r)) for r in prop_rows],
        views=[ViewResponse(**_row(r)) for r in view_rows],
    )


@router.get("/data-sources/{data_source_id}/rows", response_model=RowsResponse)
async def list_rows(
    data_source_id: str,
    user_id: str = Depends(get_user_id),
    conn: asyncpg.Connection = Depends(get_conn),
) -> RowsResponse:
    """Milestone 2 ships no filter/sort compiler (Milestone 3) — this is a
    plain "list everything" query for both the virtual and ordinary case.
    """
    if data_source_id == ALL_NOTES_ID:
        note_rows = await conn.fetch(
            """
            SELECT id, title, icon, topics, mastery_status, source_type,
                   source_url, is_favorited, created_at, updated_at
            FROM notes
            WHERE user_id = $1 AND deleted_at IS NULL
            ORDER BY updated_at DESC
            """,
            user_id,
        )
        rows = [
            {
                "id": str(r["id"]),
                "properties": {
                    prop.column: _jsonify(r[prop.column]) for prop in COLUMN_BACKED.values()
                },
            }
            for r in note_rows
        ]
        return RowsResponse(rows=rows)

    data_source_id = _parse_uuid_or_404(data_source_id, "data source")
    ds_row = await conn.fetchrow(
        """
        SELECT id FROM db_data_sources WHERE id = $1 AND user_id = $2
        """,
        data_source_id,
        user_id,
    )
    if ds_row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "data source not found")

    row_rows = await conn.fetch(
        """
        SELECT note_id, properties FROM db_row_props
        WHERE data_source_id = $1 AND user_id = $2
        ORDER BY position
        """,
        data_source_id,
        user_id,
    )
    rows = [{"id": str(r["note_id"]), "properties": r["properties"]} for r in row_rows]
    return RowsResponse(rows=rows)


@router.post(
    "/data-sources/{data_source_id}/properties",
    response_model=PropertyResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_property(
    data_source_id: str,
    body: PropertyCreate,
    user_id: str = Depends(get_user_id),
    conn: asyncpg.Connection = Depends(get_conn),
) -> PropertyResponse:
    if data_source_id == ALL_NOTES_ID:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "cannot add properties to the built-in All Notes source",
        )

    data_source_id = _parse_uuid_or_404(data_source_id, "data source")
    ds_row = await conn.fetchrow(
        """
        SELECT id FROM db_data_sources WHERE id = $1 AND user_id = $2
        """,
        data_source_id,
        user_id,
    )
    if ds_row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "data source not found")

    if body.type not in REGISTRY:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unknown property type: {body.type!r}")

    for _ in range(_KEY_MINT_ATTEMPTS):
        key = mint_key()
        try:
            # Each attempt gets its own transaction (a SAVEPOINT if `conn`
            # is already inside one, e.g. a test's rolled-back wrapper —
            # see tests/conftest.py's db_conn fixture). Without this, a
            # UniqueViolationError aborts the *entire* enclosing Postgres
            # transaction (not just this statement), and every subsequent
            # attempt — including ones with a fresh, non-colliding key —
            # would fail with "current transaction is aborted" instead of
            # actually retrying.
            async with conn.transaction():
                row = await conn.fetchrow(
                    """
                    INSERT INTO db_properties
                        (data_source_id, user_id, key, name, type, config, description,
                         storage, position)
                    VALUES
                        ($1, $2, $3, $4, $5, $6, $7, 'jsonb',
                         COALESCE(
                            (SELECT MAX(position) + 1 FROM db_properties
                             WHERE data_source_id = $1 AND user_id = $2),
                            0))
                    RETURNING *
                    """,
                    data_source_id,
                    user_id,
                    key,
                    body.name,
                    body.type,
                    body.config,
                    body.description,
                )
        except asyncpg.UniqueViolationError:
            continue
        return PropertyResponse(**_row(row))
    raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "could not mint a unique property key")


@router.patch("/properties/{property_id}", response_model=PropertyResponse)
async def rename_property(
    property_id: str,
    body: PropertyRename,
    user_id: str = Depends(get_user_id),
    conn: asyncpg.Connection = Depends(get_conn),
) -> PropertyResponse:
    """Renaming only ever touches `name`. Never touches `key`, and — since
    it never touches `db_row_props` at all — every row's JSONB is
    byte-identical before and after (spec §4.2: "Rename is
    metadata-only.\")."""
    property_id = _parse_uuid_or_404(property_id, "property")
    row = await conn.fetchrow(
        """
        UPDATE db_properties SET name = $1
        WHERE id = $2 AND user_id = $3
        RETURNING *
        """,
        body.name,
        property_id,
        user_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "property not found")
    return PropertyResponse(**_row(row))


@router.delete("/properties/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_property(
    property_id: str,
    user_id: str = Depends(get_user_id),
    conn: asyncpg.Connection = Depends(get_conn),
) -> None:
    """Deletes the property, then sweeps its `key` out of every view
    belonging to the same data source (spec §10)."""
    property_id = _parse_uuid_or_404(property_id, "property")
    async with conn.transaction():
        row = await conn.fetchrow(
            """
            DELETE FROM db_properties
            WHERE id = $1 AND user_id = $2
            RETURNING data_source_id, key
            """,
            property_id,
            user_id,
        )
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "property not found")
        await sweep_property_from_views(conn, user_id, str(row["data_source_id"]), row["key"])
