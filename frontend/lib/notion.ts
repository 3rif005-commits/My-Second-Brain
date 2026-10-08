// Send to Notion: the calls behind Settings → Notion and the review panel.
// The backend (routers/notion_sync.py) owns every rule; this mirrors its shapes.

export interface NotionPage { id: string; title: string; icon: string | null; url: string; top: boolean }
export interface NotionStatus {
  connected: boolean;
  status?: "active" | "paused" | "revoked" | "error";
  workspace_name?: string | null;
  token_hint?: string;
  root?: { id: string; title: string | null; url: string } | null;
}
export interface Loss { level: string; what: string; fallback: string; code: string }
export type PlanState = "new" | "changed" | "unchanged" | "private" | "paused" | "missing";
export interface PlanItem {
  note_id: string; title: string; state: PlanState;
  fidelity: "exact" | "approximated" | "lossy";
  losses: Loss[]; est_requests: number; notion_url: string | null; released: boolean;
}
export interface Plan {
  items: PlanItem[]; counts: Record<PlanState, number>; nothing_to_send: boolean; est_requests: number;
}
export interface ItemResult {
  note_id: string; title: string; status: "done" | "failed" | "needs_you" | "skipped";
  action: string; message: string; notion_url: string | null; losses: Loss[];
}
export interface SendResult {
  status: "succeeded" | "partial" | "failed" | "nothing_to_send";
  items: ItemResult[]; requests: number; plan: Plan;
}
export interface NoteMirror {
  connected: boolean; state: string; notion_url?: string; last_pushed_at?: string; error?: string | null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/ws/notion${path}`, {
    ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body?.detail ?? body?.error;
    const err = new Error(typeof detail === "string" ? detail : detail?.error ?? `Server ${res.status}`);
    (err as Error & { code?: string }).code = typeof detail === "object" ? detail?.error_code : undefined;
    throw err;
  }
  return body as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const notionApi = {
  status: (detail = false) => call<NotionStatus>(`/status${detail ? "?detail=true" : ""}`),
  connect: (token: string) => call<NotionStatus & { pages: NotionPage[] }>("/connect", post({ token })),
  pages: () => call<{ pages: NotionPage[] }>("/pages"),
  setRoot: (page_id: string) =>
    call<NotionStatus & { forgotten_mappings: number }>("/root", post({ page_id })),
  disconnect: () => call<{ connected: false; reminder: string }>("/disconnect", { method: "POST" }),
  plan: (note_ids: string[], released: string[] = []) => call<Plan>("/plan", post({ note_ids, released })),
  send: (note_ids: string[], released: string[] = []) => call<SendResult>("/send", post({ note_ids, released })),
  note: (id: string) => call<NoteMirror>(`/notes/${id}`),
};

export const FIDELITY_LABEL = { exact: "Exact", approximated: "Approximated", lossy: "Lossy" } as const;
