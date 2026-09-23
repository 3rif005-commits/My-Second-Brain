import { createClient } from "@/lib/supabase/server";

const BACKEND = process.env.FASTAPI_URL ?? "http://localhost:8000";

/** The skills the editor's selection menu offers, with the prompt each sends. */
export async function GET() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  const res = await fetch(`${BACKEND}/skills/surface/selection`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
}
