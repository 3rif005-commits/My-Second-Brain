// Background jobs (harness 5.3): a skill queued to run later, its result
// waiting until the user puts it in a note. The pure parts live here so the
// wording — the part that must tell the truth about price and time — is tested
// without a browser.

export type JobStatus =
  | "queued" | "submitted" | "ready" | "applied" | "discarded" | "failed"
  | "cancelled" | "expired" | "budget_blocked" | "needs_you" | "skipped";

export type PriceMode = "normal" | "batch" | "local";

/** A job as the list endpoint returns it — never with its result body. */
export interface BgJob {
  id: string;
  note_id: string | null;
  skill: string;
  focus: string;
  status: JobStatus;
  trigger: string;
  price_mode: PriceMode;
  run_after: string;
  shown_estimate_usd: number | null;
  actual_usd: number | null;
  model: string | null;
  ran_late: boolean;
  error: string | null;
  cancel_reason: string | null;
  result_title: string | null;
  created_at: string;
  finished_at: string | null;
}

/** What the queue endpoint needs from the composer. */
export interface QueueRequest {
  noteId: string;
  skill: string;
  focus: string;
  runAfter: Date | null;
}

/** States a person should still see in the panel. Applied and discarded jobs
 *  have done their job and leave it (they stay in the activity log, M2). */
export const OPEN_STATES: JobStatus[] = ["queued", "submitted", "ready", "failed", "budget_blocked", "needs_you"];

/** "≈$0.04", "≈$0.004" — the same rule the run receipts use: under a cent
 *  shows three places, and zero is "free", never "$0.000". */
export function usdText(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return "price unknown";
  if (usd === 0) return "free";
  return `$${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)}`;
}

/** "22:00" in the viewer's own clock. */
export function clockText(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The next 22:00 on the viewer's clock — "tonight", or tomorrow's when it is
 *  already past. The default for Run later: a student drops lectures in the
 *  afternoon and reads the result the next day. */
export function tonight(now: Date = new Date(), hour = 22): Date {
  const t = new Date(now);
  t.setHours(hour, 0, 0, 0);
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
  return t;
}

/** When a queued job will run, in words: "tonight at 22:00", "tomorrow at 22:00". */
export function whenText(at: Date, now: Date = new Date()): string {
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  const that = new Date(at); that.setHours(0, 0, 0, 0);
  const days = Math.round((that.getTime() - day.getTime()) / 86_400_000);
  const rel = days <= 0 ? "tonight" : days === 1 ? "tomorrow" : at.toLocaleDateString(undefined, { weekday: "long" });
  return `${rel} at ${clockText(at)}`;
}

/** The one line shown before the click: price, and when it runs. Unknown is
 *  not free, and a local model says it needs this computer on. */
export function priceLine(mode: PriceMode, usd: number | null, at: Date, now: Date = new Date()): string {
  const when = whenText(at, now);
  if (mode === "local") return `Free · runs on this computer ${when} · needs the app running`;
  if (usd === 0) return `Free · runs ${when}`;
  if (usd === null) return `Price unknown · runs ${when}`;
  return `${mode === "batch" ? "Half price" : "Normal price"} · ≈${usdText(usd)} · runs ${when}`;
}

/** What a job in the panel says about itself. */
export function stateLine(job: BgJob, now: Date = new Date()): string {
  const at = new Date(job.run_after);
  switch (job.status) {
    case "queued":
      return at.getTime() - now.getTime() < 60_000
        ? "Queued · starting in a moment"
        : `Queued · runs ${whenText(at, now)}`;
    case "submitted":
      return "Running now";
    case "failed":
      return `Failed — ${job.error ?? "unknown error"}`;
    case "budget_blocked":
      return `Not started — ${job.error ?? "over the limit"}`;
    case "needs_you":
      return job.error ?? "Waiting for you";
    case "cancelled":
      return `Cancelled${job.cancel_reason ? ` — ${job.cancel_reason}` : ""}`;
    default:
      return job.status;
  }
}

/** "3h ago" style, for "Background · ready 3h ago". */
export function agoText(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)} days ago`;
}

// ── the API ─────────────────────────────────────────────────────────────────

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/ws/jobs${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail?.error ?? body?.error;
    throw new Error(typeof detail === "string" ? detail : `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const queueJob = (r: QueueRequest) =>
  call<BgJob>("", { method: "POST", body: JSON.stringify({
    note_id: r.noteId, skill: r.skill, focus: r.focus,
    run_after: r.runAfter ? r.runAfter.toISOString() : null }) });

export const listJobs = (noteId: string, statuses: JobStatus[] = OPEN_STATES) =>
  call<{ jobs: BgJob[] }>(`?note_id=${encodeURIComponent(noteId)}&status=${statuses.join(",")}`)
    .then((r) => r.jobs);

export const getJob = (id: string) =>
  call<BgJob & { result_html: string | null; source_ids: string[];
    result_meta: Record<string, unknown> }>(`/${id}`);

export const cancelJob = (id: string) => call<BgJob>(`/${id}/cancel`, { method: "POST" });
export const runJobNow = (id: string) => call<BgJob>(`/${id}/run-now`, { method: "POST" });
export const discardJob = (id: string) => call<BgJob>(`/${id}/discard`, { method: "POST" });
export const markJobApplied = (id: string, noteId: string | null) =>
  call<BgJob>(`/${id}/applied`, { method: "POST", body: JSON.stringify({ note_id: noteId }) });

// ── the Activity page ───────────────────────────────────────────────────────

export interface ActivityJob extends BgJob {
  note_title: string | null;
  live_equivalent_usd: number | null;
  result_meta: Record<string, unknown>;
  started_at: string | null;
  applied_at: string | null;
  discarded_at: string | null;
}

export interface Activity {
  /** Waiting on the user or still on its way — whatever its age. */
  open: ActivityJob[];
  history: ActivityJob[];
  month_spent_usd: number;
  monthly_cap_usd: number;
  saved_usd: number;
}

export interface ActivityFilters { skill?: string; trigger?: string; status?: string; days?: number }

export interface JobSettings {
  monthly_cap_usd: number;
  default_monthly_cap_usd: number;
  min_usd: number;
  max_usd: number;
  month_spent_usd: number;
}

export const TRIGGER_WORDS: Record<string, string> = {
  run_later: "Run later", source_added: "New source", schedule: "Schedule",
};
export const triggerText = (t: string) => TRIGGER_WORDS[t] ?? t;

export const STATE_WORDS: Record<JobStatus, string> = {
  queued: "Queued", submitted: "Running", ready: "Ready", applied: "Applied",
  discarded: "Discarded", failed: "Failed", cancelled: "Cancelled", expired: "Expired",
  budget_blocked: "Not started", needs_you: "Needs you", skipped: "Skipped",
};

/** Sections of the page, in the order a person should look at them. */
export const NEEDS_YOU: JobStatus[] = ["needs_you", "budget_blocked", "failed"];
export const IN_PROGRESS: JobStatus[] = ["queued", "submitted"];

/** What was charged, for the History column. A job that never reached the
 *  model cost $0; a local one is free; a run whose price is unknown says so. */
export function costText(job: Pick<BgJob, "status" | "price_mode" | "actual_usd">): string {
  if (job.actual_usd === null) {
    if (["cancelled", "expired", "skipped", "budget_blocked", "queued", "failed"].includes(job.status)) return "$0";
    return job.price_mode === "local" ? "free" : "price unknown";
  }
  return usdText(job.actual_usd);
}

/** The honest cost line for an expanded row. A saving is claimed only when the
 *  job ran at batch price AND both prices are known. */
export function costLine(job: Pick<ActivityJob, "price_mode" | "actual_usd" | "live_equivalent_usd">): string {
  const { price_mode: mode, actual_usd: paid, live_equivalent_usd: live } = job;
  if (paid === null) return mode === "local" ? "Free" : "Price unknown";
  if (paid === 0) return "Free";
  if (mode === "batch" && live !== null && live > paid) {
    return `Paid ${usdText(paid)} · the same job run now would be ${usdText(live)} · saved ${usdText(live - paid)}`;
  }
  return `Paid ${usdText(paid)}`;
}

/** "Sun 22:00" inside a week, "Sep 12" beyond. */
export function whenShort(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 7 && days > -7) {
    return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${clockText(d)}`;
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "This month: $0.43 of $5.00 · saved $0.39" */
export function monthLine(spent: number, cap: number, saved: number): string {
  const base = `This month: ${spent === 0 ? "$0" : usdText(spent)} of ${usdText(cap)}`;
  return saved > 0 ? `${base} · saved ${usdText(saved)}` : base;
}

/** What each timestamp of a job says, in order — the expanded row's timeline. */
export function timeline(job: ActivityJob): { label: string; at: string }[] {
  const steps: [string, string | null][] = [
    ["queued", job.created_at], ["started", job.started_at], ["finished", job.finished_at],
    ["applied", job.applied_at], ["discarded", job.discarded_at]];
  return steps.filter((s): s is [string, string] => !!s[1])
    .map(([label, at]) => ({ label, at: clockText(new Date(at)) + ` (${whenShort(at)})` }));
}

export const EMPTY_ACTIVITY =
  "Nothing has run in the background yet. In any chat, type /study-guide and choose Run later.";

export const getActivity = (f: ActivityFilters = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== "") q.set(k, String(v));
  return call<Activity>(`/activity${q.size ? `?${q}` : ""}`);
};
export const getBadge = () => call<{ ready: number; needs_you: number }>("/badge");
export const getJobSettings = () => call<JobSettings>("/settings");
export const putJobSettings = (monthly_cap_usd: number) =>
  call<{ monthly_cap_usd: number; month_spent_usd: number }>("/settings",
    { method: "PUT", body: JSON.stringify({ monthly_cap_usd }) });
export const deleteJob = (id: string) => call<{ ok: boolean }>(`/${id}`, { method: "DELETE" });
export const getJobDetail = (id: string) => call<{ sources: { id: string; title: string }[] }>(`/${id}/detail`);
