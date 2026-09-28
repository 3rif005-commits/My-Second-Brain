-- 028 — schedules (harness 5.3, milestone 5): what "on a schedule" needs beyond
-- what "when a source is added" already added in 027.
--
-- `last_source_signature` is the note's `source_signature` the last time this
-- trigger actually ran (not a skip) — compared against the CURRENT signature
-- to decide "nothing changed" (spec: a scheduled run happens only if the
-- note's sources changed since the last run).
--
-- `paused_kind` distinguishes the two ways a trigger pauses itself, because
-- they clear differently: a monthly-limit pause is recomputed and lifts on
-- its own once the month rolls over; an "you never opened the last 3
-- results" pause stays until the user clicks Resume. `paused_reason` (027)
-- already holds the sentence shown for either.
--
-- Run in the Supabase SQL editor. Safe to run twice.

ALTER TABLE ai_job_triggers
  ADD COLUMN IF NOT EXISTS last_source_signature text,
  ADD COLUMN IF NOT EXISTS paused_kind text
    CHECK (paused_kind IN ('month_cap', 'unopened'));

-- Check
SELECT 'column: ' || column_name AS applied
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'ai_job_triggers'
  AND column_name IN ('last_source_signature', 'paused_kind');
