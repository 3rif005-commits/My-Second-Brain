"""Spending ceilings. The run log says what something cost; a budget stops it
before the bill arrives."""
import pytest

from services.ai import budget as budget_guard
from services.ai import usage as usage_log
from services.ai.budget import BudgetExceeded


def test_a_run_that_would_exceed_the_cap_is_refused_before_it_is_sent():
    with budget_guard.limit(0.10):
        with pytest.raises(BudgetExceeded) as e:
            budget_guard.check(0.25, what="Writing this note")
    message = str(e.value)
    assert "$0.25" in message and "$0.10" in message   # the numbers, not just "too big"
    assert "MAX_USD_PER_RUN" in message                # and how to change it


def test_a_run_inside_the_cap_proceeds():
    with budget_guard.limit(0.10):
        budget_guard.check(0.04)          # no exception


def test_an_unpriced_model_never_trips_the_cap():
    """Refusing work because our price list is incomplete would be the wrong
    failure — the call is counted, not blocked."""
    with budget_guard.limit(0.10) as b:
        budget_guard.check(None)
        budget_guard.record(None)
    assert b.unpriced_calls == 1
    assert b.spent_usd == 0.0


def test_spend_accumulates_and_reports_exceeded():
    with budget_guard.limit(0.10) as b:
        budget_guard.record(0.06)
        assert b.exceeded is False
        assert b.remaining_usd == pytest.approx(0.04)
        budget_guard.record(0.05)
        assert b.exceeded is True


def test_no_cap_means_no_ceiling():
    with budget_guard.limit(None) as b:
        budget_guard.record(100.0)
        assert b.exceeded is False
        assert b.remaining_usd is None


def test_nested_budgets_charge_the_outer_one_too():
    with budget_guard.limit(1.00) as outer:
        with budget_guard.limit(0.10) as inner:
            budget_guard.record(0.08)
        assert inner.spent_usd == pytest.approx(0.08)
        assert outer.spent_usd == pytest.approx(0.08)
        # and the inner ceiling is gone again
        assert budget_guard.current() is outer


def test_recording_outside_any_budget_is_a_no_op():
    budget_guard.record(5.0)          # must not raise


def test_a_tracked_call_charges_the_budget(monkeypatch):
    """The wiring that matters: usage.track feeds the budget, so nothing has
    to remember to do it by hand."""
    monkeypatch.setattr("services.database.get_supabase",
                        lambda: (_ for _ in ()).throw(RuntimeError("no db")))
    with budget_guard.limit(1.00) as b:
        with usage_log.track("anthropic", "claude-haiku-4-5"):
            usage_log.report(input_tokens=1_000_000, output_tokens=0)
    assert b.spent_usd == pytest.approx(1.0)
