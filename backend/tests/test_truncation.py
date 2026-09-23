"""A note cut off at the output cap must say so.

The first real lecture pair (two Remote Sensing lectures) hit the 16,000-token
cap on every Claude run. The note simply stopped mid-section; nothing in the
app, the run log or the note told anyone.
"""
import json
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from services.agent.skills import Skill
from services.ai import client
from services.ai.providers import Provider
from services.workspace import skill_run


def _fake_stream(lines):
    class _Resp:
        status_code = 200
        def raise_for_status(self): pass
        def iter_lines(self): return iter(lines)
        def read(self): return b""

    @contextmanager
    def _stream(*a, **kw):
        yield _Resp()
    return _stream


def _sse(*events):
    return [f"data: {json.dumps(e)}" for e in events]


CLAUDE = Provider(provider="anthropic", api_key="k", chat_model="claude-haiku-4-5",
                  capabilities={"text"})
OPENAI = Provider(provider="openai", api_key="k", chat_model="gpt-4o-mini",
                  capabilities={"text"})


def _claude_turn(stop):
    return _sse(
        {"type": "message_start", "message": {"usage": {"input_tokens": 10}}},
        {"type": "content_block_delta", "index": 0,
         "delta": {"type": "text_delta", "text": "# Guide\n\n## Chapter 1"}},
        {"type": "message_delta", "delta": {"stop_reason": stop},
         "usage": {"output_tokens": 16000}},
    )


def test_claude_stopping_at_max_tokens_is_reported_as_truncated():
    with patch.object(client.httpx, "stream", _fake_stream(_claude_turn("max_tokens"))):
        text = client.complete(CLAUDE, [{"role": "user", "content": "x"}], 16000)
    assert text.startswith("# Guide")
    assert client.last_call_truncated() is True


def test_claude_finishing_normally_is_not():
    with patch.object(client.httpx, "stream", _fake_stream(_claude_turn("end_turn"))):
        client.complete(CLAUDE, [{"role": "user", "content": "x"}], 16000)
    assert client.last_call_truncated() is False


def test_openai_finish_reason_length_is_truncated():
    lines = _sse({"choices": [{"delta": {"content": "part"}}]},
                 {"choices": [{"delta": {}, "finish_reason": "length"}]}) + ["data: [DONE]"]
    with patch.object(client.httpx, "stream", _fake_stream(lines)):
        client.complete(OPENAI, [{"role": "user", "content": "x"}], 100)
    assert client.last_call_truncated() is True


def test_a_new_call_does_not_inherit_the_last_ones_truncation():
    with patch.object(client.httpx, "stream", _fake_stream(_claude_turn("max_tokens"))):
        client.complete(CLAUDE, [{"role": "user", "content": "x"}], 16000)
    with patch.object(client.httpx, "stream", _fake_stream(_claude_turn("end_turn"))):
        client.complete(CLAUDE, [{"role": "user", "content": "x"}], 16000)
    assert client.last_call_truncated() is False


def test_a_truncated_skill_run_says_so_in_the_note():
    skill = Skill(name="compare-sources", description="d", body="Compare.", tools=None,
                  priority=3, source_path=Path("/x"), surfaces=("workspace",),
                  inputs="sources", output="draft_note", model_tier="standard",
                  auto=False, confirm=True)
    blocks = [{"title": "A", "kind": "pdf", "text": "a"},
              {"title": "B", "kind": "pdf", "text": "b"}]
    with patch.object(skill_run, "_blocks_for", return_value=(blocks, ["s1", "s2"])), \
         patch.object(skill_run, "registry") as reg, \
         patch.object(skill_run, "estimate", return_value={"usd": 0.01}), \
         patch.object(skill_run, "complete_with_fallback",
                      return_value="# Compared\n\n## Where they agree\nHalf a sen"), \
         patch.object(skill_run, "last_call_truncated", return_value=True), \
         patch.object(skill_run, "_write") as write:
        reg.return_value.get.return_value = skill
        skill_run.run_skill("n1", "u1", "compare-sources")

    html = write.call_args_list[-1][0][2]["html"]
    assert 'data-callout-type="WARNING"' in html
    assert "cut off" in html
    assert html.index("Half a sen") < html.index("cut off")     # at the end
