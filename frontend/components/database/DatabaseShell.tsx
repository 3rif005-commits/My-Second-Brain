"use client";

// Shell around a database: title bar, view tabs (+ creation), and a
// switch over the active view's `type` that renders the matching view
// component. Was hardcoded to `views[0]` + TableView only (Milestone 2);
// task-16 adds real view switching/creation and the Board view.
import { useDatabaseView } from "@/lib/database/useDatabaseView";
import { getGroupBySpec, getSubGroupBySpec } from "@/lib/database/types";
import { TableView } from "./views/TableView";
import { BoardView } from "./views/BoardView";
import { GalleryView } from "./views/GalleryView";
import { ListView } from "./views/ListView";
import { FeedView } from "./views/FeedView";
import { ViewTabs } from "./ViewTabs";

interface DatabaseShellProps {
  databaseId: string;
}

export function DatabaseShell({ databaseId }: DatabaseShellProps) {
  const {
    database,
    dataSource,
    properties,
    views,
    activeViewId,
    setActiveViewId,
    rows,
    groups,
    loading,
    error,
    updateCell,
    createView,
    updateView,
    refetch,
  } = useDatabaseView(databaseId);

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
  const activeView = views.find((v) => v.id === activeViewId) ?? views[0] ?? null;
  // Captured as a plain string rather than reading `dataSource.id` inside
  // `renderActiveView` below: TS's control-flow narrowing from the
  // `!dataSource` check above doesn't cross into a nested function's body,
  // so `dataSource` would still type as possibly-null there.
  const dataSourceId = dataSource.id;

  /** "+ New view" (ViewTabs.tsx): create, then — for a Board with a chosen
   * group-by property — persist that choice via the existing `PATCH
   * /db/views/{id}` endpoint before switching to it, so the new view never
   * renders with a dangling/missing group_by. */
  async function handleCreateView(input: { name: string; type: string; groupPropertyKey?: string }) {
    const created = await createView(input.name, input.type);
    if (input.type === "board" && input.groupPropertyKey) {
      await updateView(created.id, { config: { group_by: { property_key: input.groupPropertyKey } } });
    }
    setActiveViewId(created.id);
  }

  function renderActiveView() {
    if (!activeView) return null;

    switch (activeView.type) {
      case "table":
        return (
          <TableView
            properties={properties}
            rows={rows}
            editable={editable}
            onCellChange={updateCell}
            dataSourceId={dataSourceId}
            refetch={refetch}
          />
        );
      case "board": {
        const groupBy = getGroupBySpec(activeView.config);
        const subGroupBy = getSubGroupBySpec(activeView.config);
        return (
          <BoardView
            properties={properties}
            groups={groups}
            groupPropertyKey={groupBy?.property_key ?? null}
            hideEmptyGroups={groupBy?.hide_empty_groups ?? false}
            onToggleHideEmptyGroups={(value) =>
              updateView(activeView.id, {
                config: {
                  ...activeView.config,
                  group_by: { ...(groupBy ?? { property_key: "" }), hide_empty_groups: value },
                  ...(subGroupBy ? { sub_group_by: subGroupBy } : {}),
                },
              })
            }
            editable={editable}
            onCellChange={updateCell}
          />
        );
      }
      case "gallery":
        return (
          <GalleryView
            properties={properties}
            rows={rows}
            editable={editable}
            onCellChange={updateCell}
            config={activeView.config}
            onConfigChange={(patch) => updateView(activeView.id, { config: { ...activeView.config, ...patch } })}
          />
        );
      case "list":
        return (
          <ListView properties={properties} rows={rows} editable={editable} onCellChange={updateCell} />
        );
      case "feed":
        return (
          <FeedView
            properties={properties}
            rows={rows}
            editable={editable}
            onCellChange={updateCell}
            config={activeView.config}
            onConfigChange={(patch) => updateView(activeView.id, { config: { ...activeView.config, ...patch } })}
          />
        );
      default:
        // Task-15's own spirit for view *config* ("tolerates unknown...
        // drops them at read"), applied to view *type* rendering — every
        // type this milestone ships (table/board/gallery/list/feed) has a
        // branch above; anything else (a future type, or a stale/unknown
        // string) is a plain message, never a crash or a blank screen.
        return (
          <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500">
            This view type isn&apos;t supported yet.
          </div>
        );
    }
  }

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

        <ViewTabs
          views={views}
          activeViewId={activeView?.id ?? ""}
          onSelect={setActiveViewId}
          properties={properties}
          onCreateView={handleCreateView}
        />
      </div>

      {/* Active view */}
      <div className="flex-1 min-h-0">{renderActiveView()}</div>
    </div>
  );
}
