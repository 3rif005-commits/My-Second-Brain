// Shared contract for the 8 dedicated cell components (TitleCell,
// TextCell, NumberCell, SelectCell, MultiSelectCell, StatusCell, DateCell,
// CheckboxCell) plus the pill-color helper they share for Select/
// Multi-select/Status.

export interface CellProps<V> {
  /** Undefined means the property is absent for this row (spec: "Absent key ≡ empty"). */
  value: V | undefined;
  /** All Notes cells are always read-only for M2 (no write endpoint yet — see
   * `update_row_property`'s 501 for `data_source_id === "all-notes"`).
   * Ordinary (non-virtual) databases pass true. */
  editable: boolean;
  /** Commit a new value, or `null` to clear the property, through
   * `useDatabaseView`'s optimistic update. Never called when `editable` is false. */
  onChange: (value: V | null) => void;
}

// A small, stable palette so pills for arbitrary option strings (this
// milestone doesn't guarantee `property.config` carries per-option colors)
// still look visually distinct and are deterministic between renders of
// the same label.
const PILL_PALETTE = [
  "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  "bg-amber-50 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400",
  "bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400",
  "bg-green-50 text-green-600 dark:bg-green-900/40 dark:text-green-400",
  "bg-purple-50 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400",
  "bg-pink-50 text-pink-600 dark:bg-pink-900/40 dark:text-pink-400",
  "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400",
];

export function pillStyleFor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  return PILL_PALETTE[Math.abs(hash) % PILL_PALETTE.length];
}
