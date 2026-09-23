# E6 — Markdown+fences vs the BlockNote HTML dialect

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
