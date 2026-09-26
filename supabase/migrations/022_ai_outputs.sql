-- 022 — what the AI wrote, kept, so the app can learn from how you edit it (E12)
--
-- When an AI result (a study guide, flashcards…) is put into a note, the app
-- stores the AI's version here. "Learn from my edits" (Settings → Skills →
-- Study guide → Your style) compares it with the note as you left it and
-- SUGGESTS style preferences; nothing is applied until you accept one.
--
-- Run in the Supabase SQL editor. Safe to run twice.

CREATE TABLE IF NOT EXISTS ai_outputs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  note_id     uuid        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  skill       text        NOT NULL,
  html        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_outputs_user_skill_idx
  ON ai_outputs (user_id, skill, created_at DESC);

ALTER TABLE ai_outputs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_outputs_own ON ai_outputs;
CREATE POLICY ai_outputs_own ON ai_outputs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Check
SELECT 'table: ' || table_name AS applied
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'ai_outputs';
