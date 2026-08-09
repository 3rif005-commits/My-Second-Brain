"use client";

import { useState } from "react";
import type { TitleValue } from "@/lib/database/types";
import type { CellProps } from "./CellProps";

export function TitleCell({ value, editable, onChange }: CellProps<TitleValue>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value?.title ?? "");

  if (!editable) {
    return (
      <span className="truncate font-medium text-gray-900 dark:text-gray-100">
        {value?.title || <span className="font-normal text-gray-400">Untitled</span>}
      </span>
    );
  }

  if (editing) {
    function commit() {
      setEditing(false);
      onChange({ type: "title", title: draft });
    }
    return (
      <input
        autoFocus
        aria-label="Title"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-full px-1 -mx-1 rounded border border-indigo-300 dark:border-indigo-500 bg-white dark:bg-gray-900 text-sm font-medium text-gray-900 dark:text-gray-100 outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value?.title ?? "");
        setEditing(true);
      }}
      className="w-full truncate text-left font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-1 -mx-1"
    >
      {value?.title || <span className="font-normal text-gray-400">Untitled</span>}
    </button>
  );
}
