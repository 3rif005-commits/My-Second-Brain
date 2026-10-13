// Quiet empty and loading states. Notion shows short grey copy and at most an outlined
// button, never a big illustration (menus-overlays.md §10).
import type { ReactNode } from "react";
import { cx } from "./cx";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      {icon && <div className="mb-1 text-ink-icon-subtle [&>svg]:size-8">{icon}</div>}
      <p className="text-sm font-medium text-ink-secondary">{title}</p>
      {description && <p className="max-w-sm text-[13px] leading-[18px] text-ink-tertiary">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Notion's loading skeleton: rows of a small rounded square and a bar, 35px apart. */
export function Skeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-[9px]", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-[26px] items-center gap-2.5">
          <div className="size-[26px] animate-pulse rounded-md bg-surface-chip" />
          <div className="h-3.5 animate-pulse rounded bg-surface-chip" style={{ width: `${40 + ((i * 37) % 45)}%` }} />
        </div>
      ))}
    </div>
  );
}
