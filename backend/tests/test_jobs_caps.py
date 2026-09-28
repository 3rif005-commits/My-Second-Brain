"""What a background job may spend: the monthly cap, the per-job cap, and the
wording — checked before the model is called."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from services.jobs import caps, store, worker
from tests.fake_db import FakeDB

NOW = datetime(2026, 9, 28, 22, 0, tzinfo=timezone.utc)


def _runs(*amounts, when=NOW - timedelta(days=1), user="u1"):
    return [{"user_id": user, "estimated_usd": a, "created_at": when.isoformat()} for a in amounts]


@pytest.fixture
def db():
    fake = FakeDB(profiles=[{"id": "u1", "preferences": {}}],
                  ai_runs=_runs(1.00, 2.50, None))
    with patch("services.database.get_supabase", return_value=fake):
        yield fake


def test_the_default_monthly_cap_is_five_dollars(db):
    assert caps.get_monthly_cap("u1") == 5.0


def test_a_saved_cap_wins_and_keeps_the_other_preferences(db):
    db.tables["profiles"][0]["preferences"] = {"theme": "dark"}
    assert caps.set_monthly_cap("u1", 12.5) == 12.5
    assert caps.get_monthly_cap("u1") == 12.5
    assert db.tables["profiles"][0]["preferences"]["theme"] == "dark"


@pytest.mark.parametrize("bad", [0, -1, 0.001, 5000])
def test_a_silly_cap_is_refused(db, bad):
    with pytest.raises(ValueError):
        caps.set_monthly_cap("u1", bad)


def test_month_spend_counts_all_ai_this_month_for_this_user_only(db):
    db.tables["ai_runs"] += _runs(9.0, user="someone-else")
    db.tables["ai_runs"] += _runs(4.0, when=NOW - timedelta(days=40))      # last month
    assert caps.month_spend("u1", NOW) == 3.5                              # the null run is unpriced


def test_month_spend_reads_every_page(db, monkeypatch):
    monkeypatch.setattr(caps, "PAGE", 2)
    db.tables["ai_runs"] += _runs(0.5, 0.5, 0.5)                           # 6 rows → 3 pages
    assert caps.month_spend("u1", NOW) == 5.0


def test_a_job_over_its_own_limit_is_refused_with_the_numbers(db):
    why = caps.preflight("u1", 0.62, 0.50, NOW)
    assert why == "Not started — about $0.62 is over this job's $0.50 limit"


def test_a_job_that_would_pass_the_monthly_limit_is_refused_with_the_numbers(db):
    why = caps.preflight("u1", 1.60, 5.0, NOW)          # $3.50 spent + $1.60 > $5.00
    assert why == ("Not started — about $1.60 would pass your $5.00 monthly limit "
                   "($3.50 spent this month)")


def test_a_job_that_fits_starts(db):
    assert caps.preflight("u1", 1.40, 5.0, NOW) is None
    assert caps.preflight("u1", 1.50, 5.0, NOW) is None      # exactly the limit is allowed


def test_an_unpriced_model_never_trips_a_cap(db):
    """Refusing work because a price list is incomplete is the wrong failure."""
    assert caps.preflight("u1", None, 0.001, NOW) is None


def test_small_amounts_are_not_shown_as_zero():
    assert caps.money(0.004) == "$0.004" and caps.money(0.62) == "$0.62" and caps.money(0) == "$0.00"


# ── the worker refuses before it calls a model ────────────────────────────────

def _job(**over):
    row = {"id": "j1", "user_id": "u1", "note_id": "n1", "skill": "flashcards", "focus": "",
           "status": "queued", "attempts": 0, "cap_usd": 0.50, "shown_estimate_usd": 0.04,
           "run_after": (NOW - timedelta(seconds=30)).isoformat(),
           "provider_batch_id": None, "started_at": None}
    return {**row, **over}


@pytest.fixture
def wdb():
    fake = FakeDB(ai_jobs=[_job()], profiles=[{"id": "u1", "preferences": {}}],
                  notes=[{"id": "n1", "title": "Lecture 10", "deleted_at": None}],
                  ai_runs=_runs(4.99))
    with patch("services.database.get_supabase", return_value=fake):
        yield fake


def test_over_the_monthly_limit_the_model_is_never_called(wdb):
    with patch.object(worker, "_estimate_now", return_value=0.10), \
         patch.object(worker.skill_run, "produce_skill_result") as run:
        events = worker.run_due(NOW)
    run.assert_not_called()
    row = wdb.tables["ai_jobs"][0]
    assert row["status"] == "budget_blocked" and "monthly limit" in row["error"]
    assert events[0]["kind"] == "budget_blocked"
    assert "monthly limit" in worker.notification_for(events[0])["message"]


def test_the_price_is_taken_again_when_the_job_starts(wdb):
    """Queued at $0.04; the model changed and it is $0.62 now: the limit is judged on $0.62."""
    with patch.object(worker.skill_run, "chat_skills",
                      return_value=[{"skill": "flashcards", "usd": 0.62}]), \
         patch.object(worker.skill_run, "produce_skill_result") as run:
        worker.run_due(NOW)
    run.assert_not_called()
    assert "over this job's $0.50 limit" in wdb.tables["ai_jobs"][0]["error"]


def test_a_job_within_every_limit_runs(wdb):
    wdb.tables["ai_runs"].clear()
    result = {"skill": "flashcards", "title": "Flashcards", "html": "<p>x</p>", "source_ids": [],
              "usd": 0.04}
    with patch.object(worker, "_estimate_now", return_value=0.04), \
         patch.object(worker.skill_run, "produce_skill_result", return_value=result):
        worker.run_due(NOW)
    assert wdb.tables["ai_jobs"][0]["status"] == "ready"


def test_when_the_price_cannot_be_read_the_queued_estimate_is_used(wdb):
    with patch.object(worker.skill_run, "chat_skills", side_effect=RuntimeError("db down")):
        assert worker._estimate_now(_job()) == 0.04


# ── retention ─────────────────────────────────────────────────────────────────

def test_retention_removes_old_unapplied_results_and_old_rows():
    day = lambda n: (NOW - timedelta(days=n)).isoformat()
    fake = FakeDB(ai_jobs=[
        _job(id="old-ready", status="ready", finished_at=day(31), created_at=day(31), result_html="<p>x</p>"),
        _job(id="new-ready", status="ready", finished_at=day(2), created_at=day(2), result_html="<p>y</p>"),
        _job(id="ancient", status="applied", created_at=day(91)),
        _job(id="recent-applied", status="applied", created_at=day(10)),
        _job(id="ancient-queued", status="queued", created_at=day(120)),     # never swept while waiting
    ])
    with patch("services.database.get_supabase", return_value=fake):
        done = store.sweep(NOW)
    rows = {r["id"]: r for r in fake.tables["ai_jobs"]}
    assert done == {"results_removed": 1, "rows_deleted": 1}
    assert rows["old-ready"]["status"] == "discarded" and rows["old-ready"]["result_html"] is None
    assert "30 days" in rows["old-ready"]["error"]
    assert rows["new-ready"]["result_html"] == "<p>y</p>"
    assert "ancient" not in rows and "recent-applied" in rows and "ancient-queued" in rows


def test_the_sweep_runs_at_most_every_six_hours(wdb):
    worker._last_sweep = None
    with patch.object(store, "sweep", return_value={}) as sweep:
        worker.maybe_sweep(NOW)
        worker.maybe_sweep(NOW + timedelta(hours=1))
        worker.maybe_sweep(NOW + timedelta(hours=7))
    assert sweep.call_count == 2
