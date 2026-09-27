-- 024 — changes other apps ask for, waiting for your approval (5.4, phase 2)
--
-- A connected app (claude.ai, ChatGPT…) may ask to edit or delete one of your
-- notes. Nothing changes until you click Approve in Settings → Connected apps.
-- A delete moves the note to the Trash (restorable), never deletes it for good.
--
-- Run in the Supabase SQL editor. Safe to run twice.

CREATE TABLE IF NOT EXISTS mcp_pending_changes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id   text        NOT NULL REFERENCES mcp_clients(client_id) ON DELETE CASCADE,
  note_id     uuid        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  action      text        NOT NULL CHECK (action IN ('update', 'delete')),
  payload     jsonb       NOT NULL DEFAULT '{}',   -- update: new title / text
  reason      text,                                -- what the app said it is for
  status      text        NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE INDEX IF NOT EXISTS mcp_pending_user_idx
  ON mcp_pending_changes (user_id, status, created_at DESC);

ALTER TABLE mcp_pending_changes ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the backend's service role reads or writes.

-- Check
SELECT 'table: ' || table_name AS applied
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'mcp_pending_changes';
