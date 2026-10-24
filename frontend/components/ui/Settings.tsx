// The layout of every Settings page (docs/notion-reference/surfaces/settings.md §3):
// a page title + description, sections with a 16px/500 header over a hairline, and
// rows with the label and help text on the left and the control on the right.
import type { ReactNode } from "react";
import { cx } from "./cx";

export function SettingsPage({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Right side of the page header, e.g. a primary "Add" button. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[800px]">
      <header className="mb-11 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-8 text-ink">{title}</h1>
          {description && <p className="mt-2 text-base leading-6 text-ink-secondary">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="flex flex-col gap-12">{children}</div>
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  /** Anchor for deep links (e.g. Settings → Notion ?tab=activity). */
  id?: string;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cx(id && "scroll-mt-4", className)}>
      {title && (
        <div className="mb-4 flex items-end justify-between gap-4 border-b border-line pb-3">
          <div>
            <h2 className="text-base font-medium leading-6 text-ink">{title}</h2>
            {description && <p className="mt-1 text-[13px] leading-[18px] text-ink-secondary">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  help,
  children,
  stacked,
  htmlFor,
  badge,
}: {
  label: ReactNode;
  help?: ReactNode;
  /** The control. */
  children?: ReactNode;
  /** Label and help on top, full-width control below (long inputs). */
  stacked?: boolean;
  htmlFor?: string;
  /** Small grey badge after the label, e.g. "Beta". */
  badge?: ReactNode;
}) {
  const text = (
    <div className={cx("min-w-0", !stacked && "max-w-[60%]")}>
      <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-sm font-medium leading-5 text-ink">
        {label}
        {badge && (
          <span className="rounded bg-surface-chip px-1 py-0.5 text-[11px] font-medium leading-none text-ink-icon">{badge}</span>
        )}
      </label>
      {help && <div className="mt-1 text-[13px] leading-[18px] text-ink-secondary">{help}</div>}
    </div>
  );
  if (stacked) {
    return (
      <div className="flex flex-col gap-3">
        {text}
        {children}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3">
      {text}
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
