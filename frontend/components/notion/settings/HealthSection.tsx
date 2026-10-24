"use client";

// Health: last success, failing items, rate-limit waits, the daily canary, the pinned API version,
// the kill switch, and the local backup.
import { useCallback, useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button, SettingsRow, SettingsSection, Skeleton } from "@/components/ui";
import { announceNotionChange, backupApi, notionApi, type BackupStatus, type Health } from "@/lib/notion";

function ago(ts: string | null) {
  if (!ts) return "never";
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}
const size = (b: number) => (b > 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function HealthSection({ paused, onChanged }: { paused: boolean; onChanged: () => void }) {
  const [h, setH] = useState<Health | null>(null);
  const [bk, setBk] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    notionApi.health().then((x) => { setH(x); setError(null); }).catch((e) => setError(e.message));
    backupApi.status().then(setBk).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function pauseResume() {
    setBusy("pause");
    try { await (paused ? notionApi.resume() : notionApi.pause()); announceNotionChange(); onChanged(); load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function backup() {
    setBusy("backup"); setMsg(null); setError(null);
    try {
      const r = await backupApi.run();
      setMsg(`Backed up ${r.counts.notes} notes, ${r.counts.databases} databases, ${r.counts.threads} chats (${size(r.bytes)}).`);
      load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  const hosted = !!bk?.hosted;
  return (
    <>
      <SettingsSection id="health" title="Health">
        {!h && !error && <Skeleton rows={3} />}
        {error && <p role="alert" className="text-[13px] text-ink-danger">{error}</p>}
        {h && (
          <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 text-[13px] text-ink" data-testid="health">
            <dt className="text-ink-secondary">Last successful send</dt><dd>{ago(h.last_ok_at)}</dd>
            <dt className="text-ink-secondary">Failing items</dt><dd className={h.failing ? "text-ink-danger" : ""}>{h.failing}</dd>
            <dt className="text-ink-secondary">Rate-limit waits</dt><dd>{h.rate_limit_waits_recent} (recent runs)</dd>
            <dt className="text-ink-secondary">Notion API version</dt><dd>{h.api_version} (pinned)</dd>
            <dt className="text-ink-secondary">Daily check</dt>
            <dd data-testid="canary">{h.canary ? (h.canary.ok ? `✓ passed ${ago(h.canary.when)}` : `✗ ${h.canary.failed.length} check(s) failed ${ago(h.canary.when)}: ${h.canary.failed.join("; ")}`) : "Not set up"}</dd>
            <dt className="text-ink-secondary">Connection</dt><dd className={h.token_problem ? "text-ink-danger" : ""}>{h.token_problem ? "Notion disconnected this app: reconnect above" : h.status}</dd>
          </dl>
        )}
        <SettingsRow label="Pause all syncing" help="The kill switch: nothing is sent until you resume. It takes effect before the next request.">
          <Button variant={paused ? "primary" : "danger"} disabled={busy === "pause"} onClick={pauseResume}>
            {paused ? "Resume syncing" : "Pause all syncing"}
          </Button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection id="backup" title="Backup">
        <SettingsRow
          label={hosted ? "Download a backup" : "Local backup"}
          help={hosted
            ? "One file with your notes, databases and chats, readable without the app and without Notion. It includes private notes, so keep it where you keep them."
            : <>A backup file on this computer, readable without the app and without Notion. It includes private notes, so keep it where you keep them.
              {bk && <> Folder: <code className="[overflow-wrap:anywhere]">{bk.folder}</code>. Daily backups are {bk.enabled ? "on" : "off"}.</>}</>}
        >
          <Button variant="secondary" disabled={busy === "backup"} onClick={backup}>
            {busy === "backup" ? <><Loader2 size={14} className="animate-spin" /> Backing up…</> : hosted ? "Make backup" : "Back up now"}
          </Button>
        </SettingsRow>
        {msg && <p className="text-[13px] text-emerald-600 dark:text-emerald-400" role="status">{msg}</p>}
        {bk && bk.archives.length > 0 && (
          <ul className="-mt-2 flex flex-col gap-1 text-[13px] text-ink-secondary">
            {bk.archives.slice(0, 5).map((a) => (
              <li key={a.name} className="flex items-center gap-2">
                <span className="min-w-0 truncate">{a.name} · {size(a.bytes)}</span>
                <a className="inline-flex shrink-0 items-center gap-1 text-accent hover:underline"
                  href={`/api/ws/backup/${encodeURIComponent(a.name)}`} download={a.name}>
                  <Download size={12} /> Download
                </a>
              </li>
            ))}
          </ul>
        )}
        {hosted && (
          <p className="text-[12px] text-ink-tertiary">
            Download the file to keep it: this server&apos;s disk is wiped every time the app is updated.
          </p>
        )}
      </SettingsSection>
    </>
  );
}
