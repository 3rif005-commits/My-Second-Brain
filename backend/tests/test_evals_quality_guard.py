"""The study-guide quality guard. The failure it exists for: a prompt change
made notes plainer (fewer boxes, less depth) while every yes/no floor still
passed. Each test here is one way a plainer guide must be caught."""
import re

from evals.quality_guard import (CONCEPTS, blocks_to_html, compare, profile,
                                 reference_html)


def _ref():
    return profile(reference_html())


def _anchored(html: str) -> str:
    """The saved reference lost its anchors in the editor; a generated guide
    has them. Give each section one so only the dimension under test differs."""
    return re.sub(r"<h3>", '<h3 data-anchor="1:p:1">', html)


def test_reference_is_the_approved_guide():
    ref = _ref()
    # Read off the note the user approved; if these move, the snapshot changed.
    assert ref["chapters"] == 3 and ref["callouts"] == 24
    assert ref["tables"] == 6 and ref["math"] == 15
    assert ref["callout_kinds"] == 8 and ref["concepts"] == len(CONCEPTS)


def test_the_approved_guide_passes_with_anchors():
    html = _anchored(reference_html())
    assert compare(profile(html), _ref()).ok


def test_missing_anchors_fail():
    verdict = compare(_ref(), _ref())
    assert not verdict.ok
    assert any("anchors" in p for p in verdict.problems)


def test_fewer_callouts_fail_even_though_some_remain():
    html = _anchored(reference_html())
    kept = iter(range(1000))
    html = re.sub(r'<div data-type="callout".*?</div>',
                  lambda m: "" if next(kept) % 2 else m.group(0), html, flags=re.S)
    new = profile(html)
    assert new["callouts"] > 0                      # a yes/no floor would pass
    verdict = compare(new, _ref())
    assert not verdict.ok and any(p.startswith("callouts") for p in verdict.problems)


def test_shallower_sections_fail():
    """Every heading kept, half the words under each — the E6 shape."""
    html = _anchored(reference_html())
    html = re.sub(r"<li>(.*?)</li>", lambda m: "<li>" + m.group(1)[: len(m.group(1)) // 3]
                  + "</li>", html, flags=re.S)
    html = re.sub(r"<p>(.*?)</p>", lambda m: "<p>" + m.group(1)[: len(m.group(1)) // 3]
                  + "</p>", html, flags=re.S)
    new, ref = profile(html), _ref()
    assert new["sections"] == ref["sections"]
    verdict = compare(new, ref)
    assert any(p.startswith("depth") for p in verdict.problems)


def test_a_dropped_concept_is_named():
    html = _anchored(reference_html()).replace("Bellman", "B.").replace("bellman", "b.")
    verdict = compare(profile(html), _ref())
    assert any("Bellman" in p for p in verdict.problems)


def test_richer_than_the_reference_passes():
    html = _anchored(reference_html())
    extra = '<div data-type="callout" data-callout-type="TIP"><p>more</p></div>' * 10
    assert compare(profile(html + extra), _ref()).ok


def test_truncation_and_invented_callouts_fail():
    html = _anchored(reference_html())
    assert "cut off at the output cap" in compare(profile(html), _ref(),
                                                  truncated=True).problems
    bad = html + '<div data-type="callout" data-callout-type="EXAMPLE"><p>x</p></div>'
    assert "unknown callout types" in compare(profile(bad), _ref()).problems


def test_blocknote_shapes():
    html = blocks_to_html([
        {"type": "heading", "props": {"level": 5, "isToggleable": True},
         "content": [{"type": "text", "text": "Q"}],
         "children": [{"type": "paragraph", "content": [{"type": "text", "text": "A"}]}]},
        {"type": "callout", "props": {"calloutType": "TIP"}, "content": [],
         "children": [{"type": "math", "props": {"latex": "x^2"}}]},
        {"type": "table", "content": {"type": "tableContent", "rows": [
            {"cells": [{"type": "tableCell", "content": [{"type": "text", "text": "a"}]},
                       [{"type": "text", "text": "b"}]]}]}},
    ])
    p = profile(html)
    assert p["subsections"] == 1 and p["toggles_with_body"] == 1
    assert p["callouts"] == 1 and p["math"] == 1 and p["tables"] == 1
