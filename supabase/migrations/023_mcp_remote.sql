-- 023 — the remote MCP server: apps you connect (claude.ai, ChatGPT…) and
-- their access (5.4)
--
-- Other apps reach your Second Brain through the remote MCP server
-- (backend/mcp_remote/). They log in with the standard OAuth flow: you sign in
-- to Second Brain and click Allow; the app gets a token that acts for you.
--
-- Tokens and codes are stored ONLY as SHA-256 hashes: the database never holds
-- a usable token. Only the backend (service role) reads these tables — no
-- policies are granted to signed-in users.
--
-- Run in the Supabase SQL editor. Safe to run twice.

-- Apps that registered themselves (OAuth dynamic client registration).
CREATE TABLE IF NOT EXISTS mcp_clients (
  client_id    text        PRIMARY KEY,
  info         jsonb       NOT NULL,          -- name, redirect URIs, …
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- A login in progress: the app sent you to Second Brain to click Allow.
CREATE TABLE IF NOT EXISTS mcp_auth_requests (
  id           text        PRIMARY KEY,       -- random, in the Allow page's URL
  client_id    text        NOT NULL REFERENCES mcp_clients(client_id) ON DELETE CASCADE,
  params       jsonb       NOT NULL,          -- redirect URI, PKCE challenge, state, scopes
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One-time codes (after Allow) and tokens (after the code is exchanged).
CREATE TABLE IF NOT EXISTS mcp_grants (
  secret_hash  text        PRIMARY KEY,       -- sha256 of the code or token
  kind         text        NOT NULL CHECK (kind IN ('code', 'access', 'refresh')),
  client_id    text        NOT NULL REFERENCES mcp_clients(client_id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scopes       text[]      NOT NULL DEFAULT '{}',
  params       jsonb       NOT NULL DEFAULT '{}',   -- code: redirect URI + PKCE challenge
  expires_at   timestamptz,
  revoked      boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_grants_user_idx ON mcp_grants (user_id, kind);

ALTER TABLE mcp_clients       ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_auth_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_grants        ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the backend's service role reads or writes.

-- Check
SELECT 'table: ' || table_name AS applied
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('mcp_clients', 'mcp_auth_requests', 'mcp_grants');
