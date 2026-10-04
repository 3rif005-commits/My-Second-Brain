"use client";

// Rules: "When … → use …", checked top to bottom, first match wins. They run
// before the brain and are the only part of routing that is a guarantee —
// text in a note or a PDF cannot argue a rule out of its decision.
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { SLOT_NAME, SLOTS, type Policy, type Rule, type RuleKind, type Slot } from "@/lib/routing";

interface Props {
  policy: Policy;
  onChange: (p: Policy) => void;
  kinds: Record<RuleKind, string>;
}

const field = "h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 text-[13px] text-gray-800 dark:text-gray-200";

const PLACEHOLDER: Record<RuleKind, string> = {
  message_matches: "words, comma separated",
  context_over: "tokens, e.g. 30000",
  surface_is: "chat, workspace",
  spend_today_over: "dollars, e.g. 1.00",
  always: "",
};

const BRAIN_NAME: Record<Policy["brain"]["kind"], string> = {
  rules_only: "",
  local: "the local model",
  cloud: "a cloud model",
};

export function RulesTab({ policy, onChange, kinds }: Props) {
  const rules = policy.rules;
  const setRules = (next: Rule[]) => onChange({ ...policy, rules: next });
  const patch = (i: number, p: Partial<Rule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= rules.length) return;
    const next = [...rules];
    [next[i], next[j]] = [next[j], next[i]];
    setRules(next);
  };
  const add = () => {
    let n = rules.length + 1;
    while (rules.some((r) => r.id === `rule-${n}`)) n += 1;
    setRules([...rules, { id: `rule-${n}`, enabled: true, kind: "message_matches", value: "", use: "local" }]);
  };

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-gray-500 dark:text-gray-400">
        Checked top to bottom; the first rule that matches decides. A manual pick in the chat box
        always wins over rules.
      </p>
      <ol className="space-y-2">
        {rules.map((r, i) => (
          <li key={r.id} className={`rounded-xl border p-3 ${r.enabled
            ? "border-gray-200 dark:border-gray-700" : "border-dashed border-gray-200 dark:border-gray-800 opacity-60"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-5 text-[12px] text-gray-400 tabular-nums">{i + 1}</span>
              <span className="text-[13px] text-gray-500">When</span>
              <label className="sr-only" htmlFor={`kind-${r.id}`}>Condition</label>
              <select id={`kind-${r.id}`} className={field} value={r.kind}
                onChange={(e) => patch(i, { kind: e.target.value as RuleKind,
                  value: e.target.value === "always" ? null : "" })}>
                {Object.entries(kinds).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              {r.kind !== "always" && (<>
                <label className="sr-only" htmlFor={`val-${r.id}`}>Value</label>
                <input id={`val-${r.id}`} className={`${field} flex-1 min-w-[9rem]`}
                  placeholder={PLACEHOLDER[r.kind]}
                  inputMode={r.kind === "context_over" || r.kind === "spend_today_over" ? "decimal" : undefined}
                  value={r.value ?? ""} onChange={(e) => patch(i, { value: e.target.value })} />
              </>)}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
              <span className="text-[13px] text-gray-500">→ use</span>
              <label className="sr-only" htmlFor={`use-${r.id}`}>Target</label>
              <select id={`use-${r.id}`} className={field} value={r.use}
                onChange={(e) => patch(i, { use: e.target.value as Slot | "brain" })}>
                {SLOTS.map((s) => <option key={s} value={s}>{SLOT_NAME[s]}</option>)}
                <option value="brain">Ask the brain</option>
              </select>
              <span className="flex-1" />
              <label className="inline-flex items-center gap-1.5 text-[12px] text-gray-500">
                <input type="checkbox" checked={r.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })}
                  className="accent-indigo-600" /> On
              </label>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move rule ${i + 1} up`}
                className="p-1 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowUp size={14} /></button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === rules.length - 1}
                aria-label={`Move rule ${i + 1} down`}
                className="p-1 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowDown size={14} /></button>
              <button type="button" onClick={() => setRules(rules.filter((_, j) => j !== i))}
                aria-label={`Delete rule ${i + 1}`}
                className="p-1 rounded text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" onClick={add}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-dashed border-gray-300
          dark:border-gray-600 text-[13px] text-gray-600 dark:text-gray-300 hover:border-indigo-400 hover:text-indigo-600">
        <Plus size={13} /> Add rule
      </button>

      <div className="rounded-xl bg-gray-50 dark:bg-white/5 p-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          {policy.brain.kind === "rules_only" ? (
            <span className="text-gray-500">Otherwise → use</span>
          ) : (<>
            <span className="text-gray-500">Otherwise → ask</span>
            <span className="font-medium text-gray-800 dark:text-gray-100">{BRAIN_NAME[policy.brain.kind]}</span>
            <span className="text-gray-500">; if it has no answer, use</span>
          </>)}
          <label className="sr-only" htmlFor="default-slot">Default</label>
          <select id="default-slot" className={field} value={policy.default_slot}
            onChange={(e) => onChange({ ...policy, default_slot: e.target.value as Slot })}>
            {SLOTS.map((s) => <option key={s} value={s}>{SLOT_NAME[s]}</option>)}
          </select>
        </div>
        <p className="mt-1 text-[12px] text-gray-400">The brain is set in the Brain &amp; instructions tab.</p>
      </div>
    </div>
  );
}
