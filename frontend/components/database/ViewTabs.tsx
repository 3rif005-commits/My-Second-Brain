"use client";

// Tab row over a data source's views + the "+ New view" inline creation
// form (task-16). Kept as its own component rather than folded into
// DatabaseShell.tsx — the creation form has enough of its own state
// (name/type/group-by-property draft, submit/error state) that inlining it
// would make DatabaseShell noticeably harder to read.
import { useState } from "react";
import type { PropertyResponse, ViewResponse } from "@/lib/database/types";
import { GROUPABLE_PROPERTY_TYPES } from "@/lib/database/types";
import {
  ChartCreateFields,
  DEFAULT_CHART_DRAFT,
  buildChartViewConfig,
  isChartConfigComplete,
} from "./views/ChartView";
import type { ChartDraftConfig } from "./views/ChartView";

interface ViewTabsProps {
  views: ViewResponse[];
  activeViewId: string;
  onSelect: (viewId: string) => void;
  /** Used to build the Board-creation "group by" dropdown — restricted to
   * groupable types (select/status/multi_select) — and the Calendar/
   * Timeline-creation "date property" dropdown (both require the same
   * `date_property_id`, task-34-brief.md extending task-33's pattern),
   * restricted to `type === "date"`. Also handed to Chart-creation's own
   * `ChartCreateFields` (task-35), which does its own filtering for its
   * x_axis/stack_by (groupable types, same restriction as Board) and
   * y_axis (any property) pickers. */
  properties: PropertyResponse[];
  onCreateView: (input: {
    name: string;
    type: string;
    groupPropertyKey?: string;
    datePropertyKey?: string;
    chartConfig?: Record<string, unknown>;
  }) => Promise<void>;
  /** M3's view toolbar (Filter/Sort/Automations/AI Autofill/Search/Settings)
   * — rendered in THIS SAME row, right-aligned via its own `ml-auto`, per
   * view-options-panel.md's diagram (`[ Table ▾ ] ... [toolbar] [ New ▾ ]`).
   * A prop rather than DatabaseShell wrapping this component in a second
   * flex row: this row is already `flex-wrap`, and nesting another flex
   * container around it risks the tabs wrapping oddly next to the toolbar. */
  trailing?: React.ReactNode;
}

// The ten view types this milestone supports creating (table/board —
// Task 16; gallery/list/feed — Task 17; calendar — Task 33; timeline —
// Task 34; chart — Task 35; form — Task 44; dashboard — Task 45). Map is
// explicitly out of scope for the whole milestone (user decision — no
// geocoding/tile provider configured, docs/plans/2026-08-08-notion-
// databases.md M13).
//
// Dashboard needs no creation-time fields the way Board/Calendar/Timeline/
// Chart do (task-45-brief.md, confirmed against `ViewCreate` in
// models/database.py: it has no `config` field at all) — a freshly created
// dashboard always starts at `config: {}` (empty `rows`), and every widget
// is added afterward through DashboardView's own Edit mode, which PATCHes
// `config` through the same `_validate_dashboard_config`-guarded
// `update_view` endpoint every other config change already goes through.
const VIEW_TYPE_OPTIONS = [
  { value: "table", label: "Table" },
  { value: "board", label: "Board" },
  { value: "gallery", label: "Gallery" },
  { value: "list", label: "List" },
  { value: "feed", label: "Feed" },
  { value: "calendar", label: "Calendar" },
  { value: "timeline", label: "Timeline" },
  { value: "chart", label: "Chart" },
  { value: "form", label: "Form" },
  { value: "dashboard", label: "Dashboard" },
] as const;

export function ViewTabs({ views, activeViewId, onSelect, properties, onCreateView, trailing }: ViewTabsProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("table");
  const [groupPropertyKey, setGroupPropertyKey] = useState("");
  const [datePropertyKey, setDatePropertyKey] = useState("");
  const [chartDraft, setChartDraft] = useState<ChartDraftConfig>(DEFAULT_CHART_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const groupableProperties = properties.filter((p) =>
    (GROUPABLE_PROPERTY_TYPES as readonly string[]).includes(p.type)
  );
  const dateProperties = properties.filter((p) => p.type === "date");

  function resetForm() {
    setCreating(false);
    setName("");
    setType("table");
    setGroupPropertyKey("");
    setDatePropertyKey("");
    setChartDraft(DEFAULT_CHART_DRAFT);
    setSubmitting(false);
    setFormError(null);
  }

  // task-16-brief.md's deliberate deviation from Notion (which auto-creates
  // a status property and mutates the schema): a Board view here requires
  // picking an existing groupable property. No property picked yet, or
  // none exists at all, both keep Create disabled — never silently falls
  // back to inventing one.
  const boardNeedsPropertyButHasNone = type === "board" && groupableProperties.length === 0;
  const boardMissingSelection = type === "board" && !boardNeedsPropertyButHasNone && !groupPropertyKey;
  // Calendar mirrors Board's gate exactly (task-33-brief.md's ruling,
  // decided rather than guessing at calendar's undocumented empty-state
  // behaviour): require picking a date property before Create is enabled.
  // Timeline needs the identical required `date_property_id` (task-34-
  // brief.md) — extended into the same boolean/condition rather than
  // duplicated, since both types share one "Date property" picker below.
  const isDateDrivenView = type === "calendar" || type === "timeline";
  const calendarNeedsPropertyButHasNone = isDateDrivenView && dateProperties.length === 0;
  const calendarMissingSelection = isDateDrivenView && !calendarNeedsPropertyButHasNone && !datePropertyKey;
  // Chart (task-35): its own `canSubmit`-gated pattern, same standard as
  // Board/Calendar/Timeline above — don't let a chart be created that would
  // render nothing. `isChartConfigComplete` is the one source of truth for
  // "is this draft submittable" (also unit-tested directly against
  // `ChartDraftConfig` fixtures in ChartView.test.tsx), not re-derived here.
  const chartMissingSelection = type === "chart" && !isChartConfigComplete(chartDraft);
  const canSubmit =
    !submitting &&
    !boardNeedsPropertyButHasNone &&
    !boardMissingSelection &&
    !calendarNeedsPropertyButHasNone &&
    !calendarMissingSelection &&
    !chartMissingSelection;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await onCreateView({
        name: name.trim() || "New view",
        type,
        groupPropertyKey: type === "board" ? groupPropertyKey : undefined,
        datePropertyKey: isDateDrivenView ? datePropertyKey : undefined,
        chartConfig: type === "chart" ? buildChartViewConfig(chartDraft, properties) : undefined,
      });
      resetForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create view");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-1 mt-2.5 flex-wrap">
      {views.map((view) => (
        <button
          key={view.id}
          type="button"
          onClick={() => onSelect(view.id)}
          className={`text-xs font-medium px-2.5 py-1 rounded-md ${
            view.id === activeViewId
              ? "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
              : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          }`}
        >
          {view.icon && <span className="mr-1">{view.icon}</span>}
          {view.name}
        </button>
      ))}

      {!creating ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="text-xs font-medium px-2.5 py-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          + New view
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="flex items-center gap-1.5 flex-wrap">
          <input
            autoFocus
            aria-label="View name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New view"
            className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
          <select
            aria-label="View type"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setGroupPropertyKey("");
              setDatePropertyKey("");
              setChartDraft(DEFAULT_CHART_DRAFT);
            }}
            className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            {VIEW_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {type === "board" &&
            (boardNeedsPropertyButHasNone ? (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                no groupable property yet — add a Select, Status, or Multi-select property first
              </span>
            ) : (
              <select
                aria-label="Group by"
                value={groupPropertyKey}
                onChange={(e) => setGroupPropertyKey(e.target.value)}
                className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              >
                <option value="">Group by…</option>
                {groupableProperties.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </select>
            ))}

          {isDateDrivenView &&
            (calendarNeedsPropertyButHasNone ? (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                no date property yet — add a Date property first
              </span>
            ) : (
              <select
                aria-label="Date property"
                value={datePropertyKey}
                onChange={(e) => setDatePropertyKey(e.target.value)}
                className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              >
                <option value="">Date property…</option>
                {dateProperties.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </select>
            ))}

          {type === "chart" && (
            <ChartCreateFields properties={properties} value={chartDraft} onChange={setChartDraft} />
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="text-xs px-2 py-1 rounded bg-indigo-600 text-white disabled:opacity-40"
          >
            Create
          </button>
          <button
            type="button"
            onClick={resetForm}
            className="text-xs px-1.5 py-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            Cancel
          </button>
          {formError && <span className="text-xs text-red-500">{formError}</span>}
        </form>
      )}
      {trailing}
    </div>
  );
}
