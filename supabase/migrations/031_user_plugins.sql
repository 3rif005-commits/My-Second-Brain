-- 031 — installed plugins, per user
-- Plan: docs/REPO_CONSOLIDATION_PLAN.md (Part 1)
--
-- A plugin is a manifest.json + main.js fetched once at install time (by
-- /api/plugins, server side) and stored here, so an installed plugin keeps
-- working when its host is down and only changes when the user updates it.
-- The browser loads `code` as an ES module and calls its onload(api).
--
-- Run in the Supabase SQL editor. Safe to run twice.

CREATE TABLE IF NOT EXISTS user_plugins (
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plugin_id    text        NOT NULL,
  manifest     jsonb       NOT NULL,
  -- What the user installed from: "owner/repo" (GitHub releases) or an https
  -- folder URL holding manifest.json + main.js. Updates re-fetch from here.
  source       text        NOT NULL,
  code         text        NOT NULL,
  enabled      boolean     NOT NULL DEFAULT TRUE,
  installed_at timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, plugin_id)
);

ALTER TABLE user_plugins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_plugins_own ON user_plugins;
CREATE POLICY user_plugins_own ON user_plugins
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
