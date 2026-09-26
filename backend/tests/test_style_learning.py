"""E12: learning the student's style from their edits. Suggestions only —
nothing reaches a guide until the student accepts it."""
from unittest.mock import patch

from services.workspace import style_learning as sl

AI = ('<h1>T</h1><h2>C</h2><div data-type="callout" data-callout-type="ANALOGY"><p>Like a dog.</p></div>'
      '<h3>S</h3><p>Bagging averages models.</p>')
MINE = '<h1>T</h1><h2>C</h2><h3>S</h3><p>Bagging averages models.</p><h4>Key takeaways</h4><li>Average</li>'


def test_the_edit_is_described_by_what_survives_the_editor():
    d = sl.describe_edits(AI, MINE)
    assert d["before"]["boxes"] == {"ANALOGY": 1} and d["after"]["boxes"] == {}
    assert "Like a dog." in d["removed"] and "Key takeaways" in d["added"]
    assert sl.changed(d)


def test_an_unedited_guide_teaches_nothing_and_calls_no_model():
    with patch("services.ai.router.complete_with_fallback") as model:
        assert sl.learn_from_pairs([(AI, AI)]) == []
    model.assert_not_called()


def test_suggestions_are_parsed_and_known_ones_skipped():
    answer = ('[{"preference": "No analogy boxes.", "evidence": "removed in 2 of 2"},'
              ' {"preference": "End each chapter with Key takeaways.", "evidence": "added in 2 of 2"}]')
    with patch("services.ai.router.complete_with_fallback", return_value=answer) as model:
        out = sl.learn_from_pairs([(AI, MINE), (AI, MINE)], existing="No analogy boxes.")
    assert [s["preference"] for s in out] == ["End each chapter with Key takeaways."]
    prompt = model.call_args[0][2][0]["content"]
    assert "GUIDE 2" in prompt and "No analogy boxes." in prompt   # knows what exists


def test_a_garbled_answer_is_no_suggestion():
    with patch("services.ai.router.complete_with_fallback", return_value="sure! [oops"):
        assert sl.learn_from_pairs([(AI, MINE)]) == []
