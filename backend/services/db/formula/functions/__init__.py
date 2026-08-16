"""The builtin function registry: one decorator-based table so a formula
function's signature (Task 24's `typecheck.FUNCTION_SIGNATURES`, imported
here and never re-declared), its implementation, and its golden tests all
key off the same string name.

Task 25 brief §1: "Add a startup-time consistency assertion... every name
in Task 24's signature table has an implementation, and every
implementation has a signature." That assertion is `_check_consistency()`
below -- run once at import time (module-level, so importing this package
at all is enough to catch drift) AND callable directly by a test
(`test_formula_functions_core.py`), per the brief's explicit "a
module-level check, and a test that calls it."

`_PENDING_CATEGORIES` is the documented hatch for Task 26 (brief §1: "use
an explicit `_PENDING_CATEGORIES` set that Task 26 deletes, rather than a
loose `if name in registry` skip that would silently hide a real gap
forever"). It lists every function name belonging to a category this task
does not implement (date/time §3.6, list §3.7, page/person §3.8) so the
consistency check below can assert "every OTHER name is implemented"
without failing on categories that don't exist yet. When Task 26 lands
those three categories, it deletes every entry here; if it forgets one,
`_check_consistency()` starts failing loudly on that name.
"""
from __future__ import annotations

from typing import Callable

from ..typecheck import FUNCTION_SIGNATURES
from ..values import FValue

__all__ = ["builtin", "REGISTRY", "check_registry_consistency"]

BuiltinFn = Callable[[list[FValue]], FValue]

REGISTRY: dict[str, BuiltinFn] = {}


def builtin(name: str) -> Callable[[BuiltinFn], BuiltinFn]:
    """`@builtin("abs")` registers the decorated function under that name.
    Raises at import time (not silently overwrites) if a name is
    registered twice -- two implementations for one name is exactly the
    kind of divergence this registry exists to make impossible."""

    def _register(fn: BuiltinFn) -> BuiltinFn:
        if name in REGISTRY:
            raise RuntimeError(
                f"formula builtin {name!r} registered twice "
                f"(already implemented by {REGISTRY[name]!r})"
            )
        REGISTRY[name] = fn
        return fn

    return _register


# Task 26's territory (brief §1's own "Out of scope: date/time, list,
# page/person functions"), enumerated by name so the consistency check can
# tell "not implemented yet, on purpose" apart from "missing by accident."
# Counts cross-checked against `typecheck.FUNCTION_SIGNATURES`'s own
# category comments (research §3.6/3.7/3.8: 19 + 18 + 3 = 40 names).
_PENDING_CATEGORIES: frozenset[str] = frozenset(
    {
        # -- §3.6 Date & time (19) -------------------------------------
        "now",
        "today",
        "minute",
        "hour",
        "day",
        "date",
        "week",
        "month",
        "year",
        "dateAdd",
        "dateSubtract",
        "dateBetween",
        "dateRange",
        "dateStart",
        "dateEnd",
        "timestamp",
        "fromTimestamp",
        "formatDate",
        "parseDate",
        # -- §3.7 List (18, incl. count/splice) -------------------------
        "at",
        "first",
        "last",
        "slice",
        "concat",
        "sort",
        "reverse",
        "unique",
        "includes",
        "find",
        "findIndex",
        "filter",
        "some",
        "every",
        "map",
        "flat",
        "count",
        "splice",
        # -- §3.8 Page / Person / relation (3) ---------------------------
        "id",
        "name",
        "email",
    }
)


def check_registry_consistency() -> None:
    """Every name in `FUNCTION_SIGNATURES` is either implemented in
    `REGISTRY` or explicitly pending (`_PENDING_CATEGORIES`); every
    implemented name has a signature (nothing in `REGISTRY` that isn't
    also in `FUNCTION_SIGNATURES` -- that would mean a builtin nothing can
    ever type-check, i.e. dead or misspelled code). Raises `AssertionError`
    with the exact offending names, not just "mismatch", so a failure is
    immediately actionable."""
    signature_names = set(FUNCTION_SIGNATURES)
    implemented_names = set(REGISTRY)

    missing = (signature_names - _PENDING_CATEGORIES) - implemented_names
    assert not missing, (
        f"formula functions with a signature but no evaluator implementation: "
        f"{sorted(missing)}"
    )

    orphaned = implemented_names - signature_names
    assert not orphaned, (
        f"formula builtins implemented with no entry in FUNCTION_SIGNATURES "
        f"(typo, or Task 24's table needs updating): {sorted(orphaned)}"
    )

    stale_pending = _PENDING_CATEGORIES & implemented_names
    assert not stale_pending, (
        f"these names are implemented AND still listed in _PENDING_CATEGORIES "
        f"-- delete them from the pending set: {sorted(stale_pending)}"
    )


# Import for side effect: each submodule's `@builtin(...)`-decorated
# functions register themselves into REGISTRY on import. Order does not
# matter (each module is independent; none imports another).
from . import logic, numeric, string, regex  # noqa: E402,F401

# Startup-time assertion (brief §1). Runs once, the first time anything
# imports this package -- e.g. `evaluator.py`, or a test importing
# `functions` directly. A category-count or name-drift bug therefore fails
# at import time, not only when a specific formula happens to exercise the
# missing name.
check_registry_consistency()
