"use client";

// Settings → Notion (DESIGN §7.4): connect with an internal-connection token,
// pick the one page everything is sent under, disconnect. Push only: nothing
// is ever read back into Second Brain.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Circle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import {
  Button, ConfirmDialog, Input, SettingsPage, SettingsRow, SettingsSection, Skeleton, cx,
} from "@/components/ui";
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
    <div>
      <SettingsPage
        title="Notion"
        description="Send notes to Notion as a one-way mirror. Second Brain stays the source of truth; nothing is read back."
      >
        {error && (
          <p role="alert" className="rounded-md bg-surface-danger-soft px-3 py-2 text-[13px] text-ink-danger">{error}</p>
        )}

        {status === null && !error && <Skeleton rows={3} />}

        {status && !status.connected && (
          <SettingsSection title="Connect Notion">
            <ol className="flex list-decimal flex-col gap-5 pl-5 text-sm text-ink" data-testid="notion-empty">
              <li className="flex flex-col gap-1">
                <strong className="font-medium">Create an internal connection in Notion.</strong>
                <p className="text-[13px] leading-[18px] text-ink-secondary">
                  Open{" "}
                  <a className="inline-flex items-center gap-1 text-accent hover:underline"
                    href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer">
                    notion.so/profile/integrations <ExternalLink size={11} />
                  </a>
                  , choose <em>New integration</em> → <em>Internal</em>, keep only the read, update and insert
                  content permissions, then copy its token.
                </p>
              </li>
              <li className="flex flex-col gap-2">
                <strong className="font-medium">Paste the token.</strong>
                <form onSubmit={connect} className="flex max-w-[480px] gap-2">
                  <Input type="password" autoComplete="off" spellCheck={false} value={token} inputSize="lg"
                    onChange={(e) => setToken(e.target.value)} placeholder="ntn_…" aria-label="Notion token"
                    className="font-mono" />
                  <Button type="submit" size="md" disabled={busy || token.trim().length < 8}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : "Connect"}
                  </Button>
                </form>
                <p className="text-[12px] text-ink-tertiary">
                  The token is encrypted before it is stored and is never shown again, only its last 4 characters.
                </p>
              </li>
            </ol>
          </SettingsSection>
        )}

        {status?.connected && (
          <>
            <SettingsSection title="Connection">
              <div data-testid="notion-connected">
                <SettingsRow
                  label={
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 size={15} className="text-emerald-500" /> Connected to {status.workspace_name ?? "Notion"}
                    </span>
                  }
                  help={`Token ${status.token_hint}`}
                >
                  <Button variant="danger" disabled={busy} onClick={() => setConfirmDisconnect(true)}>Disconnect</Button>
                </SettingsRow>
              </div>
              {status.status === "error" && (
                <p role="alert" className="rounded-md bg-surface-danger-soft px-3 py-2 text-[13px] text-ink-danger">
                  Notion disconnected this app. Disconnect, then paste a fresh token to reconnect: your notes and what was sent are kept.
                </p>
              )}
            </SettingsSection>

            <SettingsSection
              title="Where to send"
              description="Everything is sent under one page you share with the connection."
              actions={<Button variant="ghost" icon={<RefreshCw />} onClick={refreshPages}>Refresh</Button>}
            >
              {!status.root && pages && pages.length > 0 && (
                <p className="rounded-md bg-accent-chip px-3 py-2 text-[13px] text-ink" data-testid="pick-root">
                  Pick the page to send under. What to send, auto-sync and activity appear once you pick one.
                </p>
              )}
              {pages === null ? <Skeleton rows={3} />
                : pages.length === 0 ? (
                  <p className="text-[13px] text-ink-secondary" data-testid="no-pages">
                    No pages are shared with this connection yet. In Notion, open the page → <em>•••</em> →{" "}
                    <em>Connections</em> → add your connection, then Refresh.
                  </p>
                ) : (
                  <ul role="radiogroup" aria-label="Destination page"
                    className="-mt-2 max-h-[280px] divide-y divide-line overflow-y-auto rounded-lg border border-line">
                    {pages.map((p) => {
                      const on = status.root?.id === p.id;
                      return (
                        <li key={p.id}>
                          <button role="radio" aria-checked={on} onClick={() => chooseRoot(p)} disabled={busy}
                            className={cx(
                              "flex h-10 w-full items-center gap-2.5 px-3 text-left text-sm text-ink disabled:opacity-60",
                              on ? "bg-surface-active" : "hover:bg-surface-hover",
                            )}>
                            {on
                              ? <CheckCircle2 size={16} className="shrink-0 text-accent" />
                              : <Circle size={16} className="shrink-0 text-ink-icon-subtle" />}
                            <span aria-hidden>{p.icon ?? "📄"}</span>
                            <span className="flex-1 truncate">{p.title}</span>
                            {on && <span className="text-[12px] text-ink-secondary">Sending here</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              {status.root && (
                <a href={status.root.url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 self-start text-[13px] text-accent hover:underline">
                  Open “{status.root.title ?? "destination"}” in Notion <ExternalLink size={12} />
                </a>
              )}
            </SettingsSection>

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
      </SettingsPage>

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
