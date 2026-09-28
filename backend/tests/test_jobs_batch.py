"""Batch mode: the same job, sent to the provider's half-price API and collected later.

The properties that matter: it is sent once, never twice; a result is paid for
and recorded at the batch price; expired and errored batches cost nothing and
say so; a price that rose is the user's to accept; and a batch whose id was
never stored (the process died mid-send) is found again, not lost or re-sent.
A fake adapter stands in for the provider — no test sends a real request.
"""
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from services.ai.providers import Provider
from services.jobs import batch, store, worker
from services.jobs.batch import Outcome, Status
from services.workspace import skill_run
from tests.fake_db import FakeDB

pytestmark = pytest.mark.usefixtures("hermetic_planning")

NOW = datetime(2026, 9, 28, 22, 0, tzinfo=timezone.utc)
PROVIDER = Provider("anthropic", api_key="k", chat_model="claude-haiku-4-5", label="Anthropic",
                    capabilities={"text", "batch"})


class FakeBatches:
    def __init__(self):
        self.sent, self.cancelled = [], []
        self.state = "in_progress"
        self.results = {}
        self.recent_batches = []
        self.fail_submit = None

    def submit(self, p, custom_id, messages, max_tokens):
        if self.fail_submit:
            raise self.fail_submit
        self.sent.append((custom_id, messages, max_tokens))
        return f"batch-{len(self.sent)}"

    def poll(self, p, batch_id):
        return Status(self.state)

    def collect(self, p, batch_id):
        return self.results

    def cancel(self, p, batch_id):
        self.cancelled.append(batch_id)

    def recent(self, p, limit=30):
        return self.recent_batches


def _job(**over):
    row = {"id": "j1", "user_id": "u1", "note_id": "n1", "skill": "flashcards", "focus": "",
           "status": "queued", "attempts": 0, "cap_usd": 0.50, "shown_estimate_usd": 0.04,
           "price_mode": "batch", "provider": "anthropic", "model": "claude-haiku-4-5",
           "run_after": (NOW - timedelta(seconds=30)).isoformat(),
           "provider_batch_id": None, "started_at": None}
    return {**row, **over}


@pytest.fixture
def env(monkeypatch):
    fake_db = FakeDB(ai_jobs=[_job()], profiles=[{"id": "u1", "preferences": {}}], ai_runs=[],
                     notes=[{"id": "n1", "title": "Lecture 10", "deleted_at": None}])
    adapter = FakeBatches()
    monkeypatch.setitem(batch._ADAPTERS, "anthropic", adapter)
    monkeypatch.setattr(worker, "pick", lambda *a, **k: PROVIDER)
    monkeypatch.setattr(worker, "list_providers", lambda *a, **k: [PROVIDER])
    monkeypatch.setattr(skill_run, "ready_sources", lambda *a, **k: [{"id": "s1"}])
    monkeypatch.setattr(skill_run, "chat_skills",
                        lambda *a, **k: [{"skill": "flashcards", "usd": 0.08}])
    call = skill_run.BatchCall([{"role": "user", "content": "make cards"}], 32000, ["s1"])
    monkeypatch.setattr(skill_run, "batch_call", lambda *a, **k: call)
    monkeypatch.setattr(skill_run, "_blocks_for", lambda *a: ([], ["s1"]))
    with patch("services.database.get_supabase", return_value=fake_db):
        yield fake_db, adapter


def _row(db, jid="j1"):
    return next(r for r in db.tables["ai_jobs"] if r["id"] == jid)


def _ok(text="- Q: a?\n- A: b", stop="end_turn", i=10_000, o=4_000):
    return Outcome("succeeded", text=text, stop_reason=stop, input_tokens=i, output_tokens=o)


# ── sending ──────────────────────────────────────────────────────────────────

def test_a_due_batch_job_is_sent_once_and_left_waiting(env):
    db, adapter = env
    with patch.object(skill_run, "produce_skill_result") as live:
        events = worker.run_due(NOW)
        worker.run_due(NOW)                                   # a second tick must not send it again
    assert events == [] and len(adapter.sent) == 1
    live.assert_not_called()                                  # no live call: this is the half-price path
    custom_id, messages, max_tokens = adapter.sent[0]
    assert custom_id == "j1" and max_tokens == 32000 and messages[0]["content"] == "make cards"
    row = _row(db)
    assert row["status"] == "submitted" and row["provider_batch_id"] == "batch-1"
    assert row["price_mode"] == "batch" and row["model"] == "claude-haiku-4-5"
    assert row["live_equivalent_usd"] == 0.08 and row["source_ids"] == ["s1"]


def test_the_price_a_batch_is_judged_on_is_the_half_price(env):
    """$0.08 live is $0.04 batch: within the $0.05 limit, so it is sent."""
    db, adapter = env
    _row(db)["cap_usd"] = 0.05
    worker.run_due(NOW)
    assert _row(db)["status"] == "submitted" and len(adapter.sent) == 1


def test_a_provider_that_does_not_answer_is_asked_again_then_the_job_fails(env):
    db, adapter = env
    adapter.fail_submit = RuntimeError("503 overloaded")
    worker.run_due(NOW)
    row = _row(db)
    assert row["status"] == "queued" and "503" in row["error"]
    assert datetime.fromisoformat(row["run_after"]) == NOW + worker.SUBMIT_RETRY
    row["run_after"] = (NOW - timedelta(seconds=1)).isoformat()
    worker.run_due(NOW)                                        # 2nd attempt
    assert _row(db)["status"] == "queued"
    _row(db)["run_after"] = (NOW - timedelta(seconds=1)).isoformat()
    events = worker.run_due(NOW)                               # 3rd: give up, never switch provider
    assert _row(db)["status"] == "failed" and "did not answer" in _row(db)["error"]
    assert _row(db)["actual_usd"] == 0 and events[0]["kind"] == "failed"
    assert adapter.sent == []


def test_a_job_that_cannot_run_at_all_fails_with_the_reason_and_sends_nothing(env, monkeypatch):
    db, adapter = env
    monkeypatch.setattr(skill_run, "batch_call",
                        MagicMock(side_effect=ValueError("Flashcards: no sources are ready yet.")))
    events = worker.run_due(NOW)
    assert _row(db)["status"] == "failed" and "no sources" in _row(db)["error"]
    assert adapter.sent == [] and events[0]["kind"] == "failed"


def test_a_job_that_is_no_longer_a_single_call_runs_live_at_the_normal_price(env, monkeypatch):
    """Sources grew to a chaptered guide since it was queued: no batch, and the
    price it was shown is judged against the live price."""
    db, adapter = env
    monkeypatch.setattr(skill_run, "batch_eligible", lambda *a, **k: False)
    result = {"skill": "flashcards", "title": "Flashcards", "html": "<p>x</p>", "source_ids": [], "usd": 0.06}
    _row(db)["shown_estimate_usd"] = 0.07                      # 0.08 live vs 0.07 shown: under the +25% line
    with patch.object(skill_run, "produce_skill_result", return_value=result) as live:
        worker.run_due(NOW)
    live.assert_called_once()
    assert adapter.sent == [] and _row(db)["status"] == "ready" and _row(db)["price_mode"] == "normal"


# ── a price that rose is the user's to accept ────────────────────────────────

def test_a_price_that_more_than_a_quarter_higher_waits_for_the_user(env, monkeypatch):
    db, adapter = env
    monkeypatch.setattr(worker, "pick", lambda *a, **k: Provider("openai_compatible", chat_model="big-model",
                                                                 capabilities={"text"}))
    events = worker.run_due(NOW)                               # no batch API now: $0.08 live vs $0.04 shown
    row = _row(db)
    assert row["status"] == "needs_you" and adapter.sent == []
    assert row["error"].startswith("Price went up: about $0.08 now (was about $0.04)")
    assert "big-model" in row["error"]
    assert row["result_meta"] == {"was_usd": 0.04, "now_usd": 0.08, "now_mode": "normal"}
    assert events[0]["kind"] == "needs_you"
    assert "Price went up" in worker.notification_for(events[0])["message"]


def test_a_small_rise_is_not_worth_asking_about(env):
    db, adapter = env
    _row(db)["shown_estimate_usd"] = 0.035                     # 0.04 now vs 0.035: +14%
    worker.run_due(NOW)
    assert _row(db)["status"] == "submitted" and len(adapter.sent) == 1


# ── collecting ───────────────────────────────────────────────────────────────

def _sent(db):
    _row(db).update(status="submitted", provider_batch_id="batch-1", started_at=NOW.isoformat(),
                    live_equivalent_usd=0.08)


def test_a_batch_still_being_processed_is_left_alone(env):
    db, adapter = env
    _sent(db)
    assert worker.run_due(NOW) == []
    assert _row(db)["status"] == "submitted"


def test_a_finished_batch_becomes_a_ready_result_paid_at_half_price(env):
    db, adapter = env
    _sent(db)
    adapter.state, adapter.results = "ended", {"j1": _ok()}
    events = worker.run_due(NOW)
    row = _row(db)
    assert row["status"] == "ready" and "<li>" in row["result_html"] or "Q" in row["result_html"]
    # Haiku: 10K in × $1 + 4K out × $5 per MTok = $0.03 live → $0.015 batch
    assert row["live_equivalent_usd"] == pytest.approx(0.03)
    assert row["actual_usd"] == pytest.approx(0.015)
    assert row["result_meta"]["input_tokens"] == 10_000 and row["result_meta"]["truncated"] is False
    assert events[0]["kind"] == "ready"
    logged = db.tables["ai_runs"]
    assert len(logged) == 1 and logged[0]["price_mode"] == "batch"
    assert logged[0]["estimated_usd"] == pytest.approx(0.015)      # the bill, so the monthly limit is real
    assert logged[0]["trigger"] == "background" and logged[0]["usage_reported"] is True


def test_a_collected_batch_is_not_collected_twice(env):
    db, adapter = env
    _sent(db)
    adapter.state, adapter.results = "ended", {"j1": _ok()}
    worker.run_due(NOW)
    worker.run_due(NOW)
    assert len(db.tables["ai_runs"]) == 1


def test_an_answer_cut_off_at_the_length_limit_says_so(env):
    db, adapter = env
    _sent(db)
    adapter.state, adapter.results = "ended", {"j1": _ok(stop="max_tokens")}
    worker.run_due(NOW)
    row = _row(db)
    assert row["status"] == "ready" and row["result_meta"]["truncated"] is True
    assert "length limit" in row["result_html"] or "cut off" in row["result_html"].lower()


def test_an_expired_batch_costs_nothing_and_says_so(env):
    db, adapter = env
    _sent(db)
    adapter.state, adapter.results = "ended", {"j1": Outcome("expired")}
    events = worker.run_due(NOW)
    row = _row(db)
    assert row["status"] == "expired" and row["actual_usd"] == 0
    assert row["error"] == "Not finished within 24 hours by the provider. Nothing was charged."
    assert events[0]["kind"] == "expired" and db.tables["ai_runs"] == []
    assert "nothing was charged" in worker.notification_for(events[0])["message"]


def test_a_rejected_request_fails_with_the_providers_reason_at_no_cost(env):
    db, adapter = env
    _sent(db)
    adapter.state, adapter.results = "ended", {"j1": Outcome("errored", error="prompt is too long")}
    events = worker.run_due(NOW)
    row = _row(db)
    assert row["status"] == "failed" and "prompt is too long" in row["error"] and row["actual_usd"] == 0
    assert events[0]["kind"] == "failed" and db.tables["ai_runs"] == []


def test_an_unusable_answer_is_still_paid_for_and_recorded(env, monkeypatch):
    """The provider charged for the tokens whether or not the text was any good."""
    db, adapter = env
    _sent(db)
    monkeypatch.setattr(skill_run, "finish_batch", MagicMock(side_effect=ValueError("The model returned nothing.")))
    adapter.state, adapter.results = "ended", {"j1": _ok(text="")}
    worker.run_due(NOW)
    row = _row(db)
    assert row["status"] == "failed" and row["actual_usd"] == pytest.approx(0.015)
    assert len(db.tables["ai_runs"]) == 1


def test_a_batch_whose_provider_key_was_removed_fails_with_the_reason(env, monkeypatch):
    db, adapter = env
    _sent(db)
    monkeypatch.setattr(worker, "list_providers", lambda *a, **k: [])
    events = worker.run_due(NOW)
    assert _row(db)["status"] == "failed" and "key" in _row(db)["error"]
    assert events[0]["kind"] == "failed"


# ── the process died between sending and saving ──────────────────────────────

def _orphan(db):
    _row(db).update(status="submitted", provider_batch_id=None,
                    started_at=(NOW - timedelta(hours=1)).isoformat())


def test_a_batch_sent_just_before_a_crash_is_found_not_lost_or_resent(env):
    db, adapter = env
    _orphan(db)
    adapter.recent_batches = [{"id": "batch-77", "processing_status": "ended",
                               "created_at": (NOW - timedelta(minutes=59)).isoformat()}]
    adapter.results = {"j1": _ok()}
    adapter.state = "ended"
    worker.run_due(NOW)
    assert adapter.sent == []                                  # never sent a second time
    row = _row(db)
    assert row["provider_batch_id"] == "batch-77" and row["status"] in ("submitted", "ready")
    worker.run_due(NOW)                                        # the next tick collects it
    assert _row(db)["status"] == "ready"


def test_an_unfinished_candidate_batch_is_waited_for(env):
    db, adapter = env
    _orphan(db)
    adapter.recent_batches = [{"id": "batch-78", "processing_status": "in_progress",
                               "created_at": (NOW - timedelta(minutes=59)).isoformat()}]
    worker.run_due(NOW)
    assert _row(db)["status"] == "submitted" and _row(db)["provider_batch_id"] is None


def test_when_no_batch_was_ever_sent_the_orphan_fails_cleanly(env):
    db, adapter = env
    _orphan(db)
    adapter.recent_batches = [{"id": "old", "processing_status": "ended",
                               "created_at": (NOW - timedelta(days=2)).isoformat()}]
    events = worker.run_due(NOW)
    assert _row(db)["status"] == "failed" and events[0]["kind"] == "failed"
    assert adapter.sent == []


def test_a_batch_belonging_to_another_job_is_not_adopted(env):
    db, adapter = env
    _orphan(db)
    adapter.recent_batches = [{"id": "batch-other", "processing_status": "ended",
                               "created_at": (NOW - timedelta(minutes=59)).isoformat()}]
    adapter.results = {"someone-elses-job": _ok()}
    worker.run_due(NOW)
    assert _row(db)["provider_batch_id"] is None and _row(db)["status"] == "failed"


# ── the job as one request ───────────────────────────────────────────────────

def test_only_a_single_call_can_be_a_batch():
    assert skill_run.batch_eligible("flashcards", 3) is True
    assert skill_run.batch_eligible("compare-sources", 2) is True
    assert skill_run.batch_eligible("study-guide", 1) is True
    assert skill_run.batch_eligible("study-guide", 3) is False         # written chapter by chapter
    assert skill_run.batch_eligible("no-such-skill", 1) is False


def test_the_finished_answer_is_the_same_document_a_live_run_makes():
    done = skill_run.finish_batch("flashcards", "```\n- Q: a\n```", False)
    assert "<" in done["html"] and done["truncated"] is False
    with pytest.raises(ValueError, match="returned nothing"):
        skill_run.finish_batch("flashcards", "  ", False)
    with pytest.raises(ValueError, match="not a complete study guide"):
        skill_run.finish_batch("study-guide", "just a sentence", False)


# ── the provider's wire format ───────────────────────────────────────────────

def test_results_are_read_by_custom_id():
    lines = "\n".join(json.dumps(x) for x in [
        {"custom_id": "a", "result": {"type": "succeeded", "message": {
            "content": [{"type": "text", "text": "hi "}, {"type": "text", "text": "there"}],
            "stop_reason": "max_tokens",
            "usage": {"input_tokens": 7, "output_tokens": 3, "cache_read_input_tokens": 2,
                      "cache_creation_input_tokens": 1}}}},
        {"custom_id": "b", "result": {"type": "errored", "error": {"type": "error", "error": {
            "type": "invalid_request_error", "message": "too long"}}}},
        {"custom_id": "c", "result": {"type": "expired"}},
        {"custom_id": "d", "result": {"type": "canceled"}},
    ]) + "\n\nnot json\n"
    got = batch.parse_results(lines)
    assert got["a"].text == "hi there" and got["a"].stop_reason == "max_tokens"
    assert (got["a"].input_tokens, got["a"].output_tokens, got["a"].cache_read_tokens,
            got["a"].cache_write_tokens) == (7, 3, 2, 1)
    assert got["b"].kind == "errored" and got["b"].error == "too long"
    assert got["c"].kind == "expired" and got["d"].kind == "canceled"


def test_a_request_is_sent_as_its_own_batch_with_the_job_id():
    resp = MagicMock(status_code=200)
    resp.json.return_value = {"id": "msgbatch_1"}
    with patch("services.jobs.batch.httpx.post", return_value=resp) as post:
        bid = batch.AnthropicBatches().submit(
            PROVIDER, "job-1", [{"role": "system", "content": "be brief"},
                                {"role": "user", "content": "hello"}], 1234)
    assert bid == "msgbatch_1"
    url = post.call_args.args[0]
    body = post.call_args.kwargs["json"]
    assert url.endswith("/v1/messages/batches")
    (req,) = body["requests"]
    assert req["custom_id"] == "job-1"
    assert req["params"]["model"] == "claude-haiku-4-5" and req["params"]["max_tokens"] == 1234
    assert req["params"]["system"] == "be brief" and "stream" not in req["params"]
    assert post.call_args.kwargs["headers"]["x-api-key"] == "k"


def test_a_provider_error_says_what_the_provider_said():
    resp = MagicMock(status_code=400, text='{"error":"bad model"}')
    with patch("services.jobs.batch.httpx.post", return_value=resp):
        with pytest.raises(batch.BatchError, match="400.*bad model"):
            batch.AnthropicBatches().submit(PROVIDER, "j", [{"role": "user", "content": "x"}], 10)


def test_only_a_provider_with_the_batch_capability_gets_an_adapter(monkeypatch):
    monkeypatch.setitem(batch._ADAPTERS, "anthropic", FakeBatches())
    assert batch.adapter_for(PROVIDER) is not None
    assert batch.adapter_for(Provider("anthropic", capabilities={"text"})) is None      # capability, not name
    assert batch.adapter_for(Provider("openai", capabilities={"text", "batch"})) is None  # no adapter yet
    assert batch.adapter_for(None) is None
