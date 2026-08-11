"use client";

// Research: "the most configuration-poor layout... title on the left,
// properties on the right, one row per page." No cards, no cover, no
// calculations, no grouping — research explicitly flags "UNRESOLVED whether
// list supports group_by," and this plan's standing "flag it, don't
// invent" rule means the safe choice here is not supporting it: there is no
// group-by UI anywhere in this file, and ListView.test.tsx asserts that
// absence directly (not just an absence of code to review).
//
// Title is read-only here regardless of `editable` — TableView's title
// cell (cells/TitleCell.tsx) has no click-to-open-the-note behavior to
// reuse (checked before writing this: clicking it there only toggles
// inline editing). A `DatabaseRow.id` *is* a note id for both ordinary and
// virtual (All Notes) sources (spec Q2, `backend/routers/databases.py`'s
// `_decode_all_notes_row`/`_decode_ordinary_row` both key rows by
// `notes.id`/`db_row_props.note_id`, and the latter is itself an FK to
// `notes.id`), so this uses the same route this app's other note-opening
// affordance already uses (`components/workspace/DropZone.tsx`:
// `router.push('/brain/workspace/${noteId}')`) rather than inventing a new
// one.
import { useRouter } from "next/navigation";
import type { DatabaseRow, PropertyResponse, PropertyValue, TitleValue } from "@/lib/database/types";
import { renderCellValue } from "../cells/renderCellValue";

export interface ListViewProps {
  properties: PropertyResponse[];
  rows: DatabaseRow[];
  editable: boolean;
  onCellChange: (rowId: string, propertyKey: string, value: PropertyValue | null) => void;
}

export function ListView({ properties, rows, editable, onCellChange }: ListViewProps) {
  const router = useRouter();
  const titleProp = properties.find((p) => p.type === "title");
  const otherProps = properties
    .filter((p) => p.type !== "title")
    .slice()
    .sort((a, b) => a.position - b.position);

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-400 dark:text-gray-500">
        No rows yet.
      </div>
    );
  }

  return (
    <div className="overflow-auto h-full">
      {rows.map((row) => {
        const titleValue = titleProp
          ? (row.properties[titleProp.key] as TitleValue | undefined)?.title
          : undefined;
        return (
          <div
            key={row.id}
            className="flex items-center justify-between gap-4 px-3 py-2 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
          >
            <button
              type="button"
              onClick={() => router.push(`/brain/workspace/${row.id}`)}
              className="text-sm font-medium text-gray-900 dark:text-gray-100 text-left truncate hover:underline shrink-0 max-w-[40%]"
            >
              {titleValue || <span className="font-normal text-gray-400">Untitled</span>}
            </button>
            <div className="flex items-center gap-4 flex-wrap justify-end min-w-0">
              {otherProps.map((p) => (
                <div key={p.key} className="text-xs flex items-center gap-1">
                  <span className="text-gray-400 shrink-0">{p.name}:</span>
                  <span className="min-w-0">
                    {renderCellValue(p, row.properties[p.key], editable, (value) =>
                      onCellChange(row.id, p.key, value)
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
