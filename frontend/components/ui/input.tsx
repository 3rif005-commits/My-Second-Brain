// Notion's field: a faint warm fill with a 1px inset ring that turns blue on focus
// (settings.md §4, menus-overlays.md §5).
import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef, type ReactNode } from "react";
import { cx } from "./cx";

const FIELD =
  "w-full rounded-md bg-surface-field text-ink text-sm placeholder:text-ink-placeholder " +
  "shadow-[inset_0_0_0_1px_var(--c-border-strong)] focus:shadow-input outline-none " +
  "disabled:opacity-40 transition-shadow duration-fast";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** 28px (inline, default) or 34px/15px (stacked settings field). */
  inputSize?: "sm" | "lg";
  /** Leading icon, e.g. a search glass. */
  icon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", inputSize = "sm", icon, ...props }, ref) => {
    const input = (
      <input
        ref={ref}
        className={cx(
          FIELD,
          inputSize === "lg" ? "h-[34px] px-2.5 text-[15px]" : "h-7 px-2.5",
          icon ? "pl-7" : undefined,
          className,
        )}
        {...props}
      />
    );
    if (!icon) return input;
    return (
      <div className="relative w-full">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-icon [&>svg]:size-3.5">
          {icon}
        </span>
        {input}
      </div>
    );
  },
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = "", ...props }, ref) => (
    <textarea ref={ref} className={cx(FIELD, "min-h-[80px] px-2.5 py-1.5 leading-5", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";
