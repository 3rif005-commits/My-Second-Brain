// Everything under a skill — /original, /files/<path>, and whatever the
// skills editor grows next — forwarded to the backend as is, so a new
// endpoint there needs no new route file here.
import { createClient } from "@/lib/supabase/server";

const BACKEND = process.env.FASTAPI_URL ?? "http://localhost:8000";

type Ctx = { params: Promise<{ name: string; rest: string[] }> };

async function forward(req: Request, { params }: Ctx, method: "GET" | "PUT" | "POST") {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const { name, rest } = await params;
  const path = [name, ...rest].map(encodeURIComponent).join("/");
  const res = await fetch(`${BACKEND}/skills/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
    },
    body: method !== "GET" ? await req.text() : undefined,
  });
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
}

export const GET = (req: Request, ctx: Ctx) => forward(req, ctx, "GET");
export const PUT = (req: Request, ctx: Ctx) => forward(req, ctx, "PUT");
export const POST = (req: Request, ctx: Ctx) => forward(req, ctx, "POST");
