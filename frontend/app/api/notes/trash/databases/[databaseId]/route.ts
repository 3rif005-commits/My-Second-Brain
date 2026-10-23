import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ databaseId: string }> };

// Restore a database from the Trash. Deleting one only stamps deleted_at
// (backend routers/databases.py delete_database), and every read filters on
// it, so clearing it brings back the database with its views and rows.
// There is deliberately no "delete forever" for a database here.
export async function POST(_req: Request, { params }: Params) {
  const { databaseId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("db_databases")
    .update({ deleted_at: null } as never)
    .eq("id", databaseId)
    .eq("user_id", user.id)
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
