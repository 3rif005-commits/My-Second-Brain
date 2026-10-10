"use client";

// The two set-up steps (paste the token, pick the page) inside the review panel, so sending ONE note never
// sends you to Settings. When both are done the panel carries on with the note you started from.
import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { notionApi, type NotionPage, type NotionStatus } from "@/lib/notion";

interface Props {
  status: NotionStatus;
  /** Called with the new status once the token is saved, and again once a destination page is chosen. */
  onChange: (s: NotionStatus) => void;
}

export function ConnectInline({ status, onChange }: Props) {
  const [token, setToken] = useState("");
  const [pages, setPages] = useState<NotionPage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await notionApi.connect(token.trim());
      setToken(""); setPages(r.pages); onChange(r);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function refresh() {
    setError(null);
    try { setPages((await notionApi.pages()).pages); } catch (err) { setError((err as Error).message); }
  }
  async function choose(p: NotionPage) {
    setBusy(true); setError(null);
    try { onChange(await notionApi.setRoot(p.id)); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  // Connected already (token saved, no page chosen yet): list the pages.
  useEffect(() => { if (status.connected && pages === null) void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4" data-testid="notion-not-connected">
      {error && <p role="alert" className="rounded-md px-3 py-2 text-[13px] bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">{error}</p>}
      {!status.connected ? (
        <section aria-label="Connect Notion" className="space-y-3">
          <p className="font-medium">Connect Notion once, then this note is sent.</p>
          <ol className="list-decimal pl-5 space-y-1 text-[13px] opacity-80">
            <li>Open <a className="underline inline-flex items-center gap-1" href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer">notion.so/profile/integrations <ExternalLink size={11} /></a>, choose <em>New integration</em> → <em>Internal</em>, and copy its token.</li>
            <li>In Notion, open the page you want notes under → <em>•••</em> → <em>Connections</em> → add your integration.</li>
            <li>Paste the token here.</li>
          </ol>
          <form onSubmit={connect} className="flex gap-2">
            <input type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)}
              placeholder="ntn_…" aria-label="Notion token"
              className="flex-1 h-9 px-3 rounded-md border border-[color:var(--menu-divider)] bg-transparent text-[13px] font-mono" />
            <Button type="submit" size="sm" variant="primary" disabled={busy || token.trim().length < 8}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : "Connect"}
            </Button>
          </form>
          <p className="text-[12px] opacity-60">The token is encrypted before it is stored and never shown again.</p>
        </section>
      ) : (
        <section aria-label="Choose a page" className="space-y-3">
          <p className="font-medium">Connected to {status.workspace_name ?? "Notion"}. Where should notes go?</p>
          {pages === null ? <div className="h-10 rounded-md animate-pulse bg-[var(--menu-field-bg)]" />
            : pages.length === 0 ? (
              <p className="text-[13px] rounded-md px-3 py-2 bg-amber-50 dark:bg-amber-500/10" data-testid="no-pages">
                No page is shared with the integration yet. In Notion open a page → <em>•••</em> → <em>Connections</em> → add it, then{" "}
                <button className="underline" onClick={refresh}>check again</button>.
              </p>
            ) : (
              <ul className="rounded-lg border border-[color:var(--menu-divider)] divide-y divide-[color:var(--menu-divider)]">
                {pages.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => choose(p)} disabled={busy}
                      className="w-full flex items-center gap-2 px-3 h-10 text-left hover:bg-[var(--menu-row-hover-bg)] disabled:opacity-60">
                      <span aria-hidden>{p.icon ?? "📄"}</span><span className="flex-1 truncate">{p.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </section>
      )}
    </div>
  );
}
