"""The drop policy (who is allowed to spend tokens unasked) and the priced
estimate that replaces the old auto-fire in the UI."""
from unittest.mock import MagicMock, patch

import pytest

from services.ai import pricing
from services.workspace import synthesis

READY = [{"id": "s1", "status": "ready"}, {"id": "s2", "status": "ready"}]
NOTE = [{"id": "n1", "user_id": "u1", "title": "Lecture 10", "content": []}]


def _db():
    """get_supabase() double where every settle-guard precondition passes, so
    the only thing that can stop a fire is the policy."""
    tables: dict = {}
    db = MagicMock()
    db.table.side_effect = lambda name: tables.setdefault(name, MagicMock())
    src = tables.setdefault("note_resources", MagicMock())
    src.select.return_value.eq.return_value.execute.return_value.data = READY
    syn = tables.setdefault("note_synthesis", MagicMock())
    syn.select.return_value.eq.return_value.execute.return_value.data = []
    notes = tables.setdefault("notes", MagicMock())
    notes.select.return_value.eq.return_value.execute.return_value.data = NOTE
    return db


# ── drop policy ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("policy", ["suggest", "nothing"])
def test_default_policy_never_spends_tokens_on_a_drop(monkeypatch, policy):
    monkeypatch.setattr(synthesis.settings, "workspace_on_drop", policy)
    with patch.object(synthesis, "get_supabase", return_value=_db()) as db, \
         patch.object(synthesis, "run_synthesis") as run:
        assert synthesis.maybe_synthesize("n1") is False
    run.assert_not_called()
    # The policy check comes before the settle queries: a drop that generates
    # nothing should not cost three round trips either.
    db.assert_not_called()


def test_auto_policy_still_fires():
    with patch.object(synthesis, "get_supabase", return_value=_db()), \
         patch.object(synthesis, "_claim", return_value=True), \
         patch.object(synthesis.settings, "workspace_on_drop", "auto"), \
         patch.object(synthesis, "run_synthesis") as run:
        assert synthesis.maybe_synthesize("n1") is True
    run.assert_called_once_with("n1", "replace")


# ── pricing ──────────────────────────────────────────────────────────────────

def test_price_lookup_handles_dated_free_and_unknown_models():
    assert pricing.price_for("claude-haiku-4-5") == (1.00, 5.00)
    assert pricing.price_for("claude-haiku-4-5-20251001") == (1.00, 5.00)
    assert pricing.price_for("nvidia/nemotron-3-super-120b-a12b:free") == (0.0, 0.0)
    # Unknown must be None, not 0.0 — "we don't know" is not "it's free".
    assert pricing.price_for("some-new-model") is None
    assert pricing.price_for(None) is None


def test_estimate_usd_prices_cached_input_at_a_tenth():
    full = pricing.estimate_usd("claude-haiku-4-5", 1_000_000, 0)
    cached = pricing.estimate_usd("claude-haiku-4-5", 0, 0,
                                  cached_input_tokens=1_000_000)
    assert full == 1.0
    assert cached == 0.1
    assert pricing.estimate_usd("claude-haiku-4-5", 0, 1_000_000) == 5.0
    assert pricing.estimate_usd("some-new-model", 100, 100) is None


# ── estimate ─────────────────────────────────────────────────────────────────

def _provider(model="claude-haiku-4-5"):
    p = MagicMock()
    p.model = model
    p.provider = "anthropic"
    return p


def test_estimate_counts_every_ready_source_and_prices_it():
    with patch.object(synthesis, "ready_sources", return_value=READY), \
         patch.object(synthesis, "source_text_from_chunks", return_value="x" * 1_000), \
         patch.object(synthesis, "pick", return_value=_provider()):
        est = synthesis.estimate_synthesis("n1", "u1")

    assert est["ready_sources"] == 2
    assert est["source_chars"] == 2_000
    assert est["truncated"] is False
    # source text + the static prompt, at ~4 chars per token
    assert est["input_tokens"] > pricing.tokens_from_chars(2_000)
    assert est["model"] == "claude-haiku-4-5"
    assert est["usd"] > 0


def test_estimate_reports_truncation_when_sources_exceed_the_budget():
    from prompts.note_synthesis import TOTAL_SOURCE_BUDGET
    with patch.object(synthesis, "ready_sources", return_value=READY), \
         patch.object(synthesis, "source_text_from_chunks",
                      return_value="x" * TOTAL_SOURCE_BUDGET), \
         patch.object(synthesis, "pick", return_value=_provider()):
        est = synthesis.estimate_synthesis("n1", "u1")

    assert est["truncated"] is True
    assert est["source_chars"] <= TOTAL_SOURCE_BUDGET


def test_estimate_without_a_provider_reports_tokens_but_no_price():
    with patch.object(synthesis, "ready_sources", return_value=[]), \
         patch.object(synthesis, "pick", return_value=None):
        est = synthesis.estimate_synthesis("n1", "u1")

    assert est["ready_sources"] == 0
    assert est["source_chars"] == 0
    assert est["model"] is None
    assert est["usd"] is None
    assert est["input_tokens"] > 0        # the static prompt still counts
    assert est["on_drop"] == synthesis.settings.workspace_on_drop
