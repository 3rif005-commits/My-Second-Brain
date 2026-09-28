"""The jobs API: queue with a price, list, cancel, discard, applied — and who may."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from services.ai.providers import Provider
from tests.fake_db import FakeDB

AUTH = {"Authorization": "Bearer fake"}
PRICED = {"skill": "flashcards", "usd": 0.04, "model": "claude-haiku-4-5", "runnable": None}


@pytest.fixture
def env():
    fake = FakeDB(notes=[{"id": "n1", "user_id": "u1", "title": "Lecture 10", "deleted_at": None},
                         {"id": "n2", "user_id": "someone-else", "title": "X", "deleted_at": None}])
    provider = Provider("anthropic", capabilities={"text"})          # no batch API unless a test adds one
    with patch("routers.jobs.skill_run.ready_sources", return_value=[{"id": "s1"}]), patch("services.database.get_supabase", return_value=fake), \
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
    with patch("routers.jobs.pick", return_value=Provider("local", capabilities={"text"})):
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
    assert res.json()["actual_usd"] == 0             # cancelled while waiting: nothing spent
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


# ── Activity, settings, badge, detail, delete ────────────────────────────────

def _row(db, **over):
    jobs = db.tables.setdefault("ai_jobs", [])
    row = {"id": f"x{len(jobs)}", "user_id": "u1", "note_id": "n1",
           "skill": "flashcards", "focus": "", "status": "applied", "trigger": "run_later",
           "price_mode": "normal", "created_at": datetime.now(timezone.utc).isoformat(),
           "actual_usd": 0.04, "live_equivalent_usd": None, "source_ids": [], "result_meta": {}}
    row.update(over)
    jobs.append(row)
    return row


def test_activity_separates_what_is_open_from_history_and_adds_note_titles(env):
    client, db = env
    _row(db, id="r", status="ready")
    _row(db, id="q", status="queued")
    _row(db, id="a", status="applied")
    _row(db, id="old", status="applied",
         created_at=(datetime.now(timezone.utc) - timedelta(days=60)).isoformat())
    body = client.get("/jobs/activity", headers=AUTH).json()
    assert {j["id"] for j in body["open"]} == {"r", "q"}
    assert [j["id"] for j in body["history"]] == ["a"]           # 30 days by default
    assert body["open"][0]["note_title"] == "Lecture 10"
    assert body["monthly_cap_usd"] == 5.0 and body["month_spent_usd"] == 0
    wide = client.get("/jobs/activity?days=90", headers=AUTH).json()
    assert {j["id"] for j in wide["history"]} == {"a", "old"}


def test_an_open_job_shows_however_old_it_is(env):
    client, db = env
    _row(db, id="stuck", status="failed",
         created_at=(datetime.now(timezone.utc) - timedelta(days=80)).isoformat())
    body = client.get("/jobs/activity?days=7", headers=AUTH).json()
    assert [j["id"] for j in body["open"]] == ["stuck"]


def test_activity_filters_the_history(env):
    client, db = env
    _row(db, id="a", skill="flashcards", status="applied")
    _row(db, id="b", skill="study-guide", status="cancelled", trigger="schedule")
    ids = lambda q: [j["id"] for j in client.get(f"/jobs/activity?{q}", headers=AUTH).json()["history"]]
    assert ids("skill=study-guide") == ["b"]
    assert ids("trigger=schedule") == ["b"]
    assert ids("status=applied") == ["a"]
    assert ids("status=queued") == ["a", "b"] or ids("status=queued") == ["b", "a"]   # not a history state: ignored


def test_activity_claims_a_saving_only_for_batch_jobs_that_have_both_prices(env):
    client, db = env
    _row(db, id="b1", price_mode="batch", actual_usd=0.04, live_equivalent_usd=0.08)
    _row(db, id="n1x", price_mode="normal", actual_usd=0.08, live_equivalent_usd=0.08)
    _row(db, id="b2", price_mode="batch", actual_usd=0.04, live_equivalent_usd=None)
    assert client.get("/jobs/activity", headers=AUTH).json()["saved_usd"] == 0.04


def test_the_badge_counts_results_and_problems_but_not_jobs_still_waiting(env):
    client, db = env
    for st in ("ready", "ready", "failed", "budget_blocked", "queued", "applied"):
        _row(db, status=st)
    assert client.get("/jobs/badge", headers=AUTH).json() == {"ready": 2, "needs_you": 2}


def test_the_monthly_limit_can_be_read_and_changed(env):
    client, db = env
    db.tables["profiles"] = [{"id": "u1", "preferences": {}}]
    assert client.get("/jobs/settings", headers=AUTH).json()["monthly_cap_usd"] == 5.0
    put = client.put("/jobs/settings", json={"monthly_cap_usd": 0.01}, headers=AUTH)
    assert put.json()["monthly_cap_usd"] == 0.01
    assert client.get("/jobs/settings", headers=AUTH).json()["monthly_cap_usd"] == 0.01
    bad = client.put("/jobs/settings", json={"monthly_cap_usd": 0}, headers=AUTH)
    assert bad.status_code == 400 and "between" in bad.json()["detail"]["error"]


def test_detail_names_the_sources_the_job_was_made_from(env):
    client, db = env
    db.tables["note_resources"] = [{"id": "s1", "title": "Slides.pdf"}, {"id": "s2", "title": "Notes"}]
    _row(db, id="d", source_ids=["s1"])
    assert client.get("/jobs/d/detail", headers=AUTH).json() == {"sources": [{"id": "s1", "title": "Slides.pdf"}]}


def test_a_finished_job_can_be_deleted_but_a_waiting_one_cannot(env):
    client, db = env
    _row(db, id="done", status="applied")
    _row(db, id="waiting", status="queued")
    assert client.delete("/jobs/done", headers=AUTH).status_code == 200
    assert client.delete("/jobs/waiting", headers=AUTH).status_code == 409
    assert [r["id"] for r in db.tables["ai_jobs"]] == ["waiting"]
    with patch("routers.jobs.get_user_id", return_value="intruder"):
        assert client.delete("/jobs/waiting", headers=AUTH).status_code == 404


def test_applying_or_discarding_drops_the_stored_result(env):
    client, db = env
    a = _row(db, id="a", status="ready", result_html="<p>x</p>")
    b = _row(db, id="b", status="ready", result_html="<p>y</p>")
    client.post("/jobs/a/applied", json={"note_id": "n1"}, headers=AUTH)
    client.post("/jobs/b/discard", headers=AUTH)
    assert a["result_html"] is None and b["result_html"] is None


def test_cancelling_a_running_job_does_not_claim_it_cost_nothing(env):
    client, db = env
    jid = _queue(client).json()["id"]
    db.tables["ai_jobs"][0]["status"] = "submitted"
    res = client.post(f"/jobs/{jid}/cancel", headers=AUTH)
    assert res.json()["status"] == "cancelled" and res.json().get("actual_usd") is None


# ── batch mode at the API ────────────────────────────────────────────────────

def test_a_batch_job_is_queued_at_half_price_with_the_live_price_beside_it(env):
    client, db = env
    with patch("routers.jobs.batch.adapter_for", return_value=object()), \
         patch("routers.jobs.skill_run.batch_eligible", return_value=True), \
         patch("routers.jobs.skill_run.ready_sources", return_value=[{"id": "s1"}]):
        job = _queue(client).json()
    assert job["price_mode"] == "batch"
    assert job["shown_estimate_usd"] == 0.02 and job["live_equivalent_usd"] == 0.04


def test_a_job_that_is_not_one_call_is_queued_at_the_normal_price(env):
    client, _ = env
    with patch("routers.jobs.batch.adapter_for", return_value=object()), \
         patch("routers.jobs.skill_run.batch_eligible", return_value=False), \
         patch("routers.jobs.skill_run.ready_sources", return_value=[{"id": "s1"}] * 3):
        job = _queue(client).json()
    assert job["price_mode"] == "normal" and job["shown_estimate_usd"] == 0.04
    assert job["live_equivalent_usd"] is None


def test_a_provider_without_a_batch_api_queues_at_the_normal_price(env):
    client, _ = env
    assert _queue(client).json()["price_mode"] == "normal"          # conftest registers no adapters


def test_cancelling_a_sent_batch_tells_the_provider(env):
    client, db = env
    jid = _queue(client).json()["id"]
    db.tables["ai_jobs"][0].update(status="submitted", provider_batch_id="batch-9")
    adapter = MagicMock()
    with patch("routers.jobs.worker._provider_for", return_value=object()), \
         patch("routers.jobs.batch.adapter_for", return_value=adapter):
        res = client.post(f"/jobs/{jid}/cancel", headers=AUTH)
    assert res.json()["status"] == "cancelled" and res.json().get("actual_usd") is None
    adapter.cancel.assert_called_once()
    assert adapter.cancel.call_args.args[1] == "batch-9"


def test_a_provider_that_cannot_cancel_does_not_stop_the_cancel(env):
    client, db = env
    jid = _queue(client).json()["id"]
    db.tables["ai_jobs"][0].update(status="submitted", provider_batch_id="batch-9")
    adapter = MagicMock()
    adapter.cancel.side_effect = RuntimeError("503")
    with patch("routers.jobs.worker._provider_for", return_value=object()), \
         patch("routers.jobs.batch.adapter_for", return_value=adapter):
        res = client.post(f"/jobs/{jid}/cancel", headers=AUTH)
    assert res.status_code == 200 and db.tables["ai_jobs"][0]["status"] == "cancelled"


def test_accepting_a_higher_price_queues_the_job_at_that_price_and_runs_it(env):
    client, db = env
    jid = _queue(client).json()["id"]
    db.tables["ai_jobs"][0].update(status="needs_you", error="Price went up",
                                   result_meta={"was_usd": 0.04, "now_usd": 0.08, "now_mode": "normal"})
    with patch("routers.jobs.worker.run_one", return_value=None) as run:
        res = client.post(f"/jobs/{jid}/accept-price", headers=AUTH)
    row = db.tables["ai_jobs"][0]
    assert res.status_code == 200 and row["status"] == "queued"
    assert row["shown_estimate_usd"] == 0.08 and row["price_mode"] == "normal" and row["error"] is None
    run.assert_called_once()
    assert client.post(f"/jobs/{jid}/accept-price", headers=AUTH).status_code == 409   # only once


def test_accepting_a_price_is_only_for_a_job_that_asked(env):
    client, _ = env
    jid = _queue(client).json()["id"]
    assert client.post(f"/jobs/{jid}/accept-price", headers=AUTH).status_code == 409


def test_the_quote_is_the_same_decision_the_queue_makes(env):
    client, _ = env
    q = lambda: client.get("/jobs/quote?note_id=n1&skill=flashcards", headers=AUTH).json()
    assert q() == {"price_mode": "normal", "usd": 0.04, "live_usd": 0.04, "model": "claude-haiku-4-5"}
    with patch("routers.jobs.batch.adapter_for", return_value=object()), \
         patch("routers.jobs.skill_run.batch_eligible", return_value=True):
        quoted = q()
        queued = _queue(client).json()
    assert quoted == {"price_mode": "batch", "usd": 0.02, "live_usd": 0.04, "model": "claude-haiku-4-5"}
    assert (queued["price_mode"], queued["shown_estimate_usd"]) == ("batch", 0.02)   # shown = queued


def test_a_quote_for_a_job_that_cannot_run_says_why(env):
    client, _ = env
    with patch("routers.jobs.skill_run.chat_skills",
               return_value=[{**PRICED, "runnable": "no sources are ready yet"}]):
        res = client.get("/jobs/quote?note_id=n1&skill=flashcards", headers=AUTH)
    assert res.status_code == 400 and "no sources are ready yet" in res.json()["detail"]["error"]
    assert client.get("/jobs/quote?note_id=n2&skill=flashcards", headers=AUTH).status_code == 404


def test_a_job_waiting_on_a_price_can_be_dismissed(env):
    client, db = env
    jid = _queue(client).json()["id"]
    db.tables["ai_jobs"][0].update(status="needs_you", result_meta={"now_usd": 0.08, "now_mode": "normal"})
    assert client.post(f"/jobs/{jid}/discard", headers=AUTH).json()["status"] == "discarded"
