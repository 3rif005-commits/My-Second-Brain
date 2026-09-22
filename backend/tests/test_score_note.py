"""The deterministic scorer. Every assertion here is a regression this project
has actually seen: nested content missed by top-level counting, an invented
callout type rendering as silent grey, an anchor pointing at a source that
isn't attached, a toggle with nothing inside it."""
from evals.score_note import CALLOUT_TYPES, score_note

SAMPLE = """
<h1>Bias and Variance</h1>
<h2>Chapter 1</h2>
<div data-type="callout" data-callout-type="OVERVIEW">
  <details><summary>Overview</summary><ul><li>What it is</li></ul></details>
</div>
<h3 data-anchor="1:p:4">Definitions</h3>
<details><summary><h5>Observed error</h5></summary>
  <p>The error we measure.</p>
  <div data-type="math">E = \\sigma^2</div>
  <details><summary><h6>Worked example</h6></summary><p>Nested body.</p></details>
</details>
<h3 data-anchor="2:t:754">From the lecture</h3>
<div data-type="callout" data-callout-type="EXAMPLE"><p>invented type</p></div>
<table><tr><th>a</th></tr><tr><td>b</td></tr></table>
<details><summary><h5>Empty promise</h5></summary></details>
"""


def test_it_walks_into_children():
    s = score_note(SAMPLE, source_count=2)
    # h6 lives two levels down inside toggles; top-level counting missed it once.
    assert s.headings == {"h1": 1, "h2": 1, "h3": 2, "h5": 2, "h6": 1}
    assert s.math_blocks == 1
    assert s.toggles == 4


def test_a_toggle_with_no_body_is_not_counted_as_working():
    s = score_note(SAMPLE, source_count=2)
    assert s.toggles_with_body == 3     # the "Empty promise" one has no content


def test_an_invented_callout_type_is_a_defect_not_a_detail():
    s = score_note(SAMPLE, source_count=2)
    assert s.callout_total == 2
    assert s.unknown_callouts == ["EXAMPLE"]
    assert "OVERVIEW" in CALLOUT_TYPES


def test_anchors_are_validated_against_the_attached_sources():
    s = score_note(SAMPLE, source_count=2)
    assert s.anchors_valid == 2
    assert s.grounding == 1.0

    fewer = score_note(SAMPLE, source_count=1)
    assert fewer.anchors_valid == 1
    assert "out of range" in fewer.anchor_problems[0]
    assert fewer.grounding == 0.5


def test_malformed_anchors_are_reported_not_silently_dropped():
    s = score_note('<h3 data-anchor="page 4">X</h3>', source_count=1)
    assert s.anchors_valid == 0
    assert "malformed" in s.anchor_problems[0]
    assert s.grounding == 0.0


def test_unanchored_sections_lower_grounding():
    s = score_note('<h3>No anchor</h3><h3 data-anchor="1:s:2">Anchored</h3>',
                   source_count=1)
    assert s.grounding == 0.5


def test_must_mention_matching_ignores_markup_and_whitespace():
    s = score_note("<p>The <b>observed</b>\n error is noise.</p>",
                   must_mention=["observed", "irreducible error"])
    assert s.must_mention_hit == ["observed"]
    assert s.must_mention_missed == ["irreducible error"]
    assert s.must_mention_rate == 0.5


def test_empty_input_scores_zero_without_crashing():
    s = score_note("")
    assert s.heading_total == 0 and s.anchor_validity == 1.0
    assert s.as_dict()["math_blocks"] == 0
