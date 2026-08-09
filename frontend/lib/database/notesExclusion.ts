import type { createClient } from "@/lib/supabase/server";

/**
 * Notes-row exclusion sweep (Milestone 1 of the Notion-databases plan).
 *
 * Every notes surface must exclude rows that belong to a database
 * (`db_row_props`) — the SQL equivalent of
 * `NOT EXISTS (SELECT 1 FROM db_row_props p WHERE p.note_id = notes.id)`.
 *
 * Gated behind `DATABASE_ROWS_ENABLED` (mirrors backend
 * `core/config.py: settings.database_rows_enabled`), default off: until
 * migration 014 is applied the `db_row_props` table does not exist, so an
 * unconditional query against it would break every notes surface today.
 * Milestone 2 flips the env var once the migration lands — no call site
 * needs to change.
 *
 * Read per-call (not cached at module load) so it can be exercised in
 * tests without a module-reload dance, and so a process-level env change
 * (unlikely outside tests, but cheap to support) takes effect immediately.
 */
function databaseRowsEnabled(): boolean {
  return process.env.DATABASE_ROWS_ENABLED === "true";
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * ⚠️ PLACEHOLDER IMPLEMENTATION — DOES NOT SCALE. MUST BE REPLACED BEFORE
 * `DATABASE_ROWS_ENABLED` IS FLIPPED ON IN MILESTONE 2.
 *
 * (Milestone 0/1 final code review, finding 5.)
 *
 * This fetches *every* `db_row_props.note_id` for the user and the caller
 * inlines them into a PostgREST `.not("id","in","(...)")` filter. That is
 * an O(all database rows) extra round-trip on **every** notes-list request,
 * and the resulting URL grows by ~37 bytes per row — it stops working long
 * before the plan's own 50,000-row scale envelope (spec §4.3), and is
 * already wasteful past a few hundred rows.
 *
 * The correct fix is a **server-side anti-join** — the
 * `NOT EXISTS (SELECT 1 FROM db_row_props p WHERE p.note_id = notes.id)`
 * this module's header describes — exposed either as a Postgres view that
 * the notes routes select from, or as an RPC. That cannot be built in
 * Milestone 1: `db_row_props` does not exist until Milestone 2's migration
 * `014_databases_core.sql` is applied, so there is nothing to define a view
 * or an anti-join against yet.
 *
 * Until then this code is **inert**: `DATABASE_ROWS_ENABLED` is off by
 * default, so the query below never runs. Milestone 2 must replace this
 * function (not just flip the flag) as part of landing migration 014.
 *
 * Returns the note ids to exclude from a notes query for `userId`, or
 * `null` when there is nothing to exclude — either because the sweep is
 * inert (flag off, the default) or because the user has no database rows
 * yet. `null` (not `[]`) is the "don't filter" signal `applyNotesExclusion`
 * relies on, since `.not("id", "in", "()")` is invalid SQL.
 *
 * When the flag is off, `supabase` is never queried — the sweep is a true
 * no-op, not just an empty filter.
 */
export async function excludedDatabaseRowIds(
  supabase: SupabaseClient,
  userId: string
): Promise<string[] | null> {
  if (!databaseRowsEnabled()) return null;

  const { data, error } = await supabase
    .from("db_row_props")
    .select("note_id")
    .eq("user_id", userId);

  if (error) {
    // Fail open (don't break every notes surface over a database-rows
    // query engine problem) but don't fail silently — this is the only
    // place a Milestone-2 misconfiguration (flag on, migration not yet
    // applied) would otherwise be invisible.
    console.error("excludedDatabaseRowIds: db_row_props query failed", error);
    return null;
  }

  const ids = (data ?? []).map((row: { note_id: string }) => row.note_id);
  return ids.length > 0 ? ids : null;
}

/** Minimal shape every Supabase/PostgREST query builder satisfies, for the
 * one operator `applyNotesExclusion` needs. */
interface Excludable<Self> {
  not(column: string, operator: string, value: string): Self;
}

/**
 * Applies the exclusion from `excludedDatabaseRowIds` to `query`, or
 * returns `query` unchanged when there's nothing to exclude. The single
 * chokepoint for the sharp edge this module exists to fix: PostgREST's
 * `.not("id", "in", "()")` (an empty list) is invalid SQL, so an empty/null
 * exclusion must short-circuit to no filter at all, not an empty one.
 */
export function applyNotesExclusion<Q extends Excludable<Q>>(
  query: Q,
  excludedIds: string[] | null
): Q {
  if (!excludedIds || excludedIds.length === 0) return query;
  return query.not("id", "in", `(${excludedIds.join(",")})`);
}
