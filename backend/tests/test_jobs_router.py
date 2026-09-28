"""The jobs API: queue with a price, list, cancel, discard, applied — and who may."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from tests.fake_db import FakeDB

AUTH = {"Authorization": "Bearer fake"}
PRICED = {"skill": "flashcards", "usd": 0.04, "model": "claude-haiku-4-5", "runnable": None}


@pytest.fixture
def env():
    fake = FakeDB(notes=[{"id": "n1", "user_id": "u1", "title": "Lecture 10", "deleted_at": None},
                         {"id": "n2", "user_id": "someone-else", "title": "X", "deleted_at": None}])
    provider = SimpleNamespace(provider="anthropic")
    with patch("services.database.get_supabase", return_value=fake), \
         patch("routers.jobs.get_supabase", return_value=fake), \
         patch("routers.jobs.get_user_id", return_value="u1"), \
         patch("routers.jobs.pick", return_value=provider), \
         patch("routers.jobs.skill_run.chat_skills", return_value=[PRICED]):
        from main import app
        yield TestClient(app), fake


def _queue(client, **body):
    return client.post("/jobs", json={"note_id": "n1", "skill": "flashcards", **body}, headers=AUTH)


def test_queueing_stores_the_price_the_user_was_shown(env):
    client, db = env
    res = _queue(client, focus=" chapter 3 ")
    assert res.status_code == 200
    job = res.json()
    assert job["status"] == "queued" and job["shown_estimate_usd"] == 0.04
    assert job["price_mode"] == "normal" and job["focus"] == "chapter 3"
    assert "result_html" not in job          # a receipt, never the body


def test_a_local_model_is_marked_local(env):
    client, _ = env
    with patch("routers.jobs.pick", return_value=SimpleNamespace(provider="local")):
        assert _queue(client).json()["price_mode"] == "local"


def test_someone_elses_note_is_not_found(env):
    client, _ = env
    res = client.post("/jobs", json={"note_id": "n2", "skill": "flashcards"}, headers=AUTH)
    assert res.status_code == 404


def test_a_selection_skill_cannot_run_in_the_background(env):
    client, _ = env
    res = client.post("/jobs", json={"note_id": "n1", "skill": "define-terms"}, headers=AUTH)
    assert res.status_code == 400
    assert "cannot run in the background" in res.json()["detail"]["error"]


def test_a_job_that_cannot_run_yet_says_why(env):
    client, _ = env
    blocked = {**PRICED, "runnable": "no sources are ready yet"}
    with patch("routers.jobs.skill_run.chat_skills", return_value=[blocked]):
        res = _queue(client)
    assert res.status_code == 400
    assert "no sources are ready yet" in res.json()["detail"]["error"]


def test_a_time_in_the_past_means_now_and_too_far_out_is_refused(env):
    client, _ = env
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    ra = datetime.fromisoformat(_queue(client, run_after=past).json()["run_after"])
    assert ra > datetime.now(timezone.utc) - timedelta(minutes=1)
    far = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    assert _queue(client, run_after=far).status_code == 400
    assert _queue(client, run_after="tomorrow-ish").status_code == 400


def test_cancel_stops_a_waiting_job_and_a_finished_one_says_so(env):
    client, db = env
    jid = _queue(client).json()["id"]
    res = client.post(f"/jobs/{jid}/cancel", headers=AUTH)
    assert res.json()["status"] == "cancelled" and res.json()["cancel_reason"] == "by you"
    assert client.post(f"/jobs/{jid}/cancel", headers=AUTH).status_code == 409


def test_a_stranger_cannot_touch_the_job(env):
    client, db = env
    jid = _queue(client).json()["id"]
    with patch("routers.jobs.get_user_id", return_value="intruder"):
        assert client.post(f"/jobs/{jid}/cancel", headers=AUTH).status_code == 404
        assert client.get(f"/jobs/{jid}", headers=AUTH).status_code == 404
        assert client.get("/jobs", headers=AUTH).json()["jobs"] == []
    assert db.tables["ai_jobs"][0]["status"] == "queued"


def test_opening_a_ready_result_returns_it_and_marks_it_opened(env):
    client, db = env
    jid = _queue(client).json()["id"]
    db.tables["ai_jobs"][0].update(status="ready", result_html="<p>x</p>")
    body = client.get(f"/jobs/{jid}", headers=AUTH).json()
    assert body["result_html"] == "<p>x</p>"
    assert db.tables["ai_jobs"][0]["opened_at"]


def test_applied_and_discard_only_work_on_a_finished_job(env):
    client, db = env
    jid = _queue(client).json()["id"]
    assert client.post(f"/jobs/{jid}/applied", json={}, headers=AUTH).status_code == 409
    assert client.post(f"/jobs/{jid}/discard", headers=AUTH).status_code == 409
    db.tables["ai_jobs"][0]["status"] = "ready"
    assert client.post(f"/jobs/{jid}/applied", json={"note_id": "n1"}, headers=AUTH).json()["status"] == "applied"
    assert db.tables["ai_jobs"][0]["applied_note_id"] == "n1"
    # applied is final: a second apply must not succeed
    assert client.post(f"/jobs/{jid}/applied", json={}, headers=AUTH).status_code == 409


def test_run_now_moves_a_waiting_job_to_now_and_starts_it(env):
    client, db = env
    later = (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()
    jid = _queue(client, run_after=later).json()["id"]
    with patch("routers.jobs.worker.run_one", return_value=None) as run:
        res = client.post(f"/jobs/{jid}/run-now", headers=AUTH)
    assert res.status_code == 200
    assert datetime.fromisoformat(db.tables["ai_jobs"][0]["run_after"]) <= datetime.now(timezone.utc)
    run.assert_called_once()
    assert client.post(f"/jobs/{jid}/cancel", headers=AUTH).status_code == 200
    assert client.post(f"/jobs/{jid}/run-now", headers=AUTH).status_code == 409


def test_list_filters_by_note_and_status(env):
    client, db = env
    a = _queue(client).json()["id"]
    _queue(client)
    client.post(f"/jobs/{a}/cancel", headers=AUTH)
    jobs = client.get("/jobs?note_id=n1&status=queued", headers=AUTH).json()["jobs"]
    assert len(jobs) == 1 and jobs[0]["status"] == "queued"
