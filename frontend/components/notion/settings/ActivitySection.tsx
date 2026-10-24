"use client";

// Activity: the history IS the run rows (DESIGN §6.6). Expand a run for its items; Retry failed.
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { Button, SettingsSection } from "@/components/ui";
import { announceNotionChange, notionApi, type RunDetail, type RunSummary } from "@/lib/notion";

const STATUS_WORD: Record<string, string> = {
  queued: "Waiting", running: "Running", succeeded: "Done", partial: "Partly done", failed: "Failed", paused: "Paused", cancelled: "Cancelled",
};
const TONE: Record<string, string> = {
  succeeded: "text-emerald-700 dark:text-emerald-300", partial: "text-amber-700 dark:text-amber-300",
  failed: "text-rose-700 dark:text-rose-300", paused: "text-ink-secondary", running: "text-accent-600", queued: "text-ink-secondary",
};

function when(ts: string | null) {
  return ts ? new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

export function ActivitySection() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => notionApi.runs().then((r) => { setRuns(r.runs); setError(null); }).catch((e) => setError(e.message)), []);
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
    <SettingsSection
      id="activity"
      title="Activity"
      actions={<Button variant="ghost" icon={<RefreshCw />} onClick={() => void load()} aria-label="Refresh activity">Refresh</Button>}
    >
      {error && <p role="alert" className="text-[13px] text-ink-danger">{error}</p>}
      {runs === null ? (error ? null : <div className="h-10 rounded-md animate-pulse bg-surface-chip" aria-busy="true" />)
        : runs.length === 0 ? <p className="text-[13px] text-ink-secondary" data-testid="activity-empty">Nothing has been sent yet.</p>
        : (
          <ul className="-mt-2 rounded-lg border border-line divide-y divide-line text-ink" data-testid="activity-list">
            {runs.map((r) => (
              <li key={r.id}>
                <button onClick={() => toggle(r.id)} aria-expanded={open === r.id}
                  className="w-full flex items-center gap-3 px-3 h-10 text-left hover:bg-surface-hover">
                  <ChevronRight size={13} className={`transition-transform ${open === r.id ? "rotate-90" : ""}`} />
                  <span className="text-[13px] w-36 shrink-0">{when(r.started_at ?? r.created_at)}</span>
                  <span className="text-[12px] w-16 shrink-0 text-ink-secondary">{r.trigger}</span>
                  <span className={`text-[13px] font-medium w-24 shrink-0 ${TONE[r.status] ?? ""}`}>{STATUS_WORD[r.status] ?? r.status}</span>
                  <span className="text-[12px] text-ink-secondary truncate">
                    {r.counts?.done ?? 0} sent{r.counts?.problems ? ` · ${r.counts.problems} problem(s)` : ""}{r.requests_used ? ` · ${r.requests_used} requests` : ""}
                  </span>
                </button>
                {open === r.id && (
                  <div className="px-4 pb-3 space-y-2">
                    {!detail ? <div className="h-6 animate-pulse bg-surface-chip rounded" /> : (
                      <>
                        <ul className="space-y-1 text-[13px]">
                          {detail.items.map((i) => (
                            <li key={i.id} className="flex gap-2">
                              <span className="w-24 shrink-0 text-ink-secondary">{i.status.replace(/_/g, " ")}</span>
                              <span className="min-w-0 flex-1"><span className="font-medium">{i.title || i.local_id}</span>
                                {i.message && i.status !== "done" ? <span className="block text-ink-secondary">{i.message}</span> : null}</span>
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
    </SettingsSection>
  );
}
