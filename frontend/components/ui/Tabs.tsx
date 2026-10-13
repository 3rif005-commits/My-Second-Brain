// Pill tabs: database view tabs (32px, radius 20px, 14px/500) and settings sub-tabs
// (28px, fully round). Active = soft bg + primary text; inactive = secondary text, no bg,
// no underline (checklist #128-130, #326).
import type { ReactNode } from "react";
import { cx } from "./cx";

export interface TabItem<V extends string = string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
}

export interface TabsProps<V extends string = string> {
  items: TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  /** "view" = database view tabs (32px), "sub" = settings sub-tabs (28px). */
  size?: "view" | "sub";
  label: string;
  className?: string;
}

export function Tabs<V extends string = string>({ items, value, onChange, size = "sub", label, className }: TabsProps<V>) {
  return (
    <div role="tablist" aria-label={label} className={cx("flex items-center gap-0.5 overflow-x-auto", className)}>
      {items.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cx(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors duration-instant",
              size === "view" ? "h-8 rounded-[20px] px-3" : "h-7 rounded-full px-2.5",
              active ? "bg-surface-active text-ink" : "text-ink-secondary hover:bg-surface-hover",
            )}
          >
            {t.icon && <span className="flex [&>svg]:size-4">{t.icon}</span>}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
