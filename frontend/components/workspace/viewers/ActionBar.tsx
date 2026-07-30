"use client";

// Small floating action popover shown when an element or selection is active
// in a source viewer. One-click "send to note" per the workspace spec.
import type { ReactNode } from "react";

export function ActionBar({
  x, y, children,
}: { x: number; y: number; children: ReactNode }) {
  return (
    <div
      className="absolute z-30 flex items-center gap-1 px-1.5 py-1 rounded-lg bg-gray-900 text-white shadow-xl text-xs"
      style={{ left: x, top: y, transform: "translate(-50%, -110%)" }}
      onMouseDown={(e) => e.preventDefault()} // keep text selection alive
    >
      {children}
    </div>
  );
}

export function ActionButton({
  onClick, children, title,
}: { onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      title={title}
      className="px-2 py-1 rounded hover:bg-gray-700 whitespace-nowrap transition-colors"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
