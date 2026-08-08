import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { excludedDatabaseRowIds } from "@/lib/database/notesExclusion";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let query = supabase
    .from("notes")
    .select("id, title, deleted_at")
    .eq("user_id", user.id)
    .not("deleted_at", "is", null);

  const excludedIds = await excludedDatabaseRowIds(supabase, user.id);
  if (excludedIds && excludedIds.length > 0) {
    query = query.not("id", "in", `(${excludedIds.join(",")})`);
  }

  const { data, error } = await query.order("deleted_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
