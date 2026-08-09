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
// No column reordering/resizing/visibility yet (Milestone 3+) — @dnd-kit is
// already installed elsewhere in this repo but deliberately not pulled in
// here. No virtualization (@tanstack/react-virtual) either — not needed for
// this milestone's scope; worth adding if a data source's row count becomes
// a real performance problem.
import { useMemo } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type {
  CheckboxValue,
  DatabaseRow,
  DateValue,
  MultiSelectValue,
  NumberValue,
  PropertyResponse,
  PropertyValue,
  RichTextValue,
  SelectValue,
  StatusValue,
  TitleValue,
  UnknownValue,
} from "@/lib/database/types";
import { TitleCell } from "../cells/TitleCell";
import { TextCell } from "../cells/TextCell";
import { NumberCell } from "../cells/NumberCell";
import { SelectCell } from "../cells/SelectCell";
import { MultiSelectCell } from "../cells/MultiSelectCell";
import { StatusCell } from "../cells/StatusCell";
import { DateCell } from "../cells/DateCell";
import { CheckboxCell } from "../cells/CheckboxCell";
import { GenericCell } from "../cells/GenericCell";

interface TableViewProps {
  properties: PropertyResponse[];
  rows: DatabaseRow[];
  /** All Notes passes false (no write endpoint yet); ordinary databases pass true. */
  editable: boolean;
  onCellChange: (rowId: string, propertyKey: string, value: PropertyValue | null) => void;
}

/** Dispatches to the right cell component by `property.type`; anything not
 * in the 8 known types falls back to GenericCell, always read-only. */
function renderCellValue(
  property: PropertyResponse,
  value: PropertyValue | undefined,
  editable: boolean,
  onChange: (value: PropertyValue | null) => void
) {
  switch (property.type) {
    case "title":
      return (
        <TitleCell value={value as TitleValue | undefined} editable={editable} onChange={onChange} />
      );
    case "rich_text":
      return (
        <TextCell value={value as RichTextValue | undefined} editable={editable} onChange={onChange} />
      );
    case "number":
      return (
        <NumberCell value={value as NumberValue | undefined} editable={editable} onChange={onChange} />
      );
    case "select":
      return (
        <SelectCell value={value as SelectValue | undefined} editable={editable} onChange={onChange} />
      );
    case "multi_select":
      return (
        <MultiSelectCell
          value={value as MultiSelectValue | undefined}
          editable={editable}
          onChange={onChange}
        />
      );
    case "status":
      return (
        <StatusCell value={value as StatusValue | undefined} editable={editable} onChange={onChange} />
      );
    case "date":
      return <DateCell value={value as DateValue | undefined} editable={editable} onChange={onChange} />;
    case "checkbox":
      return (
        <CheckboxCell
          value={value as CheckboxValue | undefined}
          editable={editable}
          onChange={onChange}
        />
      );
    default:
      return <GenericCell value={value as UnknownValue | undefined} />;
  }
}

const columnHelper = createColumnHelper<DatabaseRow>();

export function TableView({ properties, rows, editable, onCellChange }: TableViewProps) {
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

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-400 dark:text-gray-500">
        No rows yet.
      </div>
    );
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
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-1.5 align-middle max-w-xs">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
