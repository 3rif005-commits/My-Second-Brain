"use client";

// Thin wrapper around a database's table view: title bar (icon + name) and
// the one view tab this milestone ships. No filter/sort/group UI yet
// (Milestone 3+) — the view tab row is here so it's a small addition later,
// not a rewrite.
import { useDatabaseView } from "@/lib/database/useDatabaseView";
import { TableView } from "./views/TableView";

interface DatabaseShellProps {
  databaseId: string;
}

export function DatabaseShell({ databaseId }: DatabaseShellProps) {
  const { database, dataSource, properties, views, rows, loading, error, updateCell } =
    useDatabaseView(databaseId);

  if (loading && !database) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500">
        Loading…
      </div>
    );
  }

  if (error && !database) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-red-500">
        {error}
      </div>
    );
  }

  if (!database || !dataSource) return null;

  const editable = !dataSource.is_virtual;
  const activeView = views[0];

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          {database.icon && <span className="text-lg leading-none">{database.icon}</span>}
          <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {database.title}
          </h1>
          {dataSource.is_virtual && (
            <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
              Read only
            </span>
          )}
        </div>

        {/* View tabs — one view for now */}
        {activeView && (
          <div className="flex items-center gap-1 mt-2.5">
            <span className="text-xs font-medium px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              {activeView.name}
            </span>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0">
        <TableView
          properties={properties}
          rows={rows}
          editable={editable}
          onCellChange={(rowId, propertyKey, value) => updateCell(rowId, propertyKey, value)}
        />
      </div>
    </div>
  );
}
