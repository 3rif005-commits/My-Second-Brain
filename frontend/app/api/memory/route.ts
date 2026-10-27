import { createClient } from "@/lib/supabase/server";

const BACKEND = process.env.FASTAPI_URL ?? "http://localhost:8000";

// Settings → About you: the facts and preferences every chat sees (backend: services/memory.py).
async function getToken() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function unreachable(e: unknown) {
  return new Response(JSON.stringify({ detail: `Failed to reach backend: ${e instanceof Error ? e.message : String(e)}` }),
    { status: 503, headers: { "Content-Type": "application/json" } });
}

export async function GET() {
  const token = await getToken();
  if (!token) return new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 });
  try {
    const res = await fetch(`${BACKEND}/memory`, { headers: { Authorization: `Bearer ${token}` } });
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return unreachable(e);
  }
}

export async function POST(req: Request) {
  const token = await getToken();
  if (!token) return new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 });
  try {
    const res = await fetch(`${BACKEND}/memory`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: await req.text(),
    });
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return unreachable(e);
  }
}
