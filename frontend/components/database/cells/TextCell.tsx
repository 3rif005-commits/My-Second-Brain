"use client";

import { useState } from "react";
import type { RichTextValue } from "@/lib/database/types";
import type { CellProps } from "./CellProps";

export function TextCell({ value, editable, onChange }: CellProps<RichTextValue>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value?.rich_text ?? "");

  if (!editable) {
    return (
      <span className="truncate text-ink">
        {value?.rich_text || <span className="db-empty-cell">—</span>}
      </span>
    );
  }

  if (editing) {
    function commit() {
      setEditing(false);
      onChange({ type: "rich_text", rich_text: draft });
    }
    return (
      <input
        autoFocus
        aria-label="Text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-full px-1 -mx-1 rounded-md bg-surface-elevated shadow-menu text-sm outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value?.rich_text ?? "");
        setEditing(true);
      }}
      className="w-full truncate text-left text-ink rounded px-1 -mx-1"
    >
      {value?.rich_text || <span className="db-empty-cell">—</span>}
    </button>
  );
}
