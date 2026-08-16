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
import { useEffect, useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useToast } from "@/app/providers";
import { KNOWN_PROPERTY_TYPES, findSystemRelationProperty } from "@/lib/database/types";
import type { DatabaseRow, PropertyResponse, PropertyValue, RelatedRow, SubtaskDisplayMode } from "@/lib/database/types";
import { renderCellValue } from "../cells/renderCellValue";
import { buildSubItemTree } from "@/lib/database/subItemTree";

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
  /** useDatabaseView's `load`/`refetch` — called after adding a property so
   * the new column shows up without a full page reload. Does NOT refresh
   * `rows` (see `refetchRows`). */
  refetch?: () => void | Promise<void>;
  /** useDatabaseView's `loadRows` — called after adding a row. `refetch`
   * alone doesn't re-run the rows query (its effect isn't keyed to
   * anything a new row changes), so a new row would silently never appear
   * without calling this specifically. */
  refetchRows?: () => void | Promise<void>;
  // Milestone 7 (task-22): relation cells and sub-item nesting. All four
  // are optional — a caller that omits them (e.g. an older test) just gets
  // relation columns rendered as a read-only GenericCell fallback and no
  // tree/nesting, matching this feature's pre-task behaviour rather than
  // crashing.
  /** useDatabaseView's relation-links cache, keyed by `${rowId}:${propertyKey}`. */
  relationLinks?: Record<string, RelatedRow[]>;
  /** useDatabaseView's `ensureRelationLinks` — lazily warms the cache above
   * for a single row/property (used by `RelationCell`'s own per-cell mount). */
  ensureRelationLinks?: (rowId: string, propertyKey: string) => void;
  /** useDatabaseView's `ensureRelationLinksBulk` — warms the cache above for
   * every visible row's sub-item links in one request (M7 combined-review
   * Important finding 3: the sub-item pre-fetch effect below used to call
   * `ensureRelationLinks` once per row, one HTTP request per row). Optional,
   * same "older/other caller just gets a degraded but non-crashing
   * behaviour" convention as the other three relation props — falls back to
   * the one-request-per-row loop when omitted. */
  ensureRelationLinksBulk?: (rowIds: string[], propertyKey: string) => void;
  /** useDatabaseView's `setRelationLinks` — commits an add/remove. */
  setRelationLinks?: (rowId: string, propertyKey: string, rows: RelatedRow[]) => void | Promise<void>;
  /** The active view's `config.subtasks.display_mode` (task-22-brief.md
   * §3) — `undefined`/anything other than "show"/"flattened" renders the
   * data source's rows flat, same as before this task. Scope note: only
   * `show`/`flattened` are implemented; `hidden`/`disabled` are absent
   * rather than half-built (research §3.4 also names them, but the brief
   * explicitly scopes this task down to the first two). */
  subItemDisplayMode?: SubtaskDisplayMode;
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
  refetchRows,
  relationLinks,
  ensureRelationLinks,
  ensureRelationLinksBulk,
  setRelationLinks,
  subItemDisplayMode,
}: TableViewProps) {
  const { showToast } = useToast();

  const [addingProperty, setAddingProperty] = useState(false);
  const [propertyName, setPropertyName] = useState("");
  const [propertyType, setPropertyType] = useState<string>(ADDABLE_PROPERTY_TYPES[0].value);
  const [propertySubmitting, setPropertySubmitting] = useState(false);
  const [propertyFormError, setPropertyFormError] = useState<string | null>(null);
  const [rowSubmitting, setRowSubmitting] = useState(false);
  // Sub-item "show" mode's expand/collapse state (task-22-brief.md §3) —
  // every row starts expanded (empty set), matching Notion's own default.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const orderedProperties = useMemo(
    () => [...properties].sort((a, b) => a.position - b.position),
    [properties]
  );

  const titleProperty = useMemo(() => orderedProperties.find((p) => p.type === "title"), [orderedProperties]);
  // The one sub-item relation pair on this data source, if enabled
  // (research §3.2: the property choice is data-source-global, not a
  // per-view setting — there is exactly one, found by `config.system`).
  const subItemForwardProp = useMemo(
    () => findSystemRelationProperty(orderedProperties, "sub_item", "forward"),
    [orderedProperties]
  );
  const subItemReverseProp = useMemo(
    () => findSystemRelationProperty(orderedProperties, "sub_item", "reverse"),
    [orderedProperties]
  );

  // Pre-fetch every visible row's sub-item links up front (needed to know
  // who's a root/parent/child *before* any row renders) — not on individual
  // cell mount the way an ordinary relation column's cells do. Keyed to
  // `rows`'s identity (changes once per `loadRows()` completion) and the
  // mode/property, deliberately NOT to `ensureRelationLinksBulk`'s/
  // `ensureRelationLinks`'s own identity (which changes on every single
  // cache write — see useDatabaseView.ts's comment on why) or this effect
  // would re-issue a full "already cached, no-op" pass on every fetch's
  // completion.
  //
  // M7 combined-review Important finding 3: this used to call
  // `ensureRelationLinks` once per row in a loop — one HTTP request per
  // visible row for a single sub-item column, even though
  // `services.db.relations.list_links_bulk` (built by task 20 explicitly
  // to avoid exactly this) existed unused. `ensureRelationLinksBulk` (one
  // request for the whole page) is now preferred; the per-row loop is a
  // fallback only for a caller that hasn't wired it through yet.
  useEffect(() => {
    const key =
      subItemDisplayMode === "show"
        ? subItemForwardProp?.key
        : subItemDisplayMode === "flattened"
          ? subItemReverseProp?.key
          : undefined;
    if (!key) return;
    if (ensureRelationLinksBulk) {
      ensureRelationLinksBulk(rows.map((row) => row.id), key);
    } else if (ensureRelationLinks) {
      for (const row of rows) ensureRelationLinks(row.id, key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, subItemDisplayMode, subItemForwardProp?.key, subItemReverseProp?.key]);

  const treeEntries = useMemo(() => {
    if (subItemDisplayMode !== "show" || !subItemForwardProp || !relationLinks) return null;
    const key = subItemForwardProp.key;
    return buildSubItemTree(
      rows,
      (rowId) => relationLinks[`${rowId}:${key}`]?.map((r) => r.id),
      collapsedIds
    );
  }, [subItemDisplayMode, subItemForwardProp, relationLinks, rows, collapsedIds]);

  function toggleCollapsed(rowId: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  const columns = useMemo(
    () =>
      orderedProperties.map((property) =>
        columnHelper.accessor((row) => row.properties[property.key], {
          id: property.key || property.id,
          header: property.name,
          cell: (info) => {
            const rowId = info.row.original.id;
            const relationExtras =
              property.type === "relation" && ensureRelationLinks && setRelationLinks
                ? {
                    links: relationLinks?.[`${rowId}:${property.key}`],
                    onEnsureLoaded: () => ensureRelationLinks(rowId, property.key),
                    onLinksChange: (nextRows: RelatedRow[]) =>
                      setRelationLinks(rowId, property.key, nextRows),
                  }
                : undefined;
            return renderCellValue(
              property,
              info.getValue(),
              editable,
              (value) => onCellChange(rowId, property.key, value),
              relationExtras
            );
          },
        })
      ),
    [orderedProperties, editable, onCellChange, relationLinks, ensureRelationLinks, setRelationLinks]
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
      await refetchRows?.();
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
          {rows.length > 0 && treeEntries
            ? // Sub-item "show" mode: tree order + indentation/toggle on the
              // title cell (task-22-brief.md §3). `table.getRow(id)` looks up
              // the same TanStack Row the flat branch below would use — the
              // column defs (and every non-title cell) are unchanged, only
              // the iteration order/decoration differs.
              treeEntries.map(({ row: entryRow, depth, hasChildren }) => {
                const tableRow = table.getRow(entryRow.id);
                return (
                  <tr
                    key={entryRow.id}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  >
                    {tableRow.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-1.5 align-middle max-w-xs">
                        {cell.column.id === titleProperty?.key ? (
                          <div className="flex items-center gap-1" style={{ paddingLeft: depth * 16 }}>
                            {hasChildren ? (
                              <button
                                type="button"
                                aria-label={collapsedIds.has(entryRow.id) ? "Expand" : "Collapse"}
                                onClick={() => toggleCollapsed(entryRow.id)}
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 w-3 shrink-0"
                              >
                                {collapsedIds.has(entryRow.id) ? "▸" : "▾"}
                              </button>
                            ) : (
                              <span className="w-3 shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </div>
                          </div>
                        ) : (
                          flexRender(cell.column.columnDef.cell, cell.getContext())
                        )}
                      </td>
                    ))}
                    {editable && <td className="px-3 py-1.5" />}
                  </tr>
                );
              })
            : rows.length > 0 &&
              table.getRowModel().rows.map((row) => {
                // Flattened mode's "sub-items marked with a parent
                // indicator" (task-22-brief.md §3) — the reverse ("Parent
                // item") property's cached links, first one only (a
                // sub-item conceptually has one parent; nothing in this
                // schema enforces that structurally, so this just shows the
                // first link rather than guessing which one is "the" parent).
                const parentTitle =
                  subItemDisplayMode === "flattened" && subItemReverseProp
                    ? relationLinks?.[`${row.original.id}:${subItemReverseProp.key}`]?.[0]?.title
                    : undefined;
                return (
                  <tr
                    key={row.id}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-1.5 align-middle max-w-xs">
                        {cell.column.id === titleProperty?.key && parentTitle ? (
                          <div>
                            <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                              ↳ {parentTitle}
                            </div>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </div>
                        ) : (
                          flexRender(cell.column.columnDef.cell, cell.getContext())
                        )}
                      </td>
                    ))}
                    {editable && <td className="px-3 py-1.5" />}
                  </tr>
                );
              })}
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
