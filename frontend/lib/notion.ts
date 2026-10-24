// Send to Notion: the calls behind Settings → Notion, the review panel and the status dots.
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
export type PlanState = "new" | "changed" | "unchanged" | "private" | "paused" | "missing" | "deleted" | "needs_you";
export type ItemKind = "note" | "collection" | "database" | "thread" | "skill";
export interface DiffLine { op: "same" | "notion" | "ours"; text: string }
export interface Needs {
  reason: "edited_in_notion" | "unreachable";
  edited_at?: string | null; foreign_blocks?: number; diff?: DiffLine[];
}
export type Resolution = "overwrite" | "copy" | "recreate" | "forget";
export interface PlanItem {
  note_id: string; title: string; state: PlanState; kind: ItemKind;
  fidelity: "exact" | "approximated" | "lossy";
  losses: Loss[]; est_requests: number; notion_url: string | null; released: boolean;
  selected: boolean; restore: boolean; moved: boolean; path: string;
  needs: Needs | null; resolution: Resolution | null; mapping_id: string | null;
}
export interface Plan {
  items: PlanItem[]; counts: Record<PlanState, number>; nothing_to_send: boolean; est_requests: number;
}
export interface ItemResult {
  note_id: string; title: string; status: "done" | "failed" | "needs_you" | "skipped";
  action: string; message: string; notion_url: string | null; losses: Loss[]; kind?: ItemKind;
}
export interface SendResult {
  status: "succeeded" | "partial" | "failed" | "paused" | "nothing_to_send" | "queued";
  items: ItemResult[]; requests: number; plan: Plan; run_id?: string;
}
export interface NoteMirror {
  connected: boolean; state: string; notion_url?: string; last_pushed_at?: string; error?: string | null; paused?: boolean;
}

/** What to send. Ids of different kinds can be mixed; `all` is the whole brain per the Settings switches. */
export interface Scope {
  note_ids?: string[]; collection_ids?: string[]; only_collection_ids?: string[]; database_ids?: string[];
  thread_ids?: string[]; skill_names?: string[]; include_linked?: boolean; all?: boolean;
}
export interface SendOptions {
  released?: string[]; archive_ids?: string[]; resolutions?: Record<string, Resolution>; exclude?: string[]; background?: boolean;
}

export type MirrorCode = "synced" | "changed" | "failed" | "needs_you" | "private" | "paused" | "deleted";
export interface MirrorMap { connected: boolean; paused?: boolean; notes: Record<string, MirrorCode>; collections: Record<string, MirrorCode> }

export interface RunSummary {
  id: string; trigger: "manual" | "auto" | "retry" | "canary"; status: string;
  counts: { done?: number; problems?: number; skipped?: number; rate_limit_waits?: number } | null;
  requests_used: number | null; created_at: string; started_at: string | null; finished_at: string | null;
}
export interface RunItem {
  id: string; kind: ItemKind; local_id: string; title: string; action: string;
  status: "queued" | "running" | "done" | "failed" | "needs_you" | "skipped" | "blocked";
  error_class: string | null; message: string | null;
}
export interface RunDetail extends RunSummary { items: RunItem[] }

export interface Rule { id: string; scope_kind: "note" | "collection" | "database" | "all"; scope_id: string | null; mode: "manual" | "on_change" | "daily"; include: Record<string, boolean> }
export interface Include { collections: boolean; notes: boolean; databases: boolean; embedded_files: boolean; source_files: boolean; threads: boolean; skills: boolean }
export interface Health {
  status: string; last_ok_at: string | null; api_version: string; mappings: Record<string, number>; failing: number;
  rate_limit_waits_recent: number; token_problem: boolean;
  canary: { ok: boolean; when: string; api_version: string; failed: string[] } | null;
}
export interface BackupStatus { enabled: boolean; folder: string; hosted?: boolean; archives: { name: string; bytes: number }[] }
export interface BackupResult { path: string; bytes: number; counts: Record<string, number>; problems: unknown[]; pruned: string[] }

async function call<T>(path: string, init?: RequestInit, base = "notion"): Promise<T> {
  const res = await fetch(`/api/ws/${base}${path}`, {
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
  pause: () => call<NotionStatus>("/pause", { method: "POST" }),
  resume: () => call<NotionStatus>("/resume", { method: "POST" }),
  plan: (scope: Scope, o: SendOptions = {}) =>
    call<Plan>("/plan", post({ ...scope, released: o.released ?? [], archive_ids: o.archive_ids ?? [],
      resolutions: o.resolutions ?? {}, exclude: o.exclude ?? [] })),
  send: (scope: Scope, o: SendOptions = {}) =>
    call<SendResult>("/send", post({ ...scope, released: o.released ?? [], archive_ids: o.archive_ids ?? [],
      resolutions: o.resolutions ?? {}, exclude: o.exclude ?? [], background: !!o.background })),
  note: (id: string) => call<NoteMirror>(`/notes/${id}`),
  pauseNote: (id: string, paused: boolean) => call<{ paused: boolean }>(`/notes/${id}/pause`, post({ paused })),
  mirror: () => call<MirrorMap>("/mirror"),
  runs: () => call<{ runs: RunSummary[] }>("/runs"),
  run: (id: string) => call<RunDetail>(`/runs/${id}`),
  retry: (id: string) => call<{ status: string; run_id?: string }>(`/runs/${id}/retry`, { method: "POST" }),
  rules: () => call<{ rules: Rule[] }>("/rules"),
  addRule: (r: { scope_kind: Rule["scope_kind"]; scope_id?: string | null; mode: Rule["mode"] }) =>
    call<Rule>("/rules", post({ include: {}, ...r })),
  deleteRule: (id: string) => call<{ deleted: string }>(`/rules/${id}`, { method: "DELETE" }),
  include: () => call<{ include: Include }>("/include"),
  setInclude: (include: Partial<Include>) => call<{ include: Include }>("/include", { method: "PUT", body: JSON.stringify({ include }) }),
  health: () => call<Health>("/health"),
};

export const backupApi = {
  status: () => call<BackupStatus>("", undefined, "backup"),
  run: () => call<BackupResult>("/run", { method: "POST" }, "backup"),
};

export const FIDELITY_LABEL = { exact: "Exact", approximated: "Approximated", lossy: "Lossy" } as const;

/** Fire after anything that changes what is in Notion, so the dots and chips refresh. */
export const NOTION_CHANGED = "notion:changed";
export function announceNotionChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NOTION_CHANGED));
}

export function scopeOf(kind: ItemKind, id: string): Scope {
  switch (kind) {
    case "note": return { note_ids: [id] };
    case "collection": return { collection_ids: [id] };
    case "database": return { database_ids: [id] };
    case "thread": return { thread_ids: [id] };
    case "skill": return { skill_names: [id] };
  }
}
