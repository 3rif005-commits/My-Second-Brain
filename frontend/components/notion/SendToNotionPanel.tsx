"use client";

// "Send to Notion…" review panel (DESIGN §7.2): the dry run first, then Send, then progress and the
// result. One panel for everything: a note, a folder with what is inside, a database, a selection,
// the whole brain. Esc / backdrop = cancel, never send.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { CheckCircle2, ChevronDown, ExternalLink, Info, Loader2, Settings, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  announceNotionChange, notionApi, type NotionStatus, type Plan, type PlanItem, type Resolution, type RunDetail,
  type Scope, type SendResult,
} from "@/lib/notion";
import { ConnectInline } from "./ConnectInline";
import { SyncTab } from "./SyncTab";
import { PlanRow, TAB_LABEL, tabOf, type TabId } from "./PlanReview";

interface Props {
  scope: Scope;
  title?: string;
  onClose: () => void;
  onSent?: (r: SendResult) => void;
  onOpenSettings?: () => void;
}

const TAB_ORDER: TabId[] = ["new", "changed", "needs_you", "unchanged", "not_sent"];

export function SendToNotionPanel({ scope, title, onClose, onSent, onOpenSettings }: Props) {
  const [conn, setConn] = useState<NotionStatus | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [released, setReleased] = useState<string[]>([]);
  const [archive, setArchive] = useState<string[]>([]);
  const [unticked, setUnticked] = useState<string[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [tab, setTab] = useState<TabId | null>(null);
  const [phase, setPhase] = useState<"loading" | "review" | "sending" | "done">("loading");
  const [result, setResult] = useState<SendResult | null>(null);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slowSend, setSlowSend] = useState(false);
  const [top, setTop] = useState<"send" | "sync">("send");
  const [changing, setChanging] = useState(false);
  const [infoShown, setInfoShown] = useState(() => { try { return localStorage.getItem("sb-notion-info") !== "x"; } catch { return true; } });
  const panelRef = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const scopeKey = JSON.stringify(scope);

  const options = useMemo(() => ({ released, archive_ids: archive, resolutions, exclude: unticked }),
    [released, archive, resolutions, unticked]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await notionApi.status(true);
      setConn(s);
      if (s.connected && s.root) setPlan(await notionApi.plan(JSON.parse(scopeKey), options));
      setPhase((p) => (p === "loading" ? "review" : p));
    } catch (e) { setError((e as Error).message); setPhase("review"); }
  }, [scopeKey, options]);

  useEffect(() => { void load(); }, [load]);
  // Focus moves into the dialog on open and goes back to whatever opened it on close; polling stops once it is gone.
  const mounted = useRef(true);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    mounted.current = true;
    return () => { mounted.current = false; opener?.focus?.(); };
  }, []);
  // The first send also builds the Notes table in Notion: say so if it takes a moment, instead of a bare spinner.
  useEffect(() => {
    if (phase !== "sending") { setSlowSend(false); return; }
    const t = setTimeout(() => setSlowSend(true), 3500);
    return () => clearTimeout(t);
  }, [phase]);
  // A background run (more than one item) keeps going on the server, so the panel may be closed meanwhile.
  const canClose = phase !== "sending" || !!run;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && canClose) onClose();
      if (e.key === "Tab" && panelRef.current) {
        const f = [...panelRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])')];
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1], at = document.activeElement;
        if (e.shiftKey && (at === first || at === panelRef.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && phase === "review" && sendable.length > 0) void send();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const items = plan?.items ?? [];
  const sendable = items.filter((i) => (i.state === "new" || i.state === "changed" || i.state === "deleted") && i.selected);
  const ready = !!(conn?.connected && conn.root);
  const byTab = useMemo(() => {
    const m: Record<TabId, PlanItem[]> = { new: [], changed: [], unchanged: [], needs_you: [], not_sent: [] };
    items.forEach((i) => m[tabOf(i)].push(i));
    return m;
  }, [items]);
  const shownTab: TabId = tab && byTab[tab].length ? tab : (TAB_ORDER.find((t) => byTab[t].length) ?? "new");
  const shown = byTab[shownTab];

  function toggle(i: PlanItem) {
    if (i.state === "deleted") {
      setArchive((a) => (a.includes(i.note_id) ? a.filter((x) => x !== i.note_id) : [...a, i.note_id]));
    } else {
      setUnticked((u) => (u.includes(i.note_id) ? u.filter((x) => x !== i.note_id) : [...u, i.note_id]));
    }
  }

  function resolve(id: string, r: Resolution | null) {
    setResolutions((cur) => { const n = { ...cur }; if (r) n[id] = r; else delete n[id]; return n; });
  }

  async function send() {
    setPhase("sending"); setError(null);
    try {
      const background = sendable.length > 1;
      const r = await notionApi.send(scope, { ...options, background });
      setResult(r);
      if (r.status === "queued" && r.run_id) {
        const finished = await poll(r.run_id);
        setRun(finished);
      }
      setPhase("done"); onSent?.(r); announceNotionChange();
    } catch (e) { setError((e as Error).message); setPhase("review"); }
  }

  async function poll(id: string): Promise<RunDetail> {
    for (;;) {
      const d = await notionApi.run(id);
      setRun(d);
      if (!["queued", "running"].includes(d.status) || !mounted.current) return d;
      await new Promise((res) => setTimeout(res, 1000));
    }
  }

  async function retryFailed() {
    if (!result?.run_id && !run) return;
    setPhase("sending");
    try {
      const r = await notionApi.retry(run?.id ?? result!.run_id!);
      if (r.run_id) setRun(await poll(r.run_id));
      setPhase("done"); announceNotionChange();
    } catch (e) { setError((e as Error).message); setPhase("done"); }
  }

  async function stopMirroring(id: string) {
    try { await notionApi.pauseNote(id, true); announceNotionChange(); await load(); } catch (e) { setError((e as Error).message); }
  }

  const finalItems = run ? run.items : (result?.items ?? []).map((i) => ({ id: i.note_id, kind: i.kind ?? "note", local_id: i.note_id,
    title: i.title, action: i.action, status: i.status, error_class: null, message: i.message, notion_url: i.notion_url }));
  const done = finalItems.filter((i) => i.status === "done");
  const problems = finalItems.filter((i) => i.status === "failed" || i.status === "needs_you");
  const single = sendable.length === 1 && finalItems.length === 1 ? finalItems[0] : null;
  const urlOf = (id: string) => result?.items.find((x) => x.note_id === id)?.notion_url ?? null;
  const progress = run ? run.items.filter((i) => !["queued", "running"].includes(i.status)).length : 0;

  return createPortal(
    <div className="fixed inset-0 z-[9998]"
      onClick={(e) => { if (e.target === e.currentTarget && canClose) onClose(); }}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="notion-panel-title"
        className="sb-pop absolute top-14 right-3 sm:right-5 w-[440px] max-w-[calc(100vw-1.5rem)] max-h-[min(80vh,600px)] flex flex-col outline-none rounded-xl overflow-hidden
          shadow-[0_0_0_1px_rgba(15,15,15,0.06),0_8px_28px_rgba(15,15,15,0.18)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_10px_32px_rgba(0,0,0,0.55)]
          bg-[var(--menu-bg)] text-[color:var(--menu-fg)]">
        <header className="flex items-end justify-between gap-3 px-4 shrink-0 border-b border-[color:var(--menu-divider)]">
          <h2 id="notion-panel-title" className="sr-only">Send to Notion{title ? ` · ${title}` : ""}</h2>
          <div role="group" aria-label="Panel" className="flex gap-4 text-[13px]">
            {(["send", "sync"] as const).map((t) => (
              <button key={t} aria-pressed={top === t} aria-label={t === "send" ? "Send tab" : "Sync tab"} onClick={() => setTop(t)}
                className={`h-10 -mb-px border-b-2 transition-colors ${top === t ? "border-current font-medium" : "border-transparent opacity-50 hover:opacity-80"}`}>
                {t === "send" ? "Send" : "Sync"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 pb-1.5">
            <Link href="/brain/settings/notion" onClick={onOpenSettings} aria-label="Notion settings" title="Notion settings"
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--menu-row-hover-bg)] opacity-60 hover:opacity-100"><Settings size={14} /></Link>
            <button onClick={onClose} aria-label="Close" disabled={!canClose}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--menu-row-hover-bg)] opacity-60 hover:opacity-100"><X size={14} /></button>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 text-[13px]">
          {top === "sync" && ready && <SyncTab scope={scope} onNavigate={onOpenSettings} />}
          {top === "sync" && !ready && phase !== "loading" && <p className="text-[13px] opacity-70 py-2">Connect Notion on the Send tab first.</p>}

          {top === "send" && phase === "loading" && (
            <div className="space-y-2" aria-busy="true" data-testid="notion-loading">
              {[0, 1, 2].map((i) => <div key={i} className="h-10 rounded-md animate-pulse bg-[var(--menu-field-bg)]" />)}
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-md px-3 py-2 text-[13px] bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">{error}</p>
          )}

          {top === "send" && phase !== "loading" && conn && !ready && (
            <ConnectInline status={conn} onChange={(s) => { setConn(s); if (s.connected && s.root) void load(); }} />
          )}

          {top === "send" && phase === "review" && ready && plan && changing && conn && (
            <ConnectInline status={{ ...conn, root: null }} onChange={(c) => { setConn(c); if (c.root) { setChanging(false); void load(); } }} />
          )}

          {top === "send" && phase === "review" && ready && plan && !changing && (
            <div className="space-y-3 sb-fade">
              <section aria-label="Destination">
                <button onClick={() => setChanging(true)} title="Choose a different Notion page"
                  className="w-full flex items-center gap-3 px-1.5 py-1.5 rounded-lg text-left hover:bg-[var(--menu-row-hover-bg)]">
                  <span aria-hidden className="w-8 h-8 rounded-lg grid place-items-center text-[16px] bg-[var(--menu-field-bg)] shrink-0">📄</span>
                  <span className="flex-1 min-w-0">
                    <strong className="block text-[13px] font-medium truncate">{conn?.root?.title ?? "your Notion page"}</strong>
                    <span className="block text-[12px] opacity-60 truncate">{conn?.workspace_name}</span>
                  </span>
                  <span className="flex items-center gap-0.5 text-[12px] opacity-60">Change <ChevronDown size={13} /></span>
                </button>
              </section>

              {items.length > 1 && (
                <div role="tablist" aria-label="Preview" className="flex flex-wrap gap-1.5">
                  {TAB_ORDER.filter((t) => byTab[t].length).map((t) => (
                    <button key={t} role="tab" aria-selected={shownTab === t} onClick={() => setTab(t)}
                      className={`h-7 px-2.5 rounded-full text-[12px] border transition-colors ${shownTab === t
                        ? "bg-indigo-600 text-white border-indigo-600" : "border-[color:var(--menu-divider)] hover:bg-[var(--menu-row-hover-bg)]"}`}>
                      {TAB_LABEL[t]} {byTab[t].length}
                    </button>
                  ))}
                </div>
              )}

              <section aria-label="Preview" className="space-y-2">
                {shown.map((it, idx) => (
                  <PlanRow key={`${it.kind}:${it.note_id}`} item={it}
                    checked={it.state === "deleted" ? archive.includes(it.note_id) : !unticked.includes(it.note_id)}
                    onToggle={() => toggle(it)}
                    onResolve={(r) => resolve(it.note_id, r)}
                    onRelease={() => setReleased((x) => [...x, it.note_id])}
                    onStopMirroring={() => stopMirroring(it.note_id)}
                    defaultOpen={items.length === 1}
                    focusRef={(el) => { rows.current[idx] = el; }}
                    onKeyNav={(d) => rows.current[Math.min(Math.max(idx + d, 0), shown.length - 1)]?.focus()} />
                ))}
                {plan.nothing_to_send && shown.every((i) => i.state === "unchanged") && (
                  <p data-testid="nothing-to-send" className="text-[13px]">Nothing to send: everything here is already in sync ✓</p>
                )}
                {released.length > 0 && <p className="text-[12px] text-amber-700 dark:text-amber-300">Released for this send only.</p>}
              </section>
              {infoShown && (
                <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] leading-snug bg-sky-50 text-sky-900 dark:bg-sky-500/10 dark:text-sky-200" data-testid="notion-info">
                  <Info size={14} className="mt-px shrink-0" />
                  <span className="flex-1">Notion gets a copy. Changes made in Notion are never overwritten without asking you first.</span>
                  <button aria-label="Dismiss" className="opacity-60 hover:opacity-100"
                    onClick={() => { setInfoShown(false); try { localStorage.setItem("sb-notion-info", "x"); } catch { /* fine */ } }}><X size={13} /></button>
                </div>
              )}
            </div>
          )}

          {top === "send" && phase === "sending" && (
            <div className="space-y-3 sb-fade" role="status" aria-live="polite">
              <p className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Sending to Notion…</p>
              {!run && (
                <>
                  <div className="h-1 rounded-full bg-[var(--menu-field-bg)] overflow-hidden" aria-hidden>
                    <div className="h-full w-1/3 rounded-full bg-indigo-600 ws-indeterminate" />
                  </div>
                  {slowSend && <p className="text-[12px] opacity-60 sb-fade">Still working. A first send also sets up your Notes table in Notion, which takes a few seconds longer.</p>}
                </>
              )}
              {run && (
                <>
                  <div className="h-1.5 rounded bg-[var(--menu-field-bg)] overflow-hidden">
                    <div className="h-full bg-indigo-600 transition-all" style={{ width: `${(100 * progress) / Math.max(run.items.length, 1)}%` }} />
                  </div>
                  <ul className="space-y-1 text-[13px]">
                    {run.items.map((i) => (
                      <li key={i.id} className="flex items-center gap-2">
                        {i.status === "done" ? <CheckCircle2 size={13} className="text-emerald-600" />
                          : i.status === "failed" || i.status === "needs_you" ? <XCircle size={13} className="text-rose-600" />
                          : <Loader2 size={13} className={i.status === "running" ? "animate-spin" : "opacity-30"} />}
                        <span className="truncate">{i.title || i.local_id}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[12px] opacity-60">You can close this. It keeps running in the background; progress is in Settings → Notion → Activity.</p>
                </>
              )}
            </div>
          )}

          {top === "send" && phase === "done" && (
            <section aria-label="Result" aria-live="polite" className="space-y-3 sb-fade" data-testid="notion-result">
              {finalItems.length === 0 ? (
                <p>Nothing to send: this is already in sync ✓</p>
              ) : single ? (
                single.status === "done" ? (
                  <div className="text-center pt-1 space-y-1">
                    <span className="mx-auto w-10 h-10 rounded-full grid place-items-center bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"><CheckCircle2 size={22} /></span>
                    <p className="text-[15px] font-semibold">{single.action === "update" ? "Updated in Notion" : "Sent to Notion"}</p>
                    <p className="text-[12px] opacity-60">{single.action === "update" ? "The page in Notion now matches this note." : `This note is now a page in ${conn?.root?.title ?? "Notion"}.`}</p>
                  </div>
                ) : (
                  <p role="alert" className="rounded-md px-3 py-2 text-[13px] bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">{single.message}</p>
                )
              ) : (
                <p className="font-medium">✓ {done.length} sent to Notion{problems.length ? ` · ${problems.length} with a problem` : ""}</p>
              )}
              {single && urlOf(single.local_id) && single.status === "done" && (
                <a href={urlOf(single.local_id)!} target="_blank" rel="noreferrer"
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium bg-indigo-600 text-white hover:bg-indigo-700">
                  Open in Notion <ExternalLink size={13} />
                </a>
              )}
              {!single && finalItems.length > 0 && (
                <ul className="space-y-1.5 text-[13px]">
                  {finalItems.map((i) => (
                    <li key={i.id} className="flex items-start gap-2">
                      {i.status === "done" ? <CheckCircle2 size={14} className="mt-0.5 text-emerald-600" /> : <XCircle size={14} className="mt-0.5 text-rose-600" />}
                      <span className="min-w-0 flex-1"><span className="font-medium">{i.title || i.local_id}</span>
                        {i.status !== "done" && i.message ? <span className="block opacity-70">{i.message}</span> : null}</span>
                      {i.status === "done" && urlOf(i.local_id) && (
                        <a href={urlOf(i.local_id)!} target="_blank" rel="noreferrer" aria-label={`Open ${i.title} in Notion`}
                          className="text-indigo-600 dark:text-indigo-400"><ExternalLink size={13} /></a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {problems.some((p) => p.status === "failed") && (
                <Button size="sm" variant="primary" onClick={retryFailed}>Retry failed</Button>
              )}
              <p className="text-[12px] opacity-60 text-center">
                <Link href="/brain/settings/notion?tab=activity" onClick={onOpenSettings} className="underline">See the Activity</Link>
              </p>
            </section>
          )}
        </div>

        {top === "send" && (phase === "review" || phase === "done" || phase === "sending") && (
        <footer className="shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 border-t border-[color:var(--menu-divider)]">
          <span className="text-[12px] opacity-60">
            {phase === "review" && sendable.length > 0 && plan
              ? `${sendable.length} item${sendable.length === 1 ? "" : "s"} · about ${sendable.reduce((n, i) => n + i.est_requests, 0)} requests`
              : ""}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={!canClose}>
              {phase === "done" ? "Close" : "Cancel"}
            </Button>
            {phase === "review" && sendable.length > 0 && (
              <Button size="sm" variant="primary" onClick={send} className="whitespace-nowrap">
                {sendable.length === 1 ? "Send" : `Send ${sendable.length} items`}
              </Button>
            )}
          </div>
        </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
