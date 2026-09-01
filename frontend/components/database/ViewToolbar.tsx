"use client";

// M3's view toolbar (view-options-panel.md's "Establish the whole toolbar
// first, because we have none of it") — Filter · Sort · Automations ·
// AI Autofill · Search · Settings, at the right of the view-tabs row.
//
// Filter and Sort reuse the EXACT SAME MenuPanel data ViewSettingsSidebar
// pushes for its own Filter/Sort rows (`sortPanel`/`placeholderPanel`,
// exported from there) — hosted here as a popover flyout instead of a
// pushed sidebar panel. Two entry points, one panel-as-data, which is the
// whole argument for building panels this way.
//
// Automations reuses the existing AutomationManager modal directly rather
// than growing a second entry point's worth of bespoke UI. AI Autofill and
// Search have no real surface behind them yet (AI Autofill: out of scope for
// this app; Search: view-options-panel.md marks it TBD) — both disabled with
// a reason, the "disabled, not missing" convention this branch uses
// everywhere else for the same situation (e.g. M1's Filter row before M4).
import { useState } from "react";
import { ArrowUpDown, Filter as FilterIcon, Search as SearchIcon, Settings, Sparkles, Wand2 } from "lucide-react";
import { MenuList, Popover } from "@/components/ui/primitives";
import type { AutomationPatch, AutomationResponse, PropertyResponse, ViewResponse } from "@/lib/database/types";
import { placeholderPanel, sortPanel } from "./ViewSettingsSidebar";
import { AutomationManager } from "./AutomationManager";

type Sort = { property: string; direction: "asc" | "desc" };

function asSorts(raw: unknown[]): Sort[] {
  return raw.filter(
    (s): s is Sort =>
      Boolean(s) &&
      typeof s === "object" &&
      typeof (s as Sort).property === "string" &&
      ((s as Sort).direction === "asc" || (s as Sort).direction === "desc")
  );
}

export interface ViewToolbarProps {
  view: ViewResponse;
  properties: PropertyResponse[];
  onSetSorts: (sorts: Sort[]) => void;
  dataSourceId: string;
  automations: AutomationResponse[];
  onCreateAutomation: (name: string) => Promise<AutomationResponse>;
  onUpdateAutomation: (id: string, patch: AutomationPatch) => Promise<AutomationResponse>;
  onDeleteAutomation: (id: string) => Promise<void>;
  onOpenSettings: () => void;
}

function ToolbarButton({
  label,
  icon,
  onClick,
  disabled,
  disabledReason,
}: {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={disabled ? disabledReason : label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-gray-800 dark:hover:text-gray-300"
    >
      {icon}
    </button>
  );
}

export function ViewToolbar({
  view,
  properties,
  onSetSorts,
  dataSourceId,
  automations,
  onCreateAutomation,
  onUpdateAutomation,
  onDeleteAutomation,
  onOpenSettings,
}: ViewToolbarProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const sorts = asSorts(view.sorts ?? []);

  return (
    <div className="ml-auto flex items-center gap-0.5" role="toolbar" aria-label="View toolbar">
      <Popover
        open={filterOpen}
        onOpenChange={setFilterOpen}
        width="sm"
        label="Filter"
        trigger={<ToolbarButton label="Filter" icon={<FilterIcon size={14} />} />}
      >
        <MenuList
          root={placeholderPanel("Filter", "Filters aren't available in this view yet.")}
          nav="flyout"
          onClose={() => setFilterOpen(false)}
          label="Filter"
        />
      </Popover>

      <Popover
        open={sortOpen}
        onOpenChange={setSortOpen}
        width="sm"
        label="Sort"
        trigger={
          <ToolbarButton
            label={
              sorts.length === 1
                ? `Sort: ${properties.find((p) => p.key === sorts[0].property)?.name ?? sorts[0].property}`
                : sorts.length > 1
                  ? `${sorts.length} sorts`
                  : "Sort"
            }
            icon={<ArrowUpDown size={14} />}
          />
        }
      >
        <MenuList
          root={sortPanel(properties, sorts, (next) => {
            onSetSorts(next);
          })}
          nav="flyout"
          onClose={() => setSortOpen(false)}
          label="Sort"
        />
      </Popover>

      <ToolbarButton
        label="Automations"
        icon={<Wand2 size={14} />}
        onClick={() => setAutomationsOpen(true)}
      />

      <ToolbarButton label="AI Autofill" icon={<Sparkles size={14} />} disabled disabledReason="Out of scope for this app" />

      <ToolbarButton label="Search" icon={<SearchIcon size={14} />} disabled disabledReason="In-view search isn't available yet" />

      <ToolbarButton label="Settings" icon={<Settings size={14} />} onClick={onOpenSettings} />

      <AutomationManager
        open={automationsOpen}
        onClose={() => setAutomationsOpen(false)}
        automations={automations}
        properties={properties}
        dataSourceId={dataSourceId}
        onCreateAutomation={onCreateAutomation}
        onUpdateAutomation={onUpdateAutomation}
        onDeleteAutomation={onDeleteAutomation}
      />
    </div>
  );
}
