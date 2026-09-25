"""The study-guide quality guard. The failure it exists for: a prompt change
made notes plainer (fewer boxes, less text) while every yes/no floor still
passed. Each test here is one way a plainer guide must be caught — and one
way the prompt's own run-to-run variation must NOT be."""
import re

from evals.quality_guard import (CONCEPTS, blocks_to_html, compare, defects,
                                 median_profile, profile, reference_html)


def _ref():
    return profile(reference_html())


def _anchored(html: str) -> str:
    """The saved reference lost its anchors in the editor; a generated guide
    has them."""
    return re.sub(r"<h3>", '<h3 data-anchor="1:p:1">', html)


def _drop_every_other(pattern: str, html: str) -> str:
    kept = iter(range(1000))
    return re.sub(pattern, lambda m: "" if next(kept) % 2 else m.group(0),
                  html, flags=re.S)


def test_reference_is_the_approved_guide():
    ref = _ref()
    # Read off the note the user approved; if these move, the snapshot changed.
    assert ref["chapters"] == 3 and ref["callouts"] == 24
    assert ref["tables"] == 6 and ref["math"] == 15
    assert ref["callout_kinds"] == 8 and ref["concepts"] == len(CONCEPTS)


def test_the_approved_guide_passes_against_itself():
    assert compare(_ref(), _ref()).ok


def test_fewer_callouts_fail_even_though_some_remain():
    new = profile(_drop_every_other(r'<div data-type="callout".*?</div>',
                                    reference_html()))
    assert new["callouts"] > 0                      # a yes/no floor would pass
    verdict = compare(new, _ref())
    assert not verdict.ok and any(p.startswith("callouts") for p in verdict.problems)


def test_less_text_fails():
    html = re.sub(r"<(li|p)>(.*?)</\1>",
                  lambda m: f"<{m.group(1)}>{m.group(2)[: len(m.group(2)) // 3]}</{m.group(1)}>",
                  reference_html(), flags=re.S)
    verdict = compare(profile(html), _ref())
    assert any(p.startswith("text_chars") for p in verdict.problems)


def test_more_sections_with_the_same_text_passes():
    """The prompt wrote 9 to 20 sections for the same lecture; splitting is
    not thinning."""
    html = reference_html().replace("<details><summary><h5>",
                                    "<h3>Part</h3><details><summary><h5>")
    new = profile(html)
    assert new["sections"] > 2 * _ref()["sections"]
    assert compare(new, _ref()).ok


def test_a_dropped_concept_is_named():
    html = reference_html().replace("Bellman", "B.")
    verdict = compare(profile(html), _ref())
    assert any("Bellman" in p for p in verdict.problems)


def test_one_unlucky_run_does_not_fail_the_median():
    good = _anchored(reference_html())
    unlucky = re.sub(r"<table>.*?</table>", "", good, flags=re.S)
    runs = [profile(good), profile(unlucky), profile(good)]
    assert not compare(runs[1], _ref()).ok           # alone it would fail
    assert compare(median_profile(runs), _ref()).ok


def test_a_consistent_loss_fails_the_median():
    thin = profile(_drop_every_other(r'<div data-type="callout".*?</div>',
                                     _anchored(reference_html())))
    good = profile(_anchored(reference_html()))
    assert not compare(median_profile([thin, thin, good]), _ref()).ok


def test_defects_count_on_any_run():
    good = profile(_anchored(reference_html()))
    bad = profile(reference_html()                   # no anchors
                  + '<div data-type="callout" data-callout-type="EXAMPLE"><p>x</p></div>')
    assert defects([good, good], [False, False]) == []
    found = defects([good, bad, good], [False, False, True])
    assert "run 2: unknown callout types" in found
    assert any(f.startswith("run 2: sections without page anchors") for f in found)
    assert "run 3: cut off at the output cap" in found


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
