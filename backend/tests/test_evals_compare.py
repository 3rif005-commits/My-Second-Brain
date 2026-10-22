"""Comparing two eval arms — and refusing to compare what isn't comparable."""
import json

import pytest

from evals import compare as cmp


def _report(config, variant, model, cases, runs=3, reported=True):
    return {
        "config": config, "variant": variant, "runs_per_case": runs,
        "summary": {
            name: {"runs": runs, "passed": p, "models": [model], "variant": variant,
                   "median_input_tokens": 5000, "median_output_tokens": out,
                   "median_usd": 0.0, "total_usd": 0.0, "usage_reported": reported,
                   "median_latency_ms": 100_000, "median_headings": heads,
                   "median_math": 1, "median_grounding": 1.0, "failures": fails,
                   "fallbacks": []}
            for name, (p, out, heads, fails) in cases.items()
        },
    }


def test_it_reports_the_delta_that_decides_the_experiment(capsys):
    a = _report("html", "html", "m", {"case-1": (3, 14000, 28, [])})
    b = _report("md", "md", "m", {"case-1": (3, 7000, 26, [])})

    assert cmp.compare(a, b, "html", "md") == 0
    out = capsys.readouterr().out
    assert "-50%" in out                       # 14000 → 7000
    assert "output tokens: 14,000 → 7,000" in out


def test_it_refuses_to_compare_two_different_models(capsys):
    """Two models is not an experiment; it is two measurements of different
    things, and the earlier baseline did exactly that by accident."""
    a = _report("html", "html", "claude-haiku-4-5", {"case-1": (3, 3000, 20, [])})
    b = _report("md", "md", "nemotron:free", {"case-1": (3, 9000, 20, [])})

    assert cmp.compare(a, b, "html", "md") == 2
    out = capsys.readouterr().out
    assert "REFUSING" in out and "different models" in out


def test_estimated_token_counts_are_called_out(capsys):
    a = _report("html", "html", "m", {"case-1": (3, 100, 5, [])}, reported=False)
    b = _report("md", "md", "m", {"case-1": (3, 90, 5, [])})
    cmp.compare(a, b, "html", "md")
    assert "not the same measurement" in capsys.readouterr().out


def test_failures_from_both_arms_are_listed(capsys):
    a = _report("html", "html", "m", {"case-1": (2, 100, 5, ["math_blocks 0 < 1"])})
    b = _report("md", "md", "m", {"case-1": (3, 90, 5, [])})
    cmp.compare(a, b, "html", "md")
    assert "math_blocks 0 < 1" in capsys.readouterr().out


def test_a_case_missing_from_one_arm_is_flagged_not_silently_skipped(capsys):
    a = _report("html", "html", "m", {"case-1": (3, 100, 5, []), "case-2": (3, 80, 4, [])})
    b = _report("md", "md", "m", {"case-1": (3, 90, 5, [])})
    cmp.compare(a, b, "html", "md")
    assert "missing from B" in capsys.readouterr().out


def test_latest_picks_the_newest_report(tmp_path, monkeypatch):
    monkeypatch.setattr(cmp, "REPORTS", tmp_path)
    (tmp_path / "run-20260101-000000.json").write_text(json.dumps({"config": "old"}))
    (tmp_path / "run-20260923-120000.json").write_text(json.dumps({"config": "new"}))
    assert cmp.latest("run")["config"] == "new"


def test_a_missing_config_says_so(tmp_path, monkeypatch):
    monkeypatch.setattr(cmp, "REPORTS", tmp_path)
    with pytest.raises(SystemExit, match="no report found"):
        cmp.latest("nothing-here")


def test_latest_never_picks_a_longer_config_with_the_same_prefix(tmp_path, monkeypatch):
    from evals import compare
    monkeypatch.setattr(compare, "REPORTS", tmp_path)
    (tmp_path / "base-20260101-000000.json").write_text('{"id": "base"}')
    (tmp_path / "base-b-20260102-000000.json").write_text('{"id": "base-b"}')
    assert compare.latest("base")["id"] == "base"


def test_a_slowdown_counts_only_when_big_in_both_senses():
    assert cmp.slower(10_000, 12_000) is True     # +20 %, +2 s
    assert cmp.slower(10_000, 11_000) is False    # +10 %: noise
    assert cmp.slower(1_000, 1_400) is False      # +40 % but only 0.4 s
    assert cmp.slower(None, 5_000) is None        # not measured is not "fine"


def test_it_names_a_slower_case(capsys):
    a = _report("html", "html", "m", {"case-1": (3, 7000, 26, [])})
    b = _report("md", "md", "m", {"case-1": (3, 7000, 26, [])})
    b["summary"]["case-1"]["median_latency_ms"] = 130_000

    cmp.compare(a, b, "html", "md")
    assert "SLOWER" in capsys.readouterr().out
