"use client";

import { useState } from "react";
import type { NumberValue } from "@/lib/database/types";
import type { CellProps } from "./CellProps";

export function NumberCell({ value, editable, onChange }: CellProps<NumberValue>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value?.number?.toString() ?? "");

  if (!editable) {
    return (
      <span className="tabular-nums text-gray-700 dark:text-gray-300">
        {value?.number ?? <span className="text-gray-400">—</span>}
      </span>
    );
  }

  if (editing) {
    function commit() {
      setEditing(false);
      const trimmed = draft.trim();
      onChange(
        trimmed === "" ? { type: "number", number: null } : { type: "number", number: Number(trimmed) }
      );
    }
    return (
      <input
        autoFocus
        aria-label="Number"
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-full px-1 -mx-1 rounded border border-indigo-300 dark:border-indigo-500 bg-white dark:bg-gray-900 text-sm outline-none tabular-nums"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value?.number?.toString() ?? "");
        setEditing(true);
      }}
      className="w-full text-left tabular-nums text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-1 -mx-1"
    >
      {value?.number ?? <span className="text-gray-400">—</span>}
    </button>
  );
}
