"use client";

// Health: last success, failing items, rate-limit waits, the daily canary, the pinned API version,
// the kill switch, and the local backup.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
    notionApi.health().then(setH).catch((e) => setError(e.message));
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

  return (
    <section id="health" aria-label="Health" className="space-y-4">
      <h2 className="font-semibold">Health</h2>
      {error && <p role="alert" className="text-[13px] text-rose-600">{error}</p>}
      {h && (
        <dl className="grid grid-cols-[10rem_1fr] gap-y-1.5 text-[13px]" data-testid="health">
          <dt className="text-gray-500">Last successful send</dt><dd>{ago(h.last_ok_at)}</dd>
          <dt className="text-gray-500">Failing items</dt><dd className={h.failing ? "text-rose-600" : ""}>{h.failing}</dd>
          <dt className="text-gray-500">Rate-limit waits</dt><dd>{h.rate_limit_waits_recent} (recent runs)</dd>
          <dt className="text-gray-500">Notion API version</dt><dd>{h.api_version} (pinned)</dd>
          <dt className="text-gray-500">Daily check</dt>
          <dd data-testid="canary">{h.canary ? (h.canary.ok ? `✓ passed ${ago(h.canary.when)}` : `✗ ${h.canary.failed.length} check(s) failed ${ago(h.canary.when)}: ${h.canary.failed.join("; ")}`) : "not set up (run python -m evals.notion_canary daily)"}</dd>
          <dt className="text-gray-500">Connection</dt><dd className={h.token_problem ? "text-rose-600" : ""}>{h.token_problem ? "Notion disconnected this app: reconnect above" : h.status}</dd>
        </dl>
      )}
      <div className="rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium">Pause all syncing</div>
            <div className="text-[12px] text-gray-500">The kill switch: nothing is sent until you resume. It takes effect before the next request.</div>
          </div>
          <Button size="sm" variant={paused ? "primary" : "danger"} disabled={busy === "pause"} onClick={pauseResume}>
            {paused ? "Resume syncing" : "Pause all syncing"}
          </Button>
        </div>
      </div>
      <div className="rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-2" id="backup">
        <div className="text-[13px] font-medium">Local backup</div>
        <p className="text-[12px] text-gray-500">
          A backup file on this computer, readable without the app and without Notion. It includes private notes, so keep it where you keep them.
          {bk && <> Folder: <code>{bk.folder}</code>. Daily backups are {bk.enabled ? "on" : "off (set BACKUP_ENABLED=true in backend/.env to turn them on)"}.</>}
        </p>
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" disabled={busy === "backup"} onClick={backup}>{busy === "backup" ? "Backing up…" : "Back up now"}</Button>
          {msg && <span className="text-[12px] text-emerald-700 dark:text-emerald-300" role="status">{msg}</span>}
        </div>
        {bk && bk.archives.length > 0 && (
          <ul className="text-[12px] text-gray-500 space-y-0.5">
            {bk.archives.slice(0, 5).map((a) => <li key={a.name}>{a.name} · {size(a.bytes)}</li>)}
          </ul>
        )}
      </div>
    </section>
  );
}
