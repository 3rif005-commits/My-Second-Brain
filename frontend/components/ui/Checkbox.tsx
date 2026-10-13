// Notion's checkbox: 16×16, radius 3px, 1px warm border; checked = solid accent with a
// white check (checklist #166). A native input underneath keeps forms, labels and
// keyboard behaviour; it is visually replaced, not removed.
import { forwardRef, type InputHTMLAttributes } from "react";
import { cx } from "./cx";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name when no visible label wraps it. */
  label?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ checked, onChange, label, className, disabled, ...props }, ref) => (
    <span className={cx("relative inline-flex size-4 shrink-0", disabled && "opacity-40", className)}>
      <input
        ref={ref}
        type="checkbox"
        data-kit
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
        className="peer absolute inset-0 m-0 cursor-pointer appearance-none rounded-xs focus-visible:shadow-focus"
        {...props}
      />
      <span
        aria-hidden
        className={cx(
          "pointer-events-none flex size-4 items-center justify-center rounded-xs transition-colors duration-instant",
          checked ? "bg-accent" : "border border-line-checkbox peer-hover:bg-surface-hover",
        )}
      >
        {checked && (
          <svg viewBox="0 0 14 14" className="size-3 text-white" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7.5l2.5 2.5L11 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </span>
  ),
);
Checkbox.displayName = "Checkbox";
