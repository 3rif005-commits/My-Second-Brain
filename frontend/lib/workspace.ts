// Workspace feature — shared types + thin API client over the /api/ws proxy.
// One note, many sources: sources attach directly to a note and one AI
// synthesis comes out. No workspaces, no pages, no canvas positions.

export type ResourceKind = "pdf" | "document" | "youtube" | "video" | "website";
export type ResourceStatus = "queued" | "processing" | "ready" | "failed";
export type AnchorType = "time" | "page" | "section";
export type SynthesisStatus = "none" | "queued" | "running" | "ready" | "failed";

export interface NoteSource {
  id: string;
  note_id: string;
  kind: ResourceKind;
  title: string;
  source_url: string | null;
  storage_path: string | null;
  mime_type?: string | null;
  status: ResourceStatus;
  error: string | null;
  meta: {
    pages?: number;
    page_sizes?: [number, number][];
    duration?: number;
    author?: string;
    has_transcript?: boolean;
    thumbnail_path?: string;
    [k: string]: unknown;
  };
  order_index: number;
  thumbnail_url?: string;
  elements?: WsElement[];
}

export interface WsElement {
  id: string;
  resource_id: string;
  page: number;
  element_type: "text" | "heading" | "image" | "table" | "formula";
  order_index: number;
  bbox: [number, number, number, number] | null;
  content: string | null;
  image_path: string | null;
  image_url?: string;
}

export interface NoteAnchor {
  id?: string;
  note_id?: string;
  block_id: string;
  resource_id: string;
  anchor_type: AnchorType;
  anchor_start: number;
  anchor_end: number;
}

export interface Citation {
  n: number;
  resource_id: string;
  title: string;
  anchor_type: AnchorType;
  anchor_start: number;
  anchor_end: number;
  snippet?: string;
}

/** What the most recent model call on this note actually cost — the estimate
 * shown before the click, answered after it. `usage_reported` is false when
 * the numbers are this app's own estimate rather than the provider's. */
export interface LastRun {
  skill: string | null;
  job: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  estimated_usd: number | null;
  usage_reported: boolean;
  latency_ms: number | null;
  status: string;
  created_at?: string;
}

export interface Synthesis {
  status: SynthesisStatus;
  html?: string | null;
  source_ids: string[];
  title_suggestion?: string | null;
  error?: string | null;
  applied_at?: string | null;
  updated_at?: string | null;
  last_run?: LastRun | null;
}

/** Priced preview of the Generate action. Computed server-side from the stored
 * chunks — asking what a run would cost costs nothing. `usd` is null when the
 * model has no published price (unknown ≠ free). */
export interface SynthesisEstimate {
  on_drop: "suggest" | "auto" | "nothing";
  ready_sources: number;
  source_chars: number;
  truncated: boolean;
  input_tokens: number;
  output_tokens: number;
  provider: string | null;
  model: string | null;
  usd: number | null;
}

/** "compare sources · 8K tokens · $0.021" — what the run that just finished
 * cost, or null when there is nothing to report. */
export function formatLastRun(run: LastRun | null | undefined): string | null {
  if (!run || run.status !== "ok") return null;
  const tokens = run.input_tokens + run.output_tokens;
  const parts: string[] = [];
  if (run.skill) parts.push(run.skill.replace(/-/g, " "));
  if (tokens > 0) {
    parts.push(`${tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : tokens} tokens`);
  }
  if (run.estimated_usd !== null && run.estimated_usd > 0) {
    parts.push(`$${run.estimated_usd < 0.01
      ? run.estimated_usd.toFixed(3) : run.estimated_usd.toFixed(2)}`);
  } else if (run.estimated_usd === 0) {
    parts.push("free");
  }
  // An estimate and a provider's own count are different claims; say which.
  if (!run.usage_reported && tokens > 0) parts.push("estimated");
  return parts.length ? parts.join(" · ") : null;
}

/** Which job a failed run belongs to, so Retry reruns THAT job.
 *
 * The study guide and every skill share one draft row, and Retry used to
 * always restart the study guide — a failed compare-sources run offered a
 * different job at a different price. `lastJob` is what this page started
 * ("study-guide" or a skill name); after a reload it is unknown, and the
 * server's `<skill>: ` error prefix says instead. `skill` null = study guide. */
export function failedJob(
  error: string | null | undefined,
  skills: NoteSkill[],
  lastJob?: string | null,
): { skill: NoteSkill | null; message: string } {
  const text = error ?? "";
  const byPrefix = skills.find((s) => text.startsWith(`${s.skill}: `)) ?? null;
  const skill = lastJob != null
    ? skills.find((s) => s.skill === lastJob) ?? null
    : byPrefix;
  const message = skill && text.startsWith(`${skill.skill}: `)
    ? text.slice(skill.skill.length + 2) : text;
  return { skill, message };
}

/** "0:42", "3:05" — how long a run has been going. Negative or unknown → null. */
export function formatElapsed(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "compare-sources" → "Compare sources". */
export function jobTitle(name: string): string {
  return name.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** One skill the workspace can run over this note's sources, already priced.
 * `runnable` is null when it can run, otherwise the reason it cannot — which
 * is what the UI shows instead of an unexplained disabled button. */
export interface NoteSkill {
  skill: string;
  description: string;
  output: string;
  confirm: boolean;
  ready_sources: number;
  input_tokens: number;
  output_tokens: number;
  model: string | null;
  usd: number | null;
  runnable: string | null;
}

export interface RecentSession {
  note_id: string;
  title: string;
  source_count: number;
  kinds: ResourceKind[];
  updated_at?: string;
}

export type SendAction =
  | { type: "text"; text: string; /** PDF page it came from → quote + page pill */ page?: number }
  | { type: "image"; url: string; caption?: string }
  | { type: "table"; markdown: string }
  | { type: "latex"; latex: string }
  | { type: "checkpoint"; anchorType: AnchorType; value: number; label?: string }
  | { type: "clip"; url: string; label?: string }
  | { type: "audio"; url: string; label?: string };

// ── API helpers ──────────────────────────────────────────────────────────────

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body?.detail?.error || body?.error || msg;
    } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.json();
}

export const wsApi = {
  /** Attach a file or URL. Without noteId the backend creates the note first. */
  addSource: (input: { file?: File; url?: string; noteId?: string | null; defer?: boolean }) => {
    const fd = new FormData();
    if (input.file) fd.set("file", input.file);
    if (input.url) fd.set("url", input.url);
    if (input.noteId) fd.set("note_id", input.noteId);
    if (input.defer) fd.set("defer", "true");
    return fetch("/api/ws/sources", { method: "POST", body: fd })
      .then((r) => j<{ note_id: string; source: NoteSource; deferred: boolean }>(r));
  },
  listSources: (noteId: string) =>
    fetch(`/api/ws/notes/${noteId}/sources`).then((r) => j<NoteSource[]>(r)),
  processSources: (noteId: string) =>
    fetch(`/api/ws/notes/${noteId}/process-sources`, { method: "POST" })
      .then((r) => j<{ ok: boolean; queued: number }>(r)),
  getSource: (sid: string) =>
    fetch(`/api/ws/sources/${sid}`).then((r) => j<NoteSource>(r)),
  sourceFileUrl: (sid: string) =>
    fetch(`/api/ws/sources/${sid}/file`).then((r) => j<{ url: string }>(r)),
  deleteSource: (sid: string) =>
    fetch(`/api/ws/sources/${sid}`, { method: "DELETE" })
      .then((r) => j<{ ok: boolean; note_id: string }>(r)),
  reprocessSource: (sid: string) =>
    fetch(`/api/ws/sources/${sid}/reprocess`, { method: "POST" }).then((r) => j(r)),
  capture: (sid: string, type: "frame" | "clip" | "audio", start: number, end?: number) =>
    fetch(`/api/ws/sources/${sid}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, start, end }),
    }).then((r) => j<{ path: string; url: string; mime: string }>(r)),
  formulaLatex: (sid: string, elementId: string) =>
    fetch(`/api/ws/sources/${sid}/formula-latex`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ element_id: elementId }),
    }).then((r) => j<{ latex: string }>(r)),

  synthesize: (noteId: string, mode: "replace" | "append") =>
    fetch(`/api/ws/notes/${noteId}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    }).then((r) => j<{ ok: boolean; status: string }>(r)),
  getSynthesis: (noteId: string) =>
    fetch(`/api/ws/notes/${noteId}/synthesis`).then((r) => j<Synthesis>(r)),
  listSkills: (noteId: string) =>
    fetch(`/api/ws/notes/${noteId}/skills`)
      .then((r) => j<{ skills: NoteSkill[] }>(r)).then((d) => d.skills),
  runSkill: (noteId: string, skill: string) =>
    fetch(`/api/ws/notes/${noteId}/skills/${encodeURIComponent(skill)}/run`,
          { method: "POST" })
      .then((r) => j<{ ok: boolean; status: string; skill: string }>(r)),
  getSynthesisEstimate: (noteId: string) =>
    fetch(`/api/ws/notes/${noteId}/synthesis/estimate`)
      .then((r) => j<SynthesisEstimate>(r)),
  markSynthesisApplied: (noteId: string) =>
    fetch(`/api/ws/notes/${noteId}/synthesis/applied`, { method: "POST" })
      .then((r) => j(r)),

  getAnchors: (noteId: string) =>
    fetch(`/api/ws/notes/${noteId}/anchors`).then((r) => j<NoteAnchor[]>(r)),
  putAnchors: (noteId: string, anchors: NoteAnchor[]) =>
    fetch(`/api/ws/notes/${noteId}/anchors`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(anchors),
    }).then((r) => j(r)),

  recentSessions: () =>
    fetch("/api/ws/sessions/recent").then((r) => j<RecentSession[]>(r)),
};

// ── bringing files in from outside the workspace ─────────────────────────────

/** What the workspace can ingest. Shared so the workspace's own picker and the
 * Import button on /brain cannot drift into offering different file types. */
export const ACCEPTED_WORKSPACE_FILES = ".pdf,.md,.txt,.docx,.pptx,.xlsx,.mp4,.webm,.mov,.mkv,.m4v";

/** Files picked on another page, waiting for the shell to mount and attach them.
 *
 * A File cannot travel in a URL, so /brain's Import button leaves the picked
 * files here and routes to /brain/workspace, where WorkspaceShell claims them on
 * mount and runs its ordinary addFiles path — same busy state, same error
 * toasts, same redirect into the new session as picking them inside the
 * workspace would give.
 *
 * Module state, so it survives a client-side navigation and nothing else. A full
 * reload loses the staged files and the workspace simply shows its normal empty
 * state, which is the right outcome: the upload had not started yet.
 */
let stagedSources: File[] = [];

export function stageSources(files: File[]): void {
  stagedSources = files;
}

/** Returns the staged files and clears them, so a remount cannot re-upload. */
export function takeStagedSources(): File[] {
  const files = stagedSources;
  stagedSources = [];
  return files;
}

// ── display helpers ──────────────────────────────────────────────────────────

/** Stable per-source accent, keyed off order_index. With 4 sources in play,
 *  "which source is this from?" has to be answerable at a glance, and a colour
 *  dot is cheaper than repeating titles in every chip. */
export const SOURCE_COLORS = [
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ec4899", // pink
  "#8b5cf6", // violet
];

export function sourceColor(orderIndex: number): string {
  const n = SOURCE_COLORS.length;
  return SOURCE_COLORS[(((orderIndex ?? 0) % n) + n) % n];
}

/** Source-indexed anchor: "2:p:14" → { sourceIndex: 2, type: "page", value: 14 } */
export function parseSourceAnchor(
  v: string
): { sourceIndex: number; type: AnchorType; value: number } | null {
  const m = v.match(/^(\d+):([tps]):([\d.]+)$/);
  if (!m) return null;
  const type: AnchorType = m[2] === "t" ? "time" : m[2] === "p" ? "page" : "section";
  return { sourceIndex: parseInt(m[1], 10), type, value: parseFloat(m[3]) };
}

export function youtubeVideoId(url: string): string | null {
  const patterns = [
    /youtube\.com\/watch\?.*v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

export function fmtTime(seconds: number): string {
  const s = Math.floor(seconds);
  if (s >= 3600) {
    return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function anchorLabel(type: AnchorType, value: number): string {
  if (type === "time") return fmtTime(value);
  if (type === "page") return `p. ${Math.round(value)}`;
  return `§${Math.round(value)}`;
}
