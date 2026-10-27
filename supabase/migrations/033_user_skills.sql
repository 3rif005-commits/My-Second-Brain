-- 033 — skills per user
-- Design: docs/agent-tools-study/SKILLS_PLAN.md (step 1)
--
-- Until now a user's skills (edited built-ins, new skills, "Your style" files)
-- were files in ONE folder on the server, ~/.secondbrain/skills: every account
-- read and wrote the same folder, so one user's edit became every user's
-- instructions, and on Render the folder vanished at each deploy. Skills are
-- prompt text the AI follows; they belong to one user, like notes.
--
-- One row per (user, skill). `files` maps a path inside the skill folder to its
-- text: "SKILL.md", "reference/style.md", "references/example.md". Built-in
-- skills stay in the repo; a row with a built-in's name is the user's edited
-- copy, and deleting the row is Reset.
--
-- Run in the Supabase SQL editor. Safe to run twice.

CREATE TABLE IF NOT EXISTS user_skills (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  files       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- where the skill came from: 'user' (written or edited in Settings),
  -- 'assistant' (drafted by the chat, saved by the user), 'installed' (from a
  -- source outside the app). Origins decide what a skill may do (step 2).
  origin      text        NOT NULL DEFAULT 'user'
                          CHECK (origin IN ('user', 'assistant', 'installed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, name)
);

ALTER TABLE user_skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_skills_own ON user_skills;
CREATE POLICY user_skills_own ON user_skills
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
