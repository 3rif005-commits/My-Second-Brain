"""AI ingest must be able to fill the blank note it just created. The source text is untrusted,
so the permission gate held brain.update_note for approval the ingest dialog can't give, and
the deployed site showed "Note created!" over an empty note."""
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from models.agent import Tier
from services.agent import permissions
from services.agent.permissions import Allow, NeedsApproval, approval_key


def test_ingest_pre_approves_writes_to_its_own_new_note_only():
    seen = {}

    async def fake_turn(request, user_id, skill_registry):
        seen["approvals"] = request.approvals
        yield {"type": "done"}

    with patch("routers.agent_ingest.get_user_id", return_value="user-1"), \
         patch("routers.agent_ingest._create_stub_note", return_value="new-note"), \
         patch("routers.agent_ingest.run_ingest_turn", side_effect=fake_turn), \
         patch("routers.agent_ingest.index_note"), \
         patch("routers.agent_ingest._get_registry", return_value=MagicMock()):
        from main import app
        res = TestClient(app).post("/agent/ingest", headers={"Authorization": "Bearer x"},
                                   files={"file": ("a.txt", b"Osmosis moves water.", "text/plain")})
    assert res.status_code == 200
    assert sorted(seen["approvals"]) == ["brain.patch_note:new-note", "brain.update_note:new-note"]


def test_the_gate_allows_that_note_and_still_asks_for_any_other():
    approvals = {approval_key("brain.update_note", {"id": "new-note"})}
    own = permissions.check("brain.update_note", Tier.INTERNAL_API, {"id": "new-note"}, None,
                            untrusted_context=True, approvals=approvals)
    other = permissions.check("brain.update_note", Tier.INTERNAL_API, {"id": "a-real-note"}, None,
                              untrusted_context=True, approvals=approvals)
    assert isinstance(own, Allow)
    assert isinstance(other, NeedsApproval)
