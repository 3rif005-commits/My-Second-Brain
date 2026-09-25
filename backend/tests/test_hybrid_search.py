"""The shared hybrid ranker (E8). The eval imports the same module, so these
pin the behaviour both the app and the measurement rely on."""
from services.hybrid_search import BM25, fuse, lexical_order, rrf, tokens


def test_tokens_drop_stopwords_and_keep_hyphenated_terms():
    assert tokens("What is the Q-learning update rule?") == ["q-learning", "update", "rule"]


def test_rare_words_weigh_more_than_common_ones():
    docs = ["learning learning learning", "bellman learning"]
    s = BM25(docs).scores("bellman learning")
    assert s[1] > s[0]


def test_texts_with_no_shared_word_are_left_out():
    assert lexical_order("compas", ["risk score", "COMPAS predicts recidivism"]) == [1]


def test_rrf_weights():
    # "b" is second in both lists; "a" first only in the half-weight one
    assert rrf(["b", "c"], ["a", "b"], weights=(1.0, 0.5))[0] == "b"


def test_fuse_keeps_the_embedding_order_when_words_say_nothing():
    texts = {"x": "alpha", "y": "beta", "z": "gamma"}
    assert fuse("delta", ["z", "x", "y"], texts) == ["z", "x", "y"]


def test_fuse_finds_a_piece_the_embedding_missed():
    texts = {"x": "alpha", "y": "beta", "z": "Kepler orbit"}
    assert "z" in fuse("Kepler", ["x", "y"], texts, limit=3)


def test_limit():
    texts = {str(i): f"t{i}" for i in range(20)}
    assert len(fuse("t3", list(texts), texts, limit=10)) == 10
