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
//
// M12 (2026-09-02): a card's title now opens the row PEEK (`useRowPeek`,
// the same shared hook List's own row-hover build extracted out of
// TableView.tsx) instead of a bare `useOpenNote` navigation — it respects
// the view's "Open pages in" default the same way Table/List already do,
// rather than always hard-navigating regardless of that setting.
// `hidden_properties`/`property_order` also route through the shared
// `viewConfig.ts` helpers Table/List already use, replacing this file's own
// local `readHiddenProperties` copy and the hardcoded schema-position sort.
//
// M12 (2026-09-02, real Notion capture — row-affordances.md's "Feed view —
// real Notion capture" section): Feed's own hover shape is now known, not
// guessed. Real Notion Feed hover reveals exactly two icons top-right of
// the card — a reaction-add icon (skipped: no reactions feature anywhere in
// this app) and a "···" row-menu trigger, byte-identical in content to
// every other view's own row menu. No left gutter, no drag handle, no
// checkbox — confirmed live. `RowMenuTrigger` (pulled out of RowGutter.tsx
// the same session, same reasoning as `useRowPeek`'s own extraction) is
// reused here instead of a second copy of the favorite/copyLink/
// moveToTrash handlers. A fresh Feed view's own "Open pages in" also reads
// "Center peek" by default in real Notion (every other view we've built
// defaults to side) — set at creation time in DatabaseShell's
// `handleCreateView`, not hardcoded here, so it still round-trips through
// the same `open_pages_in` config Layout's own picker already writes.
//
// Deliberately NOT built, same "flag rather than invent" instruction as
// before: the author avatar/name/"2h (edited)" byline row (needs
// `last_edited_by`/`people`, already held back elsewhere pending a
// user-name lookup — AddPropertyPopover.tsx's own comment) and the
// always-visible "Add a comment…" composer (no comments feature exists
// anywhere in this app's backend — checked this session, not assumed).
import { MoreHorizontal } from "lucide-react";
import { HoverAffordance } from "@/components/ui/primitives";
import { getHiddenKeys, orderProperties } from "@/lib/database/viewConfig";
import { useRowPeek } from "@/lib/database/useRowPeek";
import type { DatabaseRow, PropertyResponse, PropertyValue, TitleValue } from "@/lib/database/types";
import { renderCellValue } from "../cells/renderCellValue";
import { RowPeek } from "../RowPeek";
import { RowMenuTrigger } from "../RowMenuTrigger";

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

export interface FeedViewProps {
  properties: PropertyResponse[];
  rows: DatabaseRow[];
  editable: boolean;
  onCellChange: (rowId: string, propertyKey: string, value: PropertyValue | null) => void;
  config: Record<string, unknown>;
  onConfigChange: (patch: Record<string, unknown>) => void;
  dataSourceId?: string;
  refetch?: () => void | Promise<void>;
  refetchRows?: () => void | Promise<void>;
}

export function FeedView({
  properties,
  rows,
  editable,
  onCellChange,
  config,
  onConfigChange,
  dataSourceId,
  refetch,
  refetchRows,
}: FeedViewProps) {
  const { peekRowId, peekMode, openRow, closePeek, handleRowAltClick } = useRowPeek(config);
  const hiddenProperties = getHiddenKeys(config);
  const titleProp = properties.find((p) => p.type === "title");
  const visibleOtherProps = orderProperties(properties, config).filter(
    (p) => p.type !== "title" && !hiddenProperties.includes(p.key)
  );
  const sortedRows = sortFeedRows(rows, properties);
  const peekRow = peekRowId ? rows.find((r) => r.id === peekRowId) : undefined;

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
              onClick={handleRowAltClick(row.id)}
              className="group relative rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-3"
            >
              <HoverAffordance className="absolute right-2 top-2">
                <RowMenuTrigger
                  rowId={row.id}
                  onOpenSidePeek={(id) => openRow(id, "side")}
                  onTrashed={() => refetchRows?.()}
                  trigger={
                    <button
                      type="button"
                      aria-label="Row options"
                      aria-haspopup="menu"
                      className="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  }
                />
              </HoverAffordance>

              <button
                type="button"
                onClick={() => openRow(row.id)}
                className="block w-full pr-6 text-left text-sm font-medium mb-1.5 text-gray-900 dark:text-gray-100 hover:underline"
              >
                {titleValue || <span className="font-normal text-gray-400">Untitled</span>}
              </button>
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

      {peekRow && (
        <RowPeek
          row={peekRow}
          properties={properties}
          editable={editable}
          onCellChange={onCellChange}
          onClose={closePeek}
          mode={peekMode === "center" ? "center" : "side"}
          dataSourceId={dataSourceId}
          onPropertyCreated={refetch}
        />
      )}
    </div>
  );
}
