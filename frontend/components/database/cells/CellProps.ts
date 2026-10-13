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
const PILL_PALETTE = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"].map(
  (c) => `bg-opt-${c}-bg text-opt-${c}-text`,
);

export function pillStyleFor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  return PILL_PALETTE[Math.abs(hash) % PILL_PALETTE.length];
}

// Notion's 10 option colors. These are what the `Edit property` panel's
// `Colors` list writes onto an option, so they have to be what the cell reads
// back — otherwise the colour picker is a control with no visible effect.
// Measured palette (app/tokens.css --opt-*): a translucent tint with dark text in
// light, a strong tint with pale text in dark. Class names are spelled out so
// Tailwind's scanner sees them.
const OPTION_PILL_CLASSES: Record<string, string> = {
  default: "bg-opt-default-bg text-opt-default-text",
  gray: "bg-opt-gray-bg text-opt-gray-text",
  brown: "bg-opt-brown-bg text-opt-brown-text",
  orange: "bg-opt-orange-bg text-opt-orange-text",
  yellow: "bg-opt-yellow-bg text-opt-yellow-text",
  green: "bg-opt-green-bg text-opt-green-text",
  blue: "bg-opt-blue-bg text-opt-blue-text",
  purple: "bg-opt-purple-bg text-opt-purple-text",
  pink: "bg-opt-pink-bg text-opt-pink-text",
  red: "bg-opt-red-bg text-opt-red-text",
};

/** Notion's select pill shape: 20px tall, radius 4px, padding 0 6px, 14px text. */
export const PILL_SHAPE = "inline-flex h-5 max-w-full items-center whitespace-nowrap rounded px-1.5 text-sm leading-5";
/** Status pills are rounder, with a leading 8px dot. */
export const STATUS_PILL_SHAPE =
  "inline-flex h-5 max-w-full items-center gap-[5px] whitespace-nowrap rounded-[10px] pl-[7px] pr-[9px] text-sm leading-5";

export interface ConfiguredOption {
  id: string;
  name: string;
  color?: string;
}

/** Pill classes for one value of a select/multi-select/status column.
 *
 * A CONFIGURED option (one the user created in `Edit property`) uses its own
 * colour. Anything else falls back to the hash palette above.
 *
 * The fallback is not dead code: these three cells are free-text today — they
 * store whatever is typed rather than an option id — so a column can perfectly
 * well hold values that are in no option list. Rebuilding them as real option
 * pickers is `cell-editing.md`'s surface, not this one; until then, matching by
 * NAME is what makes the colour picker take visible effect for every option a
 * user actually configured. */
export function pillStyleForOption(
  label: string,
  options: ConfiguredOption[] | undefined
): string {
  const match = options?.find((o) => o.name === label);
  if (!match) return pillStyleFor(label);
  return OPTION_PILL_CLASSES[match.color ?? "default"] ?? OPTION_PILL_CLASSES.default;
}

/** The option colour name ("blue", "default"…) for a value — its configured colour,
 * or a stable hashed one for free-text values (see pillStyleForOption). */
export function optionColorFor(label: string, options: ConfiguredOption[] | undefined): string {
  const match = options?.find((o) => o.name === label);
  if (match) return match.color ?? "default";
  const hues = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  return hues[Math.abs(hash) % hues.length];
}
