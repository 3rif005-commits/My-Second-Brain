# E3 — the study-guide instructions as a cached prefix

**Status:** decided 2026-09-25 — ON by default (`SYNTHESIS_PROMPT_CACHE`). Arm cost $0.1583.

## What changes
Only how the prompt is **sent**. `synthesis_messages()` cuts the prompt at
`--- SOURCE MATERIAL —` into two parts: the fixed instructions (the user's
study-guide text + synthesis/anchor rules, ~18.7K chars) and this note's
sources. The first part carries Anthropic `cache_control: ephemeral`. The two
parts joined are the old prompt byte for byte (tested). The instructions are
not touched. Switch: `SYNTHESIS_PROMPT_CACHE` (default on since this card; `=false` turns it off).

## Facts before running
- The fixed part was already first — no reordering was needed.
- Haiku 4.5 caches nothing under 4,096 tokens; the fixed part is ~6,000.
- Prices (5-minute cache): write 1.25× input, read 0.1× input. Haiku input
  $1/M, output $5/M.
- A guide costs ~$0.05, and ~$0.04 of that is OUTPUT. The fixed input is
  ~$0.006. So the most caching can save is ~11% of a run, and only on a run
  that starts within 5 minutes of another; a lone run pays ~+3%.
- Fixed before E3: the cost log did not charge cache writes at all
  (Anthropic reports them outside `input_tokens`), which would have shown a
  saving on the very call that pays the premium.

## Metric
- **Primary:** cost per guide, cold (1st run) and warm (runs 2–3, started
  within 5 minutes); `cache_read_tokens` > 0 on warm runs.
- **Guardrail:** the study-guide quality guard (median of 3 vs the approved
  Lecture 10 note) passes, and no dimension's median falls below the control
  arm's range.
- **Control:** the 3 calibration runs of 2026-09-25 (same prompt, same day,
  no cache): $0.0489 / $0.0517 / $0.0579.

## n and cost
n = 3 guides with the cache on, back to back: ~$0.155.

## Decision rule (set before running)
- Keep the code and the switch in any case (off costs nothing).
- Turn it ON by default only if: warm runs read the cache, warm cost is
  ≥ 5% below the control median, and the guardrail holds.
- Otherwise leave it off, and say why.

## Result
Claude Haiku 4.5, ML Lecture 10, 3 guides back to back, cache on:

| run | input | cache write | cache read | output | $ |
|---|---|---|---|---|---|
| 1 (cold) | 4,445 | 4,933 | 0 | 10,255 | 0.0619 |
| 2 (warm) | 4,445 | 0 | 4,933 | 8,393 | 0.0469 |
| 3 (warm) | 4,445 | 0 | 4,933 | 8,918 | 0.0495 |

Control (no cache): input 9,378 every run; output 7,899 / 8,474 / 9,701;
$0.0489 / $0.0517 / $0.0579.

Output varies by up to 2.4K tokens a run and is ~80% of the price, so the
saving is read off the INPUT, which is exact: 9,378 tokens ($0.0094)
uncached; cold 4,445 + 4,933 × 1.25 ($0.0106, +13% input); warm
4,445 + 4,933 × 0.1 ($0.0049, −47% input). At the control's median output
that is **+2.4% for a lone guide and −8.6% for a guide started within 5
minutes of another**. It breaks even when about 1 guide in 5 follows another
within 5 minutes (several lectures in one sitting, Try again, every eval).
The raw warm runs agree: $0.0469 and $0.0495 vs the control median $0.0517.

Guardrail: quality guard PASS (median chapters 4, sections 18, subsections
25, callouts 24, tables 7, math 12, text 17,163, kinds 8, concepts 17/17),
every median inside or above the control arm's range. One warm run had
3 math blocks — the same spread the control showed (6–15); the median holds.

**Decision (rule set before the run):** warm runs read the cache, warm cost
≥ 5% below control, guardrail holds → ON by default. The instructions were
not changed; the cut is tested to join back byte for byte.

**In the app:** a live `/study-guide` from the AI panel (`panel-job-live`,
2026-09-25 17:49 UTC) wrote the cache (4,933 tokens) and its `ai_runs` row is
priced with the write premium ($0.0603).
