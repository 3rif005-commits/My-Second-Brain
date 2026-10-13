"use client";

import { Tag } from "@/components/ui/Tag";
import { useState } from "react";
import type { MultiSelectValue } from "@/lib/database/types";
import type { CellProps } from "./CellProps";
import { optionColorFor, type ConfiguredOption } from "./CellProps";

/** `options` is the property's configured option list. Optional so the older
 * callers that predate the `Edit property` panel (Board/Gallery/List/Feed)
 * keep working — they simply get the hash palette, as before. */
export interface MultiSelectCellProps extends CellProps<MultiSelectValue> {
  options?: ConfiguredOption[];
}

export function MultiSelectCell({ value, editable, onChange, options }: MultiSelectCellProps) {
  const items = value?.multi_select ?? [];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(items.join(", "));

  if (editing) {
    function commit() {
      setEditing(false);
      const parsed = draft
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      onChange({ type: "multi_select", multi_select: parsed });
    }
    return (
      <input
        autoFocus
        aria-label="Multi-select"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="comma, separated, values"
        className="w-full px-1 -mx-1 rounded-md bg-surface-elevated shadow-menu text-sm outline-none"
      />
    );
  }

  const content =
    items.length > 0 ? (
      <div className="flex flex-wrap gap-x-2 gap-y-1.5">
        {items.map((item) => (
          <Tag key={item} color={optionColorFor(item, options)}>
            {item}
          </Tag>
        ))}
      </div>
    ) : (
      <span className="db-empty-cell">—</span>
    );

  if (!editable) return content;

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(items.join(", "));
        setEditing(true);
      }}
      className="w-full text-left rounded px-1 -mx-1"
    >
      {content}
    </button>
  );
}
