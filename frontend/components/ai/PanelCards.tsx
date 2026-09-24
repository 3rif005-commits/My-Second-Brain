"use client";

// The side panel's job and upload cards. A job's result is a preview first
// (user decision: Preview + Insert); like Notion AI's answer bar, the user
// then chooses where it goes, retries it, copies it, or throws it away.
import { useEffect, useState } from "react";
import {
  AlertCircle, Check, CheckCircle2, Copy, Eye, EyeOff, FileText, Layers,
  Loader2, RotateCcw, Sparkles, Undo2, X,
} from "lucide-react";
import { PREVIEW_CSS, resultSummary, type JobResult } from "@/lib/chatJobs";
import type { UploadFile } from "./panelSources";

export interface PanelJob {
  skill: string;
  title: string;
  focus: string;
  startedAt: number;
  /** The note whose sources it ran on — where "Put in note" sends it. */
  noteId: string;
  noteTitle: string;
  result?: JobResult;
  error?: string;
  /** Where the result went, once the user sent it somewhere. */
  applied?: { noteId: string; title: string };
  /** What Undo said, when it could not undo. */
  undoNote?: string;
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - since) / 1000));
  return <>{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</>;
}

const chip = "inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] transition-colors";
const quiet = `${chip} text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10`;

async function copyResult(html: string) {
  const text = new DOMParser().parseFromString(html, "text/html").body.innerText;
  try {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([text], { type: "text/plain" }),
    })]);
  } catch {
    await navigator.clipboard.writeText(text).catch(() => {});
  }
}

export function PanelJobCard({ job, pageNoteId, busy, onApply, onUndo, onRetry, onDiscard, onOpen }: {
  job: PanelJob;
  /** The note open behind the panel, if any. */
  pageNoteId: string | null;
  /** Another turn is running: actions that start one wait. */
  busy: boolean;
  onApply: (noteId: string) => void;
  onUndo: () => void;
  onRetry: () => void;
  onDiscard: () => void;
  onOpen: (href: string) => void;
}) {
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const r = job.result;
  const onItsNote = pageNoteId === job.noteId;
  const elsewhere = pageNoteId && !onItsNote ? pageNoteId : null;

  return (
    <div className="rounded-2xl ring-1 ring-gray-200/80 dark:ring-white/10 bg-white dark:bg-gray-800/60 overflow-hidden shadow-sm"
      data-testid="panel-job-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-white/5">
        <Sparkles size={13} className="text-indigo-500 shrink-0" />
        <span className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-100 truncate">{job.title}</span>
        {job.focus && <span className="text-[11px] text-gray-400 truncate">· {job.focus}</span>}
        <span className="ml-auto text-[11px] text-gray-400 shrink-0">
          {!r && !job.error && <>Writing… <Elapsed since={job.startedAt} /></>}
          {r && r.usd != null && `$${r.usd.toFixed(3)}`}
        </span>
      </div>

      {job.error && (
        <div className="px-3 py-2 space-y-1.5">
          <p className="text-[12px] text-amber-700 dark:text-amber-300">{job.error}</p>
          <button onClick={onRetry} disabled={busy} className={quiet}>
            <RotateCcw size={12} /> Try again
          </button>
        </div>
      )}

      {r && (
        <div className="px-3 py-2 space-y-2">
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            From <span className="font-medium text-gray-700 dark:text-gray-200">{job.noteTitle}</span>
            {resultSummary(r.html) ? ` · ${resultSummary(r.html)}` : ""}
            {r.truncated && <span className="text-amber-600"> · cut off at the length limit</span>}
          </p>
          {preview && (
            <iframe
              title={`${job.title} preview`}
              sandbox=""
              className="w-full h-72 rounded-xl ring-1 ring-gray-200 dark:ring-white/10 bg-white"
              srcDoc={`<style>${PREVIEW_CSS}</style>${r.html}`}
            />
          )}

          {!job.applied ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={() => onApply(job.noteId)}
                title={onItsNote ? "Add it to the note that is open" : `Write it into "${job.noteTitle}" and open it`}
                className={`${chip} font-medium bg-indigo-600 text-white hover:bg-indigo-500`}>
                <FileText size={12} /> {onItsNote ? "Insert into this note" : "Put in note"}
              </button>
              {elsewhere && (
                <button onClick={() => onApply(elsewhere)} title="Add it at the end of the note that is open"
                  className={`${chip} ring-1 ring-gray-200 dark:ring-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5`}>
                  Insert here
                </button>
              )}
              <button onClick={() => setPreview((v) => !v)} className={quiet}>
                {preview ? <EyeOff size={12} /> : <Eye size={12} />} {preview ? "Hide" : "Preview"}
              </button>
              <button onClick={onRetry} disabled={busy} title="Write it again" className={quiet}>
                <RotateCcw size={12} /> Try again
              </button>
              <button onClick={() => { void copyResult(r.html); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                title="Copy" className={quiet}>
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
              <button onClick={onDiscard} title="Discard" className={quiet}>
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[12px] text-emerald-600">
                <CheckCircle2 size={12} /> In “{job.applied.title}”
              </span>
              {pageNoteId !== job.applied.noteId && (
                <button onClick={() => onOpen(`/brain/${job.applied!.noteId}`)} className={quiet}>Open</button>
              )}
              {pageNoteId === job.applied.noteId && (
                <button onClick={onUndo} className={`${chip} text-indigo-600 hover:bg-indigo-500/10`}>
                  <Undo2 size={12} /> Undo
                </button>
              )}
              <button onClick={() => setPreview((v) => !v)} className={quiet}>
                {preview ? <EyeOff size={12} /> : <Eye size={12} />} {preview ? "Hide" : "Preview"}
              </button>
            </div>
          )}
          {job.undoNote && <p className="text-[11.5px] text-gray-500">{job.undoNote}</p>}

          <button onClick={() => onOpen(`/brain/workspace/${job.noteId}`)}
            className="inline-flex items-center gap-1 text-[11.5px] text-gray-400 hover:text-indigo-500">
            <Layers size={11} /> Open in workspace — the note beside its sources
          </button>
        </div>
      )}
    </div>
  );
}

export function UploadCard({ files, title }: { files: UploadFile[]; title: string }) {
  const done = files.every((f) => f.status === "ready" || f.status === "failed");
  return (
    <div className="rounded-2xl ring-1 ring-gray-200/80 dark:ring-white/10 bg-white/70 dark:bg-white/[0.03] px-3 py-2"
      data-testid="panel-upload-card">
      <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-1.5">
        {done ? "Sources in" : "Adding sources to"}{" "}
        <span className="font-medium text-gray-700 dark:text-gray-200">{title}</span>
      </p>
      <ul className="space-y-1">
        {files.map((f, i) => (
          <li key={i} className="flex items-center gap-2 text-[12px]">
            {f.status === "ready" ? <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
              : f.status === "failed" ? <AlertCircle size={13} className="text-amber-500 shrink-0" />
              : <Loader2 size={13} className="animate-spin text-indigo-500 shrink-0" />}
            <span className="truncate text-gray-700 dark:text-gray-200">{f.name}</span>
            <span className="ml-auto shrink-0 text-[11px] text-gray-400">
              {f.status === "uploading" ? "uploading…" : f.status === "processing" ? "reading…"
                : f.status === "failed" ? (f.error ?? "failed").slice(0, 60) : "ready"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
