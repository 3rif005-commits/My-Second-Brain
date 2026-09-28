-- 025 — background jobs: queue a skill to run later (harness 5.3, milestone 1)
--
-- One row per job. A job never writes to note_synthesis (that row is the live
-- draft); its result waits on the job row until you click Put in note.
-- The trigger table holds "when I add a source here" and schedules (M4/M5); it
-- is created now so you only apply one migration.
--
-- Run in the Supabase SQL editor. Safe to run twice.

CREATE TABLE IF NOT EXISTS ai_jobs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  note_id            uuid        REFERENCES notes(id) ON DELETE SET NULL,
  skill              text        NOT NULL,
  focus              text        NOT NULL DEFAULT '',
  status             text        NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','submitted','ready','applied','discarded',
                                       'failed','cancelled','expired','budget_blocked',
                                       'needs_you','skipped')),
  trigger            text        NOT NULL DEFAULT 'run_later',  -- run_later | source_added | schedule
  trigger_id         uuid,
  price_mode         text        NOT NULL DEFAULT 'normal'
                     CHECK (price_mode IN ('normal','batch','local')),
  run_after          timestamptz NOT NULL DEFAULT now(),
  shown_estimate_usd numeric,                 -- what the user was shown when they queued it
  cap_usd            numeric,                 -- this job's spending limit
  model              text,
  provider           text,
  provider_batch_id  text,                    -- M3
  attempts           int         NOT NULL DEFAULT 0,
  ran_late           boolean     NOT NULL DEFAULT false,
  source_ids         jsonb       NOT NULL DEFAULT '[]',
  source_hash        text,                    -- M5 stale check
  dedupe_key         text,                    -- M4
  result_html        text,
  result_title       text,
  result_meta        jsonb       NOT NULL DEFAULT '{}',   -- truncated, method, check
  actual_usd         numeric,
  live_equivalent_usd numeric,
  ai_run_id          uuid,
  error              text,
  cancel_reason      text,
  opened_at          timestamptz,             -- first time the user opened the result
  created_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  applied_at         timestamptz,
  applied_note_id    uuid,
  discarded_at       timestamptz
);
CREATE INDEX IF NOT EXISTS ai_jobs_user_idx ON ai_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_jobs_due_idx  ON ai_jobs (run_after) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS ai_jobs_note_idx ON ai_jobs (note_id, status);

CREATE TABLE IF NOT EXISTS ai_job_triggers (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  note_id        uuid        REFERENCES notes(id) ON DELETE CASCADE,
  kind           text        NOT NULL CHECK (kind IN ('source_added','schedule')),
  skill          text        NOT NULL,
  cadence        jsonb,                        -- schedule: {every, weekday, at}
  month_cap_usd  numeric     NOT NULL DEFAULT 1.00,
  enabled        boolean     NOT NULL DEFAULT true,
  paused_reason  text,
  last_run_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_job_triggers_user_idx ON ai_job_triggers (user_id, enabled);

ALTER TABLE ai_jobs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_job_triggers ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the backend's service role reads or writes.

-- Check
SELECT 'table: ' || table_name AS applied
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('ai_jobs', 'ai_job_triggers');
