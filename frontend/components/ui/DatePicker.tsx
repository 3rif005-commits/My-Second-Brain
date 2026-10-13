"use client";

// Notion's date picker (database-table.md §9.4): a 248px card with a text field, a
// month caption with Today and ‹ ›, a cool-grey weekday row, six week rows of 28px
// day buttons (today = white number on a red disc, selected = solid blue, range =
// a soft blue band), then End date and Clear.
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "./cx";
import { parseISODate, toISODate } from "@/lib/formatDate";

export interface DateRangeValue {
  start: string;
  end: string | null;
}

export interface DatePickerProps {
  value: DateRangeValue | null;
  onChange: (value: DateRangeValue | null) => void;
  /** Start the week on Monday (Settings → Preferences). */
  weekStartsOnMonday?: boolean;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function parseTyped(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : toISODate(d);
}

const short = (iso: string) => parseISODate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function DatePicker({ value, onChange, weekStartsOnMonday }: DatePickerProps) {
  const initial = value?.start ? parseISODate(value.start) : new Date();
  const [month, setMonth] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));
  const [editingEnd, setEditingEnd] = useState(false);
  const [startText, setStartText] = useState(value?.start ? short(value.start) : "");
  const [endText, setEndText] = useState(value?.end ? short(value.end) : "");
  const hasEnd = value?.end != null;

  const weekdays = weekStartsOnMonday ? [...WEEKDAYS.slice(1), WEEKDAYS[0]] : WEEKDAYS;
  const days = useMemo(() => {
    const offset = (month.getDay() - (weekStartsOnMonday ? 1 : 0) + 7) % 7;
    const first = new Date(month.getFullYear(), month.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
  }, [month, weekStartsOnMonday]);
  const todayISO = toISODate(new Date());

  function pick(iso: string) {
    if (hasEnd && value) {
      // Range: fill whichever end is being edited, keeping start <= end.
      let start = editingEnd ? value.start : iso;
      let end = editingEnd ? iso : value.end ?? iso;
      if (start > end) [start, end] = [end, start];
      setStartText(short(start));
      setEndText(short(end));
      setEditingEnd(!editingEnd);
      onChange({ start, end });
    } else {
      setStartText(short(iso));
      onChange({ start: iso, end: null });
    }
  }

  function commitTyped(which: "start" | "end", text: string) {
    const iso = parseTyped(text);
    if (!iso) return;
    const d = parseISODate(iso);
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    if (which === "start") onChange({ start: iso, end: value?.end ?? null });
    else if (value) onChange({ start: value.start, end: iso });
  }

  const field = (active: boolean) =>
    cx(
      "h-7 min-w-0 flex-1 rounded-md px-2 text-sm text-ink outline-none",
      active ? "bg-[rgba(35,131,226,0.15)] shadow-[inset_0_0_0_2px_rgb(39,131,222)]" : "bg-surface-field shadow-[inset_0_0_0_1px_var(--c-border-strong)] focus:shadow-input",
    );

  const row = "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-ink hover:bg-surface-hover";

  return (
    <div className="w-[248px] p-3 pb-1.5">
      <div className="flex gap-[11px]">
        <input
          aria-label="Date"
          autoFocus
          value={startText}
          placeholder="Date"
          onFocus={(e) => {
            e.target.select();
            setEditingEnd(false);
          }}
          onChange={(e) => setStartText(e.target.value)}
          onBlur={(e) => commitTyped("start", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitTyped("start", (e.target as HTMLInputElement).value);
          }}
          className={field(hasEnd && !editingEnd)}
        />
        {hasEnd && (
          <input
            aria-label="End date"
            value={endText}
            onFocus={(e) => {
              e.target.select();
              setEditingEnd(true);
            }}
            onChange={(e) => setEndText(e.target.value)}
            onBlur={(e) => commitTyped("end", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTyped("end", (e.target as HTMLInputElement).value);
            }}
            className={field(editingEnd)}
          />
        )}
      </div>

      <div className="mt-3 flex items-center justify-between px-1">
        <span className="text-sm font-medium text-ink">
          {month.toLocaleDateString(undefined, { month: "short", year: "numeric" })}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              const t = new Date();
              setMonth(new Date(t.getFullYear(), t.getMonth(), 1));
            }}
            className="h-5 rounded-xs px-2 text-xs font-medium text-ink-icon hover:bg-surface-hover"
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            className="flex size-5 items-center justify-center rounded-xs text-[rgb(165,165,165)] hover:bg-surface-hover"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            className="flex size-5 items-center justify-center rounded-xs text-[rgb(165,165,165)] hover:bg-surface-hover"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-7 text-center text-xs leading-[18px] text-[rgb(139,152,152)]">
        {weekdays.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7" role="grid" aria-label="Calendar">
        {days.map((d) => {
          const iso = toISODate(d);
          const inMonth = d.getMonth() === month.getMonth();
          const isStart = value?.start === iso;
          const isEnd = value?.end === iso;
          const inRange = hasEnd && value && iso > value.start && iso < (value.end as string);
          const isToday = iso === todayISO;
          return (
            <div key={iso} className={cx("flex size-8 items-center justify-center", inRange && "bg-[rgba(35,131,226,0.21)]")}>
              <button
                type="button"
                aria-label={d.toDateString()}
                aria-pressed={isStart || isEnd}
                onClick={() => pick(iso)}
                className={cx(
                  "relative flex size-7 items-center justify-center rounded-md text-sm",
                  isStart || isEnd
                    ? "bg-accent text-white"
                    : isToday
                      ? "text-white"
                      : inMonth
                        ? "text-ink hover:bg-[rgba(35,131,226,0.15)]"
                        : "text-[rgb(139,152,152)] hover:bg-[rgba(35,131,226,0.15)]",
                )}
              >
                {isToday && !(isStart || isEnd) && (
                  <span aria-hidden className="absolute size-6 rounded-full bg-ink-danger" />
                )}
                <span className="relative">{d.getDate()}</span>
              </button>
            </div>
          );
        })}
      </div>

      <div className="mx-[-4px] mt-2 border-t border-line pt-1">
        <button
          type="button"
          role="switch"
          aria-checked={hasEnd}
          onClick={() => {
            if (!value) return;
            if (hasEnd) {
              setEndText("");
              onChange({ start: value.start, end: null });
            } else {
              setEndText(short(value.start));
              setEditingEnd(true);
              onChange({ start: value.start, end: value.start });
            }
          }}
          className={row}
          disabled={!value}
        >
          <span className="flex-1">End date</span>
          <span className={cx("relative inline-flex h-[18px] w-[30px] items-center rounded-[44px] p-0.5 transition-colors duration-200", hasEnd ? "bg-accent" : "bg-toggle-off")}>
            <span className={cx("size-3.5 rounded-full bg-white transition-transform duration-200 ease-out", hasEnd && "translate-x-3")} />
          </span>
        </button>
        <div className="my-1 h-px bg-line" />
        <button
          type="button"
          onClick={() => {
            setStartText("");
            setEndText("");
            onChange(null);
          }}
          className={row}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
