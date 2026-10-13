"use client";

// Settings → Background jobs → Schedules: run a skill on a note daily or
// weekly, capped at a monthly amount. A schedule that hits its cap, or whose
// results keep going unopened, pauses itself and says why, with a way back in.
import { useCallback, useEffect, useState } from "react";
import { Clock, Pause, Plus, Trash2, X } from "lucide-react";
import { useNotes } from "@/lib/hooks/useNotes";
import {
  cadenceText, createSchedule, deleteSchedule, getNoteTrigger, getQuote, resumeSchedule, scheduleLine,
  usdText, listSchedules, type Cadence, type PriceMode, type Schedule, type TriggerOption,
} from "@/lib/backgroundJobs";
import { jobTitle } from "@/lib/workspace";

const WEEKDAYS = [
  { value: 1, label: "Monday" }, { value: 2, label: "Tuesday" }, { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" }, { value: 5, label: "Friday" }, { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

const field = "h-8 rounded-lg px-2 text-[12.5px] bg-transparent ring-1 ring-gray-200 dark:ring-white/10 text-gray-900 dark:text-gray-100";
const chip = "inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors disabled:opacity-50";

export function SchedulesSection() {
  const { notes } = useNotes();
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try { setSchedules(await listSchedules()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load schedules"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id); setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "That did not work"); }
    finally { setBusy(null); }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-gray-400">Schedules</h2>
        {!adding && (
          <button onClick={() => setAdding(true)} className={`${chip} ring-1 ring-gray-200 dark:ring-white/10`}>
            <Plus size={12} /> New schedule
          </button>
        )}
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-300 max-w-xl mb-3">
        Run a job on a note every day or every week. A run that would find nothing new is skipped, free.
      </p>

      {error && <p className="text-[12.5px] text-red-600 mb-2" role="alert">{error}</p>}

      {adding && (
        <NewScheduleForm notes={notes} onCancel={() => setAdding(false)}
          onCreated={() => { setAdding(false); void load(); }} />
      )}

      {schedules === null ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : schedules.length === 0 && !adding ? (
        <p className="text-sm text-gray-500" data-testid="schedules-empty">No schedule yet.</p>
      ) : (
        <ul className="space-y-2" data-testid="schedule-list">
          {schedules.map((s) => (
            <li key={s.id} className="rounded-xl ring-1 ring-gray-200 dark:ring-white/10 px-3 py-2.5"
              data-testid="schedule-row">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-gray-900 dark:text-gray-100">
                  <b>{jobTitle(s.skill)}</b> on <b>{s.note_title ?? "a deleted note"}</b>
                </span>
                <span className="ml-auto flex gap-1.5">
                  {s.paused_reason && (
                    <button className={chip} disabled={busy === s.id}
                      onClick={() => void act(s.id, () => resumeSchedule(s.id))}>Resume</button>
                  )}
                  <button className={chip} disabled={busy === s.id} aria-label="Delete this schedule"
                    onClick={() => void act(s.id, () => deleteSchedule(s.id))}>
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
              <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">
                {cadenceText(s.cadence)} · stops at {usdText(s.month_cap_usd)} a month
                {s.month_spent_usd > 0 ? ` · spent ${usdText(s.month_spent_usd)} this month` : ""}
              </p>
              {s.paused_reason && (
                <p className="text-[12px] text-amber-700 dark:text-amber-300 mt-0.5 flex items-center gap-1">
                  <Pause size={11} /> {s.paused_reason}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewScheduleForm({ notes, onCancel, onCreated }: {
  notes: { id: string; title: string }[]; onCancel: () => void; onCreated: () => void;
}) {
  const [noteId, setNoteId] = useState("");
  const [options, setOptions] = useState<TriggerOption[]>([]);
  const [skill, setSkill] = useState("");
  const [quote, setQuote] = useState<{ price_mode: PriceMode; usd: number | null } | null>(null);
  const [frequency, setFrequency] = useState<Cadence["frequency"]>("weekly");
  const [weekday, setWeekday] = useState(7);           // Sunday — the spec's own default
  const [time, setTime] = useState("22:00");
  const [cap, setCap] = useState("1.00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!noteId) { setOptions([]); setSkill(""); return; }
    let live = true;
    void getNoteTrigger(noteId).then((t) => { if (live) { setOptions(t.skills); setSkill(t.skills[0]?.skill ?? ""); } })
      .catch(() => { if (live) setOptions([]); });
    return () => { live = false; };
  }, [noteId]);

  const chosen = options.find((o) => o.skill === skill);
  useEffect(() => {
    if (!noteId || !skill || chosen?.runnable) { setQuote(null); return; }
    let live = true;
    void getQuote(noteId, skill, "").then((q) => { if (live) setQuote(q); }).catch(() => { if (live) setQuote(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, skill, chosen?.runnable]);

  const cadence: Cadence = { frequency, time_of_day: time, start_date: new Date().toISOString().slice(0, 10),
    ...(frequency === "weekly" ? { weekdays: [weekday] } : {}) };
  const capNum = Number(cap);
  const validCap = cap.trim() !== "" && Number.isFinite(capNum) && capNum > 0;
  const canSave = noteId && skill && time && validCap && !chosen?.runnable;

  async function save() {
    setSaving(true); setError(null);
    try { await createSchedule(noteId, skill, cadence, capNum); onCreated(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save"); }
    finally { setSaving(false); }
  }

  return (
    <div className="rounded-xl ring-1 ring-gray-200 dark:ring-white/10 p-3 mb-3 space-y-2.5" data-testid="new-schedule-form">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Note" className={field} value={noteId} onChange={(e) => setNoteId(e.target.value)}>
          <option value="">Choose a note…</option>
          {notes.map((n) => <option key={n.id} value={n.id}>{n.title || "Untitled"}</option>)}
        </select>
        <select aria-label="Job" className={field} value={skill} disabled={!noteId || options.length === 0}
          onChange={(e) => setSkill(e.target.value)}>
          {options.length === 0 && <option value="">{noteId ? "Nothing can run here yet" : "Pick a note first"}</option>}
          {options.map((o) => <option key={o.skill} value={o.skill}>{jobTitle(o.skill)}</option>)}
        </select>
      </div>
      {chosen?.runnable && <p className="text-[12px] text-amber-700">{jobTitle(skill)}: {chosen.runnable}.</p>}
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-gray-600 dark:text-gray-300">
        <span>Every</span>
        <select aria-label="Frequency" className={field} value={frequency}
          onChange={(e) => setFrequency(e.target.value as Cadence["frequency"])}>
          <option value="daily">day</option>
          <option value="weekly">week</option>
        </select>
        {frequency === "weekly" && (
          <>
            <span>on</span>
            <select aria-label="Day of the week" className={field} value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </>
        )}
        <span>at</span>
        <input aria-label="Time (UTC)" type="time" className={field} value={time}
          onChange={(e) => setTime(e.target.value)} />
        <span className="text-gray-400">(UTC)</span>
      </div>
      <div className="flex items-center gap-2 text-[12.5px] text-gray-600 dark:text-gray-300">
        <span>Stop at</span>
        <span>$</span>
        <input aria-label="Monthly limit for this schedule" inputMode="decimal" className={`${field} w-20`}
          value={cap} onChange={(e) => setCap(e.target.value)} />
        <span>a month</span>
      </div>
      {chosen && !chosen.runnable && (
        <p className="text-[12px] text-gray-500">
          {quote ? scheduleLine(quote.price_mode, quote.usd, cadence, capNum || 0) : "Checking the price…"}
        </p>
      )}
      {error && <p className="text-[12px] text-red-600">{error}</p>}
      <div className="flex gap-1.5 pt-0.5">
        <button onClick={() => void save()} disabled={!canSave || saving}
          className="h-8 px-3.5 rounded-full bg-accent-600 text-white text-[12.5px] font-medium hover:bg-accent-500 disabled:opacity-40">
          Save
        </button>
        <button onClick={onCancel} className={chip}><X size={12} /> Cancel</button>
      </div>
    </div>
  );
}
