"use client";

// The one view type Milestone 2 ships: a plain TanStack Table (v8 — pinned
// explicitly rather than taking whatever "latest" resolves to, since
// @tanstack/react-table's newest major is a ground-up API rewrite with no
// useReactTable/getCoreRowModel/flexRender; v8 is the stable, documented
// surface this component is built against). Columns are derived from
// `properties[]` in position order; each cell is rendered by the matching
// dedicated cell component for its 8 known types, or GenericCell as a
// read-only fallback for anything else (e.g. `url`, `created_time`,
// `last_edited_time`) — see cells/CellProps.ts and cells/GenericCell.tsx.
//
// task-18: "Add property"/"Add row" — until this, a freshly created database
// (Milestone 2's POST /db/databases, reachable via the sidebar since a
// moment before this task) was permanently empty and uneditable through the
// UI, since nothing called POST .../properties or POST .../rows. Both POST
// calls happen right here rather than growing useDatabaseView.ts with new
// state-management methods (contrast `createView`, which appends to local
// `views` state itself) — a plain POST-then-`refetch()` is enough since
// there's no optimistic-update case to get right, unlike `updateCell`.
//
// No column reordering/resizing/visibility yet (Milestone 3+) — @dnd-kit is
// already installed elsewhere in this repo but deliberately not pulled in
// here. No virtualization (@tanstack/react-virtual) either — not needed for
// this milestone's scope; worth adding if a data source's row count becomes
// a real performance problem.
import { useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useToast } from "@/app/providers";
import { KNOWN_PROPERTY_TYPES } from "@/lib/database/types";
import type { DatabaseRow, PropertyResponse, PropertyValue } from "@/lib/database/types";
import { renderCellValue } from "../cells/renderCellValue";

interface TableViewProps {
  properties: PropertyResponse[];
  rows: DatabaseRow[];
  /** All Notes passes false (no write endpoint yet); ordinary databases pass true. */
  editable: boolean;
  onCellChange: (rowId: string, propertyKey: string, value: PropertyValue | null) => void;
  /** Backing data source id for the "Add property"/"Add row" POSTs below.
   * Only ever needed when `editable` — All Notes (the one non-editable
   * source) never renders those controls, so it's optional rather than
   * threading a dummy id through every other call site. */
  dataSourceId?: string;
  /** useDatabaseView's `load`/`refetch` — called after a successful add so
   * the new property/row shows up without a full page reload. */
  refetch?: () => void | Promise<void>;
}

const columnHelper = createColumnHelper<DatabaseRow>();

// The 7 non-title KNOWN_PROPERTY_TYPES this UI has a real cell component
// for. `title` is deliberately excluded — every database already has
// exactly one title property (created automatically by `POST
// /db/databases`, Milestone 2), and a second title property isn't a concept
// this app's schema (or Notion's) models. Labels are this form's own, since
// KNOWN_PROPERTY_TYPES only carries the wire `type` strings.
const ADDABLE_PROPERTY_TYPES: { value: string; label: string }[] = [
  { value: "rich_text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "select", label: "Select" },
  { value: "multi_select", label: "Multi-select" },
  { value: "status", label: "Status" },
  { value: "date", label: "Date" },
  { value: "checkbox", label: "Checkbox" },
];

/** Best-effort message extraction from a failed POST, matching the pattern
 * already used for the sidebar's "New Database" one-click create
 * (components/sidebar/Sidebar.tsx's handleNewDatabase) — FastAPI's
 * HTTPException body is `{"detail": "..."}`, this app's own proxy error
 * shapes are `{"error": "..."}`. */
async function errorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.detail || body?.error || `Request failed (${res.status})`;
}

export function TableView({
  properties,
  rows,
  editable,
  onCellChange,
  dataSourceId,
  refetch,
}: TableViewProps) {
  const { showToast } = useToast();

  const [addingProperty, setAddingProperty] = useState(false);
  const [propertyName, setPropertyName] = useState("");
  const [propertyType, setPropertyType] = useState<string>(ADDABLE_PROPERTY_TYPES[0].value);
  const [propertySubmitting, setPropertySubmitting] = useState(false);
  const [propertyFormError, setPropertyFormError] = useState<string | null>(null);
  const [rowSubmitting, setRowSubmitting] = useState(false);

  const orderedProperties = useMemo(
    () => [...properties].sort((a, b) => a.position - b.position),
    [properties]
  );

  const columns = useMemo(
    () =>
      orderedProperties.map((property) =>
        columnHelper.accessor((row) => row.properties[property.key], {
          id: property.key || property.id,
          header: property.name,
          cell: (info) =>
            renderCellValue(property, info.getValue(), editable, (value) =>
              onCellChange(info.row.original.id, property.key, value)
            ),
        })
      ),
    [orderedProperties, editable, onCellChange]
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  // +1 for the trailing "Add property"/spacer column that only exists when
  // editable — keeps <thead>'s and <tbody>'s cell counts matching so the
  // real columns don't visually shift under the wrong header.
  const columnCount = orderedProperties.length + (editable ? 1 : 0);

  function resetPropertyForm() {
    setAddingProperty(false);
    setPropertyName("");
    setPropertyType(ADDABLE_PROPERTY_TYPES[0].value);
    setPropertyFormError(null);
  }

  async function handleAddPropertySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dataSourceId) return;
    setPropertySubmitting(true);
    setPropertyFormError(null);
    try {
      const res = await fetch(`/api/db/data-sources/${dataSourceId}/properties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: propertyName.trim() || "Property", type: propertyType }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      resetPropertyForm();
      await refetch?.();
    } catch (err) {
      setPropertyFormError(err instanceof Error ? err.message : "Could not add property");
      setPropertySubmitting(false);
    }
  }

  // One-click, no form, no confirmation — matches the sidebar's "New Note"
  // convention (backend defaults the row to an "Untitled" note and appends
  // it at the end position; there's nothing for a form to collect).
  async function handleAddRow() {
    if (!dataSourceId || rowSubmitting) return;
    setRowSubmitting(true);
    try {
      const res = await fetch(`/api/db/data-sources/${dataSourceId}/rows`, { method: "POST" });
      if (!res.ok) throw new Error(await errorMessage(res));
      await refetch?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not add row", "error");
    } finally {
      setRowSubmitting(false);
    }
  }

  return (
    <div className="overflow-auto h-full">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-white dark:bg-gray-900">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="text-left font-medium text-gray-500 dark:text-gray-400 px-3 py-2 border-b border-gray-200 dark:border-gray-700 whitespace-nowrap"
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
              {editable && (
                <th className="text-left font-normal px-3 py-2 border-b border-gray-200 dark:border-gray-700 whitespace-nowrap">
                  {!addingProperty ? (
                    <button
                      type="button"
                      aria-label="Add property"
                      onClick={() => setAddingProperty(true)}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 font-medium"
                    >
                      +
                    </button>
                  ) : (
                    <form onSubmit={handleAddPropertySubmit} className="flex items-center gap-1.5 flex-wrap">
                      <input
                        autoFocus
                        aria-label="Property name"
                        value={propertyName}
                        onChange={(e) => setPropertyName(e.target.value)}
                        placeholder="Property name"
                        className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                      />
                      <select
                        aria-label="Property type"
                        value={propertyType}
                        onChange={(e) => setPropertyType(e.target.value)}
                        className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                      >
                        {ADDABLE_PROPERTY_TYPES.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        disabled={propertySubmitting}
                        className="text-xs px-2 py-1 rounded bg-indigo-600 text-white disabled:opacity-40"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={resetPropertyForm}
                        className="text-xs px-1.5 py-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        Cancel
                      </button>
                      {propertyFormError && (
                        <span className="text-xs text-red-500 basis-full">{propertyFormError}</span>
                      )}
                    </form>
                  )}
                </th>
              )}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={Math.max(columnCount, 1)}
                className="text-center py-16 text-sm text-gray-400 dark:text-gray-500"
              >
                No rows yet.
              </td>
            </tr>
          )}
          {rows.length > 0 &&
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-1.5 align-middle max-w-xs">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
                {editable && <td className="px-3 py-1.5" />}
              </tr>
            ))}
          {editable && (
            <tr>
              <td colSpan={Math.max(columnCount, 1)} className="px-3 py-1.5">
                <button
                  type="button"
                  onClick={handleAddRow}
                  disabled={rowSubmitting}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-40"
                >
                  + New
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
