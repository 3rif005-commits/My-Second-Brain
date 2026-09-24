"""Markdown-with-fences → the BlockNote HTML dialect (experiment E6).

The editor must not be able to tell the difference: whatever variant the model
writes in, the note pane receives the same HTML it already parses, and the same
scorer counts it.
"""
from evals.score_note import score_note
from services.workspace.md_to_blocks import markdown_to_html

SAMPLE = """# Bias and Variance

## Chapter 1

:::overview
- What it is
- Why it matters
:::

### Definitions {1:p:4}

?? Observed error
The error we measure, which is **not** the same as bias.
$$ E = \\sigma^2 $$
?? Worked example
A nested sub-case.
??
??

:::exam
Students claim more data fixes bias. It does not.
:::

| Model | Bias | Variance |
|---|---|---|
| Linear | High | Low |
| Deep tree | Low | High |
"""


def test_the_converted_html_scores_the_same_way_the_editor_reads_it():
    score = score_note(markdown_to_html(SAMPLE), source_count=1)
    assert score.headings["h1"] == 1
    assert score.headings["h3"] == 1
    assert score.math_blocks == 1
    assert score.tables == 1
    assert score.table_rows == 3          # header + two rows
    assert score.callouts == {"OVERVIEW": 1, "EXAM": 1}
    assert score.unknown_callouts == []
    assert score.grounding == 1.0         # the h3 anchor survived


def test_nested_toggles_keep_their_bodies():
    html = markdown_to_html(SAMPLE)
    score = score_note(html)
    assert score.toggles == 3             # overview + concept + sub-case
    assert score.toggles_with_body == 3
    assert "<h5>Observed error</h5>" in html
    assert "<h6>Worked example</h6>" in html


def test_the_overview_toggle_sits_inside_the_callout():
    """The user's own reference style — and a <blockquote><details> instead
    silently discards the whole body."""
    html = markdown_to_html(":::overview\nJust this.\n:::")
    assert html.startswith('<div data-type="callout" data-callout-type="OVERVIEW">')
    assert "<details><summary>Overview</summary>" in html
    assert html.rstrip().endswith("</div>")


def test_an_unknown_callout_becomes_a_note_rather_than_a_broken_attribute():
    """An invented data-callout-type renders as silent grey in the editor, so
    the converter maps the unknown onto the type it would degrade to anyway."""
    score = score_note(markdown_to_html(":::example\nx\n:::"))
    assert score.callouts == {"NOTE": 1}
    assert score.unknown_callouts == []


def test_a_malformed_anchor_is_dropped_not_written_out():
    """Writing it anyway would hide the model's mistake from the scorer."""
    html = markdown_to_html("### Section {page 4}")
    assert "data-anchor" not in html
    assert score_note(html, source_count=1).grounding == 0.0


def test_unbalanced_output_still_renders():
    """A model that forgets to close a toggle should cost us a tidy document,
    not the whole note."""
    html = markdown_to_html("?? Open\nbody text")
    assert html.count("<details>") == html.count("</details>") == 1
    assert score_note(html).toggles_with_body == 1


def test_inline_formatting_and_escaping():
    html = markdown_to_html("Use **bold**, *italic*, `code` and 5 < 6 & 7 > 6.")
    assert "<strong>bold</strong>" in html and "<em>italic</em>" in html
    assert "<code>code</code>" in html
    assert "5 &lt; 6 &amp; 7 &gt; 6" in html


def test_an_unrecognised_line_becomes_a_paragraph():
    """A note with an odd line in it beats a note with a hole in it."""
    assert "<p>&gt;&gt; strange</p>" in markdown_to_html(">> strange")


def test_empty_input_is_empty_output():
    assert markdown_to_html("") == ""


def test_a_note_has_one_title_and_a_second_one_becomes_a_chapter():
    """E6b: 2 of 9 Markdown runs wrote a second `#`, failing h1 == 1."""
    out = markdown_to_html("# Remote Sensing\n\n## Sensors\n\n# Orbits\n\ntext")
    assert out.count("<h1>") == 1
    assert "<h1>Remote Sensing</h1>" in out
    assert "<h2>Orbits</h2>" in out


def test_a_line_break_inside_a_table_cell_is_not_shown_as_text():
    out = markdown_to_html("|S1|S2<br>-1|\n|---|---|\n|a<br/>b|c|")
    assert "&lt;br" not in out
    assert "<th>S2 -1</th>" in out and "<td>a b</td>" in out


def test_a_definition_quote_and_numbered_steps_render_as_their_blocks():
    """The HTML dialect opens every concept with a definition quote and puts
    steps in an ordered list; the Markdown path can now say both."""
    out = markdown_to_html("> **Q-value:** expected return of an action.\n\n"
                           "1. Observe the state\n2. Pick an action\n- a fact")
    assert "<blockquote><p><strong>Q-value:</strong> expected return of an action.</p></blockquote>" in out
    assert "<ol><li>Observe the state</li><li>Pick an action</li></ol>" in out.replace("\n", "")
    assert "<ul><li>a fact</li></ul>" in out.replace("\n", "")
