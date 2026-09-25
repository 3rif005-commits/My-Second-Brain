# E9 — study guides from 3+ sources: plan, then write chapter by chapter

**Status:** 2026-09-26 — **ON for guides from 3+ sources** (user:
"go ahead with your recommendation"; `SYNTHESIS_CHAPTERS_MIN_SOURCES=3`, 0 turns
it off). About 2× the cost of such a guide. Spent $0.99 (solo + one-call
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

## Decision (user, 2026-09-26)
On from 3 sources. Single- and two-source guides are never affected.
- The pre-run estimate (and so the per-run cost cap) follows the chaptered
  shape, calibrated on these runs: IML 08+09+10 estimated $0.246, measured
  $0.246–0.263. The one-call estimate ($0.11) would have let the cap stop a
  large guide half-way.
- Verified: the functions end to end with the real model (the eval), and the
  app's wiring by tests (3 sources → chapters, 2 → one call, a failed plan →
  one call, a cut-off chapter marks the guide). **Not yet run through the
  running app with three real uploads** (~$0.25).

## The user's choice, not a forced method (2026-09-26)
User: make the method something the user calls, edits and checks — "we do
not force any method". Built:
- **Setting** on the study-guide skill, Settings → Skills → "Several sources":
  Automatic (default: chapters from 3 sources) · One pass · Chapter by
  chapter. Saved in the user's copy as `multi_source`; the instructions stay
  byte for byte (tested). Only the study guide shows it.
- **Per run**: `/study-guide deep` (chapter by chapter) or `/study-guide
  quick` (one pass) — the first word of the focus; the rest stays the focus
  and now reaches the planner and every chapter.
- **Editable planner**: `skills/study-guide/reference/chapter-plan.md`
  (Files tab), read at call time.
- **Quality check on every guide** (`services/workspace/guide_check.py`, no
  model): per source — sections, concepts, guide text per source character —
  and form (one title, an Overview per chapter, known boxes, page links, cut
  off). A slide-like source (< 1,500 chars/page) under 1.0 text per character
  is "thin" (calibrated: solo 1.19–1.96, chaptered 1.69–2.72, one call for
  three 0.89–1.37; flags exactly the thin one-call lectures, no solo or
  chaptered one). The card says so and offers "Try again chapter by
  chapter"; the assistant hears it too. Nothing is blocked.
- **Bug found on the way:** the AI panel's `/study-guide` called the writer
  without its sources, so the chapter method switched on the day before never
  ran there — only on the older Generate path. Fixed; the panel is the path
  users take.
- The note scorer moved into the app (`services/workspace/note_score.py`;
  `evals/score_note.py` re-exports it): the card's check uses it.
- **Live, in the running app** (`e2e/panel-guide-three-live.spec.ts`, ~$0.25 a
  run): three real IML PDFs attached in the AI panel, `/study-guide` → card
  "Written chapter by chapter · every source covered", 9 chapters, 76 boxes,
  24 tables; Settings → Skills shows "Several sources: Automatic". The first
  live run found a guide with page links pointing nowhere: a malformed or
  foreign anchor ("2:p:3-5") was not recognised by the anchor repair, which
  then ADDED a second anchor beside it — the bad one still won. Bad anchors
  are now dropped before repair, and chaptered guides are repaired like the
  Markdown path. The second run was clean.
