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
import { findSystemRelationProperty } from "@/lib/database/types";
import type {
  DatabaseRow,
  PropertyResponse,
  PropertyValue,
  RelatedRow,
  RowResponse,
  RowTemplateResponse,
  SubtaskDisplayMode,
  ViewResponse,
} from "@/lib/database/types";
import { FileText } from "lucide-react";
import { renderCellValue } from "../cells/renderCellValue";
import {
  getHiddenKeys,
  getOpenPagesInMode,
  getShowPageIcon,
  getShowVerticalLines,
  orderProperties,
} from "@/lib/database/viewConfig";
import type { SortsUpdater } from "@/lib/database/viewConfig";
import { defaultConditionFor } from "@/lib/database/filterAst";
import type { FilterUpdater } from "../FilterBuilder";
import { useOpenNote } from "@/lib/database/useOpenNote";
import { buildSubItemTree } from "@/lib/database/subItemTree";
import { ButtonPropertyConfigPopover } from "../ButtonPropertyConfigPopover";
import { OpenNoteButton } from "../OpenNoteButton";
import { RowPeek } from "../RowPeek";
import { ColumnHeader } from "../ColumnHeader";
import { AddPropertyPopover } from "../AddPropertyPopover";
import { QueryBar } from "../QueryBar";

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
  // Milestone 12 (task-40): the "+ New" split-button's dropdown. Optional,
  // same "older/other caller just gets a degraded but non-crashing
  // behaviour" convention as the relation props above — a caller that omits
  // `templates` (or passes `[]`) simply gets the plain "+ New" button with
  // no chevron next to it, which is byte-identical to this component's
  // behaviour before this task existed (the brief's own regression bar for
  // this file: the plain "+ New" click path must stay unchanged).
  templates?: RowTemplateResponse[];
  // M1: the column header menu. All four are optional on the same
  // "an older/other caller gets a degraded but non-crashing behaviour"
  // convention the relation props above already established — omit them and
  // headers render as the plain strings they were before M1, which is exactly
  // what the read-only All Notes source should get.
  /** The active view. The menu writes per-view state (hidden, wrap,
   * calculation, order), so without it there is nothing to write to. */
  view?: ViewResponse | null;
  /** Receives a PATCH of changed keys only; DatabaseShell merges it through
   * its serialised queue. */
  onPatchConfig?: (patch: Record<string, unknown>) => void;
  onSetSorts?: (updater: SortsUpdater) => void;
  /** M4: the query bar (sort/filter chips) and each column header's
   * "Filter" row both write here. */
  onSetFilter?: (updater: FilterUpdater) => void;
  /** useDatabaseView's `instantiateTemplate` — creates a row from a chosen
   * (non-default) template right now. Does not itself refetch rows; this
   * component calls `refetchRows` afterward, same as `handleAddRow` does
   * for the plain path. */
  onInstantiateTemplate?: (templateId: string) => Promise<RowResponse>;
}

const columnHelper = createColumnHelper<DatabaseRow>();


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
  templates,
  onInstantiateTemplate,
  view,
  onPatchConfig,
  onSetSorts,
  onSetFilter,
}: TableViewProps) {
  const { showToast } = useToast();
  const openNote = useOpenNote();

  // Controller addition: clicking a row's Open-note icon opens a RowPeek
  // (side panel, properties + body over the table) instead of navigating
  // straight to Workspace — see RowPeek.tsx / OpenNoteButton.tsx's own
  // `onOpen` prop. `null` = no peek open.
  const [peekRowId, setPeekRowId] = useState<string | null>(null);
  const config = view?.config ?? {};
  // M3's Layout panel default ("Open pages in") — "full" bypasses RowPeek
  // entirely and reuses the exact navigation List/Feed/Board/Gallery already
  // use (useOpenNote), rather than growing RowPeek a mode it would never
  // render itself.
  const openPagesInMode = getOpenPagesInMode(config);
  function openRow(noteId: string) {
    if (openPagesInMode === "full") openNote(noteId);
    else setPeekRowId(noteId);
  }
  // Two entry points write this same key — the title column's own header
  // menu (M1's "Show page icon") and M3's Layout panel — this is the read
  // half neither had before now.
  const showPageIcon = getShowPageIcon(config);
  const showVerticalLines = getShowVerticalLines(config);
  const cellBorderClass = showVerticalLines ? "border-r border-gray-100 dark:border-gray-800" : "";
  const [rowSubmitting, setRowSubmitting] = useState(false);
  // Milestone 12 (task-40): the "+ New" split-button's dropdown open state,
  // and a separate submitting flag so picking a template disables/re-enables
  // its own row without touching `rowSubmitting` (the plain "+ New" click
  // path's own state).
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [instantiatingTemplateId, setInstantiatingTemplateId] = useState<string | null>(null);


  // Sub-item "show" mode's expand/collapse state (task-22-brief.md §3) —
  // every row starts expanded (empty set), matching Notion's own default.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  // The full schema, in table order — NOT hidden-filtered. Everything that
  // needs to know "what properties exist on this data source" (sub-item/
  // relation lookups, the rollup-source picker, Insert-left/right's
  // duplicate-name check) must see a hidden column too: hiding a column is
  // a per-view DISPLAY choice, not a schema change, and a relation a Button
  // targets or a sub-item pair still functions while its column happens to
  // be hidden. `orderedProperties` below — the HIDDEN-FILTERED list — exists
  // solely for rendering table columns; nothing else should read it.
  // (Live-discovered in the M1–M3 review checkpoint: every one of the
  // lookups below used to read the filtered list, so hiding a sub-item
  // relation's column silently killed the whole nested row tree, and hiding
  // a Button's target property made it unresolvable in its own config
  // popover.)
  const allOrderedProperties = useMemo(
    () => orderProperties(properties, config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [properties, config.property_order]
  );

  // Wired to the SAME view.config keys the column header menu's "Hide" row
  // and Insert-left/right already write (M1) and M3's Property visibility
  // panel now writes — this was the missing read half: those controls set
  // `hidden_properties`/`property_order` and nothing here consulted either,
  // so a hidden column stayed rendered and a reorder had no visible effect.
  // The title property is EXEMPT from hiding: it is the only place
  // OpenNoteButton/the sub-item tree's expand toggle render, and Notion's
  // own capture shows an eye icon on "Name" without confirming it is
  // enabled — kept visible here rather than guessed away.
  const orderedProperties = useMemo(() => {
    const hidden = new Set(getHiddenKeys(config));
    if (hidden.size === 0) return allOrderedProperties;
    return allOrderedProperties.filter((p) => p.type === "title" || !hidden.has(p.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allOrderedProperties, config.hidden_properties]);

  const titleProperty = useMemo(
    () => allOrderedProperties.find((p) => p.type === "title"),
    [allOrderedProperties]
  );
  // The one sub-item relation pair on this data source, if enabled
  // (research §3.2: the property choice is data-source-global, not a
  // per-view setting — there is exactly one, found by `config.system`).
  const subItemForwardProp = useMemo(
    () => findSystemRelationProperty(allOrderedProperties, "sub_item", "forward"),
    [allOrderedProperties]
  );
  const subItemReverseProp = useMemo(
    () => findSystemRelationProperty(allOrderedProperties, "sub_item", "reverse"),
    [allOrderedProperties]
  );

  // Every relation-type property on this data source (task-31 Parts 3/4) —
  // ordinary relations AND the sub-item/dependency system pairs alike, since
  // all of them are plain `type: "relation"` properties that get their own
  // column/RelationCell. Used below to bulk-warm the WHOLE relationLinks
  // cache for the whole page in one pass (Part 4), AND as the rollup form's
  // "which relation do you want to roll up through" dropdown (Part 3) — a
  // rollup can only roll up through a relation that already exists on THIS
  // data source, so an empty list here is exactly the "add a relation
  // property first" case task-31-brief.md §3 calls out.
  const relationProperties = useMemo(
    () => allOrderedProperties.filter((p) => p.type === "relation"),
    [allOrderedProperties]
  );
  const relationPropertyKeys = useMemo(() => relationProperties.map((p) => p.key), [relationProperties]);

  // Pre-fetch every visible row's links for EVERY relation column up front,
  // not on individual cell mount the way each RelationCell's own effect
  // still separately does. Keyed to `rows`'s identity (changes once per
  // `loadRows()` completion) and the joined set of relation keys,
  // deliberately NOT to `ensureRelationLinksBulk`'s/`ensureRelationLinks`'s
  // own identity (which changes on every single cache write — see
  // useDatabaseView.ts's comment on why) or this effect would re-issue a
  // full "already cached, no-op" pass on every fetch's completion.
  //
  // task-31 Part 4 (live-verified: 58 relation requests for a two-row
  // table): this used to warm the cache for ONLY whichever single sub-item
  // property matched the active `subItemDisplayMode` (M7 combined-review
  // Important finding 3) — every OTHER relation column (an ordinary
  // "Blocking"/"Related" property, or the sub-item property when no
  // display mode is even set) had no bulk pre-fetch at all, leaving each of
  // ITS cells to fall back to one `ensureRelationLinks` HTTP request per
  // row (task-20's `list_links_bulk`/`ensureRelationLinksBulk` sat unused
  // for exactly the columns that needed it most). Generalizing to every
  // relation column folds the old sub-item-only pre-fetch into this same
  // mechanism — `subItemDisplayMode`/`subItemForwardProp`/
  // `subItemReverseProp` no longer gate what gets warmed here (they're
  // still used below for the tree/flattened-mode rendering itself).
  useEffect(() => {
    if (relationPropertyKeys.length === 0) return;
    const rowIds = rows.map((row) => row.id);
    if (rowIds.length === 0) return;
    if (ensureRelationLinksBulk) {
      for (const key of relationPropertyKeys) ensureRelationLinksBulk(rowIds, key);
    } else if (ensureRelationLinks) {
      for (const key of relationPropertyKeys) {
        for (const row of rows) ensureRelationLinks(row.id, key);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, relationPropertyKeys.join("|")]);

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
          // Milestone 12 (task-42) decision 2: a button-typed column's
          // header becomes a clickable config-popover trigger; every other
          // type keeps the plain string header unchanged.
          // M1. A button column keeps its existing config popover: a button's
          // settings ARE per-type property config, which is M2's "Edit
          // property" panel, so folding it in belongs there rather than as a
          // half-built row here. Everything else gets the header menu.
          //
          // The menu is suppressed entirely — not disabled — when the source
          // is read-only or the caller supplied no view/handlers. All Notes
          // has no db_properties to rename, hide or delete, and
          // DatabaseShell.tsx:400 already establishes hidden-over-disabled for
          // exactly that case.
          header:
            property.type === "button"
              ? () => (
                  <ButtonPropertyConfigPopover property={property} properties={allOrderedProperties} onSaved={refetch} />
                )
              : editable && dataSourceId && onPatchConfig && onSetSorts
                ? () => (
                    <ColumnHeader
                      property={property}
                      properties={allOrderedProperties}
                      dataSourceId={dataSourceId}
                      view={view ?? null}
                      onPatchConfig={onPatchConfig}
                      onSetSorts={onSetSorts}
                      onPropertiesChanged={() => refetch?.()}
                      // M4: applies a default filter on THIS property
                      // immediately, replacing whatever filter existed —
                      // same "groups by that property immediately" replace
                      // semantics M1's own "Group" row already established.
                      onFilter={
                        onSetFilter ? () => onSetFilter(() => defaultConditionFor(property)) : undefined
                      }
                    />
                  )
                : property.name,
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
            const buttonExtras = property.type === "button" ? { noteId: rowId } : undefined;
            return renderCellValue(
              property,
              info.getValue(),
              editable,
              (value) => onCellChange(rowId, property.key, value),
              relationExtras,
              buttonExtras
            );
          },
        })
      ),
    [
      orderedProperties,
      editable,
      onCellChange,
      relationLinks,
      ensureRelationLinks,
      setRelationLinks,
      refetch,
      dataSourceId,
      view,
      onPatchConfig,
      onSetSorts,
      onSetFilter,
    ]
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









  // One-click, no form, no confirmation — matches the sidebar's "New Note"
  // convention (backend defaults the row to an "Untitled" note and appends
  // it at the end position; there's nothing for a form to collect).
  //
  // UNCHANGED by task-40's split-button widening below: this still calls
  // the same bare POST with no body, and the backend already auto-applies
  // the data source's default template server-side if one exists (Task 37) —
  // no frontend change needed for that path at all.
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

  // Milestone 12 (task-40), decision 3: every NON-default template — the
  // default one is already what plain "+ New" produces (the backend
  // auto-applies it), so listing it again in the dropdown would be
  // confusing/redundant.
  const nonDefaultTemplates = (templates ?? []).filter((t) => !t.is_default);

  async function handleInstantiateTemplate(templateId: string) {
    if (!onInstantiateTemplate || instantiatingTemplateId) return;
    setInstantiatingTemplateId(templateId);
    setTemplateMenuOpen(false);
    try {
      await onInstantiateTemplate(templateId);
      await refetchRows?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not create row from template", "error");
    } finally {
      setInstantiatingTemplateId(null);
    }
  }

  const peekRow = peekRowId ? rows.find((r) => r.id === peekRowId) : undefined;

  return (
    <>
    <div className="flex h-full flex-col">
      {view && onSetSorts && onSetFilter && (
        <QueryBar view={view} properties={allOrderedProperties} onSetSorts={onSetSorts} onSetFilter={onSetFilter} />
      )}
      <div className="overflow-auto flex-1 min-h-0">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-white dark:bg-gray-900">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className={`text-left font-medium text-gray-500 dark:text-gray-400 px-3 py-2 border-b border-gray-200 dark:border-gray-700 whitespace-nowrap ${cellBorderClass}`}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
              {editable && dataSourceId && (
                <th className="text-left font-normal px-3 py-2 border-b border-gray-200 dark:border-gray-700 whitespace-nowrap">
                  {/* M2: the anchored creation popover. Replaced a
                    * trailing-column inline form that held five of this app's
                    * 40 native <select> elements. */}
                  <AddPropertyPopover
                    dataSourceId={dataSourceId}
                    properties={allOrderedProperties}
                    onCreated={() => refetch?.()}
                  />
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
                    className="group border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  >
                    {tableRow.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={`px-3 py-1.5 align-middle max-w-xs ${cellBorderClass}`}>
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
                            {showPageIcon && (
                              <FileText size={12} className="shrink-0 text-gray-300 dark:text-gray-600" aria-hidden />
                            )}
                            <div className="flex-1 min-w-0">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </div>
                            <OpenNoteButton
                              noteId={entryRow.id}
                              className="shrink-0 opacity-0 group-hover:opacity-100"
                              onOpen={openRow}
                            />
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
                    className="group border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={`px-3 py-1.5 align-middle max-w-xs ${cellBorderClass}`}>
                        {cell.column.id === titleProperty?.key ? (
                          <div className="flex items-center gap-1">
                            {showPageIcon && (
                              <FileText size={12} className="shrink-0 text-gray-300 dark:text-gray-600" aria-hidden />
                            )}
                            <div className="flex-1 min-w-0">
                              {parentTitle && (
                                <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                                  ↳ {parentTitle}
                                </div>
                              )}
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </div>
                            <OpenNoteButton
                              noteId={row.original.id}
                              className="shrink-0 opacity-0 group-hover:opacity-100"
                              onOpen={openRow}
                            />
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
                <div className="relative inline-flex items-center">
                  <button
                    type="button"
                    onClick={handleAddRow}
                    disabled={rowSubmitting}
                    className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-40"
                  >
                    + New
                  </button>
                  {/* Task-40 decision 3: zero non-default templates -> no
                   * chevron at all, no dropdown with nothing in it. */}
                  {nonDefaultTemplates.length > 0 && (
                    <>
                      <button
                        type="button"
                        aria-label="Choose a template"
                        aria-haspopup="menu"
                        aria-expanded={templateMenuOpen}
                        onClick={() => setTemplateMenuOpen((o) => !o)}
                        className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-1"
                      >
                        ▾
                      </button>
                      {templateMenuOpen && (
                        <div
                          role="menu"
                          aria-label="New row from template"
                          className="absolute left-0 bottom-full z-20 mb-1 min-w-[10rem] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1"
                        >
                          {nonDefaultTemplates.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              role="menuitem"
                              disabled={instantiatingTemplateId === t.id}
                              onClick={() => handleInstantiateTemplate(t.id)}
                              className="w-full flex items-center gap-1.5 text-left text-xs px-3 py-1.5 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-40"
                            >
                              {t.icon && <span className="leading-none">{t.icon}</span>}
                              {t.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
    {peekRow && (
      <RowPeek
        row={peekRow}
        properties={properties}
        editable={editable}
        onCellChange={onCellChange}
        onClose={() => setPeekRowId(null)}
        mode={openPagesInMode === "center" ? "center" : "side"}
      />
    )}
    </>
  );
}
