-- 030 — Send to Notion (push-only mirror): connections, identity map, runs
-- Design: docs/notion-sync/DESIGN.md §5 · ADRs: docs/notion-sync/ROBUSTNESS.md §10
--
-- Run in the Supabase SQL editor. Safe to run twice. Doesn't reference
-- `vector`, so no search_path change is needed. The proof SELECT at the end
-- must list all six tables. If it doesn't, the transaction rolled back.
--
-- Security notes:
--   * notion_connections holds the encrypted Notion token. It gets RLS but NO
--     policy for `authenticated`, so the browser cannot read it through
--     PostgREST at all; only the backend (service role) can. The token is
--     Fernet-encrypted with SECRETS_KEY from backend/.env (services/secrets.py)
--     and is never stored in plain text.
--   * Every other table carries user_id and the usual owner-only policy, as
--     defence in depth (the backend enforces tenancy itself).
--
-- Never-destructive rule: nothing in this schema cascades into Notion. These
-- rows describe the mirror; deleting them forgets mappings, it never deletes
-- Notion pages.

BEGIN;

-- ---- notion_connections ----------------------------------------------------
CREATE TABLE IF NOT EXISTS notion_connections (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  workspace_id          text,
  workspace_name        text,
  workspace_icon        text,
  bot_user_id           text,                     -- our bot: edits by anyone else = "edited in Notion"
  owner_notion_user_id  text,                     -- people / created_by map to this user
  token_ciphertext      text        NOT NULL,     -- Fernet token (urlsafe base64), never plaintext
  token_key_id          text        NOT NULL,     -- fingerprint of the key that sealed it
  token_hint            text        NOT NULL DEFAULT '…',  -- last 4 chars, for the UI
  root_page_id          text,                     -- the ONE page shared with the connection
  archive_page_id       text,                     -- "🗄 Deleted in Second Brain" (never in_trash)
  api_version           text        NOT NULL DEFAULT '2026-03-11',
  mapper_set_version    text,
  status                text        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','paused','revoked','error')),  -- paused = kill switch
  privacy_ceiling       text        NOT NULL DEFAULT 'personal'
                        CHECK (privacy_ceiling IN ('open','personal')),
  include               jsonb       NOT NULL DEFAULT
                        '{"collections":true,"notes":true,"databases":true,"embedded_files":true,"source_files":false,"threads":false,"skills":false}',
  last_ok_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
-- One active mirror per user (a second workspace is out of scope, DESIGN §10).
CREATE UNIQUE INDEX IF NOT EXISTS notion_connections_one_per_user
  ON notion_connections(user_id) WHERE status <> 'revoked';

ALTER TABLE notion_connections ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policy for `authenticated`: service role only.

-- ---- notion_mappings: the identity map -------------------------------------
CREATE TABLE IF NOT EXISTS notion_mappings (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  connection_id            uuid        NOT NULL REFERENCES notion_connections(id) ON DELETE CASCADE,
  -- what it is here: ('note', <uuid>, ''), ('collection', <uuid>, ''),
  -- ('database', <uuid>, ''), ('data_source', <uuid>, ''),
  -- ('property', <data_source uuid>, <key>), ('view', <uuid>, ''),
  -- ('container', <collection uuid or 'root'>, 'notes_db') …
  local_kind               text        NOT NULL,
  local_id                 text        NOT NULL,
  local_sub                text        NOT NULL DEFAULT '',
  notion_kind              text,       -- page | database | data_source | property | view | block
  notion_id                text,       -- NULL while state = 'creating'
  notion_parent_id         text,
  state                    text        NOT NULL DEFAULT 'creating'
                           CHECK (state IN ('creating','synced','failed','archived','detached','orphaned')),
  create_token             uuid,       -- set before the create call; reconcile uses it
  create_started_at        timestamptz,
  local_hash               text,       -- sha256(canonical IR ‖ mapper_set_version ‖ config) last pushed
  mapper_set_version       text,
  ir_version               int,
  notion_last_edited_time  timestamptz,  -- as read right after our last write
  notion_last_edited_by    text,
  last_pushed_at           timestamptz,
  paused                   boolean     NOT NULL DEFAULT false,   -- per-item pause
  block_index              jsonb       NOT NULL DEFAULT '{}',    -- our block id -> {notion_id, hash, parent, pos}
  losses                   jsonb       NOT NULL DEFAULT '[]',
  error_class              text        CHECK (error_class IN ('retryable','permanent','needs_user')),
  error_code               text,
  error_message            text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notion_mappings_local_uniq UNIQUE (connection_id, local_kind, local_id, local_sub)
);
CREATE INDEX IF NOT EXISTS notion_mappings_notion_idx ON notion_mappings(connection_id, notion_id);
CREATE INDEX IF NOT EXISTS notion_mappings_state_idx  ON notion_mappings(connection_id, state);
CREATE INDEX IF NOT EXISTS notion_mappings_user_idx   ON notion_mappings(user_id);

-- ---- notion_runs: one send / auto-sync / retry / canary ---------------------
CREATE TABLE IF NOT EXISTS notion_runs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  connection_id  uuid        NOT NULL REFERENCES notion_connections(id) ON DELETE CASCADE,
  trigger        text        NOT NULL DEFAULT 'manual'
                 CHECK (trigger IN ('manual','auto','retry','canary')),
  scope          jsonb       NOT NULL DEFAULT '{}',
  status         text        NOT NULL DEFAULT 'planned'
                 CHECK (status IN ('planned','queued','running','paused','succeeded','partial','failed','cancelled')),
  plan           jsonb       NOT NULL DEFAULT '{}',   -- the dry-run summary you confirmed
  released       jsonb       NOT NULL DEFAULT '[]',   -- private note ids you let through for THIS run only
  counts         jsonb       NOT NULL DEFAULT '{}',
  requests_used  int         NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz
);
CREATE INDEX IF NOT EXISTS notion_runs_conn_idx ON notion_runs(connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notion_runs_user_idx ON notion_runs(user_id);

-- ---- notion_run_items: the work queue ---------------------------------------
CREATE TABLE IF NOT EXISTS notion_run_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  run_id       uuid        NOT NULL REFERENCES notion_runs(id) ON DELETE CASCADE,
  mapping_id   uuid        REFERENCES notion_mappings(id) ON DELETE SET NULL,
  local_kind   text        NOT NULL,
  local_id     text        NOT NULL,
  local_sub    text        NOT NULL DEFAULT '',
  phase        int         NOT NULL DEFAULT 0,
  action       text        NOT NULL
               CHECK (action IN ('create','update','move','archive','restore','noop','copy')),
  depends_on   uuid[]      NOT NULL DEFAULT '{}',
  status       text        NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','running','done','failed','needs_you','skipped','blocked')),
  cursor       jsonb       NOT NULL DEFAULT '{}',    -- resume point, e.g. {"phase":"blocks","done":[…]}
  attempts     int         NOT NULL DEFAULT 0,
  run_after    timestamptz NOT NULL DEFAULT now(),
  error_class  text        CHECK (error_class IN ('retryable','permanent','needs_user')),
  error_code   text,
  message      text,       -- plain words for you; never note content
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notion_run_items_queue_idx ON notion_run_items(run_id, status, phase, run_after);
CREATE INDEX IF NOT EXISTS notion_run_items_mapping_idx ON notion_run_items(mapping_id);
CREATE INDEX IF NOT EXISTS notion_run_items_user_idx ON notion_run_items(user_id);

-- ---- notion_file_uploads: upload once, attach many --------------------------
CREATE TABLE IF NOT EXISTS notion_file_uploads (
  connection_id     uuid        NOT NULL REFERENCES notion_connections(id) ON DELETE CASCADE,
  sha256            text        NOT NULL,
  user_id           uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  notion_upload_id  text        NOT NULL,
  size              bigint      NOT NULL,
  mime              text,
  status            text        NOT NULL DEFAULT 'uploaded'
                    CHECK (status IN ('pending','uploaded','attached','expired')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  attached_at       timestamptz,          -- once attached, the upload never expires (Notion)
  PRIMARY KEY (connection_id, sha256)
);
CREATE INDEX IF NOT EXISTS notion_file_uploads_user_idx ON notion_file_uploads(user_id);

-- ---- notion_rules: auto-sync --------------------------------------------------
CREATE TABLE IF NOT EXISTS notion_rules (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  connection_id  uuid        NOT NULL REFERENCES notion_connections(id) ON DELETE CASCADE,
  scope_kind     text        NOT NULL CHECK (scope_kind IN ('note','collection','database','all')),
  scope_id       uuid,       -- NULL only for 'all'
  mode           text        NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual','on_change','daily')),
  include        jsonb       NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope_kind = 'all') = (scope_id IS NULL))
);
CREATE INDEX IF NOT EXISTS notion_rules_conn_idx ON notion_rules(connection_id);
CREATE INDEX IF NOT EXISTS notion_rules_user_idx ON notion_rules(user_id);

-- ---- owner-only RLS on everything except notion_connections ------------------
-- Written out per table (not in a loop) so the SQL editor's RLS check can see it.
ALTER TABLE notion_mappings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY notion_mappings_owner_all ON notion_mappings FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE notion_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY notion_runs_owner_all ON notion_runs FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE notion_run_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY notion_run_items_owner_all ON notion_run_items FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE notion_file_uploads ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY notion_file_uploads_owner_all ON notion_file_uploads FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE notion_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY notion_rules_owner_all ON notion_rules FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


COMMIT;

-- ---- proof it applied: six rows, and notion_connections with 0 policies ----
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_on,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relname IN ('notion_connections','notion_mappings','notion_runs',
                    'notion_run_items','notion_file_uploads','notion_rules')
  AND c.relkind = 'r'
ORDER BY 1;
