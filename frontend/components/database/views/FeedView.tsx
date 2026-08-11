"use client";

// Research: "the thinnest documentation of any view type... no API
// `configuration` schema at all." The plan's own M6 bullet: "flag any
// behaviour not derivable from a source rather than inventing it." What's
// actually implemented, and nothing more:
//  - a vertical stack of cards, one per row, title + visible properties —
//    similar visual weight to a Gallery card but with no cover/cover_size/
//    cover_aspect config (none of that is documented for Feed, unlike
//    Gallery where research names three explicit cover modes).
//  - newest-first ordering. Feed's own sort order isn't documented anywhere
//    in the research; `sortFeedRows` below reuses this app's existing
//    default ordering elsewhere (`list_rows`'s All Notes branch: `ORDER BY
//    updated_at DESC`) rather than inventing a Feed-specific one, by
//    sorting descending on whichever property has type `"last_edited_time"`
//    if the view has one configured (COLUMN_BACKED maps All Notes'
//    `updated_at` column to exactly that type). An ordinary data source
//    with no such property configured has no reliable field to sort by
//    client-side, so rows are left in the order the query endpoint already
//    returned them (its own default, `n.id ASC` — see
//    `services/db/query/builder.py`) rather than guessing. Flagged in
//    task-17-report.md, not silently glossed over.
//  - property visibility: the one documented Feed configuration option
//    (research). Reuses the same `config.hidden_properties: string[]`
//    fallback GalleryView.tsx introduced (TableView has no
//    `properties[].visible` mechanism to reuse — checked before writing
//    this).
//
// Explicitly NOT implemented (the brief's own instruction — flag these
// three, don't build them):
//  - comments ("Comment on any post directly") — a real, separate feature
//    this app has no infrastructure for at all (no comment model, no
//    comment endpoints, nothing to wire up).
//  - view-count tracking ("Track views on their posts") — same: no
//    existing infra, nothing to increment or read.
//  - any card size/preview-image control — undocumented per research
//    (unlike Gallery, which has an explicit `cover_size`/`cover_aspect`
//    spec to build against).
import type { DatabaseRow, PropertyResponse, PropertyValue, TitleValue } from "@/lib/database/types";
import { renderCellValue } from "../cells/renderCellValue";

/** Pure, unit-testable in isolation from rendering — mirrors BoardView's
 * `resolveDropValue` pattern of separating data-shaping logic from the
 * component so it doesn't need DOM simulation to verify. Returns a new
 * array; never mutates `rows`. */
export function sortFeedRows(rows: DatabaseRow[], properties: PropertyResponse[]): DatabaseRow[] {
  const sortProp = properties.find((p) => p.type === "last_edited_time");
  if (!sortProp) return rows;
  // Re-bind to a fresh const: same reasoning as BoardView.tsx's
  // `resolvedGroupPropertyKey` — TS's narrowing from the early-return
  // above doesn't carry into the nested `timestamp` closure below.
  const sortKey: string = sortProp.key;

  function timestamp(row: DatabaseRow): number {
    const value = row.properties[sortKey];
    const raw =
      value && typeof value === "object" && "type" in value
        ? (value as Record<string, unknown>)[value.type]
        : undefined;
    const parsed = typeof raw === "string" ? Date.parse(raw) : NaN;
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return [...rows].sort((a, b) => timestamp(b) - timestamp(a));
}

function readHiddenProperties(config: Record<string, unknown>): string[] {
  return Array.isArray(config.hidden_properties)
    ? (config.hidden_properties as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
}

export interface FeedViewProps {
  properties: PropertyResponse[];
  rows: DatabaseRow[];
  editable: boolean;
  onCellChange: (rowId: string, propertyKey: string, value: PropertyValue | null) => void;
  config: Record<string, unknown>;
  onConfigChange: (patch: Record<string, unknown>) => void;
}

export function FeedView({ properties, rows, editable, onCellChange, config, onConfigChange }: FeedViewProps) {
  const hiddenProperties = readHiddenProperties(config);
  const titleProp = properties.find((p) => p.type === "title");
  const visibleOtherProps = properties
    .filter((p) => p.type !== "title" && !hiddenProperties.includes(p.key))
    .slice()
    .sort((a, b) => a.position - b.position);
  const sortedRows = sortFeedRows(rows, properties);

  function toggleHidden(key: string) {
    const next = hiddenProperties.includes(key)
      ? hiddenProperties.filter((k) => k !== key)
      : [...hiddenProperties, key];
    onConfigChange({ hidden_properties: next });
  }

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-400 dark:text-gray-500">
        No rows yet.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {properties.filter((p) => p.type !== "title").length > 0 && (
        <div className="px-3 py-2 flex items-center gap-3 flex-wrap border-b border-gray-100 dark:border-gray-800 shrink-0 text-xs text-gray-500 dark:text-gray-400">
          <span>Visible properties:</span>
          {properties
            .filter((p) => p.type !== "title")
            .map((p) => (
              <label key={p.key} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={!hiddenProperties.includes(p.key)}
                  onChange={() => toggleHidden(p.key)}
                />
                {p.name}
              </label>
            ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
        {sortedRows.map((row) => {
          const titleValue = titleProp
            ? (row.properties[titleProp.key] as TitleValue | undefined)?.title
            : undefined;
          return (
            <div
              key={row.id}
              className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-3"
            >
              <div className="text-sm font-medium mb-1.5 text-gray-900 dark:text-gray-100">
                {titleValue || <span className="font-normal text-gray-400">Untitled</span>}
              </div>
              {visibleOtherProps.length > 0 && (
                <div className="space-y-1">
                  {visibleOtherProps.map((p) => (
                    <div key={p.key} className="text-xs flex items-start gap-1">
                      <span className="text-gray-400 shrink-0">{p.name}:</span>
                      <span className="min-w-0 flex-1">
                        {renderCellValue(p, row.properties[p.key], editable, (value) =>
                          onCellChange(row.id, p.key, value)
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
