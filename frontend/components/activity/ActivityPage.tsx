"use client";

// Activity: what happened in the background. Anything waiting on you comes
// first; below it the history, filterable, one row expanding to the honest
// details (sources, model, what it cost, when). Nothing here runs by itself —
// every action is a button.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Clock, Loader2, Play, RotateCcw, Trash2, X } from "lucide-react";
import {
  IN_PROGRESS, NEEDS_YOU, EMPTY_ACTIVITY, STATE_WORDS, agoText, cancelJob, costLine, costText,
  deleteJob, discardJob, getActivity, getJobDetail, monthLine, queueJob, runJobNow, stateLine,
  timeline, triggerText, whenShort, type Activity, type ActivityFilters, type ActivityJob, type JobStatus,
} from "@/lib/backgroundJobs";
import { jobTitle } from "@/lib/workspace";

const FAST_MS = 10_000;
const SLOW_MS = 45_000;
const KNOWN_SKILLS = ["study-guide", "flashcards", "compare-sources"];

const chip = "inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] transition-colors disabled:opacity-50";
const quiet = `${chip} text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10`;
const select = "h-8 rounded-lg px-2 text-[12.5px] bg-transparent ring-1 ring-gray-200 dark:ring-white/10 text-gray-700 dark:text-gray-200";

const noteName = (j: ActivityJob) => (j.note_title ? `“${j.note_title}”` : "a deleted note");

export function ActivityPage() {
  const [data, setData] = useState<Activity | null>(null);
  const [filters, setFilters] = useState<ActivityFilters>({ days: 30 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await getActivity(filters)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load the activity"); }
  }, [filters]);

  useEffect(() => { void load(); }, [load]);
  const running = data?.open.some((j) => IN_PROGRESS.includes(j.status)) ?? false;
  useEffect(() => {
    const t = setInterval(() => { void load(); }, running ? FAST_MS : SLOW_MS);
    return () => clearInterval(t);
  }, [load, running]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id); setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "That did not work"); }
    finally { setBusy(null); }
  }
  const again = (j: ActivityJob) => act(j.id, () =>
    queueJob({ noteId: j.note_id!, skill: j.skill, focus: j.focus, runAfter: null }));

  const needs = data?.open.filter((j) => NEEDS_YOU.includes(j.status)) ?? [];
  const ready = data?.open.filter((j) => j.status === "ready") ?? [];
  const inProgress = data?.open.filter((j) => IN_PROGRESS.includes(j.status)) ?? [];
  const empty = !!data && !data.open.length && !data.history.length && filters.days === 30
    && !filters.skill && !filters.trigger && !filters.status;
  const skills = Array.from(new Set([...KNOWN_SKILLS, ...(data?.history ?? []).map((j) => j.skill)]));

  return (
    <div className="flex-1 overflow-y-auto" data-testid="activity">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-50">Activity</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">What ran in the background.</p>
          {data && (
            <p className="ml-auto text-[13px] text-gray-500 dark:text-gray-400" data-testid="month-line">
              {monthLine(data.month_spent_usd, data.monthly_cap_usd, data.saved_usd)}
              {" · "}<Link href="/brain/settings/background-jobs" className="text-indigo-600 hover:underline">Change limit</Link>
            </p>
          )}
        </div>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        {!data && !error && <p className="text-sm text-gray-400">Loading…</p>}

        {empty && <p className="text-sm text-gray-500" data-testid="activity-empty">{EMPTY_ACTIVITY}</p>}

        {needs.length > 0 && (
          <Section title={`Needs you (${needs.length})`}>
            {needs.map((j) => (
              <Card key={j.id} testId="needs-you">
                <p className="text-sm text-gray-900 dark:text-gray-100">
                  <b>{jobTitle(j.skill)}</b> · {noteName(j)} · <span className="text-amber-700 dark:text-amber-300">{stateLine(j)}</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {j.status === "budget_blocked" && (
                    <Link href="/brain/settings/background-jobs" className={`${chip} ring-1 ring-gray-200 dark:ring-white/10 text-gray-700 dark:text-gray-200`}>Change limit</Link>
                  )}
                  {j.note_id && (
                    <button className={quiet} disabled={busy === j.id} onClick={() => void again(j)}><RotateCcw size={12} /> Run again</button>
                  )}
                  <button className={quiet} disabled={busy === j.id} onClick={() => void act(j.id, () => discardJob(j.id))}><X size={12} /> Dismiss</button>
                </div>
              </Card>
            ))}
          </Section>
        )}

        {ready.length > 0 && (
          <Section title={`Ready (${ready.length})`}>
            {ready.map((j) => (
              <Card key={j.id} testId="ready">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-gray-900 dark:text-gray-100">
                    <b>{jobTitle(j.skill)}</b> · {noteName(j)} · {costText(j)} · {agoText(j.finished_at)}
                  </p>
                  <span className="ml-auto flex gap-1.5">
                    {j.note_id && <Link href={`/brain/workspace/${j.note_id}?job=${j.id}`}
                      className={`${chip} font-medium bg-indigo-600 text-white hover:bg-indigo-500`}>Open</Link>}
                    <button className={quiet} disabled={busy === j.id} onClick={() => void act(j.id, () => discardJob(j.id))}><X size={12} /> Discard</button>
                  </span>
                </div>
              </Card>
            ))}
          </Section>
        )}

        {inProgress.length > 0 && (
          <Section title={`In progress (${inProgress.length})`}>
            {inProgress.map((j) => (
              <div key={j.id} className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-200" data-testid="in-progress">
                {j.status === "submitted" ? <Loader2 size={13} className="animate-spin text-indigo-500" /> : <Clock size={13} className="text-gray-400" />}
                <span><b>{jobTitle(j.skill)}</b> · {noteName(j)} · {stateLine(j)}</span>
                <span className="ml-auto flex gap-1.5">
                  {j.status === "queued" && <button className={quiet} disabled={busy === j.id} onClick={() => void act(j.id, () => runJobNow(j.id))}><Play size={12} /> Run now</button>}
                  <button className={quiet} disabled={busy === j.id} onClick={() => void act(j.id, () => cancelJob(j.id))}><X size={12} /> Cancel</button>
                </span>
              </div>
            ))}
          </Section>
        )}

        {!empty && data && (
          <Section title="History">
            <div className="flex flex-wrap gap-2 mb-2" data-testid="filters">
              <select aria-label="Job" className={select} value={filters.skill ?? ""}
                onChange={(e) => setFilters({ ...filters, skill: e.target.value || undefined })}>
                <option value="">All jobs</option>
                {skills.map((s) => <option key={s} value={s}>{jobTitle(s)}</option>)}
              </select>
              <select aria-label="State" className={select} value={filters.status ?? ""}
                onChange={(e) => setFilters({ ...filters, status: e.target.value || undefined })}>
                <option value="">All states</option>
                {(["applied", "discarded", "cancelled", "expired", "skipped"] as JobStatus[]).map((s) =>
                  <option key={s} value={s}>{STATE_WORDS[s]}</option>)}
              </select>
              <select aria-label="Trigger" className={select} value={filters.trigger ?? ""}
                onChange={(e) => setFilters({ ...filters, trigger: e.target.value || undefined })}>
                <option value="">Any trigger</option>
                {["run_later", "source_added", "schedule"].map((t) => <option key={t} value={t}>{triggerText(t)}</option>)}
              </select>
              <select aria-label="Period" className={select} value={filters.days ?? 30}
                onChange={(e) => setFilters({ ...filters, days: Number(e.target.value) })}>
                <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
              </select>
            </div>
            {data.history.length === 0
              ? <p className="text-sm text-gray-500" data-testid="history-empty">Nothing matches.</p>
              : (
                <table className="w-full text-[13px]" data-testid="history">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                      <th className="w-5" /><th className="py-1.5 font-medium">When</th><th className="font-medium">Job</th>
                      <th className="font-medium">Note</th><th className="font-medium">Trigger</th>
                      <th className="font-medium">State</th><th className="font-medium">Cost</th><th className="w-24" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((j) => (
                      <HistoryRow key={j.id} job={j} open={openRow === j.id} busy={busy === j.id}
                        onToggle={() => setOpenRow(openRow === j.id ? null : j.id)}
                        onAgain={() => void again(j)}
                        onDelete={() => void act(j.id, () => deleteJob(j.id))} />
                    ))}
                  </tbody>
                </table>
              )}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-gray-400 mb-2">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Card({ children, testId }: { children: React.ReactNode; testId: string }) {
  return <div className="rounded-xl ring-1 ring-gray-200 dark:ring-white/10 px-4 py-3" data-testid={testId}>{children}</div>;
}

function HistoryRow({ job, open, busy, onToggle, onAgain, onDelete }: {
  job: ActivityJob; open: boolean; busy: boolean;
  onToggle: () => void; onAgain: () => void; onDelete: () => void;
}) {
  const [sources, setSources] = useState<string[] | null>(null);
  useEffect(() => {
    if (!open || sources) return;
    let live = true;
    void getJobDetail(job.id).then((d) => { if (live) setSources(d.sources.map((s) => s.title)); })
      .catch(() => { if (live) setSources([]); });
    return () => { live = false; };
  }, [open, sources, job.id]);

  const meta = job.result_meta ?? {};
  const tokens = Number(meta.input_tokens ?? 0) + Number(meta.output_tokens ?? 0);
  return (
    <>
      <tr data-testid="history-row" data-status={job.status} onClick={onToggle}
        className="cursor-pointer border-t border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5">
        <td className="py-2"><ChevronRight size={13} className={`text-gray-400 transition-transform ${open ? "rotate-90" : ""}`} /></td>
        <td className="py-2 text-gray-500 whitespace-nowrap">{whenShort(job.created_at)}</td>
        <td className="text-gray-900 dark:text-gray-100">{jobTitle(job.skill)}</td>
        <td className="text-gray-600 dark:text-gray-300 max-w-[14rem] truncate">{job.note_title ?? "—"}</td>
        <td className="text-gray-500">{triggerText(job.trigger)}</td>
        <td>{STATE_WORDS[job.status]}</td>
        <td className="tabular-nums">{costText(job)}</td>
        <td className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          {job.note_id && <button className={quiet} disabled={busy} onClick={onAgain} title="Run again"><RotateCcw size={12} /></button>}
          <button className={quiet} disabled={busy} onClick={onDelete} title="Delete from history" aria-label="Delete from history"><Trash2 size={12} /></button>
        </td>
      </tr>
      {open && (
        <tr data-testid="history-detail">
          <td /><td colSpan={7} className="pb-3 pr-2 text-[12.5px] text-gray-600 dark:text-gray-300 space-y-1">
            <p>{costLine(job)}</p>
            <p>
              {job.model ? `Model ${job.model}` : "Model unknown"} · {job.price_mode === "batch" ? "half price" : job.price_mode === "local" ? "local" : "normal price"}
              {tokens > 0 ? ` · ${tokens.toLocaleString()} tokens` : ""}
            </p>
            <p>Made from: {sources === null ? "…" : sources.length ? sources.join(", ") : "sources no longer available"}</p>
            <p className="text-gray-400">{timeline(job).map((s) => `${s.label} ${s.at}`).join(" → ")}</p>
            {job.error && <p className="text-amber-700 dark:text-amber-300">{job.error}</p>}
            {job.cancel_reason && <p>Cancelled — {job.cancel_reason}</p>}
          </td>
        </tr>
      )}
    </>
  );
}
