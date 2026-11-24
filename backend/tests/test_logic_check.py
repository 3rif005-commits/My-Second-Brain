"""Boolean answers checked against the question, with no model (logic_check.py)."""
from services.workspace import logic_check as lc


def test_a_minterm_list_and_a_right_answer_agree():
    q = r"Implement $F_1(ABC) = \sum(0,1,2,4)$ and $F_2(ABC) = \sum(0,5,6,7)$ with a PLA."
    assert lc.check(q, r"Answer: $F_1 = \bar A\bar B + \bar A\bar C + \bar B\bar C$, "
                       r"$F_2 = \bar A\bar B\bar C + AB + AC$") == []


def test_a_wrong_simplification_is_named_with_its_minterms():
    q = r"$F_2(ABCD) = \sum(1,2,8,12,13)$"
    probs = lc.check(q, r"Answer: $F_2 = AB\bar C + \bar A\bar B\bar C D$")   # misses 2 and 8
    assert len(probs) == 1 and probs[0].startswith("F2") and "2, 8" in probs[0]


def test_an_expression_question_is_compared_to_the_expression():
    # ESD tutorial 3, exercise 1, as the map wrote it (combining overlines)
    q = "F1 = x1x2 + x1x3̄ + x1x2̄, F2 = x1x2 + x̄1x3 + x1x3"
    assert lc.check(q, r"$F_1 = x_1$, $F_2 = x_1x_2 + x_3$") == []
    assert lc.check(q, r"$F_2 = x_1x_2$")[0].startswith("F2")


def test_dont_cares_are_free_and_primes_work():
    q = r"$F(A,B,C) = \sum m(1,3) + d(5,7)$"
    assert lc.check(q, "Answer: F = C") == []          # C covers 1,3,5,7; 5,7 are don't-cares
    assert lc.check(q, "Answer: F = A'C") == []


def test_what_cannot_be_read_is_skipped_never_flagged():
    assert lc.check("Explain how a PAL differs from a PLA.", "Answer: the OR plane is fixed") == []
    assert lc.check(r"$F(ABC) = \sum(1,2)$", r"Answer: $F = \text{see the K-map}$") == []


def test_the_live_tutorial_answer_is_caught_for_both_functions():
    """ESD 2 Tutorial 3, exercise 3, as Nemotron answered it (2026-11-24)."""
    q = r"$F_1(ABCD) = \sum(2,12,13)$, $F_2(ABCD) = \sum(1,2,8,12,13)$"
    band = (r"Answer: $F_1 = AB\bar D + \bar A \bar B C \bar D$; $F_2 = AB\bar D + \bar A B \bar C \bar D"
            r" + \bar A \bar B \bar C D + \bar A \bar B C \bar D$. PAL has 4 AND gates feeding a fixed OR "
            r"array: AND1 and AND2 to $F_1$.")
    probs = lc.check(q, band)
    assert len(probs) == 2
    assert "13, 14" in probs[0] and probs[1].startswith("F2")
    right = r"Answer: $F_1 = AB\bar C + \bar A\bar B C\bar D$. The PAL uses two terms."
    assert lc.check(q, right) == []


def test_the_simplest_form_is_computed_for_the_live_tutorial():
    names = ["A", "B", "C", "D"]
    f1 = lc.sop_text(lc.minimal_terms(4, {2, 12, 13}), names)
    nfc = lambda x: __import__("unicodedata").normalize("NFC", x)   # noqa: E731
    assert {nfc(t) for t in f1.split(" + ")} == {nfc("ABC̄"), nfc("ĀB̄CD̄")}
    # and it is right: the checker accepts it written back as LaTeX-free text
    q = r"$F_1(ABCD) = \sum(2,12,13)$"
    assert lc.check(q, "Answer: F1 = ABC̄ + ĀB̄CD̄") == []
    # the warning carries it
    probs = lc.check(q, r"Answer: $F_1 = AB\bar D + \bar A\bar B C\bar D$")
    assert "a correct simplest form is F1 = " in probs[0] and nfc("ABC̄") in nfc(probs[0])


def test_every_textbook_function_is_minimised_exactly():
    import itertools as it
    for ones in ({0, 1, 2, 4}, {0, 5, 6, 7}, {1, 2, 8, 12, 13}, set(range(16)) - {0}):
        n = 3 if max(ones) < 8 else 4
        names = ["A", "B", "C", "D"][:n]
        sop = lc.sop_text(lc.minimal_terms(n, ones), names)
        f = lc.evaluate(sop, names)
        got = {i for i, bits in enumerate(it.product([False, True], repeat=n)) if f(dict(zip(names, bits)))}
        assert got == ones, (ones, sop)
