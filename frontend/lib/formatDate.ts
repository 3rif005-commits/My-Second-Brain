// Date display in the user's chosen format (Settings → Preferences → Date format).
// Notion's default in databases is "Full date": "October 3, 2026"; ranges join with " → ".
import type { DateFormat } from "./preferences";

/** Parse "2026-10-03" as a LOCAL date (not UTC midnight, which shifts a day west of GMT). */
export function parseISODate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(iso);
}

export function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function formatDate(iso: string, format: DateFormat = "full"): string {
  const d = parseISODate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const mo = p(d.getMonth() + 1);
  const da = p(d.getDate());
  switch (format) {
    case "short":
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    case "mdy":
      return `${mo}/${da}/${y}`;
    case "dmy":
      return `${da}/${mo}/${y}`;
    case "ymd":
      return `${y}/${mo}/${da}`;
    case "relative": {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
      if (days === 0) return "Today";
      if (days === 1) return "Tomorrow";
      if (days === -1) return "Yesterday";
      return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
    }
    default:
      return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  }
}

export function formatDateRange(start: string, end: string | null | undefined, format: DateFormat = "full"): string {
  return end ? `${formatDate(start, format)} → ${formatDate(end, format)}` : formatDate(start, format);
}
