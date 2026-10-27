"""Settings → Skills, the editor (user, 2026-09-24): a skill is a page with an
icon, properties that the runtime honours, instructions, its reference files,
and — once edited — the original to compare against. And an edit takes effect
on the next run, without restarting the server."""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from services import skill_store
from tests.conftest import SKILL_USER, signed_in_as

H = {"Authorization": "Bearer fake"}
GUIDE = ("---\nname: study-guide\ndescription: Write a full study guide.\n"
         "surfaces: [workspace]\ninputs: sources\noutput: draft_note\n---\n\n"
         "Original guide rules.\n")
DEFINE = ("---\nname: define-terms\ndescription: Define the selected terms.\n"
          "surfaces: [selection]\ninputs: selection\noutput: insert_below\n---\n\n"
          "Define each term.\n")


@pytest.fixture
def client(tmp_path, skill_user_dir):
    user_dir, bundled = skill_user_dir, tmp_path / "bundled"
    (bundled / "study-guide" / "reference").mkdir(parents=True)
    (bundled / "study-guide" / "SKILL.md").write_text(GUIDE, encoding="utf-8")
    (bundled / "study-guide" / "reference" / "markdown-variant.md").write_text(
        "Markdown rules.\n", encoding="utf-8")
    (bundled / "define-terms").mkdir()
    (bundled / "define-terms" / "SKILL.md").write_text(DEFINE, encoding="utf-8")
    with (
        patch("routers.skills_api.get_user_id", side_effect=signed_in_as(SKILL_USER)),
        patch("routers.skills_api._BUNDLED_SKILLS_DIR", bundled),
        patch("prompts._skill_text.SKILLS_DIR", bundled),
    ):
        from main import app
        yield TestClient(app), user_dir, bundled


def _get(tc, name):
    return tc.get(f"/skills/{name}", headers=H).json()


def _save(tc, name, **changes):
    s = _get(tc, name)
    body = {"description": s["description"], "body": s["body"], **changes}
    return tc.put(f"/skills/{name}", headers=H, json=body)


def test_an_icon_is_kept(client):
    tc, _, _ = client
    assert _save(tc, "study-guide", icon="🎓").json()["icon"] == "🎓"
    assert _get(tc, "study-guide")["icon"] == "🎓"
    # and survives a later save that does not mention it
    _save(tc, "study-guide", body="Changed.")
    assert _get(tc, "study-guide")["icon"] == "🎓"


def test_a_selection_skill_can_replace_instead_of_adding_below(client):
    tc, _, _ = client
    r = _save(tc, "define-terms", output="rewrite_selection")
    assert r.status_code == 200 and r.json()["output"] == "rewrite_selection"
    # a result a skill of that kind cannot have is refused, not silently stored
    assert _save(tc, "define-terms", output="draft_note").status_code == 400
    assert _save(tc, "study-guide", output="rewrite_selection").status_code == 400


def test_reference_files_are_listed_read_and_edited_as_a_copy(client):
    tc, user_dir, bundled = client
    s = _get(tc, "study-guide")
    assert s["files"] == ["reference/markdown-variant.md", "reference/style.md"]   # every skill has Your style
    r = tc.get("/skills/study-guide/files/reference/markdown-variant.md", headers=H)
    assert r.json()["content"] == "Markdown rules.\n"
    r = tc.put("/skills/study-guide/files/reference/markdown-variant.md", headers=H,
               json={"content": "My markdown rules.\n"})
    assert r.status_code == 200
    assert (user_dir / "study-guide" / "reference" / "markdown-variant.md").read_text() == "My markdown rules.\n"
    assert (bundled / "study-guide" / "reference" / "markdown-variant.md").read_text() == "Markdown rules.\n"
    # an edited file alone makes the skill "edited", and Reset takes it back
    s = _get(tc, "study-guide")
    assert s["source"] == "edited" and s["can_reset"]
    assert tc.delete("/skills/study-guide", headers=H).status_code == 204
    assert _get(tc, "study-guide")["source"] == "bundled"


def test_files_stay_inside_the_skill_and_only_existing_ones_are_editable(client):
    tc, _, _ = client
    for bad in ["../../etc/passwd", "reference/../../x.md", "SKILL.md"]:
        assert tc.get(f"/skills/study-guide/files/{bad}", headers=H).status_code in (400, 404)
    assert tc.put("/skills/study-guide/files/reference/new.md", headers=H,
                  json={"content": "x"}).status_code == 404


def test_the_original_of_an_edited_built_in(client):
    tc, _, _ = client
    assert tc.get("/skills/study-guide/original", headers=H).status_code == 404  # not edited yet
    _save(tc, "study-guide", body="My guide.")
    o = tc.get("/skills/study-guide/original", headers=H).json()
    assert o["body"] == "Original guide rules." and o["description"] == "Write a full study guide."


def test_an_edited_study_guide_is_used_on_the_next_run_without_a_restart(client):
    tc, _, _ = client
    from prompts.note_synthesis import build_note_synthesis_prompt
    from prompts.note_synthesis_md import build_markdown_synthesis_prompt
    src = [{"title": "L1", "kind": "pdf", "text": "content"}]
    # A run happens as the note's owner (synthesis and jobs set the user).
    with skill_store.as_user(SKILL_USER):
        assert "Original guide rules." in build_note_synthesis_prompt(src)
    _save(tc, "study-guide", body="Brand new guide rules.")
    with skill_store.as_user(SKILL_USER):
        assert "Brand new guide rules." in build_note_synthesis_prompt(src)
    tc.put("/skills/study-guide/files/reference/markdown-variant.md", headers=H,
           json={"content": "Fresh markdown rules.\n"})
    with skill_store.as_user(SKILL_USER):
        assert "Fresh markdown rules." in build_markdown_synthesis_prompt(src)
    # Nobody else's run sees this user's edit — and a run with no user sees
    # only the built-in.
    from tests.conftest import OTHER_SKILL_USER
    with skill_store.as_user(OTHER_SKILL_USER):
        assert "Original guide rules." in build_note_synthesis_prompt(src)
    assert "Original guide rules." in build_note_synthesis_prompt(src)
