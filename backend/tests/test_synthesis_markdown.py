"""The study guide on the Markdown path (E6b): same validation, same HTML out.

On two real lectures the Markdown prompt reached the HTML dialect's depth at
-41% cost, so text runs use it; figure and video runs keep the dialect they
were written and measured for.
"""
from unittest.mock import patch

from services.workspace import synthesis

GUIDE_MD = ("```markdown\n# Remote Sensing\n\n## Sensors\n\n### Passive {1:p:3}\n"
            "Detects reflected sunlight. " * 30 + "\n```")


def test_text_runs_use_markdown_and_media_runs_do_not(monkeypatch):
    monkeypatch.setattr(synthesis.settings, "synthesis_format", "md")
    assert synthesis._uses_markdown() is True
    assert synthesis._uses_markdown(figures=[{"type": "image_url"}]) is False
    assert synthesis._uses_markdown(video_urls=["https://youtu.be/x"]) is False
    monkeypatch.setattr(synthesis.settings, "synthesis_format", "html")
    assert synthesis._uses_markdown() is False


def test_the_markdown_answer_reaches_the_editor_as_the_html_dialect():
    captured = {}

    def fake(job, user_id, messages, max_tokens, validate=None, **kw):
        captured["valid"] = validate(GUIDE_MD)
        captured["rejects_outline"] = validate("# Title only")
        return GUIDE_MD

    with patch.object(synthesis, "complete_with_fallback", fake):
        html = synthesis._complete("prompt", [], True, "u1", markdown=True)

    assert html.startswith("<h1>Remote Sensing</h1>")      # fences stripped, converted
    assert 'data-anchor="1:p:3"' in html
    assert captured["valid"] is True                      # validated as HTML
    assert captured["rejects_outline"] is False


def test_the_markdown_estimate_expects_about_half_the_output():
    two_lectures = 17_000 * 4
    md = synthesis._expected_output_tokens(two_lectures, markdown=True)
    html = synthesis._expected_output_tokens(two_lectures)
    assert 8_000 <= md <= 11_000 and md < html
