import pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_inline_injects_skill_into_system():
    """Inline endpoint prepends the note-author skill body to system messages."""
    from routers.agent_inline import _build_inline_messages

    original_messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Explain recursion."},
    ]
    skill_body = "SKILL: always write in bullet points"

    result = _build_inline_messages(original_messages, skill_body)

    assert result[0]["role"] == "system"
    assert "SKILL: always write in bullet points" in result[0]["content"]
    assert result[-1]["role"] == "user"
    assert result[-1]["content"] == "Explain recursion."


@pytest.mark.asyncio
async def test_inline_adds_system_if_none():
    """If no system message exists, one is created with the skill body."""
    from routers.agent_inline import _build_inline_messages

    original_messages = [
        {"role": "user", "content": "Hello"},
    ]
    skill_body = "Formatting rules"

    result = _build_inline_messages(original_messages, skill_body)

    assert result[0]["role"] == "system"
    assert "Formatting rules" in result[0]["content"]
    assert len(result) == 2  # system + user
