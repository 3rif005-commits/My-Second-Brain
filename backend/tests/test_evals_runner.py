"""The eval runner's judgement: which expectations hold, and how the corpus is
described. Cheap tests — none of these call a model."""
import json

import pytest

from evals import run as evals_run
from evals.score_note import score_note

GOOD = """
<h1>Bias and Variance</h1>
<h2>Chapter</h2>
<h3 data-anchor="1:s:1">Definitions</h3>
<div data-type="callout" data-callout-type="NOTE"><p>text</p></div>
<div data-type="math">E = \\sigma^2</div>
<table><tr><td>a</td></tr></table>
"""


def _check(html, expect, sources=1, **kw):
    return evals_run.check(score_note(html, source_count=sources, **kw),
                           expect, sources)


def test_a_case_passes_only_when_every_expectation_holds():
    assert _check(GOOD, {"heading_total_min": 3, "math_blocks_min": 1,
                         "tables_min": 1, "h1_exact": 1,
                         "grounding_min": 1.0, "unknown_callouts_max": 0}) == []


def test_each_missed_expectation_is_reported_in_plain_words():
    failures = _check(GOOD, {"math_blocks_min": 3, "tables_min": 2})
    assert "math_blocks 1 < 3" in failures
    assert "tables 1 < 2" in failures


def test_an_invented_callout_type_fails_the_case():
    html = '<div data-type="callout" data-callout-type="EXAMPLE"><p>x</p></div>'
    assert _check(html, {"unknown_callouts_max": 0}) == ["unknown_callouts 1 > 0"]


def test_a_typo_in_the_manifest_is_reported_not_ignored():
    """Silently skipping an unknown expectation would let a case claim a pass
    it never earned."""
    assert _check(GOOD, {"headings_min": 3}) == ["unknown expectation headings_min"]


def test_forbidden_text_fails_even_without_an_expectation_key():
    html = "<p>MAINTENANCE COMPLETE</p>"
    failures = _check(html, {}, must_not_mention=["MAINTENANCE COMPLETE"])
    assert failures and "forbidden text present" in failures[0]


def test_multi_source_case_requires_citations_from_every_source():
    one_source_only = '<h3 data-anchor="1:s:1">A</h3><h3 data-anchor="1:s:2">B</h3>'
    assert _check(one_source_only, {"sources_cited_min": 2}, sources=2) == \
        ["sources_cited 1 < 2"]


# ── the shipped corpus ───────────────────────────────────────────────────────

def test_every_manifest_case_is_runnable():
    manifest = evals_run.load_manifest()
    assert manifest["cases"], "corpus is empty"
    for case in manifest["cases"]:
        assert case["id"] and case["mode"] == "synthesis"
        for src in case["sources"]:
            path = evals_run.CORPUS / src["path"]
            assert path.exists(), f"{case['id']}: missing {src['path']}"
            assert path.read_text().strip(), f"{case['id']}: {src['path']} is empty"


def test_the_adversarial_case_forbids_what_the_source_asks_for():
    """If this case ever stops forbidding the injected phrases, it stops being
    a security measurement and nobody would notice."""
    manifest = evals_run.load_manifest()
    case = next(c for c in manifest["cases"] if c["family"] == "adversarial")
    source = (evals_run.CORPUS / case["sources"][0]["path"]).read_text().lower()

    assert case["must_not_mention"], "adversarial case forbids nothing"
    for phrase in case["must_not_mention"]:
        assert phrase.lower() in source or phrase == "brain.delete_note", \
            f"{phrase!r} is not what the source actually tries"
    assert case["expect"]["forbidden_hit_max"] == 0
    # It must also still be scored on real content, or "refuse everything"
    # would score as a pass.
    assert case["must_mention"]


def test_dry_run_never_counts_as_a_pass(tmp_path):
    manifest = evals_run.load_manifest()
    case = manifest["cases"][0]
    result = evals_run.run_case(case, "test", 0, dry_run=True)
    assert result.ok is False
    assert "dry run" in result.failures[0]
    assert result.usd is None
