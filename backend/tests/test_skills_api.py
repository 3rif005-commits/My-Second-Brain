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
