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


def test_latex_written_without_dollars_still_becomes_a_formula():
    """Seen live on Nemotron: the Rule line showed raw \\frac{1}{2} \\epsilon_0."""
    out = skill_html.inline_math("<p><strong>Rule:</strong> time-averaged energy density "
                                 "⟨u⟩ = \\frac{1}{2} \\epsilon_0 E_0^2 and energy U = ⟨u⟩ × volume</p>")
    assert _spans(out) == ["⟨u⟩ = \\frac{1}{2} \\epsilon_0 E_0^2", "U = \\langle u\\rangle"]
    assert out.endswith("</span> × volume</p>")
    # a trailing comma stays prose, and a Windows path is not maths
    assert _spans(skill_html.inline_math("<p>Use \\sqrt{2gs}, then stop.</p>")) == ["\\sqrt{2gs}"]
    assert _spans(skill_html.inline_math("<p>Open C:\\Users first.</p>")) == []


def test_typed_unicode_maths_becomes_a_formula():
    """Seen live on Nemotron: "f ≈ 4.74 × 10¹⁴ Hz" typed next to real formulas."""
    assert _spans(skill_html.inline_math("<p>f ≈ 4.74 × 10¹⁴ Hz</p>")) == [
        "f \\approx 4.74 \\times 10^{14}"]
    assert _spans(skill_html.inline_math("<p>doubling E₀ quadruples it</p>")) == ["E_{0}"]
    # a title's separator dot and multiple-choice options are not maths
    assert _spans(skill_html.inline_math("<h2>Exercise 01 · Laser beam</h2><p>A) 4 · B) 6</p>")) == []


def test_a_bare_number_between_dollars_is_maths():
    """Nemotron writes "Roots are $2$ and $3$"; that is no price."""
    assert _spans(skill_html.inline_math("<p>Roots are $2$ and $3$.</p>")) == ["2", "3"]


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


def test_only_the_last_draft_of_a_diagram_is_kept_and_its_notes_go():
    """Nemotron drew the DFA three times under one question, with "%% Let me
    rebuild correctly" between them; only the last version was right."""
    m = lambda body: f'<pre><code class="language-mermaid">{body}</code></pre>'
    doc = ('<h3>Q8 · DFA</h3>' + m("stateDiagram-v2\n  q0 --&gt; q2: 1\n  %% wrong, redo")
           + m("stateDiagram-v2\n  q0 --&gt; q1: 0\n  %% q2 accepts")
           + '<h3>Q9 · Tree</h3>' + m("flowchart TD\n  A --&gt; B"))
    assert [b["props"]["html"] for b in _embedded(skill_html.diagrams(doc))] == [
        "stateDiagram-v2\n  q0 --> q1: 0", "flowchart TD\n  A --> B"]


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


def test_a_divider_right_under_a_section_title_is_dropped():
    out = skill_html.finish("<h2>Solutions</h2>\n<hr>\n<h3>Q1</h3><p>a</p><hr><h3>Q2</h3>")
    assert out == "<h2>Solutions</h2>\n\n<h3>Q1</h3><p>a</p><hr><h3>Q2</h3>"


def test_finish_drops_a_fence_around_the_whole_answer():
    assert skill_html.finish("```html\n<h1>T</h1>\n<p>$x$</p>\n```").startswith("<h1>T</h1>")


def test_rule_box_colours_keep_their_caps():
    box = lambda t: f'<div data-type="callout" data-callout-type="{t}" data-callout-icon="📐"><p>r</p></div>'
    doc = "".join(box(t) for t in ["CAUTION"] * 3 + ["WARNING"] * 4 + ["NOTE"])
    out = re.findall(r'data-callout-type="([A-Z]+)" data-callout-icon', skill_html.rule_caps(doc))
    # the third red moves to orange, which then fills up, so two oranges move to yellow
    assert out == ["CAUTION", "CAUTION", "WARNING", "WARNING", "WARNING",
                   "IMPORTANT", "IMPORTANT", "NOTE"]
    # a trap callout inside a question is not a rule box and is never touched
    trap = '<div data-type="callout" data-callout-type="CAUTION"><p>Trap</p></div>'
    assert skill_html.rule_caps(trap * 4) == trap * 4


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
    return body[body.index("<h1>TD 3"):]


def test_the_skills_own_example_survives_finishing():
    out = skill_html.finish(_example())
    assert "I \\approx 318\\,\\text{W/m}^2" in _spans(out)
    assert out.count('data-background-color="green"') == 4   # 01a, 01b, fields, 02
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


# ---- the revision sheet's rules, from the solutions --------------------------

_SOLUTIONS = r'''<h1>T</h1>
<details><summary><h2>Exercise 01 · Beam</h2></summary>
<details><summary><h4>(a) F</h4></summary><p><strong>Rule:</strong> wave relation</p><div data-type="math">v = \lambda f</div></details>
<details><summary><h4>(b) G</h4></summary><p><strong>Rule:</strong> Poynting vector · Faraday's law</p><div data-type="math">\vec S = \vec E \times \vec H \qquad \nabla \times \vec E = -\partial_t \vec B</div></details>
</details>
<details><summary><h2>Exercise 02 · Wave</h2></summary>
<p><strong>Rule:</strong> Poynting vector</p><div data-type="math">\vec S = \vec E \times \vec H</div>
<details><summary><h3>Energy</h3></summary><p><strong>Rule:</strong> the Poynting vector</p></details>
</details>
<h2>Revision sheet</h2>
<h3>Rules &amp; formulas</h3>
<p>🟥 must know · 🟧 core · 🟨 needed · 🟦 supporting · ⬜ background</p>
'''


def _box(level: str, name: str) -> str:
    return (f'<div data-type="callout" data-callout-type="{level}" data-callout-icon="📐">'
            f'<p><strong>{name}</strong></p><div data-type="math">x</div></div>\n')


def _boxes(doc: str) -> list[tuple[str, str]]:
    return re.findall(r'data-callout-type="([A-Z]+)" data-callout-icon="📐"><p><strong>(.*?)</strong>', doc)


def test_a_rule_the_solutions_use_always_gets_a_box():
    # live: the same worksheet gave different boxes each run, Faraday's law
    # used and never boxed
    doc = _SOLUTIONS + _box("CAUTION", "Wave relation") + _box("OVERVIEW", "Poynting vector") + "<h3>Answer key</h3>"
    out = skill_html.rule_sheet(doc)
    assert _boxes(out) == [("CAUTION", "Wave relation"), ("WARNING", "Poynting vector"),
                           ("OVERVIEW", "Faraday's law")]
    added = out[out.index("Faraday's law</strong>"):]
    assert added.startswith("Faraday's law</strong> (Ex. 01b)</p>")
    assert r'<div data-type="math">\nabla \times \vec E = -\partial_t \vec B</div>' in added
    assert out.index("Faraday's law") < out.index("<h3>Answer key</h3>")


def test_a_rule_used_often_is_never_ranked_low():
    # Poynting in 01b, 02 and 02 "Energy": three questions, at least core
    out = skill_html.rule_sheet(_SOLUTIONS + _box("NOTE", "The Poynting vector") + "<h3>Answer key</h3>")
    assert ("WARNING", "The Poynting vector") in _boxes(out)


def test_boxes_go_most_important_first_and_the_same_every_time():
    doc = (_SOLUTIONS + _box("OVERVIEW", "Faraday's law in vacuum") + _box("CAUTION", "Wave relation")
           + _box("WARNING", "Poynting vector") + "<h3>Answer key</h3>")
    out = skill_html.rule_sheet(doc)
    assert [lvl for lvl, _ in _boxes(out)] == ["CAUTION", "WARNING", "OVERVIEW"]
    assert skill_html.rule_sheet(out) == out


def test_rule_names_match_by_their_words_not_their_wording():
    t = skill_html._tokens
    same = skill_html._same_rule
    assert same(t("Faraday's law"), t("Faraday's law in vacuum"))
    assert same(t("Poynting vector"), t("the Poynting vector"))
    assert not same(t("wave relation"), t("wave equation"))
    assert not same(t("intensity of a beam"), t("intensity of a plane wave"))
    assert not same(t("intensity"), t("intensity of a plane wave"))


def test_a_page_without_a_revision_sheet_is_left_alone():
    doc = _SOLUTIONS.split("<h2>Revision sheet</h2>")[0]
    assert skill_html.rule_sheet(doc) == doc


def test_the_example_teaches_the_general_law_then_the_worksheet_case():
    doc = skill_html.finish(_example())
    sheet = doc[doc.index("<h3>Rules"):doc.index("<h3>Answer key")]
    assert [lvl for lvl, _ in _boxes(sheet)] == ["CAUTION", "WARNING", "IMPORTANT", "IMPORTANT", "OVERVIEW"]
    assert sheet.count("<em>Holds when:</em>") == 4
    assert sheet.count("<em>In this worksheet:</em>") == 3
    # every rule the solutions name has its box, none added by the check
    assert skill_html.rule_sheet(skill_html.rule_caps(_example())).count('data-callout-icon="📐"') == 5
    for answer in ("4.74", "318", "490", "1.63"):
        assert answer not in sheet


def test_paren_and_bracket_delimiters_become_formulas_without_them():
    # live (Nemotron): "\(\mathbf{E}\) electric field" became a formula with
    # \( \) inside it, a red KaTeX error
    out = skill_html.inline_math(r"<p>\(\mathbf{E}\) field · \(\mu_0 = 4\pi\)</p>")
    assert re.findall(r'data-latex="([^"]*)"', out) == [r"\mathbf{E}", r"\mu_0 = 4\pi"]
    assert skill_html.inline_math(r"<p>\[ \nabla \cdot E = 0 \]</p>") == r'<div data-type="math">\nabla \cdot E = 0</div>'
    assert skill_html.inline_math(r'<div data-type="math">\[ E = mc^2 \]</div>') == r'<div data-type="math">E = mc^2</div>'


def test_the_solver_runs_at_a_low_temperature_for_the_same_sheet_each_time():
    skill = SkillRegistry.load([SKILLS]).get("solve-worksheet")
    assert skill is not None and skill.temperature == 0.2


def test_sampling_sets_the_temperature_only_inside_its_block():
    from services.ai import client
    from services.ai.providers import Provider
    p = Provider("anthropic", api_key="k", chat_model="claude-haiku-4-5")
    msgs = [{"role": "user", "content": "hi"}]
    assert "temperature" not in client._anthropic_payload(p, msgs, 10, stream=True)
    with client.sampling(0.2):
        assert client._anthropic_payload(p, msgs, 10, stream=True)["temperature"] == 0.2
    assert "temperature" not in client._anthropic_payload(p, msgs, 10, stream=True)


def test_a_box_no_solution_uses_is_dropped():
    # live: a run copied the example's "Definition of momentum" into a
    # worksheet about waves
    doc = (_SOLUTIONS + _box("CAUTION", "Wave relation") + _box("WARNING", "Poynting vector")
           + _box("OVERVIEW", "Faraday's law") + _box("OVERVIEW", "Definition of momentum") + "<h3>Answer key</h3>")
    assert [n for _, n in _boxes(skill_html.rule_sheet(doc))] == ["Wave relation", "Poynting vector", "Faraday's law"]


def test_a_box_named_a_little_differently_keeps_its_content():
    doc = (_SOLUTIONS + _box("CAUTION", "Wave relation") + _box("WARNING", "Poynting vector")
           + '<div data-type="callout" data-callout-type="OVERVIEW" data-callout-icon="📐"><p><strong>Faraday induction</strong></p>'
             '<p><em>In this worksheet:</em> mine $x = 1$</p></div>\n' + "<h3>Answer key</h3>")
    out = skill_html.rule_sheet(doc)
    assert [n for _, n in _boxes(out)] == ["Wave relation", "Poynting vector", "Faraday induction"]
    assert "mine" in out


def test_one_law_named_after_someone_is_one_box():
    t, same = skill_html._tokens, skill_html._same_rule
    assert same(t("Faraday’s law in differential form"), t("Faraday's law for plane waves"))
    assert same(t("Energy density in EM fields"), t("Electromagnetic energy density"))
    assert not same(t("Gauss’s law"), t("Faraday's law"))


def test_a_worksheet_case_with_no_formula_is_dropped():
    # live (Nemotron, most runs): "In this worksheet: used to find E from B"
    box = ('<div data-type="callout" data-callout-type="CAUTION" data-callout-icon="📐"><p><strong>Wave relation</strong></p>'
           '<p><em>In this worksheet:</em> plane wave in vacuum, used to find E from B (01).</p>'
           '<p><em>In this worksheet:</em> vacuum, $v = c$ (01a).</p>'
           '<p><em>In this worksheet:</em> vacuum, B0 = E0/c (01).</p>'
           r'<p><em>In this worksheet:</em> \langle R \rangle (01).</p></div>' + "\n")
    out = skill_html.rule_sheet(_SOLUTIONS + box + "<h3>Answer key</h3>")
    assert "used to find" not in out
    assert out.count("<em>In this worksheet:</em>") == 3


def test_a_holds_when_line_that_names_no_limit_is_dropped():
    # live (Nemotron): "Holds when: general law; in differential form."
    box = ('<div data-type="callout" data-callout-type="CAUTION" data-callout-icon="📐"><p><strong>Wave relation</strong></p>'
           '<p><em>Holds when:</em> general law; in differential form.</p>'
           '<p><em>Holds when:</em> General definition of energy flux density.</p>'
           '<p><em>Holds when:</em> always.</p>'
           '<p><em>Holds when:</em> a plane wave in vacuum.</p></div>\n')
    out = skill_html.rule_sheet(_SOLUTIONS + box + "<h3>Answer key</h3>")
    assert re.findall(r"<em>Holds when:</em>([^<]*)", out) == [" a plane wave in vacuum."]
