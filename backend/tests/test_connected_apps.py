"""Changes other apps ask for wait for the user (5.4 phase 2): approve applies
(a delete goes to the Trash), reject drops, disconnect revokes everything."""
from unittest.mock import MagicMock, patch

import pytest

from services import connected_apps as apps


def _db(pending=None, note=None):
    tables: dict = {}
    db = MagicMock()
    db.table.side_effect = lambda name: tables.setdefault(name, MagicMock())
    chg = tables.setdefault("mcp_pending_changes", MagicMock())
    q = chg.select.return_value
    q.eq.return_value.eq.return_value.eq.return_value.execute.return_value.data = pending or []
    notes = tables.setdefault("notes", MagicMock())
    notes.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = \
        [note] if note else []
    return db, tables


NOTE = {"id": "n1", "title": "T", "content_text": "old", "deleted_at": None}


def test_approving_a_delete_moves_the_note_to_the_trash():
    db, t = _db(pending=[{"id": "c1", "note_id": "n1", "action": "delete", "payload": {}}], note=NOTE)
    with patch.object(apps, "get_supabase", return_value=db):
        assert apps.decide("u1", "c1", True)["status"] == "approved"
    update = t["notes"].update.call_args[0][0]
    assert set(update) == {"deleted_at"}                        # soft: restorable
    t["notes"].delete.assert_not_called()


def test_approving_an_edit_writes_the_new_text():
    db, _ = _db(pending=[{"id": "c1", "note_id": "n1", "action": "update",
                          "payload": {"content_markdown": "# New\\n- a", "title": "Renamed"}}], note=NOTE)
    with patch.object(apps, "get_supabase", return_value=db), \
         patch("services.agent.brain_tools._update_note") as write:
        apps.decide("u1", "c1", True)
    args, user = write.call_args[0]
    assert user == "u1" and args["id"] == "n1" and args["title"] == "Renamed"
    assert args["blocks"][0]["type"] == "heading"


def test_rejecting_changes_nothing():
    db, t = _db(pending=[{"id": "c1", "note_id": "n1", "action": "delete", "payload": {}}], note=NOTE)
    with patch.object(apps, "get_supabase", return_value=db), \
         patch("services.agent.brain_tools._update_note") as write:
        assert apps.decide("u1", "c1", False)["status"] == "rejected"
    write.assert_not_called()
    t["notes"].update.assert_not_called()


def test_a_change_no_longer_waiting_is_refused():
    db, _ = _db(pending=[])
    with patch.object(apps, "get_supabase", return_value=db), pytest.raises(apps.ChangeError):
        apps.decide("u1", "c1", True)


def test_asking_about_a_note_that_is_not_theirs_is_refused():
    db, _ = _db(note=None)
    with patch.object(apps, "get_supabase", return_value=db), pytest.raises(apps.ChangeError):
        apps.propose("u1", "app", "someone-elses", "delete")
