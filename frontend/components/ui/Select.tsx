"use client";

// Notion's select: an outlined 28px button ("Light ⌄") that opens a menu, right-aligned
// 4px below, with a ✓ at the right of the selected option and no selected background
// (settings.md §4). Replaces the native <select>.
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover } from "./primitives/Popover";
import { cx } from "./cx";

export interface SelectOption<V extends string = string> {
  value: V;
  label: ReactNode;
  /** Second line in grey (e.g. a language's English name). */
  description?: ReactNode;
  /** Grey text at the right (e.g. a date-format example). */
  hint?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<V extends string = string> {
  value: V;
  options: SelectOption<V>[];
  onChange: (value: V) => void;
  /** Accessible name for the button. */
  label: string;
  disabled?: boolean;
  /** "outlined" (settings, default) or "ghost" (inline toolbars: no border). */
  variant?: "outlined" | "ghost";
  align?: "start" | "end";
  /** Menu width in px; defaults to 250 (Notion's settings dropdown). */
  menuWidth?: number;
  placeholder?: ReactNode;
  className?: string;
}

export function Select<V extends string = string>({
  value,
  options,
  onChange,
  label,
  disabled,
  variant = "outlined",
  align = "end",
  menuWidth = 250,
  placeholder = "Select…",
  className,
}: SelectProps<V>) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  function onListKey(e: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]:not(:disabled)") ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align={align}
      width={menuWidth}
      label={label}
      trigger={
        <button
          type="button"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          className={cx(
            "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink",
            variant === "outlined" && "border border-line-strong",
            "hover:bg-surface-active data-[state=open]:bg-surface-active",
            "disabled:opacity-40 disabled:pointer-events-none transition-colors duration-instant",
            className,
          )}
        >
          {current?.icon}
          <span className="truncate">{current ? current.label : <span className="text-ink-tertiary">{placeholder}</span>}</span>
          <ChevronDown className="size-3.5 shrink-0 text-ink-icon" aria-hidden />
        </button>
      }
    >
      <div ref={listRef} role="listbox" aria-label={label} className="p-1" onKeyDown={onListKey}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={o.disabled}
              autoFocus={selected}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={cx(
                "flex w-full items-center gap-2 rounded-md px-2 text-left text-sm text-ink",
                o.description ? "min-h-[40px] py-1" : "h-7",
                "hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:shadow-none",
                "disabled:opacity-40",
              )}
            >
              {o.icon && <span className="flex size-5 shrink-0 items-center justify-center text-ink-icon">{o.icon}</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{o.label}</span>
                {o.description && <span className="block truncate text-xs text-ink-secondary">{o.description}</span>}
              </span>
              {o.hint && <span className="shrink-0 text-xs text-ink-tertiary">{o.hint}</span>}
              {selected && <Check className="size-4 shrink-0 text-ink" aria-hidden />}
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
