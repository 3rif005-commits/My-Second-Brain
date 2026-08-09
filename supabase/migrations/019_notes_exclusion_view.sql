-- Migration 019: notes-listing view that excludes database rows
-- View: notes_excluding_database_rows
--
-- Spec: docs/superpowers/specs/2026-08-08-notion-databases-design.md §3.2, §4.3
-- Plan: docs/plans/2026-08-08-notion-databases.md
--
-- A database row *is* a `notes` row: `db_row_props` (migration 014) is a 1:1
-- companion keyed by note_id. Every notes-listing surface (sidebar, notes
-- list, search, trash) must therefore hide notes that are really database
-- rows — the anti-join
--   NOT EXISTS (SELECT 1 FROM db_row_props p WHERE p.note_id = notes.id)
--
-- This replaces the Milestone 1 placeholder in
-- `frontend/lib/database/notesExclusion.ts`, which fetched *every*
-- `db_row_props.note_id` for the user and inlined them into a PostgREST
-- `.not("id","in",(...))` filter: an extra round trip per request plus a URL
-- that grows ~37 bytes per row, well short of the plan's 50,000-row envelope.
-- That module's own header names a server-side anti-join as the correct fix
-- and records that it could not be built until 014 was applied. It is.
--
-- Wiring the Next.js routes to this view (and flipping DATABASE_ROWS_ENABLED)
-- is deliberately NOT part of this migration — it is a follow-up task gated on
-- this file being applied to production, mirroring how 014 was handled.
--
-- Numbering: 015–018 are reserved in the plan's Migration Gates table for
-- relations / computed / templates+automations / forms. This view depends on
-- nothing those will add, so 019 is safe to write and apply ahead of them.
--
-- `SET LOCAL search_path` is set below even though this file never names
-- `vector`: `SELECT n.*` transitively exposes `notes.descriptor_embedding`
-- (a `vector`), and pinning the path also pins which schema the view lands in.
--
--
-- ⚠️ SECURITY — the single thing to get right here: `security_invoker`.
--
-- A Postgres view is, by default, evaluated with the *view owner's*
-- permissions, and the owner (`postgres` in the Supabase SQL editor) both owns
-- `notes` and is a superuser — so a default view over `notes` **bypasses the
-- notes RLS policy entirely** and would return every user's notes to any
-- authenticated caller. `WITH (security_invoker = true)` (PostgreSQL 15+;
-- Supabase and the local pgvector/pgvector:pg16 harness both support it) makes
-- permission checks and RLS evaluate as the *calling* role instead, so
-- `002_rls_policies.sql`'s `notes: owner select` policy (`auth.uid() =
-- user_id`) is enforced for the view exactly as it is for the table. Verified
-- on the harness with two users under `SET ROLE authenticated` +
-- `request.jwt.claim.sub`: each user sees only their own rows; the same view
-- created without the option leaked both users' notes.
--
-- Note that under `security_invoker` the `db_row_props` subquery is *also*
-- evaluated as the caller, so it too is filtered by that table's RLS
-- (`user_id = (SELECT auth.uid())`, migration 014). That is correct here
-- because a row's `db_row_props.user_id` is always its note's owner — the
-- caller can only ever be anti-joining against companion rows they own. If
-- that invariant were ever violated (a companion row whose user_id is not the
-- note's owner — nothing in the app writes that), the anti-join fails *open*
-- for the note's owner: the row stays visible in their notes list. Verified on
-- the harness. That is a cosmetic duplicate, not a cross-user leak — the notes
-- RLS policy is what bounds visibility, and it is unaffected.
--
-- Views have no RLS of their own: `ALTER VIEW … ENABLE ROW LEVEL SECURITY` is
-- not a Postgres command. Inheriting the base tables' policies via
-- `security_invoker` is the whole mechanism; there is deliberately nothing
-- else here.
--
-- `CREATE OR REPLACE VIEW` is the idempotent form for views — Postgres has no
-- `CREATE VIEW IF NOT EXISTS` — so this file is re-appliable, per the plan's
-- "new migrations must be independently applicable" rule.

BEGIN;

SET LOCAL search_path = public, extensions;

-- ---- notes_excluding_database_rows ----
-- `SELECT n.*` exposes every `notes` column unchanged so the existing routes'
-- column-list `.select(...)` calls keep working verbatim when they are pointed
-- at this view. It intentionally applies no other predicate (no deleted_at, no
-- user_id): callers keep their own filters, and user scoping is RLS's job.
--
-- Caveat for whoever adds a `notes` column later: Postgres expands the `*` at
-- creation time into a fixed column list, so a new `notes` column does NOT
-- appear here until this view is recreated. Any migration that adds a column
-- to `notes` should re-run this `CREATE OR REPLACE VIEW` (appending columns is
-- allowed; dropping or reordering them is not — that needs DROP + CREATE).
--
-- ⚠️ When you do re-run it, the `WITH (security_invoker = true)` clause MUST
-- be repeated. Verified on the harness: `CREATE OR REPLACE VIEW` without the
-- clause silently *clears* the option (reloptions goes from
-- {security_invoker=true} to NULL) and the view starts returning every user's
-- notes. It fails open, with no error. The `security_invoker_on` column in
-- this file's closing proof SELECT exists to catch exactly that — it is a
-- regression check, not decoration; it must read 1.

CREATE OR REPLACE VIEW notes_excluding_database_rows
WITH (security_invoker = true) AS
SELECT n.*
FROM notes n
WHERE NOT EXISTS (
  SELECT 1 FROM db_row_props p WHERE p.note_id = n.id
);

COMMENT ON VIEW notes_excluding_database_rows IS
  'notes minus rows that are database rows (have a db_row_props companion). '
  'security_invoker=true — enforces the caller''s RLS on notes and '
  'db_row_props. Never drop that option: without it this view returns every '
  'user''s notes.';

-- PostgREST reaches this view with the caller's own JWT, i.e. as the
-- `authenticated` role, which must hold SELECT on the view itself *and* — a
-- security_invoker consequence — on `notes` and `db_row_props` underneath.
-- Supabase's default privileges already grant the latter two; this grant is
-- the explicit, replayable version of the one that matters. `anon` is
-- deliberately not granted: signed-out visitors have no business listing notes.
GRANT SELECT ON notes_excluding_database_rows TO authenticated;

COMMIT;


-- ---- proof it applied ----

SELECT 'migration 019 applied' AS status,
       (SELECT count(*) FROM information_schema.views
        WHERE table_schema = 'public'
          AND table_name = 'notes_excluding_database_rows') AS view_created,
       (SELECT count(*) FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'public'
          AND c.relname = 'notes_excluding_database_rows'
          AND c.reloptions @> ARRAY['security_invoker=true']) AS security_invoker_on;
