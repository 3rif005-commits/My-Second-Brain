"use client";

import { useState } from "react";

interface Props {
  tool: string;
  args: Record<string, unknown>;
  summary?: string;
  deniedReason?: string;
  /** The call is legal but waiting on the user — the assistant cannot grant
   * this itself, which is the whole point of the gate. */
  requiresApproval?: boolean;
  onApprove?: () => void;
}

const TOOL_ICONS: Record<string, string> = {
  "brain.search_brain": "🔍",
  "brain.get_note":     "📖",
  "brain.list_notes":   "📚",
  "brain.create_note":  "✨",
  "brain.update_note":  "✏️",
  "brain.delete_note":  "🗑️",
  "brain.link_notes":   "🔗",
  "brain.set_mastery":  "🎯",
  "brain.get_backlinks":"🪞",
};

export function ToolEvent({ tool, args, summary, deniedReason,
                            requiresApproval, onApprove }: Props) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const icon = TOOL_ICONS[tool] ?? "🛠️";
  const label = tool.split(".").slice(1).join(".").replace(/_/g, " ");
  const pending = requiresApproval && !sent;

  return (
    <div className="my-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`text-xs flex items-center gap-2 px-2 py-1 rounded-md transition-colors ${
          pending
            ? "bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 hover:bg-amber-100"
            : deniedReason
              ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-100"
              : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100"
        }`}
      >
        <span>{icon}</span>
        <span>{label}</span>
        {summary && <span className="text-gray-400">— {summary}</span>}
        {deniedReason && <span>· {pending ? "needs your OK" : "denied"}</span>}
        <span className="ml-1 text-gray-400">{open ? "▾" : "▸"}</span>
      </button>

      {pending && (
        <div className="mt-1 ml-6 flex items-center gap-2 text-[11px]">
          <span className="text-amber-700 dark:text-amber-300">{deniedReason}</span>
          {onApprove && (
            <button
              onClick={() => { setSent(true); onApprove(); }}
              className="px-2 py-0.5 rounded-full font-medium bg-amber-500/20 hover:bg-amber-500/30
                text-amber-900 dark:text-amber-100 transition-colors"
            >
              Confirm
            </button>
          )}
        </div>
      )}
      {open && (
        <div className="mt-1 ml-6 p-2 rounded-md bg-gray-50 dark:bg-gray-800 text-[11px] font-mono text-gray-600 dark:text-gray-300">
          <div><b>args:</b> {JSON.stringify(args)}</div>
          {deniedReason && <div className="text-red-600 mt-1"><b>denied:</b> {deniedReason}</div>}
        </div>
      )}
    </div>
  );
}
