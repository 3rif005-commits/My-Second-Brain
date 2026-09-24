"""Section anchors are checked against the source pages (E6d follow-up)."""
from services.workspace.anchors import repair_anchors

SRC = [{"text": "[page 3]\nQ-learning updates the Q-value with the reward and a discount factor gamma."},
       {"text": "[page 7]\nCOMPAS risk scores showed racial bias; proxy variables leak protected attributes."}]


def test_a_section_pointing_at_the_wrong_source_is_moved():
    html = ('<h1>G</h1><h3 data-anchor="1:p:7">Bias in COMPAS</h3>'
            '<p>COMPAS risk scores, racial bias, proxy variables, protected attributes.</p>')
    out, n = repair_anchors(html, SRC)
    assert n == 1 and 'data-anchor="2:p:7"' in out


def test_a_correct_anchor_is_left_alone():
    html = ('<h1>G</h1><h3 data-anchor="1:p:3">Q-learning</h3>'
            '<p>The Q-value update uses the reward and the discount factor gamma.</p>')
    assert repair_anchors(html, SRC) == (html, 0)


def test_one_source_is_never_touched():
    html = '<h3 data-anchor="1:p:9">x</h3><p>COMPAS proxy</p>'
    assert repair_anchors(html, SRC[:1]) == (html, 0)


def test_a_missing_anchor_is_added_only_on_a_clear_match():
    clear = ('<h3>Bias</h3><p>COMPAS risk scores showed racial bias; proxy variables '
             'leak protected attributes.</p>')
    out, n = repair_anchors(clear, SRC)
    assert n == 1 and 'data-anchor="2:p:7"' in out
    vague = '<h3>Summary</h3><p>Some closing words.</p>'
    assert repair_anchors(vague, SRC) == (vague, 0)
