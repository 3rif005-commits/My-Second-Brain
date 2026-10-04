"""Background jobs: the state machine, with a real (in-memory) table.

The rules that matter: a job is handed to exactly one runner, a cancelled job
never runs, a failure is recorded with its reason rather than lost, a finished
job leaves a result waiting (never a note change), and a job whose process died
does not stay 'running' forever.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from services.ai.budget import BudgetExceeded
from services.jobs import store, worker
from tests.fake_db import FakeDB

pytestmark = pytest.mark.usefixtures("hermetic_planning")

NOW = datetime(2026, 9, 28, 22, 0, tzinfo=timezone.utc)
RESULT = {"skill": "flashcards", "title": "Flashcards", "html": "<p>cards</p>",
          "source_ids": ["s1"], "truncated": False, "method": None, "check": None,
          "input_tokens": 100, "output_tokens": 50, "usd": 0.04}


def _job(**over):
    row = {"id": "j1", "user_id": "u1", "note_id": "n1", "skill": "flashcards",
           "focus": "", "status": "queued", "attempts": 0,
           "run_after": (NOW - timedelta(seconds=30)).isoformat(),
           "provider_batch_id": None, "started_at": None}
    return {**row, **over}


@pytest.fixture
def db():
    fake = FakeDB(ai_jobs=[_job()],
                  notes=[{"id": "n1", "title": "Lecture 10", "deleted_at": None}])
    with patch("services.database.get_supabase", return_value=fake):
        yield fake


def _row(db, jid="j1"):
    return next(r for r in db.tables["ai_jobs"] if r["id"] == jid)


def test_a_due_job_runs_and_leaves_a_result_waiting(db):
    with patch.object(worker.skill_run, "produce_skill_result", return_value=RESULT) as run:
        events = worker.run_due(NOW)

    row = _row(db)
    assert row["status"] == "ready"
    assert row["result_html"] == "<p>cards</p>" and row["actual_usd"] == 0.04
    assert row["ran_late"] is False
    assert [e["kind"] for e in events] == ["ready"]
    # attributed to background, so the run log can tell it from a live run
    assert run.call_args.kwargs["trigger"] == "background"


def test_a_job_that_is_not_due_yet_waits(db):
    _row(db)["run_after"] = (NOW + timedelta(hours=1)).isoformat()
    with patch.object(worker.skill_run, "produce_skill_result") as run:
        assert worker.run_due(NOW) == []
    run.assert_not_called()
    assert _row(db)["status"] == "queued"


def test_a_job_started_long_after_its_time_says_it_ran_late(db):
    _row(db)["run_after"] = (NOW - timedelta(hours=8)).isoformat()   # the app was closed
    with patch.object(worker.skill_run, "produce_skill_result", return_value=RESULT):
        worker.run_due(NOW)
    assert _row(db)["ran_late"] is True


def test_two_ticks_never_run_the_same_job_twice(db):
    with patch.object(worker.skill_run, "produce_skill_result", return_value=RESULT) as run:
        worker.run_due(NOW)
        worker.run_due(NOW)
    assert run.call_count == 1


def test_a_lost_claim_runs_nothing(db):
    """Another tick claimed it between our SELECT and our UPDATE."""
    job = store.due(NOW.isoformat())[0]
    _row(db)["status"] = "submitted"
    with patch.object(worker.skill_run, "produce_skill_result") as run:
        assert worker.run_one(job, NOW) is None
    run.assert_not_called()


def test_a_cancelled_job_never_runs(db):
    _row(db)["status"] = "cancelled"
    with patch.object(worker.skill_run, "produce_skill_result") as run:
        assert worker.run_due(NOW) == []
    run.assert_not_called()


def test_a_failure_is_recorded_with_its_reason(db):
    with patch.object(worker.skill_run, "produce_skill_result",
                      side_effect=ValueError("Flashcards: no sources are ready yet.")):
        events = worker.run_due(NOW)
    row = _row(db)
    assert row["status"] == "failed" and "no sources are ready" in row["error"]
    assert events[0]["kind"] == "failed"


def test_going_over_the_limit_is_blocked_not_failed(db):
    with patch.object(worker.skill_run, "produce_skill_result",
                      side_effect=BudgetExceeded("Not started — about $0.62 is over the $0.50 limit")):
        events = worker.run_due(NOW)
    assert _row(db)["status"] == "budget_blocked"
    assert events[0]["kind"] == "budget_blocked"


def test_a_deleted_note_cancels_the_job_without_calling_a_model(db):
    db.tables["notes"][0]["deleted_at"] = "2026-09-28T10:00:00+00:00"
    with patch.object(worker.skill_run, "produce_skill_result") as run:
        events = worker.run_due(NOW)
    run.assert_not_called()
    row = _row(db)
    assert row["status"] == "cancelled" and row["cancel_reason"] == "the note was deleted"
    assert events[0]["kind"] == "cancelled"


def test_cancelled_while_running_drops_the_result(db):
    def cancel_midway(*a, **kw):
        store.transition("j1", store.CANCELLABLE, status="cancelled", cancel_reason="by you")
        return RESULT
    with patch.object(worker.skill_run, "produce_skill_result", side_effect=cancel_midway):
        events = worker.run_due(NOW)
    row = _row(db)
    assert row["status"] == "cancelled" and not row.get("result_html")
    assert events == []


def test_a_job_whose_process_died_is_failed_not_left_running(db):
    row = _row(db)
    row.update(status="submitted", started_at=(NOW - timedelta(hours=2)).isoformat())
    events = worker.run_due(NOW)
    assert _row(db)["status"] == "failed"
    assert "stopped" in _row(db)["error"]
    assert events[0]["kind"] == "failed"


def test_a_job_still_within_its_time_is_not_recovered(db):
    _row(db).update(status="submitted", started_at=(NOW - timedelta(minutes=2)).isoformat())
    assert worker.run_due(NOW) == []
    assert _row(db)["status"] == "submitted"


def test_the_worker_writes_nothing_outside_the_jobs_table(db):
    """Additive only: notes are read (is it alive?) and never written."""
    before_notes = [dict(r) for r in db.tables["notes"]]
    with patch.object(worker.skill_run, "produce_skill_result", return_value=RESULT):
        worker.run_due(NOW)
    assert db.tables["notes"] == before_notes
    # routing_policies is read (which providers the note's level allows), never written
    assert not db.tables.get("routing_policies")
    assert set(db.tables) - {"routing_policies"} <= {"ai_jobs", "notes"}


def test_the_bell_message_names_the_job_the_note_and_the_link():
    job = {"id": "j1", "note_id": "n1", "skill": "study-guide", "error": None}
    n = worker.notification_for({"kind": "ready", "job": job, "note_title": "Lecture 10"})
    assert n["message"] == 'Study guide for "Lecture 10" is ready'
    assert n["link"] == "/brain/workspace/n1?job=j1"
    assert n["source"] == "job:j1"


@pytest.mark.asyncio
async def test_a_bell_that_never_answers_does_not_hold_up_the_next_job():
    """The scheduler runs one jobs pass at a time; a hung database write here
    would stop every later job."""
    import asyncio
    from services.jobs import notify as notify_mod

    async def hang(_events):
        await asyncio.sleep(30)

    with patch.object(notify_mod, "_write", hang):
        await asyncio.wait_for(notify_mod.notify([{"kind": "ready", "job": {}}], timeout=0.05), 2)


@pytest.mark.asyncio
async def test_a_bell_error_is_swallowed():
    from services.jobs import notify as notify_mod

    async def boom(_events):
        raise RuntimeError("db down")

    with patch.object(notify_mod, "_write", boom):
        await notify_mod.notify([{"kind": "ready", "job": {}}])
