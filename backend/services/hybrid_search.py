"""Hybrid ranking: the embedding's order, fused with word matching (BM25).

E8 (docs/superpowers/experiments/E8-hybrid-retrieval.md), measured on 97
questions over real lecture pages with evals/retrieval.py:

  - word matching alone wins when a student uses the lecture's own terms
    ("Bellman equation", "COMPAS") and collapses when they do not;
  - the embedding alone is the reverse;
  - fusing both with the words at HALF weight was the only setting at least
    as good as the embedding alone on every measure of both question sets
    (right page in the top 5: 87% -> 97% on questions that share no words
    with the page).

The eval imports this module, so it always measures the code the app runs.
No model and no database feature: the lexical side runs over the texts the
caller already has.
"""
from __future__ import annotations

import math
import re
from collections import Counter

#: The lexical ranking's weight against the embedding's 1.0 (E8: 0.5 was the
#: best worst-case over both question sets; 1.0 lost on paraphrased questions).
LEXICAL_WEIGHT = 0.5
#: Reciprocal-rank-fusion constant — the usual 60; ranks, not scores, are
#: fused, so cosine and BM25 never need a common scale.
RRF_K = 60

_WORD = re.compile(r"[a-z0-9]+(?:[-'][a-z0-9]+)*")
_STOP = frozenset("""a an the of to in on for and or is are was were be been it its
this that these those what which who how why when where do does did with by as at
from than then so if not no can could would should will into about after before our
your their his her we you they i me my more most very""".split())


def tokens(text: str) -> list[str]:
    return [w for w in _WORD.findall((text or "").lower()) if w not in _STOP]


class BM25:
    """Okapi BM25 over a fixed list of texts (k1=1.2, b=0.75)."""

    def __init__(self, docs: list[str], k1: float = 1.2, b: float = 0.75):
        self.docs = [Counter(tokens(d)) for d in docs]
        self.lens = [sum(d.values()) for d in self.docs]
        self.avg = sum(self.lens) / max(1, len(self.lens))
        df: Counter = Counter()
        for d in self.docs:
            df.update(d.keys())
        n = len(self.docs)
        self.idf = {w: math.log(1 + (n - f + 0.5) / (f + 0.5)) for w, f in df.items()}
        self.k1, self.b = k1, b

    def scores(self, query: str) -> list[float]:
        q = tokens(query)
        out = []
        for d, ln in zip(self.docs, self.lens):
            s = 0.0
            for w in q:
                f = d.get(w, 0)
                if f:
                    s += self.idf.get(w, 0.0) * f * (self.k1 + 1) / (
                        f + self.k1 * (1 - self.b + self.b * ln / max(self.avg, 1e-9)))
            out.append(s)
        return out


def lexical_order(query: str, texts: list[str]) -> list[int]:
    """Indexes of `texts`, best word match first; texts sharing no word with
    the query are left out — they carry no lexical evidence."""
    scores = BM25(texts).scores(query)
    return [i for i in sorted(range(len(texts)), key=lambda i: -scores[i]) if scores[i] > 0]


def rrf(*rankings: list, k: int = RRF_K,
        weights: tuple[float, ...] | None = None) -> list:
    """Reciprocal rank fusion of several rankings (lists of ids), optionally
    weighted. An id missing from a ranking simply gets nothing from it."""
    weights = weights or (1.0,) * len(rankings)
    score: dict = {}
    for ranking, w in zip(rankings, weights):
        for r, item in enumerate(ranking):
            score[item] = score.get(item, 0.0) + w / (k + r + 1)
    return sorted(score, key=lambda item: -score[item])


def fuse(query: str, vector_ids: list, texts: dict, *,
         weight: float = LEXICAL_WEIGHT, limit: int | None = None) -> list:
    """The embedding's order (`vector_ids`, best first) fused with word
    matching over `texts` ({id: text} — every candidate, including ones the
    embedding did not return or could not embed)."""
    ids = list(texts)
    lexical = [ids[i] for i in lexical_order(query, [texts[i] for i in ids])]
    fused = rrf(vector_ids, lexical, weights=(1.0, weight))
    return fused[:limit] if limit else fused
