"use client";

// Background jobs waiting in the AI panel: queued, running, failed — and, when
// one finishes, the same result card a live job gets, labelled "Background".
// The server is the truth (the list survives a reload and a closed tab), so
// this keeps no history of its own: it asks, shows, and asks again.
import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Loader2, Play, X } from "lucide-react";
import { PanelJobCard, type PanelJob } from "./PanelCards";
import { readNote } from "./panelSources";
import {
  agoText, announceJobsChanged, cancelJob, discardJob, getJob, listJobs, markJobApplied, runJobNow, stateLine,
  type BgJob,
} from "@/lib/backgroundJobs";
import type { JobResult } from "@/lib/chatJobs";
import { jobTitle } from "@/lib/workspace";

const FAST_MS = 8_000;    // something is queued or running: look often
const SLOW_MS = 45_000;   // a ready result is already here; nothing else to wait for

const chip = "inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] transition-colors";
const quiet = `${chip} text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10`;

interface Props {
  noteId: string;
  noteTitle?: string;
  pageNoteId: string | null;
  inWorkspace: boolean;
  /** Bumped when the composer queues a job, so it shows up at once. */
  refreshKey: number;
  /** Put a finished result in a note (the same path a live result takes). */
  onApply: (job: PanelJob, noteId: string) => Promise<void>;
  onUndo: (noteId: string) => Promise<string>;
  onOpen: (href: string) => void;
  /** Queue the same job again. */
  onAgain: (job: BgJob) => void;
}

export function BackgroundJobs(props: Props) {
  const { noteId, refreshKey } = props;
  const [jobs, setJobs] = useState<BgJob[]>([]);
  const [title, setTitle] = useState(props.noteTitle ?? "");
  const [error, setError] = useState<string | null>(null);
  const wanted = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("job");

  const refresh = useCallback(async () => {
    try { setJobs(await listJobs(noteId)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load background jobs"); }
  }, [noteId]);

  useEffect(() => { setJobs([]); void refresh(); }, [refresh, refreshKey]);

  const active = jobs.some((j) => j.status === "queued" || j.status === "submitted");
  useEffect(() => {
    const t = setInterval(() => { void refresh(); }, active ? FAST_MS : SLOW_MS);
    return () => clearInterval(t);
  }, [active, refresh]);

  useEffect(() => {
    if (props.noteTitle) { setTitle(props.noteTitle); return; }
    let live = true;
    void readNote(noteId).then((n) => { if (live) setTitle(n.title); });
    return () => { live = false; };
  }, [noteId, props.noteTitle]);

  if (!jobs.length && !error) return null;
  return (
    <div className="px-3 pt-3 space-y-2" data-testid="background-jobs">
      {jobs.map((j) => j.status === "ready"
        ? <ReadyCard key={j.id} job={j} title={title} focused={j.id === wanted}
            {...props} onDone={refresh} />
        : <WaitingCard key={j.id} job={j} focused={j.id === wanted} onChanged={refresh} />)}
      {error && <p className="text-[11.5px] text-amber-700 dark:text-amber-300">{error}</p>}
    </div>
  );
}

function WaitingCard({ job, focused, onChanged }: {
  job: BgJob; focused: boolean; onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const running = job.status === "submitted";
  const trouble = job.status === "failed" || job.status === "budget_blocked" || job.status === "needs_you";

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setNote(null);
    try { await fn(); await onChanged(); announceJobsChanged(); }
    catch (e) { setNote(e instanceof Error ? e.message : "That did not work"); }
    finally { setBusy(false); }
  }

  return (
    <div data-testid="background-job-card" data-status={job.status}
      className={`rounded-2xl ring-1 bg-white dark:bg-gray-800/60 px-3 py-2 space-y-1.5 ${
        focused ? "ring-indigo-400" : "ring-gray-200/80 dark:ring-white/10"}`}>
      <div className="flex items-center gap-2">
        {running
          ? <Loader2 size={13} className="text-indigo-500 shrink-0 animate-spin" />
          : <Clock size={13} className={`shrink-0 ${trouble ? "text-amber-500" : "text-gray-400"}`} />}
        <span className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-100 truncate">
          {jobTitle(job.skill)}
        </span>
        {job.focus && <span className="text-[11px] text-gray-400 truncate">· {job.focus}</span>}
        <span className="ml-auto text-[10.5px] uppercase tracking-wide text-gray-400 shrink-0">Background</span>
      </div>
      <p className={`text-[12px] ${trouble ? "text-amber-700 dark:text-amber-300" : "text-gray-500 dark:text-gray-400"}`}>
        {stateLine(job)}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {job.status === "queued" && (
          <button onClick={() => void act(() => runJobNow(job.id))} disabled={busy} className={quiet}>
            <Play size={12} /> Run now
          </button>
        )}
        {(job.status === "queued" || running) && (
          <button onClick={() => void act(() => cancelJob(job.id))} disabled={busy} className={quiet}>
            <X size={12} /> Cancel
          </button>
        )}
        {trouble && (
          <button onClick={() => void act(() => discardJob(job.id))} disabled={busy} className={quiet}>
            <X size={12} /> Dismiss
          </button>
        )}
      </div>
      {note && <p className="text-[11.5px] text-amber-700 dark:text-amber-300">{note}</p>}
    </div>
  );
}

function ReadyCard({ job, noteId, title, focused, pageNoteId, inWorkspace, onApply, onUndo, onOpen, onAgain, onDone }:
  Props & { job: BgJob; title: string; focused: boolean; onDone: () => Promise<void> }) {
  const [pj, setPj] = useState<PanelJob | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // The list carries no result body; fetch it once, when the card first shows.
  useEffect(() => {
    let live = true;
    void getJob(job.id).then((full) => {
      if (!live || !full.result_html) return;
      const meta = full.result_meta ?? {};
      const result: JobResult = {
        skill: full.skill, title: full.result_title ?? jobTitle(full.skill),
        html: full.result_html, source_ids: full.source_ids ?? [],
        truncated: Boolean(meta.truncated),
        input_tokens: Number(meta.input_tokens ?? 0), output_tokens: Number(meta.output_tokens ?? 0),
        usd: full.actual_usd, method: (meta.method as JobResult["method"]) ?? null,
        check: (meta.check as JobResult["check"]) ?? null,
      };
      setPj({ skill: full.skill, title: jobTitle(full.skill), focus: full.focus,
        startedAt: Date.now(), noteId, noteTitle: title, result });
    }).catch((e) => { if (live) setFailed(e instanceof Error ? e.message : "Could not open the result"); });
    return () => { live = false; };
  }, [job.id, noteId, title]);

  useEffect(() => {
    if (focused && pj) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focused, pj]);

  if (failed) return <p className="text-[12px] text-amber-700 dark:text-amber-300">{failed}</p>;
  if (!pj) return (
    <div className="rounded-2xl ring-1 ring-gray-200/80 dark:ring-white/10 px-3 py-2 text-[12px] text-gray-400">
      Opening {jobTitle(job.skill)}…
    </div>
  );

  const shown: PanelJob = { ...pj, noteTitle: title };
  const label = `Background · ready ${agoText(job.finished_at)}`
    + (job.ran_late ? " · ran late, the app was closed" : "");
  return (
    <div ref={ref} className={focused ? "rounded-2xl ring-2 ring-indigo-300" : ""} data-testid="background-ready">
      <PanelJobCard
        job={shown} pageNoteId={pageNoteId} inWorkspace={inWorkspace} busy={busy} badge={label}
        onApply={(target) => {
          setBusy(true);
          void (async () => {
            try {
              await onApply(shown, target);
              await markJobApplied(job.id, target);
              announceJobsChanged();
              setPj((p) => p && { ...p, applied: { noteId: target, title: target === noteId ? title : "the note" },
                undoNote: undefined });
            } finally { setBusy(false); }
          })();
        }}
        onUndo={() => void onUndo(pj.applied?.noteId ?? noteId).then((out) => {
          setPj((p) => p && (out === "undone"
            ? { ...p, applied: undefined, undoNote: undefined }
            : { ...p, undoNote: out === "edited"
                ? "You've edited the note since — use Ctrl+Z in the note to step back."
                : "Open the note to undo it there (Ctrl+Z)." }));
        })}
        onRetry={() => onAgain(job)}
        onDiscard={() => void discardJob(job.id).then(onDone).then(announceJobsChanged)}
        onOpen={onOpen}
      />
    </div>
  );
}
