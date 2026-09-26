"""E12: the student's own style — a file of the study-guide skill, added
AFTER the instructions (which never change). Empty means no change at all."""
from unittest.mock import patch

from prompts._skill_text import skill_body
from prompts.note_synthesis import build_note_synthesis_prompt, cache_split, student_style

SRC = [{"title": "L", "kind": "pdf", "text": "[page 1]\nbagging"}]


def _with_style(tmp_path, text):
    ref = tmp_path / "study-guide" / "reference"
    ref.mkdir(parents=True)
    (ref / "style.md").write_text(text + "\n", encoding="utf-8")
    return patch("prompts._skill_text.USER_SKILLS_DIR", tmp_path)


def test_the_shipped_file_changes_nothing():
    assert student_style() == ""
    assert "STUDENT'S OWN STYLE" not in build_note_synthesis_prompt(SRC)


def test_a_preference_is_added_after_the_unchanged_instructions(tmp_path):
    with _with_style(tmp_path, "<!-- note to self -->\nNo analogy boxes.\nEnd chapters with Key takeaways."):
        prompt = build_note_synthesis_prompt(SRC)
        assert student_style() == "No analogy boxes.\nEnd chapters with Key takeaways."
    assert prompt.startswith(skill_body("study-guide"))            # byte for byte
    assert prompt.index("No analogy boxes.") > prompt.index("SOURCE-INDEXED SYNC ANCHORS")
    assert "note to self" not in prompt                             # comments stay out


def test_the_style_sits_in_the_cached_fixed_part(tmp_path):
    with _with_style(tmp_path, "No analogy boxes."):
        fixed, rest = cache_split(build_note_synthesis_prompt(SRC))
    assert "No analogy boxes." in fixed and "bagging" in rest


def test_only_comments_is_empty(tmp_path):
    with _with_style(tmp_path, "<!--\nexplain\n-->\n   "):
        assert student_style() == ""


def test_the_style_is_repeated_at_the_very_end(tmp_path):
    with _with_style(tmp_path, "End each chapter with Key takeaways."):
        prompt = build_note_synthesis_prompt(SRC)
    assert prompt.rstrip().endswith("End each chapter with Key takeaways.")
    assert prompt.count("End each chapter with Key takeaways.") == 2
