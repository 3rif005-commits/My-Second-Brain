"""Chunker property tests (seeded random trees; no hypothesis dependency)."""
import json
import random

import pytest

from services.notion_sync.notion.chunker import children_of, flatten, plan_steps
from services.notion_sync.notion.limits import (MAX_CHILDREN, MAX_ELEMENTS, MAX_PAYLOAD_BYTES)
from services.notion_sync.notion.richtext import split_units, utf16_len


def para(t, kids=None):
    b = {"type": "paragraph", "paragraph": {"rich_text": [{"type": "text", "text": {"content": t}}]}}
    if kids:
        b["paragraph"]["children"] = kids
    return b


def random_tree(rng, depth=0, max_depth=8):
    wide = [120] if depth == 0 else []           # >100 children once, never exponentially
    n_kids = 0 if depth >= max_depth else rng.choice([0, 0, 1, 2] + wide)
    kids = [random_tree(rng, depth + 1, max_depth) for _ in range(n_kids)]
    text = "".join(rng.choice("ab é😀א") for _ in range(rng.choice([0, 5, 200])))
    return para(text, kids)


def depth_of(block):
    ch = children_of(block) or []
    return 1 + max((depth_of(c) for c in ch), default=0)


def count_children_max(block):
    ch = children_of(block) or []
    return max([len(ch)] + [count_children_max(c) for c in ch])


@pytest.mark.parametrize("seed", range(12))
def test_every_step_respects_limits_and_nothing_is_lost(seed):
    rng = random.Random(seed)
    blocks = [random_tree(rng) for _ in range(rng.choice([1, 5, 40, 150]))]
    steps = plan_steps(blocks)
    for s in steps:
        assert 1 <= len(s.blocks) <= MAX_CHILDREN
        assert all(depth_of(b) <= 3 for b in s.blocks)
        assert all(count_children_max(b) <= MAX_CHILDREN for b in s.blocks)
        assert len(json.dumps(s.blocks).encode()) <= MAX_PAYLOAD_BYTES
    assert flatten(steps) == blocks


def test_size_split():
    big = [para("x" * 1900) for _ in range(100)]       # ~200 KB
    blocks = big * 4                                     # ~800 KB total -> several requests
    steps = plan_steps(blocks)
    assert len(steps) >= 2
    assert all(len(json.dumps(s.blocks).encode()) <= MAX_PAYLOAD_BYTES for s in steps)
    assert flatten(steps) == blocks


def test_element_limit():
    many = [{"type": "paragraph", "paragraph": {"rich_text": [
        {"type": "text", "text": {"content": "a"}}] * 100}} for _ in range(40)]   # 40 blocks, 4000 elements
    steps = plan_steps(many)
    assert len(steps) > 1
    assert flatten(steps) == many


def test_empty():
    assert plan_steps([]) == []


def test_split_units_never_exceeds_and_roundtrips():
    rng = random.Random(1)
    for _ in range(50):
        s = "".join(rng.choice("a😀é‮א\n") for _ in range(rng.choice([0, 1, 1999, 2000, 2001, 5000])))
        parts = split_units(s)
        assert "".join(parts) == s
        assert all(utf16_len(p) <= 2000 for p in parts)


def test_split_units_does_not_cut_a_surrogate_pair():
    s = "a" * 1999 + "😀"                       # the emoji needs 2 units: would straddle the limit
    parts = split_units(s)
    assert parts == ["a" * 1999, "😀"]


def test_emoji_text_t9_case():
    assert utf16_len("😀" * 1001) == 2002
    assert len(split_units("😀" * 1001)) == 2
