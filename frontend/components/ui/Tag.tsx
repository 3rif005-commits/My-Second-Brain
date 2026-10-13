// Database option pills (checklist #158-162). Two shapes:
//   select / multi-select: 20px tall, radius 4px, padding 0 6px, 14px text
//   status:                20px tall, radius 10px, padding 0 9px 0 7px, 8px dot + 5px gap
// Colours come from the measured option palette (tokens.css --opt-*), in light and dark.
import type { ReactNode } from "react";
import { cx } from "./cx";

export const OPTION_COLORS = [
  "default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red",
] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];

export function isOptionColor(c: unknown): c is OptionColor {
  return typeof c === "string" && (OPTION_COLORS as readonly string[]).includes(c);
}

export interface TagProps {
  color?: string;
  children: ReactNode;
  /** Status pills: rounder, with a coloured dot. */
  status?: boolean;
  className?: string;
  /** Trailing element, e.g. the × remove button in the select editor. */
  trailing?: ReactNode;
}

export function Tag({ color = "default", children, status, className, trailing }: TagProps) {
  const c = isOptionColor(color) ? color : "default";
  return (
    <span
      className={cx(
        "inline-flex h-5 max-w-full shrink-0 items-center whitespace-nowrap text-sm leading-5",
        status ? "rounded-[10px] pl-[7px] pr-[9px] gap-[5px]" : "rounded px-1.5",
        className,
      )}
      style={{ background: `var(--opt-${c}-bg)`, color: `var(--opt-${c}-text)` }}
    >
      {status && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: `var(--opt-${c}-dot)` }} />}
      <span className="truncate">{children}</span>
      {trailing}
    </span>
  );
}
