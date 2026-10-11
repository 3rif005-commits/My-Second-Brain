"use client";

// The two set-up steps (paste the token, pick the page) inside the review panel, so sending ONE note never
// sends you to Settings. When both are done the panel carries on with the note you started from.
import { useEffect, useState } from "react";
import { ExternalLink, Info, Loader2 } from "lucide-react";
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
    <div className="space-y-4 sb-fade" data-testid="notion-not-connected">
      {error && <p role="alert" className="rounded-md px-3 py-2 text-[12px] bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">{error}</p>}
      {!status.connected ? (
        <section aria-label="Connect Notion" className="space-y-4">
          <div className="text-center pt-1">
            <p className="text-[15px] font-semibold">Connect Notion</p>
            <p className="text-[12px] opacity-60 mt-0.5">Send notes to a Notion page you choose. One time only.</p>
          </div>
          <ol className="space-y-2.5 text-[12px]">
            {[
              <>Create an <em>Internal</em> integration at <a className="underline underline-offset-2 inline-flex items-center gap-0.5" href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer">notion.so/profile/integrations<ExternalLink size={10} /></a> and copy its token.</>,
              <>In Notion open the page to send under, then <em>•••</em> → <em>Connections</em> → add your integration.</>,
            ].map((t, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="w-[18px] h-[18px] mt-px shrink-0 rounded-full grid place-items-center text-[10px] font-semibold bg-[var(--menu-field-bg)]">{i + 1}</span>
                <span className="opacity-80 leading-snug">{t}</span>
              </li>
            ))}
          </ol>
          <form onSubmit={connect} className="space-y-2">
            <input id="notion-token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your integration token" aria-label="Notion token"
              className="w-full h-9 px-3 rounded-lg border border-[color:var(--menu-divider)] bg-transparent text-[13px] font-mono outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25" />
            <button type="submit" disabled={busy || token.trim().length < 8}
              className="w-full h-9 rounded-lg text-[13px] font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 grid place-items-center">
              {busy ? <Loader2 size={14} className="animate-spin" /> : "Connect"}
            </button>
          </form>
          <p className="flex gap-2 text-[11.5px] opacity-60 leading-snug"><Info size={13} className="shrink-0 mt-px" />
            The token is encrypted before it is stored and is never shown again.</p>
        </section>
      ) : (
        <section aria-label="Choose a page" className="space-y-2">
          <div className="text-center pt-1">
            <p className="text-[15px] font-semibold">Choose where notes go</p>
            <p className="text-[12px] opacity-60 mt-0.5"><span className="text-emerald-600 dark:text-emerald-400">●</span> Connected to {status.workspace_name ?? "Notion"}</p>
          </div>
          {pages === null ? <div className="h-8 rounded-md animate-pulse bg-[var(--menu-field-bg)]" />
            : pages.length === 0 ? (
              <p className="text-[12px] rounded-md px-3 py-2 bg-amber-50 dark:bg-amber-500/10" data-testid="no-pages">
                No page is shared with the integration yet. In Notion open a page → <em>•••</em> → <em>Connections</em> → add it, then{" "}
                <button className="underline" onClick={refresh}>check again</button>.
              </p>
            ) : (
              <ul className="-mx-1 max-h-56 overflow-y-auto">
                {pages.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => choose(p)} disabled={busy}
                      className="w-full flex items-center gap-2.5 px-2 h-9 rounded-md text-left text-[13px] hover:bg-[var(--menu-row-hover-bg)] disabled:opacity-60">
                      <span aria-hidden className="w-5 text-center">{p.icon ?? "📄"}</span><span className="flex-1 truncate">{p.title}</span>
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
