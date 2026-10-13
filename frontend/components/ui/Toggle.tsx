// Notion's toggle switch: 30×18 track, 14px knob that slides 12px (menus-overlays.md §2).
// A real <button role="switch">, so it is keyboard- and screen-reader-correct.
import { cx } from "./cx";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name when no visible label is associated. */
  label?: string;
  id?: string;
  className?: string;
}

export function Toggle({ checked, onChange, disabled, label, id, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-[44px] p-0.5",
        "transition-colors duration-200",
        checked ? "bg-accent" : "bg-toggle-off",
        "disabled:opacity-40",
        className,
      )}
    >
      <span
        aria-hidden
        className={cx(
          "size-3.5 rounded-full bg-white transition-transform duration-200 ease-out",
          checked ? "translate-x-3" : "translate-x-0",
        )}
      />
    </button>
  );
}
