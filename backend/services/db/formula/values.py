"""Runtime value representation for the formula evaluator (Milestone 8c,
Task 25): the `FValue` union, the `EMPTY` sentinel, `Person`/`Page`
wrappers, and the handful of value-level primitives (`is_empty`, `truthy`,
`as_number`, `stringify`) that both `evaluator.py` and every function in
`functions/*.py` need.

Split out of `evaluator.py` deliberately: `evaluator.py` imports
`functions.REGISTRY` (to dispatch calls) and every `functions/*.py` module
needs `FValue`/`EMPTY`/etc. If those lived in `evaluator.py` itself,
`functions/*.py` importing them would close an import cycle
(`evaluator -> functions -> evaluator`). This module has no dependency on
either, so both sides import downward from it instead.

Spec: docs/superpowers/specs/2026-08-08-notion-databases-design.md §7.2.
Research: docs/research/notion-databases-research.md §H.1 (type system),
§H.1.4 (empty/null semantics), §H.1.8 (coercion).
Brief: .superpowers/sdd/2026-08-08-notion-databases/task-25-brief.md §2.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Union

__all__ = [
    "FValue",
    "EMPTY",
    "Person",
    "Page",
    "is_empty",
    "truthy",
    "as_number",
    "stringify",
]


@dataclass(frozen=True)
class Person:
    """A workspace user (research §1.7). Not exercised by this task's four
    categories (logic/numeric/string/regex never produce or consume one),
    but declared here per the brief's value-representation spec so
    Task 26's page/person functions have it ready without another
    evaluator-wide edit."""

    id: str


@dataclass(frozen=True)
class Page:
    """A database row (research §1.6). Same status as `Person` above --
    declared for the brief's value model, not yet produced by anything in
    this task's scope."""

    id: str


class _EmptyType:
    """The polymorphic "no value" sentinel (research §1.4): `empty()` with
    no arguments evaluates to this, and it is also this evaluator's answer
    for every UNRESOLVED runtime edge case (division by zero, `sqrt(-1)`,
    `toNumber("abc")`, and friends -- see this task's report for the full
    list). A singleton (not `None`) so `is EMPTY` is an unambiguous,
    `isinstance`-free check everywhere, and so a formula that literally
    produces Python `None` (impossible today, since no builtin returns it,
    but defensively) is never confused with the language's own empty
    value."""

    _instance: "_EmptyType | None" = None

    def __new__(cls) -> "_EmptyType":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        return "EMPTY"

    def __bool__(self) -> bool:
        # Deliberately NOT wired into Python truthiness rules beyond this --
        # `truthy()` below is the one place formula-level truthiness is
        # decided (research's own condition-truthiness rule, "likely
        # non-empty => true"), not `if EMPTY:` scattered through the code.
        # This exists only so an accidental bare `if some_fvalue:` in this
        # package fails safe (falsy) instead of raising, since EMPTY is not
        # None and every other FValue type is already Python-truthy-aware.
        return False


EMPTY = _EmptyType()

# The seven value types (types.py's `FType`) plus the two runtime-only
# citizens: `EMPTY` (a value, not a type) and Python's own `list` for
# `List` (heterogeneous, unparameterised -- types.py's own documented
# choice, carried into the runtime representation here). `float` for every
# Number (brief: "IEEE-754/JS-like, so 1/2 == 0.5" -- never `int`).
FValue = Union[str, float, bool, datetime, list, Person, Page, _EmptyType]


# ---------------------------------------------------------------------------
# empty() / truthiness
# ---------------------------------------------------------------------------


def is_empty(value: FValue) -> bool:
    """research §1.4, official: *"Returns true if the value is empty. `0`,
    `""`, and `[]` are considered empty."* Also true for the `EMPTY`
    sentinel itself (the zero-arg `empty()` form).

    `bool` is checked before `float` -- brief, explicit: Python's `bool` is
    a subclass of `int` (and compares equal to `0`/`1` as a `float` too:
    `False == 0.0` is `True`), so an `isinstance(value, float)` check placed
    first would silently swallow `False` into "empty" alongside `0`, which
    is not what the official definition says (`0`, `""`, `[]` are the
    exhaustive list -- `false` is not on it). This is the one dispatch this
    task's brief calls out by name as "a classic and it will bite you"."""
    if value is EMPTY:
        return True
    if isinstance(value, bool):
        return False
    if isinstance(value, float):
        return value == 0.0
    if isinstance(value, str):
        return value == ""
    if isinstance(value, list):
        return len(value) == 0
    # Date / Person / Page: no documented "empty" reading for these via the
    # `empty(x)` predicate (only the four cases above are documented).
    return False


def truthy(value: FValue) -> bool:
    """The truthiness of an `if`/ternary/`ifs` condition slot.

    Research §2.3 flags this exact question `UNRESOLVED:` ("the exact
    truthiness rule for non-Boolean conditions... Likely 'non-empty =>
    true', matching `empty()`") and explicitly says not to guess further
    than that hint. Decided here, per that hint, and NOT separately ruled
    on by this task's brief (flagged in this task's report as a
    brief-uncovered decision): a real `Boolean` condition is used as-is;
    every other type (including `EMPTY` itself) is truthy exactly when
    `is_empty()` says it is not. `EMPTY` is therefore always falsy (a
    `Date`/`Person`/`Page`/non-empty `List`/non-empty `String`/non-zero
    `Number` condition is always truthy, since `is_empty` has no "empty"
    reading for those beyond the four documented cases)."""
    if isinstance(value, bool):
        return value
    return not is_empty(value)


# ---------------------------------------------------------------------------
# Number coercion
# ---------------------------------------------------------------------------


def as_number(value: FValue) -> float | None:
    """`value` read as a plain `float`, or `None` if it has no direct
    numeric identity. Deliberately narrow -- this is NOT `toNumber()`
    (`functions/numeric.py`'s `_to_number`, which additionally parses
    strings and reads a Date's timestamp): `as_number` is the "is this
    already, structurally, a number" check used internally by arithmetic
    operators and the numeric builtins, where a String argument is a type
    error (research §1.8: `add(2, "2")` is rejected), not a parse attempt.

    `bool` is excluded on purpose (checked and rejected before the `float`
    check, same trap as `is_empty` above) -- `+`/`-`/`*`/etc. do not treat
    `true`/`false` as `1`/`0` (only `>`/`<`/`>=`/`<=` and `toNumber` do,
    per research §1.8's comparison-operator and explicit-conversion rows,
    both handled elsewhere, not here)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, float):
        return value
    return None


# ---------------------------------------------------------------------------
# Stringification (`format()`, and `+`'s string-concatenation overload)
# ---------------------------------------------------------------------------


def stringify(value: FValue) -> str:
    """`format(Any) -> Text` (research §3.3/§3.9: "plain, unstyled
    stringification"), and also what `+`'s string-concatenation overload
    uses to render its non-string operand (research §1.8: `"There are " +
    prop("Members").length() + " members."`).

    Two traps this task's brief calls out by name, both handled here so
    every caller (the `+` operator, `format()`, and the first-string-slot
    receiver coercion below) gets them for free instead of re-deriving them:
    - `bool` -> lowercase `"true"`/`"false"` (brief, explicit), checked
      before `float` for the same reason as `is_empty`/`as_number` above.
    - A `float` that is mathematically integral prints with no trailing
      `.0` (brief, explicit: "no trailing .0 for integral floats") -- these
      strings end up concatenated into user-visible text, and `"Count: " +
      3.0` reading as `"Count: 3.0"` would look like a bug to every user of
      this engine, even though `3.0 == 3` is invisible everywhere else.
    """
    if value is EMPTY:
        # No documented stringification for the empty value itself (no
        # builtin routes EMPTY into `stringify` today -- `format()`'s own
        # dispatch never calls this for an EMPTY argument, see
        # functions/string.py). Kept total (not raising) purely as a
        # defensive fallback.
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return str(value)
    if isinstance(value, str):
        return value
    if isinstance(value, datetime):
        # Date stringification (`format(now())` -> "August 30, 2023
        # 17:55") is Task 26's territory (it needs Luxon-style date
        # formatting, out of scope here per this task's brief's "Out of
        # scope" list) -- isoformat is a placeholder so `format()` stays
        # total rather than crashing if a Date value ever reaches this
        # task's code path (it cannot yet, since nothing in this task's
        # four categories produces a Date value; flagged in this task's
        # report).
        return value.isoformat()
    if isinstance(value, list):
        # No documented `format([...])` example. Comma-joining each
        # element's own `stringify()` is the conservative reading (matches
        # `join()`'s documented "stringifies all elements", research
        # §1.8) -- our own choice, not a cited example.
        return ", ".join(stringify(v) for v in value)
    if isinstance(value, (Person, Page)):
        # research §1.6 marks "whether a bare Page value coerces to its
        # title in string concatenation" UNRESOLVED. Neither type is
        # producible by this task's four categories, so this is a
        # forward-compatible placeholder, not a real decision this task
        # needs to defend.
        return value.id
    return str(value)  # pragma: no cover - exhaustive above for real FValues
