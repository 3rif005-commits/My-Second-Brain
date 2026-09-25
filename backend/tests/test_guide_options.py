"""E9 made a user choice: how a guide from several sources is written is a
setting of the study-guide skill, a word in one run's command, and a quality
check on the result card — nothing is forced."""
from unittest.mock import patch

from services.workspace import synthesis
from services.workspace.chat import summarize_result
from services.workspace.guide_check import check_guide
from services.workspace.skill_run import split_method


# ── choosing the method ─────────────────────────────────────────────────────

def test_the_run_s_word_wins_then_the_setting_then_automatic():
    with patch("prompts._skill_text.skill_meta", return_value={"multi_source": "single"}):
        assert synthesis.resolve_method(5) == "single"              # the setting
        assert synthesis.resolve_method(5, "chapters") == "chapters"  # the run's word
    with patch("prompts._skill_text.skill_meta", return_value={}):
        assert synthesis.resolve_method(3) == "chapters"            # automatic, 3+
        assert synthesis.resolve_method(2) == "single"
    with patch("prompts._skill_text.skill_meta", return_value={"multi_source": "chapters"}):
        assert synthesis.resolve_method(1) == "chapters"            # even one long lecture


def test_a_broken_setting_file_means_automatic():
    with patch("prompts._skill_text.skill_meta", side_effect=OSError("gone")):
        assert synthesis.resolve_method(3) == "chapters"


def test_method_words():
    assert split_method("deep focus on PCA") == ("chapters", "focus on PCA")
    assert split_method("quick") == ("single", "")
    assert split_method("Deeply explain PCA") == (None, "Deeply explain PCA")
    assert split_method("") == (None, "")


# ── the check on the card ───────────────────────────────────────────────────

SLIDES = [{"title": "L8", "text": "\n".join(f"[page {p}]\n" + "x" * 500 for p in range(1, 11))},
          {"title": "L9", "text": "\n".join(f"[page {p}]\n" + "y" * 500 for p in range(1, 11))}]


def _guide(chars_per_source: list[int]) -> str:
    body = "".join(f'<h3 data-anchor="{i}:p:1">S</h3><p>{"z" * n}</p>'
                   for i, n in enumerate(chars_per_source, start=1))
    return ('<h1>T</h1><h2>C</h2><div data-type="callout" data-callout-type="OVERVIEW">'
            '<p>o</p></div>' + body)


def test_a_thin_slide_source_is_named():
    c = check_guide(_guide([6000, 2000]), SLIDES)     # L9: 2000 chars for 5000 of slides
    assert c["thin"] == ["L9"] and c["problems"] == []


def test_a_dense_source_is_never_called_thin():
    dense = [{"title": "Book", "text": "[page 1]\n" + "w" * 9000}]    # 9000 chars on one page
    assert check_guide(_guide([2000]), dense)["thin"] == []


def test_form_problems_are_listed():
    html = '<h1>A</h1><h1>B</h1><h2>No overview</h2><h3>unanchored</h3>'
    problems = check_guide(html, SLIDES[:1], truncated=True)["problems"]
    assert "the guide should have exactly one title" in problems
    assert "1 chapter(s) without an Overview box" in problems
    assert "cut off at the length limit" in problems


def test_the_assistant_hears_about_a_thin_source():
    result = {"html": "<h2>a</h2>", "check": {"thin": ["L9"]}}
    assert "may be thin on “L9”" in summarize_result(result)


# ── bad page links (seen live on a chaptered guide) ─────────────────────────

from services.workspace.anchors import drop_bad_anchors, repair_anchors  # noqa: E402

TWO = [{"title": "L8", "text": "[page 1]\nbagging bootstrap aggregating ensembles\n[page 2]\nboosting adaboost"},
       {"title": "L9", "text": "[page 1]\nkmeans clustering centroids elbow\n[page 2]\nprincipal components variance"}]


def test_a_malformed_or_foreign_link_is_removed():
    html = ('<h3 data-anchor="2:p:1-2">A</h3><h3 data-anchor="4:p:1">B</h3>'
            '<h3 data-anchor="0:p:1">C</h3><h3 data-anchor="1:p:2">D</h3>')
    out, n = drop_bad_anchors(html, 2)
    assert n == 3 and out.count("data-anchor") == 1 and 'data-anchor="1:p:2"' in out


def test_repair_then_points_the_section_at_the_right_source():
    html = '<h3 data-anchor="7:p:1-3">Clustering</h3><p>kmeans clustering centroids elbow</p>'
    out, n = repair_anchors(html, TWO)
    assert 'data-anchor="2:p:1"' in out and out.count("data-anchor") == 1 and n >= 1


def test_on_thin_evidence_the_bad_link_goes_and_nothing_is_guessed():
    html = '<h3 data-anchor="7:p:1-3">Clustering</h3><p>kmeans</p>'
    out, _ = repair_anchors(html, TWO)
    assert "data-anchor" not in out


def test_a_good_guide_is_unchanged():
    html = ('<h3 data-anchor="1:p:2">Boosting</h3><p>boosting adaboost</p>'
            '<h3 data-anchor="2:p:1">Clustering</h3><p>kmeans clustering centroids</p>')
    assert repair_anchors(html, TWO) == (html, 0)


def test_the_check_names_the_bad_links():
    html = ('<h1>T</h1><h2>C</h2><div data-type="callout" data-callout-type="OVERVIEW"><p>o</p></div>'
            '<h3 data-anchor="5:p:1">x</h3>')
    problems = check_guide(html, TWO)["problems"]
    assert any(p.startswith("some page links point nowhere (") and "5:p:1" in p for p in problems)


def test_without_sources_no_link_is_judged():
    html = '<h3 data-anchor="1:p:3">A</h3>'
    assert drop_bad_anchors(html, 0) == (html, 0)
    assert repair_anchors(html, []) == (html, 0)
