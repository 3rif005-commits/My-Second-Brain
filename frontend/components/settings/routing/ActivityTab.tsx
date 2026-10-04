"use client";

// Activity: what the switchboard actually decided — reasons and counts, never
// the question or note text.
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { routingApi, SLOT_NAME, SLOTS, type DecisionLog, type Slot } from "@/lib/routing";

const DECIDED = ["rule", "brain", "user", "fallback"] as const;
const field = "h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 text-[13px] text-gray-800 dark:text-gray-200";

function when(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ActivityTab() {
  const [slot, setSlot] = useState("");
  const [decidedBy, setDecidedBy] = useState("");
  const [log, setLog] = useState<DecisionLog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    routingApi.decisions({ slot, decided_by: decidedBy }).then(setLog).catch((e) => setError(e.message));
  }, [slot, decidedBy]);

  const s = log?.summary;
  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-[13px] text-red-600">{error}</p>}
      {s && (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            ["Requests", String(s.count)],
            ["On this device", `${s.local_pct}%`],
            ["Asked again elsewhere", `${s.override_pct}%`],
            ["Private notes held back", String(s.withheld)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-gray-200 dark:border-gray-700 p-2.5">
              <dt className="text-[11.5px] text-gray-500">{k}</dt>
              <dd className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="f-slot">Slot</label>
        <select id="f-slot" className={field} value={slot} onChange={(e) => setSlot(e.target.value)}>
          <option value="">All roles</option>
          {SLOTS.map((x) => <option key={x} value={x}>{SLOT_NAME[x]}</option>)}
        </select>
        <label className="sr-only" htmlFor="f-by">Decided by</label>
        <select id="f-by" className={field} value={decidedBy} onChange={(e) => setDecidedBy(e.target.value)}>
          <option value="">Decided by anyone</option>
          {DECIDED.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>
      {log && log.rows.length === 0 && (
        <p className="text-[13px] text-gray-400">No routed requests yet. Ask something in chat.</p>
      )}
      {log && log.rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-[12.5px]">
            <thead className="bg-gray-50 dark:bg-white/5 text-left text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Ran on</th>
                <th className="px-3 py-2 font-medium">Why</th>
                <th className="px-3 py-2 font-medium text-right">Notes</th>
              </tr>
            </thead>
            <tbody>
              {log.rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800 align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{when(r.created_at)}</td>
                  <td className="px-3 py-2 text-gray-800 dark:text-gray-100">
                    <span className="inline-flex items-center gap-1">
                      {r.slot === "local" && <Lock size={11} className="text-emerald-600" />}
                      {SLOT_NAME[r.slot as Slot] ?? r.slot}
                    </span>
                    {r.model && <span className="block text-[11.5px] text-gray-500">{r.model}</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                    <span className="text-gray-400">{r.decided_by}{r.override_of ? " · asked again" : ""}: </span>
                    {r.reason}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-gray-600 dark:text-gray-300">
                    {r.sent_count} sent
                    {r.withheld_count > 0 && <span className="block text-amber-700 dark:text-amber-300">{r.withheld_count} held back</span>}
                    {r.released_count > 0 && <span className="block text-gray-500">{r.released_count} sent once</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
