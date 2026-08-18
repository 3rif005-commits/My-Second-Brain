"""backend/services/db/rows.py — the transactional core of "create a database row" (a
Notion-style row IS a note: `db_row_props.note_id` is a FK to `notes.id`), extracted out
of `routers/databases.py`'s `create_row` (task-37, Milestone 12) so Task 38's automations
(`add_page_to`/`edit_pages_in`) and this task's own template instantiation
(`services/db/templates.py`'s `instantiate_template`) can create rows without going
through HTTP.

`create_row_core` is `create_row`'s entire previous transactional body, byte-identical
for every existing caller (title stays `"Untitled"`, properties stays `{}`, content stays
`[]`) — the router's `create_row` is now a thin wrapper: validate the data source exists
and is owned by `user_id` (and, per task-37 decision 3, look up a default template),
then call this.

`update_row_property` (the sibling endpoint on the same table) was deliberately NOT
extracted in this task — its transactional body is materially more complex (relation-type
rejection, a wrapper-shape check, the Milestone 7 date-shift cascade, the same title-sync
convention this module's own title handling below reuses) and has no out-of-HTTP caller
yet. Task 38 will extract it when `add_page_to`/`edit_pages_in` (automation actions that
edit an EXISTING row) actually need to call it without HTTP — see task-37-report.md.
"""
from __future__ import annotations

from typing import Any

import asyncpg

from models.database import RowResponse
from services.db import recompute


async def create_row_core(
    conn: asyncpg.Connection,
    user_id: str,
    data_source_id: str,
    *,
    title: str = "Untitled",
    properties: dict[str, Any] | None = None,
    content: list[Any] | None = None,
) -> RowResponse:
    """Create one row (a `notes` row + its `db_row_props` companion, spec Q2: "a database
    row IS a note") in one transaction, then recompute its formula/rollup properties inside
    the SAME transaction — copied verbatim from `create_row`'s previous inline body
    (`routers/databases.py`, pre-task-37), not reimplemented.

    `properties`/`content` default to `{}`/`[]` — the plain "+ New row" path (no template)
    passes neither, so this reproduces `create_row`'s exact pre-task-37 INSERTs (an
    explicit `properties = {}`/`content = []` write is byte-identical to relying on the
    columns' own defaults, since that IS both columns' default — `supabase/migrations/
    001_initial_schema.sql`'s `notes.content` and `db_row_props.properties`).

    Title / title-property sync (task-37-brief.md decision 4): a caller (template
    instantiation) MAY capture a `title`-typed property inside `properties` — when it
    does, `notes.title` reflects that captured value, same as `update_row_property`'s
    existing title<->`notes.title` sync convention (`routers/databases.py`'s
    `update_row_property`, the `if prop_row["type"] == "title":` block) — reused here
    rather than reinvented, since the wrapper's own `"type"` tag (spec §3.3) already
    says "title" without needing a `db_properties` lookup. The explicit `title` kwarg
    (still `"Untitled"` for the ordinary no-template path) is the fallback when
    `properties` carries no title value.
    """
    properties = properties if properties is not None else {}
    content = content if content is not None else []

    for value in properties.values():
        if isinstance(value, dict) and value.get("type") == "title":
            title = value.get("title") or title
            break

    async with conn.transaction():
        note_row = await conn.fetchrow(
            """
            INSERT INTO notes (user_id, title, content)
            VALUES ($1, $2, $3)
            RETURNING id
            """,
            user_id,
            title,
            content,
        )
        # Without an explicit position, every created row defaults to 0 (migration
        # 014), so list_rows's `ORDER BY position` is an unbroken tie among them and
        # rows can visibly reshuffle between GETs once 2+ exist. Append to the end.
        row = await conn.fetchrow(
            """
            INSERT INTO db_row_props (note_id, data_source_id, user_id, properties, position)
            VALUES ($1, $2, $3, $4,
                    COALESCE(
                        (SELECT MAX(position) + 1 FROM db_row_props
                         WHERE data_source_id = $2 AND user_id = $3),
                        0))
            RETURNING note_id, properties
            """,
            note_row["id"],
            data_source_id,
            user_id,
            properties,
        )
        # Milestone 8 (task-28-brief.md §3): "row write (update_row_property, create_row)
        # -> incremental recompute of that row" -- inside the same transaction as the
        # insert. If recompute raises, the write rolls back.
        await recompute.recompute_row(conn, user_id, data_source_id, str(row["note_id"]))
    return RowResponse(id=str(row["note_id"]), properties=row["properties"])
