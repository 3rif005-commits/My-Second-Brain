# E8 — better search: embedding + word matching

**Status:** 2026-09-25 — hybrid ranking shipped for the workspace AI and the
app-wide chat's block step. Found a larger problem: 68% of notes with text
are not indexed (below, waiting on the user). Spent $0.05 (blind questions $0.031, live
check $0.02); every ranking measurement is free (local embeddings).

## The eval (`python -m evals.retrieval`, free)
- The app's own pieces: four real lectures (ML 10, ML 11, RS 2, RS 3) as
  `resource_chunks` hold them — one piece per PDF page, 80 pieces.
- **Hand set:** 58 questions with every page that answers them
  (`corpus/retrieval_questions.json`), 33 in a student's own words, 25 in the
  lecture's terms. Written after reading the pages.
- **Blind set:** 39 questions written by Haiku from each page, told NOT to
  reuse its distinctive words (`evals/retrieval_blind.py`, $0.031) — the
  check on the hand set's bias.
- Scopes: `note` (one course's two lectures, as the workspace searches) and
  `brain` (all four pooled). Metrics: hit@1/3/5/10, MRR.

## Results (note scope; brain scope agrees)

| variant | MRR hand / blind | hit@1 | hit@5 | hit@10 |
|---|---|---|---|---|
| baseline (the app) | 0.809 / 0.685 | 0.71 / 0.51 | 0.97 / 0.87 | 1.00 / 0.97 |
| nomic prefixes (`search_query:` / `search_document:`) | 0.830 / 0.707 | 0.74 / 0.54 | 0.98 / 0.90 | 1.00 / 0.97 |
| prefixes + context header | 0.774 / 0.700 | | | |
| words only (BM25) | 0.901 / 0.549 | 0.84 / 0.38 | 0.98 / 0.74 | 1.00 / 0.92 |
| hybrid, words at full weight | 0.898 / 0.668 | 0.83 / 0.49 | 1.00 / 0.92 | 1.00 / 1.00 |
| **hybrid, words at half weight** | **0.870 / 0.696** | **0.78 / 0.54** | **1.00 / 0.95** | **1.00 / 1.00** |

- Hand set, baseline → hybrid: 14 questions better, 2 worse (rank 2 → 3).
- **The bias check mattered:** words alone win the hand set and collapse on
  the blind one (0.55). Equal-weight fusion loses a little on blind MRR.
  Half weight was the only setting at least as good as the baseline on every
  column of both sets — chosen as the best WORST case, not tuned to one set.
- Nomic prefixes: +0.02 on both sets (6 better / 4 worse) — about noise, and
  they would require re-embedding every stored vector. Not shipped.
- A context header in the embedded text hurt paraphrased questions. Not shipped.

## Shipped
- `services/hybrid_search.py` — BM25 + weighted reciprocal-rank fusion; the
  eval imports it, so it measures the app's code.
- Workspace AI (`services/workspace/chat.py::retrieve_chunks`): 40 embedding
  candidates fused with word matching over all the note's pieces → top 10.
  Pieces that never got an embedding are now findable; if the embedding
  server is down, words alone answer instead of the chat losing its sources.
- App-wide chat and `brain.search_brain` (`services/retriever.py`): pass 2
  (blocks inside the chosen notes) fused the same way.
- Real data (ML Lecture 10 note, 6 questions): 2 better (2→1, 8→5), 3 still
  first, 1 worse (1→5); the right page was in the 10 excerpts every time.
  ~0.4 s per search. `one-ai-live` green: cited answer, Insert/Undo, delete
  refused.

## Found: the app-wide search cannot see 68% of the notes with text
The user's account: 274 live notes, 185 of them empty; of the **80 with text,
only 26 have a descriptor — 54 are invisible** (e.g. "Principles of Remote
Sensing", "Classical Classification Algorithms", "Lect03_IML26.pdf").
Pass 1 picks notes by descriptor embedding, so a note without one can never be
found by the chat or `brain.search_brain` — e.g. both `EMAIL_CANDIDATURE`
notes. Indexing only happens from a 30-second timer in the note editor after
an edit; imported, AI-written and untouched notes are never indexed.
This is a bigger loss than any ranking change. Options (user's call — they
spend money and write index rows):
1. **Backfill**: index every note once (`POST /internal/reindex` exists).
   Embeddings are local and free; each note's descriptor is one model call
   (median $0.0012 in `ai_runs`) — ~$0.06 for the 54.
2. **Index on the server** whenever a note is created or saved by any path,
   instead of the editor's timer.
3. **Words in pass 1**: `notes.fts` already covers every note; fuse it into
   note selection so an unindexed note is still found (free, no backfill).

## Not done
- Pass 1 (note choice) is not modelled by this eval.
- Snippets are cut to 300 characters in the app-wide chat (the model sees a
  third of each block). Changing it needs an answer-quality check, not a
  ranking one.
- Reranking with a cross-encoder: too heavy for this machine's RAM.
