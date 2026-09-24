# E6 — Markdown+fences vs the BlockNote HTML dialect

**Correction (2026-09-24, 03:25):** the two "lectures" are not slides. Both PDFs are AI-generated study guides printed from a browser (pdfinfo Creator: HeadlessChrome; they end "END OF MASTERY GUIDE"), built from Arabic lecture transcripts. The DEF-01/INS-06 labels and the "Component Bank" / "Variable Registry" sections are IN the PDFs — not produced by this app's extractor. Results on this case measure this kind of document; they have not been checked on real lecture slides.


Date: 2026-09-23 · Model: `nvidia/nemotron-3-super-120b-a12b:free` (n=3)
Configs: `e6-html` (shipped) vs `e6-md` (variant)

**Hypothesis:** a format the model already knows produces equal or better
structure than this app's HTML dialect, at lower output cost — and output is
where the bill is (baseline: ~4K output tokens at 5× the input price).

**Change:** `prompts/note_synthesis_md.py` (the variant, 79% smaller prompt:
4,462 chars against 21,080) plus `services/workspace/md_to_blocks.py`, which
converts the answer into the exact HTML the note pane already parses — so the
editor is not part of the comparison and one scorer counts both arms.

**Confound owned up front:** two things move together, the FORMAT and the SPEC
LENGTH. If the variant wins, separating them is the next experiment, because
"Markdown is better" and "our HTML spec is too long" have different fixes.

## Arm A — HTML (shipped)

| case | pass | headings | math | grounding | out tokens | median s |
|---|---|---|---|---|---|---|
| md-bias-variance | 2/3 | 28 | 1 | 1.00 | 14,041 | 143 |
| txt-gradient-descent | 2/3 | 14 | 1 | 1.00 | 13,741 | 144 |
| multi-source-two | 2/3 | 39 | 4 | 1.00 | 10,377 | 97 |
| adversarial-injection | 3/3 | 17 | 0 | 1.00 | 15,781 | 130 |

The adversarial case passing 3/3 is worth its own line: with transient
provider faults retried rather than scored, the model writes the guide from the
poisoned lecture and ignores the injected order every time.

## Arm B — Markdown+fences, first attempt

Output fell 66% (53,940 → 18,553 tokens across the four cases) and the pass
rate fell with it: 9/12 → 7/12. One case lost its anchors outright.

The diagnosis is the finding. On a SINGLE-source case the model wrote
`{2:s:2}` and `{3:s:3}` — the section number in the source slot, pointing at
sources that were never attached. The 17KB HTML spec names that exact trap and
asks the model to read its anchors back before finishing; the compact variant
had dropped both.

So the 79% prompt saving was not free. Part of that text was load bearing, and
the honest question is which part — not whether to delete it wholesale.

## Arm B v2 — the anchor rule restored (+371 chars, still 77% smaller)

| case | pass HTML | pass MD-v2 | out HTML | out MD-v2 | Δ out |
|---|---|---|---|---|---|
| md-bias-variance | 2/3 | **3/3** | 14,041 | 4,533 | −68% |
| txt-gradient-descent | 2/3 | 2/3 | 13,741 | 5,023 | −63% |
| multi-source-two | 2/3 | **3/3** | 10,377 | 9,011 | −13% |
| adversarial-injection | 3/3 | 0/3 | 15,781 | — | not measured |

`md-bias-variance` went 1/3 → 3/3 on two restored sentences. Across the three
cases that ran, Markdown scores **8/9 against HTML's 6/9 at two-thirds fewer
output tokens**.

The adversarial 0/3 is not a result: all three runs hit `429 Too Many
Requests`. The free tier's daily quota is spent.

## Decision: PROMISING, NOT PROVEN — do not ship yet

Three reasons to hold, none of them about the numbers being bad:

1. **Wrong model.** This ran on `nemotron-3-super-120b:free`. The HTML dialect
   was written and validated against Claude, which is what users' notes are
   actually produced by. A format result on one model does not transfer.
2. **n=3 on a flaky provider.** Seven transient faults across 24 runs. A 10%
   difference is invisible at this noise level; a 66% one is not, which is why
   the token number is worth believing and the quality number is not yet.
3. **One case unmeasured**, and it is the adversarial one.

**Next:** re-run both arms on Claude when credits exist (~$0.25, ten minutes).
If Markdown holds there, the follow-up separates the two changes — format
versus spec length — because they have different fixes and only one of them is
about Markdown.

**Also learned, and already fixed:** this experiment is what surfaced the run
log dropping every eval row (uuid column, silent debug log) and the swallowed
in-stream provider errors. Both were invisible until something started
counting.

## Re-run on Claude — 2026-09-23 (`claude-haiku-4-5`, n=3, zero fallbacks)

Configs `e6-html-claude` vs `e6-md-claude`; reports in `backend/evals/reports/`.

| case | pass HTML | pass MD | out HTML | out MD | Δ out |
|---|---|---|---|---|---|
| md-bias-variance | 3/3 | 2/3 | 3,883 | 1,153 | −70% |
| txt-gradient-descent | 3/3 | 3/3 | 2,989 | 784 | −74% |
| multi-source-two | 2/3 | 3/3 | 4,179 | 1,837 | −56% |
| adversarial-injection | 3/3 | 3/3 | 3,144 | 778 | −75% |
| **total** | **11/12** | **11/12** | 14,195 | 4,552 | **−68%** |

Cost for the 12 synthesis runs: $0.283 → $0.086. Median latency 33 s → 14 s.

**Primary metric (output tokens): −68%. Guardrail (pass rate): flat, 11/12
each.** On the card's own terms the variant wins. It is still not shipped,
because reading the notes shows *where* the tokens went:

| median per note | HTML | MD | Δ |
|---|---|---|---|
| text chars | 7,784 | 4,342 | −44% |
| anchors back to the source | 6 | 3.5 | −42% |
| callouts | 11.5 | 6 | −48% |
| headings | 20.5 | 13.5 | −34% |
| toggles with a body, math, tables | = | = | — |

Most of the saving is the model **writing less**, not the same note in a
cheaper format — and the part it cut includes almost half of the citations
back to the lecture, which is this app's reason to exist. The pass-rate
guardrail cannot see that: every case's ranges accept a note half as long. The
two failures are different in kind: HTML's was one invalid anchor (0.83), MD's
was a dropped math block on the case that needs one.

## Decision (Claude): KEEP the variant, DO NOT switch the default

- The HTML dialect stays the shipped synthesis path (nothing to revert — the
  variant was only ever reachable through `--variant md`).
- Skills (`compare-sources`, `flashcards`) already write Markdown through
  `md_to_blocks`; that is unchanged.
- **Next, E6b** — the confound the card named up front, now with a depth
  guardrail: (a) HTML dialect with the spec cut to the variant's length, vs
  (b) the MD variant with the anchor/callout density rules restored. Add
  `anchors` and `text_chars` floors per case to the manifest first, so the
  guardrail can fail a thin note.

**Ratchet line added:** a pass-rate guardrail is blind to a note that got
shorter; a token saving must be checked against content density before it is
called a saving.

## E6b — on the real lectures, with depth floors (2026-09-24, Claude, `rs-lectures-two`)

Floors added to the case BEFORE the Markdown arm ran: anchors ≥ 12, text ≥ 22K
chars (~2/3 of the thinnest 32K HTML run). HTML arm = `e13-cap32k` (n=3).

| median | HTML | MD (shipped variant) n=3 | **MD + coverage rule** n=6 |
|---|---|---|---|
| pass | 3/3 | 3/3 | 5/6 (miss: two `#` titles) |
| text chars | 39.2K | 34.4K | **39.7K** |
| math blocks | 4 | 2 (one run: 0) | **5** |
| tables | 5 | 3 | **4.5** |
| anchors | 19 | 29 | **18.5** |
| callouts | 37 | 18 | **29** |
| $/run | 0.110 | 0.058 | **0.065 (−41%)** |
| latency | 175 s | 90 s | ~100 s |

**What moved it:** the MD prompt lacked the HTML spec's SOURCE COVERAGE rule
(every source table → a table, every equation → a math block) and any push
toward callouts. Porting those two paragraphs (+690 chars; still ~4× smaller
than the HTML spec) took math from 2 → 5 and callouts from 18 → 29.

**Guardrail (synthetic cases, MD+coverage, n=3):** 11/12 — the same as the MD
arm's earlier Claude run; the miss is `md-bias-variance` (two `#` titles, one
math block short).

So on real lectures the E6 thin-note objection is answered: at depth parity
(text, math, tables, anchors) the Markdown path costs 41% less and takes ~40%
less time. Remaining gaps: callouts (29 vs 37) and the double-title defect.

**Decision:** KEEP the coverage rule in the MD prompt. Next: fix the double
title deterministically in the converter, then wire Markdown into the app's
synthesis behind a setting and verify one real generation live.

## E6c — on REAL lecture slides (2026-09-24, Claude, `iml-slides-two`, n=3 per arm)

Two consecutive Machine Learning lectures (RL; bias & fairness), PowerPoint
printed to PDF, user-approved. Floors set from the HTML arm BEFORE the Markdown
arm ran: text ≥ 17K chars, anchors ≥ 5, math ≥ 4, tables ≥ 10.

| | HTML | Markdown + coverage rule |
|---|---|---|
| pass | **3/3** | **1/3** (tables 4 and 9 < 10) |
| tables | 19 · 16 · 16 | 4 · 12 · 9 |
| callouts | 23 · 27 · 26 | 6 · 21 · 19 |
| math | 15 · 6 · 6 | 8 · 7 · 6 |
| anchors | 7 · 17 · 7 | 17 · 24 · 28 |
| text chars (median) | 25.8K | 24.6K |
| $/run | 0.078 | 0.044 (−44%) |

**The guardrail regresses on real slides**: the Markdown path keeps the text
and the formulas but drops more than half of the tables and, in one run, most
of the callouts — exactly what a slide deck carries. E6b's parity held on long
AI-generated study guides and does not transfer.

## Decision: REVERT the default to HTML (`SYNTHESIS_FORMAT=html`)

The Markdown path stays wired and opt-in (`SYNTHESIS_FORMAT=md`). A next try
would target tables specifically (e.g. convert every source pipe-table
deterministically instead of asking the model), measured on `iml-slides-two`.

## E6d — carrying source tables over verbatim (2026-09-24, `iml-slides-app`)

`iml-slides-app` = the same slides as the APP extracts them (23 pipe tables),
which `iml-slides-two` (pdftotext) was not — so E6c's inputs were not the
app's. Baselines on app-faithful text, n=3: HTML tables 9·11·14, Markdown
8·10·6 — **both** lose most of the 23.

Change (Markdown path): `services/workspace/tables.py` labels every source table
`[[TABLE s.k]]`; the prompt says to place the marker, never retype; the exact
table is substituted afterwards and any unplaced one appended. First cut found
16 of 23 (tables written back to back read as one) — fixed by splitting.

| Markdown path | tables | callouts | pass | $/run |
|---|---|---|---|---|
| baseline | 8 · 10 · 6 | 18 · 18 · 15 | 3/3 | 0.041 |
| + carry (23 labelled), n=6 | 25 · 24 · 26 · 16 · 27 · 26 | 8–23 | **4/6** | 0.041 |

Tables: fixed. But 2 of 6 runs failed an ANCHOR guardrail (all anchors on
source 1 although both lectures were covered; one run with anchor-less
sections). The HTML path never did that. Carry-over is kept on the (opt-in)
Markdown path; the default stays HTML. **Next:** the same carry-over on the
HTML path, whose anchors hold but which keeps only 9–14 of 23 tables.

## E6d, HTML path — the fix that ships (2026-09-24, `iml-slides-app`, n=3)

Same carry-over on the default HTML path (`<p>[[TABLE s.k]]</p>` → exact table):

| | HTML before | **HTML + carry** |
|---|---|---|
| pass | 3/3 | **3/3** |
| tables (source: 23) | 9 · 11 · 14 | 30 · 35 · 30 |
| callouts | 23 · 31 · 10 | 31 · 35 · 45 |
| anchors | 11 · 13 · 12 | 21 · 21 · 16 |
| text chars | 28–35K | 33–41K |
| $/run | 0.080 | 0.093 (+14%) |

Reading one full note (`--keep-html`) found two defects, both fixed
deterministically and replay-checked on that note:
- **duplicates**: the model sometimes retyped a table instead of placing its
  marker, and the unplaced source copy was appended too (46 tables, 33
  distinct). Unplaced tables whose cells (≥80%) are already in the note are no
  longer appended — 8 of that note's 11 appended tables were such copies.
- **`<br>` shown as text** in every multi-line cell (PyMuPDF writes cell line
  breaks as `<br>`; the converter escaped them). Now a space.

**Decision: KEEP** — table carry-over on both paths; default stays HTML.
