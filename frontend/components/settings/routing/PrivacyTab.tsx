"use client";

// Privacy: which providers may read Personal notes, and what happens when a
// question routed to the cloud would need a Private one. Enforced in the
// backend's privacy gate — no model can change it.
import { Globe, Lock, User } from "lucide-react";
import type { Policy, Targets } from "@/lib/routing";

interface Props {
  policy: Policy;
  onChange: (p: Policy) => void;
  targets: Targets | null;
}

const WHEN: { value: Policy["privacy"]["when_private_needed"]; label: string; desc: string }[] = [
  { value: "ask", label: "Ask me first", desc: "Nothing is sent until you choose: answer on device, send without them, or send them once." },
  { value: "local", label: "Answer on this device", desc: "The question moves to the local model automatically." },
  { value: "drop", label: "Leave them out", desc: "The cloud model answers without the private notes; the answer says what was held back." },
];

export function PrivacyTab({ policy, onChange, targets }: Props) {
  const setPrivacy = (p: Partial<Policy["privacy"]>) => onChange({ ...policy, privacy: { ...policy.privacy, ...p } });
  const untrusted = new Set(policy.privacy.untrusted);
  const toggleTrust = (key: string) => {
    const next = new Set(untrusted);
    if (next.has(key)) next.delete(key); else next.add(key);
    setPrivacy({ untrusted: [...next] });
  };
  const cloud = (targets?.providers ?? []).filter((p) => p.provider !== "local");

  return (
    <div className="space-y-6">
      <section aria-labelledby="levels-h">
        <h2 id="levels-h" className="text-[14px] font-semibold text-gray-800 dark:text-gray-100">Privacy levels</h2>
        <p className="text-[12.5px] text-gray-500 dark:text-gray-400">
          Set on each note (Properties → Privacy). Database rows and a note’s sources follow their note.
          New notes start as Personal.
        </p>
        <ul className="mt-2 grid gap-2 sm:grid-cols-3 text-[12.5px]">
          <li className="rounded-xl border border-gray-200 dark:border-gray-700 p-2.5">
            <p className="flex items-center gap-1.5 font-medium text-gray-800 dark:text-gray-100"><Globe size={12} /> Open</p>
            <p className="text-gray-500 dark:text-gray-400">Any provider.</p>
          </li>
          <li className="rounded-xl border border-gray-200 dark:border-gray-700 p-2.5">
            <p className="flex items-center gap-1.5 font-medium text-gray-800 dark:text-gray-100"><User size={12} /> Personal</p>
            <p className="text-gray-500 dark:text-gray-400">Providers you trust (below).</p>
          </li>
          <li className="rounded-xl border border-amber-300 dark:border-amber-800 p-2.5">
            <p className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-200"><Lock size={12} /> Private</p>
            <p className="text-gray-500 dark:text-gray-400">Never leaves this device.</p>
          </li>
        </ul>
      </section>

      <section aria-labelledby="trust-h">
        <h2 id="trust-h" className="text-[14px] font-semibold text-gray-800 dark:text-gray-100">Trusted providers</h2>
        <p className="text-[12.5px] text-gray-500 dark:text-gray-400">
          A trusted provider may read Personal notes. Untrust one that may keep or train on what it is sent
          (some free gateway models do) — it then only ever sees Open notes.
        </p>
        <div className="mt-2 space-y-1.5">
          {cloud.length === 0 && <p className="text-[12.5px] text-gray-400">No cloud providers configured.</p>}
          {cloud.map((p) => {
            const trusted = !untrusted.has(p.key);
            return (
              <div key={p.key} className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-gray-800 dark:text-gray-100">{p.label}</p>
                  <p className="text-[12px] text-gray-500">{p.key} · may read {trusted ? "Open + Personal" : "Open only"}</p>
                </div>
                <button type="button" role="switch" aria-checked={trusted} aria-label={`Trust ${p.label}`}
                  onClick={() => toggleTrust(p.key)}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
                    trusted ? "bg-indigo-500" : "bg-gray-300 dark:bg-gray-600"}`}>
                  <span className={`inline-block h-4 w-4 translate-y-0.5 rounded-full bg-white shadow transition-transform ${
                    trusted ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="when-h">
        <h2 id="when-h" className="text-[14px] font-semibold text-gray-800 dark:text-gray-100">
          When a cloud answer would need a Private note
        </h2>
        <div className="mt-2 space-y-1.5" role="radiogroup" aria-labelledby="when-h">
          {WHEN.map((w) => (
            <label key={w.value} className={`flex items-start gap-2.5 rounded-xl border p-2.5 cursor-pointer ${
              policy.privacy.when_private_needed === w.value
                ? "border-indigo-300 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-950/20"
                : "border-gray-200 dark:border-gray-700"}`}>
              <input type="radio" name="when-private" className="mt-1 accent-indigo-600"
                checked={policy.privacy.when_private_needed === w.value}
                onChange={() => setPrivacy({ when_private_needed: w.value })} />
              <span>
                <span className="block text-[13px] font-medium text-gray-800 dark:text-gray-100">{w.label}</span>
                <span className="block text-[12px] text-gray-500 dark:text-gray-400">{w.desc}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-gray-400">
          Applies everywhere notes reach a model: chat and the workspace panel, note tools, the editor AI,
          study guides and other skills, background jobs, source processing, indexing, and apps you connect
          over MCP (they never see Private notes). A job on a Private note runs on the local model, or
          stops and says why.
        </p>
      </section>
    </div>
  );
}
