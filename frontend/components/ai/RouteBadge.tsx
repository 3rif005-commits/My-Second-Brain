"use client";

// Where an answer ran, and why — under every chat answer (routing spec §5.2),
// plus the privacy prompt shown when a cloud answer would need private notes
// (§5.3). Both only report what the server decided; neither changes a level.
import { useEffect, useRef, useState } from "react";
import { Cloud, Info, Lock, ShieldAlert } from "lucide-react";
import { addWordRule, SLOTS, type Slot } from "@/lib/routing";

export interface RouteInfo {
  decision_id?: string | null;
  slot: string;
  provider?: string;
  model?: string;
  decided_by?: "rule" | "brain" | "user" | "fallback" | string;
  reason?: string;
  on_device?: boolean;
  latency_ms?: number;
  sent?: number;
  withheld?: { id: string; title: string }[];
  private_used?: boolean;
  notes?: string[];
}

const SLOT_LABEL: Record<string, string> = {
  local: "Local", fast: "Fast", strong: "Strong", vision: "Vision", long: "Long",
};
export const slotLabel = (s: string) => SLOT_LABEL[s] ?? s;

const DECIDED: Record<string, string> = {
  rule: "a rule", brain: "the brain", user: "you", fallback: "fallback",
};

interface BadgeProps {
  route: RouteInfo;
  /** Ask the same question again on another slot. */
  onRerun?: (slot: string) => void;
  busy?: boolean;
}

export function RouteBadge({ route, onRerun, busy }: BadgeProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const local = !!route.on_device;
  const withheld = route.withheld ?? [];
  return (
    <div ref={ref} className="relative mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Answered ${local ? "on this device" : `by ${route.model || route.provider}`}. Details`}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px]
          text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5"
      >
        {local
          ? <Lock size={11} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
          : <Cloud size={11} className="shrink-0" />}
        <span className="font-medium text-gray-600 dark:text-gray-300">{slotLabel(route.slot)}</span>
        {!local && route.model && <span className="truncate">· {route.model}</span>}
        {local && <span>· stayed on this device</span>}
        {withheld.length > 0 && (
          <span className="text-amber-600 dark:text-amber-400">· {withheld.length} private held back</span>
        )}
        <Info size={11} className="shrink-0 opacity-60" />
      </button>

      {open && (
        <div role="dialog" aria-label="Why this route"
          className="absolute left-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-xl border
            border-gray-200 bg-white p-3 text-[12px] shadow-xl dark:border-gray-700 dark:bg-gray-800">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-gray-400">Ran on</dt>
            <dd className="text-gray-700 dark:text-gray-200">
              {slotLabel(route.slot)}{route.provider ? ` · ${route.provider}` : ""}
              {route.model ? ` · ${route.model}` : ""}
            </dd>
            <dt className="text-gray-400">Decided by</dt>
            <dd className="text-gray-700 dark:text-gray-200">
              {DECIDED[route.decided_by ?? ""] ?? route.decided_by}
              {route.latency_ms ? ` (${route.latency_ms} ms)` : ""}
            </dd>
            {route.reason && (<>
              <dt className="text-gray-400">Why</dt>
              <dd className="text-gray-700 dark:text-gray-200">{route.reason}</dd>
            </>)}
            {typeof route.sent === "number" && (<>
              <dt className="text-gray-400">Notes sent</dt>
              <dd className="text-gray-700 dark:text-gray-200">{route.sent}</dd>
            </>)}
          </dl>
          {withheld.length > 0 && (
            <div className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="font-medium">Held back (private)</p>
              <ul className="mt-0.5 list-inside list-disc">
                {withheld.map((w) => <li key={w.id} className="truncate">{w.title}</li>)}
              </ul>
            </div>
          )}
          {route.notes?.length ? (
            <p className="mt-2 text-[11px] text-gray-500">{route.notes.join(" · ")}</p>
          ) : null}
          {onRerun && (
            <div className="mt-2.5 border-t border-gray-100 pt-2 dark:border-gray-700">
              <p className="mb-1 text-gray-400">Ask again on</p>
              <div className="flex flex-wrap gap-1">
                {["local", "fast", "strong"].filter((s) => s !== route.slot).map((s) => (
                  <button key={s} type="button" disabled={busy}
                    onClick={() => { setOpen(false); onRerun(s); }}
                    className="rounded-md border border-gray-200 px-2 py-0.5 text-gray-700 hover:border-accent-300
                      hover:text-accent-600 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200">
                    {slotLabel(s)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <RuleFromAnswer current={route.slot} />
          <a href="/brain/settings/routing" className="mt-2 block text-accent-600 hover:underline dark:text-accent-400">
            Routing settings
          </a>
        </div>
      )}
    </div>
  );
}

/** "Always send messages mentioning … to …" — a rule, saved at the top. */
function RuleFromAnswer({ current }: { current: string }) {
  const [words, setWords] = useState("");
  const [slot, setSlot] = useState<Slot>(current === "strong" ? "fast" : "strong");
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!words.trim()) return;
    setBusy(true);
    try {
      const v = await addWordRule(words.trim(), slot);
      setState(`Rule added (v${v}).`);
      setWords("");
    } catch (e) {
      setState(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-2.5 border-t border-gray-100 pt-2 dark:border-gray-700"
      onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <p className="mb-1 text-gray-400">Always send messages mentioning</p>
      <div className="flex gap-1">
        <label className="sr-only" htmlFor="rule-words">Words</label>
        <input id="rule-words" value={words} onChange={(e) => setWords(e.target.value)}
          placeholder="words, comma separated"
          className="h-7 min-w-0 flex-1 rounded-md border border-gray-200 bg-transparent px-1.5 text-[12px]
            text-gray-800 dark:border-gray-600 dark:text-gray-100" />
        <label className="sr-only" htmlFor="rule-slot">To</label>
        <select id="rule-slot" value={slot} onChange={(e) => setSlot(e.target.value as Slot)}
          className="h-7 rounded-md border border-gray-200 bg-transparent px-1 text-[12px] text-gray-800
            dark:border-gray-600 dark:text-gray-100">
          {SLOTS.map((s) => <option key={s} value={s}>to {slotLabel(s)}</option>)}
        </select>
        <button disabled={busy || !words.trim()}
          className="h-7 rounded-md bg-gray-900 px-2 text-[12px] text-white disabled:opacity-40 dark:bg-white dark:text-gray-900">
          Add
        </button>
      </div>
      {state && <p className="mt-1 text-[11.5px] text-gray-500" aria-live="polite">{state}</p>}
    </form>
  );
}

interface PromptProps {
  withheld: { id: string; title: string }[];
  slot: string;
  model?: string;
  resolved?: string;
  busy?: boolean;
  onLocal: () => void;
  onWithout: () => void;
  onOnce: () => void;
}

/** "This answer needs N private notes" — nothing was sent yet. */
export function PrivacyPrompt({ withheld, slot, model, resolved, busy, onLocal, onWithout, onOnce }: PromptProps) {
  const n = withheld.length;
  return (
    <div role="group" aria-label="Private notes needed"
      className="rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-3 text-[13px]
        dark:border-amber-900/60 dark:bg-amber-950/30">
      <p className="flex items-center gap-1.5 font-medium text-amber-900 dark:text-amber-100">
        <ShieldAlert size={14} className="shrink-0" />
        This answer would use {n} private note{n === 1 ? "" : "s"}
      </p>
      <p className="mt-0.5 text-[12px] text-amber-800/80 dark:text-amber-200/70">
        It was going to {slotLabel(slot)}{model ? ` (${model})` : ""}, in the cloud. Nothing has been sent.
      </p>
      <ul className="mt-1.5 list-inside list-disc text-[12px] text-amber-900 dark:text-amber-100">
        {withheld.map((w) => <li key={w.id} className="truncate">{w.title}</li>)}
      </ul>
      {resolved ? (
        <p className="mt-2 text-[12px] text-gray-500">{resolved}</p>
      ) : (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <button type="button" disabled={busy} onClick={onLocal}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[12px] font-medium
              text-white hover:bg-emerald-700 disabled:opacity-50">
            <Lock size={11} /> Answer on device
          </button>
          <button type="button" disabled={busy} onClick={onWithout}
            className="rounded-lg border border-gray-300 px-2.5 py-1 text-[12px] text-gray-700 hover:bg-white
              disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800">
            Send without them
          </button>
          <button type="button" disabled={busy} onClick={onOnce}
            title="Only for this question — the notes stay private"
            className="rounded-lg px-2.5 py-1 text-[12px] text-amber-800 hover:underline disabled:opacity-50
              dark:text-amber-200">
            Send them this once
          </button>
        </div>
      )}
    </div>
  );
}
