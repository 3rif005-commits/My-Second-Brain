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
from pydantic import ValidationError

from models.database import (
    DatabaseCreate,
    DatabaseDetailResponse,
    DatabaseResponse,
    DataSourceResponse,
    GroupResult,
    PropertyCreate,
    PropertyRename,
    PropertyResponse,
    QueryRequest,
    QueryResponse,
    RowPropertyUpdate,
    RowResponse,
    RowsResponse,
    ViewCreate,
    ViewResponse,
    ViewUpdate,
)
from routers.notes import get_user_id
from services.db.connection import get_conn
from services.db.keys import mint_key
from services.db.properties.base import REGISTRY
from services.db.properties.columns import COLUMN_BACKED
from services.db.query import ast
from services.db.query import grouping
from services.db.query.builder import QueryBuilder
from services.db.query.compiler import PropertyLookup
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

# task-10 review finding 1: list_rows had no LIMIT anywhere in the pipeline,
# so a user with hundreds/thousands of notes fetched every matching row
# unconditionally on the one page Milestone 2 ships (/brain/db/all-notes).
# 500 is generous for a personal single-user knowledge base and keeps the
# query and the JSON payload bounded. Real pagination (cursor/offset, query
# params, "load more" UI) is explicitly Milestone 3+ scope — this is just a
# hard cap, not a feature.
_ROWS_LIMIT = 500


def _jsonify(value: Any) -> Any:
    """Coerce a raw `notes`-column value to a JSON-safe primitive for the
    All Notes rows endpoint (`asyncpg` returns `datetime`/`uuid.UUID` for
    those column types, neither of which is a plain JSON scalar)."""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, uuid_lib.UUID):
        return str(value)
    return value


def _wrap_column_value(prop_type: str, raw: Any) -> dict[str, Any]:
    """Apply spec §3.3's discriminated-value wrapper
    (`{"type": <type>, <type>: <value>}`) to a raw `notes` column value, so
    an All Notes row has the same per-property value *shape* as an
    ordinary data source's `db_row_props.properties` entry — task-5 review
    finding 2: the frontend must not need a virtual-source branch for cell
    value shape, only for whether writes are possible at all."""
    return {"type": prop_type, prop_type: raw}


def _decode_all_notes_row(record: asyncpg.Record) -> dict[str, Any]:
    """Shapes one `notes` row -- a bare `SELECT id, <COLUMN_BACKED cols> ...` record
    (`list_rows`) or a `QueryBuilder`-produced `n.id, <cols>` record (`query_rows` below,
    task-15) -- into the wire shape both endpoints promise: spec §3.3's discriminated
    wrapper per property, keyed by each COLUMN_BACKED property's `notes` column name.
    Extracted here (task-15-brief.md §1.4) so the two callers stay byte-identical rather
    than duplicating and silently drifting.

    `cover_image_url` (task-17) rides alongside `properties` as its own field, read with
    `record.get(...)` rather than `record[...]` on purpose: `query_rows`'s QueryBuilder-
    produced SQL always selects `n.cover_image_url` now, but `list_rows`'s own hand-rolled
    SQL below does not -- `.get()` returns `None` for that caller instead of a KeyError,
    which is the deliberate, documented asymmetry (see the `# ---` block above
    `test_query_returns_real_cover_image_url_ordinary_mode` in
    tests/test_databases_query_endpoint.py): `list_rows` has no live frontend caller left
    (task-16 moved everything to `POST .../query`), so it doesn't need the real value."""
    return {
        "id": str(record["id"]),
        "properties": {
            prop.column: _wrap_column_value(prop.type, _jsonify(record[prop.column]))
            for prop in COLUMN_BACKED.values()
        },
        "cover_image_url": record.get("cover_image_url"),
    }


def _decode_ordinary_row(record: asyncpg.Record) -> dict[str, Any]:
    """Same purpose as `_decode_all_notes_row`, for an ordinary data source's
    `db_row_props` record (`note_id`, `properties`). The JSONB is already spec
    §3.3-shaped by construction (every write path enforces the wrapper -- see
    `update_row_property`), so this is a straight field rename, not a re-shaping.

    `cover_image_url`: same `.get()`-not-`[]` reasoning as `_decode_all_notes_row` above --
    `list_rows`'s ordinary-mode SQL doesn't join `notes` at all, let alone select the
    column, so this is `None` for that caller and the real value for `query_rows`."""
    return {
        "id": str(record["note_id"]),
        "properties": record["properties"],
        "cover_image_url": record.get("cover_image_url"),
    }


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
    default table view + one default "Title" property, all in one
    transaction — spec §3.1: "The UI initially creates exactly one data
    source per database." The Title property matches Notion's own
    behaviour (every database starts with a title column) and means a
    freshly created database is immediately usable rather than inert with
    zero columns."""
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
        # A fresh data source has no existing keys, so a single mint (no
        # collision-retry loop, unlike create_property below) is safe here.
        prop_row = await conn.fetchrow(
            """
            INSERT INTO db_properties (data_source_id, user_id, key, name, type, storage, position)
            VALUES ($1, $2, $3, 'Title', 'title', 'jsonb', 0)
            RETURNING *
            """,
            ds_row["id"],
            user_id,
            mint_key(),
        )
    return DatabaseDetailResponse(
        database=DatabaseResponse(**_row(db_row)),
        data_source=DataSourceResponse(**_row(ds_row), is_virtual=False),
        properties=[PropertyResponse(**_row(prop_row))],
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
        # Column list is built from COLUMN_BACKED itself (task-5 review
        # finding 3) rather than duplicated as a hardcoded literal list —
        # those two lists silently drifting apart would KeyError below
        # (r[prop.column]) with nothing catching it if COLUMN_BACKED ever
        # grows a new entry. Safe to interpolate: every name in
        # COLUMN_BACKED is a fixed, already-validated Python literal (see
        # services/db/properties/columns.py's own module-level guard), not
        # request-influenced.
        _all_notes_columns = ", ".join(prop.column for prop in COLUMN_BACKED.values())
        note_rows = await conn.fetch(
            f"""
            SELECT id, {_all_notes_columns}
            FROM notes
            WHERE user_id = $1 AND deleted_at IS NULL
            ORDER BY updated_at DESC
            LIMIT $2
            """,
            user_id,
            _ROWS_LIMIT,
        )
        rows = [_decode_all_notes_row(r) for r in note_rows]
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
        LIMIT $3
        """,
        data_source_id,
        user_id,
        _ROWS_LIMIT,
    )
    rows = [_decode_ordinary_row(r) for r in row_rows]
    return RowsResponse(rows=rows)


def _resolve_group_label(
    key: str, default_label: str, prop_type: str, config: dict[str, Any]
) -> str:
    """Milestone 4's `grouping.py` has no config access (it only ever sees already-fetched
    rows + a `PropertyLookup`), so a select/status `Group`'s key AND label are both the
    raw stored option id (`_group_by_values`'s `_bucket(buckets, value, value, row)`) --
    the "group labels are opaque ids" gap the M4+M5 combined review flagged as a Minor
    (task-15-brief.md §1.6). Resolved here, the one place in this endpoint with both the
    grouped rows AND `db_properties.config`'s real option list: look up `key` against
    `config["options"]` by id, use that option's `name` if found. Falls back to
    `default_label` (== the raw id, from grouping.py) for every other property type, an
    unconfigured property (`config` has no "options" key or an empty one), or a
    stale/deleted option id no longer in the list -- including the implicit
    "__no_value__" bucket, which never matches any real option id and so always falls
    through here by construction, not via a special case."""
    if prop_type not in ("select", "status"):
        return default_label
    for option in config.get("options", []):
        if option.get("id") == key:
            return option.get("name", default_label)
    return default_label


def _group_to_result(
    group: grouping.Group,
    prop_type: str,
    config: dict[str, Any],
    sub_lookup: PropertyLookup | None,
    sub_config: dict[str, Any],
) -> GroupResult:
    """`grouping.Group` -> the JSON-serializable `GroupResult` (models/database.py),
    resolving this group's label and -- one level down, per task-15-brief.md §1.6 -- every
    subgroup's label too. Never recurses past that: `sub_group()` itself only ever
    produces two levels (a subgroup's own `.subgroups` is always `None`), so a subgroup is
    built inline here rather than through a second call to this function."""
    subgroups = None
    if group.subgroups is not None:
        assert sub_lookup is not None  # sub_group_by was set whenever subgroups exist
        subgroups = [
            GroupResult(
                key=sg.key,
                label=_resolve_group_label(sg.key, sg.label, sub_lookup.type, sub_config),
                row_count=len(sg.rows),
                rows=sg.rows,
                subgroups=None,
            )
            for sg in group.subgroups
        ]
    return GroupResult(
        key=group.key,
        label=_resolve_group_label(group.key, group.label, prop_type, config),
        row_count=len(group.rows),
        rows=group.rows,
        subgroups=subgroups,
    )


@router.post(
    "/data-sources/{data_source_id}/query",
    response_model=QueryResponse,
    response_model_exclude_none=True,
)
async def query_rows(
    data_source_id: str,
    body: QueryRequest,
    user_id: str = Depends(get_user_id),
    conn: asyncpg.Connection = Depends(get_conn),
) -> QueryResponse:
    """Milestone 6 (task-15): the filtered/sorted/grouped superset of `list_rows` above --
    wires Milestone 3's filter/sort compiler (`services.db.query.compiler`/`builder`) and
    Milestone 4's grouping (`services.db.query.grouping`) into an HTTP endpoint for the
    first time (neither ever had a live caller before this). `list_rows` stays unmodified
    for any caller that doesn't need filtering/sorting/grouping.

    Same two-mode split as `list_rows`/`QueryBuilder` throughout: All Notes
    (`data_source_id == ALL_NOTES_ID`, properties built from `COLUMN_BACKED`) or an
    ordinary data source (properties from `db_properties`). Every row this endpoint can
    possibly return passes through `QueryBuilder.build()`, which always splices in
    `_scope()`'s mandatory `user_id`/`data_source_id`/`deleted_at` predicate (spec §8.3) --
    there is no code path here that queries `db_row_props`/`notes` directly.
    """
    all_notes = data_source_id == ALL_NOTES_ID
    configs: dict[str, dict[str, Any]] = {}

    if all_notes:
        properties = {
            prop.column: PropertyLookup(type=prop.type, storage="column", key=prop.column)
            for prop in COLUMN_BACKED.values()
        }
    else:
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

        prop_rows = await conn.fetch(
            """
            SELECT key, type, storage, config FROM db_properties
            WHERE data_source_id = $1 AND user_id = $2
            """,
            data_source_id,
            user_id,
        )
        properties = {
            r["key"]: PropertyLookup(type=r["type"], storage=r["storage"], key=r["key"])
            for r in prop_rows
        }
        # Group-label resolution (below) needs each property's configured option list
        # too -- task-15-brief.md §1's own `SELECT key, type, storage` doesn't carry it,
        # so this widens that one query rather than issuing a second round-trip per group.
        configs = {r["key"]: (r["config"] or {}) for r in prop_rows}

    try:
        filter_node = ast.parse_filter(body.filter)
        sorts = [ast.SortSpec(**s) for s in body.sorts]
        pagination = ast.Pagination(page_size=body.page_size, offset=body.offset)
        builder = QueryBuilder(
            user_id=user_id,
            data_source_id=None if all_notes else data_source_id,
            properties=properties,
        )
        frag = builder.build(filter_node, sorts, pagination)
    except (ast.FilterValidationError, ValidationError) as exc:
        # spec §8.2 layer 2's "unknown key -> HTTP 400, never a silently dropped clause",
        # now reachable over HTTP for the first time -- both parse-time shape errors
        # (parse_filter/SortSpec/Pagination) and compile-time unknown-property-key errors
        # (raised deep inside builder.build() -> compile_filter/compile_sorts) are the
        # *same* FilterValidationError class (operators.py imports it from ast.py rather
        # than defining its own), so one except clause here genuinely covers both.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    records = await conn.fetch(frag.sql, *frag.params)
    decode = _decode_all_notes_row if all_notes else _decode_ordinary_row
    rows = [decode(r) for r in records]

    if body.group_by is None:
        return QueryResponse(rows=rows)

    group_key = body.group_by.get("property_key")
    group_lookup = properties.get(group_key) if group_key is not None else None
    if group_lookup is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unknown property key: {group_key!r}")
    try:
        group_spec = grouping.GroupBySpec(**body.group_by)
        groups = grouping.group_rows(rows, group_lookup, group_spec)
    except TypeError as exc:
        # GroupBySpec is a plain dataclass (grouping.py), not Pydantic -- an
        # unexpected/missing keyword raises TypeError, not ValidationError. Same "bad
        # input -> 400, not 500" standard as every other malformed-request path here.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except (ValueError, NotImplementedError) as exc:
        # group_rows's own "fail loud" contract for a non-groupable type or an
        # unsupported/missing mode (grouping.py's docstring) -- surfaced as a 400, not
        # left to bubble up as a 500.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    sub_lookup: PropertyLookup | None = None
    sub_config: dict[str, Any] = {}
    if body.sub_group_by is not None:
        sub_key = body.sub_group_by.get("property_key")
        sub_lookup = properties.get(sub_key) if sub_key is not None else None
        if sub_lookup is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unknown property key: {sub_key!r}")
        sub_config = configs.get(sub_key, {})
        try:
            sub_spec = grouping.GroupBySpec(**body.sub_group_by)
            groups = grouping.sub_group(groups, sub_lookup, sub_spec)
        except TypeError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
        except (ValueError, NotImplementedError) as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    group_config = configs.get(group_key, {})
    return QueryResponse(
        groups=[
            _group_to_result(g, group_lookup.type, group_config, sub_lookup, sub_config)
            for g in groups
        ]
    )


@router.post(
    "/data-sources/{data_source_id}/rows",
    response_model=RowResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_row(
    data_source_id: str,
    user_id: str = Depends(get_user_id),
    conn: asyncpg.Connection = Depends(get_conn),
) -> RowResponse:
    """Create a new row on an ordinary (non-virtual) data source (review
    finding 3, fix round 2: without this, `update_row_property` above was
    unreachable end-to-end — there was no way to get a row into existence
    in the first place, so ordinary databases had zero rows, permanently).

    A database row *is* a note (spec Q2) — `db_row_props.note_id` is a FK
    to `notes.id` — so this creates the underlying `notes` row first, then
    the `db_row_props` companion row referencing it, in one transaction:
    both succeed or neither does, the same pattern as `create_database`.

    Minimal version: an untitled note with empty `properties` (`{}`, the
    column default — spec §3.3: "Absent key ≡ empty," so an empty
    properties object is a fully valid row, not a placeholder state).
    Per-property default values (spec §5's `PropertyType.default()`) are
    Milestone 3+ scope — not needed to unblock "a row exists to edit."
    """
    if data_source_id == ALL_NOTES_ID:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "rows on the All Notes virtual source are notes themselves — create a note directly",
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

    async with conn.transaction():
        note_row = await conn.fetchrow(
            """
            INSERT INTO notes (user_id, title)
            VALUES ($1, 'Untitled')
            RETURNING id
            """,
            user_id,
        )
        # Review round 2, minor finding: without an explicit position, every
        # created row defaults to 0 (migration 014), so list_rows's
        # `ORDER BY position` is an unbroken tie among them and rows can
        # visibly reshuffle between GETs once 2+ exist. Append to the end.
        row = await conn.fetchrow(
            """
            INSERT INTO db_row_props (note_id, data_source_id, user_id, position)
            VALUES ($1, $2, $3,
                    COALESCE(
                        (SELECT MAX(position) + 1 FROM db_row_props
                         WHERE data_source_id = $2 AND user_id = $3),
                        0))
            RETURNING note_id, properties
            """,
            note_row["id"],
            data_source_id,
            user_id,
        )
    return RowResponse(id=str(row["note_id"]), properties=row["properties"])


@router.patch("/data-sources/{data_source_id}/rows/{note_id}", response_model=RowResponse)
async def update_row_property(
    data_source_id: str,
    note_id: str,
    body: RowPropertyUpdate,
    user_id: str = Depends(get_user_id),
    conn: asyncpg.Connection = Depends(get_conn),
) -> RowResponse:
    """Write a single property's value on a single row (task-5 review
    finding 1 — the milestone's own frontend test cases, "TableView
    renders 8 property types read-only, then editable" and "optimistic
    edit rolls back and toasts on a 500", aren't buildable without this).

    Ordinary data sources only: this endpoint writes into `db_row_props.
    properties`, a JSONB column keyed by minted property keys.
    `body.value` is the full spec §3.3 wrapper (e.g. `{"type": "status",
    "status": "done"}`), matching what `GET .../rows` returns and what's
    actually stored — never a bare scalar.

    All Notes (the virtual source, `data_source_id == "all-notes"`) is
    deliberately NOT handled here: each column-backed property has a
    genuinely different write-side coercion (an array for `topics`, an
    enum-constrained scalar for `mastery_status` with a `notes` CHECK
    constraint, a `rich_text`-typed wrapper for `icon` despite the column
    being a plain string, `created_at`/`updated_at` being read-only
    computed timestamps that should reject writes rather than silently
    accept them) rather than one generic JSONB merge. Building that
    correctly for all 9 columns is real, separate scope; shipping it
    rushed risks a wrong-coercion bug that's worse than not having the
    endpoint yet. Deferred, not forgotten — flagged again in the task-5
    report.
    """
    if data_source_id == ALL_NOTES_ID:
        raise HTTPException(
            status.HTTP_501_NOT_IMPLEMENTED,
            "row writes on the All Notes virtual source are not yet implemented",
        )

    data_source_id = _parse_uuid_or_404(data_source_id, "data source")
    note_id = _parse_uuid_or_404(note_id, "row")

    ds_row = await conn.fetchrow(
        """
        SELECT id FROM db_data_sources WHERE id = $1 AND user_id = $2
        """,
        data_source_id,
        user_id,
    )
    if ds_row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "data source not found")

    prop_row = await conn.fetchrow(
        """
        SELECT storage, type FROM db_properties
        WHERE data_source_id = $1 AND user_id = $2 AND key = $3
        """,
        data_source_id,
        user_id,
        body.property_key,
    )
    if prop_row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "property not found")
    if prop_row["storage"] != "jsonb":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "property is not JSONB-backed")

    # task-10 review finding 2: `body.value` is `Any` at the Pydantic layer
    # (models/database.py) with no shape validation, so nothing stopped a
    # `status`-typed property being PATCHed with a `number` wrapper — or a
    # bare, unwrapped scalar — and written into db_row_props.properties
    # verbatim. Spec §3.3 promises every stored value is a discriminated
    # wrapper (`{"type": <type>, <type>: <value>}`) matching its property's
    # declared type; Milestone 3's filter/sort compiler will assume that
    # invariant holds. The `None` branch above (clear-property) is exempt —
    # a clear has no type to check. Deliberately shallow: this only checks
    # the wrapper's `type` tag, not that the inner value is well-formed for
    # that type (e.g. a `number` wrapper's value actually being numeric) —
    # that's `coerce_write`/Milestone 5 scope.
    if body.value is not None:
        if not isinstance(body.value, dict) or body.value.get("type") != prop_row["type"]:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"value must be a {prop_row['type']!r} wrapper, e.g. "
                f'{{"type": "{prop_row["type"]}", ...}}',
            )

    if body.value is None:
        # A top-level `null` means "clear/unset this property", not "set
        # its value to SQL NULL" — `db_row_props.properties` is NOT NULL
        # (migration 014), and `jsonb_set(properties, path, NULL, true)`
        # would set the *entire column* to NULL, not just this key
        # (review finding 1, fix round 2 — verified end-to-end against
        # the harness as a real NotNullViolationError, not a theoretical
        # concern). `properties - key` drops just the one key; spec §3.3:
        # "Absent key ≡ empty."
        row = await conn.fetchrow(
            """
            UPDATE db_row_props
            SET properties = properties - $1, updated_at = now()
            WHERE note_id = $2 AND data_source_id = $3 AND user_id = $4
            RETURNING note_id, properties
            """,
            body.property_key,
            note_id,
            data_source_id,
            user_id,
        )
    else:
        row = await conn.fetchrow(
            """
            UPDATE db_row_props
            SET properties = jsonb_set(properties, $1, $2, true), updated_at = now()
            WHERE note_id = $3 AND data_source_id = $4 AND user_id = $5
            RETURNING note_id, properties
            """,
            [body.property_key],
            body.value,
            note_id,
            data_source_id,
            user_id,
        )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "row not found")
    return RowResponse(id=str(row["note_id"]), properties=row["properties"])


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


@router.post(
    "/data-sources/{data_source_id}/views",
    response_model=ViewResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_view(
    data_source_id: str,
    body: ViewCreate,
    user_id: str = Depends(get_user_id),
    conn: asyncpg.Connection = Depends(get_conn),
) -> ViewResponse:
    """The first way to create a non-default view (task-15): `create_database` mints
    exactly one table view per data source, and there was previously no other path to a
    second one -- every M6 view type (Board/Gallery/List/Feed) was unreachable through the
    UI regardless of how good its frontend component was.

    All Notes cannot have views created on it -- it's virtual, no `db_views` row is
    possible (spec §6) -- same 400 pattern `create_property` already uses for the same
    reason on the same virtual source. `type` is deliberately unvalidated beyond being a
    non-empty string (`ViewCreate`'s own Pydantic `str` requirement) -- see
    `models/database.py`'s `ViewCreate` docstring for why no closed enum lives here.
    """
    if data_source_id == ALL_NOTES_ID:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "cannot add views to the built-in All Notes source",
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

    # Position default: same COALESCE(MAX(position)+1, 0) pattern create_property already
    # uses for db_properties, copied rather than reinvented (task-15-brief.md §2).
    row = await conn.fetchrow(
        """
        INSERT INTO db_views (data_source_id, user_id, name, type, icon, position)
        VALUES ($1, $2, $3, $4, $5,
                COALESCE(
                    (SELECT MAX(position) + 1 FROM db_views
                     WHERE data_source_id = $1 AND user_id = $2),
                    0))
        RETURNING *
        """,
        data_source_id,
        user_id,
        body.name,
        body.type,
        body.icon,
    )
    return ViewResponse(**_row(row))


# `ViewUpdate`'s own declared field names — never request-supplied, so
# building a SET clause from them (below) isn't a SQL-injection surface,
# the same reasoning as the column allow-list in
# services/db/properties/columns.py.
_VIEW_UPDATABLE_FIELDS = ("name", "icon", "config", "filter", "sorts", "is_locked", "position")

# Migration 014's `db_views`: `icon` and `filter` are the only nullable
# columns among _VIEW_UPDATABLE_FIELDS — the other five (`name`, `config`,
# `sorts`, `is_locked`, `position`) are NOT NULL. Sending an explicit
# `null` for one of those five must not reach the database (review
# finding 2, fix round 2 — verified end-to-end as a real
# NotNullViolationError, not a theoretical concern).
_VIEW_NULLABLE_FIELDS = frozenset({"icon", "filter"})


@router.patch("/views/{view_id}", response_model=ViewResponse)
async def update_view(
    view_id: str,
    body: ViewUpdate,
    user_id: str = Depends(get_user_id),
    conn: asyncpg.Connection = Depends(get_conn),
) -> ViewResponse:
    """Partial update (task-5 review finding 1: column width/visibility/
    sort persistence "has nowhere to go" without this). Only fields
    actually present in the request body are touched
    (`model_dump(exclude_unset=True)`): `{"filter": null}` or
    `{"icon": null}` clears them (the only two nullable columns among the
    updatable fields), but an explicit `null` for any of the other five
    fields (`name`/`config`/`sorts`/`is_locked`/`position`, all `NOT
    NULL`) is dropped — a no-op for that one field, not a write — while
    the rest of the same request's fields still apply.

    `view_id`/`user_id` are always bound to the fixed placeholders `$1`/
    `$2`, regardless of how many optional fields are being set — so the
    WHERE clause's scope predicate is always the same literal text (see
    `tests/test_databases_router.py`'s guard test, which greps for exactly
    that), even though the SET clause's shape varies.
    """
    view_id = _parse_uuid_or_404(view_id, "view")
    updates = {
        field: value
        for field, value in body.model_dump(exclude_unset=True).items()
        if field in _VIEW_UPDATABLE_FIELDS
        and (value is not None or field in _VIEW_NULLABLE_FIELDS)
    }

    if not updates:
        row = await conn.fetchrow(
            """
            SELECT * FROM db_views WHERE id = $1 AND user_id = $2
            """,
            view_id,
            user_id,
        )
    else:
        set_sql = ", ".join(f"{field} = ${i + 3}" for i, field in enumerate(updates))
        row = await conn.fetchrow(
            f"""
            UPDATE db_views SET {set_sql}
            WHERE id = $1 AND user_id = $2
            RETURNING *
            """,
            view_id,
            user_id,
            *updates.values(),
        )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "view not found")
    return ViewResponse(**_row(row))
