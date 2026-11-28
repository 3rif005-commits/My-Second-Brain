"""A worksheet solved unit by unit (services/workspace/units.py).

The solver used to write the whole page in one call and the app treated it as
finished. These tests pin the parts that make it checkable: the plan as data,
the skeleton with a data-unit on every heading, keys that survive a model
dropping them, the free checks, and the answer key built from the bands.
"""
import json
import re

import pytest

from services.workspace import units

SHEET = {"title": "TD 3", "kind": "pdf", "text": (
    "[page 1]\nExercise 1 Laser beam. A laser of wavelength 632.8 nm, power 1 mW, "
    "diameter 2 mm.\na) Find the frequency of the wave.\nb) Find the intensity of the beam.\n"
    "[page 2]\nExercise 2. Which is the SI unit of momentum? A) N B) kg.m/s")}
COURSE = {"title": "Lecture 5", "kind": "pdf", "text": "[page 1]\nv = lambda f"}

PLAN = {
    "title": "TD 3, Electromagnetic Waves", "worksheet": 1,
    "exercises": [
        {"label": "Exercise 01", "topic": "Laser beam", "page": 1,
         "shared": "A laser: $\\lambda = 632.8\\,\\text{nm}$, $P = 1\\,\\text{mW}$",
         "questions": [
             {"label": "", "title": "Beam", "importance": "red",
              "parts": [
                  {"label": "(a)", "title": "Frequency", "question": "Find the frequency.",
                   "quote": "Find the frequency of the wave", "page": 1, "kind": "Short",
                   "rules": ["wave relation"], "importance": "red"},
                  {"label": "(b)", "title": "Intensity", "question": "Find the intensity.",
                   "quote": "Find the intensity of the beam", "page": 1, "kind": "Multi-step",
                   "rules": ["intensity of a beam"], "importance": "orange"}]}]},
        {"label": "Exercise 02", "topic": "Unit of momentum", "page": 2,
         "questions": [
             {"label": "", "title": "Unit", "question": "Which is the SI unit of momentum?",
              "quote": "Which is the SI unit of momentum", "page": 2, "kind": "Recall",
              "rules": ["definition of momentum"], "parts": []}]},
    ],
    "rules": [{"name": "wave relation", "importance": "core"}],
}


def plan():
    return units.parse_plan(json.dumps(PLAN), [SHEET, COURSE])


def test_the_plan_becomes_units_with_keys_levels_and_pages():
    p = plan()
    keys = [(u["key"], u["depth"]) for u in p["units"]]
    # A single question with sub-parts: the parts sit right under the exercise,
    # and an exercise with one plain question IS the question (SKILL.md).
    assert keys == [("", 1), ("1", 2), ("1.1", 3), ("1.2", 3), ("2", 2)]
    by = {u["key"]: u for u in p["units"]}
    assert by["1.1"]["title"] == "(a) Frequency"
    assert by["2"]["question"] == "Which is the SI unit of momentum?"
    assert by["2"]["page"] == 2                      # where its quote was found
    assert by["1"]["question"].startswith("A laser")  # the exercise's shared data
    # every rule a question uses is listed, even when the model left it out
    assert {r["name"] for r in p["rules"]} == {
        "wave relation", "intensity of a beam", "definition of momentum"}


def test_a_quote_the_sheet_does_not_have_is_a_problem_to_show():
    bad = json.loads(json.dumps(PLAN))
    bad["exercises"][1]["questions"][0]["quote"] = "Compute the radiation pressure on the mirror"
    p = units.parse_plan(json.dumps(bad), [SHEET])
    by = {u["key"]: u for u in p["units"]}
    assert by["2"]["problems"] and by["2"]["problems"][0].startswith(units.QUOTE_PROBLEM)
    assert not by["1.1"]["problems"]


def test_highlights_keep_their_caps():
    many = json.loads(json.dumps(PLAN))
    parts = many["exercises"][0]["questions"][0]["parts"]
    for i in range(3):
        parts.append({**parts[0], "label": f"({chr(99 + i)})", "importance": "red"})
    p = units.parse_plan(json.dumps(many), [SHEET])
    reds = [u for u in p["units"] if u["importance"] == "red"]
    assert len(reds) == 2


def test_markup_the_model_copied_into_a_plan_field_is_dropped():
    # Live (AI Grid / Qwen): the map wrote the skill's grey span into "question",
    # and the note showed `<span data-style-type=...>` as text on every question.
    marked = json.loads(json.dumps(PLAN))
    marked["exercises"][1]["questions"][0]["question"] = (
        '<span data-style-type="textColor" data-value="gray">Which is the SI unit of '
        'momentum, $p &amp; m$ with a < b?</span>')
    p = units.parse_plan(json.dumps(marked), [SHEET])
    by = {u["key"]: u for u in p["units"]}
    assert by["2"]["question"] == "Which is the SI unit of momentum, $p & m$ with a < b?"
    assert "&lt;span" not in units.skeleton_html(p)


def test_an_unusable_plan_says_why():
    with pytest.raises(ValueError):
        units.parse_plan("I could not read the sheet.", [SHEET])
    with pytest.raises(ValueError):
        units.parse_plan('{"exercises": []}', [SHEET])


def test_the_skeleton_has_every_heading_tagged_and_nothing_solved():
    html = units.skeleton_html(plan())
    assert html.startswith('<h1 data-unit="">TD 3, Electromagnetic Waves: Solutions</h1>')
    for key in ("1", "1.1", "1.2", "2", "revision"):
        assert f'data-unit="{key}"' in html
    assert html.count(units.NOT_SOLVED) == 3          # one per leaf
    assert '<h3 data-unit="1.1"><span data-style-type="backgroundColor" data-value="red">' in html
    assert "<details><summary><h2" in html


def test_a_unit_call_names_its_headings_and_the_rules():
    p = plan()
    ex = next(u for u in p["units"] if u["key"] == "1")
    note = units.write_note(ex, p["units"], p["rules"])
    assert 'data-unit="1.2"' in note and 'data-unit="2"' not in note.split("Write ONLY")[1]
    assert "wave relation" in note
    redo = units.write_note(ex, p["units"], p["rules"],
                            units.redo_extra("<p>old</p>", "use the course's notation"))
    assert "<p>old</p>" in redo and "use the course's notation" in redo


def test_keys_the_model_dropped_are_put_back_in_order():
    p = plan()
    written = ('<details><summary><h2>Exercise 01 · Laser beam</h2></summary>'
               '<details><summary><h3 data-unit="nonsense">(a) Frequency</h3></summary></details>'
               '<details><summary><h3>(b) Intensity</h3></summary></details></details>')
    fixed = units.restore_keys(written, units.subtree(p["units"], "1"))
    assert '<h2 data-unit="1">' in fixed
    assert '<h3 data-unit="1.1">' in fixed and '<h3 data-unit="1.2">' in fixed
    assert "nonsense" not in fixed


EX1 = ('<details><summary><h2 data-unit="1">Exercise 01 · Laser beam</h2></summary>'
       '<details><summary><h3 data-unit="1.1">(a) Frequency</h3></summary>'
       '<p><span data-style-type="textColor" data-value="gray">Find f ($\\lambda = 632.8\\,\\text{nm}$).</span></p>'
       '<p><strong>Rule:</strong> wave relation</p><div data-type="math">v = \\lambda f</div>'
       '<p data-background-color="green"><strong>Answer:</strong> $f \\approx 4.74 \\times 10^{14}\\,\\text{Hz}$</p>'
       '</details>'
       '<details><summary><h3 data-unit="1.2">(b) Intensity</h3></summary>'
       '<p><span data-style-type="textColor" data-value="gray">Find I for a beam of 3.5 mm.</span></p>'
       '<p><strong>Rule:</strong> intensity of a beam</p><div data-type="math">I = \\frac{P}{A}</div>'
       '</details></details>')


def test_free_checks_find_a_missing_band_and_a_number_the_sheet_lacks():
    p = plan()
    found = units.free_checks(EX1, units.subtree(p["units"], "1"), SHEET["text"])
    assert "1.1" not in found                        # one band, 632.8 is in the sheet
    assert "no answer band" in found["1.2"]
    assert any("3.5" in x for x in found["1.2"])     # the sheet says 2 mm


def test_a_part_that_was_not_written_is_flagged():
    p = plan()
    found = units.free_checks(EX1.replace('data-unit="1.2"', ""), units.subtree(p["units"], "1"),
                              SHEET["text"])
    assert "not written" in found["1.2"][0]


def test_the_answer_key_is_built_from_the_bands():
    p = plan()
    table = units.answer_key(EX1, p["units"])
    assert table.startswith("<h3>Answer key</h3>")
    assert "<td>01 (a)</td>" in table          # as in SKILL.md's example
    assert "4.74" in table and "Answer:" not in table


class FakeModel:
    """Answers by what the engine note asks for."""

    def __init__(self):
        self.calls = []

    def __call__(self, prefix, note, max_tokens):
        self.calls.append(note)
        if "THIS CALL ONLY PLANS" in note:
            return json.dumps(PLAN)
        if "TOP AND THE END" in note:
            return ('<div data-type="callout" data-callout-type="OVERVIEW"><details><summary>Overview'
                    '</summary><ul><li>x</li></ul></details></div>'
                    '<h2>Revision sheet</h2><h3>Rules &amp; formulas</h3>')
        if 'data-unit="1"' in note.split("Write ONLY")[1].split("\n")[0]:
            return EX1
        return ('<details><summary><h2 data-unit="2">Exercise 02</h2></summary>'
                '<p><strong>Rule:</strong> definition of momentum</p>'
                '<p data-background-color="green"><strong>Answer:</strong> B, kg·m/s</p></details>')


def test_a_whole_run_plans_then_writes_each_exercise_then_the_sheet():
    model = FakeModel()
    runner = units.Runner("SKILL TEXT", [SHEET, COURSE], model)
    p = runner.plan()
    assert runner.prefix.startswith("SKILL TEXT")
    assert '=== SOURCE 1: "TD 3"' in runner.prefix   # the same prefix every call
    got = {r["key"]: r for r in units.solve_parallel(runner, p, ["1", "2"])}
    assert set(got) == {"1", "2"} and not any("error" in r for r in got.values())
    assert "no answer band" in got["1"]["problems"]["1.2"]
    fin = runner.finish(p, [got["1"]["raw"], got["2"]["raw"]])
    assert fin["overview"].startswith('<div data-type="callout" data-callout-type="OVERVIEW"')
    assert fin["revision"].startswith('<h2 data-unit="revision">Revision sheet</h2>')
    # every rule a solution names gets its box; the key comes from the bands
    assert "Wave relation" in fin["revision"] or "wave relation" in fin["revision"]
    assert "<h3>Answer key</h3>" in fin["revision"] and "B, kg·m/s" in fin["revision"]
    # map + 2 exercises + 1 repair (1.2 has no band) + finish
    assert len(model.calls) == 5
    assert sum("The checks found these problems" in c for c in model.calls) == 1


def test_a_unit_that_fails_does_not_stop_the_others():
    model = FakeModel()
    runner = units.Runner("S", [SHEET], model)
    p = runner.plan()
    real = runner.write

    def flaky(plan_, key, **kw):
        if key == "2":
            raise RuntimeError("provider down")
        return real(plan_, key, **kw)

    runner.write = flaky
    got = {r["key"]: r for r in units.solve_parallel(runner, p, ["1", "2"])}
    assert "error" in got["2"] and "raw" in got["1"]


def test_stored_rows_rebuild_the_same_plan():
    p = plan()
    rows = [{**u, "resource_id": "s1" if u["key"] == "" else None,
             "rules": p["rules"] if u["key"] == "" else u["rules"], "state": "planned"}
            for u in p["units"]]
    again = units.plan_from_rows(rows, ["s1", "s2"])
    assert [u["key"] for u in again["units"]] == [u["key"] for u in p["units"]]
    assert again["rules"] == p["rules"] and again["worksheet"] == 1


def test_solve_all_streams_each_exercise_then_the_sheet_and_skips_written_ones():
    from unittest.mock import patch
    model = FakeModel()
    runner = units.Runner("S", [SHEET], model)
    p = runner.plan()
    rows = [{**u, "resource_id": "s1" if u["key"] == "" else None,
             "rules": p["rules"] if u["key"] == "" else u["rules"], "state": "planned"}
            for u in p["units"]]
    updates = []
    with patch.object(units, "_runner", return_value=(runner, ["s1"], None)), \
         patch.object(units, "load_rows", return_value=rows), \
         patch.object(units, "estimate_solve", return_value={"usd": 0.01}), \
         patch.object(units, "update_unit", side_effect=lambda *a: updates.append(a)):
        events = list(units.solve_sync("n1", "u1"))
    kinds = [e["type"] for e in events]
    assert kinds[0] == "start" and events[0]["keys"] == ["1", "2"]
    assert kinds.count("unit") == 2 and kinds[-3:] == ["finishing", "finish", "done"]
    assert {(a[2], a[3]["state"]) for a in updates} >= {("1.1", "written"), ("1.2", "flagged")}

    # Exercise 1 already written: only exercise 2 runs, and no sheet is
    # written from half the page.
    rows = [{**r, "state": "written" if r["key"].startswith("1") else r["state"]} for r in rows]
    with patch.object(units, "_runner", return_value=(runner, ["s1"], None)), \
         patch.object(units, "load_rows", return_value=rows), \
         patch.object(units, "estimate_solve", return_value={"usd": 0.01}), \
         patch.object(units, "update_unit"):
        events = list(units.solve_sync("n1", "u1"))
    assert events[0]["keys"] == ["2"] and "finish" not in [e["type"] for e in events]


def test_the_frontend_fixtures_are_this_backends_output():
    """frontend/lib/units.test.ts parses these through the editor's own path;
    they must be what this code writes. Regenerate them if this fails."""
    from pathlib import Path
    from services.workspace import skill_html
    fixtures = Path(__file__).resolve().parents[2] / "frontend/components/editor/fixtures"
    skeleton = skill_html.inline_math(units.skeleton_html(plan()))
    assert (fixtures / "worksheet-skeleton.html").read_text().strip() == skeleton.strip()
    assert (fixtures / "worksheet-unit.html").read_text().strip() == skill_html.finish(EX1).strip()


def test_a_quote_is_found_despite_maths_letters_and_spacing_and_kept_as_the_sheet_writes_it():
    sheet = "[page 1]\nTasks:\n1. Write the Boolean  equation for 𝑌.\n"
    assert units.locate_quote("Write the Boolean equation for Y.", sheet) == (
        1, "Write the Boolean equation for 𝑌")


def test_a_question_with_one_sub_part_is_the_question_itself():
    one = json.loads(json.dumps(PLAN))
    one["exercises"][1]["questions"] = [
        {"label": "1", "title": "Equation", "parts": [
            {"label": "(a)", "title": "Equation", "question": "Write Y.", "quote": "Which is the SI unit",
             "kind": "Short"}]},
        {"label": "2", "title": "Table", "parts": [
            {"label": "(a)", "question": "Build it.", "quote": "SI unit of momentum", "kind": "Short"}]}]
    p = units.parse_plan(json.dumps(one), [SHEET])
    keys = [u["key"] for u in p["units"] if u["key"].startswith("2")]
    assert keys == ["2", "2.1", "2.2"]
    assert next(u for u in p["units"] if u["key"] == "2.1")["question"] == "Write Y."


def test_the_revision_sheet_gets_a_row_but_is_not_a_part_of_the_plan():
    from unittest.mock import MagicMock, patch
    db = MagicMock()
    with patch.object(units, "_db", return_value=db):
        rows = units.save_plan("n1", "u1", plan(), ["s1"])
    assert rows[-1]["key"] == "revision"
    again = units.plan_from_rows([{**r, "rules": r["rules"]} for r in rows], ["s1"])
    assert "revision" not in [u["key"] for u in again["units"]]


def test_a_part_that_must_show_a_kmap_and_a_circuit_is_flagged_without_them():
    p = plan()
    sub = units.subtree(p["units"], "1")
    for u in sub:
        if u["key"] == "1.2":
            u["needs"] = ["K-map I", "circuit"]
    found = units.free_checks(EX1, sub, SHEET["text"])
    assert any(x.startswith("missing: K-map I, circuit") for x in found["1.2"])
    with_both = EX1.replace("</details></details>",
                            "<table><tr><td>1</td></tr></table>"
                            '<pre><code class="language-mermaid">flowchart LR\nA--&gt;B</code></pre>'
                            "</details></details>")
    found = units.free_checks(with_both, sub, SHEET["text"])
    assert not any(x.startswith("missing") for x in found.get("1.2", []))


def test_a_wrong_boolean_answer_is_flagged_from_the_question():
    units_ = [{"key": "", "parent_key": None, "question": "", "needs": []},
              {"key": "3", "parent_key": "", "question": r"$F_2(ABCD) = \sum(1,2,8,12,13)$", "needs": []}]
    html = ('<h2 data-unit="3">Ex 3</h2><p data-background-color="green"><strong>Answer:</strong> '
            r"$F_2 = AB\bar C + \bar A\bar B\bar C D$</p>")
    found = units.free_checks(html, units_, "")
    assert any("F2 as answered is not the asked function" in x for x in found["3"])


def test_a_part_missing_what_it_must_show_gets_one_repair_pass():
    calls = []

    def model(prefix, note, max_tokens):
        calls.append(note)
        if "THIS CALL ONLY PLANS" in note:
            plan_ = json.loads(json.dumps(PLAN))
            plan_["exercises"][1]["questions"][0]["needs"] = ["circuit"]
            return json.dumps(plan_)
        if "The checks found these problems" in note:
            return ('<details><summary><h2 data-unit="2">Ex 2</h2></summary>'
                    '<pre><code class="language-mermaid">flowchart LR\nA--&gt;B</code></pre>'
                    '<p data-background-color="green"><strong>Answer:</strong> B</p></details>')
        return ('<details><summary><h2 data-unit="2">Ex 2</h2></summary>'
                '<p data-background-color="green"><strong>Answer:</strong> B</p></details>')

    runner = units.Runner("S", [SHEET], model)
    p = runner.plan()
    res = runner.write(p, "2")
    assert "missing: circuit" in calls[-1] or "circuit" in calls[-1]
    assert "language-mermaid" in res["raw"] and res["problems"] == {}
    assert len(calls) == 3                       # plan, write, one repair


def test_logic_questions_always_need_their_kmaps_tables_and_circuit():
    q = r"Design a PAL to implement $F_1(ABCD) = \sum(2,12,13)$ and $F_2(ABCD) = \sum(1,2,8,12,13)$"
    got = units.ensure_needs(q, ["truth table F1"])
    assert got == ["truth table F1", "K-map F1", "K-map F2", "PAL programming table", "circuit"]
    # already planned: nothing doubled; two variables: no K-map
    assert units.ensure_needs(q, ["K-map F1", "K-map F2", "PAL table", "circuit"]) == \
        ["K-map F1", "K-map F2", "PAL table", "circuit"]
    assert units.ensure_needs(r"$F(AB) = \sum(1,2)$", []) == []


def test_a_question_to_explain_gets_no_circuit():
    assert units.ensure_needs("Would a PLA also be capable of implementing this function?", []) == []
    assert units.ensure_needs("Explain how a PAL could implement the function.", []) == []
    assert units.ensure_needs("Using the truth table implement the 2 functions with a PLA", []) == \
        ["PLA programming table", "circuit"]


def test_a_wrong_function_gets_the_computed_answer_under_its_band():
    units_ = [{"key": "", "parent_key": None, "question": "", "needs": []},
              {"key": "3", "parent_key": "", "question": r"$F_1(ABCD) = \sum(2,12,13)$", "needs": []}]
    band = ('<p data-background-color="green"><strong>Answer:</strong> '
            r"$F_1 = AB\bar D + \bar A\bar B C\bar D$</p>")
    html = '<h2 data-unit="3">Ex 3</h2>' + band + "<p>after</p>"
    out = units.computed_corrections(html, units_, units_)
    assert out.index(band) < out.index("Computed check") < out.index("<p>after</p>")
    assert "minterms 13, 14" in out and r"\bar{C}" in out
    right = html.replace(r"AB\bar D + ", r"AB\bar C + ")
    assert units.computed_corrections(right, units_, units_) == right


# ── the AI check (Phase 2) ──────────────────────────────────────────────────

def test_values_are_read_whatever_the_notation():
    v = units.answer_values
    assert v(r"f = 4.74 \times 10^{14}\,\text{Hz}") == [4.74e14]
    assert v("4.74×10¹⁴ Hz") == [4.74e14]
    assert v("I = 3.2e-3 W/m²") == [3.2e-3]
    assert v("x_1 = 2") == [2.0]                 # a subscript is a name
    assert units.compare_numbers("4.74 × 10^14 Hz", r"$f = 4.738 \times 10^{14}$") == "agree"
    assert units.compare_numbers("4.74 × 10^14 Hz", "f = 2.37 × 10^14 Hz") == "differ"
    assert units.compare_numbers("B, kg·m/s", "B") is None       # words: the judge decides


def test_a_band_exported_by_the_editor_keeps_its_formulas():
    band = ('<strong>Answer:</strong> <span data-inline-content-type="inlineMath" '
            'data-latex="f = 4.74 \\times 10^{14}\\,\\text{Hz}"></span> ok')
    assert units.band_text(band) == r"$f = 4.74 \times 10^{14}\,\text{Hz}$ ok"


class CheckModel:
    def __init__(self, blind, same=True):
        self.blind, self.same, self.calls = blind, same, []

    def __call__(self, prefix, note, max_tokens):
        self.calls.append((prefix, note))
        if "CHECKS A STUDENT'S ANSWERS" in note:
            return json.dumps({"answers": [{"key": k, "answer": a} for k, a in self.blind.items()]})
        if "SAME FINAL RESULT" in note:
            keys = re.findall(r"^- ([\d.]+):", note, re.M)
            return json.dumps({"verdicts": [{"key": k, "same": self.same,
                                             "why": "" if self.same else "picks A"} for k in keys]})
        raise AssertionError(note[:80])


def band(text):
    return f'<details><summary><h3>x</h3></summary><p data-background-color="green">{text}</p></details>'


def test_the_ai_check_solves_blind_then_compares():
    p = plan()
    model = CheckModel({"1.1": "4.74 × 10^14 Hz", "1.2": "318 W/m²", "2": "kg·m/s (B)"})
    runner = units.Runner("SKILL", [SHEET], model)
    out = runner.check(p, "", {
        "1.1": band(r'<strong>Answer:</strong> <span data-latex="f = 4.74 \times 10^{14}\,\text{Hz}"></span>'),
        "1.2": band("<strong>Answer:</strong> I = 637 W/m²"),
        "2": band("<strong>Answer:</strong> B, kg·m/s")})
    got = {r["key"]: r["verdict"] for r in out}
    # the judge (fake) says "same" for everything it gets: 1.2's numbers differ, so it
    # went to the judge rather than being called a difference by code
    assert got == {"1.1": "agree", "1.2": "agree", "2": "agree"}
    blind_note = model.calls[0][1]
    # blind: the questions go out, the note's answers don't
    assert "Find the intensity." in blind_note and "637" not in blind_note
    # only the pairs numbers can't settle go to the judge, without the sources
    assert len(model.calls) == 2 and model.calls[1][0] == units.JUDGE_PREFIX
    judged = model.calls[1][1]
    assert "- 2:" in judged and "- 1.2:" in judged and "- 1.1:" not in judged


def test_a_boolean_answer_is_checked_by_code_not_by_the_model():
    p = {"units": [
        {"key": "", "parent_key": None, "depth": 1, "label": "", "title": "T", "question": ""},
        {"key": "1", "parent_key": "", "depth": 2, "label": "Ex 1", "title": "F",
         "question": r"Implement $F(A,B,C) = \sum(0,1,2,4)$ with a PLA."}], "rules": []}
    model = CheckModel({})
    # as the editor exports it: the formula only in data-latex (live 2026-11-28)
    exported = band('<strong>Answer:</strong> <span data-inline-content-type="inlineMath" '
                    'data-latex="F = \\bar{A}\\bar{B} + \\bar{A}\\bar{C} + \\bar{B}\\bar{C}"></span>')
    out = units.Runner("S", [SHEET], model).check(p, "1", {"1": exported})
    assert out[0]["verdict"] == "agree" and out[0]["blind"] == "computed on every input"
    wrong = exported.replace("\\bar{B}\\bar{C}", "BC")
    out = units.Runner("S", [SHEET], model).check(p, "1", {"1": wrong})
    assert out[0]["verdict"] == "differ" and "minterm" in out[0]["why"]
    assert model.calls == []


def test_no_band_is_unsure_and_costs_nothing():
    model = CheckModel({})
    out = units.Runner("S", [SHEET], model).check(plan(), "2", {"2": "<p>my own working</p>"})
    assert out == [{"key": "2", "verdict": "unsure", "blind": "", "note": "",
                    "why": "no answer band to compare"}]
    assert model.calls == []


def test_a_difference_flags_the_answer_and_an_agreement_clears_it(monkeypatch):
    p = plan()
    rows = [{"key": u["key"], "state": "written", "problems": []} for u in p["units"]]
    rows[-1]["problems"] = [units.AI_CHECK + " old"]          # "2" was flagged by a check
    rows[-1]["state"] = "flagged"
    saved = {}
    monkeypatch.setattr(units, "_runner", lambda n, u: (units.Runner("S", [SHEET], CheckModel(
        {"1.1": "1 Hz", "1.2": "318 W/m²", "2": "kg·m/s"}, same=False)), [], None))
    monkeypatch.setattr(units, "load_rows", lambda n, u: rows)
    monkeypatch.setattr(units, "plan_from_rows", lambda r, s: p)
    monkeypatch.setattr(units, "update_unit", lambda n, u, k, f: saved.__setitem__(k, f))
    out = units.ai_check.__wrapped__("n", "u", "1", {
        "1.1": band("f = 4.74 × 10^14 Hz"), "1.2": band("I = 318 W/m²")}) \
        if hasattr(units.ai_check, "__wrapped__") else None
    if out is None:
        pytest.skip("privacy wrapper hides the function")
    assert saved["1.1"]["state"] == "flagged"
    assert saved["1.1"]["problems"][0].startswith("AI check: a second solve got “1 Hz”")
    assert saved["1.1"]["problems"][0].endswith("— picks A")
    assert saved["1.2"] == {"problems": [], "state": "written"}
    assert "2" not in saved                                      # not under part 1
