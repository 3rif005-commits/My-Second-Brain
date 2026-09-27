// The Allow page's two calls, forwarded to the remote MCP server (5.4) with
// the signed-in user's Supabase token: GET describes who asks, POST answers.
import { createClient } from "@/lib/supabase/server";

const MCP_URL = process.env.MCP_URL ?? "http://localhost:8765";
type Ctx = { params: Promise<{ rid: string }> };

async function forward(req: Request, { params }: Ctx, method: "GET" | "POST") {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return Response.json({ error: "Sign in first" }, { status: 401 });
  }
  const { rid } = await params;
  try {
    const res = await fetch(`${MCP_URL}/consent/${encodeURIComponent(rid)}`, {
      method,
      headers: { Authorization: `Bearer ${session.access_token}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      body: method === "POST" ? await req.text() : undefined,
    });
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return Response.json({ error: "The connection server is not running (./app.sh start)." }, { status: 503 });
  }
}

export const GET = (req: Request, ctx: Ctx) => forward(req, ctx, "GET");
export const POST = (req: Request, ctx: Ctx) => forward(req, ctx, "POST");
