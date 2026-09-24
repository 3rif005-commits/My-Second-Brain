"use client";

// Files and skills in the AI side panel (user decision, 2026-09-24): attach
// files, type `/study-guide …`, and the result comes back as a card — no need
// to open the workspace first. The files become a note's sources, the same
// way the workspace attaches them, so the note can be opened in the workspace
// later from its "Open in workspace" button.
//
// Where the files go (decided):
//  - on an EMPTY note page → that note;
//  - anywhere else (a note with content, home, search…) → a new note, named
//    after the first file, so existing work is never touched.
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { wsApi } from "@/lib/workspace";
import type { ChatJob } from "@/lib/chatJobs";

/** The note a panel thread's files live in. */
export interface PanelScope {
  noteId: string;
  title: string;
}

export interface UploadFile {
  name: string;
  sourceId?: string;
  status: "uploading" | "processing" | "ready" | "failed";
  error?: string;
}

const NOTE_PAGE = /^\/brain\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** The note open in the page behind the panel, if any. */
export function pageNoteIdOf(pathname: string | null): string | null {
  return NOTE_PAGE.exec(pathname ?? "")?.[1] ?? null;
}

/** "Lect10-IML26.pdf" → "Lect10-IML26": what the new note is called. */
export function fileTitle(name: string): string {
  return name.replace(/\.[^.]+$/, "") || name;
}

export function usePanelContext() {
  const pathname = usePathname();
  const pageNoteId = useMemo(() => pageNoteIdOf(pathname), [pathname]);
  const [pageSources, setPageSources] = useState(0);
  const [jobs, setJobs] = useState<ChatJob[]>([]);

  // A note page with ready sources can run a job without attaching anything.
  useEffect(() => {
    setPageSources(0);
    if (!pageNoteId) return;
    let cancelled = false;
    wsApi.listSources(pageNoteId)
      .then((rows) => { if (!cancelled) setPageSources(rows.filter((r) => r.status === "ready").length); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pageNoteId]);

  // The jobs a panel can run: every skill that runs "in the AI panel". Not
  // priced here — before a file is attached there is nothing to price.
  useEffect(() => { void loadJobs().then((j) => j && setJobs(j)); }, []);

  /** The jobs, fetched now if the first load failed — a `/command` must not
   *  turn into a plain question because one request did. */
  const ensureJobs = async (): Promise<ChatJob[]> => {
    if (jobs.length) return jobs;
    const j = await loadJobs();
    if (j) setJobs(j);
    return j ?? [];
  };

  return { pageNoteId, pageSources, setPageSources, jobs, ensureJobs };
}

async function loadJobs(): Promise<ChatJob[] | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch("/api/skills");
      if (r.ok) {
        const d = await r.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (d.skills ?? []).filter((s: any) => s.where === "chat").map((s: any) => ({
          skill: s.name, title: s.title, description: s.description,
          usd: null, input_tokens: 0, output_tokens: 0, runnable: null,
        }));
      }
      console.warn(`[ai-panel] skills list: HTTP ${r.status}`);
    } catch (e) {
      console.warn("[ai-panel] skills list failed", e);
    }
    await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
  }
  return null;
}

/** The open note's title, and whether it is empty (no text at all). An
 *  unreadable note counts as NOT empty — the safe answer, since "empty" lets
 *  files and a draft land in it. */
export async function readNote(noteId: string): Promise<{ empty: boolean; title: string }> {
  try {
    const r = await fetch(`/api/notes/${noteId}`);
    if (!r.ok) return { empty: false, title: "this note" };
    const n = await r.json();
    return { empty: !String(n.content_text ?? "").trim(), title: n.title || "Untitled" };
  } catch { return { empty: false, title: "this note" }; }
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("aborted", "AbortError")); });
});

/** Upload the files into `target` (null → a new note), then wait until each
 *  one is processed. Reports progress through `onChange` after every step. */
export async function attachAndProcess(
  files: File[], target: string | null,
  onChange: (noteId: string | null, files: UploadFile[]) => void,
  signal?: AbortSignal,
): Promise<{ noteId: string; files: UploadFile[] }> {
  let noteId = target;
  const state: UploadFile[] = files.map((f) => ({ name: f.name, status: "uploading" }));
  const emit = () => onChange(noteId, state.map((s) => ({ ...s })));
  emit();

  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    try {
      const r = await wsApi.addSource({ file: files[i], noteId });
      noteId = r.note_id;
      state[i].sourceId = r.source.id;
      state[i].status = r.source.status === "ready" ? "ready"
        : r.source.status === "failed" ? "failed" : "processing";
      if (r.source.status === "failed") state[i].error = r.source.error ?? undefined;
    } catch (e) {
      state[i].status = "failed";
      state[i].error = e instanceof Error ? e.message : "upload failed";
    }
    emit();
  }
  if (!noteId) throw new Error(state[0]?.error ?? "The files could not be uploaded");
  window.dispatchEvent(new Event("notes-changed"));

  // A long lecture PDF takes minutes on this machine; stop waiting at 15.
  const deadline = Date.now() + 15 * 60_000;
  while (state.some((s) => s.status === "processing") && Date.now() < deadline) {
    await sleep(2500, signal);
    const rows = await wsApi.listSources(noteId).catch(() => null);
    if (!rows) continue;
    for (const s of state) {
      const row = rows.find((r) => r.id === s.sourceId);
      if (!row || s.status !== "processing") continue;
      if (row.status === "ready") s.status = "ready";
      else if (row.status === "failed") { s.status = "failed"; s.error = row.error ?? undefined; }
    }
    emit();
  }
  for (const s of state) {
    if (s.status === "processing") { s.status = "failed"; s.error = "still processing after 15 minutes"; }
  }
  emit();
  return { noteId, files: state };
}
