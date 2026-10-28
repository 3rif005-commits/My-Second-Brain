"""A thread id the client sends that belongs to another account (the AI panel
keeps its tabs in the browser, across sign-ins) starts a fresh thread instead
of failing every message with a 500."""
from unittest.mock import MagicMock, patch

from models.agent import AgentRequest
from routers import agent as agent_router


def _db(own: dict | None, taken: bool):
    db = MagicMock()
    t = db.table.return_value
    (t.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value
       .execute.return_value.data) = own
    t.select.return_value.eq.return_value.execute.return_value.data = [{"id": "x"}] if taken else []
    return db


def _body(tid):
    return AgentRequest(thread_id=tid, query="hi", messages=[{"role": "user", "content": "hi"}])


def test_someone_elses_thread_id_gets_a_fresh_thread():
    db = _db(own=None, taken=True)
    with patch.object(agent_router, "get_supabase", return_value=db):
        tid = agent_router._append_user_message_to_thread("their-thread", "u1", _body("their-thread"))
    assert tid != "their-thread"
    row = db.table.return_value.insert.call_args[0][0]
    assert row["id"] == tid and row["user_id"] == "u1"
    db.table.return_value.update.assert_not_called()      # their thread is untouched


def test_a_new_id_is_used_as_given():
    db = _db(own=None, taken=False)
    with patch.object(agent_router, "get_supabase", return_value=db):
        assert agent_router._append_user_message_to_thread("new-id", "u1", _body("new-id")) == "new-id"


def test_an_own_thread_is_appended_to():
    db = _db(own={"id": "mine", "messages": []}, taken=True)
    with patch.object(agent_router, "get_supabase", return_value=db):
        assert agent_router._append_user_message_to_thread("mine", "u1", _body("mine")) == "mine"
    db.table.return_value.insert.assert_not_called()
