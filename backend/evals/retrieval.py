"""E8 — retrieval eval: does the search put the right page first?

    python -m evals.retrieval                    # every variant, both scopes
    python -m evals.retrieval --variant baseline --show-misses

FREE: embeddings come from the local nomic-embed-text server the app uses
(EMBEDDER_PROVIDER=llamacpp, port 8081); no model is called. Cached by text
in evals/reports/ so a re-run only embeds what changed.

What it measures: 56 questions with every page that answers them
(corpus/retrieval_questions.json), against the app's own pieces — each PDF
page as resource_chunks holds it. Two scopes:
  note  — the question's own note (two lectures of one course), as the
          workspace AI searches (top 10 by cosine, services/workspace/chat.py);
  brain — all four lectures pooled, closer to the app-wide chat.
Metrics: hit@1/3/5/10 (a right page among the first k) and MRR (1 / rank of
the first right page). hit@10 is what the workspace prompt sees; hit@1 and
hit@3 say whether the right page is near the top, where the model reads it
first and the snippet budget keeps it.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).parent
CORPUS = HERE / "corpus"
QUESTIONS = CORPUS / "retrieval_questions.json"
CACHE = HERE / "reports" / "embed-cache.json"
KS = (1, 3, 5, 10)


@dataclass(frozen=True)
class Piece:
    source: str
    page: int
    text: str
    note: str
    title: str


def load(path: Path = QUESTIONS) -> tuple[list[Piece], list[dict]]:
    spec = json.loads(path.read_text(encoding="utf-8"))
    pieces: list[Piece] = []
    for key, src in spec["sources"].items():
        raw = (CORPUS / src["path"]).read_text(encoding="utf-8")
        parts = re.split(r"^\[page (\d+)\]\n", raw, flags=re.M)
        for page, body in zip(parts[1::2], parts[2::2]):
            if body.strip():
                pieces.append(Piece(key, int(page), body.strip(), src["note"], src["title"]))
    return pieces, spec["questions"]


# ── embedding, cached ───────────────────────────────────────────────────────

def _key(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def embed_all(texts: list[str]) -> list[list[float]]:
    from services.embedder import embed_batch
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    missing = [t for t in dict.fromkeys(texts) if _key(t) not in cache]
    for start in range(0, len(missing), 16):
        batch = missing[start:start + 16]
        for t, v in zip(batch, embed_batch(batch)):
            cache[_key(t)] = v
    if missing:
        CACHE.parent.mkdir(exist_ok=True)
        CACHE.write_text(json.dumps(cache))
    return [cache[_key(t)] for t in texts]


def _cos(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


# ── lexical + fusion: the app's own module (services/hybrid_search.py) ───────

from services.hybrid_search import fuse, lexical_order  # noqa: E402


# ── variants ────────────────────────────────────────────────────────────────
#
# Each variant says how a question and a piece are turned into the text that
# is embedded, and whether a lexical ranking is fused in. The app today is
# `baseline`: raw question, raw piece.

def _heading(text: str) -> str:
    m = re.search(r"^##\s*(.+)$", text, flags=re.M)
    return m.group(1).strip() if m else ""


def _context(p: Piece) -> str:
    """A deterministic one-line header: where the piece comes from. No model
    call — the source title, the page, the slide's own heading."""
    head = _heading(p.text)
    return f"{p.title} — page {p.page}" + (f": {head}" if head else "") + "\n"


VARIANTS = {
    # name: (query_text, doc_text, hybrid) — hybrid is False, True (equal
    # weights) or the lexical ranking's weight against the vector one's 1.0
    "baseline":        (lambda q: q, lambda p: p.text, False),
    "query-prefix":    (lambda q: "search_query: " + q, lambda p: p.text, False),
    "prefixes":        (lambda q: "search_query: " + q,
                        lambda p: "search_document: " + p.text, False),
    "prefixes+context": (lambda q: "search_query: " + q,
                         lambda p: "search_document: " + _context(p) + p.text, False),
    "lexical":         (None, None, True),
    "baseline+lexical": (lambda q: q, lambda p: p.text, True),
    "prefixes+lexical": (lambda q: "search_query: " + q,
                         lambda p: "search_document: " + p.text, True),
    "prefixes+context+lexical": (lambda q: "search_query: " + q,
                                 lambda p: "search_document: " + _context(p) + p.text, True),
}
for _w in (0.25, 0.5, 0.75):
    VARIANTS[f"baseline+lexical@{_w}"] = (lambda q: q, lambda p: p.text, _w)
    VARIANTS[f"prefixes+lexical@{_w}"] = (lambda q: "search_query: " + q,
                                          lambda p: "search_document: " + p.text, _w)


def rank(variant: str, pieces: list[Piece], questions: list[dict],
         scope: str) -> list[list[int]]:
    """For each question, piece indexes in rank order, within the scope."""
    qfn, dfn, hybrid = VARIANTS[variant]
    dvecs = embed_all([dfn(p) for p in pieces]) if dfn else None
    qvecs = embed_all([qfn(q["q"]) for q in questions]) if qfn else None
    out = []
    for qi, q in enumerate(questions):
        note = pieces_note(q, pieces)
        pool = [i for i, p in enumerate(pieces) if scope == "brain" or p.note == note]
        texts = {i: pieces[i].text for i in pool}
        if qvecs is None:                       # word matching alone
            lex = [pool[j] for j in lexical_order(q["q"], [texts[i] for i in pool])]
            out.append(lex + [i for i in pool if i not in set(lex)])
            continue
        sims = {i: _cos(qvecs[qi], dvecs[i]) for i in pool}
        vector = sorted(pool, key=lambda i: -sims[i])
        if not hybrid:
            out.append(vector)
            continue
        w = 1.0 if hybrid is True else float(hybrid)
        fused = fuse(q["q"], vector, texts, weight=w)
        out.append(fused + [i for i in vector if i not in set(fused)])
    return out


def pieces_note(q: dict, pieces: list[Piece]) -> str:
    src = q["gold"][0][0]
    return next(p.note for p in pieces if p.source == src)


def score(order: list[int], gold: list, pieces: list[Piece]) -> int | None:
    """1-based rank of the first right page, or None if it never appears."""
    want = {(s, pg) for s, pg in gold}
    for r, i in enumerate(order, start=1):
        if (pieces[i].source, pieces[i].page) in want:
            return r
    return None


def metrics(ranks: list[int | None]) -> dict:
    n = len(ranks)
    out = {f"hit@{k}": sum(1 for r in ranks if r and r <= k) / n for k in KS}
    out["mrr"] = sum(1 / r for r in ranks if r) / n
    return out


def evaluate(variant: str, scope: str, pieces, questions) -> tuple[dict, list]:
    orders = rank(variant, pieces, questions, scope)
    ranks = [score(o, q["gold"], pieces) for o, q in zip(orders, questions)]
    result = {"all": metrics(ranks)}
    for style in ("para", "term"):
        rs = [r for r, q in zip(ranks, questions) if q["style"] == style]
        result[style] = metrics(rs) if rs else {"mrr": float("nan")}
    return result, ranks


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--variant", action="append", choices=list(VARIANTS))
    ap.add_argument("--scope", action="append", choices=("note", "brain"))
    ap.add_argument("--show-misses", action="store_true",
                    help="list the questions whose right page is not in the top 3")
    ap.add_argument("--json", type=Path, help="write the table here too")
    ap.add_argument("--questions", type=Path, default=QUESTIONS,
                    help="question set (default: the hand-written one)")
    args = ap.parse_args(argv)

    pieces, questions = load(args.questions)
    variants = args.variant or list(VARIANTS)
    scopes = args.scope or ["note", "brain"]
    print(f"{len(questions)} questions ({sum(q['style'] == 'para' for q in questions)} "
          f"in the student's words), {len(pieces)} pieces\n")
    table = {}
    for scope in scopes:
        print(f"scope: {scope}")
        print(f"  {'variant':<26}{'hit@1':>7}{'hit@3':>7}{'hit@5':>7}{'hit@10':>8}"
              f"{'MRR':>7}   para MRR  term MRR")
        for v in variants:
            res, ranks = evaluate(v, scope, pieces, questions)
            table[f"{scope}/{v}"] = {**res, "ranks": ranks}
            a = res["all"]
            print(f"  {v:<26}{a['hit@1']:>7.2f}{a['hit@3']:>7.2f}{a['hit@5']:>7.2f}"
                  f"{a['hit@10']:>8.2f}{a['mrr']:>7.3f}   {res['para']['mrr']:>8.3f}"
                  f"  {res['term']['mrr']:>8.3f}")
            if args.show_misses:
                for r, q in zip(ranks, questions):
                    if not r or r > 3:
                        print(f"      miss (rank {r}): {q['q']}")
        print()
    if args.json:
        args.json.write_text(json.dumps(table, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
