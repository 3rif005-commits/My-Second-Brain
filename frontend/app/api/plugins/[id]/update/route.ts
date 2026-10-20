import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchPlugin } from "@/lib/plugins/fetchPlugin";
import { incompatibility, parseSource } from "@/lib/plugins/manifest";

export const runtime = "nodejs";

// POST /api/plugins/[id]/update — re-download from where it was installed.
// Returns {updated:false} when the source still has the same version.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: row, error: readError } = await supabase
    .from("user_plugins")
    .select("source, manifest")
    .eq("user_id", user.id)
    .eq("plugin_id", id)
    .single();
  if (readError || !row) return NextResponse.json({ error: "Not installed" }, { status: 404 });

  try {
    const { manifest, code } = await fetchPlugin(parseSource(row.source));
    if (manifest.id !== id) {
      return NextResponse.json({ error: `The source now holds "${manifest.id}", not "${id}"` }, { status: 409 });
    }
    if (manifest.version === row.manifest?.version) return NextResponse.json({ updated: false, manifest });
    const why = incompatibility(manifest);
    if (why) return NextResponse.json({ error: `Version ${manifest.version} ${why}` }, { status: 422 });

    const { error } = await supabase
      .from("user_plugins")
      .update({ manifest, code, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("plugin_id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ updated: true, manifest });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Update failed" }, { status: 400 });
  }
}
