# E13 — The output cap on real lectures

Date: 2026-09-24 · Model: `claude-haiku-4-5` · Case: `rs-lectures-two`

**Why:** the first real case (two consecutive Remote Sensing lectures, ~6.4K
words) hit the 16,000 output-token cap in 3/3 runs. Every note ended
mid-section; 1/3 passed because a lecture-3 term missed the cut. The app's
synthesis uses the same cap, so real two-lecture guides are cut off today.
(Detection shipped first, as a bug fix: `1b5c095`.)

**Hypothesis:** the guide the prompt asks for is longer than 16K tokens for two
real lectures; raising the cap lets it finish, at a proportional cost.

**Change (arm B):** `--max-tokens 32000` (app: `synthesis.py`, `skill_run.py`).
**Primary:** pass rate on `rs-lectures-two`, and runs truncated.
**Guardrails:** $/run (baseline $0.10) and latency (baseline 156 s) — a guide
that finishes but costs 3× or takes 6 minutes is its own problem.

## Baseline (A, 16K cap, n=3 — `real-baseline`)

| pass | truncated | out tokens | $/run | latency |
|---|---|---|---|---|
| 1/3 | 3/3 | 16,001 | 0.102 | 156 s |

## Arm B (32K cap, n=3 — `e13-cap32k`)

| pass | truncated | out tokens (per run) | anchors | $/run | latency |
|---|---|---|---|---|---|
| **3/3** | **0/3** | 17,615 · 25,594 · 14,691 | 19 · 25 · 18 (was 15 · 11 · 16) | 0.110 (+8%) | 175 s (+12%) |

The guide the prompt asks for simply is longer than 16K for two real lectures:
the natural length ranged 14.7K–25.6K. Cut at 16K, it lost the second
lecture's tail — the anchor count shows it (more anchors once the note
reaches lecture 3's sections).

**Primary:** 1/3 → 3/3, truncated 3/3 → 0/3. **Guardrails:** cost +8%, latency
+12% — both within reason; the per-run budget ($0.50) still clears the worst
case (~$0.17 at 32K).

## Decision: KEEP — `OUTPUT_CAP = 32000` (synthesis + skill runs)

The eval runner's default `--max-tokens` now matches the app, so every
future baseline measures what users get. Earlier reports ran at 16K.

**Found along the way (queued):** the pre-run price estimate assumes ~10K
output tokens (`_OUTPUT_CHARS_ESTIMATE`, skill_run's 40K chars); real guides
from two lectures are ~17.6K, so the chip under-quotes by about half.
