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
