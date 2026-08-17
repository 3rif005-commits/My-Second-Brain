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
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useToast } from "@/app/providers";
import { KNOWN_PROPERTY_TYPES, ROLLUP_FUNCTIONS, findSystemRelationProperty } from "@/lib/database/types";
import type {
  DatabaseDetailResponse,
  DatabaseListResponse,
  DatabaseRow,
  DatabaseSummary,
  PropertyResponse,
  PropertyValue,
  RelatedRow,
  SubtaskDisplayMode,
} from "@/lib/database/types";
import { renderCellValue } from "../cells/renderCellValue";
import { buildSubItemTree } from "@/lib/database/subItemTree";
import { FormulaEditor } from "../FormulaEditor";

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
// for, plus "relation" (task-31 Part 1). `title` is deliberately excluded —
// every database already has exactly one title property (created
// automatically by `POST /db/databases`, Milestone 2), and a second title
// property isn't a concept this app's schema (or Notion's) models. Labels
// are this form's own, since KNOWN_PROPERTY_TYPES only carries the wire
// `type` strings.
//
// task-31: M7/M8 shipped complete, tested engines (relation/formula/rollup)
// that were unreachable for creation through this exact list — it only
// carried the 7 basic types, so a user could build none of the three.
const ADDABLE_PROPERTY_TYPES: { value: string; label: string }[] = [
  { value: "rich_text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "select", label: "Select" },
  { value: "multi_select", label: "Multi-select" },
  { value: "status", label: "Status" },
  { value: "date", label: "Date" },
  { value: "checkbox", label: "Checkbox" },
  { value: "relation", label: "Relation" },
  { value: "formula", label: "Formula" },
  { value: "rollup", label: "Rollup" },
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
  // task-31 Part 1: relation-only fields, collected by the same inline
  // add-property form rather than a parallel one. `databases` is fetched
  // lazily (only once the user actually picks "Relation" or "Rollup" — no
  // reason to pay for `GET /db/databases` on every ordinary "add a Text
  // property") from `GET /db/databases` (commit 397ba23), which is what a
  // relation's target picker AND a rollup's target-property picker (Part 3,
  // below — it needs to resolve the chosen relation's own target data
  // source to a `database_id` before it can fetch that database's
  // properties) both enumerate. Self-relations (target == this data source)
  // are legal and are NOT filtered out of this list — the current database
  // is just another entry the user owns.
  const [databases, setDatabases] = useState<DatabaseSummary[] | null>(null);
  const [databasesLoading, setDatabasesLoading] = useState(false);
  const [targetDataSourceId, setTargetDataSourceId] = useState("");
  const [twoWay, setTwoWay] = useState(true);
  const [reverseName, setReverseName] = useState("");
  // task-31 Part 2: a formula property's only real field is its expression
  // — `FormulaEditor` (Task 28) owns its own validation UI; this form only
  // needs somewhere to hold the current draft between keystrokes and submit.
  const [formulaExpression, setFormulaExpression] = useState("");
  // task-31 Part 3: a rollup needs a relation property ON THIS data source
  // to roll up through, a property on THAT relation's own target data
  // source to aggregate, and one of the 22 documented functions.
  // `target_data_source_id` is never chosen directly by the user — it's
  // derived from the chosen relation's own `config.target_data_source_id`
  // (the backend rejects any other value: `_validate_and_prepare_computed_
  // property`'s "config.target_data_source_id must match relation's own
  // target").
  const [rollupRelationKey, setRollupRelationKey] = useState("");
  const [rollupTargetKey, setRollupTargetKey] = useState("");
  const [rollupFunction, setRollupFunction] = useState("");
  const [targetProperties, setTargetProperties] = useState<PropertyResponse[] | null>(null);
  const [targetPropertiesLoading, setTargetPropertiesLoading] = useState(false);
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
    () => orderedProperties.filter((p) => p.type === "relation"),
    [orderedProperties]
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
    setTargetDataSourceId("");
    setTwoWay(true);
    setReverseName("");
    setFormulaExpression("");
    setRollupRelationKey("");
    setRollupTargetKey("");
    setRollupFunction("");
  }

  // Lazy-loads `GET /db/databases` (commit 397ba23) the first time the user
  // actually picks "Relation" or "Rollup" in the type dropdown — not on
  // every "Add property" open, which would pay for the fetch even for an
  // ordinary Text property. `databases` is cached for the lifetime of this
  // mount (a brand-new database created *while* this form is open is an
  // edge case not worth a refetch-on-every-keystroke for).
  //
  // Guarded by a REF, not by reading `databases`/`databasesLoading` state in
  // this same effect's own deps: `setDatabasesLoading(true)` below is itself
  // a dependency-changing write, which would re-run this effect on the very
  // next commit — the effect's own cleanup would then set `cancelled = true`
  // before the in-flight fetch (issued by the FIRST run) ever resolves,
  // silently dropping `setDatabases(...)` forever and leaving the dropdown
  // stuck on "Loading databases…". A ref sidesteps that self-cancellation:
  // it's set synchronously, is not a reactive dependency, and survives
  // across the resulting re-render untouched.
  const databasesFetchStarted = useRef(false);
  useEffect(() => {
    if (
      (propertyType !== "relation" && propertyType !== "rollup") ||
      databasesFetchStarted.current
    ) {
      return;
    }
    databasesFetchStarted.current = true;
    let cancelled = false;
    setDatabasesLoading(true);
    fetch("/api/db/databases")
      .then(async (res) => {
        if (!res.ok) throw new Error(await errorMessage(res));
        const data: DatabaseListResponse = await res.json();
        if (!cancelled) setDatabases(data.databases);
      })
      .catch((err) => {
        if (!cancelled) {
          showToast(err instanceof Error ? err.message : "Could not load databases", "error");
        }
      })
      .finally(() => {
        if (!cancelled) setDatabasesLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyType]);

  // task-31 Part 3: once a rollup's relation is chosen, resolve that
  // relation's own `config.target_data_source_id` to a `database_id` (via
  // the `databases` list above) and fetch THAT database's properties for
  // the "which property to aggregate" dropdown — `GET /db/databases/{id}`
  // (Milestone 2) is the only endpoint that returns a data source's
  // properties; there's no "properties by data_source_id" endpoint.
  // Deliberately NOT guarded by a ref the way the `databases` fetch above
  // is: this one legitimately needs to re-run every time the user picks a
  // DIFFERENT relation (a new target), and neither `targetProperties` nor
  // `targetPropertiesLoading` are in this effect's own deps, so there's no
  // self-cancellation risk here the way there was above.
  useEffect(() => {
    setTargetProperties(null);
    if (propertyType !== "rollup" || !rollupRelationKey || !databases) return;
    const relationProp = orderedProperties.find(
      (p) => p.type === "relation" && p.key === rollupRelationKey
    );
    const targetDsId =
      typeof relationProp?.config?.target_data_source_id === "string"
        ? (relationProp.config.target_data_source_id as string)
        : undefined;
    const targetDb = targetDsId ? databases.find((d) => d.data_source.id === targetDsId) : undefined;
    if (!targetDb) return;
    let cancelled = false;
    setTargetPropertiesLoading(true);
    fetch(`/api/db/databases/${targetDb.database.id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await errorMessage(res));
        const data: DatabaseDetailResponse = await res.json();
        if (!cancelled) setTargetProperties(data.properties);
      })
      .catch((err) => {
        if (!cancelled) {
          showToast(err instanceof Error ? err.message : "Could not load the target database's properties", "error");
        }
      })
      .finally(() => {
        if (!cancelled) setTargetPropertiesLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyType, rollupRelationKey, databases, orderedProperties]);

  async function handleAddPropertySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dataSourceId) return;
    setPropertySubmitting(true);
    setPropertyFormError(null);
    try {
      // task-31 Part 1: relation properties are NOT created through the
      // generic `POST .../properties` endpoint — that would mint a
      // property with no `relation_id`/`side` in config, which
      // `relation_ref_from_config` rejects and every filter on it would
      // then 400 on (supabase/migrations/015_relations.sql's header).
      // `POST .../relations` is the only route that produces a valid pair.
      if (propertyType === "relation") {
        if (!targetDataSourceId) {
          throw new Error("Choose a target database");
        }
        if (twoWay && !reverseName.trim()) {
          throw new Error("Reverse property name is required for a two-way relation");
        }
        const res = await fetch(`/api/db/data-sources/${dataSourceId}/relations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: propertyName.trim() || "Relation",
            target_data_source_id: targetDataSourceId,
            two_way: twoWay,
            reverse_name: twoWay ? reverseName.trim() : null,
          }),
        });
        if (!res.ok) throw new Error(await errorMessage(res));
      } else if (propertyType === "formula") {
        // task-31 Part 2, research §1.9 (quoted in task-31-brief.md §2): "a
        // formula with errors can still be saved... the property will
        // display nothing" — this deliberately does NOT gate on
        // `FormulaEditor`'s own `valid` state, only on a non-empty
        // expression (the one thing the backend hard-rejects regardless of
        // parse/typecheck outcome). A dependency cycle is the other hard
        // rejection, but that can only be discovered server-side (it needs
        // the whole property graph) — its 400 message, which already
        // carries the offending cycle path, surfaces as-is via
        // `propertyFormError` below, same as every other save error here.
        if (!formulaExpression.trim()) {
          throw new Error("Formula expression is required");
        }
        const res = await fetch(`/api/db/data-sources/${dataSourceId}/properties`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: propertyName.trim() || "Formula",
            type: "formula",
            config: { expression: formulaExpression },
          }),
        });
        if (!res.ok) throw new Error(await errorMessage(res));
      } else if (propertyType === "rollup") {
        if (!rollupRelationKey) {
          throw new Error("Choose a relation property to roll up through");
        }
        if (!rollupTargetKey) {
          throw new Error("Choose a property on the target database");
        }
        if (!rollupFunction) {
          throw new Error("Choose a rollup function");
        }
        const relationProp = orderedProperties.find(
          (p) => p.type === "relation" && p.key === rollupRelationKey
        );
        const targetDsId =
          typeof relationProp?.config?.target_data_source_id === "string"
            ? (relationProp.config.target_data_source_id as string)
            : undefined;
        if (!targetDsId) {
          throw new Error("The chosen relation has no configured target database");
        }
        const res = await fetch(`/api/db/data-sources/${dataSourceId}/properties`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: propertyName.trim() || "Rollup",
            type: "rollup",
            config: {
              relation_key: rollupRelationKey,
              target_data_source_id: targetDsId,
              target_key: rollupTargetKey,
              function: rollupFunction,
            },
          }),
        });
        if (!res.ok) throw new Error(await errorMessage(res));
      } else {
        const res = await fetch(`/api/db/data-sources/${dataSourceId}/properties`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: propertyName.trim() || "Property", type: propertyType }),
        });
        if (!res.ok) throw new Error(await errorMessage(res));
      }
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
                      {propertyType === "relation" && (
                        <>
                          <select
                            aria-label="Target database"
                            value={targetDataSourceId}
                            onChange={(e) => setTargetDataSourceId(e.target.value)}
                            className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                          >
                            <option value="">
                              {databasesLoading ? "Loading databases…" : "Choose a database…"}
                            </option>
                            {databases?.map((d) => (
                              <option key={d.data_source.id} value={d.data_source.id}>
                                {d.database.title || "Untitled"}
                                {d.data_source.id === dataSourceId ? " (this database)" : ""}
                              </option>
                            ))}
                          </select>
                          <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                            <input
                              type="checkbox"
                              aria-label="Two-way relation"
                              checked={twoWay}
                              onChange={(e) => setTwoWay(e.target.checked)}
                            />
                            Two-way
                          </label>
                          {twoWay && (
                            <input
                              aria-label="Reverse property name"
                              value={reverseName}
                              onChange={(e) => setReverseName(e.target.value)}
                              placeholder="Reverse property name"
                              className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                            />
                          )}
                        </>
                      )}
                      {propertyType === "formula" && dataSourceId && (
                        // basis-full: FormulaEditor's textarea + validation
                        // UI is too tall for the name/type row itself — this
                        // wraps it onto its own line (the form is
                        // `flex-wrap`), Add/Cancel following below it.
                        // Deliberately NOT gated on `valid: true` (see the
                        // submit handler's own comment) — FormulaEditor
                        // renders its own error list so the user can see
                        // why, but "Add" stays enabled either way.
                        <div className="basis-full">
                          <FormulaEditor
                            dataSourceId={dataSourceId}
                            expression={formulaExpression}
                            onExpressionChange={setFormulaExpression}
                          />
                        </div>
                      )}
                      {propertyType === "rollup" && (
                        <>
                          {relationProperties.length === 0 ? (
                            <span className="text-xs text-amber-600 dark:text-amber-400 basis-full">
                              Add a relation property first — a rollup needs one to roll up through.
                            </span>
                          ) : (
                            <>
                              <select
                                aria-label="Rollup relation"
                                value={rollupRelationKey}
                                onChange={(e) => {
                                  setRollupRelationKey(e.target.value);
                                  setRollupTargetKey("");
                                }}
                                className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                              >
                                <option value="">Choose a relation…</option>
                                {relationProperties.map((p) => (
                                  <option key={p.key} value={p.key}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                              <select
                                aria-label="Rollup target property"
                                value={rollupTargetKey}
                                onChange={(e) => setRollupTargetKey(e.target.value)}
                                disabled={!rollupRelationKey}
                                className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 disabled:opacity-40"
                              >
                                <option value="">
                                  {targetPropertiesLoading ? "Loading properties…" : "Choose a property…"}
                                </option>
                                {targetProperties?.map((p) => (
                                  <option key={p.key} value={p.key}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                              <select
                                aria-label="Rollup function"
                                value={rollupFunction}
                                onChange={(e) => setRollupFunction(e.target.value)}
                                className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                              >
                                <option value="">Choose a function…</option>
                                {ROLLUP_FUNCTIONS.map((fn) => (
                                  <option key={fn} value={fn}>
                                    {fn}
                                  </option>
                                ))}
                              </select>
                            </>
                          )}
                        </>
                      )}
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
