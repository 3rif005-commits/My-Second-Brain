"""The run log — every model call writes one honest row.

"Honest" is the load-bearing word: a row says whether its token counts came
from the provider or from this app's own guess, because a comparison that mixes
the two measures nothing.
"""
from unittest.mock import MagicMock, patch

import pytest

from services.ai import usage as usage_log

# Real uuids: `user_id` and `note_id` are uuid columns, so "u1" would be
# dropped by the guard — which is the point of the guard.
USER = "11111111-1111-4111-8111-111111111111"
NOTE = "22222222-2222-4222-8222-222222222222"


@pytest.fixture
def rows(monkeypatch):
    """Capture ai_runs inserts instead of hitting Supabase."""
    captured: list[dict] = []
    db = MagicMock()
    table = MagicMock()
    db.table.return_value = table
    table.insert.side_effect = lambda row: (captured.append(row), MagicMock())[1]
    monkeypatch.setattr("services.database.get_supabase", lambda: db)
    return captured


def test_a_reported_run_records_the_providers_own_numbers(rows):
    with usage_log.annotate(surface="workspace", job="synthesis",
                            note_id=NOTE, user_id=USER, trigger="user"):
        with usage_log.track("anthropic", "claude-haiku-4-5"):
            usage_log.report(input_tokens=1000, output_tokens=500,
                             cache_read_tokens=200)

    assert len(rows) == 1
    row = rows[0]
    assert (row["surface"], row["job"], row["note_id"], row["trigger"]) == \
        ("workspace", "synthesis", NOTE, "user")
    assert row["input_tokens"] == 1000
    assert row["output_tokens"] == 500
    assert row["cache_read_tokens"] == 200
    assert row["usage_reported"] is True
    assert row["status"] == "ok"
    # 1000 in + 500 out + 200 cached on Haiku 4.5
    assert row["estimated_usd"] == pytest.approx(
        (1000 * 1.0 + 200 * 0.1 + 500 * 5.0) / 1_000_000)


def test_an_unreported_run_falls_back_to_an_estimate_and_says_so(rows):
    with usage_log.track("local", "gemma-4-e2b",
                         estimate_chars=(4000, 400)):
        pass

    row = rows[0]
    assert row["usage_reported"] is False
    assert row["input_tokens"] == 1000      # 4000 chars / 4
    assert row["output_tokens"] == 100
    # A local model is priced at zero, which is a known price, not a missing one.
    assert row["estimated_usd"] == 0.0


def test_an_unpriced_model_records_tokens_with_no_dollar_figure(rows):
    with usage_log.track("openai_compatible", "brand-new-model",
                         estimate_chars=(400, 40)):
        pass

    assert rows[0]["estimated_usd"] is None
    assert rows[0]["input_tokens"] == 100


def test_a_failed_call_is_still_logged_then_re_raised(rows):
    with pytest.raises(RuntimeError):
        with usage_log.track("anthropic", "claude-haiku-4-5",
                             estimate_chars=(800, 0)):
            raise RuntimeError("overloaded")

    row = rows[0]
    assert row["status"] == "error"
    assert "overloaded" in row["error"]
    # The input was still spent, so it is still counted.
    assert row["input_tokens"] == 200


def test_annotations_nest_and_restore(rows):
    with usage_log.annotate(surface="workspace", user_id=USER):
        with usage_log.annotate(job="chat", note_id=NOTE):
            with usage_log.track("anthropic", "claude-haiku-4-5"):
                usage_log.report(input_tokens=10, output_tokens=1)
        # inner annotation is gone, outer survives
        with usage_log.track("anthropic", "claude-haiku-4-5"):
            usage_log.report(input_tokens=10, output_tokens=1)

    inner, outer = rows
    assert (inner["surface"], inner["job"], inner["note_id"]) == ("workspace", "chat", NOTE)
    assert (outer["surface"], outer["job"], outer["note_id"]) == ("workspace", None, None)
    assert outer["user_id"] == USER


def test_telemetry_never_breaks_the_call_it_measures(monkeypatch, caplog):
    """Migration 020 may not be applied yet — that must cost a log line, not a
    user-facing failure."""
    db = MagicMock()
    db.table.return_value.insert.side_effect = RuntimeError(
        "relation \"ai_runs\" does not exist")
    monkeypatch.setattr("services.database.get_supabase", lambda: db)
    monkeypatch.setattr(usage_log, "_missing_table_warned", False)

    with usage_log.track("anthropic", "claude-haiku-4-5"):
        usage_log.report(input_tokens=5, output_tokens=5)

    assert "020_ai_runs.sql" in caplog.text


def test_report_outside_a_tracked_call_is_a_no_op():
    """Nothing is tracking; this must not raise or leak into the next run."""
    usage_log.report(input_tokens=99)


# ── in-stream errors ─────────────────────────────────────────────────────────

def test_an_error_inside_the_stream_is_raised_not_swallowed():
    """OpenAI-compatible gateways answer 200 and then put the failure in the
    stream. Reading only delta.content turned that into an empty string and a
    successful-looking call — an eval scored it zero with nothing to explain
    why."""
    from services.ai.client import _raise_stream_error

    with pytest.raises(RuntimeError, match="rate limit"):
        _raise_stream_error({"error": {"message": "rate limit exceeded"}})
    with pytest.raises(RuntimeError, match="upstream exploded"):
        _raise_stream_error({"error": "upstream exploded"})
    # a normal chunk passes straight through
    _raise_stream_error({"choices": [{"delta": {"content": "hi"}}]})


# ── the uuid columns ─────────────────────────────────────────────────────────

def test_a_non_uuid_user_id_is_dropped_rather_than_losing_the_row(rows):
    """ai_runs.user_id is a uuid column. The eval runner passed the literal
    string "eval", Postgres rejected every insert, and the error never
    mentioned ai_runs — so it was logged at debug and a full day of eval runs
    went unrecorded while the scoreboard just looked empty."""
    with usage_log.annotate(surface="eval", user_id="eval", note_id="not-a-uuid"):
        with usage_log.track("openai_compatible", "some-model"):
            usage_log.report(input_tokens=10, output_tokens=1)

    row = rows[0]
    assert row["user_id"] is None and row["note_id"] is None
    assert row["surface"] == "eval"          # the rest of the row survives


def test_a_real_uuid_is_preserved(rows):
    import uuid as _uuid
    user = str(_uuid.uuid4())
    with usage_log.annotate(user_id=user, note_id=user):
        with usage_log.track("anthropic", "claude-haiku-4-5"):
            usage_log.report(input_tokens=1, output_tokens=1)
    assert rows[0]["user_id"] == user and rows[0]["note_id"] == user


def test_an_insert_failure_warns_once_per_distinct_error(monkeypatch, caplog):
    """Silent telemetry is how the above stayed hidden. A rejected row now says
    so — once per distinct failure, not once per call."""
    from unittest.mock import MagicMock

    db = MagicMock()
    db.table.return_value.insert.return_value.execute.side_effect = RuntimeError(
        'invalid input syntax for type uuid: "eval"')
    monkeypatch.setattr("services.database.get_supabase", lambda: db)
    monkeypatch.setattr(usage_log, "_seen_write_errors", set())

    for _ in range(3):
        with usage_log.track("anthropic", "claude-haiku-4-5"):
            usage_log.report(input_tokens=1, output_tokens=1)

    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert len(warnings) == 1
    assert "invalid input syntax" in warnings[0].getMessage()
