-- 021 — every note with text is indexed for search, whatever wrote it (E8)
--
-- Before: a note was indexed only by a 30-second timer in the note editor.
-- Notes written by the AI, by an import, by the workspace, or never edited in
-- the editor were never indexed, and the chat's search could not find them
-- (54 of 80 notes with text in the first account measured).
--
-- After: the backend sweeps for notes whose CONTENT changed since they were
-- last indexed (services/index_sweep.py). Content, not time: indexing writes
-- the note's descriptor, which fires the updated_at trigger — a time-based
-- check would re-index the same note forever.
--
-- Run in the Supabase SQL editor. Safe to run twice.

-- A fingerprint of what search indexes: the title and the plain text.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS content_hash text
  GENERATED ALWAYS AS (
    md5(coalesce(title, '') || chr(31) || coalesce(content_text, ''))
  ) STORED;

-- The fingerprint as it was when the note was last indexed.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS indexed_hash text;

-- Notes waiting to be indexed: text, not deleted, changed since the last
-- index, and quiet for `quiet_seconds` (so a note being typed is indexed
-- once when the typing stops, not on every autosave).
CREATE OR REPLACE FUNCTION notes_needing_index(
  quiet_seconds int DEFAULT 120,
  max_rows      int DEFAULT 20
)
RETURNS TABLE (id uuid, user_id uuid, content_hash text, local_only boolean)
LANGUAGE sql STABLE
AS $$
  SELECT n.id, n.user_id, n.content_hash, n.local_only
  FROM notes n
  WHERE n.deleted_at IS NULL
    AND coalesce(n.content_text, '') <> ''
    AND n.content_hash IS DISTINCT FROM n.indexed_hash
    AND n.updated_at < now() - make_interval(secs => quiet_seconds)
  ORDER BY n.updated_at DESC
  LIMIT max_rows;
$$;

-- It lists every user's notes: the backend (service role) only.
REVOKE ALL ON FUNCTION notes_needing_index(int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION notes_needing_index(int, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION notes_needing_index(int, int) TO service_role;

-- Check: two columns and the function.
SELECT 'column: ' || column_name AS applied
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'notes'
  AND column_name IN ('content_hash', 'indexed_hash')
UNION ALL
SELECT 'rpc: ' || p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'notes_needing_index';
