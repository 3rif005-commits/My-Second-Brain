"use client";

// The brain and what it reads. Instructions are guidance; rules are the
// guarantee. The test bench runs the unsaved draft, so an edit can be tried
// before it is saved.
import { useState } from "react";
import { FlaskConical, Lock, RotateCcw } from "lucide-react";
import { routingApi, SLOT_NAME, type Policy, type Targets, type TestResult } from "@/lib/routing";

interface Props {
  policy: Policy;
  onChange: (p: Policy) => void;
  targets: Targets | null;
  defaultInstructions: string;
}

const BRAINS: { value: Policy["brain"]["kind"]; label: string; desc: string }[] = [
  { value: "rules_only", label: "Rules only", desc: "No model decides. Instant and private. The default." },
  { value: "local", label: "Local model", desc: "A small model on this device reads the question. Private; speed depends on the hardware." },
  { value: "cloud", label: "Cloud model", desc: "A cheap cloud model reads each question to route it — your question leaves the device." },
];

const DECIDED: Record<string, string> = { rule: "a rule", brain: "the brain", user: "your pick", fallback: "fallback" };

export function InstructionsTab({ policy, onChange, targets, defaultInstructions }: Props) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const setBrain = (p: Partial<Policy["brain"]>) => onChange({ ...policy, brain: { ...policy.brain, ...p } });
  const cloud = (targets?.providers ?? []).filter((p) => p.provider !== "local" && p.has_key);

  async function test() {
    if (!query.trim()) return;
    setTesting(true);
    setTestError(null);
    try {
      setResult(await routingApi.test(query, policy));
    } catch (e) {
      setResult(null);
      setTestError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="brain-h">
        <h2 id="brain-h" className="text-[14px] font-semibold text-gray-800 dark:text-gray-100">The brain</h2>
        <p className="text-[12.5px] text-gray-500 dark:text-gray-400">Decides only what no rule decided. It never sees your notes.</p>
        <div className="mt-2 space-y-1.5" role="radiogroup" aria-label="Brain">
          {BRAINS.map((b) => (
            <label key={b.value} className={`flex items-start gap-2.5 rounded-xl border p-2.5 cursor-pointer ${
              policy.brain.kind === b.value ? "border-indigo-300 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-950/20"
                : "border-gray-200 dark:border-gray-700"}`}>
              <input type="radio" name="brain" className="mt-1 accent-indigo-600" checked={policy.brain.kind === b.value}
                onChange={() => setBrain({ kind: b.value })} />
              <span>
                <span className="block text-[13px] font-medium text-gray-800 dark:text-gray-100">{b.label}</span>
                <span className="block text-[12px] text-gray-500 dark:text-gray-400">{b.desc}</span>
              </span>
            </label>
          ))}
        </div>
        {policy.brain.kind === "cloud" && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
            <label htmlFor="brain-provider" className="text-gray-500">Model</label>
            <select id="brain-provider" value={policy.brain.provider}
              onChange={(e) => setBrain({ provider: e.target.value })}
              className="h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 text-gray-800 dark:text-gray-200">
              <option value="">First configured</option>
              {cloud.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
        )}
        {policy.brain.kind !== "rules_only" && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
            <label htmlFor="brain-timeout" className="text-gray-500">Give up after</label>
            <input id="brain-timeout" type="number" min={200} max={20000} step={100}
              value={policy.brain.timeout_ms}
              onChange={(e) => setBrain({ timeout_ms: Number(e.target.value) || 2500 })}
              className="h-8 w-24 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 text-gray-800 dark:text-gray-200" />
            <span className="text-gray-500">ms, then use the default</span>
          </div>
        )}
      </section>

      <section aria-labelledby="instr-h">
        <div className="flex items-center gap-2">
          <h2 id="instr-h" className="text-[14px] font-semibold text-gray-800 dark:text-gray-100">Instructions</h2>
          <span className="flex-1" />
          <button type="button" onClick={() => onChange({ ...policy, instructions: defaultInstructions })}
            className="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-indigo-600">
            <RotateCcw size={11} /> Default
          </button>
        </div>
        <p className="text-[12.5px] text-gray-500 dark:text-gray-400">
          What the brain reads on every question. Guidance, not a guarantee — use a rule for anything that must
          always happen, and privacy levels for anything that must stay on this device.
        </p>
        <label htmlFor="instructions" className="sr-only">Routing instructions</label>
        <textarea id="instructions" rows={11} maxLength={4000} value={policy.instructions}
          onChange={(e) => onChange({ ...policy, instructions: e.target.value })}
          className="mt-2 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent p-3 font-mono
            text-[12.5px] leading-relaxed text-gray-800 dark:text-gray-200" />
        <p className="text-right text-[11px] text-gray-400">{policy.instructions.length} / 4000</p>
        {policy.brain.kind === "rules_only" && (
          <p className="text-[12px] text-amber-700 dark:text-amber-300">Not used while the brain is “Rules only”.</p>
        )}
      </section>

      <section aria-labelledby="bench-h" className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
        <h2 id="bench-h" className="flex items-center gap-1.5 text-[14px] font-semibold text-gray-800 dark:text-gray-100">
          <FlaskConical size={14} /> Test bench
        </h2>
        <p className="text-[12.5px] text-gray-500 dark:text-gray-400">
          Where would this question go under the policy on screen (saved or not)? Nothing is answered or logged
          {policy.brain.kind !== "rules_only" ? " — but the brain is asked, as it would be for real" : ""}.
        </p>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void test(); }}>
          <label htmlFor="bench-q" className="sr-only">Sample question</label>
          <input id="bench-q" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. prove that the eigenvalues of a symmetric matrix are real"
            className="h-9 flex-1 min-w-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 text-[13px]
              text-gray-800 dark:text-gray-200" />
          <button disabled={testing || !query.trim()}
            className="h-9 px-3 rounded-lg bg-gray-900 text-white text-[13px] dark:bg-white dark:text-gray-900 disabled:opacity-40">
            {testing ? "…" : "Route it"}
          </button>
        </form>
        {testError && <p role="alert" className="mt-2 text-[12.5px] text-red-600">{testError}</p>}
        {result && (
          <div className="mt-3 rounded-lg bg-gray-50 dark:bg-white/5 p-3 text-[13px]" aria-live="polite">
            <p className="flex flex-wrap items-center gap-1.5 text-gray-800 dark:text-gray-100">
              {result.on_device && <Lock size={12} className="text-emerald-600" />}
              <b>{SLOT_NAME[result.slot] ?? result.slot}</b>
              <span className="text-gray-500">· {result.provider}{result.model ? ` · ${result.model}` : ""}</span>
            </p>
            <p className="mt-1 text-gray-600 dark:text-gray-300">
              Decided by {DECIDED[result.decided_by] ?? result.decided_by}: {result.reason}
            </p>
            <p className="mt-1 text-[12px] text-gray-500">
              May read {result.ceiling} notes · {result.total_ms} ms
              {result.brain_ms ? ` (brain ${result.brain_ms} ms)` : ""}
            </p>
            {result.notes.length > 0 && <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-300">{result.notes.join(" · ")}</p>}
          </div>
        )}
      </section>
    </div>
  );
}
