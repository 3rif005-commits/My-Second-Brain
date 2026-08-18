"use client";

// Shell around a database: title bar, view tabs (+ creation), and a
// switch over the active view's `type` that renders the matching view
// component. Was hardcoded to `views[0]` + TableView only (Milestone 2);
// task-16 adds real view switching/creation and the Board view.
import { useDatabaseView } from "@/lib/database/useDatabaseView";
import { getGroupBySpec, getSubGroupBySpec, getSubtaskDisplayMode } from "@/lib/database/types";
import { TableView } from "./views/TableView";
import { BoardView } from "./views/BoardView";
import { GalleryView } from "./views/GalleryView";
import { ListView } from "./views/ListView";
import { FeedView } from "./views/FeedView";
import { CalendarView } from "./views/CalendarView";
import { TimelineView } from "./views/TimelineView";
import { ChartView } from "./views/ChartView";
import { ViewTabs } from "./ViewTabs";
import { DatabaseSettingsMenu } from "./DatabaseSettingsMenu";

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
    aggregates,
    loading,
    error,
    updateCell,
    relationLinks,
    ensureRelationLinks,
    ensureRelationLinksBulk,
    setRelationLinks,
    createView,
    updateView,
    templates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    instantiateTemplate,
    automations,
    createAutomation,
    updateAutomation,
    deleteAutomation,
    refetch,
    refetchRows,
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
   * renders with a dangling/missing group_by.
   *
   * Live-verified regression: `services.db.query.grouping.GroupBySpec` has
   * no implicit default `mode` for `status` (Milestone 4's own "fail loud,
   * don't guess" decision — `mode=None` raises `ValueError`, surfaced as a
   * real 400 from `POST .../query`, confirmed by actually creating a Board
   * grouped by a Status property and watching it 400 with "status requires
   * mode='option' or 'group'"). `select`/`multi_select` (the other two
   * `GROUPABLE_PROPERTY_TYPES`) have no mode concept at all, so this only
   * needs to special-case `status` — default it to `"option"` (individual
   * options, not status groups — matches how the Status column itself
   * already renders/edits, since status *groups* aren't configurable
   * anywhere in this UI yet). */
  async function handleCreateView(input: {
    name: string;
    type: string;
    groupPropertyKey?: string;
    datePropertyKey?: string;
    chartConfig?: Record<string, unknown>;
  }) {
    const created = await createView(input.name, input.type);
    if (input.type === "board" && input.groupPropertyKey) {
      const groupProperty = properties.find((p) => p.key === input.groupPropertyKey);
      const groupBy: Record<string, unknown> = { property_key: input.groupPropertyKey };
      if (groupProperty?.type === "status") groupBy.mode = "option";
      await updateView(created.id, { config: { group_by: groupBy } });
    }
    // Calendar's creation-time required config (task-33-brief.md), extended
    // to Timeline (task-34-brief.md — identical shape, same required
    // `date_property_id` field): create bare, then PATCH the chosen date
    // property into config.date_property_id before switching to it, so the
    // new view never renders with a dangling/missing date property.
    if ((input.type === "calendar" || input.type === "timeline") && input.datePropertyKey) {
      await updateView(created.id, { config: { date_property_id: input.datePropertyKey } });
    }
    // Chart's creation-time required config (task-35-brief.md): same
    // "create bare, then PATCH" mechanism as Board/Calendar/Timeline above,
    // but the config itself (chart_type + y_axis + optionally x_axis/
    // stack_by/hide_empty_groups) is assembled by ViewTabs.tsx's
    // `ChartCreateFields` form (via `buildChartViewConfig`) rather than a
    // single property key, since Chart's config is more involved than any
    // of theirs.
    if (input.type === "chart" && input.chartConfig) {
      await updateView(created.id, { config: input.chartConfig });
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
            refetchRows={refetchRows}
            relationLinks={relationLinks}
            ensureRelationLinks={ensureRelationLinks}
            ensureRelationLinksBulk={ensureRelationLinksBulk}
            setRelationLinks={setRelationLinks}
            subItemDisplayMode={getSubtaskDisplayMode(activeView.config)}
            templates={templates}
            onInstantiateTemplate={instantiateTemplate}
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
      case "calendar":
        return (
          <CalendarView
            properties={properties}
            rows={rows}
            editable={editable}
            onCellChange={updateCell}
            config={activeView.config}
            onConfigChange={(patch) => updateView(activeView.id, { config: { ...activeView.config, ...patch } })}
            dataSourceId={dataSourceId}
            refetchRows={refetchRows}
          />
        );
      case "timeline":
        return (
          <TimelineView
            properties={properties}
            rows={rows}
            editable={editable}
            onCellChange={updateCell}
            config={activeView.config}
            onConfigChange={(patch) => updateView(activeView.id, { config: { ...activeView.config, ...patch } })}
            relationLinks={relationLinks}
            ensureRelationLinksBulk={ensureRelationLinksBulk}
          />
        );
      case "chart":
        // Read-only for data (research §9.8: "you can't edit database
        // entries from chart view") — unlike every other case above, this
        // one does NOT thread through `editable`/`onCellChange` at all:
        // `editable` is forced `false` unconditionally (never the caller's
        // real All-Notes-vs-ordinary state), and `onCellChange` isn't
        // passed at all (ChartView's own prop is optional and, even when
        // supplied directly in its own tests, is never reachable from any
        // interaction — see ChartView.test.tsx).
        return (
          <ChartView
            properties={properties}
            config={activeView.config}
            groups={groups}
            aggregates={aggregates}
            editable={false}
          />
        );
      default:
        // Task-15's own spirit for view *config* ("tolerates unknown...
        // drops them at read"), applied to view *type* rendering — every
        // type this milestone ships (table/board/gallery/list/feed/
        // calendar/timeline/chart) has a branch above; anything else (a
        // stale/unknown string) is a plain message, never a crash or a
        // blank screen.
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
          {/* All Notes has no db_properties/db_views rows to configure at
           * all (it's synthesized from COLUMN_BACKED, routers/databases.py)
           * — hidden rather than shown-disabled, same "not merely disabled"
           * rule the relation controls follow. */}
          {editable && (
            <div className="ml-auto">
              <DatabaseSettingsMenu
                dataSourceId={dataSourceId}
                properties={properties}
                activeView={activeView}
                onPropertiesChanged={refetch}
                onUpdateView={updateView}
                templates={templates}
                onCreateTemplate={createTemplate}
                onUpdateTemplate={updateTemplate}
                onDeleteTemplate={deleteTemplate}
                automations={automations}
                onCreateAutomation={createAutomation}
                onUpdateAutomation={updateAutomation}
                onDeleteAutomation={deleteAutomation}
              />
            </div>
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
