"""Tests for `GET /notes/{note_id}/blocks/{block_id}` — the citation hover
card's block-fetch endpoint (work item E).

The card renders the cited block itself, so the endpoint must return raw
BlockNote JSON (props, children and all), not extracted text: there is no
Python-side BlockNote renderer, and "looks identical to the note" is the
whole requirement.
"""
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

AUTH = {"Authorization": "Bearer fake"}

PARAGRAPH = {
    "id": "blk-1",
    "type": "paragraph",
    "props": {"textColor": "default", "textAlignment": "left"},
    "content": [{"type": "text", "text": "Gradient descent steps downhill.", "styles": {}}],
    "children": [],
}
CALLOUT = {
    "id": "blk-callout",
    "type": "callout",
    "props": {"color": "blue", "icon": "💡"},
    "content": [],
    "children": [
        {"id": "blk-nested", "type": "paragraph",
         "content": [{"type": "text", "text": "nested", "styles": {}}], "children": []},
        {"id": "blk-nested-2", "type": "paragraph",
         "content": [{"type": "text", "text": "nested two", "styles": {}}], "children": []},
    ],
}
AFTER = {
    "id": "blk-after",
    "type": "paragraph",
    "props": {},
    "content": [{"type": "text", "text": "Momentum smooths the path.", "styles": {}}],
    "children": [],
}
NOTE_ROW = {
    "id": "note-1",
    "title": "Optimization",
    "icon": "📐",
    "content": [PARAGRAPH, CALLOUT, AFTER],
}


def _db(rows):
    """get_supabase() whose notes select(...).eq.eq.is_.execute yields `rows`."""
    db = MagicMock()
    (db.table.return_value.select.return_value.eq.return_value.eq.return_value
       .is_.return_value.execute.return_value.data) = rows
    return db


@pytest.fixture
def client():
    with patch("routers.notes.get_user_id", return_value="user-1"):
        from main import app
        yield TestClient(app)


def test_returns_the_raw_block_json(client):
    with patch("routers.notes.get_supabase", return_value=_db([NOTE_ROW])):
        res = client.get("/notes/note-1/blocks/blk-1", headers=AUTH)

    assert res.status_code == 200
    body = res.json()
    assert body["block_id"] == "blk-1"
    assert body["note_id"] == "note-1"
    assert body["note_title"] == "Optimization"
    assert body["note_icon"] == "📐"
    # Not a text summary — the frontend needs real BlockNote JSON to render.
    assert body["blocks"][body["target_index"]] == PARAGRAPH


def test_returns_the_cited_block_with_its_neighbours(client):
    # A block alone is often not self-sufficient, so the card shows the
    # passage around it and marks which block was cited.
    with patch("routers.notes.get_supabase", return_value=_db([NOTE_ROW])):
        res = client.get("/notes/note-1/blocks/blk-callout", headers=AUTH)

    body = res.json()
    ids = [b["id"] for b in body["blocks"]]
    assert ids == ["blk-1", "blk-callout", "blk-after"]
    assert body["blocks"][body["target_index"]]["id"] == "blk-callout"


def test_the_window_never_runs_past_the_start_of_the_note(client):
    # First block: nothing precedes it, so the window starts at it and
    # target_index is 0 rather than pointing at a block that isn't there.
    with patch("routers.notes.get_supabase", return_value=_db([NOTE_ROW])):
        res = client.get("/notes/note-1/blocks/blk-1", headers=AUTH)

    body = res.json()
    assert [b["id"] for b in body["blocks"]] == ["blk-1", "blk-callout", "blk-after"]
    assert body["target_index"] == 0


def test_the_window_never_runs_past_the_end_of_the_note(client):
    with patch("routers.notes.get_supabase", return_value=_db([NOTE_ROW])):
        res = client.get("/notes/note-1/blocks/blk-after", headers=AUTH)

    body = res.json()
    assert [b["id"] for b in body["blocks"]] == ["blk-1", "blk-callout", "blk-after"]
    assert body["target_index"] == 2


def test_a_nested_block_gets_its_own_siblings_not_the_top_level_ones(client):
    # The neighbours come from the list the target actually sits in, so a
    # block inside a callout previews with that callout's other children.
    with patch("routers.notes.get_supabase", return_value=_db([NOTE_ROW])):
        res = client.get("/notes/note-1/blocks/blk-nested", headers=AUTH)

    body = res.json()
    assert [b["id"] for b in body["blocks"]] == ["blk-nested", "blk-nested-2"]
    assert body["target_index"] == 0


def test_a_container_block_keeps_its_children(client):
    with patch("routers.notes.get_supabase", return_value=_db([NOTE_ROW])):
        res = client.get("/notes/note-1/blocks/blk-callout", headers=AUTH)

    assert res.status_code == 200
    body = res.json()
    cited = body["blocks"][body["target_index"]]
    assert cited["children"][0]["id"] == "blk-nested"


def test_a_nested_block_is_reachable_by_id(client):
    with patch("routers.notes.get_supabase", return_value=_db([NOTE_ROW])):
        res = client.get("/notes/note-1/blocks/blk-nested", headers=AUTH)

    assert res.status_code == 200
    body = res.json()
    assert body["blocks"][body["target_index"]]["type"] == "paragraph"


def test_unknown_block_id_is_404(client):
    with patch("routers.notes.get_supabase", return_value=_db([NOTE_ROW])):
        res = client.get("/notes/note-1/blocks/does-not-exist", headers=AUTH)

    assert res.status_code == 404
    assert res.json()["detail"] == "Block not found"


def test_a_note_the_user_does_not_own_is_404_not_a_leak(client):
    # The query filters on (id, user_id), so someone else's note comes back
    # as no rows — indistinguishable from a note that doesn't exist.
    db = _db([])
    with patch("routers.notes.get_supabase", return_value=db):
        res = client.get("/notes/someone-elses-note/blocks/blk-1", headers=AUTH)

    assert res.status_code == 404
    assert res.json()["detail"] == "Note not found"
    db.table.return_value.select.return_value.eq.assert_called_once_with("id", "someone-elses-note")
    (db.table.return_value.select.return_value.eq.return_value
       .eq.assert_called_once_with("user_id", "user-1"))


def test_a_note_with_no_content_is_a_block_404_not_a_crash(client):
    with patch("routers.notes.get_supabase",
               return_value=_db([{**NOTE_ROW, "content": None}])):
        res = client.get("/notes/note-1/blocks/blk-1", headers=AUTH)

    assert res.status_code == 404
    assert res.json()["detail"] == "Block not found"


def test_an_untitled_note_still_previews(client):
    # `title` is nullable in the DB; the card shows it as the card's source
    # label, so a null must not blow up response-model validation.
    with patch("routers.notes.get_supabase",
               return_value=_db([{**NOTE_ROW, "title": None, "icon": None}])):
        res = client.get("/notes/note-1/blocks/blk-1", headers=AUTH)

    assert res.status_code == 200
    assert res.json()["note_title"] == "Untitled"
    assert res.json()["note_icon"] == "📄"


def test_the_route_does_not_shadow_get_note(client):
    """`/notes/{note_id}` is registered before this route; adding a deeper
    path under the same prefix must not change which handler either URL
    reaches."""
    single = MagicMock()
    (single.table.return_value.select.return_value.eq.return_value.eq.return_value
       .is_.return_value.single.return_value.execute.return_value.data) = {
        "id": "note-1", "user_id": "user-1", "title": "Optimization",
        "content": [], "is_indexed": False,
        "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
    }
    with patch("routers.notes.get_supabase", return_value=single):
        res = client.get("/notes/note-1", headers=AUTH)

    assert res.status_code == 200
    assert res.json()["id"] == "note-1"


def test_the_preview_carries_when_the_note_was_last_edited(client):
    # The card shows how current the cited source is; a citation to a note
    # untouched for a year reads differently from one edited this morning.
    row = {**NOTE_ROW, "updated_at": "2026-09-10T08:30:00+00:00"}
    with patch("routers.notes.get_supabase", return_value=_db([row])):
        res = client.get("/notes/note-1/blocks/blk-1", headers=AUTH)

    assert res.status_code == 200
    assert res.json()["updated_at"] == "2026-09-10T08:30:00+00:00"


def test_a_note_without_updated_at_still_previews(client):
    with patch("routers.notes.get_supabase", return_value=_db([NOTE_ROW])):
        res = client.get("/notes/note-1/blocks/blk-1", headers=AUTH)

    assert res.status_code == 200
    assert res.json()["updated_at"] is None


def test_a_whole_note_link_previews_its_opening_passage_unmarked(client):
    # `/brain/{id}` without a block: the card shows how the note begins.
    with patch("routers.notes.get_supabase", return_value=_db([NOTE_ROW])):
        res = client.get("/notes/note-1/blocks/_top", headers=AUTH)

    body = res.json()
    assert [b["id"] for b in body["blocks"]] == ["blk-1", "blk-callout", "blk-after"]
    assert body["target_index"] == -1
