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

## Arm B — Markdown+fences

_(filled in when the arm completes)_

## Reading it

Pending. The comparison that matters is output tokens at equal structure
score; latency is a proxy for the same thing and already looks different.
