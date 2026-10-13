"use client";

// Notion's page top bar (shell.md §2): 44px, no background/border/shadow;
// breadcrumbs on the left (24px items, radius 6px, 14px text, 18px icons), and on the
// right plain 28px buttons (Share is a text button, never blue) ending in the `⋯` menu.
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { cx } from "@/components/ui/cx";

export interface Crumb {
  label: string;
  icon?: ReactNode;
  href?: string;
}

export function TopBar({
  crumbs,
  meta,
  children,
  className,
}: {
  crumbs: Crumb[];
  /** Small grey text after the crumbs, e.g. "Saving…" or "Edited 3m ago". */
  meta?: ReactNode;
  /** Right cluster: Share, star, `⋯`… */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cx(
        "no-print flex h-11 shrink-0 items-center gap-2 bg-surface px-3",
        // Leave room for the "open sidebar" hamburger when the sidebar is folded.
        "group-data-[sidebar=collapsed]/shell:md:pl-11",
        className,
      )}
    >
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center">
        {crumbs.map((c, i) => {
          const inner = (
            <>
              {c.icon && <span className="mr-[5px] flex size-[18px] shrink-0 items-center justify-center text-[14px] leading-none">{c.icon}</span>}
              <span className="truncate">{c.label}</span>
            </>
          );
          const cls = "flex h-6 min-w-0 max-w-[200px] items-center rounded-md pl-[3px] pr-[5px] text-sm leading-[16.8px] text-ink";
          return (
            <Fragment key={i}>
              {i > 0 && <span className="mx-0.5 shrink-0 text-ink-tertiary">/</span>}
              {c.href ? (
                <Link href={c.href} className={cx(cls, "hover:bg-surface-active")}>
                  {inner}
                </Link>
              ) : (
                <span className={cls} aria-current={i === crumbs.length - 1 ? "page" : undefined}>
                  {inner}
                </span>
              )}
            </Fragment>
          );
        })}
        {meta && <span className="ml-2 shrink-0 truncate text-sm text-ink-tertiary">{meta}</span>}
      </nav>
      <div className="flex shrink-0 items-center gap-0.5">{children}</div>
    </header>
  );
}

/** A 28px top-bar button: icon-only (with a label) or plain text like "Share". */
export function TopBarButton({
  label,
  children,
  onClick,
  active,
  text,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  /** Render as a text button ("Share") rather than a square icon button. */
  text?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={text ? undefined : label}
      title={label}
      className={cx(
        "flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md text-sm text-ink transition-colors duration-fast hover:bg-surface-active",
        text ? "px-2" : "w-7 text-ink-icon [&>svg]:size-5",
        active && "text-ink-icon-strong",
      )}
    >
      {children}
    </button>
  );
}
