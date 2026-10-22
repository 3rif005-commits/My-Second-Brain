"""Diagram photo → Mermaid (ArtCraft study item 11)."""
import pytest

from services import live_block
from services.live_block import clean_mermaid, diagram_from_image


def test_clean_mermaid_accepts_bare_or_fenced_and_rejects_prose():
    assert clean_mermaid("flowchart LR\n A-->B") == "flowchart LR\n A-->B"
    assert clean_mermaid("Sure!\n```mermaid\nmindmap\n  root((x))\n```") == "mindmap\n  root((x))"
    with pytest.raises(ValueError):
        clean_mermaid("I can't read this image.")


def test_rejects_bad_type_and_size():
    with pytest.raises(ValueError, match="PNG"):
        diagram_from_image(b"x", "application/pdf", "u1")
    with pytest.raises(ValueError, match="8 MB"):
        diagram_from_image(b"", "image/png", "u1")


def test_explains_when_no_vision_provider(monkeypatch):
    import services.ai.router as r
    monkeypatch.setattr(r, "candidates", lambda task, uid: [])
    with pytest.raises(ValueError, match="read images"):
        diagram_from_image(b"\x89PNG", "image/png", "u1")


def test_sends_the_image_on_the_vision_task(monkeypatch):
    import services.ai.router as r
    seen = {}
    monkeypatch.setattr(r, "candidates", lambda task, uid: ["p"])

    def fake_complete(task, uid, messages, max_tokens):
        seen["task"] = task
        seen["parts"] = [p["type"] for p in messages[0]["content"]]
        return "```\nflowchart TD\n  Idea --> Test\n```"
    monkeypatch.setattr(r, "complete_with_fallback", fake_complete)
    assert diagram_from_image(b"\x89PNG", "image/png", "u1") == "flowchart TD\n  Idea --> Test"
    assert seen == {"task": "vision", "parts": ["text", "image"]}
