"""E8: every note with text gets indexed, whatever wrote it. The sweep picks
notes whose CONTENT changed (migration 021) — never by time, since indexing
itself bumps updated_at."""
from unittest.mock import MagicMock, patch

from services import index_sweep

ROWS = [{"id": "n1", "user_id": "u1", "content_hash": "h1", "local_only": False},
        {"id": "n2", "user_id": "u2", "content_hash": "h2", "local_only": True}]


def _db(rows=None, rpc_error=None):
    db = MagicMock()
    if rpc_error:
        db.rpc.return_value.execute.side_effect = rpc_error
    else:
        db.rpc.return_value.execute.return_value.data = rows or []
    return db


def test_changed_notes_are_indexed():
    db = _db(ROWS)
    with patch.object(index_sweep, "get_supabase", return_value=db), \
         patch("services.indexer.index_note", return_value=True) as idx:
        assert index_sweep.sweep_once() == 2
    assert [c.args for c in idx.call_args_list] == [("n1", "u1"), ("n2", "u2")]
    name, args = db.rpc.call_args[0]
    assert name == "notes_needing_index" and args["quiet_seconds"] == 120


def test_a_failed_note_does_not_stop_the_rest():
    db = _db(ROWS)
    with patch.object(index_sweep, "get_supabase", return_value=db), \
         patch("services.indexer.index_note", side_effect=[RuntimeError("down"), True]):
        assert index_sweep.sweep_once() == 1


def test_before_the_migration_it_warns_once_and_does_nothing(caplog):
    index_sweep._missing_warned = False
    err = Exception("Could not find the function public.notes_needing_index (PGRST202)")
    with patch.object(index_sweep, "get_supabase", return_value=_db(rpc_error=err)), \
         patch("services.indexer.index_note") as idx:
        assert index_sweep.sweep_once() == 0
        assert index_sweep.sweep_once() == 0
    idx.assert_not_called()
    assert sum("021_note_index_tracking" in r.message for r in caplog.records) == 1


def test_it_never_starts_under_pytest():
    assert index_sweep.start() is None
