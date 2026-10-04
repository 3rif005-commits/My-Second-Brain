-- 029 — privacy levels + the routing switchboard
-- Spec: docs/superpowers/specs/2026-10-04-local-brain-switchboard-design.md
--
-- 1. notes.sensitivity — open | personal | private. A database row is a notes
--    row and a source belongs to its note, so this one column covers notes,
--    rows and sources. `local_only` (009) becomes the same fact as
--    sensitivity = 'private'; a trigger keeps the two in step so code that
--    still writes local_only keeps working.
-- 2. routing_policies — the user's editable routing policy, one row per
--    version; the newest row is the active one.
-- 3. routing_decisions — one row per routed request: where it ran, who
--    decided, why, and how many items the privacy gate withheld. Reasons and
--    counts only, never note content.
--
-- Run in the Supabase SQL editor. Safe to run twice.

-- ---- 1. sensitivity -------------------------------------------------------

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS sensitivity text NOT NULL DEFAULT 'personal';

DO $$ BEGIN
  ALTER TABLE notes ADD CONSTRAINT notes_sensitivity_check
    CHECK (sensitivity IN ('open', 'personal', 'private'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Everything already marked local-only is private.
UPDATE notes SET sensitivity = 'private'
WHERE local_only = TRUE AND sensitivity <> 'private';

CREATE INDEX IF NOT EXISTS notes_sensitivity_private_idx
  ON notes(user_id) WHERE sensitivity = 'private';

-- Whichever column a write changed wins; the other follows.
CREATE OR REPLACE FUNCTION notes_sync_sensitivity() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.local_only IS DISTINCT FROM OLD.local_only
     AND NEW.sensitivity IS NOT DISTINCT FROM OLD.sensitivity THEN
    NEW.sensitivity := CASE WHEN NEW.local_only THEN 'private'
                            WHEN OLD.sensitivity = 'private' THEN 'personal'
                            ELSE OLD.sensitivity END;
  ELSIF TG_OP = 'INSERT' AND NEW.local_only AND NEW.sensitivity <> 'private' THEN
    NEW.sensitivity := 'private';
  END IF;
  NEW.local_only := (NEW.sensitivity = 'private');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notes_sync_sensitivity ON notes;
CREATE TRIGGER notes_sync_sensitivity
  BEFORE INSERT OR UPDATE OF sensitivity, local_only ON notes
  FOR EACH ROW EXECUTE FUNCTION notes_sync_sensitivity();

-- ---- 2. routing_policies --------------------------------------------------

CREATE TABLE IF NOT EXISTS routing_policies (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  version     int         NOT NULL,
  policy      jsonb       NOT NULL,          -- slots, rules, instructions, privacy, brain
  note        text        NOT NULL DEFAULT '',  -- "Restored v3", "Edited rules"
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, version)
);

ALTER TABLE routing_policies ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY routing_policies_owner_all ON routing_policies
    FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- 3. routing_decisions -------------------------------------------------

CREATE TABLE IF NOT EXISTS routing_decisions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  thread_id      text,
  message_id     text,
  surface        text        NOT NULL DEFAULT 'chat',
  slot           text        NOT NULL,
  provider       text,
  model          text,
  decided_by     text        NOT NULL
                 CHECK (decided_by IN ('rule', 'brain', 'user', 'fallback')),
  rule_id        text,
  reason         text        NOT NULL DEFAULT '',
  confidence     numeric,
  latency_ms     int,
  signals        jsonb       NOT NULL DEFAULT '{}',
  sent_count     int         NOT NULL DEFAULT 0,
  withheld_count int         NOT NULL DEFAULT 0,
  released_count int         NOT NULL DEFAULT 0,  -- private items the user let through once
  override_of    uuid        REFERENCES routing_decisions(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS routing_decisions_user_idx
  ON routing_decisions(user_id, created_at DESC);

ALTER TABLE routing_decisions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY routing_decisions_owner_all ON routing_decisions
    FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Check
SELECT 'column: notes.sensitivity' AS applied
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'notes' AND column_name = 'sensitivity'
UNION ALL
SELECT 'table: ' || table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('routing_policies', 'routing_decisions');
