// Workspace feature — shared types + thin API client over /api/ws proxy.

export type ResourceKind = "pdf" | "document" | "youtube" | "video" | "website";
export type ResourceStatus = "queued" | "processing" | "ready" | "failed";
export type AnchorType = "time" | "page" | "section";

export interface WsResource {
  id: string;
  workspace_id: string;
  kind: ResourceKind;
  title: string;
  source_url: string | null;
  storage_path: string | null;
  status: ResourceStatus;
  error: string | null;
  meta: {
    pages?: number;
    page_sizes?: [number, number][];
    duration?: number;
    thumbnail?: string;
    author?: string;
    has_transcript?: boolean;
    summary_error?: string;
    [k: string]: unknown;
  };
  note_id: string | null;
  has_summary?: boolean;
  summary_html?: string | null;
  thumbnail_url?: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  z_index: number;
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

export interface WsPage {
  id: string;
  workspace_id: string;
  note_id: string;
  note_title: string;
  note_snippet: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  z_index: number;
}

export interface Workspace {
  id: string;
  name: string;
  icon: string;
  viewport: { x: number; y: number; zoom: number };
  resources: WsResource[];
  pages: WsPage[];
  resource_count?: number;
  updated_at?: string;
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

export type SendAction =
  | { type: "text"; text: string }
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
  listWorkspaces: () => fetch("/api/ws/workspaces").then((r) => j<Workspace[]>(r)),
  createWorkspace: (name: string) =>
    fetch("/api/ws/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => j<Workspace>(r)),
  getWorkspace: (id: string) =>
    fetch(`/api/ws/workspaces/${id}`).then((r) => j<Workspace>(r)),
  patchWorkspace: (id: string, patch: Record<string, unknown>) =>
    fetch(`/api/ws/workspaces/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => j(r)),
  deleteWorkspace: (id: string) =>
    fetch(`/api/ws/workspaces/${id}`, { method: "DELETE" }).then((r) => j(r)),

  importUrl: (wsId: string, url: string, pos: { x: number; y: number }) => {
    const fd = new FormData();
    fd.set("url", url);
    fd.set("pos_x", String(pos.x));
    fd.set("pos_y", String(pos.y));
    return fetch(`/api/ws/workspaces/${wsId}/resources`, {
      method: "POST", body: fd,
    }).then((r) => j<WsResource>(r));
  },
  importFile: (wsId: string, file: File, pos: { x: number; y: number }) => {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("pos_x", String(pos.x));
    fd.set("pos_y", String(pos.y));
    return fetch(`/api/ws/workspaces/${wsId}/resources`, {
      method: "POST", body: fd,
    }).then((r) => j<WsResource>(r));
  },
  resourceStatuses: (wsId: string) =>
    fetch(`/api/ws/workspaces/${wsId}/resources`).then((r) =>
      j<Pick<WsResource, "id" | "status" | "error" | "title" | "kind" | "note_id" | "meta">[]>(r)),
  getResource: (rid: string) =>
    fetch(`/api/ws/resources/${rid}`).then((r) => j<WsResource>(r)),
  resourceFileUrl: (rid: string) =>
    fetch(`/api/ws/resources/${rid}/file`).then((r) => j<{ url: string }>(r)),
  patchResource: (rid: string, patch: Record<string, unknown>) =>
    fetch(`/api/ws/resources/${rid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => j(r)),
  deleteResource: (rid: string) =>
    fetch(`/api/ws/resources/${rid}`, { method: "DELETE" }).then((r) => j(r)),
  reprocessResource: (rid: string) =>
    fetch(`/api/ws/resources/${rid}/reprocess`, { method: "POST" }).then((r) => j(r)),
  capture: (rid: string, type: "frame" | "clip" | "audio", start: number, end?: number) =>
    fetch(`/api/ws/resources/${rid}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, start, end }),
    }).then((r) => j<{ path: string; url: string; mime: string }>(r)),
  formulaLatex: (rid: string, elementId: string) =>
    fetch(`/api/ws/resources/${rid}/formula-latex`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ element_id: elementId }),
    }).then((r) => j<{ latex: string }>(r)),

  addPage: (wsId: string, body: { note_id?: string; title?: string; pos_x?: number; pos_y?: number }) =>
    fetch(`/api/ws/workspaces/${wsId}/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<WsPage>(r)),
  patchPage: (pageId: string, patch: Record<string, unknown>) =>
    fetch(`/api/ws/pages/${pageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => j(r)),
  removePage: (pageId: string) =>
    fetch(`/api/ws/pages/${pageId}`, { method: "DELETE" }).then((r) => j(r)),

  getAnchors: (noteId: string) =>
    fetch(`/api/ws/notes/${noteId}/anchors`).then((r) => j<NoteAnchor[]>(r)),
  putAnchors: (noteId: string, anchors: NoteAnchor[]) =>
    fetch(`/api/ws/notes/${noteId}/anchors`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(anchors),
    }).then((r) => j(r)),
};

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
