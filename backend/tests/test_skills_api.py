"""Settings → Skills: every skill listed, built-ins editable as a user copy,
Reset brings the original back (user decision, 2026-09-24)."""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

H = {"Authorization": "Bearer fake"}
GUIDE = ("---\nname: study-guide\ndescription: Write a full study guide.\n"
         "surfaces: [workspace]\ninputs: sources\noutput: draft_note\npriority: 5\n---\n\n"
         "Rich HTML instructions.\n  Indented line kept.\n")


@pytest.fixture
def client(tmp_path):
    user_dir = tmp_path / "user_skills"
    user_dir.mkdir()
    bundled_dir = tmp_path / "bundled_skills"
    bundled_dir.mkdir()
    (bundled_dir / "cite-everything.md").write_text(
        "---\nname: cite-everything\ndescription: Always cite sources\n---\nCite every claim.\n",
        encoding="utf-8")
    (bundled_dir / "study-guide").mkdir()
    (bundled_dir / "study-guide" / "SKILL.md").write_text(GUIDE, encoding="utf-8")
    with (
        patch("routers.skills_api.get_user_id", return_value="user-1"),
        patch("routers.skills_api._BUNDLED_SKILLS_DIR", bundled_dir),
        patch("routers.skills_api._USER_SKILLS_DIR", user_dir),
    ):
        from main import app
        yield TestClient(app), user_dir, bundled_dir


def _get(tc, name):
    return {s["name"]: s for s in tc.get("/skills", headers=H).json()["skills"]}[name]


def test_every_skill_is_listed_with_where_it_runs(client):
    tc, _, _ = client
    skills = {s["name"]: s for s in tc.get("/skills", headers=H).json()["skills"]}
    assert skills["study-guide"]["where"] == "chat"          # a folder skill, listed
    assert skills["cite-everything"]["where"] == "assistant"
    assert skills["study-guide"]["source"] == "bundled"
    assert skills["study-guide"]["body"] == "Rich HTML instructions.\n  Indented line kept."


def test_editing_a_built_in_saves_a_copy_that_wins(client):
    tc, user_dir, bundled_dir = client
    s = _get(tc, "study-guide")
    r = tc.put("/skills/study-guide", headers=H,
               json={"description": s["description"], "body": s["body"] + "\nMy extra rule."})
    assert r.status_code == 200 and r.json()["source"] == "edited" and r.json()["can_reset"]
    assert (user_dir / "study-guide" / "SKILL.md").exists()
    assert "My extra rule." in _get(tc, "study-guide")["body"]
    assert (bundled_dir / "study-guide" / "SKILL.md").read_text(encoding="utf-8") == GUIDE
    assert _get(tc, "study-guide")["where"] == "chat"           # still a chat job


def test_saving_unchanged_is_byte_identical(client):
    tc, user_dir, _ = client
    s = _get(tc, "study-guide")
    tc.put("/skills/study-guide", headers=H, json={"description": s["description"], "body": s["body"]})
    assert _get(tc, "study-guide")["body"] == s["body"]


def test_reset_brings_the_original_back(client):
    tc, user_dir, _ = client
    s = _get(tc, "study-guide")
    tc.put("/skills/study-guide", headers=H, json={"description": s["description"], "body": "changed"})
    assert tc.delete("/skills/study-guide", headers=H).status_code == 204
    back = _get(tc, "study-guide")
    assert back["source"] == "bundled" and back["body"] == s["body"]
    assert not (user_dir / "study-guide").exists()


def test_a_built_in_cannot_be_deleted(client):
    tc, _, _ = client
    assert tc.delete("/skills/study-guide", headers=H).status_code == 403


def test_a_new_skill_can_be_a_chat_job_or_a_selection_action(client):
    tc, user_dir, _ = client
    r = tc.post("/skills", headers=H, json={"name": "exam-questions",
                "description": "Write exam questions.", "body": "Write 5 questions.", "where": "chat"})
    assert r.status_code == 201 and r.json()["where"] == "chat" and r.json()["source"] == "user"
    r = tc.post("/skills", headers=H, json={"name": "simplify",
                "description": "Say it simply.", "body": "Rewrite simply.", "where": "selection"})
    assert r.json()["where"] == "selection" and r.json()["output"] == "insert_below"
    assert tc.post("/skills", headers=H, json={"name": "study-guide", "description": "x",
                   "body": "y", "where": "chat"}).status_code == 409
    assert tc.delete("/skills/simplify", headers=H).status_code == 204
    assert not (user_dir / "simplify").exists()


def test_a_bad_name_or_place_is_refused(client):
    tc, _, _ = client
    assert tc.post("/skills", headers=H, json={"name": "Bad Name", "description": "d",
                   "body": "b"}).status_code == 400
    assert tc.post("/skills", headers=H, json={"name": "ok-name", "description": "d",
                   "body": "b", "where": "everywhere"}).status_code == 400
def test_selection_skills_carry_their_prompt(client):
    tc, _, _ = client
    res = tc.get("/skills/surface/selection", headers={"Authorization": "Bearer fake"})
    assert res.status_code == 200
    skills = {s["name"]: s for s in res.json()["skills"]}
    assert skills["define-terms"]["output"] == "insert_below"
    assert "bulleted list" in skills["define-terms"]["prompt"]


# ── E9: "Several sources" on the study guide ────────────────────────────────

def test_the_study_guide_shows_its_several_sources_setting(client):
    tc, _, _ = client
    assert _get(tc, "study-guide")["multi_source"] == "auto"
    assert _get(tc, "cite-everything")["multi_source"] is None     # nothing to show


def test_the_setting_is_saved_and_the_instructions_stay_byte_identical(client):
    tc, user_dir, _ = client
    s = _get(tc, "study-guide")
    r = tc.put("/skills/study-guide", headers=H,
               json={"description": s["description"], "body": s["body"], "multi_source": "chapters"})
    assert r.status_code == 200 and r.json()["multi_source"] == "chapters"
    assert _get(tc, "study-guide")["body"] == s["body"]
    copy = (user_dir / "study-guide" / "SKILL.md").read_text(encoding="utf-8")
    assert "multi_source: chapters" in copy
    # the runtime reads the same file
    with patch("prompts._skill_text.USER_SKILLS_DIR", user_dir):
        from prompts._skill_text import skill_body, skill_meta
        assert skill_meta("study-guide")["multi_source"] == "chapters"
        assert skill_body("study-guide") == s["body"]


def test_back_to_automatic_removes_the_key(client):
    tc, user_dir, _ = client
    s = _get(tc, "study-guide")
    for value in ("single", "auto"):
        tc.put("/skills/study-guide", headers=H,
               json={"description": s["description"], "body": s["body"], "multi_source": value})
    assert "multi_source" not in (user_dir / "study-guide" / "SKILL.md").read_text(encoding="utf-8")
    assert _get(tc, "study-guide")["multi_source"] == "auto"


def test_editing_the_text_keeps_the_setting(client):
    tc, _, _ = client
    s = _get(tc, "study-guide")
    tc.put("/skills/study-guide", headers=H,
           json={"description": s["description"], "body": s["body"], "multi_source": "single"})
    tc.put("/skills/study-guide", headers=H,
           json={"description": s["description"], "body": s["body"] + "\nMore."})   # no setting sent
    assert _get(tc, "study-guide")["multi_source"] == "single"


def test_a_wrong_value_or_skill_is_refused(client):
    tc, _, _ = client
    s = _get(tc, "study-guide")
    assert tc.put("/skills/study-guide", headers=H, json={
        "description": s["description"], "body": s["body"], "multi_source": "always"}).status_code == 400
    c = _get(tc, "cite-everything")
    assert tc.put("/skills/cite-everything", headers=H, json={
        "description": c["description"], "body": c["body"], "multi_source": "chapters"}).status_code == 400


# ── E12 for every skill: "Your style" ───────────────────────────────────────

def test_every_skill_has_a_style_file_even_before_it_is_written(client):
    tc, _, _ = client
    assert "reference/style.md" in _get(tc, "cite-everything")["files"]
    r = tc.get("/skills/cite-everything/files/reference/style.md", headers=H)
    assert r.status_code == 200 and "<!--" in r.json()["content"]      # the explanation


def test_a_style_saved_for_any_skill_is_what_the_runtime_reads(client):
    tc, user_dir, _ = client
    r = tc.put("/skills/cite-everything/files/reference/style.md", headers=H,
               json={"content": "<!-- mine -->\nCite with page numbers.\n"})
    assert r.status_code == 200
    with patch("prompts._skill_text.USER_SKILLS_DIR", user_dir):
        from prompts._skill_text import skill_style, with_style
        assert skill_style("cite-everything") == "Cite with page numbers."
        assert with_style("cite-everything", "Cite every claim.").startswith("Cite every claim.")
        assert "Cite with page numbers." in with_style("cite-everything", "Cite every claim.")


def test_only_a_job_can_learn_from_edits(client):
    tc, _, _ = client
    assert tc.post("/skills/cite-everything/learn-style", headers=H).status_code == 400
