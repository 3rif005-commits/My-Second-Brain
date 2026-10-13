"use client";

// The rail's one-line trigger: "When I add a source here: Suggest ▾". Picking
// a skill turns on a background job for every future drop on this note; the
// global default (workspace_on_drop = suggest) is untouched — this is one
// note's explicit opt-in, and it is the only way a note runs anything unasked.
import { useCallback, useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { getNoteTrigger, putNoteTrigger, usdText, type TriggerOption } from "@/lib/backgroundJobs";
import { jobTitle } from "@/lib/workspace";

const SUGGEST = "";

export function SourceTrigger({ noteId }: { noteId: string }) {
  const [skill, setSkill] = useState<string | null>(null);
  const [options, setOptions] = useState<TriggerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await getNoteTrigger(noteId);
      setSkill(t.skill);
      setOptions(t.skills);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load"); }
    finally { setLoading(false); }
  }, [noteId]);

  useEffect(() => { setLoading(true); void load(); }, [load]);

  async function choose(value: string) {
    const next = value === SUGGEST ? null : value;
    setSaving(true); setError(null);
    try { await putNoteTrigger(noteId, next); setSkill(next); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save"); }
    finally { setSaving(false); }
  }

  const runnable = options.filter((o) => !o.runnable);
  const active = skill ? options.find((o) => o.skill === skill) : null;

  return (
    <div className="shrink-0 px-2.5 py-1.5 border-t border-gray-100 dark:border-white/5"
      data-testid="source-trigger">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
        <Clock size={11} className="shrink-0" />
        <span className="shrink-0">When I add a source here:</span>
        <select
          aria-label="When I add a source here"
          value={skill ?? SUGGEST}
          disabled={loading || saving || runnable.length === 0}
          onChange={(e) => void choose(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-gray-600 dark:text-gray-300 text-[11px]
            rounded-md px-1 py-0.5 -ml-1 hover:bg-gray-100 dark:hover:bg-white/10
            disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-400"
        >
          <option value={SUGGEST}>Suggest (don&apos;t run)</option>
          {runnable.map((o) => (
            <option key={o.skill} value={o.skill}>
              {jobTitle(o.skill)}, in the background{o.usd !== null ? ` — ≈${usdText(o.usd)} per source` : ""}
            </option>
          ))}
        </select>
      </div>
      {active && (
        <p className="mt-0.5 pl-[17px] text-[11px] text-gray-400 dark:text-gray-500">
          New sources → {active.title} (background){" · "}
          <button onClick={() => void choose(SUGGEST)} disabled={saving}
            className="text-accent-500 hover:underline disabled:opacity-50">
            Turn off
          </button>
        </p>
      )}
      {error && <p className="mt-0.5 pl-[17px] text-[11px] text-amber-600">{error}</p>}
    </div>
  );
}
