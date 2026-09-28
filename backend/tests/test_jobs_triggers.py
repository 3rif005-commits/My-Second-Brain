"""'When I add a source here' (5.3, milestone 4): the debounce, the fire, the
dedupe, and the edge cases the spec calls out."""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from services.ai.providers import Provider
from services.jobs import queue as job_queue
from services.jobs import triggers
from services.workspace import processor
from tests.fake_db import FakeDB

pytestmark = pytest.mark.usefixtures("hermetic_planning")

NOW = datetime(2026, 9, 28, 22, 0, tzinfo=timezone.utc)
PROVIDER = Provider("openai_compatible", chat_model="free-model", capabilities={"text"})
PRICED = {"skill": "flashcards", "usd": 0.02, "model": "free-model", "runnable": None}


def _trigger(**over):
    row = {"id": "t1", "user_id": "u1", "note_id": "n1", "kind": "source_added",
           "skill": "flashcards", "enabled": True, "next_check_at": None, "last_run_at": None}
    return {**row, **over}


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB(ai_job_triggers=[_trigger()],
                  notes=[{"id": "n1", "deleted_at": None}],
                  note_resources=[{"id": "s1", "note_id": "n1", "status": "ready", "order_index": 0}])
    monkeypatch.setattr(triggers, "ready_sources", lambda nid: [
        r for r in fake.tables["note_resources"] if r["note_id"] == nid and r["status"] == "ready"])
    monkeypatch.setattr(job_queue, "pick", lambda *a, **k: PROVIDER)
    monkeypatch.setattr(job_queue.skill_run, "chat_skills", lambda *a, **k: [PRICED])
    with patch("services.database.get_supabase", return_value=fake):
        yield fake


def _row(db, tid="t1"):
    return next(r for r in db.tables["ai_job_triggers"] if r["id"] == tid)


# ── the debounce ──────────────────────────────────────────────────────────────

def test_a_settle_pushes_the_fire_time_forward(db):
    triggers.touch_settle("n1", NOW)
    assert _row(db)["next_check_at"] == (NOW + triggers.SETTLE_DELAY).isoformat()
    later = NOW + timedelta(minutes=1)
    triggers.touch_settle("n1", later)                          # a second file lands
    assert _row(db)["next_check_at"] == (later + triggers.SETTLE_DELAY).isoformat()


def test_a_settle_on_a_note_with_no_trigger_does_nothing(db):
    triggers.touch_settle("no-such-note", NOW)                  # must not raise
    assert _row(db)["next_check_at"] is None


def test_a_disabled_trigger_is_never_touched(db):
    _row(db)["enabled"] = False
    triggers.touch_settle("n1", NOW)
    assert _row(db)["next_check_at"] is None


# ── firing ──────────────────────────────────────────────────────────────────

def test_dropping_three_sources_produces_exactly_one_job(db):
    db.tables["note_resources"] += [
        {"id": "s2", "note_id": "n1", "status": "ready", "order_index": 1},
        {"id": "s3", "note_id": "n1", "status": "ready", "order_index": 2}]
    for t in (NOW, NOW + timedelta(seconds=10), NOW + timedelta(seconds=20)):
        triggers.touch_settle("n1", t)                          # three settles, close together
    fire_at = NOW + timedelta(seconds=20) + triggers.SETTLE_DELAY
    created = triggers.fire_due(fire_at)
    assert len(created) == 1
    job = created[0]
    assert job["trigger"] == "source_added" and job["trigger_id"] == "t1"
    assert sorted(job["source_ids"]) == ["s1", "s2", "s3"]
    assert job["dedupe_key"] == "flashcards:n1:s1,s2,s3"
    assert _row(db)["next_check_at"] is None and _row(db)["last_run_at"] == fire_at.isoformat()


def test_a_trigger_not_yet_due_does_not_fire(db):
    triggers.touch_settle("n1", NOW)
    assert triggers.fire_due(NOW + timedelta(seconds=30)) == []


def test_a_source_still_pending_reschedules_instead_of_firing_early(db):
    db.tables["note_resources"].append({"id": "s2", "note_id": "n1", "status": "processing", "order_index": 1})
    triggers.touch_settle("n1", NOW)
    fire_at = NOW + triggers.SETTLE_DELAY
    assert triggers.fire_due(fire_at) == []
    assert _row(db)["next_check_at"] == (fire_at + triggers.SETTLE_DELAY).isoformat()   # waits for it too


def test_a_note_where_every_source_failed_fires_nothing(db):
    db.tables["note_resources"][0]["status"] = "failed"
    triggers.touch_settle("n1", NOW)
    assert triggers.fire_due(NOW + triggers.SETTLE_DELAY) == []


def test_a_deleted_note_clears_its_trigger_instead_of_firing(db):
    db.tables["notes"][0]["deleted_at"] = NOW.isoformat()
    triggers.touch_settle("n1", NOW)
    assert triggers.fire_due(NOW + triggers.SETTLE_DELAY) == []
    assert not any(r["note_id"] == "n1" for r in db.tables["ai_job_triggers"])


def test_a_blocked_job_is_quietly_skipped_not_raised(db):
    job_queue.skill_run.chat_skills = lambda *a, **k: [{**PRICED, "runnable": "no sources are ready yet"}]
    triggers.touch_settle("n1", NOW)
    assert triggers.fire_due(NOW + triggers.SETTLE_DELAY) == []


def test_a_skill_that_stopped_being_eligible_is_skipped(db, monkeypatch):
    monkeypatch.setattr(job_queue, "eligible_skill", lambda name: None)
    triggers.touch_settle("n1", NOW)
    assert triggers.fire_due(NOW + triggers.SETTLE_DELAY) == []


# ── dedupe: a second settle of the same source set does not run it twice ─────

def test_the_same_source_set_is_not_queued_twice(db):
    triggers.touch_settle("n1", NOW)
    first = triggers.fire_due(NOW + triggers.SETTLE_DELAY)
    assert len(first) == 1
    later = NOW + timedelta(hours=1)
    triggers.touch_settle("n1", later)                          # fires again, same sources
    second = triggers.fire_due(later + triggers.SETTLE_DELAY)
    assert second == []                                         # already covered — no new row
    assert len(db.tables["ai_jobs"]) == 1
    assert _row(db)["last_run_at"] == (later + triggers.SETTLE_DELAY).isoformat()   # still recorded as "ran"


def test_a_new_source_after_the_first_job_queues_a_second_one(db):
    triggers.touch_settle("n1", NOW)
    triggers.fire_due(NOW + triggers.SETTLE_DELAY)
    db.tables["note_resources"].append({"id": "s2", "note_id": "n1", "status": "ready", "order_index": 1})
    later = NOW + timedelta(hours=1)
    triggers.touch_settle("n1", later)
    created = triggers.fire_due(later + triggers.SETTLE_DELAY)
    assert len(created) == 1 and created[0]["dedupe_key"] == "flashcards:n1:s1,s2"


def test_an_applied_job_no_longer_counts_as_covering_the_same_sources(db):
    """The result was already put in the note — a re-run must be possible."""
    triggers.touch_settle("n1", NOW)
    job = triggers.fire_due(NOW + triggers.SETTLE_DELAY)[0]
    for r in db.tables["ai_jobs"]:
        if r["id"] == job["id"]:
            r["status"] = "applied"
    later = NOW + timedelta(hours=1)
    triggers.touch_settle("n1", later)
    created = triggers.fire_due(later + triggers.SETTLE_DELAY)
    assert len(created) == 1


# ── a stale claim never double-fires ─────────────────────────────────────────

def test_a_touch_that_lands_mid_fire_is_not_lost(db):
    """`due()` read the trigger before a settle pushed it further; the claim's
    guard must lose to the newer write, not fire on the stale snapshot."""
    triggers.touch_settle("n1", NOW)
    stale = triggers.due(NOW + triggers.SETTLE_DELAY)[0]
    triggers.touch_settle("n1", NOW + timedelta(seconds=90))     # a second file lands, mid-tick
    assert triggers.fire_one(stale, NOW + triggers.SETTLE_DELAY) is None
    assert not db.tables.get("ai_jobs")
    assert _row(db)["next_check_at"] == (NOW + timedelta(seconds=90) + triggers.SETTLE_DELAY).isoformat()


# ── the rail's settings ───────────────────────────────────────────────────────

def test_setting_and_clearing_the_trigger(db):
    triggers.clear_trigger("n1", "u1")
    assert triggers.get("n1", "u1") is None
    row = triggers.set_trigger("n1", "u1", "flashcards")
    assert row["skill"] == "flashcards" and row["enabled"] is True
    changed = triggers.set_trigger("n1", "u1", "study-guide")    # picking again edits, not duplicates
    assert changed["skill"] == "study-guide"
    assert len([r for r in db.tables["ai_job_triggers"] if r["note_id"] == "n1"]) == 1
    assert triggers.clear_trigger("n1", "u1") is True
    assert triggers.get("n1", "u1") is None


# ── processor.py wiring ───────────────────────────────────────────────────────

def test_a_source_that_fails_still_counts_as_settling():
    with patch.object(processor, "touch_settle") as ts:
        processor._touch_settle_safely("n1")
    ts.assert_called_once_with("n1")


def test_a_touch_settle_failure_does_not_propagate():
    with patch.object(processor, "touch_settle", side_effect=RuntimeError("db down")):
        processor._touch_settle_safely("n1")                    # must not raise


def test_no_note_id_is_a_quiet_no_op():
    with patch.object(processor, "touch_settle") as ts:
        processor._touch_settle_safely(None)
    ts.assert_not_called()
