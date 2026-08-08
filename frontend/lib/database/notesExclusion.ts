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
 */
const DATABASE_ROWS_ENABLED = process.env.DATABASE_ROWS_ENABLED === "true";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Returns the note ids to exclude from a notes query for `userId`, or
 * `null` when the sweep is inert (flag off) — callers should skip
 * filtering entirely in that case rather than apply an empty exclusion.
 */
export async function excludedDatabaseRowIds(
  supabase: SupabaseClient,
  userId: string
): Promise<string[] | null> {
  if (!DATABASE_ROWS_ENABLED) return null;

  const { data } = await supabase
    .from("db_row_props")
    .select("note_id")
    .eq("user_id", userId);

  return (data ?? []).map((row: { note_id: string }) => row.note_id);
}
