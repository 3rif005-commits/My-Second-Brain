"use client";

// Auto-sync rules (DESIGN §6.4). Never sends private notes, never overwrites a page edited in Notion.
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { notionApi, type Rule } from "@/lib/notion";

const MODE_WORD = { manual: "Manual", on_change: "When it changes", daily: "Once a day" } as const;
const KIND_WORD = { all: "Everything", note: "One note", collection: "A folder", database: "A database" } as const;

export function RulesSection() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => notionApi.rules().then((r) => setRules(r.rules)).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const everything = rules?.find((r) => r.scope_kind === "all");

  async function setEverything(m: Rule["mode"] | "off") {
    setError(null);
    try {
      if (m === "off" && everything) await notionApi.deleteRule(everything.id);
      else if (m !== "off") await notionApi.addRule({ scope_kind: "all", scope_id: null, mode: m });
      await load();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <section id="rules" aria-label="Auto-sync" className="space-y-3">
      <h2 className="font-semibold">Auto-sync</h2>
      <p className="text-[13px] text-gray-500 dark:text-gray-400">
        Send changes without being asked. Auto-sync never sends a private note, never overwrites a page you edited in Notion
        (those wait for you under “Needs you”), and never moves a deleted note to the archive.
      </p>
      {error && <p role="alert" className="text-[13px] text-rose-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[13px]" htmlFor="auto-all">Whole brain:</label>
        <select id="auto-all" value={everything?.mode ?? "off"} onChange={(e) => setEverything(e.target.value as Rule["mode"] | "off")}
          className="h-8 rounded-md border border-gray-200 dark:border-white/15 bg-transparent px-2 text-[13px]">
          <option value="off">Off</option>
          <option value="on_change">When it changes (after 10 minutes of quiet)</option>
          <option value="daily">Once a day</option>
        </select>
      </div>
      {rules && rules.filter((r) => r.scope_kind !== "all").length > 0 && (
        <table className="w-full text-[13px]" aria-label="Rules">
          <thead><tr className="text-left text-gray-500"><th className="py-1 font-medium">Scope</th><th className="font-medium">When</th><th /></tr></thead>
          <tbody>
            {rules.filter((r) => r.scope_kind !== "all").map((r) => (
              <tr key={r.id} className="border-t border-gray-100 dark:border-white/10">
                <td className="py-1.5">{KIND_WORD[r.scope_kind]} <span className="text-gray-500">{r.scope_id?.slice(0, 8)}</span></td>
                <td>{MODE_WORD[r.mode]}</td>
                <td className="text-right"><button aria-label="Delete rule" onClick={async () => { await notionApi.deleteRule(r.id); await load(); }}
                  className="p-1 text-gray-400 hover:text-rose-600"><Trash2 size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-[12px] text-gray-500">To watch just one note, folder or database, right-click it in the sidebar and choose “Keep in sync”.</p>
    </section>
  );
}
