import { createClient } from "@/lib/supabase/server";

const BACKEND = process.env.FASTAPI_URL ?? "http://localhost:8000";

// Settings → MCP servers: approve new or changed tools, exactly as the page showed them.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  const { id } = await params;
  try {
    const res = await fetch(`${BACKEND}/mcp-servers/${encodeURIComponent(id)}/approve-tools`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: await req.text(),
    });
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: `Failed to reach backend: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 503, headers: { "Content-Type": "application/json" } });
  }
}
