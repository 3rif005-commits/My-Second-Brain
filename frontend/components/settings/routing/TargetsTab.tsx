"use client";

// Targets: what each role runs on. Rules and instructions name roles, never
// models — so swapping a model or the device behind "Local" is one change here.
import { useState } from "react";
import { AlertTriangle, Lock, Zap } from "lucide-react";
import { routingApi, SLOT_NAME, SLOTS, type Policy, type Slot, type Targets } from "@/lib/routing";

interface Props {
  policy: Policy;
  onChange: (p: Policy) => void;
  targets: Targets | null;
  help: Record<Slot, string>;
}

const field = "h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 text-[13px] text-gray-800 dark:text-gray-200";

export function TargetsTab({ policy, onChange, targets, help }: Props) {
  const [pings, setPings] = useState<Partial<Record<Slot, string>>>({});

  function set(slot: Slot, patch: Partial<{ provider: string; model: string }>) {
    onChange({ ...policy, slots: { ...policy.slots, [slot]: { ...policy.slots[slot], ...patch } } });
  }

  async function ping(slot: Slot) {
    setPings((p) => ({ ...p, [slot]: "Checking…" }));
    try {
      const r = await routingApi.ping(slot);
      setPings((p) => ({ ...p, [slot]: r.ok ? `Reachable · ${r.ms} ms` : `Failed: ${r.error}` }));
    } catch (e) {
      setPings((p) => ({ ...p, [slot]: `Failed: ${e instanceof Error ? e.message : e}` }));
    }
  }

  const cloud = (targets?.providers ?? []).filter((p) => p.provider !== "local");
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-gray-500 dark:text-gray-400">
        <b className="font-medium text-gray-700 dark:text-gray-200">Auto</b> uses the first configured provider
        that can do the job — what the app did before routing. Pick one to pin a role to it. Saved changes
        apply to the next question; the “Now” column shows the saved policy.
      </p>
      {SLOTS.map((slot) => {
        const now = targets?.slots.find((s) => s.slot === slot);
        const isLocal = slot === "local";
        return (
          <div key={slot} className="min-w-0 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 w-20 text-[13px] font-semibold text-gray-800 dark:text-gray-100">
                {isLocal && <Lock size={12} className="text-emerald-600" />}{SLOT_NAME[slot]}
              </span>
              <span className="flex-1 min-w-[10rem] text-[12px] text-gray-500 dark:text-gray-400">{help[slot]}</span>
              <button type="button" onClick={() => void ping(slot)}
                className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[12px] text-gray-500 hover:text-accent-600
                  hover:bg-gray-50 dark:hover:bg-white/5" title="Send a tiny real request through this role">
                <Zap size={12} /> Test
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`prov-${slot}`}>{SLOT_NAME[slot]} provider</label>
              <select id={`prov-${slot}`} className={`${field} min-w-[11rem]`} disabled={isLocal}
                value={policy.slots[slot].provider}
                onChange={(e) => set(slot, { provider: e.target.value })}>
                {isLocal ? <option value="local">This device (local model)</option> : <>
                  <option value="auto">Auto</option>
                  {cloud.map((p) => (
                    <option key={p.key} value={p.key} disabled={!p.has_key}>
                      {p.label}{p.has_key ? "" : " (no key)"}
                    </option>
                  ))}
                </>}
              </select>
              <label className="sr-only" htmlFor={`model-${slot}`}>{SLOT_NAME[slot]} model</label>
              <input id={`model-${slot}`} className={`${field} flex-1 min-w-[10rem]`}
                placeholder={isLocal ? "Model name (optional)" : "Model id (optional), e.g. claude-sonnet-5-5"}
                value={policy.slots[slot].model}
                onChange={(e) => set(slot, { model: e.target.value.trim() })} />
            </div>
            {/* a failed Test can carry a long unbroken error (a URL, JSON): wrap it
                rather than push the whole settings pane sideways */}
            <p className="mt-1.5 text-[12px] [overflow-wrap:anywhere]">
              <span className="text-gray-400">Now: </span>
              {now?.error
                ? <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                    <AlertTriangle size={11} /> {now.error}</span>
                : now ? <span className="text-gray-600 dark:text-gray-300">{now.label}{now.model ? ` · ${now.model}` : ""}</span>
                : <span className="text-gray-400">…</span>}
              {pings[slot] && <span className="ml-2 text-gray-500">· {pings[slot]}</span>}
            </p>
          </div>
        );
      })}
      <p className="text-[12px] text-gray-400">
        API keys live in <a href="/brain/settings/ai-providers" className="text-accent-600 hover:underline dark:text-accent-400">AI providers</a>.
      </p>
    </div>
  );
}
