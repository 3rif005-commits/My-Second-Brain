import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { databaseRowsEnabled } from "@/lib/database/notesExclusion";

// Everything in the Trash: notes, database rows and whole databases.
// Database rows used to be missing — this read the notes view that hides rows
// (notesTableName()) — and trashed databases had no entry at all, so neither
// could be restored from the app.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: notes, error } = await supabase
    .from("notes")
    .select("id, title, deleted_at")
    .eq("user_id", user.id)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Item = { id: string; title: string; deleted_at: string; kind: "note" | "row" | "database"; database?: string };
  let items: Item[] = (notes ?? []).map((n) => ({ ...(n as Omit<Item, "kind">), kind: "note" as const }));
  if (!databaseRowsEnabled()) return NextResponse.json(items);

  // Which of them are rows, and of which database. Failures here only lose the
  // label, never the item.
  if (items.length) {
    const { data: rows } = await supabase
      .from("db_row_props")
      .select("note_id, db_data_sources(db_databases(title))")
      .in("note_id", items.map((i) => i.id));
    const dbOf = new Map<string, string>();
    for (const r of (rows ?? []) as unknown as {
      note_id: string; db_data_sources: { db_databases: { title: string } | null } | null;
    }[]) {
      dbOf.set(r.note_id, r.db_data_sources?.db_databases?.title ?? "");
    }
    items = items.map((i) => (dbOf.has(i.id) ? { ...i, kind: "row" as const, database: dbOf.get(i.id) || "Untitled" } : i));
  }

  const { data: dbs } = await supabase
    .from("db_databases")
    .select("id, title, deleted_at")
    .eq("user_id", user.id)
    .not("deleted_at", "is", null);
  items = [...items, ...((dbs ?? []) as Omit<Item, "kind">[]).map((d) => ({ ...d, kind: "database" as const }))]
    .sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));

  return NextResponse.json(items);
}
