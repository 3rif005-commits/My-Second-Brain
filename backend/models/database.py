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
    database it's looking at.
    """

    rows: list[dict[str, Any]]
