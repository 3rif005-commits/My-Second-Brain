"use client";

// Tab row over a data source's views + the "+ New view" inline creation
// form (task-16). Kept as its own component rather than folded into
// DatabaseShell.tsx — the creation form has enough of its own state
// (name/type/group-by-property draft, submit/error state) that inlining it
// would make DatabaseShell noticeably harder to read.
import { useState } from "react";
import type { PropertyResponse, ViewResponse } from "@/lib/database/types";
import { GROUPABLE_PROPERTY_TYPES } from "@/lib/database/types";

interface ViewTabsProps {
  views: ViewResponse[];
  activeViewId: string;
  onSelect: (viewId: string) => void;
  /** Used to build the Board-creation "group by" dropdown — restricted to
   * groupable types (select/status/multi_select) — and the Calendar-
   * creation "date property" dropdown, restricted to `type === "date"`. */
  properties: PropertyResponse[];
  onCreateView: (input: {
    name: string;
    type: string;
    groupPropertyKey?: string;
    datePropertyKey?: string;
  }) => Promise<void>;
}

// The six view types this milestone supports creating (table/board —
// Task 16; gallery/list/feed — Task 17; calendar — Task 33).
const VIEW_TYPE_OPTIONS = [
  { value: "table", label: "Table" },
  { value: "board", label: "Board" },
  { value: "gallery", label: "Gallery" },
  { value: "list", label: "List" },
  { value: "feed", label: "Feed" },
  { value: "calendar", label: "Calendar" },
] as const;

export function ViewTabs({ views, activeViewId, onSelect, properties, onCreateView }: ViewTabsProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("table");
  const [groupPropertyKey, setGroupPropertyKey] = useState("");
  const [datePropertyKey, setDatePropertyKey] = useState("");
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
  const calendarNeedsPropertyButHasNone = type === "calendar" && dateProperties.length === 0;
  const calendarMissingSelection = type === "calendar" && !calendarNeedsPropertyButHasNone && !datePropertyKey;
  const canSubmit =
    !submitting &&
    !boardNeedsPropertyButHasNone &&
    !boardMissingSelection &&
    !calendarNeedsPropertyButHasNone &&
    !calendarMissingSelection;

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
        datePropertyKey: type === "calendar" ? datePropertyKey : undefined,
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

          {type === "calendar" &&
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
    </div>
  );
}
