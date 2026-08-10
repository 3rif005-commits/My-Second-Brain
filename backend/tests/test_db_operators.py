"""Tests for the M3 filter AST (`services.db.query.ast`) and the property-type
x filter-operator matrix (`services.db.query.operators`). Pure Python — no DB
connection: Task 12 owns the compiler/query-builder tests that run generated
SQL against a real Postgres.
"""
from __future__ import annotations

import pytest

from services.db.query.ast import (
    FilterCondition,
    FilterGroup,
    FilterValidationError,
    Pagination,
    SortSpec,
    parse_filter,
)
from services.db.properties.base import SqlContext, SqlFragment
from services.db.query.operators import (
    TYPE_OPERATORS,
    coerce_value,
    compile_condition,
)

# operators.py re-exports ast.py's FilterValidationError rather than
# defining its own — ast.py's docstring is explicit that one class is
# "Raised by ast.py/operators.py", so Task 12's compiler only ever needs to
# catch one exception type. Assert that identity here so a future edit
# can't silently reintroduce two classes.
from services.db.query.operators import FilterValidationError as OpFilterValidationError


def test_operators_filter_validation_error_is_ast_filter_validation_error():
    assert OpFilterValidationError is FilterValidationError


def test_parse_filter_none_returns_none():
    assert parse_filter(None) is None


def test_parse_filter_nested_and_or_parses():
    raw = {
        "type": "group",
        "op": "and",
        "children": [
            {"type": "condition", "property": "a7Kd9x", "operator": "greater_than", "value": 10},
            {
                "type": "group",
                "op": "or",
                "children": [
                    {"type": "condition", "property": "p2Lm4q", "operator": "contains", "value": "opt_a1"},
                    {"type": "condition", "property": "z8Rt0v", "operator": "past_week", "value": {}},
                ],
            },
        ],
    }
    node = parse_filter(raw)
    assert isinstance(node, FilterGroup)
    assert node.op == "and"
    assert isinstance(node.children[0], FilterCondition)
    assert isinstance(node.children[1], FilterGroup)
    assert node.children[1].op == "or"


def _nest_groups(depth: int) -> dict:
    """A chain of `depth` nested groups, innermost holding one condition."""
    node = {"type": "condition", "property": "p", "operator": "is_empty", "value": None}
    for _ in range(depth):
        node = {"type": "group", "op": "and", "children": [node]}
    return node


def test_parse_filter_depth_10_is_allowed():
    assert parse_filter(_nest_groups(10)) is not None


def test_parse_filter_depth_11_raises():
    with pytest.raises(FilterValidationError):
        parse_filter(_nest_groups(11))


def test_parse_filter_unrecognised_type_raises():
    with pytest.raises(FilterValidationError):
        parse_filter({"type": "bogus", "property": "p", "operator": "equals", "value": 1})


def test_parse_filter_empty_children_raises():
    with pytest.raises(FilterValidationError):
        parse_filter({"type": "group", "op": "and", "children": []})


def test_sort_spec_defaults_to_ascending():
    assert SortSpec(property="a7Kd9x").direction == "asc"


def test_pagination_defaults():
    p = Pagination()
    assert p.page_size == 50
    assert p.offset == 0


def test_pagination_rejects_page_size_over_200():
    with pytest.raises(Exception):
        Pagination(page_size=201)


# --- The operator matrix ---------------------------------------------------


def test_total_operator_pair_count_is_131():
    assert sum(len(v) for v in TYPE_OPERATORS.values()) == 131


@pytest.mark.parametrize("excluded", ["formula", "rollup", "place", "button"])
def test_formula_rollup_place_button_excluded(excluded):
    assert excluded not in TYPE_OPERATORS


def test_text_types_share_the_same_8_operators():
    expected = {
        "equals", "does_not_equal", "contains", "does_not_contain",
        "starts_with", "ends_with", "is_empty", "is_not_empty",
    }
    for key in ("title", "rich_text", "url", "email", "phone_number"):
        assert set(TYPE_OPERATORS[key]) == expected


def test_checkbox_has_only_equals_pair():
    assert set(TYPE_OPERATORS["checkbox"]) == {"equals", "does_not_equal"}


def test_date_created_time_last_edited_time_share_14_operators():
    expected = set(TYPE_OPERATORS["date"])
    assert len(expected) == 14
    assert set(TYPE_OPERATORS["created_time"]) == expected
    assert set(TYPE_OPERATORS["last_edited_time"]) == expected


def test_unique_id_has_full_8_number_operators():
    assert set(TYPE_OPERATORS["unique_id"]) == set(TYPE_OPERATORS["number"])


def test_verification_has_single_status_operator():
    assert set(TYPE_OPERATORS["verification"]) == {"status"}


def test_files_has_only_existence_operators():
    assert set(TYPE_OPERATORS["files"]) == {"is_empty", "is_not_empty"}


# --- coerce_value ------------------------------------------------------

def test_coerce_none_accepts_empty_dict_and_none():
    assert coerce_value("none", {}) is None
    assert coerce_value("none", None) is None


def test_coerce_none_rejects_anything_else():
    with pytest.raises(OpFilterValidationError):
        coerce_value("none", "x")


def test_coerce_str_accepts_str_rejects_bool():
    assert coerce_value("str", "hello") == "hello"
    with pytest.raises(OpFilterValidationError):
        coerce_value("str", True)


def test_coerce_num_accepts_int_float_rejects_bool():
    assert coerce_value("num", 5) == 5
    assert coerce_value("num", 5.5) == 5.5
    with pytest.raises(OpFilterValidationError):
        coerce_value("num", True)  # the bool-is-not-num trap
    with pytest.raises(OpFilterValidationError):
        coerce_value("num", "5")


def test_coerce_bool_accepts_only_true_false():
    assert coerce_value("bool", True) is True
    assert coerce_value("bool", False) is False
    with pytest.raises(OpFilterValidationError):
        coerce_value("bool", 1)


def test_coerce_str_or_list_accepts_str_and_nonempty_list():
    assert coerce_value("str_or_list", "a") == "a"
    assert coerce_value("str_or_list", ["a", "b"]) == ["a", "b"]


def test_coerce_str_or_list_rejects_empty_list():
    with pytest.raises(OpFilterValidationError):
        coerce_value("str_or_list", [])


def test_coerce_date_accepts_iso8601():
    result = coerce_value("date", "2026-08-10T12:00:00Z")
    assert result.year == 2026 and result.month == 8 and result.day == 10


def test_coerce_date_accepts_relative_keyword():
    result = coerce_value("date", "today")
    assert result is not None


def test_coerce_date_rejects_garbage():
    with pytest.raises(OpFilterValidationError):
        coerce_value("date", "not-a-date")


def test_coerce_uuid_accepts_valid_uuid_rejects_garbage():
    valid = "12345678-1234-5678-1234-567812345678"
    assert coerce_value("uuid", valid) == valid
    with pytest.raises(OpFilterValidationError):
        coerce_value("uuid", "not-a-uuid")


def test_coerce_uuid_or_me_accepts_me_and_uuid():
    assert coerce_value("uuid_or_me", "me") == "me"
    valid = "12345678-1234-5678-1234-567812345678"
    assert coerce_value("uuid_or_me", valid) == valid
    with pytest.raises(OpFilterValidationError):
        coerce_value("uuid_or_me", "nope")


def test_coerce_verification_status_accepts_enum_rejects_other():
    assert coerce_value("verification_status", "verified") == "verified"
    with pytest.raises(OpFilterValidationError):
        coerce_value("verification_status", "bogus")


def test_coerce_verification_status_rejects_unhashable_value_without_a_typeerror():
    # A dict/list raw_value must fail loudly as FilterValidationError, same
    # as every other arg_type — not leak a raw TypeError from `in` against
    # the enum set.
    with pytest.raises(OpFilterValidationError):
        coerce_value("verification_status", {"a": 1})


# --- compile_condition ---------------------------------------------------

_ARG_TYPE_SAMPLE_VALUES: dict[str, list[Any]] = {
    "none": [None],
    "str": ["needle"],
    "num": [42],
    "bool": [True],
    "str_or_list": ["needle", ["needle", "other"]],
    "date": ["2026-08-10"],
    "uuid": ["12345678-1234-5678-1234-567812345678"],
    "uuid_or_me": ["12345678-1234-5678-1234-567812345678"],
    "verification_status": ["verified"],
}


def _ctx_for(prop_type: str) -> SqlContext:
    # Any jsonb-backed condition works with an arbitrary base62-shaped key;
    # the native-array branch is exercised separately via `topics`.
    return SqlContext(key="a1b2c3d4", alias="p", storage="jsonb")


@pytest.mark.parametrize(
    "prop_type,operator_name",
    [
        (prop_type, operator_name)
        for prop_type, ops in TYPE_OPERATORS.items()
        for operator_name in ops
    ],
)
def test_compile_condition_covers_full_matrix(prop_type, operator_name):
    operator = TYPE_OPERATORS[prop_type][operator_name]
    for sample in _ARG_TYPE_SAMPLE_VALUES[operator.arg_type]:
        frag = compile_condition(
            prop_type, _ctx_for(prop_type), operator_name, sample, user_id="u-1"
        )
        assert isinstance(frag, SqlFragment)
        # No literal occurrence of the bound value anywhere in `sql` —
        # every value travels through `params`, never interpolated.
        for value in frag.params:
            if isinstance(value, str) and value:
                assert value not in frag.sql


def test_compile_condition_unknown_type_raises():
    with pytest.raises(OpFilterValidationError):
        compile_condition("formula", _ctx_for("formula"), "equals", "x", user_id="u-1")


def test_compile_condition_unknown_operator_raises():
    with pytest.raises(OpFilterValidationError):
        compile_condition("title", _ctx_for("title"), "greater_than", "x", user_id="u-1")


def test_native_array_topics_uses_array_operators():
    ctx = SqlContext(key="topics", alias="notes", storage="column")
    frag = compile_condition("multi_select", ctx, "contains", "sql", user_id="u-1")
    assert "= ANY(" in frag.sql
    assert "?" not in frag.sql


def test_jsonb_multi_select_uses_jsonb_operators():
    ctx = SqlContext(key="a1b2c3d4", alias="p", storage="jsonb")
    frag = compile_condition("multi_select", ctx, "contains", "sql", user_id="u-1")
    assert "?" in frag.sql
    assert "ANY(" not in frag.sql


def test_me_resolution_binds_user_id_not_literal_me():
    ctx = SqlContext(key="a1b2c3d4", alias="p", storage="jsonb")
    frag = compile_condition("people", ctx, "contains", "me", user_id="user-123")
    assert "user-123" in frag.params
    assert "me" not in frag.params
    assert "me" not in frag.sql


# --- The guarded numeric cast (properties/base.py, spec §8.2) --------------

def test_number_sql_extract_uses_a_guarded_cast_not_an_unconditional_one():
    from services.db.properties.base import REGISTRY as base_registry

    frag = base_registry["number"].sql_extract(SqlContext(key="a1b2c3d4", alias="p"))
    assert "CASE WHEN" in frag.sql
    assert "::double precision" in frag.sql
    assert "ELSE NULL END" in frag.sql
