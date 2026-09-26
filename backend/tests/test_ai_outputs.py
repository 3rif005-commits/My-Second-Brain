"""E12: what the AI put into a note is kept, best effort, so edits can be
learned from later. It never stands between the user and their note."""
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

H = {"Authorization": "Bearer fake"}


def _client(db):
    from main import app
    return (patch("routers.note_sources.get_user_id", return_value="u1"),
            patch("routers.note_sources._own_note", return_value={"id": "n1"}),
            patch("routers.note_sources.get_supabase", return_value=db), TestClient(app))


def test_the_ai_version_is_recorded():
    db = MagicMock()
    a, b, c, tc = _client(db)
    with a, b, c:
        r = tc.post("/notes/n1/ai-outputs", headers=H, json={"skill": "study-guide", "html": "<h1>x</h1>"})
    assert r.json() == {"recorded": True}
    db.table.assert_called_with("ai_outputs")
    assert db.table.return_value.insert.call_args[0][0] == {
        "user_id": "u1", "note_id": "n1", "skill": "study-guide", "html": "<h1>x</h1>"}


def test_before_the_migration_it_says_no_and_does_not_fail():
    db = MagicMock()
    db.table.return_value.insert.return_value.execute.side_effect = Exception(
        'relation "ai_outputs" does not exist')
    a, b, c, tc = _client(db)
    with a, b, c:
        r = tc.post("/notes/n1/ai-outputs", headers=H, json={"skill": "study-guide", "html": "x"})
    assert r.status_code == 200 and r.json() == {"recorded": False}
