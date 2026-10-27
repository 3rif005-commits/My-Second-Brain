// Save a skill the chat drafted — the user's click, with the text the card
// showed (backend: POST /skills/drafts, services/skill_drafts.py).
import { createClient } from "@/lib/supabase/server";

const BACKEND = process.env.FASTAPI_URL ?? "http://localhost:8000";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 });
  try {
    const res = await fetch(`${BACKEND}/skills/drafts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: await req.text(),
    });
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ detail: `Failed to reach backend: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 503, headers: { "Content-Type": "application/json" } });
  }
}
