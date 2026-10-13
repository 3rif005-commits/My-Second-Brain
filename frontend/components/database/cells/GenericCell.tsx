import { currentPreferences } from "@/lib/preferences";
import { formatDate, toISODate } from "@/lib/formatDate";
import type { UnknownValue } from "@/lib/database/types";

// Fallback for any property `type` string without a dedicated cell
// component (e.g. `url`, `created_time`, `last_edited_time` — All Notes'
// `source_url`/`created_at`/`updated_at` columns). Always read-only: there's
// no per-type write coercion for these, so TableView never passes an
// `editable`/`onChange` here (spec brief: fall back to a plain read-only
// rendering rather than crashing or omitting the column).
function formatInner(value: UnknownValue): string {
  const inner = value[value.type];
  if (inner === null || inner === undefined) return "";
  if (typeof inner === "string") {
    // created_time/last_edited_time are ISO datetimes — render a bit more
    // readably than the raw string when it parses as one.
    if (/^\d{4}-\d{2}-\d{2}/.test(inner)) {
      const d = new Date(inner);
      if (!Number.isNaN(d.getTime())) {
        // "October 12, 2026 6:31 PM", in the user's date and time format.
        const prefs = currentPreferences();
        const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: prefs.timeFormat === "12h" });
        return `${formatDate(toISODate(d), prefs.dateFormat)} ${time}`;
      }
    }
    return inner;
  }
  return JSON.stringify(inner);
}

export function GenericCell({ value }: { value: UnknownValue | undefined }) {
  if (!value) return <span className="db-empty-cell">—</span>;
  const text = formatInner(value);
  return (
    <span className="truncate text-ink-secondary">
      {text || <span className="db-empty-cell">—</span>}
    </span>
  );
}
