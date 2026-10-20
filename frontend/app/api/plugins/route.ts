import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchPlugin } from "@/lib/plugins/fetchPlugin";
import { incompatibility, parseSource, sourceKey } from "@/lib/plugins/manifest";

// Downloads run here, server side (see lib/plugins/fetchPlugin.ts).
export const runtime = "nodejs";

// GET /api/plugins — the user's installed plugins. ?code=enabled adds the code
// of the enabled ones, which is what the runtime loads.
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const withCode = new URL(req.url).searchParams.get("code") === "enabled";
  const cols = "plugin_id, manifest, source, enabled, installed_at, updated_at" + (withCode ? ", code" : "");
  let q = supabase.from("user_plugins").select(cols).eq("user_id", user.id).order("installed_at");
  if (withCode) q = q.eq("enabled", true);
  const { data, error } = await q;
  if (error) {
    // 42P01: migration 031 not applied yet — say so rather than "error".
    const missing = error.code === "42P01" || /user_plugins/.test(error.message);
    return NextResponse.json(
      { error: missing ? "Plugins need database migration 031_user_plugins.sql" : error.message },
      { status: missing ? 503 : 500 },
    );
  }
  return NextResponse.json({ plugins: data ?? [] });
}

// POST /api/plugins {source} — download, check and install (or reinstall).
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  try {
    const src = parseSource(String(body.source ?? ""));
    const { manifest, code } = await fetchPlugin(src);
    const why = incompatibility(manifest);
    if (why) return NextResponse.json({ error: `${manifest.name} ${why}` }, { status: 422 });

    const { error } = await supabase.from("user_plugins").upsert({
      user_id: user.id,
      plugin_id: manifest.id,
      manifest,
      source: sourceKey(src),
      code,
      enabled: true,
      updated_at: new Date().toISOString(),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ manifest });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Install failed" }, { status: 400 });
  }
}
