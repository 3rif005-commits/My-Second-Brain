"use client";

import { useState } from "react";
import type { StatusValue } from "@/lib/database/types";
import type { CellProps } from "./CellProps";
import { pillStyleForOption, type ConfiguredOption } from "./CellProps";

/** `options` is the property's configured option list. Optional so the older
 * callers that predate the `Edit property` panel (Board/Gallery/List/Feed)
 * keep working — they simply get the hash palette, as before. */
export interface StatusCellProps extends CellProps<StatusValue> {
  options?: ConfiguredOption[];
}

export function StatusCell({ value, editable, onChange, options }: StatusCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value?.status ?? "");

  if (editing) {
    function commit() {
      setEditing(false);
      const trimmed = draft.trim();
      onChange(trimmed === "" ? { type: "status", status: null } : { type: "status", status: trimmed });
    }
    return (
      <input
        autoFocus
        aria-label="Status"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-full px-1 -mx-1 rounded border border-indigo-300 dark:border-indigo-500 bg-white dark:bg-gray-900 text-sm outline-none"
      />
    );
  }

  const content = value?.status ? (
    <span
      className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${pillStyleForOption(value.status, options)}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {value.status}
    </span>
  ) : (
    <span className="text-gray-400">—</span>
  );

  if (!editable) return content;

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value?.status ?? "");
        setEditing(true);
      }}
      className="w-full text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-1 -mx-1"
    >
      {content}
    </button>
  );
}
