"""Schedules (harness 5.3, milestone 5): cadence math is reused from
`services/db/templates.py`; this file owns the policy on top of it — catch-up
collapses to the latest occurrence, skip-if-unchanged, the two ways a
schedule pauses itself, and CRUD.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from services.ai.providers import Provider
from services.jobs import caps, queue as job_queue, schedule, store
from services.workspace import synthesis
from tests.fake_db import FakeDB

pytestmark = pytest.mark.usefixtures("hermetic_planning")

# A Sunday. Weekly cadences below anchor on it so "next week" lands exactly 7 days later.
NOW = datetime(2026, 9, 27, 22, 0, tzinfo=timezone.utc)
PROVIDER = Provider("openai_compatible", chat_model="free-model", capabilities={"text"})
PRICED = {"skill": "flashcards", "usd": 0.10, "model": "free-model", "runnable": None}
DAILY = {"frequency": "daily", "time_of_day": "22:00", "start_date": "2026-09-20"}
WEEKLY = {"frequency": "weekly", "weekdays": [7], "time_of_day": "22:00", "start_date": "2026-09-06"}


def _trigger(**over):
    row = {"id": "t1", "user_id": "u1", "note_id": "n1", "kind": "schedule", "skill": "flashcards",
           "cadence": WEEKLY, "month_cap_usd": 1.00, "enabled": True, "paused_reason": None,
           "paused_kind": None, "next_check_at": NOW.isoformat(), "last_run_at": None,
           "last_source_signature": None}
    return {**row, **over}


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB(ai_job_triggers=[_trigger()], notes=[{"id": "n1", "deleted_at": None}],
                  note_resources=[{"id": "s1", "note_id": "n1", "status": "ready", "order_index": 0,
                                   "updated_at": "2026-09-01T00:00:00Z"}])
    monkeypatch.setattr(schedule, "ready_sources", lambda nid: [
        r for r in fake.tables["note_resources"] if r["note_id"] == nid and r["status"] == "ready"])
    monkeypatch.setattr(schedule, "source_signature", lambda nid: ",".join(sorted(
        f"{r['id']}:{r.get('updated_at', '')}" for r in fake.tables["note_resources"]
        if r["note_id"] == nid and r["status"] == "ready")))
    monkeypatch.setattr(job_queue, "pick", lambda *a, **k: PROVIDER)
    monkeypatch.setattr(job_queue.skill_run, "chat_skills", lambda *a, **k: [PRICED])
    with patch("services.database.get_supabase", return_value=fake):
        yield fake


def _row(db, tid="t1"):
    return next(r for r in db.tables["ai_job_triggers"] if r["id"] == tid)


def _jobs(db, trigger_id="t1"):
    return [r for r in db.tables.get("ai_jobs", []) if r.get("trigger_id") == trigger_id]


# ── cadence math is reused, not reinvented ────────────────────────────────────

def test_normalizing_fills_in_todays_date_and_rejects_what_the_form_does_not_offer():
    cadence = schedule.normalize_cadence({"frequency": "weekly", "weekdays": [7], "time_of_day": "22:00"})
    assert cadence["start_date"] and cadence["interval"] == 1
    with pytest.raises(schedule.ScheduleError, match="daily or weekly"):
        schedule.normalize_cadence({"frequency": "monthly", "time_of_day": "22:00"})
    with pytest.raises(schedule.ScheduleError, match="day of the week"):
        schedule.normalize_cadence({"frequency": "weekly", "time_of_day": "22:00"})
    with pytest.raises(schedule.ScheduleError, match="a time"):
        schedule.normalize_cadence({"frequency": "daily"})


# ── firing, catch-up, dedupe by the claim guard ───────────────────────────────

def test_a_due_weekly_schedule_fires_once_and_reschedules_a_week_out(db):
    created = schedule.fire_due(NOW)
    assert len(created) == 1
    job = created[0]
    assert job["trigger"] == "schedule" and job["trigger_id"] == "t1"
    assert job["created_at"] == NOW.isoformat()               # the run is logged AT its occurrence
    assert _row(db)["next_check_at"] == (NOW + timedelta(days=7)).isoformat()
    assert _row(db)["last_run_at"] == NOW.isoformat()
    assert _row(db)["last_source_signature"] == "s1:2026-09-01T00:00:00Z"


def test_not_yet_due_does_not_fire(db):
    _row(db)["next_check_at"] = (NOW + timedelta(hours=1)).isoformat()
    assert schedule.fire_due(NOW) == []


def test_a_stale_claim_does_not_double_fire(db):
    row = schedule.due(NOW)[0]
    _row(db)["next_check_at"] = (NOW + timedelta(minutes=5)).isoformat()   # changed after due() read it
    assert schedule.fire_one(row, NOW) is None
    assert _jobs(db) == []


def test_missing_a_week_asleep_runs_only_the_latest_and_logs_the_rest_skipped(db):
    # A valid past occurrence (a Sunday 22:00) three weeks before `NOW`, itself
    # also a Sunday 22:00: 3 occurrences (this one plus two more) fall due by
    # the time the app wakes, so 2 are logged missed and only the latest runs.
    _row(db)["next_check_at"] = (NOW - timedelta(days=21)).isoformat()
    created = schedule.fire_due(NOW)
    assert len(created) == 1
    jobs = _jobs(db)
    skipped = [j for j in jobs if j["status"] == "skipped"]
    assert len(skipped) == 3
    assert all(j["error"] == "Skipped — missed while the app was off" for j in skipped)
    assert all(j["actual_usd"] == 0 for j in skipped)
    assert sorted(j["run_after"] for j in skipped) == [
        (NOW - timedelta(days=21)).isoformat(), (NOW - timedelta(days=14)).isoformat(),
        (NOW - timedelta(days=7)).isoformat()]
    ran = [j for j in jobs if j["status"] != "skipped"][0]
    assert ran["run_after"] == NOW.isoformat()                              # the latest due occurrence
    assert _row(db)["next_check_at"] == (NOW + timedelta(days=7)).isoformat()


def test_a_few_hours_late_is_not_a_missed_occurrence(db):
    """The due instant itself is unchanged (a real Sunday 22:00); the app just
    woke up a couple of hours later, well short of the next weekly occurrence."""
    woke_at = NOW + timedelta(hours=2)
    created = schedule.fire_due(woke_at)
    assert len(created) == 1 and _jobs(db) == created           # no skip rows at all
    assert created[0]["run_after"] == NOW.isoformat()


# ── skip if unchanged ─────────────────────────────────────────────────────────

def test_unchanged_sources_are_skipped_at_no_cost(db):
    _row(db)["last_source_signature"] = "s1:2026-09-01T00:00:00Z"           # already matches the fixture
    created = schedule.fire_due(NOW)
    assert created == []
    jobs = _jobs(db)
    assert len(jobs) == 1 and jobs[0]["status"] == "skipped"
    assert jobs[0]["error"] == "Skipped — nothing new since last run" and jobs[0]["actual_usd"] == 0
    assert _row(db)["last_run_at"] == NOW.isoformat()


def test_a_re_extracted_source_is_not_unchanged(db):
    db.tables["note_resources"][0]["updated_at"] = "2026-09-15T00:00:00Z"
    _row(db)["last_source_signature"] = "s1:2026-09-01T00:00:00Z"
    created = schedule.fire_due(NOW)
    assert len(created) == 1


def test_the_first_ever_run_is_never_treated_as_unchanged(db):
    assert _row(db)["last_source_signature"] is None
    created = schedule.fire_due(NOW)
    assert len(created) == 1


def test_nothing_ready_yet_is_skipped_with_the_reason_not_run_as_an_error(db):
    db.tables["note_resources"][0]["status"] = "processing"
    job_queue.skill_run.chat_skills = lambda *a, **k: [{**PRICED, "runnable": "no sources are ready yet"}]
    created = schedule.fire_due(NOW)
    assert created == []
    job = _jobs(db)[0]
    assert job["status"] == "skipped" and "no sources are ready yet" in job["error"]


# ── the two pauses ─────────────────────────────────────────────────────────────

def test_three_unopened_results_in_a_row_pauses_the_schedule(db):
    for i in range(3):
        store.create("u1", note_id="n1", skill="flashcards", trigger="schedule", trigger_id="t1",
                    status="ready", opened_at=None, run_after=NOW.isoformat())
    created = schedule.fire_due(NOW)
    assert created == []
    assert _row(db)["paused_kind"] == "unopened"
    assert _row(db)["paused_reason"] == "Paused — you haven't opened the last 3 results"
    assert len(_jobs(db)) == 3                                              # no new row for the pause itself


def test_one_opened_result_among_the_last_three_does_not_pause(db):
    store.create("u1", note_id="n1", skill="flashcards", trigger="schedule", trigger_id="t1",
                status="ready", opened_at=NOW.isoformat())
    store.create("u1", note_id="n1", skill="flashcards", trigger="schedule", trigger_id="t1",
                status="ready", opened_at=None)
    created = schedule.fire_due(NOW)
    assert len(created) == 1
    assert _row(db)["paused_kind"] is None


def test_an_unopened_pause_stays_until_the_user_resumes(db):
    for i in range(3):
        store.create("u1", note_id="n1", skill="flashcards", trigger="schedule", trigger_id="t1",
                    status="ready", opened_at=None)
    schedule.fire_due(NOW)
    assert _row(db)["paused_kind"] == "unopened"
    later = NOW + timedelta(days=7)
    _row(db)["next_check_at"] = later.isoformat()
    schedule.fire_due(later)                                                # still paused — same 3 unopened
    assert _row(db)["paused_kind"] == "unopened"
    schedule.resume("t1", "u1")
    assert _row(db)["paused_kind"] is None and _row(db)["paused_reason"] is None
    later2 = later + timedelta(days=7)
    _row(db)["next_check_at"] = later2.isoformat()
    created = schedule.fire_due(later2)
    assert len(created) == 1                                                 # runs again after Resume


def test_going_over_the_monthly_cap_pauses_with_the_resume_date(db):
    store.create("u1", note_id="n1", skill="flashcards", trigger="schedule", trigger_id="t1",
                status="applied", actual_usd=0.95, created_at=NOW.isoformat())
    created = schedule.fire_due(NOW)                                        # $0.95 spent + $0.10 estimate > $1.00
    assert created == []
    assert _row(db)["paused_kind"] == "month_cap"
    assert _row(db)["paused_reason"] == "Paused — reached $1.00 this month. Resumes Oct 1"


def test_a_month_cap_pause_lifts_on_its_own_once_the_next_month_starts(db):
    store.create("u1", note_id="n1", skill="flashcards", trigger="schedule", trigger_id="t1",
                status="applied", actual_usd=0.95, created_at=NOW.isoformat())
    schedule.fire_due(NOW)
    assert _row(db)["paused_kind"] == "month_cap"
    october = datetime(2026, 10, 4, 22, 0, tzinfo=timezone.utc)
    _row(db)["next_check_at"] = october.isoformat()
    created = schedule.fire_due(october)                                    # a new month: spend resets
    assert len(created) == 1
    assert _row(db)["paused_kind"] is None and _row(db)["paused_reason"] is None


def test_an_unpriced_run_never_trips_the_monthly_cap(db):
    job_queue.skill_run.chat_skills = lambda *a, **k: [{**PRICED, "usd": None}]
    created = schedule.fire_due(NOW)
    assert len(created) == 1                                                # refusing on an unknown price is the wrong failure


def test_a_deleted_note_disables_the_schedule(db):
    db.tables["notes"][0]["deleted_at"] = NOW.isoformat()
    created = schedule.fire_due(NOW)
    assert created == []
    assert _row(db)["enabled"] is False and _row(db)["paused_reason"] == "the note was deleted"


# ── CRUD ───────────────────────────────────────────────────────────────────────

def test_creating_seeds_the_first_occurrence_and_rejects_a_bad_skill(db):
    row = schedule.create_schedule("u1", "n1", "flashcards", WEEKLY, 2.00)
    assert row["month_cap_usd"] == 2.00 and row["next_check_at"]
    with pytest.raises(schedule.ScheduleError):
        schedule.create_schedule("u1", "n1", "define-terms", WEEKLY)        # a selection skill


def test_changing_the_cadence_reschedules_from_now_not_from_the_old_one():
    with patch("services.database.get_supabase") as gs:
        gs.return_value.table.return_value.insert.return_value.execute.return_value.data = [_trigger()]
        row = schedule.create_schedule("u1", "n1", "flashcards", WEEKLY)
    fake = FakeDB(ai_job_triggers=[row])
    with patch("services.database.get_supabase", return_value=fake):
        updated = schedule.update_schedule(row["id"], "u1", cadence=DAILY)
    assert updated["cadence"]["frequency"] == "daily"
    assert updated["next_check_at"] != row["next_check_at"]


def test_listing_scopes_to_the_user_and_deleting_removes_the_row(db):
    schedule.create_schedule("u2", "n1", "flashcards", WEEKLY)
    assert len(schedule.list_schedules("u1")) == 1
    assert len(schedule.list_schedules("u2")) == 1
    assert schedule.delete_schedule("t1", "u1") is True
    assert schedule.list_schedules("u1") == []
    assert schedule.delete_schedule("does-not-exist", "u1") is False


def test_a_strangers_schedule_is_untouchable(db):
    assert schedule.update_schedule("t1", "intruder", month_cap_usd=5) is None
    assert schedule.delete_schedule("t1", "intruder") is False
    assert schedule.resume("t1", "intruder") is None
