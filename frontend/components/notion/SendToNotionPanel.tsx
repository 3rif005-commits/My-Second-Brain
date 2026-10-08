"use client";

// "Send to Notion…" review panel (DESIGN §7.2): the dry run first, then Send,
// then the result with "Open in Notion ↗". Esc / backdrop = cancel, never send.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ExternalLink, Loader2, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { notionApi, type Plan, type PlanItem, type SendResult, type NotionStatus } from "@/lib/notion";
import { FidelityPill } from "./NotionPill";

const STATE_WORD: Record<string, string> = {
  new: "New in Notion", changed: "Changed since the last send", unchanged: "Already up to date",
  private: "Private: stays on this device", paused: "Mirroring is paused for this note",
  missing: "This note could not be found",
};

interface Props { noteId: string; onClose: () => void; onSent?: (r: SendResult) => void }

export function SendToNotionPanel({ noteId, onClose, onSent }: Props) {
  const [conn, setConn] = useState<NotionStatus | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [released, setReleased] = useState(false);
  const [phase, setPhase] = useState<"loading" | "review" | "sending" | "done">("loading");
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (release: boolean) => {
    setPhase("loading"); setError(null);
    try {
      const s = await notionApi.status(true);
      setConn(s);
      if (s.connected && s.root) setPlan(await notionApi.plan([noteId], release ? [noteId] : []));
      setPhase("review");
    } catch (e) { setError((e as Error).message); setPhase("review"); }
  }, [noteId]);

  useEffect(() => { void load(false); }, [load]);
  useEffect(() => { panelRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && phase !== "sending") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, phase]);

  async function send() {
    setPhase("sending"); setError(null);
    try {
      const r = await notionApi.send([noteId], released ? [noteId] : []);
      setResult(r); setPhase("done"); onSent?.(r);
    } catch (e) { setError((e as Error).message); setPhase("review"); }
  }

  const item: PlanItem | undefined = plan?.items[0];
  const ready = conn?.connected && conn.root;
  const canSend = !!item && (item.state === "new" || item.state === "changed");
  const r0 = result?.items[0];

  return createPortal(
    <div className="fixed inset-0 z-[9998] flex justify-end bg-black/30"
      onClick={(e) => { if (e.target === e.currentTarget && phase !== "sending") onClose(); }}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="notion-panel-title"
        className="w-full sm:w-[483px] h-full flex flex-col outline-none shadow-2xl
          bg-[var(--menu-bg)] text-[color:var(--menu-fg)] border-l border-[color:var(--menu-divider)]">
        <header className="flex items-center justify-between px-5 h-12 shrink-0 border-b border-[color:var(--menu-divider)]">
          <h2 id="notion-panel-title" className="text-[15px] font-semibold">Send to Notion</h2>
          <button onClick={onClose} aria-label="Close" disabled={phase === "sending"}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--menu-row-hover-bg)]">
            <X size={15} />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4 text-[14px]">
          {phase === "loading" && (
            <div className="space-y-2" aria-busy="true" data-testid="notion-loading">
              {[0, 1, 2].map((i) => <div key={i} className="h-10 rounded-md animate-pulse bg-[var(--menu-field-bg)]" />)}
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-md px-3 py-2 text-[13px] bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
              {error}
            </p>
          )}

          {phase !== "loading" && conn && !ready && (
            <div className="space-y-3" data-testid="notion-not-connected">
              <p>{conn.connected
                ? "Pick the Notion page to send to, then come back."
                : "Notion isn't connected yet. It takes about a minute: you paste a token and choose one page."}</p>
              <Link href="/brain/settings/notion"
                className="inline-flex h-8 items-center px-3 rounded-md text-[13px] font-medium bg-indigo-600 text-white hover:bg-indigo-700">
                Open Settings → Notion
              </Link>
            </div>
          )}

          {phase === "review" && ready && item && (
            <>
              <section aria-label="Destination" className="space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-widest opacity-60">Destination</div>
                <p>
                  <span className="opacity-70">{conn?.workspace_name} › </span>
                  <strong>{conn?.root?.title ?? "your Notion page"}</strong>
                  <span className="opacity-70"> › Notes (database)</span>
                </p>
                <p className="text-[12px] opacity-60">
                  Sends the last saved version. Notes without a collection go to the Notes database; folders come later.
                </p>
              </section>

              <section aria-label="Preview" className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-widest opacity-60">Preview</div>
                <div className="rounded-lg border border-[color:var(--menu-divider)] p-3 space-y-2" data-testid="notion-item">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{item.title}</div>
                      <div className="text-[12px] opacity-70">{STATE_WORD[item.state]}</div>
                    </div>
                    {(item.state === "new" || item.state === "changed" || item.state === "unchanged") && (
                      <FidelityPill fidelity={item.fidelity} losses={item.losses.length} />
                    )}
                  </div>
                  {item.losses.length > 0 && (
                    <ul className="text-[13px] space-y-1.5 pt-1 border-t border-[color:var(--menu-divider)]">
                      {item.losses.map((l, i) => (
                        <li key={i}><span className="opacity-90">{l.what}</span>{" "}
                          <span className="opacity-60">{l.fallback}</span></li>
                      ))}
                    </ul>
                  )}
                </div>

                {item.state === "private" && (
                  <div className="rounded-lg px-3 py-2.5 text-[13px] bg-amber-50 dark:bg-amber-500/10 space-y-2">
                    <p className="flex items-center gap-1.5 font-medium"><Lock size={13} /> This note is private</p>
                    <p className="opacity-80">Private notes never leave this device unless you let this one through, once.</p>
                    <Button size="sm" variant="ghost" onClick={() => { setReleased(true); void load(true); }}>
                      Send once anyway
                    </Button>
                  </div>
                )}
                {released && item.released && (
                  <p className="text-[12px] text-amber-700 dark:text-amber-300">Released for this send only.</p>
                )}
                {item.state === "unchanged" && (
                  <p data-testid="nothing-to-send" className="text-[14px]">
                    Nothing to send: this note is already in sync ✓
                  </p>
                )}
              </section>
            </>
          )}

          {phase === "sending" && (
            <p className="flex items-center gap-2" role="status"><Loader2 size={15} className="animate-spin" /> Sending to Notion…</p>
          )}

          {phase === "done" && result && (
            <section aria-label="Result" className="space-y-3" data-testid="notion-result">
              {r0?.status === "done" ? (
                <p className="font-medium">✓ {r0.action === "update" ? "Updated" : "Sent"} to Notion
                  {r0.losses.length > 0 && <span className="font-normal opacity-70"> · {r0.losses.length} approximated or lost</span>}</p>
              ) : r0 ? (
                <p role="alert" className="rounded-md px-3 py-2 text-[13px] bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                  {r0.message}</p>
              ) : <p>Nothing to send: this note is already in sync ✓</p>}
              {r0?.notion_url && (
                <a href={r0.notion_url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-[14px] text-indigo-600 dark:text-indigo-400 hover:underline">
                  Open in Notion <ExternalLink size={13} />
                </a>
              )}
            </section>
          )}
        </div>

        <footer className="shrink-0 flex items-center justify-between gap-3 px-5 h-14 border-t border-[color:var(--menu-divider)]">
          <span className="text-[12px] opacity-60">
            {phase === "review" && canSend && plan ? `About ${plan.est_requests} requests` : ""}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={phase === "sending"}>
              {phase === "done" ? "Close" : "Cancel"}
            </Button>
            {phase === "review" && canSend && (
              <Button size="sm" variant="primary" onClick={send}>Send</Button>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
