"use client";

// Date cell: Notion's long form ("October 3, 2026", ranges with " → ") in the user's
// chosen date format, and a single click opens Notion's date picker card.
import { useState } from "react";
import type { DateValue } from "@/lib/database/types";
import type { CellProps } from "./CellProps";
import { Popover } from "@/components/ui/primitives/Popover";
import { DatePicker } from "@/components/ui/DatePicker";
import { formatDateRange } from "@/lib/formatDate";
import { usePreferences } from "@/app/providers";

export function DateCell({ value, editable, onChange }: CellProps<DateValue>) {
  const { preferences } = usePreferences();
  const start = value?.date?.start ?? null;
  const end = value?.date?.end ?? null;
  const [open, setOpen] = useState(false);

  const text = start ? (
    <span className="text-ink">{formatDateRange(start.slice(0, 10), end?.slice(0, 10), preferences.dateFormat)}</span>
  ) : (
    <span className="db-empty-cell">—</span>
  );

  if (!editable) return text;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      width={248}
      label="Date picker"
      className="!rounded-md"
      trigger={
        <button type="button" className="-mx-1 w-full rounded px-1 text-left">
          {text}
        </button>
      }
    >
      <DatePicker
        value={start ? { start: start.slice(0, 10), end: end ? end.slice(0, 10) : null } : null}
        weekStartsOnMonday={preferences.startWeekOnMonday}
        onChange={(next) =>
          onChange(
            next
              ? { type: "date", date: { start: next.start, end: next.end, time_zone: value?.date?.time_zone ?? null } }
              : { type: "date", date: null },
          )
        }
      />
    </Popover>
  );
}
