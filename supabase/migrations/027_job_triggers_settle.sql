-- 027 — "When I add a source here" (harness 5.3, milestone 4): the debounce
-- timestamp a source-added trigger needs, and one trigger per note.
--
-- A trigger fires 2 minutes after the LAST source on the note settles, so
-- dropping 3 files produces one job, not three. `next_check_at` is that
-- debounce point, pushed forward every time a source settles while the
-- trigger is on; the worker tick fires it once nothing pushes it further.
--
-- Run in the Supabase SQL editor. Safe to run twice.

ALTER TABLE ai_job_triggers
  ADD COLUMN IF NOT EXISTS next_check_at timestamptz;

CREATE INDEX IF NOT EXISTS ai_job_triggers_due_idx
  ON ai_job_triggers (next_check_at) WHERE enabled AND next_check_at IS NOT NULL;

-- One "when a source is added" trigger per note — the rail is a single line,
-- not a list. A schedule trigger has no such limit.
CREATE UNIQUE INDEX IF NOT EXISTS ai_job_triggers_one_per_note
  ON ai_job_triggers (note_id) WHERE kind = 'source_added';

-- Check
SELECT 'column: ' || column_name AS applied
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'ai_job_triggers' AND column_name = 'next_check_at';
