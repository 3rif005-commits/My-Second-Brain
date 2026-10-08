"use client";

// Activity: the history IS the run rows (DESIGN §6.6). Expand a run for its items; Retry failed.
import { useCallback, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { announceNotionChange, notionApi, type RunDetail, type RunSummary } from "@/lib/notion";

const STATUS_WORD: Record<string, string> = {
  queued: "Waiting", running: "Running", succeeded: "Done", partial: "Partly done", failed: "Failed", paused: "Paused", cancelled: "Cancelled",
};
const TONE: Record<string, string> = {
  succeeded: "text-emerald-700 dark:text-emerald-300", partial: "text-amber-700 dark:text-amber-300",
  failed: "text-rose-700 dark:text-rose-300", paused: "text-gray-500", running: "text-indigo-600", queued: "text-gray-500",
};

function when(ts: string | null) {
  return ts ? new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

export function ActivitySection() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => notionApi.runs().then((r) => setRuns(r.runs)).catch((e) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  // a run in progress refreshes itself
  useEffect(() => {
    if (!runs?.some((r) => r.status === "queued" || r.status === "running")) return;
    const t = setInterval(() => { void load(); if (open) notionApi.run(open).then(setDetail).catch(() => {}); }, 2000);
    return () => clearInterval(t);
  }, [runs, open, load]);

  async function toggle(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setDetail(null);
    try { setDetail(await notionApi.run(id)); } catch (e) { setError((e as Error).message); }
  }

  async function retry(id: string) {
    try { await notionApi.retry(id); announceNotionChange(); await load(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <section id="activity" aria-label="Activity" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Activity</h2>
        <Button size="sm" variant="ghost" onClick={load}>Refresh</Button>
      </div>
      {error && <p role="alert" className="text-[13px] text-rose-600">{error}</p>}
      {runs === null ? <div className="h-10 rounded-md animate-pulse bg-gray-50 dark:bg-white/5" />
        : runs.length === 0 ? <p className="text-[13px] text-gray-500" data-testid="activity-empty">Nothing has been sent yet.</p>
        : (
          <ul className="rounded-lg border border-gray-200 dark:border-white/10 divide-y divide-gray-100 dark:divide-white/10" data-testid="activity-list">
            {runs.map((r) => (
              <li key={r.id}>
                <button onClick={() => toggle(r.id)} aria-expanded={open === r.id}
                  className="w-full flex items-center gap-3 px-3 h-10 text-left hover:bg-gray-50 dark:hover:bg-white/5">
                  <ChevronRight size={13} className={`transition-transform ${open === r.id ? "rotate-90" : ""}`} />
                  <span className="text-[13px] w-36 shrink-0">{when(r.started_at ?? r.created_at)}</span>
                  <span className="text-[12px] w-16 shrink-0 text-gray-500">{r.trigger}</span>
                  <span className={`text-[13px] font-medium w-24 shrink-0 ${TONE[r.status] ?? ""}`}>{STATUS_WORD[r.status] ?? r.status}</span>
                  <span className="text-[12px] text-gray-500 truncate">
                    {r.counts?.done ?? 0} sent{r.counts?.problems ? ` · ${r.counts.problems} problem(s)` : ""}{r.requests_used ? ` · ${r.requests_used} requests` : ""}
                  </span>
                </button>
                {open === r.id && (
                  <div className="px-4 pb-3 space-y-2">
                    {!detail ? <div className="h-6 animate-pulse bg-gray-50 dark:bg-white/5 rounded" /> : (
                      <>
                        <ul className="space-y-1 text-[13px]">
                          {detail.items.map((i) => (
                            <li key={i.id} className="flex gap-2">
                              <span className="w-24 shrink-0 text-gray-500">{i.status}</span>
                              <span className="min-w-0 flex-1"><span className="font-medium">{i.title || i.local_id}</span>
                                {i.message && i.status !== "done" ? <span className="block text-gray-500">{i.message}</span> : null}</span>
                            </li>
                          ))}
                        </ul>
                        {detail.items.some((i) => i.status === "failed") && (
                          <Button size="sm" variant="primary" onClick={() => retry(r.id)}>Retry failed</Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
