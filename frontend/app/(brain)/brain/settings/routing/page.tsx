"use client";

// Settings → Routing (routing spec §5.5): where each AI request runs, and which
// notes may travel there. One draft policy is edited across the tabs and saved
// as a new version; Activity shows what the switchboard actually decided.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { History, RotateCcw } from "lucide-react";
import { routingApi, type Policy, type PolicyResponse, type Targets } from "@/lib/routing";
import { TargetsTab } from "@/components/settings/routing/TargetsTab";
import { RulesTab } from "@/components/settings/routing/RulesTab";
import { InstructionsTab } from "@/components/settings/routing/InstructionsTab";
import { PrivacyTab } from "@/components/settings/routing/PrivacyTab";
import { ActivityTab } from "@/components/settings/routing/ActivityTab";

const TABS = [
  { id: "targets", label: "Targets" },
  { id: "rules", label: "Rules" },
  { id: "instructions", label: "Brain & instructions" },
  { id: "privacy", label: "Privacy" },
  { id: "activity", label: "Activity" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// useSearchParams needs a Suspense boundary to build.
export default function RoutingSettingsPage() {
  return <Suspense fallback={null}><RoutingSettings /></Suspense>;
}

function RoutingSettings() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = (TABS.find((t) => t.id === params?.get("tab"))?.id ?? "targets") as TabId;
  const [tab, setTab] = useState<TabId>(initial);
  const [meta, setMeta] = useState<PolicyResponse | null>(null);
  const [saved, setSaved] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<{ version: number; note: string; created_at: string }[] | null>(null);

  const loadTargets = useCallback(() => {
    routingApi.targets().then(setTargets).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    routingApi.policy()
      .then((r) => { setMeta(r); setSaved(r.policy); setDraft(r.policy); })
      .catch((e) => setError(e.message));
    loadTargets();
  }, [loadTargets]);

  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);

  // Leaving with unsaved edits loses them; say so.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function pick(id: TabId) {
    setTab(id);
    router.replace(`/brain/settings/routing?tab=${id}`, { scroll: false });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const r = await routingApi.save(draft, `Edited ${TABS.find((t) => t.id === tab)?.label.toLowerCase()}`);
      setSaved(r.policy);
      setDraft(r.policy);
      setStatus(`Saved as version ${r.version}`);
      setVersions(null);
      loadTargets();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function restore(version: number | null) {
    setError(null);
    try {
      const r = await routingApi.restore(version);
      setSaved(r.policy);
      setDraft(r.policy);
      setStatus(version === null ? "Restored the default policy" : `Restored version ${version}`);
      setVersions(null);
      loadTargets();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function showVersions() {
    if (versions) { setVersions(null); return; }
    setVersions(await routingApi.versions().catch(() => []));
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-white dark:bg-gray-900">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Routing</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Every chat question goes through a switchboard first: your rules, then the brain, pick
          where it runs, and private notes never leave this device unless you say so.
        </p>

        <div className="mt-5 flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 overflow-x-auto"
          role="tablist" aria-label="Routing settings">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => pick(t.id)}
              className={`h-9 px-3 -mb-px border-b-2 text-[13px] whitespace-nowrap transition-colors ${
                tab === t.id
                  ? "border-indigo-500 text-gray-900 dark:text-gray-100 font-medium"
                  : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200
            dark:border-red-900 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="mt-5" role="tabpanel">
          {!draft || !meta ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : tab === "targets" ? (
            <TargetsTab policy={draft} onChange={setDraft} targets={targets} help={meta.slot_help} />
          ) : tab === "rules" ? (
            <RulesTab policy={draft} onChange={setDraft} kinds={meta.rule_kinds} />
          ) : tab === "instructions" ? (
            <InstructionsTab policy={draft} onChange={setDraft} targets={targets}
              defaultInstructions={meta.default.instructions} />
          ) : tab === "privacy" ? (
            <PrivacyTab policy={draft} onChange={setDraft} targets={targets} />
          ) : (
            <ActivityTab />
          )}
        </div>

        {tab !== "activity" && draft && (
          <div className="sticky bottom-0 mt-8 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-white/95 dark:bg-gray-900/95
            backdrop-blur border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-center gap-2">
            <button onClick={() => void save()} disabled={!dirty || saving}
              className="h-8 px-3.5 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700
                disabled:opacity-40">
              {saving ? "Saving…" : "Save"}
            </button>
            {dirty && (
              <button onClick={() => setDraft(saved)}
                className="h-8 px-3 rounded-lg text-[13px] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5">
                Discard changes
              </button>
            )}
            <span className="text-[12px] text-gray-500" aria-live="polite">
              {dirty ? "Unsaved changes" : status}
            </span>
            <span className="flex-1" />
            <div className="relative">
              <button onClick={() => void showVersions()} aria-expanded={!!versions}
                className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-[12.5px] text-gray-500
                  hover:text-gray-800 hover:bg-gray-100 dark:hover:bg-white/5 dark:hover:text-gray-200">
                <History size={13} /> Versions
              </button>
              {versions && (
                <div className="absolute bottom-full right-0 mb-2 w-72 max-h-72 overflow-y-auto rounded-xl border
                  border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl text-[12.5px]">
                  <button onClick={() => void restore(null)}
                    className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-indigo-600 dark:text-indigo-400
                      hover:bg-gray-50 dark:hover:bg-white/5 border-b border-gray-100 dark:border-gray-700">
                    <RotateCcw size={12} /> Restore the default policy
                  </button>
                  {versions.length === 0 && <p className="px-3 py-2 text-gray-400">No saved versions yet.</p>}
                  {versions.map((v, i) => (
                    <div key={v.version} className="flex items-center gap-2 px-3 py-2">
                      <span className="font-medium text-gray-700 dark:text-gray-200">v{v.version}</span>
                      <span className="flex-1 truncate text-gray-500">{v.note || "—"}</span>
                      {i === 0 ? <span className="text-[11px] text-gray-400">active</span> : (
                        <button onClick={() => void restore(v.version)} className="text-indigo-600 hover:underline dark:text-indigo-400">
                          Restore
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
