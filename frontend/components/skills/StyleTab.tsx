"use client";

// E12 — the study guide's "Your style": preferences added AFTER the
// instructions (which never change), and "Learn from my edits", which only
// SUGGESTS lines from how the user edited AI guides. Nothing reaches a guide
// until the user adds it here and saves.
import { useCallback, useEffect, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { skillsApi, type StyleSuggestion } from "@/lib/skills";
import type { TabCtx } from "./tabs";

export const STYLE_FILE = "reference/style.md";

/** Add one preference as its own line, after whatever is there. */
export function withPreference(text: string, preference: string): string {
  const line = preference.trim();
  if (!line || text.split("\n").some((l) => l.trim() === line)) return text;
  return `${text.replace(/\s+$/, "")}\n${line}\n`;
}

export function StyleTab({ skill, reportDirty, onSkillChanged }: TabCtx) {
  const [saved, setSaved] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [learning, setLearning] = useState(false);
  const [found, setFound] = useState<{ suggestions: StyleSuggestion[]; reason: string | null } | null>(null);
  const dirty = saved !== null && text !== saved;
  useEffect(() => { reportDirty("style", dirty); }, [dirty, reportDirty]);
  useEffect(() => () => reportDirty("style", false), [reportDirty]);

  const load = useCallback(async () => {
    try {
      const r = await skillsApi.readFile(skill.name, STYLE_FILE);
      setSaved(r.content); setText(r.content);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open your style"); }
  }, [skill.name]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setBusy(true); setError("");
    try {
      await skillsApi.writeFile(skill.name, STYLE_FILE, text);
      setSaved(text);
      onSkillChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save"); }
    finally { setBusy(false); }
  }

  async function learn() {
    setLearning(true); setError(""); setFound(null);
    try { setFound(await skillsApi.learnStyle(skill.name)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not learn from your edits"); }
    finally { setLearning(false); }
  }

  return (
    <div className="space-y-3" data-testid="style-tab">
      <p className="text-[12.5px] leading-relaxed text-gray-500 dark:text-gray-400">
        Your preferences for every study guide, one per line. They are added after the
        instructions, which stay as they are. Text between <code>&lt;!--</code> and <code>--&gt;</code> is
        never sent to the AI.
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
        aria-label="Your style" disabled={saved === null}
        className="w-full min-h-[220px] resize-y rounded-xl px-4 py-3 font-mono text-[12.5px] leading-relaxed
          bg-gray-50/80 dark:bg-white/[0.03] border border-gray-200/80 dark:border-white/10 outline-none
          focus:border-indigo-300 text-gray-800 dark:text-gray-100 disabled:opacity-50" />
      <div className="flex items-center gap-2">
        <button type="button" onClick={learn} disabled={learning}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] ring-1 ring-gray-200
            dark:ring-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50">
          <Sparkles size={13} className="text-indigo-500" />
          {learning ? "Reading your edits…" : "Learn from my edits"}
        </button>
        {error && <span className="text-[12px] text-red-500">{error}</span>}
        <span className="ml-auto" />
        {dirty && (
          <button type="button" onClick={() => setText(saved ?? "")}
            className="h-8 px-3 rounded-lg text-[12.5px] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10">
            Discard
          </button>
        )}
        <button type="button" onClick={save} disabled={!dirty || busy}
          className="h-8 px-3.5 rounded-lg text-[12.5px] font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {found && (
        <div className="rounded-xl border border-gray-200/80 dark:border-white/10 p-3 space-y-2" data-testid="style-suggestions">
          {found.suggestions.length === 0 && (
            <p className="text-[12.5px] text-gray-500 dark:text-gray-400">{found.reason ?? "Nothing to suggest yet."}</p>
          )}
          {found.suggestions.map((s) => {
            const added = text.split("\n").some((l) => l.trim() === s.preference.trim());
            return (
              <div key={s.preference} className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-gray-800 dark:text-gray-100">{s.preference}</p>
                  {s.evidence && <p className="text-[11.5px] text-gray-500 dark:text-gray-400">{s.evidence}</p>}
                </div>
                <button type="button" disabled={added} onClick={() => setText((t) => withPreference(t, s.preference))}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] ring-1 ring-indigo-200
                    dark:ring-indigo-500/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 disabled:opacity-40">
                  <Plus size={12} /> {added ? "Added" : "Add"}
                </button>
              </div>
            );
          })}
          {found.suggestions.length > 0 && (
            <p className="text-[11.5px] text-gray-400">Added lines apply once you save.</p>
          )}
        </div>
      )}
    </div>
  );
}
