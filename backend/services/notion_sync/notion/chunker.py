"""Split a block tree into requests Notion accepts.

Limits (limits.py): <=100 blocks per children array, 2 nesting levels per
request, <=1,000 elements and ~500 KB per request. Children that do not fit
are *deferred*: the adapter appends them to the parent after it exists. Nothing
is truncated or dropped; `flatten(steps)` reproduces the input exactly (tested).
"""
from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field

from .limits import MAX_CHILDREN, MAX_DEPTH, MAX_ELEMENTS, MAX_PAYLOAD_BYTES


@dataclass
class Deferred:
    path: tuple[int, ...]          # block index path inside the step's block list
    children: list[dict]           # to append to the block at `path`, in order


@dataclass
class Step:
    blocks: list[dict]
    deferred: list[Deferred] = field(default_factory=list)


def children_of(block: dict) -> list[dict] | None:
    body = block.get(block.get("type", ""), {})
    ch = body.get("children") if isinstance(body, dict) else None
    return ch if isinstance(ch, list) and ch else None


def _set_children(block: dict, ch: list[dict] | None) -> None:
    body = block[block["type"]]
    if ch:
        body["children"] = ch
    else:
        body.pop("children", None)


def _elements(block: dict) -> int:
    n = 1

    def walk(o):
        nonlocal n
        if isinstance(o, dict):
            if o.get("type") in ("text", "equation", "mention"):
                n += 1
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    for key, v in block.items():
        if key != "type":
            walk(v)
    return n


def _size(block: dict) -> int:
    return len(json.dumps(block, ensure_ascii=False).encode("utf-8"))


#: Blocks Notion refuses to create without their children in the SAME request (live: a table needs its rows,
#: a column_list its columns, a column a child). They count as extra nesting levels.
_NEEDS_CHILDREN = ("table", "column_list", "column")


def levels_needed(block: dict) -> int:
    """Nesting levels this block needs inside ONE request (1 = just itself)."""
    if block.get("type") not in _NEEDS_CHILDREN:
        return 1
    ch = children_of(block) or []
    return 1 + max((levels_needed(c) for c in ch), default=0)


def _trim(block: dict, depth: int, path: tuple[int, ...], out: list[Deferred]) -> dict:
    """Copy of `block` with children cut to what one request may carry."""
    b = copy.deepcopy(block)
    ch = children_of(b)
    if not ch:
        return b
    if depth >= MAX_DEPTH:
        out.append(Deferred(path, ch))
        _set_children(b, None)
        return b
    keep, rest = ch[:MAX_CHILDREN], ch[MAX_CHILDREN:]
    # A child that cannot be created at this depth (a table three levels down has no room for its rows) waits,
    # with everything after it, until its parent exists: it is then appended as a block of its own request.
    if b.get("type") not in _NEEDS_CHILDREN:
        for j, c in enumerate(keep):
            if depth + 1 + levels_needed(c) - 1 > MAX_DEPTH:
                keep, rest = ch[:j], ch[j:]
                break
    kept = [_trim(c, depth + 1, path + (j,), out) for j, c in enumerate(keep)]
    _set_children(b, kept)
    if rest:
        out.append(Deferred(path, rest))
    return b


def plan_steps(blocks: list[dict]) -> list[Step]:
    steps: list[Step] = []
    cur = Step([])
    size = elems = 0

    def flush():
        nonlocal cur, size, elems
        if cur.blocks:
            steps.append(cur)
        cur, size, elems = Step([]), 0, 0

    for block in blocks:
        d: list[Deferred] = []
        t = _trim(block, 1, (0,), d)
        s, e = _size(t), _elements(t)
        if (s > MAX_PAYLOAD_BYTES or e > MAX_ELEMENTS) and children_of(t):
            d = []
            t = copy.deepcopy(block)
            ch = children_of(t)
            d.append(Deferred((0,), ch))
            _set_children(t, None)
            s, e = _size(t), _elements(t)
        if cur.blocks and (len(cur.blocks) >= MAX_CHILDREN or size + s > MAX_PAYLOAD_BYTES
                           or elems + e > MAX_ELEMENTS):
            flush()
        idx = len(cur.blocks)
        cur.blocks.append(t)
        for x in d:
            cur.deferred.append(Deferred((idx,) + x.path[1:], x.children))
        size += s
        elems += e
    flush()
    return steps


def flatten(steps: list[Step]) -> list[dict]:
    """Rebuild the original tree from steps (test oracle)."""
    out: list[dict] = []
    for step in steps:
        blocks = copy.deepcopy(step.blocks)
        for d in step.deferred:
            node = blocks[d.path[0]]
            for j in d.path[1:]:
                node = children_of(node)[j]
            ch = children_of(node) or []
            _set_children(node, ch + flatten(plan_steps(d.children)))
        out.extend(blocks)
    return out
