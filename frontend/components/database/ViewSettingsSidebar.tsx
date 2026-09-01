"use client";

// M3 — the view settings sidebar (view-options-panel.md).
//
// THE ONE THING THAT LOOKS LIKE A MISTAKE BUT IS NOT: this is NOT a popover.
// It is a docked right-hand sidebar, 483px, dismissed by its own × — the
// SidePeek primitive (`mode="side"`, `resizable={false}`) hosts it, and
// MenuList's `nav="push"`/`dismissible` give every level (root or pushed) a
// back arrow and a persistent × in the same title row. Filter and Sort are
// ALSO top-level toolbar buttons (ViewToolbar.tsx) — two entry points to the
// same MenuPanel data, which is the whole point of panels-as-data.
//
// Filter, Group and Sort's real editors are M4/M5/M6's own milestones (the
// plan's own milestone table lists them separately) — Group and Sort below
// are working MVPs (single group-by; multi-sort minus drag-reorder) built on
// infrastructure M1 already wired (onSetSorts) or that already existed
// (GROUPABLE_PROPERTY_TYPES), not stubs. Filter has zero existing
// infrastructure (no compiler, no operators) — its row pushes an honest
// placeholder rather than a half-built filter UI this milestone was never
// scoped to write.
import { useState } from "react";
import {
  Bolt,
  Copy,
  Filter as FilterIcon,
  Info,
  Link2,
  List as ListIcon,
  Lock,
  Palette,
  Rows3,
  Sparkles,
  SlidersHorizontal,
  Table2,
  Users,
} from "lucide-react";
import { useToast } from "@/app/providers";
import { MenuList, SidePeek } from "@/components/ui/primitives";
import type { MenuPanel, MenuRow } from "@/components/ui/primitives";
import type {
  AutomationPatch,
  AutomationResponse,
  DatabaseResponse,
  GroupBySpec,
  PropertyResponse,
  ViewResponse,
} from "@/lib/database/types";
import { isGroupablePropertyType } from "@/lib/database/types";
import { getHiddenKeys, orderProperties, patchHidden } from "@/lib/database/viewConfig";
import { editPropertyPanel, hasEditableConfig } from "./EditPropertyPanel";
import { propertyTypeIcon, sortLabels } from "./ColumnHeaderMenu";
import { PropertyVisibilityPanel } from "./PropertyVisibilityPanel";
import { ViewLayoutPanel } from "./ViewLayoutPanel";
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

async function errorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.detail || body?.error || `Request failed (${res.status})`;
}

// ── §D Group — a working single-group-by MVP (group-and-sort-panels.txt) ──

function groupPanel(
  properties: PropertyResponse[],
  groupBy: GroupBySpec | undefined,
  onSelect: (property: PropertyResponse | null) => void
): MenuPanel {
  // Alphabetical — this list is for FINDING, not reordering (view-options-
  // panel.md's own stated rule, contrasted with Property visibility's table
  // order).
  const alphabetical = [...properties].sort((a, b) => a.name.localeCompare(b.name));
  const rows: MenuRow[] = [
    { id: "none", label: "None", checked: !groupBy, onSelect: () => onSelect(null) },
    ...alphabetical.map((p) => ({
      id: p.key,
      icon: propertyTypeIcon(p.type),
      label: p.name,
      checked: groupBy?.property_key === p.key,
      disabled: !isGroupablePropertyType(p.type),
      disabledReason: "Grouping isn't supported for this property type yet",
      onSelect: () => onSelect(p),
    })),
  ];
  return {
    title: groupBy ? "Group" : "Group by",
    search: { placeholder: "Search for a property…" },
    sections: [{ rows }],
  };
}

// ── §E Sort — multi-sort MVP (direction + remove per row); drag-reorder is M5 ──

function sortRowSubmenu(property: PropertyResponse, sorts: Sort[], onSetSorts: (next: Sort[]) => void): MenuPanel {
  const labels = sortLabels(property.type);
  const current = sorts.find((s) => s.property === property.key);
  const setDirection = (direction: "asc" | "desc") =>
    onSetSorts(sorts.map((s) => (s.property === property.key ? { ...s, direction } : s)));
  return {
    sections: [
      {
        rows: [
          { id: "asc", label: labels.asc, checked: current?.direction === "asc", onSelect: () => setDirection("asc") },
          { id: "desc", label: labels.desc, checked: current?.direction === "desc", onSelect: () => setDirection("desc") },
        ],
      },
      {
        rows: [
          {
            id: "remove",
            label: "Remove sort",
            danger: true,
            onSelect: () => onSetSorts(sorts.filter((s) => s.property !== property.key)),
          },
        ],
      },
    ],
  };
}

export function sortPanel(properties: PropertyResponse[], sorts: Sort[], onSetSorts: (next: Sort[]) => void): MenuPanel {
  const alphabetical = [...properties].sort((a, b) => a.name.localeCompare(b.name));
  const sortedKeys = new Set(sorts.map((s) => s.property));
  // Already-sorted properties are excluded from the picker — observed live
  // (group-and-sort-panels.txt: "'Name' was absent from the list once it
  // was sorted").
  const pickerRows: MenuRow[] = alphabetical
    .filter((p) => !sortedKeys.has(p.key))
    .map((p) => ({
      id: p.key,
      icon: propertyTypeIcon(p.type),
      label: p.name,
      onSelect: () => onSetSorts([...sorts, { property: p.key, direction: "asc" }]),
    }));

  if (sorts.length === 0) {
    return { title: "New sort", search: { placeholder: "Sort by…" }, sections: [{ rows: pickerRows }] };
  }

  const sortRows: MenuRow[] = sorts.map((s) => {
    const p = properties.find((pp) => pp.key === s.property);
    const labels = p ? sortLabels(p.type) : { asc: "Ascending", desc: "Descending" };
    return {
      id: s.property,
      icon: p ? propertyTypeIcon(p.type) : undefined,
      label: p?.name ?? s.property,
      value: s.direction === "asc" ? labels.asc : labels.desc,
      submenu: p ? () => sortRowSubmenu(p, sorts, onSetSorts) : undefined,
    };
  });

  return {
    title: "Sort",
    sections: [
      { rows: sortRows },
      {
        rows: [
          {
            id: "add",
            label: "+ Add sort",
            disabled: pickerRows.length === 0,
            disabledReason: "Every property is already sorted",
            submenu: pickerRows.length > 0 ? () => ({ search: { placeholder: "Sort by…" }, sections: [{ rows: pickerRows }] }) : undefined,
          },
          { id: "delete-all", label: "Delete sort", danger: true, onSelect: () => onSetSorts([]) },
        ],
      },
    ],
  };
}

// ── Section 2 row 9, "Edit properties" — a real (if minimal) list ─────────

function editPropertiesPanel(
  properties: PropertyResponse[],
  patchPropertyConfig: (property: PropertyResponse, patch: Record<string, unknown>) => void
): MenuPanel {
  const rows: MenuRow[] = properties.map((p) => ({
    id: p.key,
    icon: propertyTypeIcon(p.type),
    label: p.name,
    disabled: !hasEditableConfig(p.type),
    disabledReason: "This property type has no per-view editable settings",
    submenu: hasEditableConfig(p.type)
      ? () =>
          editPropertyPanel({
            type: p.type,
            config: p.config ?? {},
            onPatchConfig: (patch) => patchPropertyConfig(p, patch),
          })!
      : undefined,
  }));
  return { title: "Edit properties", search: { placeholder: "Search for a property…" }, sections: [{ rows }] };
}

// ── Stubs for surfaces this milestone doesn't own ──────────────────────────

export function placeholderPanel(title: string, message: string): MenuPanel {
  return {
    title,
    sections: [{ rows: [], content: <div className="px-2 py-3 text-menu-disabled">{message}</div> }],
  };
}

export interface ViewSettingsSidebarProps {
  open: boolean;
  onClose: () => void;
  view: ViewResponse;
  properties: PropertyResponse[];
  database: DatabaseResponse;
  dataSourceId: string;
  dataSourceName: string;
  /** Receives a PATCH of changed keys only; DatabaseShell merges it through
   * its serialised patchViewConfig queue — see that file's own comment on
   * why a fresh `{...view.config, ...patch}` closure here would reintroduce
   * the stale-merge bug it already fixed once. */
  onPatchConfig: (patch: Record<string, unknown>) => void;
  onUpdateView: (viewId: string, patch: { name: string }) => Promise<ViewResponse>;
  onPropertiesChanged: () => void | Promise<void>;
  onDatabaseChanged: () => void | Promise<void>;
  onSetSorts: (sorts: Sort[]) => void;
  automations: AutomationResponse[];
  onCreateAutomation: (name: string) => Promise<AutomationResponse>;
  onUpdateAutomation: (id: string, patch: AutomationPatch) => Promise<AutomationResponse>;
  onDeleteAutomation: (id: string) => Promise<void>;
}

export function ViewSettingsSidebar({
  open,
  onClose,
  view,
  properties,
  database,
  dataSourceId,
  dataSourceName,
  onPatchConfig,
  onUpdateView,
  onPropertiesChanged,
  onDatabaseChanged,
  onSetSorts,
  automations,
  onCreateAutomation,
  onUpdateAutomation,
  onDeleteAutomation,
}: ViewSettingsSidebarProps) {
  const { showToast } = useToast();
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const config = view.config ?? {};
  const orderedProperties = orderProperties(properties, config);
  const hiddenKeys = getHiddenKeys(config);
  const visibleCount = properties.filter((p) => !hiddenKeys.includes(p.key)).length;
  const sorts = asSorts(view.sorts ?? []);

  async function patchPropertyConfig(property: PropertyResponse, patch: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/db/properties/${property.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { ...(property.config ?? {}), ...patch } }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      await onPropertiesChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not update the property", "error");
    }
  }

  async function toggleDatabaseLock() {
    try {
      const res = await fetch(`/api/db/databases/${database.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_locked: !database.is_locked }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      await onDatabaseChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not update the lock", "error");
    }
  }

  async function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}?view=${view.id}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied to clipboard", "info");
    } catch {
      showToast("Could not copy the link", "error");
    }
  }

  function selectGroupProperty(property: PropertyResponse | null) {
    if (!property) {
      onPatchConfig({ group_by: null });
      return;
    }
    const groupBy: Record<string, unknown> = { property_key: property.key };
    // Mirrors DatabaseShell.handleCreateView's identical Board-creation rule
    // — `status` needs an explicit mode or the query 400s; select/multi_select
    // have no mode concept.
    if (property.type === "status") groupBy.mode = "option";
    onPatchConfig({ group_by: groupBy });
  }

  const rootPanel: MenuPanel = {
    header: (
      <ViewNameHeader
        name={view.name}
        viewType={view.type}
        onRename={(name) =>
          onUpdateView(view.id, { name }).catch((e) =>
            showToast(e instanceof Error ? e.message : "Could not rename the view", "error")
          )
        }
      />
    ),
    sections: [
      {
        rows: [
          {
            id: "layout",
            icon: <Table2 size={14} />,
            label: "Layout",
            value: view.type.charAt(0).toUpperCase() + view.type.slice(1),
            submenu: () => ({
              title: "Layout",
              sections: [{ rows: [], content: <ViewLayoutPanel viewType={view.type} config={config} onPatchConfig={onPatchConfig} /> }],
            }),
          },
          {
            id: "property-visibility",
            icon: <Rows3 size={14} />,
            label: "Property visibility",
            value: String(visibleCount),
            submenu: () => ({
              title: "Property visibility",
              sections: [
                {
                  rows: [],
                  content: (
                    <PropertyVisibilityPanel
                      properties={orderedProperties}
                      hiddenKeys={hiddenKeys}
                      onReorder={(keys) => onPatchConfig({ property_order: keys })}
                      onToggleHidden={(key, hide) => onPatchConfig(patchHidden(config, key, hide))}
                      onHideAll={() =>
                        onPatchConfig({
                          hidden_properties: orderedProperties.filter((p) => p.type !== "title").map((p) => p.key),
                        })
                      }
                    />
                  ),
                },
              ],
            }),
          },
          {
            id: "filter",
            icon: <FilterIcon size={14} />,
            label: "Filter",
            submenu: () => placeholderPanel("Filter", "Filters aren't available in this view yet."),
          },
          {
            id: "sort",
            icon: <ListIcon size={14} />,
            label: "Sort",
            submenu: () => sortPanel(properties, sorts, onSetSorts),
          },
          {
            id: "group",
            icon: <Users size={14} />,
            label: "Group",
            submenu: () => groupPanel(properties, config.group_by as GroupBySpec | undefined, selectGroupProperty),
          },
          {
            id: "conditional-color",
            icon: <Palette size={14} />,
            label: "Conditional color",
            submenu: () => placeholderPanel("Conditional color", "Conditional color isn't available yet."),
          },
          {
            id: "copy-link",
            icon: <Copy size={14} />,
            label: "Copy link to view",
            onSelect: copyLink,
          },
        ],
      },
      {
        label: "Data source settings",
        searchable: false,
        rows: [
          {
            id: "source",
            icon: <Table2 size={14} />,
            label: "Source",
            value: dataSourceName,
            disabled: true,
            disabledReason: "Managing the data source isn't available here yet",
          },
          {
            id: "edit-properties",
            icon: <ListIcon size={14} />,
            label: "Edit properties",
            submenu: () => editPropertiesPanel(orderedProperties, patchPropertyConfig),
          },
          {
            id: "automations",
            icon: <Bolt size={14} />,
            label: "Automations",
            submenu: () => ({
              title: "Automations",
              sections: [
                {
                  rows: [],
                  content: (
                    <div className="px-2 py-3">
                      <p className="mb-2 text-menu-disabled">
                        {automations.length} automation{automations.length === 1 ? "" : "s"} on this database.
                      </p>
                      <button
                        type="button"
                        onClick={() => setAutomationsOpen(true)}
                        className="rounded bg-brand px-2 py-1 text-white"
                      >
                        Manage automations
                      </button>
                    </div>
                  ),
                },
              ],
            }),
          },
          {
            id: "ai-autofill",
            icon: <Sparkles size={14} />,
            label: "AI Autofill",
            disabled: true,
            disabledReason: "Out of scope for this app",
          },
        ],
      },
      {
        label: "More settings",
        searchable: false,
        rows: [
          {
            id: "manage-data-sources",
            icon: <Link2 size={14} />,
            label: "Manage data sources",
            submenu: () => placeholderPanel("Manage data sources", "Managing data sources isn't available yet."),
          },
          {
            id: "lock-database",
            icon: <Lock size={14} />,
            label: "Lock database",
            kind: "toggle",
            checked: database.is_locked,
            onSelect: toggleDatabaseLock,
          },
        ],
      },
    ],
  };

  return (
    <SidePeek
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="View settings"
      mode="side"
      defaultWidth={483}
      resizable={false}
    >
      <div data-testid="view-settings-sidebar" className="flex h-full flex-col">
        <MenuList root={rootPanel} nav="push" dismissible onClose={onClose} label="View settings" />
      </div>
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
    </SidePeek>
  );
}

/** The view-name input at the top of the root panel — same "the entity's
 * name is an editable input in its own config panel" pattern the column
 * header menu's `ColumnRenameHeader` already established (M1); there is no
 * "Rename" row anywhere in Notion's own capture. */
function ViewNameHeader({
  name,
  viewType,
  onRename,
}: {
  name: string;
  viewType: string;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  return (
    <div className="flex items-center gap-1.5">
      <SlidersHorizontal size={14} className="shrink-0 text-menu-disabled" aria-hidden />
      <input
        aria-label="View name"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() && draft !== name && onRename(draft.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(name);
        }}
        className="min-w-0 flex-1 truncate rounded bg-transparent px-1 py-0.5 text-menu outline-none hover:bg-menu-hover focus:bg-menu-field"
      />
      <button
        type="button"
        aria-label="View info"
        title={`${viewType.charAt(0).toUpperCase() + viewType.slice(1)} view`}
        className="shrink-0 rounded p-0.5 text-menu-disabled hover:bg-menu-hover hover:text-menu-fg"
      >
        <Info size={14} />
      </button>
    </div>
  );
}
