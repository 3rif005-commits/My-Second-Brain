"use client";

// Settings → Notion (DESIGN §7.4): connect with an internal-connection token,
// pick the one page everything is sent under, disconnect. Push only: nothing
// is ever read back into Second Brain.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/app/providers";
import { notionApi, type NotionPage, type NotionStatus } from "@/lib/notion";
import { useNotion } from "@/context/NotionContext";
import { MirrorSection } from "@/components/notion/settings/MirrorSection";
import { RulesSection } from "@/components/notion/settings/RulesSection";
import { ActivitySection } from "@/components/notion/settings/ActivitySection";
import { HealthSection } from "@/components/notion/settings/HealthSection";

export default function NotionSettingsPage() {
  return <Suspense fallback={null}><NotionSettings /></Suspense>;
}

function NotionSettings() {
  const { showToast } = useToast();
  const notion = useNotion();
  const params = useSearchParams();
  const [status, setStatus] = useState<NotionStatus | null>(null);
  const [pages, setPages] = useState<NotionPage[] | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [pendingRoot, setPendingRoot] = useState<NotionPage | null>(null);

  const refreshPages = useCallback(async () => {
    setError(null);
    try { setPages((await notionApi.pages()).pages); } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => {
    notionApi.status(true).then((s) => {
      setStatus(s);
      if (s.connected) void refreshPages();
    }).catch((e) => setError(e.message));
  }, [refreshPages]);

  // ?tab=activity (from the panel, ⌘P, the bell) scrolls to that section once it is on the page
  useEffect(() => {
    const t = params?.get("tab");
    if (t && status?.connected) document.getElementById(t)?.scrollIntoView({ block: "start" });
  }, [params, status?.connected]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await notionApi.connect(token.trim());
      setToken("");
      setStatus(r); setPages(r.pages);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function chooseRoot(p: NotionPage, force = false) {
    if (!force && status?.root && status.root.id !== p.id) { setPendingRoot(p); return; }
    setBusy(true); setError(null);
    try {
      const r = await notionApi.setRoot(p.id);
      setStatus(r);
      showToast(r.forgotten_mappings
        ? `Destination changed. ${r.forgotten_mappings} note(s) will be sent again to the new page.`
        : "Destination saved.", "info");
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); setPendingRoot(null); }
  }

  async function disconnect() {
    setConfirmDisconnect(false); setBusy(true);
    try {
      const r = await notionApi.disconnect();
      setStatus({ connected: false }); setPages(null);
      showToast(r.reminder, "info");
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="w-full space-y-8 text-[14px] text-gray-800 dark:text-gray-200">
        <header>
          <h1 className="text-[26px] font-semibold leading-8 text-ink">Notion</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Send notes to Notion as a one-way mirror. Second Brain stays the source of truth; nothing is read back.
          </p>
        </header>

        {error && (
          <p role="alert" className="rounded-md px-3 py-2 text-[13px] bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
            {error}
          </p>
        )}

        {status === null && !error && <div className="h-24 rounded-lg animate-pulse bg-gray-50 dark:bg-white/5" />}

        {status && !status.connected && (
          <section aria-label="Connect Notion" className="space-y-5" data-testid="notion-empty">
            <ol className="space-y-4 list-decimal pl-5">
              <li className="space-y-1">
                <strong>Create an internal connection in Notion.</strong>
                <p className="text-gray-500 dark:text-gray-400">
                  Open{" "}
                  <a className="text-accent-600 dark:text-accent-400 hover:underline inline-flex items-center gap-1"
                    href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer">
                    notion.so/profile/integrations <ExternalLink size={11} />
                  </a>
                  , choose <em>New integration</em> → <em>Internal</em>, keep only the read, update and insert
                  content permissions, then copy its token.
                </p>
              </li>
              <li className="space-y-2">
                <strong>Paste the token.</strong>
                <form onSubmit={connect} className="flex gap-2">
                  <input type="password" autoComplete="off" spellCheck={false} value={token}
                    onChange={(e) => setToken(e.target.value)} placeholder="ntn_…" aria-label="Notion token"
                    className="flex-1 h-9 px-3 rounded-md border border-gray-200 dark:border-white/15 bg-transparent text-[13px] font-mono" />
                  <Button type="submit" variant="primary" size="sm" disabled={busy || token.trim().length < 8}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : "Connect"}
                  </Button>
                </form>
                <p className="text-[12px] text-gray-500">
                  The token is encrypted before it is stored and is never shown again, only its last 4 characters.
                </p>
              </li>
            </ol>
          </section>
        )}

        {status?.connected && (
          <>
            <section aria-label="Connection" className="rounded-lg border border-gray-200 dark:border-white/10 p-4 space-y-3"
              data-testid="notion-connected">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5 font-medium">
                    <CheckCircle2 size={15} className="text-emerald-500" /> Connected to {status.workspace_name ?? "Notion"}
                  </div>
                  <div className="text-[12px] text-gray-500 mt-0.5">Token {status.token_hint}</div>
                </div>
                <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirmDisconnect(true)}>
                  Disconnect
                </Button>
              </div>
            </section>

            <section aria-label="Destination" className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="mb-4 border-b border-line pb-3 text-base font-medium text-ink">Where to send</h2>
                <Button variant="ghost" size="sm" onClick={refreshPages}><RefreshCw size={13} /> Refresh</Button>
              </div>
              <p className="text-gray-500 dark:text-gray-400 text-[13px]">
                Everything is sent under one page you share with the connection. If the list is empty, open the page in
                Notion → <em>•••</em> → <em>Connections</em> → add your connection, then Refresh.
              </p>
              {pages === null ? <div className="h-10 rounded-md animate-pulse bg-gray-50 dark:bg-white/5" />
                : pages.length === 0 ? (
                  <p className="text-[13px] rounded-md px-3 py-2 bg-amber-50 dark:bg-amber-500/10" data-testid="no-pages">
                    No pages are shared with this connection yet.
                  </p>
                ) : (
                  <ul className="rounded-lg border border-gray-200 dark:border-white/10 divide-y divide-gray-100 dark:divide-white/10">
                    {pages.map((p) => {
                      const on = status.root?.id === p.id;
                      return (
                        <li key={p.id}>
                          <button onClick={() => chooseRoot(p)} disabled={busy} aria-pressed={on}
                            className="w-full flex items-center gap-2 px-3 h-10 text-left hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-60">
                            <span aria-hidden>{p.icon ?? "📄"}</span>
                            <span className="flex-1 truncate">{p.title}</span>
                            {on && <span className="text-[12px] text-emerald-600 dark:text-emerald-400">Sending here</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              {status.root && (
                <a href={status.root.url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[13px] text-accent-600 dark:text-accent-400 hover:underline">
                  Open “{status.root.title ?? "destination"}” in Notion <ExternalLink size={12} />
                </a>
              )}
            </section>
            {status.status === "error" && (
              <p role="alert" className="rounded-md px-3 py-2 text-[13px] bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                Notion disconnected this app. Paste a fresh token above (disconnect first) to reconnect: your notes and what was sent are kept.
              </p>
            )}
            {status.root && (
              <>
                <MirrorSection />
                <RulesSection />
                <ActivitySection />
              </>
            )}
            <HealthSection paused={status.status === "paused"} onChanged={() => { notionApi.status(true).then(setStatus).catch(() => {}); notion.refresh(); }} />
          </>
        )}
      </div>

      <ConfirmDialog open={confirmDisconnect} title="Disconnect Notion?"
        description="The stored token is deleted and the record of what was sent is forgotten. Pages already in Notion stay. Also remove the connection in Notion to revoke the token there."
        confirmLabel="Disconnect" onConfirm={disconnect} onCancel={() => setConfirmDisconnect(false)} />
      <ConfirmDialog open={!!pendingRoot} title="Send to a different page?" danger={false}
        description="Notes already sent stay where they are in Notion. They will be sent again, as new pages, to the new destination."
        confirmLabel="Change destination" onConfirm={() => pendingRoot && chooseRoot(pendingRoot, true)}
        onCancel={() => setPendingRoot(null)} />
    </div>
  );
}
