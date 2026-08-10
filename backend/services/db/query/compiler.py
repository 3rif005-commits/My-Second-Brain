"""Resolves a filter/sort request's property **keys** into SQL, using Task
11's `ast.py` (shape) and `operators.py` (the type x operator matrix) as
pure building blocks. This module is the first thing that knows anything
about *where* a property lives (jsonb vs. column) — `ast.py`/`operators.py`
never do (spec §8.2 layer 1: the AST only ever carries a key).

Spec: docs/superpowers/specs/2026-08-08-notion-databases-design.md §8.2/§8.3.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException, status

from services.db.properties.base import REGISTRY, SqlContext, SqlFragment
from .ast import FilterCondition, FilterGroup, FilterNode, SortSpec
from .operators import FilterValidationError, compile_condition

__all__ = [
    "PropertyLookup",
    "compile_filter",
    "compile_sorts",
    "filter_validation_error_to_http",
    "renumber",
]


@dataclass(frozen=True)
class PropertyLookup:
    """Everything the compiler needs about one property, independent of where it came
    from (an ordinary data source's db_properties rows, or the All Notes virtual
    source's COLUMN_BACKED dict) — callers build a dict[key -> PropertyLookup] and hand
    it to compile_filter/compile_sorts. This module never queries the database itself."""

    type: str
    storage: Literal["jsonb", "column"]
    key: str


def filter_validation_error_to_http(exc: FilterValidationError) -> HTTPException:
    """spec §8.2 layer 2: "Unknown key -> HTTP 400, never a silently dropped
    clause." Callers (eventually a router, not this task) translate the
    FilterValidationError this module raises through this helper."""
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


_PLACEHOLDER_RE = re.compile(r"\$(\d+)")


def renumber(fragment: SqlFragment, start: int) -> SqlFragment:
    """Shift `fragment`'s $-placeholders so the first one becomes `$start`,
    preserving their relative order — `fragment.sql` numbers placeholders
    contiguously from $1 against `fragment.params` in order (SqlFragment's
    own contract); this is the one function every other seam of correctness
    here (including the injection suite) depends on getting right once.

    A single `re.sub` pass over the *original* text means every replacement
    reads its old index from the unmodified source string — no substitution
    can be re-matched by a later one, so this is safe even when shifting
    into the range of another placeholder (e.g. $1 -> $11).
    """
    if not fragment.params:
        return fragment
    shift = start - 1

    def _shift(m: re.Match[str]) -> str:
        return f"${int(m.group(1)) + shift}"

    return SqlFragment(sql=_PLACEHOLDER_RE.sub(_shift, fragment.sql), params=fragment.params)


def _combine(fragments: list[SqlFragment], sql_op: str) -> SqlFragment:
    """Renumber each child fragment's placeholders into one contiguous,
    correctly-ordered sequence and join them with `sql_op`, wrapped in one
    parenthesised group (a FilterGroup's own atomicity contract — see
    operators.py's date-window comment on why an unparenthesized multi-clause
    fragment is dangerous next to a sibling AND/OR)."""
    parts: list[str] = []
    params: list = []
    offset = 1
    for frag in fragments:
        shifted = renumber(frag, offset)
        parts.append(shifted.sql)
        params.extend(shifted.params)
        offset += len(frag.params)
    return SqlFragment(sql=f"({f' {sql_op} '.join(parts)})", params=tuple(params))


def _compile_node(
    node: FilterNode,
    properties: dict[str, PropertyLookup],
    *,
    user_id: str,
    alias: str,
) -> SqlFragment:
    if isinstance(node, FilterGroup):
        children = [
            _compile_node(child, properties, user_id=user_id, alias=alias)
            for child in node.children
        ]
        return _combine(children, "AND" if node.op == "and" else "OR")

    assert isinstance(node, FilterCondition)
    lookup = properties.get(node.property)
    if lookup is None:
        raise FilterValidationError(f"unknown property key: {node.property!r}")
    ctx = SqlContext(key=lookup.key, alias=alias, storage=lookup.storage)
    return compile_condition(lookup.type, ctx, node.operator, node.value, user_id=user_id)


def compile_filter(
    node: FilterNode | None,
    properties: dict[str, PropertyLookup],
    *,
    user_id: str,
    alias: str,
) -> SqlFragment:
    """Walks the AST (ast.py's FilterCondition/FilterGroup), resolving each
    condition's `property` key against `properties`. `node is None` -> a
    trivial `TRUE` fragment (spec's implicit default: no filter, matches
    list_rows's current unfiltered behaviour)."""
    if node is None:
        return SqlFragment("TRUE", ())
    return _compile_node(node, properties, user_id=user_id, alias=alias)


def compile_sorts(
    sorts: list[SortSpec], properties: dict[str, PropertyLookup], *, alias: str
) -> SqlFragment:
    """Same unknown-key handling as compile_filter (HTTP 400, never
    dropped). Calls REGISTRY[lookup.type].sql_order(ctx, sort.direction) per
    entry — already implemented, handles ASC NULLS LAST / DESC NULLS FIRST
    (spec §5.1) — and joins the results with ', '. An empty `sorts` list
    yields an empty fragment (legal: builder.py always appends its own
    row-identity tiebreaker regardless). `sql_order` never emits a bound
    param (it only ever orders by a computed expression, never compares
    against a request-supplied value), so unlike compile_filter there is
    nothing here to renumber."""
    parts: list[str] = []
    for sort in sorts:
        lookup = properties.get(sort.property)
        if lookup is None:
            raise FilterValidationError(f"unknown property key: {sort.property!r}")
        ctx = SqlContext(key=lookup.key, alias=alias, storage=lookup.storage)
        parts.append(REGISTRY[lookup.type].sql_order(ctx, sort.direction).sql)
    return SqlFragment(sql=", ".join(parts), params=())
