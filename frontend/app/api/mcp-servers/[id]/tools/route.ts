import { createClient } from "@/lib/supabase/server";

const BACKEND = process.env.FASTAPI_URL ?? "http://localhost:8000";

// Settings → MCP servers: what a server offers right now, or why it offers nothing.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  const { id } = await params;
  try {
    const res = await fetch(`${BACKEND}/mcp-servers/${id}/tools`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: `Failed to reach backend: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 503, headers: { "Content-Type": "application/json" } });
  }
}
