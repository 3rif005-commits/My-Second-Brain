-- 035 — the units of an AI-written note (worksheet solver, Phase 1)
-- Design: docs/INTERACTIVE_NOTES_DESIGN.md · plan: docs/plans/2026-11-24-units-phase1.md
--
-- A unit is a piece of the note you check and fix on its own: an exercise, a
-- question, a sub-part. Each row ties the unit's heading block to the passage of
-- the source it answers, keeps its plan (kind, rules, importance), its state
-- (planned / written / checked / flagged), what the free checks found, and the
-- AI's earlier versions so a Redo can be taken back.
--
-- Run in the Supabase SQL editor of the live project BEFORE pushing the code
-- that uses it. Safe to run twice.

CREATE TABLE IF NOT EXISTS note_units (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id      UUID        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key          TEXT        NOT NULL,            -- "1", "1.2", "1.2.1", "overview", "revision", "" (title)
  skill        TEXT        NOT NULL DEFAULT 'solve-worksheet',
  block_id     TEXT,                            -- the unit's heading block, once in the note
  parent_key   TEXT,
  depth        INT         NOT NULL DEFAULT 2,  -- heading level it is written at
  label        TEXT        NOT NULL DEFAULT '',
  title        TEXT        NOT NULL DEFAULT '',
  question     TEXT        NOT NULL DEFAULT '', -- the grey line
  quote        TEXT        NOT NULL DEFAULT '', -- the question's own words in the source
  resource_id  UUID        REFERENCES workspace_resources(id) ON DELETE SET NULL,
  page         INT,
  kind         TEXT        NOT NULL DEFAULT '', -- Recall / Short / Multi-step / Open
  rules        JSONB       NOT NULL DEFAULT '[]',
  importance   TEXT        NOT NULL DEFAULT '', -- red / orange / yellow / ''
  state        TEXT        NOT NULL DEFAULT 'planned'
               CHECK (state IN ('planned','written','checked','flagged')),
  problems     JSONB       NOT NULL DEFAULT '[]',
  versions     JSONB       NOT NULL DEFAULT '[]', -- earlier AI versions, newest last
  pending      BOOLEAN     NOT NULL DEFAULT FALSE, -- a Redo waiting for Keep / Back to old
  position     INT         NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (note_id, key)
);

CREATE INDEX IF NOT EXISTS note_units_note_idx ON note_units(note_id);

ALTER TABLE note_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS note_units_owner_all ON note_units;
CREATE POLICY note_units_owner_all ON note_units
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';

-- Proof it applied: one row, the column count of the new table.
SELECT count(*) AS note_units_columns
FROM information_schema.columns WHERE table_name = 'note_units';
