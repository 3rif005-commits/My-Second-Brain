"""Column-backed properties: the fixed allow-list that lets existing
`notes` columns (`topics`, `mastery_status`, `source_type`, `source_url`,
...) become `storage='column'` properties instead of being migrated into
generic JSONB storage.

Spec: docs/superpowers/specs/2026-08-08-notion-databases-design.md §6.

`db_properties.column_name` (Milestone 2 onward) is validated against this
**fixed Python allow-list** -- never against the request, never against
the database catalogue. This is the entire defence against a
column-injection attack: a `column_name` that doesn't appear as a value
here is rejected outright, so no user input ever reaches a SQL identifier
position.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ColumnProp:
    """One allow-listed `notes` column exposed as a property.

    `column` is the real `notes` column name (validated by
    `test_column_backed_identifiers_are_safe` to be a plain lowercase SQL
    identifier — never derived from user input). `type` is the property
    type it presents as; it is a display/behaviour hint for Milestone 2's
    property CRUD and does not have to be a `REGISTRY` key verbatim (e.g.
    `icon` presents as plain `"text"`, and `topics` presents as
    `"multi_select_array"` to flag its native-array — not JSONB — storage).
    """

    column: str
    type: str


# Spec §6, reproduced exactly. This yields the built-in "All Notes" virtual
# data source (`system_kind='notes'`): table/board/gallery views over the
# entire existing brain on day one of Milestone 2, with zero rows migrated.
COLUMN_BACKED: dict[str, ColumnProp] = {
    "title":          ColumnProp("title",          "title"),
    "icon":           ColumnProp("icon",           "text"),
    "topics":         ColumnProp("topics",         "multi_select_array"),
    "mastery_status": ColumnProp("mastery_status", "status"),
    "source_type":    ColumnProp("source_type",    "select"),
    "source_url":     ColumnProp("source_url",     "url"),
    "is_favorited":   ColumnProp("is_favorited",   "checkbox"),
    "created_at":     ColumnProp("created_at",     "created_time"),
    "updated_at":     ColumnProp("updated_at",     "last_edited_time"),
}

# Spec §6: "What stays hardcoded: content, content_text, fts,
# descriptor_embedding, local_only, is_public, position, collection_id.
# These are engine state, not user-facing properties." Never eligible for
# COLUMN_BACKED, regardless of future changes to this file.
ENGINE_STATE_COLUMNS: frozenset[str] = frozenset({
    "content",
    "content_text",
    "fts",
    "descriptor_embedding",
    "local_only",
    "is_public",
    "position",
    "collection_id",
})

assert not (
    {prop.column for prop in COLUMN_BACKED.values()} & ENGINE_STATE_COLUMNS
), "COLUMN_BACKED must never expose an engine-state column"
