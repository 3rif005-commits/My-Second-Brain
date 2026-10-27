-- 032 — pinned MCP tools, and "About you" memory
-- Design: docs/agent-tools-study/DIAGNOSIS.md (gaps 3 and 5)
--
-- 1. mcp_servers.approved_tools: the tools a user has seen and accepted, as
--    {tool name: fingerprint of name + description + input schema}. A tool
--    that appears or changes later is held back from the model until the user
--    approves it in Settings → MCP servers (OpenShell: new access waits for
--    review). NULL = nothing pinned yet: the next successful discovery pins
--    what the server offers then (trust on first use, like SSH known_hosts).
--
-- 2. user_memory: short facts and preferences the user keeps about themselves
--    (Hermes Agent's USER.md). Loaded into the chat's system prompt; editable
--    in Settings → About you. Sizes are enforced in the API as well; the CHECKs
--    are the floor if anything else writes here.
--
-- Run in the Supabase SQL editor. Safe to run twice.

ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS approved_tools jsonb;

CREATE TABLE IF NOT EXISTS user_memory (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content     text        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 300),
  -- 'user': typed in Settings. 'assistant': proposed by the chat and saved
  -- through the memory.remember tool (shown with a mark, deletable).
  source      text        NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'assistant')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_memory_user_idx ON user_memory (user_id, created_at);

ALTER TABLE user_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_memory_own ON user_memory;
CREATE POLICY user_memory_own ON user_memory
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- The API layer (PostgREST) only sees new columns and tables after a reload.
NOTIFY pgrst, 'reload schema';
