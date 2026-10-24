"use client";

// Auto-sync rules (DESIGN §6.4). Never sends private notes, never overwrites a page edited in Notion.
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { IconButton, Select, SettingsRow, SettingsSection } from "@/components/ui";
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
    <SettingsSection
      id="rules"
      title="Auto-sync"
      description="Send changes without being asked. Auto-sync never sends a private note, never overwrites a page you edited in Notion (those wait for you under “Needs you”), and never moves a deleted note to the archive."
    >
      {error && <p role="alert" className="text-[13px] text-ink-danger">{error}</p>}
      <SettingsRow label="Whole brain" help="To watch just one note, folder or database, right-click it in the sidebar and choose “Keep in sync”.">
        <Select
          label="Whole brain auto-sync"
          value={everything?.mode ?? "off"}
          onChange={(m) => setEverything(m as Rule["mode"] | "off")}
          menuWidth={300}
          options={[
            { value: "off", label: "Off" },
            { value: "on_change", label: "When it changes", description: "After 10 minutes of quiet" },
            { value: "daily", label: "Once a day" },
          ]}
        />
      </SettingsRow>
      {rules && rules.filter((r) => r.scope_kind !== "all").length > 0 && (
        <table className="w-full text-[13px] text-ink" aria-label="Rules">
          <thead><tr className="text-left text-ink-secondary"><th className="py-1 font-medium">Scope</th><th className="font-medium">When</th><th /></tr></thead>
          <tbody>
            {rules.filter((r) => r.scope_kind !== "all").map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="py-1.5">{KIND_WORD[r.scope_kind]} <span className="text-ink-tertiary">{r.scope_id?.slice(0, 8)}</span></td>
                <td>{MODE_WORD[r.mode]}</td>
                <td className="text-right">
                  <IconButton label="Delete rule" size={24} onClick={async () => { await notionApi.deleteRule(r.id); await load(); }}>
                    <Trash2 />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SettingsSection>
  );
}
