# E9 — study guides from 3+ sources: plan, then write chapter by chapter

**Status:** 2026-09-25 — built and measured; **switched OFF, waiting on the
user** (it doubles the cost of a 3-source guide). Spent $0.99 (solo + one-call
guides $0.51, chaptered $0.51 — lecture 10 solo guides reused from the quality
guard calibration). The study-guide instructions were not edited.

## Setup
Three consecutive lectures of the user's IML course — 08 Ensembles, 09
Unsupervised learning, 10 Reinforcement learning — extracted exactly as the
app does (`evals/extract_source.py`, byte-identical to the earlier corpus
files on lectures 10 and 11). `python -m evals.multi_source`:
- **solo**: each lecture's own guide (n=2, lecture 10 n=3);
- **single**: the app today, all three in one call (n=2);
- **chaptered**: plan the chapters, write each in its own call (n=2).
Per-lecture depth = the sections anchored to that lecture, as a share of its
solo guide.

## Step 1 — the problem (one call, three lectures)
| lecture | text | tables | formulas | boxes |
|---|---|---|---|---|
| L08 | 72–81% | 73–100% | 50% | 56% |
| L09 | 55–70% | 57% | **26%** | 41–48% |
| L10 | 102–106% | 100–117% | 120–127% | 53–65% |
Not truncated (22–25K of 32K output tokens): the model writes each lecture
shorter when it covers three. An OUTPUT problem — so "read each source alone,
then combine" (the first idea) would not fix it: the combine step is still
one answer.

## Step 2 — plan, then write each chapter
`services/workspace/chaptered.py`: a plan call returns the chapters
(organized by concept, every page assigned — unclaimed pages go to the
chapter using the nearest page), then each chapter is written in parallel by
the ordinary synthesis prompt (instructions byte for byte, tested) over only
its pages, followed by an engine note naming the chapter. One `<h1>` joins
them. A bad plan falls back to one call.

| lecture | text | tables | formulas | boxes |
|---|---|---|---|---|
| L08 | 137–148% | 109–127% | 50–200% (1–4 of 2) | 175–194% |
| L09 | 132–159% | 86–143% | 89–94% | 152–159% |
| L10 | 151–206% | 100–133% | 60–113% | 76–165% |

- Format holds: one `<h1>`, an OVERVIEW box per chapter (9–10 chapters),
  grounding 1.00, every anchor valid, no invented box types.
- Concepts 84–114 vs 45–65 in one call; 1–2 repeated concept titles
  ("boosting", "TDE") — small overlap between neighbouring chapters.
- **Cost $0.246–0.263 vs $0.125–0.138 (about 2×)**, not the +40% estimated:
  output 38–44K tokens vs 22–25K — the depth IS the output. The repeated
  instructions are cached (E3). Faster: 2 min vs 3.5 min (parallel).
- Guides kept for reading: `backend/evals/reference/e9/`.

## Decision (user)
Switch: `SYNTHESIS_CHAPTERS_MIN_SOURCES` (0 = off; 3 = guides from 3+ sources).
Single-source guides are never affected.
