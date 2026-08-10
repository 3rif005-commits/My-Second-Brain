"""Pydantic models for Notion-style databases (Milestone 2).

Spec: docs/superpowers/specs/2026-08-08-notion-databases-design.md §3, §6, §10.
Plan: docs/plans/2026-08-08-notion-databases.md, Milestone 2.

Follows this repo's `*Base`/`*Create`/`*Response` naming convention
(`models/note.py`). `*Response` field names are chosen to match their
`db_*` table's column names exactly, so `routers/databases.py` can build
one straight from an `asyncpg.Record` with `Model(**dict(row))` — no
per-field mapping.

The "All Notes" virtual source (spec §6) reuses these same response
models — it is never a real row in `db_databases`/`db_data_sources`/
`db_properties`/`db_views`, but its synthesized in-memory shape is built
from these classes too, so the frontend never needs to special-case its
response shape (only `DataSourceResponse.is_virtual`).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel


class DatabaseCreate(BaseModel):
    title: str = "Untitled"
    icon: str | None = None


class DatabaseResponse(BaseModel):
    id: str
    user_id: str
    title: str
    description: list[Any] = []
    icon: str | None = None
    cover_url: str | None = None
    is_inline: bool = False
    parent_note_id: str | None = None
    is_locked: bool = False
    position: int = 0
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


class DataSourceResponse(BaseModel):
    id: str
    database_id: str
    user_id: str
    name: str
    system_kind: Literal["notes"] | None = None
    position: int = 0
    created_at: datetime
    # Not a `db_data_sources` column — True only for the synthesized "All
    # Notes" source (spec §6), so the frontend can special-case rendering
    # (e.g. hide "add property"/"rename"/"delete database") with one flag
    # instead of comparing ids against the well-known "all-notes" slug.
    is_virtual: bool = False


class PropertyCreate(BaseModel):
    name: str
    type: str
    config: dict[str, Any] = {}
    description: str | None = None


class PropertyRename(BaseModel):
    name: str


class PropertyResponse(BaseModel):
    id: str
    data_source_id: str
    user_id: str
    key: str
    name: str
    type: str
    config: dict[str, Any] = {}
    description: str | None = None
    storage: Literal["jsonb", "column"] = "jsonb"
    column_name: str | None = None
    result_type: str | None = None
    is_volatile: bool = False
    position: int = 0
    created_at: datetime


class ViewResponse(BaseModel):
    id: str
    data_source_id: str
    user_id: str
    name: str
    icon: str | None = None
    type: str
    config: dict[str, Any] = {}
    filter: dict[str, Any] | None = None
    sorts: list[Any] = []
    is_locked: bool = False
    position: int = 0


class ViewUpdate(BaseModel):
    """Partial update for `PATCH /db/views/{view_id}`. Only fields present
    in the request body are touched (`model_dump(exclude_unset=True)` in
    the router). Migration 014's `db_views` has two nullable columns
    (`icon`, `filter`) and five `NOT NULL` ones (`name`, `config`, `sorts`,
    `is_locked`, `position`) — sending `null` explicitly for `icon` or
    `filter` clears them, but sending `null` for any of the five `NOT
    NULL` fields is a no-op for that field (the router drops it before it
    ever reaches the database) rather than a `NotNullViolationError` 500;
    the rest of the same request's fields still apply. No validation of
    `config`/`filter`/`sorts` shape here: Milestone 2 has no filter/sort
    UI or compiler yet (Milestone 3), so this is deliberately a JSONB
    pass-through — shape enforcement is future work, not a regression from
    not having it now.
    """

    name: str | None = None
    icon: str | None = None
    config: dict[str, Any] | None = None
    filter: dict[str, Any] | None = None
    sorts: list[Any] | None = None
    is_locked: bool | None = None
    position: int | None = None


class DatabaseDetailResponse(BaseModel):
    """The shape returned by `POST /db/databases` and `GET
    /db/databases/{database_id}` for both real and virtual databases."""

    database: DatabaseResponse
    data_source: DataSourceResponse
    properties: list[PropertyResponse]
    views: list[ViewResponse]


class RowsResponse(BaseModel):
    """`GET /db/data-sources/{data_source_id}/rows`.

    `rows[i]["properties"]` is keyed by each property's identifier —
    `db_properties.key` (8-char base62) for an ordinary data source,
    `COLUMN_BACKED[name].column` (a `notes` column name) for the virtual
    "All Notes" source — so a generic renderer can always do
    `row["properties"][property.key]` regardless of which kind of
    database it's looking at. Every value, for both kinds of source, is
    spec §3.3's discriminated wrapper (`{"type": "status", "status":
    "learning"}`), not a bare scalar — so a cell renderer never needs a
    virtual-source branch for the *value* shape either, only for whether
    writes are possible at all (`DataSourceResponse.is_virtual`).
    """

    rows: list[dict[str, Any]]


class RowResponse(BaseModel):
    """A single row, same `properties` shape as one entry of
    `RowsResponse.rows` — returned by `PATCH .../rows/{note_id}`."""

    id: str
    properties: dict[str, Any]


class QueryRequest(BaseModel):
    """`POST /db/data-sources/{data_source_id}/query` body (task-15, wiring up Milestone
    3's filter/sort compiler and Milestone 4's grouping to an HTTP endpoint for the first
    time). `filter`/`sorts`/`group_by`/`sub_group_by` are deliberately permissive
    dict/list-of-dict shapes here, not the `services.db.query.ast`/`grouping` types
    themselves — the router parses them (`ast.parse_filter`, `SortSpec(**s)`,
    `GroupBySpec(**group_by)`) so a malformed filter/group surfaces as the compiler's own
    `FilterValidationError` -> HTTP 400 (spec §8.2's "unknown key -> 400, never dropped"),
    not as a generic 422 from Pydantic validating a nested discriminated union at this
    layer instead.

    `group_by`/`sub_group_by` are raw `grouping.GroupBySpec`-shaped dicts (`property_key`
    required, `mode`/`start_day_of_week`/`range_start`/`range_end`/`range_size`/
    `hide_empty_groups` all optional — see `services/db/query/grouping.py`)."""

    filter: dict[str, Any] | None = None
    sorts: list[dict[str, Any]] = []
    page_size: int = 50
    offset: int = 0
    group_by: dict[str, Any] | None = None
    sub_group_by: dict[str, Any] | None = None


class GroupResult(BaseModel):
    """One entry of `QueryResponse.groups` — the JSON-serializable mirror of
    `services.db.query.grouping.Group`, with `row_count` precomputed (`len(rows)`) so the
    frontend never needs to count client-side. `label` is *not* always `Group.label`
    verbatim: for a `select`/`status` group, the router resolves it against the property's
    `db_properties.config.options` list (task-15-brief.md's "group labels are opaque ids"
    fix — see `routers/databases.py`'s `_resolve_group_label`), falling back to
    `Group.label` (itself the raw stored option id) when no configured option matches.

    `subgroups` is `None` whenever no `sub_group_by` was requested, and — same as
    `grouping.Group` — always `None` on a subgroup itself (sub-grouping is exactly two
    levels, never three)."""

    key: str
    label: str
    row_count: int
    rows: list[dict[str, Any]]
    subgroups: list["GroupResult"] | None = None


GroupResult.model_rebuild()


class QueryResponse(BaseModel):
    """`POST .../query`'s response. Exactly one of `rows`/`groups` is ever populated —
    mirroring the request's own `group_by`/no-`group_by` branch — and the route serializes
    with `response_model_exclude_none=True` so the *other* field is omitted from the JSON
    entirely rather than sent as an explicit `null`: `body.group_by is None` ->
    `{"rows": [...]}` (byte-identical shape to `RowsResponse`, spec's own "this endpoint is
    a superset of list_rows, not a replacement"); `body.group_by` set -> `{"groups":
    [...]}`."""

    rows: list[dict[str, Any]] | None = None
    groups: list[GroupResult] | None = None


class ViewCreate(BaseModel):
    """`POST /db/data-sources/{data_source_id}/views` body — the first way to create a
    non-default view (`create_database` mints exactly one table view; every other view
    type M6's frontend needs, Board/Gallery/List/Feed, has had nowhere to come from until
    now). `type` is deliberately unvalidated beyond "non-empty string" (Pydantic's own
    `str` requirement) — no closed enum here, same reasoning as `PropertyCreate.type`
    accepting an unknown-but-syntactically-valid type elsewhere in this file: the frontend
    is what actually renders a type-specific component, and a future milestone (Timeline,
    Chart, ...) shouldn't have to come back and extend a closed set."""

    name: str = "New view"
    type: str
    icon: str | None = None


class RowPropertyUpdate(BaseModel):
    """`PATCH /db/data-sources/{data_source_id}/rows/{note_id}` body: write
    one property's value. `value` is the full spec §3.3 wrapper (e.g.
    `{"type": "status", "status": "done"}`), matching what's stored and
    what `RowsResponse`/`RowResponse` return — not a bare scalar.

    `value` is required (no default): a request that omits it is a 422 at
    this layer, not a `NotNullViolationError` 500 once it reaches
    `jsonb_set` (review finding 1, fix round 2 — `db_row_props.properties`
    is `NOT NULL`, and `jsonb_set(properties, path, NULL, true)` sets the
    *entire column* to SQL NULL, not just the targeted key). An explicit
    top-level `null` (`{"property_key": "...", "value": null}`) is still
    legal and is handled by the router as "clear/unset this property"
    (`properties - key`), which is a different operation from a wrapper
    whose *inner* value is null (e.g. `{"type": "number", "number":
    null}`, a normal dict — routed through `jsonb_set` unchanged)."""

    property_key: str
    value: Any
