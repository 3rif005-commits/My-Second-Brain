"use client";

// Small floating action popover shown when an element or selection is active
// in a source viewer. One-click "send to note" per the workspace spec.
import type { ReactNode } from "react";

export function ActionBar({
  x, y, children,
}: { x: number; y: number; children: ReactNode }) {
  return (
    <div
      className="ws-rise absolute z-30 flex items-center gap-0.5 rounded-lg border border-line-strong bg-surface-elevated p-1 text-[13px] text-ink shadow-float"
      style={{ left: x, top: y, transform: "translate(-50%, -115%)" }}
      onMouseDown={(e) => e.preventDefault()} // keep text selection alive
    >
      {children}
    </div>
  );
}

export function ActionButton({
  onClick, children, title, primary,
}: {
  onClick: () => void;
  children: ReactNode;
  title?: string;
  /** The one action that matters most in this popover. */
  primary?: boolean;
}) {
  return (
    <button
      title={title}
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md whitespace-nowrap font-medium
        transition-colors duration-instant
        focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/70 ${
        primary
          ? "bg-accent text-ink-on-accent hover:bg-accent-hover"
          : "text-ink-secondary hover:text-ink hover:bg-surface-hover"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** A non-interactive label inside the bar — the element's type, usually. */
export function ActionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="pl-2 pr-1 text-[11px] uppercase tracking-wide text-ink-tertiary select-none">
      {children}
    </span>
  );
}

export function ActionSeparator() {
  return <span className="w-px h-4 bg-line mx-0.5 shrink-0" />;
}
