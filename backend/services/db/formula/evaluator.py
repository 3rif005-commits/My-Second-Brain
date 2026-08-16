"""The formula language's evaluator: the third of spec §7.2's "one tree,
three visitors" (the parser produces the tree; `typecheck.py` is the
second visitor; this is the third). Tree-walking, no bytecode, over Task
23's AST -- `evaluate(node, ctx) -> FValue`.

Spec: docs/superpowers/specs/2026-08-08-notion-databases-design.md §7.1
(backend-only), §7.2 (one tree, three visitors).
Research: docs/research/notion-databases-research.md §H.1 (types),
§H.1.4 (empty), §H.1.8 (coercion), §H.1.9 (errors -- the UNRESOLVED
runtime-edge list this module rules on, see `_invoke`'s docstring and this
task's report), §H.2.3-2.5 (conditionals/let/dot-notation), §H.3.1-3.4
(the four categories this task implements).
Brief: .superpowers/sdd/2026-08-08-notion-databases/task-25-brief.md.

Out of scope (Task 26): `now()`/`today()`/date arithmetic, list functions
(`map`/`filter`/`sort`/...), page/person functions (`id`/`name`/`email`).
Calling one of those by name raises `NotImplementedError` here -- a real
"not built yet" gap, deliberately NOT folded into the EMPTY-for-
undocumented-edges ruling below (that ruling is for behaviour research
declines to specify; a whole missing category is this codebase's own,
temporary, and loud limitation).
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Mapping

from . import ast as A
from . import functions
from .values import EMPTY, FValue, as_number, stringify, truthy

__all__ = ["EvalContext", "evaluate", "FormulaEvalError"]


class FormulaEvalError(Exception):
    """Raised only for a genuine implementation gap (a builtin this
    package has not implemented yet -- see module docstring) or an
    unreachable-by-construction AST shape (`ast.Lambda`, mirroring
    `typecheck.py`'s identical defensive handling). NEVER raised for a
    malformed or runtime-edge-case VALUE (`divide(1,0)`,
    `toNumber("abc")`, an out-of-range index, ...) -- every one of those
    returns `EMPTY` instead, per this task's brief and `_invoke`'s
    docstring below. This is therefore a much narrower exception than a
    generic "evaluation failed" -- it should never fire for a formula this
    package's four categories fully cover, however malformed the input
    values are."""


@dataclass(frozen=True)
class EvalContext:
    """Everything `evaluate()` needs beyond the AST node itself (brief
    §2).

    - `properties`: the row's property values, by NAME (matching
      `typecheck.check()`'s `properties: dict[str, str]` being name-keyed
      too, and `deps.referenced_properties()` collecting names -- all
      three visitors agree on "formulas reference properties by name").
    - `now`: captured ONCE per evaluation pass, by the caller, and passed
      in -- never read from `datetime.now()` inside a builtin. Brief,
      explicit: two `now()` calls in one formula must return the same
      instant, and a recompute pass over many rows must not drift across
      them mid-pass. UTC (matching the volatility/materialisation design's
      documented UTC-only decision) -- callers are expected to pass a
      timezone-AWARE UTC `datetime`; not enforced here (no `now()`/
      date builtins exist yet in this task to consume it at all -- Task 26
      is the first real caller of this field).
    - `scope`: `let`/`lets` bindings and (Task 26) the implicit
      `current`/`index` list-function variables, threaded by returning a
      NEW `EvalContext` (via `with_binding`) rather than mutating a shared
      dict -- mirrors `typecheck._Checker`'s identical `dict(scope)`-copy-
      on-extend discipline, for the identical reason (an inner binding
      must never leak into a sibling branch that didn't introduce it).
    """

    properties: Mapping[str, FValue]
    now: datetime
    scope: Mapping[str, FValue] = field(default_factory=dict)

    def with_binding(self, name: str, value: FValue) -> "EvalContext":
        new_scope = dict(self.scope)
        new_scope[name] = value
        return replace(self, scope=new_scope)


# ---------------------------------------------------------------------------
# The general EMPTY-propagation rule (brief §2: "Make the general rule
# explicit in one place in the evaluator rather than re-deciding it inside
# 53 functions.")
# ---------------------------------------------------------------------------

# Every builtin call funnels through `_invoke`, which enforces "an
# operation on EMPTY yields EMPTY" for every name EXCEPT these five --
# exactly the ones research/the brief document as behaving differently
# when handed EMPTY input:
#   - `empty`: its entire job IS testing for EMPTY; short-circuiting it
#     would make `empty(empty())` itself always EMPTY instead of `true`.
#   - `if`/`ifs`: EMPTY is a legitimate, FALSY condition value (research
#     §2.3's own "likely non-empty => true" hint, `values.truthy`) --
#     propagating would make `if(empty(), 1, 2)` always EMPTY instead of
#     evaluating to `2`.
#   - `equal`/`unequal`: EMPTY must be a comparable VALUE, not swallowed --
#     this is how `x == empty()` works at all as a spelling of "is x
#     empty" (the `empty(x)` predicate is the normal way to ask that, but
#     nothing stops a formula from writing the comparison directly, and it
#     must not always answer EMPTY regardless of `x`).
_EMPTY_AWARE = frozenset({"empty", "if", "ifs", "equal", "unequal"})


def _invoke(name: str, arg_values: list[FValue]) -> FValue:
    fn = functions.REGISTRY.get(name)
    if fn is None:
        raise FormulaEvalError(
            f"formula function {name!r} has no evaluator implementation "
            "yet (belongs to a category Task 26 implements -- date/time, "
            "list, or page/person; see functions/__init__.py's "
            "_PENDING_CATEGORIES)"
        )
    if name not in _EMPTY_AWARE and any(v is EMPTY for v in arg_values):
        return EMPTY
    return fn(arg_values)


# ---------------------------------------------------------------------------
# evaluate()
# ---------------------------------------------------------------------------


def evaluate(node: A.Node, ctx: EvalContext) -> FValue:
    if isinstance(node, A.Literal):
        return node.value
    if isinstance(node, A.ListLiteral):
        return [evaluate(item, ctx) for item in node.items]
    if isinstance(node, A.PropertyRef):
        return ctx.properties.get(node.name, EMPTY)
    if isinstance(node, A.Variable):
        # An unbound variable is unreachable for a formula that passed
        # `typecheck.check()` (`_check_variable` already reports this as
        # an error there) -- handled defensively, not because valid input
        # reaches it, per this task's brief-wide "never raise on malformed
        # input" ruling.
        return ctx.scope.get(node.name, EMPTY)
    if isinstance(node, A.Unary):
        return _eval_unary(node, ctx)
    if isinstance(node, A.Binary):
        return _eval_binary(node, ctx)
    if isinstance(node, A.Conditional):
        return _eval_conditional(node, ctx)
    if isinstance(node, A.Let):
        return _eval_let(node, ctx)
    if isinstance(node, A.MethodCall):
        return _eval_method_call(node, ctx)
    if isinstance(node, A.Call):
        return _eval_call(node.name, node.args, ctx)
    if isinstance(node, A.Lambda):
        # Mirrors typecheck.py's identical defensive branch: the parser
        # never constructs one (ast.Lambda's own docstring; Task 23's
        # report), so this is unreachable via real input.
        raise FormulaEvalError("lambda nodes are not supported by this language")
    raise FormulaEvalError(f"evaluate(): unhandled node type {type(node).__name__}")


# -- operators ----------------------------------------------------------------


def _eval_unary(node: A.Unary, ctx: EvalContext) -> FValue:
    operand = evaluate(node.operand, ctx)
    if node.op == "not":
        # Delegates to the SAME registry entry the `not(x)`/function-call
        # spelling uses (`functions.logic._not`) -- one implementation for
        # both of research's documented spellings (§2.1/§3.1), not two
        # that could quietly drift apart.
        return _invoke("not", [operand])
    if node.op == "-":
        if operand is EMPTY:
            return EMPTY
        n = as_number(operand)
        return EMPTY if n is None else -n
    raise FormulaEvalError(f"evaluate(): unknown unary op {node.op!r}")  # pragma: no cover


_BINARY_TO_BUILTIN = {
    "-": "subtract",
    "*": "multiply",
    "/": "divide",
    "%": "mod",
    "^": "pow",
}


def _eval_binary(node: A.Binary, ctx: EvalContext) -> FValue:
    op = node.op
    left = evaluate(node.left, ctx)
    right = evaluate(node.right, ctx)

    if op == "and":
        return _invoke("and", [left, right])
    if op == "or":
        return _invoke("or", [left, right])
    if op == "==":
        return _invoke("equal", [left, right])
    if op == "!=":
        return _invoke("unequal", [left, right])

    if op == "+":
        return _eval_add(left, right)

    if op in _BINARY_TO_BUILTIN:
        # `-`/`*`/`/`/`%`/`^` as operators have IDENTICAL semantics to
        # `subtract`/`multiply`/`divide`/`mod`/`pow` as function calls
        # (unlike `+`, which overloads string concatenation on top of
        # `add`'s pure-arithmetic behaviour -- see `_eval_add`'s
        # docstring) -- delegating avoids a second copy of the same
        # domain-error handling (division/mod by zero, `pow`'s complex-
        # result guard, ...).
        return _invoke(_BINARY_TO_BUILTIN[op], [left, right])

    if op in (">", ">=", "<", "<="):
        return _eval_compare(op, left, right)

    raise FormulaEvalError(f"evaluate(): unknown binary op {op!r}")  # pragma: no cover


def _eval_add(left: FValue, right: FValue) -> FValue:
    """`+`'s overload (research §1.8/§2.1, brief §2): if either operand is
    a `String`, concatenate (stringifying the other side); otherwise, if
    both are numbers, add. This is DELIBERATELY separate from the plain
    `add()` builtin (`functions/numeric.py`), which is pure Number+Number
    arithmetic with NO string-concatenation overload -- research §1.8 is
    explicit that `add(2, "2")` is a type error while `2 + "2"` is legal
    and concatenates. The two spellings are NOT the same operation despite
    `receiver.f(a,b) === f(receiver,a,b)` holding for every OTHER operator
    (research §2.5) -- `+` is the one documented exception, so it gets its
    own function here instead of delegating to `_invoke("add", ...)` the
    way every other arithmetic operator above does.

    EMPTY propagates (general rule) -- `+` is not one of the five
    documented exceptions in `_EMPTY_AWARE`, so `"prefix" + empty()` is
    `EMPTY`, not `"prefix"` or `"prefixEMPTY"`."""
    if left is EMPTY or right is EMPTY:
        return EMPTY
    if isinstance(left, str) or isinstance(right, str):
        return stringify(left) + stringify(right)
    l_num = as_number(left)
    r_num = as_number(right)
    if l_num is not None and r_num is not None:
        return l_num + r_num
    return EMPTY  # malformed post-typecheck input (e.g. a bare List/Date operand)


def _eval_compare(op: str, left: FValue, right: FValue) -> FValue:
    """`>`/`>=`/`<`/`<=` (research §1.8: Number/Boolean/Date, booleans as
    `1`/`0`; `typecheck._COMPARABLE` is the type-check-time mirror of this
    same set). EMPTY propagates (general rule; comparison is not one of
    the five `_EMPTY_AWARE` exceptions -- `x > empty()` is `EMPTY`, not a
    `false`/`true` guess about ordering against "nothing")."""
    if left is EMPTY or right is EMPTY:
        return EMPTY

    def _ordinal(v: FValue) -> float | datetime | None:
        if isinstance(v, bool):
            return 1.0 if v else 0.0  # booleans compare as 1/0, research §1.8
        if isinstance(v, float):
            return v
        if isinstance(v, datetime):
            return v
        return None  # String/List/Person/Page: not comparable, see typecheck._COMPARABLE

    l_ord = _ordinal(left)
    r_ord = _ordinal(right)
    if l_ord is None or r_ord is None or type(l_ord) is not type(r_ord):
        return EMPTY  # malformed post-typecheck input, or a Number-vs-Date mismatch
    if op == ">":
        return l_ord > r_ord
    if op == ">=":
        return l_ord >= r_ord
    if op == "<":
        return l_ord < r_ord
    return l_ord <= r_ord  # "<="


# -- conditionals and let -------------------------------------------------


def _eval_conditional(node: A.Conditional, ctx: EvalContext) -> FValue:
    """`if(cond, then, else)` / ternary (one shared AST node, `ast.
    Conditional` -- see its own docstring). Evaluated LAZILY: only the
    condition and the CHOSEN branch are evaluated, not both (an explicit
    implementation choice, not a semantic requirement -- this language has
    no side effects or exceptions that escape an expression, so eager
    evaluation of both branches would be observably identical; lazy is
    simply the more efficient and more conventional reading for a tree-
    walking `if`, and avoids ever evaluating a branch that references an
    out-of-scope `let` binding from a sibling branch)."""
    cond = evaluate(node.cond, ctx)
    branch = node.then if truthy(cond) else node.otherwise
    return evaluate(branch, ctx)


def _eval_let(node: A.Let, ctx: EvalContext) -> FValue:
    """Sequential bindings, inner shadows outer (Task 23's parser-level
    ruling, reconfirmed by Task 24's checker, applied identically here for
    the third visitor in a row): each binding's value expression is
    evaluated against a context that already includes every binding
    before it."""
    local_ctx = ctx
    for name, value_node in node.bindings:
        value = evaluate(value_node, local_ctx)
        local_ctx = local_ctx.with_binding(name, value)
    return evaluate(node.body, local_ctx)


# -- calls: dispatch, dot-notation rewrite --------------------------------


def _eval_method_call(node: A.MethodCall, ctx: EvalContext) -> FValue:
    """Mirrors `typecheck._check_method_call`'s dispatch exactly (brief:
    the three visitors must not disagree about what a formula means) --
    `prop`/`context`/`let`/`lets` are NOT a mechanical `f(receiver, *args)`
    rewrite; every other name is."""
    if node.name == "prop":
        return _eval_prop(node.args, ctx)
    if node.name == "context":
        evaluate(node.receiver, ctx)  # for any nested side-effect-free evaluation only
        return _eval_context(node.args, ctx)
    if node.name in ("let", "lets"):
        # typecheck.py rejects this shape outright (`_check_method_call`:
        # "has no defined meaning in dot-notation form") -- a formula
        # containing it cannot pass type-checking, but research §1.9
        # documents that a formula WITH errors can still be saved, so this
        # must still evaluate to something rather than crash. EMPTY, this
        # task's standing ruling for a construct with no defined runtime
        # meaning.
        evaluate(node.receiver, ctx)
        for a in node.args:
            evaluate(a, ctx)
        return EMPTY
    arg_values = [evaluate(node.receiver, ctx)] + [evaluate(a, ctx) for a in node.args]
    return _invoke(node.name, arg_values)


def _eval_call(name: str, arg_nodes: list[A.Node], ctx: EvalContext) -> FValue:
    if name == "prop":
        return _eval_prop(arg_nodes, ctx)
    if name == "context":
        return _eval_context(arg_nodes, ctx)
    if name in ("let", "lets"):
        # Unreachable via the parser's own contract for a BARE call
        # (Task 23's `_normalize_call` always rewrites `let`/`lets` to
        # `ast.Let`) -- handled defensively, same reasoning as
        # `ast.Lambda` above.
        for a in arg_nodes:
            evaluate(a, ctx)
        return EMPTY
    arg_values = [evaluate(a, ctx) for a in arg_nodes]
    return _invoke(name, arg_values)


def _eval_prop(args: list[A.Node], ctx: EvalContext) -> FValue:
    """`prop("Name")` (bare) and `receiver.prop("Name")` (dot form).
    Mirrors Task 24's own ruling (`typecheck._check_prop_call`'s
    docstring, its report's judgment call #2) EXACTLY: both resolve
    "Name" against `ctx.properties` -- THIS row's own property values --
    regardless of what `receiver` evaluates to. The receiver is not even
    evaluated here: Task 24 already established that a dependent-typed
    resolution (knowing which OTHER data source's schema a `Page`-typed
    receiver belongs to) is not something this system can determine
    without cross-database schema tracking research gives no basis for,
    and the SAME limitation applies at runtime for the identical reason --
    the row's `ctx.properties` dict is this ONE data source's values, not
    a resolver that can chase a relation to a different row. This is
    correct for the common case (`current.Status` inside a self-relation
    traversal, where related rows share a schema) and, for a genuinely
    cross-database dot-prop reference, returns whatever THIS row happens
    to have under that name (or EMPTY if it has nothing under that name)
    rather than the OTHER row's value -- a real, narrow, documented
    limitation carried forward from Task 24, not a new one introduced
    here."""
    if len(args) != 1 or not isinstance(args[0], A.Literal) or not isinstance(
        args[0].value, str
    ):
        return EMPTY  # malformed prop() call, post-typecheck; never raise
    return ctx.properties.get(args[0].value, EMPTY)


def _eval_context(args: list[A.Node], ctx: EvalContext) -> FValue:
    """`context("...")` (research §2.6): the automation-only analogue of
    `prop()`. Task 24's report (judgment call #6) already flags that
    Second Brain has no automations feature yet -- `CONTEXT_VARIABLES`
    exists in `typecheck.py` purely for language completeness. Carried
    forward here, decided (brief-uncovered, flagged in this task's
    report): `context(...)` always evaluates to `EMPTY` at runtime,
    regardless of whether the name is one of the documented context
    variables, because there is no automation subsystem in this codebase
    supplying a REAL value for any of them yet. This is a genuine,
    temporary limitation (not a research-documented behaviour) that a
    future automations feature will need to revisit -- it is not the same
    kind of decision as the UNRESOLVED-runtime-edge EMPTY ruling elsewhere
    in this module, and is called out separately in this task's report
    for that reason."""
    for a in args:
        evaluate(a, ctx)
    return EMPTY


def make_now() -> datetime:
    """Capture `now()` exactly once, in UTC, for a caller (Task 27's
    materialisation pass, or a `/db/formulas/validate`-adjacent evaluation
    endpoint) to build one `EvalContext` from and reuse across an entire
    evaluation pass -- brief, explicit: "captured once per evaluation pass
    and passed in... a recompute pass over 500 rows must not drift." Not
    itself called by anything inside this module (nothing in this task's
    four categories reads `ctx.now` -- `now()`/`today()` are Task 26), but
    declared here as the one sanctioned place a caller gets a fresh
    timestamp from, rather than every caller reaching for
    `datetime.now()` independently and by accident picking a naive
    (non-UTC) one."""
    return datetime.now(timezone.utc)
