"""Tests for the workspace summary prompt — must reuse the core mastery-guide
prompt and add anchor instructions + per-source-type framing."""
from prompts.mastery_guide import SYSTEM_PROMPT
from prompts.workspace_summary import build_workspace_summary_prompt


def test_reuses_mastery_guide_prompt_verbatim():
    prompt = build_workspace_summary_prompt("source", "Title", "pdf")
    assert SYSTEM_PROMPT in prompt


def test_anchor_instructions_present():
    prompt = build_workspace_summary_prompt("source", "T", "youtube")
    assert 'data-anchor="t:SECONDS"' in prompt
    assert 'data-anchor="p:PAGE"' in prompt
    assert 'data-anchor="s:INDEX"' in prompt


def test_framing_per_kind():
    assert "video transcript" in build_workspace_summary_prompt("s", "T", "youtube")
    assert "video transcript" in build_workspace_summary_prompt("s", "T", "video")
    assert "[page N]" in build_workspace_summary_prompt("s", "T", "pdf")
    assert "[page N]" in build_workspace_summary_prompt("s", "T", "document")
    assert "web article" in build_workspace_summary_prompt("s", "T", "website")


def test_source_text_truncated():
    prompt = build_workspace_summary_prompt("x" * 50000, "T", "pdf")
    assert len(prompt) < 40000
