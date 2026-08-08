"""The property system: the `PropertyType` protocol every property-type
descriptor implements, and the `REGISTRY` of all of them.

Spec: docs/superpowers/specs/2026-08-08-notion-databases-design.md §5.

`db_properties.type` (Milestone 2 onward) drives everything through a
per-type descriptor registered here. Adding a property type is one
implementation of `PropertyType` plus a `REGISTRY` entry — the 24 real,
addressable Notion property types (research §F.1, items 1-24) are 24
implementations of one interface, not 24 special cases scattered through
the compiler.

This module ships every key from Milestone 1 onward as a deliberately
minimal, generic descriptor (JSONB storage, an empty/not-empty filter pair,
count-only aggregations) so the registry is complete and satisfies the
protocol immediately. Milestone 5 replaces individual entries with richer,
type-specific descriptors (40 number formats, status groups, relation
traversal, formula evaluation, ...) without changing this module's public
shape: `PropertyType`, `REGISTRY`, `SqlFragment`, `SqlContext`, `Operator`.

Note on "25 types": the design spec's prose (§5, §1) and the plan describe
"25 types". Research §F.1 ("Complete property type inventory") enumerates
exactly 24 real, addressable property types (items 1-24) and explicitly
resolves its own item 25 -- AI autofill -- as **not** a property type: "a
configuration layer applied to an existing property," never a schema
entry. REGISTRY therefore holds 24 keys. See task-2-report.md for the full
note; this is flagged for the user, not silently reconciled.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict


@dataclass(frozen=True)
class SqlFragment:
    """A parameterised SQL expression fragment.

    `sql` uses asyncpg-style positional placeholders (`$1`, `$2`, ...)
    numbered relative to `params`; the query compiler (Milestone 3) is
    responsible for renumbering them into the final, assembled query. No
    property-type implementation ever interpolates a value directly into
    `sql` — values always travel through `params`.
    """

    sql: str
    params: tuple[Any, ...] = ()


@dataclass(frozen=True)
class SqlContext:
    """Everything a property-type descriptor needs to emit SQL for itself.

    `key` is the property's opaque JSONB key (`db_properties.key`) for
    `storage='jsonb'` properties, or the column name for `storage='column'`
    properties. `alias` is the SQL table alias for the row source: `notes`
    for the built-in "All Notes" virtual source (§6), `p` (or similar) for
    `db_row_props` otherwise. The query compiler (Milestone 3) constructs
    this; property types only ever read it.
    """

    key: str
    alias: str = "notes"


class Operator(BaseModel):
    """A single filter operator a property type supports, plus the shape
    of argument it expects (compiler/validation concern, Milestone 3)."""

    model_config = ConfigDict(frozen=True)

    name: str
    arg_type: str  # "str" | "num" | "bool" | "date" | "uuid" | "none" | ...


@runtime_checkable
class PropertyType(Protocol):
    """Spec §5. Every property type is one implementation of this."""

    key: str
    config_model: type[BaseModel]

    def default(self) -> Any: ...
    def is_empty(self, value: Any) -> bool: ...
    def sql_extract(self, ctx: SqlContext) -> SqlFragment: ...
    def sql_order(self, ctx: SqlContext, direction: str) -> SqlFragment: ...
    def operators(self) -> dict[str, Operator]: ...
    def aggregations(self) -> set[str]: ...
    def coerce_write(self, raw: Any) -> Any: ...


class _EmptyConfig(BaseModel):
    """Placeholder `config_model` for the generic Milestone-1 descriptors.
    Milestone 5 gives each type its own validated config (40 number
    formats, select option lists, etc.)."""

    model_config = ConfigDict(extra="forbid")


@dataclass(frozen=True)
class _GenericProperty:
    """Minimal `PropertyType` implementation shared by every type key until
    its dedicated, richer descriptor lands in Milestone 5 (spec §5 lists
    `scalar.py`, `choice.py`, `temporal.py`, `people.py`, `files.py`,
    `computed.py` as the eventual homes). It provides just enough
    behaviour to satisfy the protocol: JSONB extraction/ordering by key,
    an empty/not-empty operator pair, and count-only aggregations.
    """

    key: str
    config_model: type[BaseModel] = field(default=_EmptyConfig)

    def default(self) -> Any:
        return None

    def is_empty(self, value: Any) -> bool:
        return value is None or value == "" or value == [] or value == {}

    def sql_extract(self, ctx: SqlContext) -> SqlFragment:
        return SqlFragment(f"{ctx.alias}.properties -> $1", (ctx.key,))

    def sql_order(self, ctx: SqlContext, direction: str) -> SqlFragment:
        # Decided unknown (spec §5.1): empties always sort to the bottom.
        order = "ASC NULLS LAST" if direction == "asc" else "DESC NULLS FIRST"
        return SqlFragment(f"({ctx.alias}.properties -> $1) {order}", (ctx.key,))

    def operators(self) -> dict[str, Operator]:
        return {
            "is_empty": Operator(name="is_empty", arg_type="none"),
            "is_not_empty": Operator(name="is_not_empty", arg_type="none"),
        }

    def aggregations(self) -> set[str]:
        return {"count_all", "count_empty", "count_not_empty"}

    def coerce_write(self, raw: Any) -> Any:
        return raw


# The 24 real, addressable Notion property types (research §F.1, items
# 1-24). Item 25 in that inventory, AI autofill, is explicitly resolved as
# not a property type and is deliberately absent here.
_REAL_TYPE_KEYS = (
    "title", "rich_text", "number", "select", "multi_select", "status",
    "date", "people", "files", "checkbox", "url", "email", "phone_number",
    "formula", "relation", "rollup", "created_time", "created_by",
    "last_edited_time", "last_edited_by", "unique_id", "place",
    "verification", "button",
)

REGISTRY: dict[str, PropertyType] = {
    key: _GenericProperty(key=key) for key in _REAL_TYPE_KEYS
}
