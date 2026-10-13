"use client";

// The "Sync" tab of the Notion popover: the same row-with-a-switch look as Notion's own ••• menu.
// One note, folder or database at a time: keep it in sync automatically, pause it, jump to Notion / Activity.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ChevronRight, ExternalLink, PauseCircle, RefreshCw } from "lucide-react";
import { announceNotionChange, notionApi, type NoteMirror, type Rule, type Scope } from "@/lib/notion";

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative shrink-0 w-[30px] h-[18px] rounded-full transition-colors disabled:opacity-50 ${on ? "bg-accent-600" : "bg-black/15 dark:bg-white/20"}`}>
      <span className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${on ? "translate-x-3" : ""}`} />
    </button>
  );
}

/** The one thing the scope points at, or null when it is several things (then there is nothing to switch on). */
function targetOf(scope: Scope): { kind: "note" | "collection" | "database"; id: string } | null {
  const one = (a?: string[]) => (a && a.length === 1 ? a[0] : null);
  const only = [scope.note_ids, scope.collection_ids, scope.database_ids].filter((a) => a && a.length).length;
  if (only !== 1 || scope.all || scope.thread_ids?.length || scope.skill_names?.length) return null;
  const n = one(scope.note_ids), c = one(scope.collection_ids), d = one(scope.database_ids);
  return n ? { kind: "note", id: n } : c ? { kind: "collection", id: c } : d ? { kind: "database", id: d } : null;
}

export function SyncTab({ scope, onNavigate }: { scope: Scope; onNavigate?: () => void }) {
  const target = targetOf(scope);
  const [rule, setRule] = useState<Rule | null | undefined>(undefined);
  const [mirror, setMirror] = useState<NoteMirror | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    notionApi.rules().then((r) => setRule(r.rules.find((x) => x.scope_kind === target.kind && x.scope_id === target.id) ?? null)).catch(() => setRule(null));
    if (target.kind === "note") notionApi.note(target.id).then(setMirror).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.kind, target?.id]);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); announceNotionChange(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const setAuto = (on: boolean) => run(async () => {
    if (!target) return;
    if (on) setRule(await notionApi.addRule({ scope_kind: target.kind, scope_id: target.id, mode: "on_change" }));
    else if (rule) { await notionApi.deleteRule(rule.id); setRule(null); }
  });
  const setPaused = (paused: boolean) => run(async () => {
    if (target?.kind !== "note") return;
    await notionApi.pauseNote(target.id, paused);
    setMirror((m) => (m ? { ...m, paused } : m));
  });

  const row = "flex items-center gap-3 px-1 min-h-[40px] py-1 rounded-md";
  const word = target?.kind === "collection" ? "folder" : target?.kind ?? "note";
  return (
    <div className="space-y-1 sb-fade" data-testid="notion-sync-tab">
      {error && <p role="alert" className="rounded-md px-3 py-2 text-[12px] bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">{error}</p>}
      {!target ? (
        <p className="text-[13px] opacity-70 py-2">Automatic sync is set per note, folder or database. Open the menu on one of them to turn it on.</p>
      ) : (
        <>
          <div className={row}>
            <RefreshCw size={15} className="opacity-70 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[13px]">Keep this {word} in sync</div>
              <div className="text-[12px] opacity-60 leading-snug">Sends changes about 10 minutes after you stop editing. Never sends private notes.</div>
            </div>
            <Switch on={!!rule} onChange={setAuto} label={`Keep this ${word} in sync`} disabled={busy || rule === undefined} />
          </div>
          {target.kind === "note" && (
            <div className={row}>
              <PauseCircle size={15} className="opacity-70 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px]">Pause for this note</div>
                <div className="text-[12px] opacity-60 leading-snug">Nothing is sent until you turn this off.</div>
              </div>
              <Switch on={!!mirror?.paused} onChange={setPaused} label="Pause for this note" disabled={busy || !mirror} />
            </div>
          )}
          <div className="h-px my-1 bg-[color:var(--menu-divider)]" />
          {mirror?.notion_url && (
            <a href={mirror.notion_url} target="_blank" rel="noreferrer" className={`${row} text-[13px] hover:bg-[var(--menu-row-hover-bg)]`}>
              <ExternalLink size={15} className="opacity-70 shrink-0" /><span className="flex-1">Open in Notion</span>
            </a>
          )}
        </>
      )}
      <Link href="/brain/settings/notion?tab=activity" onClick={onNavigate}
        className={`${row} text-[13px] hover:bg-[var(--menu-row-hover-bg)]`}>
        <Activity size={15} className="opacity-70 shrink-0" /><span className="flex-1">Activity and health</span><ChevronRight size={14} className="opacity-50" />
      </Link>
    </div>
  );
}
