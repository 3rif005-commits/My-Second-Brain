"""Tests for services/db/query/compiler.py and services/db/query/builder.py:
turning Task 11's filter AST into executable SQL, resolving property keys,
compiling sorts, and assembling the two query-builder modes (All Notes vs.
an ordinary data source).

Runs against the local pgtest harness (localhost:55432, migrations 001-019
applied — see repo root's `scripts/pgtest/up.sh`/`apply.sh`) through the
transaction-wrapped `db_conn`/`test_user` fixtures (tests/conftest.py),
rolled back on teardown. NEVER touches `core.config.settings.database_url`
(the real Supabase project).
"""
from __future__ import annotations

import re
import uuid

import asyncpg
import pytest
from fastapi import HTTPException

from services.db.properties.base import REGISTRY, SqlContext, SqlFragment
from services.db.properties.columns import COLUMN_BACKED
from services.db.query.ast import (
    FilterCondition,
    FilterGroup,
    Pagination,
    SortSpec,
    parse_filter,
)
from services.db.query.operators import TYPE_OPERATORS, FilterValidationError
from services.db.query.compiler import (
    PropertyLookup,
    compile_filter,
    compile_sorts,
    filter_validation_error_to_http,
    renumber,
)
from services.db.query.builder import QueryBuilder


# ---------------------------------------------------------------------------
# renumber()
# ---------------------------------------------------------------------------


def test_renumber_shifts_placeholders_and_keeps_params_order():
    frag = SqlFragment("a = $1 AND b = $2", ("x", "y"))
    shifted = renumber(frag, start=3)
    assert shifted.sql == "a = $3 AND b = $4"
    assert shifted.params == ("x", "y")


def test_renumber_start_1_is_a_noop_on_sql_text():
    frag = SqlFragment("a = $1", ("x",))
    shifted = renumber(frag, start=1)
    assert shifted.sql == "a = $1"


def test_renumber_handles_double_digit_placeholders_without_collision():
    # 9 params -> $9, shifting by +5 must produce $14, not something that
    # collides with an intermediate $1 substitution.
    sql = " AND ".join(f"c{i} = ${i}" for i in range(1, 10))
    frag = SqlFragment(sql, tuple(range(1, 10)))
    shifted = renumber(frag, start=6)
    expected = " AND ".join(f"c{i} = ${i + 5}" for i in range(1, 10))
    assert shifted.sql == expected


def test_renumber_no_params_leaves_sql_untouched():
    frag = SqlFragment("TRUE", ())
    shifted = renumber(frag, start=5)
    assert shifted.sql == "TRUE"
    assert shifted.params == ()


# ---------------------------------------------------------------------------
# compile_filter — resolution, unknown keys, renumbering through groups
# ---------------------------------------------------------------------------

_TITLE_LOOKUP = {"title": PropertyLookup(type="title", storage="jsonb", key="a1b2c3d4")}
_TWO_PROP_LOOKUP = {
    "title": PropertyLookup(type="title", storage="jsonb", key="a1b2c3d4"),
    "num": PropertyLookup(type="number", storage="jsonb", key="z9y8x7w6"),
}


def test_compile_filter_none_returns_true_with_no_params():
    frag = compile_filter(None, _TITLE_LOOKUP, user_id="u-1", alias="p")
    assert frag.sql == "TRUE"
    assert frag.params == ()


def test_compile_filter_single_condition():
    node = FilterCondition(type="condition", property="title", operator="equals", value="hi")
    frag = compile_filter(node, _TITLE_LOOKUP, user_id="u-1", alias="p")
    assert frag.params == ("hi",)
    assert "$1" in frag.sql


def test_compile_filter_unknown_key_raises():
    node = FilterCondition(type="condition", property="nope", operator="equals", value="hi")
    with pytest.raises(FilterValidationError):
        compile_filter(node, _TITLE_LOOKUP, user_id="u-1", alias="p")


def test_compile_filter_unknown_key_nested_in_group_raises():
    node = FilterGroup(
        type="group",
        op="and",
        children=[
            FilterCondition(type="condition", property="title", operator="equals", value="hi"),
            FilterGroup(
                type="group",
                op="or",
                children=[
                    FilterCondition(type="condition", property="ghost", operator="equals", value="x"),
                ],
            ),
        ],
    )
    with pytest.raises(FilterValidationError):
        compile_filter(node, _TITLE_LOOKUP, user_id="u-1", alias="p")


def test_compile_filter_group_renumbers_children_params_contiguously():
    node = FilterGroup(
        type="group",
        op="and",
        children=[
            FilterCondition(type="condition", property="title", operator="equals", value="hi"),
            FilterCondition(type="condition", property="num", operator="greater_than", value=10),
        ],
    )
    frag = compile_filter(node, _TWO_PROP_LOOKUP, user_id="u-1", alias="p")
    assert frag.params == ("hi", 10)
    assert "$1" in frag.sql and "$2" in frag.sql
    assert "$3" not in frag.sql
    assert frag.sql.startswith("(") and frag.sql.endswith(")")


def test_filter_validation_error_to_http_maps_to_400():
    exc = filter_validation_error_to_http(FilterValidationError("bad"))
    assert isinstance(exc, HTTPException)
    assert exc.status_code == 400


# ---------------------------------------------------------------------------
# compile_sorts
# ---------------------------------------------------------------------------


def test_compile_sorts_empty_list_is_empty_fragment():
    frag = compile_sorts([], _TITLE_LOOKUP, alias="p")
    assert frag.sql == ""


def test_compile_sorts_unknown_key_raises():
    with pytest.raises(FilterValidationError):
        compile_sorts([SortSpec(property="ghost")], _TITLE_LOOKUP, alias="p")


def test_compile_sorts_uses_registry_sql_order():
    frag = compile_sorts([SortSpec(property="title", direction="asc")], _TITLE_LOOKUP, alias="p")
    expected = REGISTRY["title"].sql_order(
        SqlContext(key="a1b2c3d4", alias="p", storage="jsonb"), "asc"
    ).sql
    assert frag.sql == expected


def test_compile_sorts_joins_multiple_with_comma():
    frag = compile_sorts(
        [SortSpec(property="title", direction="asc"), SortSpec(property="num", direction="desc")],
        _TWO_PROP_LOOKUP,
        alias="p",
    )
    assert ", " in frag.sql
    assert frag.sql.count(",") == 1


def test_compile_sorts_unresolvable_registry_type_raises_filter_validation_error_not_keyerror():
    # A PropertyLookup.type that isn't a real REGISTRY key (corrupt data, a
    # typo) must fail the same way an unknown property key does — a bare
    # `REGISTRY[lookup.type]` KeyError would surface as an uncaught 500
    # instead of the FilterValidationError -> 400 every other bad-input path
    # in this module gives.
    bogus_lookup = {"x": PropertyLookup(type="not_a_real_type", storage="jsonb", key="a1b2c3d4")}
    with pytest.raises(FilterValidationError):
        compile_sorts([SortSpec(property="x", direction="asc")], bogus_lookup, alias="p")


def test_compile_sorts_accepts_formula_and_rollup_types_unlike_compile_filter():
    # Deliberate asymmetry with compile_filter (see compiler.py's
    # compile_sorts docstring): formula/rollup/place/button are absent from
    # TYPE_OPERATORS (not filterable pre-Milestone-8, or never filterable),
    # but all 4 still have a working REGISTRY entry, so sorting by one is
    # not rejected here.
    lookup = {"f": PropertyLookup(type="formula", storage="jsonb", key="a1b2c3d4")}
    frag = compile_sorts([SortSpec(property="f", direction="asc")], lookup, alias="p")
    assert frag.sql


# ---------------------------------------------------------------------------
# Depth 10 allowed / 11 rejected, end to end through compile_filter
# ---------------------------------------------------------------------------


def _nest_groups(depth: int, key: str) -> dict:
    node = {"type": "condition", "property": key, "operator": "is_empty", "value": None}
    for _ in range(depth):
        node = {"type": "group", "op": "and", "children": [node]}
    return node


def test_compile_filter_depth_10_compiles():
    node = parse_filter(_nest_groups(10, "title"))
    frag = compile_filter(node, _TITLE_LOOKUP, user_id="u-1", alias="p")
    assert frag.sql


def test_compile_filter_depth_11_rejected_at_parse():
    with pytest.raises(FilterValidationError):
        parse_filter(_nest_groups(11, "title"))


# ---------------------------------------------------------------------------
# QueryBuilder._scope() guard
# ---------------------------------------------------------------------------


def test_scope_all_notes_mode_has_user_id_predicate_and_excludes_deleted():
    qb = QueryBuilder(user_id="u-1", data_source_id=None, properties=_TITLE_LOOKUP)
    scope = qb._scope()
    assert "user_id = $1" in scope.sql
    assert "deleted_at IS NULL" in scope.sql
    assert scope.params == ("u-1",)


def test_scope_ordinary_mode_has_user_id_and_data_source_and_deleted_at():
    qb = QueryBuilder(user_id="u-1", data_source_id="ds-1", properties=_TITLE_LOOKUP)
    scope = qb._scope()
    assert "user_id = $1" in scope.sql
    assert "data_source_id = $2" in scope.sql
    assert "n.deleted_at IS NULL" in scope.sql
    assert scope.params == ("u-1", "ds-1")


def test_build_all_notes_mode_sql_contains_scope():
    qb = QueryBuilder(user_id="u-1", data_source_id=None, properties=_TITLE_LOOKUP)
    frag = qb.build(None, [], Pagination())
    assert "user_id = $1" in frag.sql
    assert "FROM notes n" in frag.sql


def test_build_ordinary_mode_sql_contains_scope_and_join():
    qb = QueryBuilder(user_id="u-1", data_source_id="ds-1", properties=_TITLE_LOOKUP)
    frag = qb.build(None, [], Pagination())
    assert "user_id = $1" in frag.sql
    assert "data_source_id = $2" in frag.sql
    assert "JOIN notes n ON n.id = p.note_id" in frag.sql


def test_build_always_appends_row_identity_tiebreaker():
    qb = QueryBuilder(user_id="u-1", data_source_id=None, properties=_TITLE_LOOKUP)
    frag = qb.build(None, [], Pagination())
    assert "n.id ASC" in frag.sql


def test_build_pagination_params_bound_not_interpolated():
    qb = QueryBuilder(user_id="u-1", data_source_id=None, properties=_TITLE_LOOKUP)
    frag = qb.build(None, [], Pagination(page_size=17, offset=34))
    assert 17 in frag.params
    assert 34 in frag.params
    assert "17" not in frag.sql
    assert "34" not in frag.sql


# ---------------------------------------------------------------------------
# _scope() guard sweep — every SqlFragment QueryBuilder.build() can produce
# must scope on user_id (spec §8.3), not just the empty-filter/empty-sorts
# corner the two `test_build_*_mode_sql_contains_scope` tests above happen
# to cover. Same technique test_databases_router.py's tenancy-guard sweep
# uses (tests/test_databases_router.py:876-926): grep the compiled SQL for
# a real `user_id = $N` predicate, not just a substring mention, plus a
# count floor so the sweep itself can't silently shrink to near-nothing.
# That existing sweep enumerates SQL statements straight from source
# (routers/databases.py, services/db/views.py); builder.py's scope isn't a
# static literal — it's assembled by `_scope()` at call time — so this
# sweep instead parametrizes the actual shape space `build()` accepts and
# inspects each call's output, which is the closest equivalent for a
# builder rather than hand-written SQL.
# ---------------------------------------------------------------------------

_SCOPE_PREDICATE_RE = re.compile(r"user_id\s*=\s*\$\d+")

_SCOPE_SWEEP_ALL_NOTES_PROPS = {
    "title": PropertyLookup(type="title", storage="column", key="title"),
}
_SCOPE_SWEEP_ORDINARY_PROPS = {
    "title": PropertyLookup(type="title", storage="jsonb", key="a1b2c3d4"),
}


def _scope_sweep_simple_filter() -> FilterCondition:
    return FilterCondition(type="condition", property="title", operator="is_not_empty", value=None)


def _scope_sweep_nested_group_filter() -> FilterGroup:
    return FilterGroup(
        type="group",
        op="and",
        children=[
            FilterCondition(type="condition", property="title", operator="is_not_empty", value=None),
            FilterGroup(
                type="group",
                op="or",
                children=[
                    FilterCondition(type="condition", property="title", operator="is_empty", value=None),
                ],
            ),
        ],
    )


def _build_scope_sweep_cases() -> list:
    # Both modes x {no filter, simple filter, nested-group filter} x
    # {no sorts, with sorts}: 2 x 3 x 2 = 12 cases.
    modes = [
        ("all_notes", None, _SCOPE_SWEEP_ALL_NOTES_PROPS),
        ("ordinary", "ds-1", _SCOPE_SWEEP_ORDINARY_PROPS),
    ]
    filters = [
        ("no_filter", lambda: None),
        ("simple_filter", _scope_sweep_simple_filter),
        ("nested_group_filter", _scope_sweep_nested_group_filter),
    ]
    sorts_variants = [
        ("no_sorts", []),
        ("with_sorts", [SortSpec(property="title", direction="asc")]),
    ]
    cases = []
    for mode_name, data_source_id, properties in modes:
        for filter_name, filter_fn in filters:
            for sorts_name, sorts in sorts_variants:
                cases.append(
                    pytest.param(
                        data_source_id, properties, filter_fn(), sorts,
                        id=f"{mode_name}-{filter_name}-{sorts_name}",
                    )
                )
    return cases


_SCOPE_SWEEP_CASES = _build_scope_sweep_cases()


def test_scope_sweep_case_count_floor():
    # Same discipline as test_databases_router.py's own
    # `assert len(statements) >= 8` — a floor so this sweep can't silently
    # regress to near-vacuous coverage if a case is accidentally dropped.
    assert len(_SCOPE_SWEEP_CASES) >= 8


@pytest.mark.parametrize("data_source_id,properties,filter_node,sorts", _SCOPE_SWEEP_CASES)
def test_build_always_scopes_on_user_id(data_source_id, properties, filter_node, sorts):
    qb = QueryBuilder(user_id="u-1", data_source_id=data_source_id, properties=properties)
    frag = qb.build(filter_node, sorts, Pagination())
    assert _SCOPE_PREDICATE_RE.search(frag.sql), f"missing user_id = $N predicate:\n{frag.sql}"


# ===========================================================================
# Harness-backed tests
# ===========================================================================


async def _make_ordinary_source(db_conn, user_id):
    db_row = await db_conn.fetchrow(
        "INSERT INTO db_databases (user_id, title) VALUES ($1, 'T') RETURNING id", user_id
    )
    ds_row = await db_conn.fetchrow(
        "INSERT INTO db_data_sources (database_id, user_id, name) VALUES ($1, $2, 'Default') RETURNING id",
        db_row["id"], user_id,
    )
    return str(ds_row["id"])


async def _insert_note(db_conn, user_id, *, title="Note"):
    note = await db_conn.fetchrow(
        "INSERT INTO notes (user_id, title) VALUES ($1, $2) RETURNING id",
        user_id, title,
    )
    return str(note["id"])


# task-12 finding (report.md "Concerns"): `unique_id`'s 6 numeric comparison
# operators (equals/does_not_equal/greater_than/less_than/gte/lte) compile
# to syntactically valid SQL that always raises at execution time. Root
# cause is in properties/base.py (out of scope for this task to modify):
# `_VALUE_SHAPES` gives `"number"` a `::double precision` cast but has no
# entry for `"unique_id"`, so `_GenericProperty._value_sql` falls back to a
# bare, uncast `->> 'unique_id'` (text) hop. Comparing that text expression
# to a bound Python int makes Postgres infer the placeholder's type as
# `text`, and asyncpg refuses to encode an int as text
# (`asyncpg.exceptions.DataError: expected str, got int`) — even though
# operators.py deliberately grants unique_id the full 8 numeric operators
# ("schema is permissive", operators.py's own module docstring). is_empty/
# is_not_empty don't bind a value, so those 2 of the 8 are unaffected.
_UNIQUE_ID_BROKEN_NUMERIC_OPS = {
    "equals", "does_not_equal", "greater_than", "less_than",
    "greater_than_or_equal_to", "less_than_or_equal_to",
}


async def test_full_operator_matrix_compiles_and_executes(db_conn, test_user):
    """All ~131 (type x operator) pairs compile to SQL that actually
    executes against the real schema, one condition per pair."""
    data_source_id = await _make_ordinary_source(db_conn, test_user)
    executed = 0
    for prop_type, ops in TYPE_OPERATORS.items():
        lookup = {"prop": PropertyLookup(type=prop_type, storage="jsonb", key="a1b2c3d4")}
        for operator_name, operator in ops.items():
            if prop_type == "unique_id" and operator_name in _UNIQUE_ID_BROKEN_NUMERIC_OPS:
                continue
            sample = _sample_for(operator.arg_type)
            node = FilterCondition(
                type="condition", property="prop", operator=operator_name, value=sample
            )
            qb = QueryBuilder(user_id=test_user, data_source_id=data_source_id, properties=lookup)
            frag = qb.build(node, [], Pagination())
            # Must actually run without raising against the real schema.
            await db_conn.fetch(frag.sql, *frag.params)
            executed += 1
    # 131 total pairs - 6 known-broken unique_id numeric ops (see above) =
    # 125. A floor, not `== 125`, so a future TYPE_OPERATORS addition
    # doesn't need this test edited — but if TYPE_OPERATORS were ever
    # emptied by a refactor, this catches it rather than passing vacuously.
    assert executed >= 125


@pytest.mark.parametrize("operator_name", sorted(_UNIQUE_ID_BROKEN_NUMERIC_OPS))
async def test_unique_id_numeric_operators_currently_fail_at_execution(db_conn, test_user, operator_name):
    """Documents the gap above for all 6 excluded ops (not just one), so the
    pin and the `test_full_operator_matrix_compiles_and_executes` exclusion
    set can't silently drift apart. If this starts failing because a given
    op's query now succeeds, that's progress — update both together."""
    data_source_id = await _make_ordinary_source(db_conn, test_user)
    lookup = {"prop": PropertyLookup(type="unique_id", storage="jsonb", key="a1b2c3d4")}
    node = FilterCondition(type="condition", property="prop", operator=operator_name, value=1)
    qb = QueryBuilder(user_id=test_user, data_source_id=data_source_id, properties=lookup)
    frag = qb.build(node, [], Pagination())
    with pytest.raises(asyncpg.exceptions.DataError):
        await db_conn.fetch(frag.sql, *frag.params)


def _sample_for(arg_type: str):
    return {
        "none": None,
        "str": "needle",
        "num": 1,
        "bool": True,
        "str_or_list": "needle",
        "date": "2026-08-10",
        "uuid": "12345678-1234-5678-1234-567812345678",
        "uuid_or_me": "me",
        "verification_status": "verified",
    }[arg_type]


async def test_native_array_topics_end_to_end_all_notes_mode(db_conn, test_user):
    note1 = await _insert_note(db_conn, test_user, title="Has topic")
    await db_conn.execute("UPDATE notes SET topics = $1 WHERE id = $2", ["python"], note1)
    note2 = await _insert_note(db_conn, test_user, title="No topic")

    properties = {
        prop.column: PropertyLookup(type=prop.type, storage="column", key=prop.column)
        for prop in COLUMN_BACKED.values()
    }
    node = FilterCondition(type="condition", property="topics", operator="contains", value="python")
    qb = QueryBuilder(user_id=test_user, data_source_id=None, properties=properties)
    frag = qb.build(node, [], Pagination())
    rows = await db_conn.fetch(frag.sql, *frag.params)
    ids = {str(r["id"]) for r in rows}
    assert ids == {note1}


async def test_semantic_correctness_number_equals(db_conn, test_user):
    data_source_id = await _make_ordinary_source(db_conn, test_user)
    matching_note = await _insert_note(db_conn, test_user, title="42")
    other_note = await _insert_note(db_conn, test_user, title="7")
    await db_conn.execute(
        """
        INSERT INTO db_row_props (note_id, data_source_id, user_id, properties)
        VALUES ($1, $2, $3, $4)
        """,
        matching_note, data_source_id, test_user, {"a1b2c3d4": {"type": "number", "number": 42}},
    )
    await db_conn.execute(
        """
        INSERT INTO db_row_props (note_id, data_source_id, user_id, properties)
        VALUES ($1, $2, $3, $4)
        """,
        other_note, data_source_id, test_user, {"a1b2c3d4": {"type": "number", "number": 7}},
    )

    lookup = {"num": PropertyLookup(type="number", storage="jsonb", key="a1b2c3d4")}
    node = FilterCondition(type="condition", property="num", operator="equals", value=42)
    qb = QueryBuilder(user_id=test_user, data_source_id=data_source_id, properties=lookup)
    frag = qb.build(node, [], Pagination())
    rows = await db_conn.fetch(frag.sql, *frag.params)
    note_ids = {str(r["note_id"]) for r in rows}
    assert note_ids == {matching_note}


async def test_ordinary_mode_excludes_trashed_notes(db_conn, test_user):
    data_source_id = await _make_ordinary_source(db_conn, test_user)
    live_note = await _insert_note(db_conn, test_user, title="live")
    trashed_note = await _insert_note(db_conn, test_user, title="trashed")
    await db_conn.execute("UPDATE notes SET deleted_at = now() WHERE id = $1", trashed_note)
    for note_id in (live_note, trashed_note):
        await db_conn.execute(
            """
            INSERT INTO db_row_props (note_id, data_source_id, user_id, properties)
            VALUES ($1, $2, $3, '{}')
            """,
            note_id, data_source_id, test_user,
        )

    lookup: dict = {}
    qb = QueryBuilder(user_id=test_user, data_source_id=data_source_id, properties=lookup)
    frag = qb.build(None, [], Pagination())
    rows = await db_conn.fetch(frag.sql, *frag.params)
    note_ids = {str(r["note_id"]) for r in rows}
    assert note_ids == {live_note}


async def test_all_notes_mode_excludes_trashed_notes(db_conn, test_user):
    live_note = await _insert_note(db_conn, test_user, title="live")
    trashed_note = await _insert_note(db_conn, test_user, title="trashed")
    await db_conn.execute("UPDATE notes SET deleted_at = now() WHERE id = $1", trashed_note)

    qb = QueryBuilder(user_id=test_user, data_source_id=None, properties={})
    frag = qb.build(None, [], Pagination())
    rows = await db_conn.fetch(frag.sql, *frag.params)
    ids = {str(r["id"]) for r in rows}
    assert ids == {live_note}


# --- ASC NULLS LAST / DESC NULLS FIRST, one type per value-shape family ----


async def test_sort_text_asc_nulls_last_desc_nulls_first(db_conn, test_user):
    data_source_id = await _make_ordinary_source(db_conn, test_user)
    with_value = await _insert_note(db_conn, test_user, title="has value")
    empty = await _insert_note(db_conn, test_user, title="empty")
    for note_id, props in (
        (with_value, {"a1b2c3d4": {"type": "title", "title": "hello"}}),
        (empty, {}),
    ):
        await db_conn.execute(
            "INSERT INTO db_row_props (note_id, data_source_id, user_id, properties) VALUES ($1, $2, $3, $4)",
            note_id, data_source_id, test_user, props,
        )

    lookup = {"t": PropertyLookup(type="title", storage="jsonb", key="a1b2c3d4")}
    qb = QueryBuilder(user_id=test_user, data_source_id=data_source_id, properties=lookup)

    asc_frag = qb.build(None, [SortSpec(property="t", direction="asc")], Pagination())
    asc_rows = await db_conn.fetch(asc_frag.sql, *asc_frag.params)
    assert str(asc_rows[-1]["note_id"]) == empty

    desc_frag = qb.build(None, [SortSpec(property="t", direction="desc")], Pagination())
    desc_rows = await db_conn.fetch(desc_frag.sql, *desc_frag.params)
    assert str(desc_rows[0]["note_id"]) == empty


async def test_sort_number_asc_nulls_last_desc_nulls_first(db_conn, test_user):
    data_source_id = await _make_ordinary_source(db_conn, test_user)
    with_value = await _insert_note(db_conn, test_user, title="has value")
    empty = await _insert_note(db_conn, test_user, title="empty")
    for note_id, props in (
        (with_value, {"a1b2c3d4": {"type": "number", "number": 5}}),
        (empty, {}),
    ):
        await db_conn.execute(
            "INSERT INTO db_row_props (note_id, data_source_id, user_id, properties) VALUES ($1, $2, $3, $4)",
            note_id, data_source_id, test_user, props,
        )

    lookup = {"n": PropertyLookup(type="number", storage="jsonb", key="a1b2c3d4")}
    qb = QueryBuilder(user_id=test_user, data_source_id=data_source_id, properties=lookup)

    asc_frag = qb.build(None, [SortSpec(property="n", direction="asc")], Pagination())
    asc_rows = await db_conn.fetch(asc_frag.sql, *asc_frag.params)
    assert str(asc_rows[-1]["note_id"]) == empty

    desc_frag = qb.build(None, [SortSpec(property="n", direction="desc")], Pagination())
    desc_rows = await db_conn.fetch(desc_frag.sql, *desc_frag.params)
    assert str(desc_rows[0]["note_id"]) == empty


async def test_sort_multi_select_jsonb_array_asc_nulls_last(db_conn, test_user):
    data_source_id = await _make_ordinary_source(db_conn, test_user)
    with_value = await _insert_note(db_conn, test_user, title="has value")
    empty = await _insert_note(db_conn, test_user, title="empty")
    for note_id, props in (
        (with_value, {"a1b2c3d4": {"type": "multi_select", "multi_select": ["a"]}}),
        (empty, {}),
    ):
        await db_conn.execute(
            "INSERT INTO db_row_props (note_id, data_source_id, user_id, properties) VALUES ($1, $2, $3, $4)",
            note_id, data_source_id, test_user, props,
        )

    lookup = {"m": PropertyLookup(type="multi_select", storage="jsonb", key="a1b2c3d4")}
    qb = QueryBuilder(user_id=test_user, data_source_id=data_source_id, properties=lookup)
    asc_frag = qb.build(None, [SortSpec(property="m", direction="asc")], Pagination())
    asc_rows = await db_conn.fetch(asc_frag.sql, *asc_frag.params)
    assert str(asc_rows[-1]["note_id"]) == empty


async def test_sort_native_array_topics_all_notes_mode(db_conn, test_user):
    # task-12 finding (report.md "Concerns"): unlike every jsonb-backed
    # value-shape family (text/number/multi_select above), `topics` is a
    # native `TEXT[] NOT NULL DEFAULT '{}'` column — an untouched row's
    # value is an actual empty array, never SQL NULL. `sql_order`'s "ASC
    # NULLS LAST / DESC NULLS FIRST" convention (properties/base.py,
    # unmodified by this task) only affects real NULLs, so it has no effect
    # here: plain Postgres array comparison sorts `'{}'` as the smallest
    # possible value, putting the empty-topics row FIRST for ASC and LAST
    # for DESC — the inverse of every other family's "empties trail" rule,
    # and the inverse of what a literal reading of the brief's own sort-test
    # instruction ("assert the NULL/empty row lands last for asc") predicts.
    # compile_sorts()/build() are wiring this correctly (they faithfully
    # call REGISTRY["multi_select"].sql_order() and execute what it
    # returns) — the gap is in that pre-existing, generic sql_order
    # implementation not special-casing native-array/empty-default columns,
    # which is properties/base.py's territory, out of scope here.
    with_topic = await _insert_note(db_conn, test_user, title="has topic")
    await db_conn.execute("UPDATE notes SET topics = $1 WHERE id = $2", ["a"], with_topic)
    no_topic = await _insert_note(db_conn, test_user, title="no topic")

    properties = {
        prop.column: PropertyLookup(type=prop.type, storage="column", key=prop.column)
        for prop in COLUMN_BACKED.values()
    }
    qb = QueryBuilder(user_id=test_user, data_source_id=None, properties=properties)
    asc_frag = qb.build(None, [SortSpec(property="topics", direction="asc")], Pagination())
    asc_rows = await db_conn.fetch(asc_frag.sql, *asc_frag.params)
    assert str(asc_rows[0]["id"]) == no_topic  # empty array sorts FIRST, not last

    desc_frag = qb.build(None, [SortSpec(property="topics", direction="desc")], Pagination())
    desc_rows = await db_conn.fetch(desc_frag.sql, *desc_frag.params)
    assert str(desc_rows[-1]["id"]) == no_topic  # and LAST for desc


# --- Pagination --------------------------------------------------------


async def test_pagination_window(db_conn, test_user):
    note_ids = []
    for i in range(5):
        note_ids.append(await _insert_note(db_conn, test_user, title=f"n{i}"))

    qb = QueryBuilder(user_id=test_user, data_source_id=None, properties={})
    frag = qb.build(None, [], Pagination(page_size=2, offset=1))
    assert 2 in frag.params
    assert 1 in frag.params
    rows = await db_conn.fetch(frag.sql, *frag.params)
    assert len(rows) == 2
