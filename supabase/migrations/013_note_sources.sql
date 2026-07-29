-- Migration 013: note sources (Workspaces compact redesign)
--
-- Replaces the 012 canvas data model with "one note, many sources":
--   workspaces / workspace_pages / workspace_resources  →  note_resources
--   workspace_resources.summary_html                    →  note_synthesis.html
--
-- DESTRUCTIVE. Notes themselves are never touched — notes created by the old
-- per-resource summary flow survive as ordinary notes.
--
-- ai_providers and the private 'workspace-resources' storage bucket are KEPT.
-- Bucket objects under user_id/resource_id/... are orphaned by the drops below;
-- deleting them is manual housekeeping, not a migration step (the bucket is
-- private and the paths are user-scoped, so orphans are harmless).
--
-- Run manually in the Supabase SQL editor (project esfhsdukyhyrlgzflsad) —
-- DATABASE_URL is a placeholder on the dev machine.

BEGIN;

-- ---- drop the canvas model ----

DROP FUNCTION IF EXISTS match_workspace_chunks(vector, uuid, uuid, int);
DROP TABLE IF EXISTS note_anchors       CASCADE;
DROP TABLE IF EXISTS resource_chunks    CASCADE;
DROP TABLE IF EXISTS resource_elements  CASCADE;
DROP TABLE IF EXISTS workspace_pages    CASCADE;
DROP TABLE IF EXISTS workspace_resources CASCADE;
DROP TABLE IF EXISTS workspaces         CASCADE;


-- ---- note_resources (sources attached to one note) ----

CREATE TABLE note_resources (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id       UUID        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind          TEXT        NOT NULL CHECK (kind IN ('pdf','document','youtube','video','website')),
  title         TEXT        NOT NULL DEFAULT 'Untitled source',
  source_url    TEXT,
  storage_path  TEXT,
  mime_type     TEXT,
  status        TEXT        NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','processing','ready','failed')),
  error         TEXT,
  meta          JSONB       NOT NULL DEFAULT '{}',
  order_index   INTEGER     NOT NULL DEFAULT 0,   -- position in the source rail
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX note_resources_note_idx ON note_resources(note_id, order_index);
CREATE INDEX note_resources_user_idx ON note_resources(user_id);

ALTER TABLE note_resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY note_resources_owner_all ON note_resources
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- ---- note_synthesis (the AI draft for one note, built from many sources) ----

CREATE TABLE note_synthesis (
  note_id          UUID        PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  html             TEXT,
  status           TEXT        NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','running','ready','failed')),
  error            TEXT,
  source_ids       UUID[]      NOT NULL DEFAULT '{}',  -- what this draft was built from
  title_suggestion TEXT,
  applied_at       TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX note_synthesis_user_idx ON note_synthesis(user_id);

ALTER TABLE note_synthesis ENABLE ROW LEVEL SECURITY;
CREATE POLICY note_synthesis_owner_all ON note_synthesis
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- ---- resource_elements (selectable elements: text, heading, image, table, formula) ----

CREATE TABLE resource_elements (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id   UUID        NOT NULL REFERENCES note_resources(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  page          INTEGER     NOT NULL DEFAULT 0,
  element_type  TEXT        NOT NULL CHECK (element_type IN ('text','heading','image','table','formula')),
  order_index   INTEGER     NOT NULL DEFAULT 0,
  bbox          JSONB,               -- [x0, y0, x1, y1] in PDF points / relative units
  content       TEXT,                -- text / markdown table / latex
  image_path    TEXT                 -- storage path for image/formula crops
);

CREATE INDEX resource_elements_res_idx ON resource_elements(resource_id, page);

ALTER TABLE resource_elements ENABLE ROW LEVEL SECURITY;
CREATE POLICY resource_elements_owner_all ON resource_elements
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- ---- resource_chunks (anchored chunks: grounded chat + synthesis source text) ----

CREATE TABLE resource_chunks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id   UUID        NOT NULL REFERENCES note_resources(id) ON DELETE CASCADE,
  note_id       UUID        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  chunk_index   INTEGER     NOT NULL,
  chunk_text    TEXT        NOT NULL,
  anchor_type   TEXT        NOT NULL CHECK (anchor_type IN ('time','page','section')),
  anchor_start  DOUBLE PRECISION NOT NULL DEFAULT 0,
  anchor_end    DOUBLE PRECISION NOT NULL DEFAULT 0,
  embedding     vector(768),         -- NULL when embedding failed; text still usable
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX resource_chunks_note_idx ON resource_chunks(note_id);
CREATE INDEX resource_chunks_res_idx  ON resource_chunks(resource_id, chunk_index);
CREATE INDEX resource_chunks_embedding_hnsw ON resource_chunks
  USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);

ALTER TABLE resource_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY resource_chunks_owner_all ON resource_chunks
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION match_note_source_chunks(
  query_embedding  vector(768),
  match_user_id    uuid,
  target_note_id   uuid,
  match_count      int DEFAULT 10
)
RETURNS TABLE (
  id            uuid,
  resource_id   uuid,
  chunk_text    text,
  anchor_type   text,
  anchor_start  double precision,
  anchor_end    double precision,
  similarity    double precision
)
LANGUAGE sql STABLE
AS $$
  SELECT rc.id, rc.resource_id, rc.chunk_text,
         rc.anchor_type, rc.anchor_start, rc.anchor_end,
         1 - (rc.embedding <=> query_embedding) AS similarity
  FROM resource_chunks rc
  WHERE rc.note_id  = target_note_id
    AND rc.user_id  = match_user_id
    AND rc.embedding IS NOT NULL
  ORDER BY rc.embedding <=> query_embedding
  LIMIT match_count;
$$;


-- ---- note_anchors (note block ↔ source position sync) ----

CREATE TABLE note_anchors (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id       UUID        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  resource_id   UUID        NOT NULL REFERENCES note_resources(id) ON DELETE CASCADE,
  block_id      TEXT        NOT NULL,
  anchor_type   TEXT        NOT NULL CHECK (anchor_type IN ('time','page','section')),
  anchor_start  DOUBLE PRECISION NOT NULL DEFAULT 0,
  anchor_end    DOUBLE PRECISION NOT NULL DEFAULT 0,
  UNIQUE (note_id, block_id)
);

CREATE INDEX note_anchors_note_idx ON note_anchors(note_id);

ALTER TABLE note_anchors ENABLE ROW LEVEL SECURITY;
CREATE POLICY note_anchors_owner_all ON note_anchors
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

COMMIT;
