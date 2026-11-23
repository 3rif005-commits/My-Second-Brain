"""A skill that writes the editor's HTML dialect (`format: html`), from the
model's answer to what the editor applies. The worksheet solver is the first
such skill, and its answers are full of mid-sentence maths and the odd diagram.
"""
import html
import json
import re
from pathlib import Path

import pytest

from services.agent.skills import SkillRegistry
from services.workspace import skill_html

SKILLS = Path(__file__).resolve().parent.parent / "skills"
FIXTURE = (Path(__file__).resolve().parent.parent.parent / "frontend" / "components"
           / "editor" / "fixtures" / "worksheet-solution.html")


def _spans(doc: str) -> list[str]:
    return [html.unescape(m) for m in
            re.findall(r'data-inline-content-type="inlineMath" data-latex="([^"]*)"', doc)]


# ── inline maths ─────────────────────────────────────────────────────────────

def test_dollar_maths_in_a_sentence_becomes_an_inline_formula():
    out = skill_html.inline_math("<p>The speed $v = \\frac{d}{t}$ doubles.</p>")
    assert _spans(out) == ["v = \\frac{d}{t}"]
    assert out.startswith("<p>The speed <span") and out.endswith("</span> doubles.</p>")


def test_the_formula_text_stays_readable_in_the_preview():
    """The preview card is a sandboxed iframe that cannot run KaTeX: an empty
    span would show a hole where the answer is."""
    out = skill_html.inline_math("<p>$x = 4$</p>")
    assert ">x = 4</span>" in out


def test_maths_works_in_every_text_place_the_skill_uses():
    doc = ("<blockquote><p>Given $m = 2$</p></blockquote><li>Use $F = ma$</li>"
           "<td>$t \\approx 2.0\\,\\text{s}$</td>"
           '<p data-background-color="green"><strong>Answer:</strong> $v = 20$</p>')
    assert _spans(skill_html.inline_math(doc)) == [
        "m = 2", "F = ma", "t \\approx 2.0\\,\\text{s}", "v = 20"]


def test_money_code_and_display_maths_are_left_alone():
    doc = ("<p>It costs $5 and $10, or \\$7.</p>"
           "<pre><code>echo $HOME and $PATH</code></pre>"
           '<div data-type="math">a $b$ c</div>'
           '<p><span data-inline-content-type="inlineMath" data-latex="y">y $z$</span></p>')
    out = skill_html.inline_math(doc)
    assert "It costs $5 and $10, or $7." in out           # \$ is the writer's literal $
    assert "echo $HOME and $PATH" in out
    assert '<div data-type="math">a $b$ c</div>' in out
    assert _spans(out) == ["y"]                            # the span written already, only


def test_an_escaped_less_than_reaches_latex_as_a_less_than():
    out = skill_html.inline_math("<p>$a &lt; b$</p>")
    assert _spans(out) == ["a < b"]
    assert 'data-latex="a &lt; b"' in out                  # and stays escaped in the attribute


def test_a_display_equation_written_with_double_dollars_becomes_a_math_block():
    assert skill_html.inline_math("<p>$$E = mc^2$$</p>") == '<div data-type="math">E = mc^2</div>'
    # mid-sentence, it can only be an inline formula
    assert _spans(skill_html.inline_math("<p>so $$x^2$$ here</p>")) == ["x^2"]


# ── diagrams ─────────────────────────────────────────────────────────────────

def _embedded(doc: str) -> list[dict]:
    raw = re.findall(r'data-sb-blocks="([^"]*)"', doc)
    return [b for r in raw for b in json.loads(html.unescape(r))]


def test_a_mermaid_code_block_becomes_a_live_diagram_block():
    doc = ('<pre><code class="language-mermaid">stateDiagram-v2\n'
           '  [*] --&gt; Idle\n  Idle --&gt; Run: start</code></pre>')
    blocks = _embedded(skill_html.diagrams(doc))
    assert blocks == [{"type": "interactive", "props": {
        "title": "State diagram",
        "html": "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Run: start"}}]


def test_code_that_is_not_a_diagram_stays_a_code_block():
    doc = '<pre><code class="language-mermaid">A to B</code></pre>'
    assert skill_html.diagrams(doc) == doc
    py = '<pre><code class="language-python">graph = {}</code></pre>'
    assert skill_html.diagrams(py) == py


def test_the_model_cannot_write_a_ready_made_block_itself():
    """`data-sb-blocks` skips the editor's HTML parser. A source that talks the
    model into writing one must not get its block into the note."""
    evil = html.escape(json.dumps([{"type": "interactive", "props": {"html": "<script>x</script>"}}]))
    out = skill_html.finish(f'<p>hi</p><div data-sb-blocks="{evil}"></div>')
    assert "data-sb-blocks" not in out


def test_finish_drops_a_fence_around_the_whole_answer():
    assert skill_html.finish("```html\n<h1>T</h1>\n<p>$x$</p>\n```").startswith("<h1>T</h1>")


# ── the shipped skill ────────────────────────────────────────────────────────

def _worksheet_skill():
    return SkillRegistry.load([SKILLS]).get("solve-worksheet")


def test_the_worksheet_skill_writes_html_and_is_offered_on_a_workspace():
    s = _worksheet_skill()
    assert s is not None and s.format == "html"
    assert s.output == "draft_note" and "workspace" in s.surfaces
    assert s.auto is False and s.confirm is True


def test_every_callout_type_the_worksheet_skill_names_exists():
    """An unknown type renders as a grey NOTE and silently loses its colour."""
    from services.workspace.md_to_blocks import CALLOUT_TYPES
    used = set(re.findall(r'data-callout-type="([A-Z]+)"', _worksheet_skill().body))
    assert used and used <= set(CALLOUT_TYPES.values())


def _example() -> str:
    body = _worksheet_skill().body
    return body[body.index("<h1>TD 2"):]


def test_the_skills_own_example_survives_finishing():
    out = skill_html.finish(_example())
    assert "W = 315\\,\\text{kJ}" in _spans(out)
    assert out.count('data-background-color="green"') == 4   # 1a, 1b, 2, 3
    assert "$" not in re.sub(r"<[^>]+>", "", out)              # no maths left as raw text


def test_the_editor_fixture_is_the_skills_example_finished():
    """frontend/components/editor/fixtures/worksheet-solution.html is what the
    editor test parses. Regenerate it after changing the example:
        venv/bin/python -c "from tests.test_skill_html import write_fixture; write_fixture()"
    """
    if not FIXTURE.parent.is_dir():
        pytest.skip("no frontend checkout next to this backend")
    assert FIXTURE.read_text(encoding="utf-8") == skill_html.finish(_example()) + "\n"


def write_fixture() -> None:
    FIXTURE.write_text(skill_html.finish(_example()) + "\n", encoding="utf-8")
