"use client";

import { useState } from "react";
import type { SelectValue } from "@/lib/database/types";
import type { CellProps } from "./CellProps";
import { pillStyleForOption, type ConfiguredOption } from "./CellProps";

/** `options` is the property's configured option list. Optional so the older
 * callers that predate the `Edit property` panel (Board/Gallery/List/Feed)
 * keep working — they simply get the hash palette, as before. */
export interface SelectCellProps extends CellProps<SelectValue> {
  options?: ConfiguredOption[];
}

export function SelectCell({ value, editable, onChange, options }: SelectCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value?.select ?? "");

  if (editing) {
    function commit() {
      setEditing(false);
      const trimmed = draft.trim();
      onChange(trimmed === "" ? { type: "select", select: null } : { type: "select", select: trimmed });
    }
    return (
      <input
        autoFocus
        aria-label="Select"
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

  const content = value?.select ? (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${pillStyleForOption(value.select, options)}`}>
      {value.select}
    </span>
  ) : (
    <span className="text-gray-400">—</span>
  );

  if (!editable) return content;

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value?.select ?? "");
        setEditing(true);
      }}
      className="w-full text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-1 -mx-1"
    >
      {content}
    </button>
  );
}
