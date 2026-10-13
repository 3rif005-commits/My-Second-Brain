"use client";

// Settings → Background jobs: the rules. For now, the monthly limit — what
// background jobs may spend in a calendar month before they are refused. A job
// you run yourself, watching, is never blocked by it. What happened is on the
// Activity page.
import Link from "next/link";
import { useEffect, useState } from "react";
import { getJobSettings, putJobSettings, usdText, type JobSettings } from "@/lib/backgroundJobs";
import { SchedulesSection } from "@/components/settings/SchedulesSection";

export default function BackgroundJobsSettings() {
  const [s, setS] = useState<JobSettings | null>(null);
  const [value, setValue] = useState("");
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getJobSettings().then((x) => { setS(x); setValue(String(x.monthly_cap_usd)); })
      .catch((e) => setNote({ text: e instanceof Error ? e.message : "Could not load", bad: true }));
  }, []);

  const parsed = Number(value);
  const valid = s !== null && value.trim() !== "" && Number.isFinite(parsed) && parsed >= s.min_usd && parsed <= s.max_usd;
  const dirty = s !== null && valid && parsed !== s.monthly_cap_usd;

  async function save() {
    setSaving(true); setNote(null);
    try {
      const r = await putJobSettings(parsed);
      setS((x) => x && { ...x, monthly_cap_usd: r.monthly_cap_usd, month_spent_usd: r.month_spent_usd });
      setValue(String(r.monthly_cap_usd));
      setNote({ text: `Saved — the limit is ${usdText(r.monthly_cap_usd)} a month.`, bad: false });
    } catch (e) { setNote({ text: e instanceof Error ? e.message : "Could not save", bad: true }); }
    finally { setSaving(false); }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="w-full space-y-8" data-testid="background-settings">
        <div>
          <h1 className="text-[26px] font-semibold leading-8 text-ink">Background jobs</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Jobs you queue with Run later. What ran is on the <Link href="/brain/activity" className="text-accent-600 hover:underline">Activity</Link> page.
          </p>
        </div>

        <section>
          <h2 className="mb-4 border-b border-line pb-3 text-base font-medium text-ink">Monthly limit</h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 max-w-xl">
            Background jobs are not started once your AI use this calendar month would pass this amount.
            It counts everything the AI cost you, not only background jobs. Jobs you run yourself are never blocked by it.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-gray-500">$</span>
            <input aria-label="Monthly limit in dollars" inputMode="decimal" value={value}
              onChange={(e) => { setValue(e.target.value); setNote(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" && dirty) void save(); }}
              className="w-28 h-9 rounded-lg px-3 text-sm bg-transparent ring-1 ring-gray-200 dark:ring-white/10 text-gray-900 dark:text-gray-100" />
            <button onClick={() => void save()} disabled={!dirty || saving}
              className="h-9 px-4 rounded-md bg-accent text-ink-on-accent text-[12.5px] font-medium hover:bg-accent-hover disabled:opacity-40">
              Save
            </button>
          </div>
          {s && value.trim() !== "" && !valid && (
            <p className="mt-2 text-[12.5px] text-amber-700">Enter an amount between {usdText(s.min_usd)} and {usdText(s.max_usd)}.</p>
          )}
          {s && <p className="mt-2 text-[12.5px] text-gray-500" data-testid="spent-line">
            Spent so far this month: {s.month_spent_usd === 0 ? "$0" : usdText(s.month_spent_usd)}.
          </p>}
          {note && <p className={`mt-2 text-[12.5px] ${note.bad ? "text-red-600" : "text-emerald-600"}`} role="status" data-testid="settings-note">{note.text}</p>}
        </section>

        <SchedulesSection />
      </div>
    </div>
  );
}
