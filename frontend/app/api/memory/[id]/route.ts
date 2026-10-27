import { createClient } from "@/lib/supabase/server";

const BACKEND = process.env.FASTAPI_URL ?? "http://localhost:8000";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 });
  const { id } = await params;
  try {
    const res = await fetch(`${BACKEND}/memory/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    return new Response(res.status === 204 ? null : res.body, { status: res.status });
  } catch (e) {
    return new Response(JSON.stringify({ detail: `Failed to reach backend: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 503, headers: { "Content-Type": "application/json" } });
  }
}
