-- Migration 018: Notion Databases — public Form-view submission
-- Table: db_form_submissions (rate-limit ledger)
-- Functions:
--   submit_form_response(p_view_id, p_ip_hash, p_properties) — the only
--     write path an unauthenticated caller has into this schema
--   get_form_view(p_view_id) — the only read path an unauthenticated
--     caller has: curated view+question metadata, never row data
-- Policy: db_row_props_anon_form_submit — defense-in-depth restating the
--   write function's own invariant directly on the table
--
-- Spec: docs/superpowers/specs/2026-08-08-notion-databases-design.md §3.2
--   (db_row_props), §10 (db_views, config JSONB), §13 (migration path/gating)
-- Research: docs/research/notion-databases-research.md §12 (Form view,
--   ~line 2802)
-- Plan: docs/plans/2026-08-08-notion-databases.md, M13 — "form public
--   submission is rate-limited and writes only to its own data source;
--   anonymous submission cannot read existing rows". Gate G5:
--   `SELECT policyname FROM pg_policies WHERE tablename='db_row_props';`
--
-- Numbering: 019_notes_exclusion_view.sql already exists (pre-existing,
-- unrelated work from a parallel branch) and its own header comment reserves
-- 018 for this feature — highest *previously* applied migration is 017.
--
-- Map view is explicitly OUT OF SCOPE for the whole milestone (user
-- decision — no geocoding/tile provider configured). Nothing here touches it.
--
-- This migration does not reference `vector`, so the
-- `SET LOCAL search_path = public, extensions;` rule does not apply here.
--
--
-- ---------------------------------------------------------------------------
-- WHY THIS LOOKS DIFFERENT FROM EVERY OTHER MIGRATION IN THIS PLAN
-- ---------------------------------------------------------------------------
-- Every prior Notion-databases migration is reached only through FastAPI's
-- authenticated `get_user_id`/`get_conn` dependencies (asyncpg, service
-- role — RLS does not even apply there, per 014's own header). This app's
-- only *other* unauthenticated write... doesn't exist: the one precedent for
-- unauthenticated *access* at all is the `is_public` note-sharing read path
-- (005_notion_phase.sql's `anon_read_public_notes`, read via the anon key
-- directly from Next.js, bypassing FastAPI entirely). Form submission is the
-- first unauthenticated WRITE this codebase has ever had, and it follows
-- that same anon-key shape, not the FastAPI one — no backend/ code accompanies
-- this migration.
--
-- The owning user_id is resolved entirely server-side, inside this
-- migration's function, by walking p_view_id -> db_views.data_source_id ->
-- db_data_sources.user_id. It is never accepted as a caller-supplied value —
-- an anonymous submitter has no account and must not be trusted to name
-- whose data they are writing into.
--
--
-- ---------------------------------------------------------------------------
-- RATE LIMIT — chosen and documented per the task brief's requirement
-- ---------------------------------------------------------------------------
-- 5 submissions per (view_id, ip_hash) per rolling 1-hour window (checked as
-- "submitted_at > now() - interval '1 hour'", not a fixed clock-hour
-- bucket, so it cannot be gamed by submitting just after a bucket rolls
-- over). Reasoning: a genuine respondent fills a given form once, maybe a
-- handful of times if they made a mistake and reopened the link, or if
-- several people behind the same NAT/shared office IP submit independently
-- (each of *those* people also only submits a few times). 5/hour comfortably
-- covers that legitimate range while still stopping a scripted flood, which
-- would blow past 5 in seconds. The limit is scoped per (view, ip) — not
-- global per view and not global per ip — so one address hammering Form A
-- never blocks a different address, or the same address, from submitting to
-- Form B.
--
-- The IP is never stored raw: the caller (the Next.js route) hashes it with
-- a per-deploy secret salt (Node's `crypto.createHash('sha256')`, salt read
-- from `FORM_IP_SALT`) *before* it ever reaches Postgres, so this table and
-- this function never see, and cannot leak, a real IP address at all.
--
-- Check-then-insert atomicity: the function takes a transaction-scoped
-- advisory lock keyed on (view_id, ip_hash) — `pg_advisory_xact_lock`,
-- released automatically at the end of the single-statement RPC transaction
-- — before it counts recent submissions. Two requests racing in from the
-- same IP at the same instant therefore cannot both observe "count < limit"
-- before either commits: the second request blocks on the lock until the
-- first's INSERT (and its lock release) completes, then re-reads a count
-- that already reflects the first request's row.
--
--
-- ---------------------------------------------------------------------------
-- PROPERTY FILTERING — "silently drop", not "reject the whole submission"
-- ---------------------------------------------------------------------------
-- A submitted property key not present in the view's `config.questions[]`
-- is silently dropped, not treated as a hard failure of the whole
-- submission. Rationale: the public form page only ever renders inputs for
-- `config.questions[]`, so an extra key can only appear from something
-- probing the endpoint directly (not a real respondent hitting a UI bug) —
-- there is nothing gained by failing the request outright when dropping the
-- unrecognised key already fully neutralises the risk (an anonymous caller
-- writing an arbitrary property key onto the row). Tested explicitly below.
--
--
-- ---------------------------------------------------------------------------
-- RLS POLICY vs SECURITY DEFINER FUNCTION
-- ---------------------------------------------------------------------------
-- The write path is a SECURITY DEFINER function (house pattern — see
-- 001_initial_schema.sql's handle_new_user, 003_fix_handle_new_user.sql),
-- so it runs as the function owner and technically bypasses RLS on the
-- tables it touches. `db_row_props_anon_form_submit` below restates the
-- SAME invariant the function enforces (target data source belongs to an
-- OPEN form view, and user_id matches that view's data source owner)
-- directly as a `WITH CHECK` on `db_row_props`, `TO anon`. This is
-- deliberate defense-in-depth, not decoration: if a future change to the
-- function (or to how it is invoked) ever stops going through the
-- SECURITY DEFINER path, this policy is what stands between an anonymous
-- caller and an arbitrary write. It is also the concrete policy gate G5's
-- proof query is written to catch drifting away from being real.
--
-- No new SELECT policy for `anon` is added anywhere in this migration — on
-- `db_row_props`, `notes`, or `db_views`. "Anonymous submission cannot read
-- existing rows" holds by construction (absence of a read grant), not by an
-- app-layer check that could be forgotten elsewhere. The public form PAGE
-- still needs to read a view's config and its questions' property metadata
-- to render inputs at all — `get_form_view` (below) is how: a SECURITY
-- DEFINER function, not a SELECT policy, returning only curated
-- name/config/question-metadata fields and never actual row data. See its
-- own comment for why a blanket policy would have been the wrong shape.

BEGIN;

-- ---- db_form_submissions ----
-- Rate-limit ledger only. Never read by any client, authenticated or not —
-- RLS is enabled with zero policies (default-deny for every role); only the
-- SECURITY DEFINER function below (running as its owner) ever touches it.

CREATE TABLE IF NOT EXISTS db_form_submissions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  view_id      UUID        NOT NULL REFERENCES db_views(id) ON DELETE CASCADE,
  ip_hash      TEXT        NOT NULL,   -- sha256(ip + per-deploy salt), hex — never a raw IP
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Efficient rolling-window count for the rate limit's `WHERE view_id = ...
-- AND ip_hash = ... AND submitted_at > now() - interval '1 hour'` query.
CREATE INDEX IF NOT EXISTS db_form_submissions_window_idx
  ON db_form_submissions (view_id, ip_hash, submitted_at);

ALTER TABLE db_form_submissions ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: default-deny for every role, including
-- `authenticated` — this table has no legitimate direct reader.


-- ---- submit_form_response ----
-- The entire public write path. Atomic: form-open check, rate limit
-- check-then-insert, property filtering + required-field validation, and
-- the notes + db_row_props insert all happen in the single implicit
-- transaction of this function call, so any failure rolls back everything.

CREATE OR REPLACE FUNCTION submit_form_response(
  p_view_id    UUID,
  p_ip_hash    TEXT,
  p_properties JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data_source_id UUID;
  v_user_id        UUID;
  v_config         JSONB;
  v_allowed_keys   TEXT[];
  v_filtered       JSONB := '{}'::jsonb;
  v_key            TEXT;
  v_value          JSONB;
  v_question       JSONB;
  v_required       BOOLEAN;
  v_title          TEXT := 'Untitled';
  v_recent_count   INTEGER;
  v_note_id        UUID;
  v_rate_limit     CONSTANT INTEGER := 5;
  v_window         CONSTANT INTERVAL := INTERVAL '1 hour';
BEGIN
  -- Resolve the view, its data source, and its owning user_id — entirely
  -- server-side, never client-supplied. Reject unless the view exists and
  -- is a form view.
  SELECT dv.data_source_id, ds.user_id, dv.config
    INTO v_data_source_id, v_user_id, v_config
  FROM db_views dv
  JOIN db_data_sources ds ON ds.id = dv.data_source_id
  WHERE dv.id = p_view_id AND dv.type = 'form';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'form_not_found';
  END IF;

  IF COALESCE(v_config ->> 'is_form_closed', 'false') = 'true' THEN
    RAISE EXCEPTION 'form_closed';
  END IF;

  -- Serialize concurrent submissions from the same (view, ip) so the
  -- rate-limit check-then-insert below is atomic — see header comment.
  PERFORM pg_advisory_xact_lock(hashtext(p_view_id::text), hashtext(p_ip_hash));

  SELECT count(*) INTO v_recent_count
  FROM db_form_submissions
  WHERE view_id = p_view_id
    AND ip_hash = p_ip_hash
    AND submitted_at > now() - v_window;

  IF v_recent_count >= v_rate_limit THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  INSERT INTO db_form_submissions (view_id, ip_hash) VALUES (p_view_id, p_ip_hash);

  -- Filter to exactly the property keys the form actually asks for — an
  -- anonymous caller must never be able to write an arbitrary property key
  -- (silently dropped, not a hard failure — see header comment).
  SELECT array_agg(q ->> 'property_key') INTO v_allowed_keys
  FROM jsonb_array_elements(COALESCE(v_config -> 'questions', '[]'::jsonb)) AS q;

  FOR v_key, v_value IN
    SELECT key, value FROM jsonb_each(COALESCE(p_properties, '{}'::jsonb))
  LOOP
    IF v_key = ANY(v_allowed_keys) THEN
      v_filtered := v_filtered || jsonb_build_object(v_key, v_value);
      IF v_value ->> 'type' = 'title' THEN
        v_title := COALESCE(NULLIF(v_value ->> 'title', ''), v_title);
      END IF;
    END IF;
  END LOOP;

  -- Required questions are enforced here authoritatively — the public
  -- page's own client-side required check is UX only, not the real gate.
  FOR v_question IN
    SELECT * FROM jsonb_array_elements(COALESCE(v_config -> 'questions', '[]'::jsonb))
  LOOP
    v_required := COALESCE((v_question ->> 'required')::boolean, false);
    v_key := v_question ->> 'property_key';
    IF v_required AND (
      NOT (v_filtered ? v_key)
      OR v_filtered -> v_key IS NULL
      OR v_filtered -> v_key = 'null'::jsonb
    ) THEN
      RAISE EXCEPTION 'missing_required_property';
    END IF;
  END LOOP;

  INSERT INTO notes (user_id, title, content)
  VALUES (v_user_id, v_title, '[]'::jsonb)
  RETURNING id INTO v_note_id;

  INSERT INTO db_row_props (note_id, data_source_id, user_id, properties, position)
  VALUES (
    v_note_id, v_data_source_id, v_user_id, v_filtered,
    COALESCE((SELECT MAX(position) + 1 FROM db_row_props WHERE data_source_id = v_data_source_id), 0)
  );

  RETURN v_note_id;
END;
$$;

-- The only privilege an anonymous caller gets anywhere in this migration:
-- EXECUTE on this one function. No table-level GRANT to `anon` is added
-- (matching this codebase's own convention — 002_rls_policies.sql and
-- 005_notion_phase.sql add RLS policies with no accompanying GRANT; table
-- privileges for `anon`/`authenticated` are provisioned once at the
-- Supabase-project level, outside any migration file). Even so, a direct
-- anon INSERT into `notes` would still be rejected by "notes: owner insert"
-- (`auth.uid() = user_id`, and `auth.uid()` is NULL for an anon session) —
-- this function's SECURITY DEFINER is the only way an anonymous caller can
-- ever produce a `notes` row.
GRANT EXECUTE ON FUNCTION submit_form_response(UUID, TEXT, JSONB) TO anon;


-- ---- db_row_props_anon_form_submit ----
-- Defense-in-depth restating submit_form_response's own invariant directly
-- as RLS — see header comment for why this matters even though the
-- function itself bypasses RLS.

CREATE POLICY db_row_props_anon_form_submit ON db_row_props
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM db_views dv
      JOIN db_data_sources ds ON ds.id = dv.data_source_id
      WHERE dv.data_source_id = db_row_props.data_source_id
        AND dv.type = 'form'
        AND COALESCE(dv.config ->> 'is_form_closed', 'false') <> 'true'
        AND ds.user_id = db_row_props.user_id
    )
  );


-- ---- get_form_view ----
-- The public form PAGE (Next.js Server Component, anon key, no auth) needs
-- to read a view's config and its questions' property metadata (name/type,
-- to know which input control to render) to render the form at all. A
-- blanket anon SELECT policy on `db_views`/`db_properties` would satisfy
-- that but directly contradicts this migration's own "no new SELECT
-- policy for anon anywhere" requirement (an anon caller could then read
-- every OTHER view/property on the data source too, plus every other
-- view — including non-form ones — on any data source, just by knowing an
-- id). A second SECURITY DEFINER function is not a SELECT policy: it
-- returns exactly the curated fields the public page needs (the view's
-- name, its full config, and — for each `config.questions[]` entry that
-- still resolves to a real property — that property's key/name/type) and
-- nothing else. No row data (`db_row_props`), no other properties on the
-- data source, no data_source_id/user_id. Returns NULL for a missing or
-- non-form view id (the page's own `notFound()`), and still returns data
-- for a CLOSED form (so the page can render the "not accepting responses"
-- state instead of a 404 — closed-ness is itself part of `config`).

CREATE OR REPLACE FUNCTION get_form_view(p_view_id UUID) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data_source_id UUID;
  v_name           TEXT;
  v_config         JSONB;
  v_questions      JSONB;
BEGIN
  SELECT dv.data_source_id, dv.name, dv.config
    INTO v_data_source_id, v_name, v_config
  FROM db_views dv
  WHERE dv.id = p_view_id AND dv.type = 'form';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'property_key', q.value ->> 'property_key',
             'required', COALESCE((q.value ->> 'required')::boolean, false),
             'name', dp.name,
             'type', dp.type
           ) ORDER BY q.ord
         ), '[]'::jsonb)
    INTO v_questions
  FROM jsonb_array_elements(COALESCE(v_config -> 'questions', '[]'::jsonb)) WITH ORDINALITY AS q(value, ord)
  JOIN db_properties dp
    ON dp.data_source_id = v_data_source_id AND dp.key = q.value ->> 'property_key';

  RETURN jsonb_build_object('name', v_name, 'config', v_config, 'questions', v_questions);
END;
$$;

GRANT EXECUTE ON FUNCTION get_form_view(UUID) TO anon;

COMMIT;


-- ---- proof it applied ----
-- Gate G5's own proof query: `SELECT policyname FROM pg_policies WHERE
-- tablename='db_row_props';` — must return at least one row. It already
-- would (014's `db_row_props_owner_all`); the row that makes this migration
-- itself real is `db_row_props_anon_form_submit`, asserted for explicitly
-- below.

SELECT 'migration 018 applied' AS status,
       (SELECT count(*) FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'db_form_submissions') AS table_created,
       (SELECT count(*) FROM pg_proc WHERE proname = 'submit_form_response') AS submit_function_created,
       (SELECT count(*) FROM pg_proc WHERE proname = 'get_form_view') AS read_function_created,
       (SELECT count(*) FROM pg_policies
        WHERE tablename = 'db_row_props'
          AND policyname = 'db_row_props_anon_form_submit') AS anon_policy_present;
