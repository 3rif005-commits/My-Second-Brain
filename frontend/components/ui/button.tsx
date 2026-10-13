// Notion's buttons (docs/notion-reference/surfaces/menus-overlays.md §4, settings.md §4).
// Every button in the app goes through here so hover, disabled (opacity 0.4) and the
// keyboard-only focus ring stay identical everywhere.
import { ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import { cx } from "./cx";

export type ButtonVariant =
  | "primary" // blue fill
  | "secondary" // outlined, primary text
  | "ghost" // no border, grey text, hover bg only
  | "danger" // outlined red (confirm dialogs)
  | "danger-soft" // pale red fill (settings "Delete…")
  | "accent-soft" // blue tint fill ("Copy link")
  | "link"; // 12px blue text ("Hide all")

export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** sm = 28px (Notion's default), md = 32px (dialogs). */
  size?: ButtonSize;
  /** Leading icon (16px). */
  icon?: ReactNode;
  /** Stretch to the container width. */
  block?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-ink-on-accent hover:bg-accent-hover",
  secondary: "border border-line-strong text-ink hover:bg-surface-hover",
  ghost: "text-ink-secondary hover:bg-surface-hover",
  danger: "border border-[color:var(--opt-red-bg)] text-ink-danger hover:bg-surface-hover",
  "danger-soft": "bg-surface-danger-soft text-ink-danger hover:brightness-95",
  "accent-soft": "bg-accent-chip text-accent hover:brightness-95",
  link: "text-accent text-xs px-1.5 h-auto py-0.5 hover:bg-surface-hover",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2 gap-1.5",
  md: "h-8 px-3 gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "sm", icon, block, className = "", children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cx(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium select-none",
        "transition-[background,filter] duration-instant ease-in",
        "disabled:opacity-40 disabled:pointer-events-none",
        variant !== "link" && SIZES[size],
        VARIANTS[variant],
        block && "w-full",
        className,
      )}
      {...props}
    >
      {icon && <span className="flex shrink-0 items-center [&>svg]:size-4">{icon}</span>}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name; also the tooltip text when wrapped in <Tooltip>. */
  label: string;
  /** 28 (toolbar, default) | 24 (row hover controls) | 20 (inline). */
  size?: 20 | 24 | 28;
  /** Highlighted state, e.g. an active filter. */
  active?: boolean;
  /** Round instead of 6px corners (close buttons, sidebar «). */
  round?: boolean;
}

const ICON_SIZES = { 20: "size-5 [&>svg]:size-3.5", 24: "size-6 [&>svg]:size-4", 28: "size-7 [&>svg]:size-4" };

/** Square icon-only button: the toolbar, row-hover and close buttons. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, size = 28, active, round, className = "", children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={props.title}
      className={cx(
        "inline-flex shrink-0 items-center justify-center select-none",
        round ? "rounded-full" : size === 20 ? "rounded" : "rounded-md",
        ICON_SIZES[size],
        active ? "text-accent" : "text-ink-icon",
        "hover:bg-surface-hover transition-colors duration-fast ease-in-out",
        "disabled:opacity-40 disabled:pointer-events-none",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
);
IconButton.displayName = "IconButton";
