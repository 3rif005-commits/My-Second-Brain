"""The formula language front end: lexer -> AST -> Pratt parser.

Milestone 8a (Task 23) — parsing only. No type checking, no evaluation, no
builtins, no dependency extraction, no materialisation; those are later tasks
(spec §7.2's "one tree, three visitors" — the type checker, evaluator and
dependency extractor all consume the `ast.Node` tree this package produces).

Public surface: `parse()` and `FormulaSyntaxError` for callers that just want a
tree, plus the full AST node set and `walk()` for callers (later tasks) that
need to traverse or construct trees directly (e.g. tests, the type checker).
"""
from __future__ import annotations

from .ast import (
    AnyNode,
    Binary,
    Call,
    Conditional,
    Lambda,
    Let,
    ListLiteral,
    Literal,
    MethodCall,
    Node,
    PropertyRef,
    Unary,
    Variable,
    walk,
)
from .lexer import FormulaSyntaxError, Token, TokenKind, tokenize
from .parser import MAX_PARSE_DEPTH, parse

__all__ = [
    "parse",
    "tokenize",
    "walk",
    "FormulaSyntaxError",
    "MAX_PARSE_DEPTH",
    "Token",
    "TokenKind",
    "Node",
    "AnyNode",
    "Literal",
    "ListLiteral",
    "PropertyRef",
    "Variable",
    "Unary",
    "Binary",
    "Conditional",
    "Call",
    "MethodCall",
    "Lambda",
    "Let",
]
