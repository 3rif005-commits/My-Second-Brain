import re

import pytest
from pydantic import BaseModel

from services.db.properties.base import PropertyType, REGISTRY
from services.db.properties.columns import COLUMN_BACKED, ENGINE_STATE_COLUMNS

NOTES_COLUMNS = {
    "id","user_id","collection_id","title","content","content_text","source_type",
    "source_url","source_filename","topics","mastery_status","is_indexed","created_at",
    "updated_at","deleted_at","icon","is_favorited","last_viewed_at","position",
    "cover_image_url","is_public","fts","local_only","descriptor","descriptor_embedding",
}


def test_column_backed_names_are_real_columns():
    for prop in COLUMN_BACKED.values():
        assert prop.column in NOTES_COLUMNS, f"{prop.column} is not a notes column"


def test_column_backed_identifiers_are_safe():
    for prop in COLUMN_BACKED.values():
        assert re.fullmatch(r"[a-z_]+", prop.column)


# --- Additional coverage for base.py / columns.py, not given verbatim by the brief ---
# The design spec (§5) and plan prose describe "25 types", but research
# §F.1 ("Complete property type inventory") enumerates exactly 24 real,
# addressable property types (items 1-24) and explicitly resolves its own
# item 25 -- AI autofill -- as NOT a property type ("a modifier on an
# existing property", never a schema entry: research §F.1 line 360, and
# again at line 81). REGISTRY therefore holds the 24 real type keys; the
# "25" in the prose docs is not achievable without inventing a type that
# the research explicitly says does not exist. Flagged in the task report.
REAL_TYPE_KEYS = {
    "title", "rich_text", "number", "select", "multi_select", "status",
    "date", "people", "files", "checkbox", "url", "email", "phone_number",
    "formula", "relation", "rollup", "created_time", "created_by",
    "last_edited_time", "last_edited_by", "unique_id", "place",
    "verification", "button",
}


def test_registry_contains_all_real_type_keys():
    assert set(REGISTRY.keys()) == REAL_TYPE_KEYS


@pytest.mark.parametrize("key", sorted(REAL_TYPE_KEYS))
def test_registry_entries_satisfy_property_type_protocol(key):
    prop = REGISTRY[key]
    assert isinstance(prop, PropertyType)
    assert prop.key == key
    assert isinstance(prop.config_model, type) and issubclass(prop.config_model, BaseModel)

    # Every method is callable and returns the shape the protocol promises.
    prop.default()
    assert isinstance(prop.is_empty(None), bool)

    ops = prop.operators()
    assert isinstance(ops, dict) and ops  # at least one operator per type
    assert all(isinstance(name, str) for name in ops)

    aggs = prop.aggregations()
    assert isinstance(aggs, set)

    # coerce_write must at least accept None without raising.
    prop.coerce_write(None)


def test_column_backed_never_touches_engine_state_columns():
    used_columns = {prop.column for prop in COLUMN_BACKED.values()}
    assert not (used_columns & ENGINE_STATE_COLUMNS)


def test_engine_state_columns_match_spec():
    # Spec §6: "What stays hardcoded: content, content_text, fts,
    # descriptor_embedding, local_only, is_public, position, collection_id."
    assert ENGINE_STATE_COLUMNS == {
        "content", "content_text", "fts", "descriptor_embedding",
        "local_only", "is_public", "position", "collection_id",
    }
