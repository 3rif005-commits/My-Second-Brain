"""Approval gate: destructive and untrusted-context tool calls need a human.

The bug these cover: `brain.delete_note` used to be guarded by
`args["confirm"]` — an argument the MODEL writes. Since the model's context
contains text ingested from PDFs, web pages and MCP servers, a sentence inside
a user's own source could ask for the flag and satisfy the guard.
"""
import pytest

from models.agent import Tier
from services.agent.permissions import (
    Allow, Deny, NeedsApproval, approval_key, check,
)

NOTE = {"local_only": False}


def test_delete_is_not_granted_by_a_model_supplied_confirm_flag():
    decision = check("brain.delete_note", Tier.INTERNAL_API,
                     args={"id": "n1", "confirm": True}, note_meta=NOTE)
    assert isinstance(decision, NeedsApproval)
    assert decision.key == "brain.delete_note:n1"


def test_delete_proceeds_once_the_client_approves_that_exact_note():
    decision = check("brain.delete_note", Tier.INTERNAL_API,
                     args={"id": "n1"}, note_meta=NOTE,
                     approvals={"brain.delete_note:n1"})
    assert isinstance(decision, Allow)


def test_an_approval_for_one_note_does_not_delete_another():
    decision = check("brain.delete_note", Tier.INTERNAL_API,
                     args={"id": "n2"}, note_meta=NOTE,
                     approvals={"brain.delete_note:n1"})
    assert isinstance(decision, NeedsApproval)


def test_tier_denials_still_outrank_approval():
    """An approval is not a tier upgrade: external stays external."""
    decision = check("brain.delete_note", Tier.EXTERNAL,
                     args={"id": "n1"}, note_meta=NOTE,
                     approvals={"brain.delete_note:n1"})
    assert isinstance(decision, Deny)


def test_local_only_still_outranks_approval():
    decision = check("brain.update_note", Tier.INTERNAL_API,
                     args={"id": "n1", "blocks": []},
                     note_meta={"local_only": True},
                     approvals={"brain.update_note:n1"})
    assert isinstance(decision, Deny)


# ── untrusted context ────────────────────────────────────────────────────────

@pytest.mark.parametrize("tool,args", [
    ("brain.update_note", {"id": "n1", "blocks": []}),
    ("brain.move_note", {"id": "n1", "parent_id": "n9"}),
    ("brain.set_mastery", {"id": "n1", "level": 3}),
    ("brain.update_row", {"row_id": "r1", "values": {}}),
])
def test_editing_existing_data_needs_approval_after_reading_untrusted_text(tool, args):
    decision = check(tool, Tier.INTERNAL_API, args=args, note_meta=NOTE,
                     untrusted_context=True)
    assert isinstance(decision, NeedsApproval)
    assert decision.key == approval_key(tool, args)


@pytest.mark.parametrize("tool,args", [
    ("brain.update_note", {"id": "n1", "blocks": []}),
    ("brain.set_mastery", {"id": "n1", "level": 3}),
])
def test_the_same_calls_are_ungated_in_a_clean_turn(tool, args):
    assert isinstance(
        check(tool, Tier.INTERNAL_API, args=args, note_meta=NOTE,
              untrusted_context=False),
        Allow)


@pytest.mark.parametrize("tool,args", [
    ("brain.create_note", {"title": "t", "blocks": []}),
    ("brain.link_notes", {"from_id": "n1", "to_id": "n2"}),
    ("brain.search_brain", {"query": "x"}),
])
def test_additive_and_read_tools_stay_ungated(tool, args):
    """Gating these would make the assistant useless for its main job, and the
    worst an injection gets is a new note the user can delete."""
    assert isinstance(
        check(tool, Tier.INTERNAL_API, args=args, note_meta=None,
              untrusted_context=True),
        Allow)


def test_mcp_calls_need_approval_after_untrusted_text_but_not_before():
    """The exfiltration half: sending anything outward after reading untrusted
    content is the step that turns an injection into a data leak."""
    args = {"query": "everything"}
    assert isinstance(
        check("mcp.server.send", Tier.INTERNAL_API, args=args, note_meta=None,
              untrusted_context=True),
        NeedsApproval)
    assert isinstance(
        check("mcp.server.send", Tier.INTERNAL_API, args=args, note_meta=None),
        Allow)
    assert isinstance(
        check("mcp.server.send", Tier.EXTERNAL, args=args, note_meta=None),
        Deny)
