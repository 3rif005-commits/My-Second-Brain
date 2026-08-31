"use client";

// M1 — the table column header menu.
//
// Before this, `TableView`'s `header` was `property.name`, a plain string, for
// every type except Button. This whole surface was missing, and it is the
// single biggest gap in the database UI.
//
// Every row, its order, its dividers and its exact copy come from a live
// capture, not recall: docs/ui-specs/table-column-header.md, backed by
// docs/ui-specs/raw-dom/table-column-header-menu.txt.
//
// THREE THINGS THAT LOOK LIKE MISTAKES BUT ARE NOT:
//
//  1. THERE IS NO "RENAME" ROW. The property is renamed by the input at the
//     top of its own menu. That is Notion's pattern for every entity — a view
//     is renamed the same way in the settings sidebar.
//  2. "Unwrap content" IS THE LABEL WHEN CONTENT IS WRAPPED. The label names
//     the ACTION, not the state, so it must be derived. A static "Wrap"
//     would be wrong in both directions.
//  3. THE ROW SET IS A FUNCTION OF PROPERTY TYPE, not a constant with rows
//     hidden. A title column has 11 rows and gains a "Show page icon" toggle;
//     an ordinary column has 14. Deriving beats one array plus conditionals.
import { useState } from "react";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpDown,
  ArrowUpRight,
  AtSign,
  Calendar,
  CheckSquare,
  CircleChevronDown,
  CircleDashed,
  Clock,
  Fingerprint,
  Copy,
  Eye,
  Filter,
  Hash,
  Link2,
  List,
  Pin,
  MousePointerClick,
  Phone,
  RefreshCw,
  Rows3,
  Search,
  Sigma,
  Trash2,
  Type as TypeIcon,
  Users,
} from "lucide-react";
import { useToast } from "@/app/providers";
import { GROUPABLE_PROPERTY_TYPES } from "@/lib/database/types";
import type { PropertyResponse, ViewResponse } from "@/lib/database/types";
import {
  getCalculation,
  isWrapped,
  patchCalculation,
  patchHidden,
  patchWrapped,
} from "@/lib/database/viewConfig";
import type { MenuPanel, MenuRow } from "@/components/ui/primitives";

const TYPE_ICONS: Record<string, React.ReactNode> = {
  // One distinct glyph per type. Select and Status previously shared a plain
  // circle, and relation/rollup/button fell through to the text glyph — the
  // same defect class as the missing icons in the header menu: a picker where
  // several rows carry the same or a fallback icon stops being scannable.
  title: <TypeIcon size={14} />,
  rich_text: <TypeIcon size={14} />,
  number: <Hash size={14} />,
  select: <CircleChevronDown size={14} />,
  multi_select: <List size={14} />,
  status: <CircleDashed size={14} />,
  date: <Calendar size={14} />,
  person: <Users size={14} />,
  people: <Users size={14} />,
  checkbox: <CheckSquare size={14} />,
  url: <Link2 size={14} />,
  email: <AtSign size={14} />,
  phone_number: <Phone size={14} />,
  formula: <Sigma size={14} />,
  relation: <ArrowUpRight size={14} />,
  rollup: <Search size={14} />,
  button: <MousePointerClick size={14} />,
  unique_id: <Fingerprint size={14} />,
  created_time: <Clock size={14} />,
  last_edited_time: <Clock size={14} />,
};

export function propertyTypeIcon(type: string): React.ReactNode {
  return TYPE_ICONS[type] ?? <TypeIcon size={14} />;
}

/** Human labels for the types a property can be converted into. The set of
 * legal targets comes from the SERVER (`property.convertible_to`); this only
 * names them. */
const TYPE_LABELS: Record<string, string> = {
  rich_text: "Text",
  number: "Number",
  select: "Select",
  multi_select: "Multi-select",
  status: "Status",
  date: "Date",
  person: "Person",
  checkbox: "Checkbox",
  url: "URL",
  email: "Email",
  phone_number: "Phone",
  formula: "Formula",
  relation: "Relation",
  rollup: "Rollup",
  unique_id: "ID",
  created_time: "Created time",
  last_edited_time: "Last edited time",
};

/** The Calculate tree, mirroring live Notion's shape: None / Count / Percent,
 * plus a "More options" branch that only numeric properties get.
 *
 * Every leaf maps to a real name in `_VALID_AGGREGATORS`
 * (services/db/query/aggregations.py) — the engine has been complete since
 * Milestone 4; only this UI was missing. */
const COUNT_FUNCTIONS: { label: string; aggregator: string }[] = [
  { label: "Count all", aggregator: "count" },
  { label: "Count values", aggregator: "count_values" },
  { label: "Count unique values", aggregator: "unique" },
  { label: "Count empty", aggregator: "empty" },
  { label: "Count not empty", aggregator: "not_empty" },
];

const PERCENT_FUNCTIONS: { label: string; aggregator: string }[] = [
  { label: "Percent empty", aggregator: "percent_empty" },
  { label: "Percent not empty", aggregator: "percent_not_empty" },
];

const NUMERIC_FUNCTIONS: { label: string; aggregator: string }[] = [
  { label: "Sum", aggregator: "sum" },
  { label: "Average", aggregator: "average" },
  { label: "Median", aggregator: "median" },
  { label: "Min", aggregator: "min" },
  { label: "Max", aggregator: "max" },
  { label: "Range", aggregator: "range" },
];

export interface ColumnHeaderMenuArgs {
  property: PropertyResponse;
  properties: PropertyResponse[];
  view: ViewResponse | null;
  config: Record<string, unknown>;
  onPatchConfig: (patch: Record<string, unknown>) => void;
  onSetSorts: (sorts: { property: string; direction: "asc" | "desc" }[]) => void;
  onChangeType: (targetType: string) => void;
  onInsert: (side: "left" | "right") => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** M4 supplies this. Until then the Filter row is disabled WITH A REASON
   * rather than omitted — the row exists in Notion, and a silently missing
   * row is harder to notice than a disabled one. */
  onFilter?: () => void;
  renameHeader: React.ReactNode;
}

/** Direction labels are TYPE-AWARE. Notion writes "Sort A → Z" for text and
 * "Sort low → high" for a number; a generic "Ascending" would be wrong on
 * every column. */
function sortLabels(type: string): { asc: string; desc: string } {
  if (type === "number") return { asc: "Sort low → high", desc: "Sort high → low" };
  if (type === "date" || type === "created_time" || type === "last_edited_time") {
    return { asc: "Sort earliest → latest", desc: "Sort latest → earliest" };
  }
  if (type === "checkbox") return { asc: "Sort unchecked → checked", desc: "Sort checked → unchecked" };
  return { asc: "Sort A → Z", desc: "Sort Z → A" };
}

function calculatePanel(args: ColumnHeaderMenuArgs): MenuPanel {
  const { property, config, onPatchConfig } = args;
  const current = getCalculation(config, property.key);
  const apply = (aggregator: string | undefined) =>
    onPatchConfig(patchCalculation(config, property.key, aggregator));

  const branch = (
    label: string,
    functions: { label: string; aggregator: string }[]
  ): MenuRow => ({
    id: label,
    label,
    submenu: () => ({
      sections: [
        {
          rows: functions.map((fn) => ({
            id: fn.aggregator,
            label: fn.label,
            checked: current === fn.aggregator,
            onSelect: () => apply(fn.aggregator),
          })),
        },
      ],
    }),
  });

  const rows: MenuRow[] = [
    { id: "none", label: "None", checked: !current, onSelect: () => apply(undefined) },
    branch("Count", COUNT_FUNCTIONS),
    branch("Percent", PERCENT_FUNCTIONS),
  ];
  // Only numeric properties get "More options" — captured behaviour, and it
  // matches _NUMERIC_AGGREGATORS on the backend.
  if (property.type === "number") rows.push(branch("More options", NUMERIC_FUNCTIONS));

  return { sections: [{ rows }] };
}

export function buildColumnHeaderMenu(args: ColumnHeaderMenuArgs): MenuPanel {
  const {
    property,
    properties,
    config,
    onPatchConfig,
    onSetSorts,
    onChangeType,
    onInsert,
    onDuplicate,
    onDelete,
    onFilter,
    renameHeader,
  } = args;

  const isTitle = property.type === "title";
  const wrapped = isWrapped(config, property.key);
  const labels = sortLabels(property.type);
  const convertible = property.convertible_to ?? [];

  const changeType: MenuRow = {
    id: "change-type",
    icon: <RefreshCw size={14} />,
    label: "Change type",
    submenu: () => ({
      // SINGLE column here, though "+ Add property" shows the same types as a
      // two-column grid. Column count is per-panel, per the captures.
      columns: 1,
      sections: [
        {
          rows: Object.entries(TYPE_LABELS).map(([type, label]) => ({
            id: type,
            icon: propertyTypeIcon(type),
            label,
            checked: type === property.type,
            // `disabled` here is SEMANTIC — Text cannot become a Relation —
            // and the legality comes from the server, not a local copy.
            disabled: type !== property.type && !convertible.includes(type),
            disabledReason: `A ${TYPE_LABELS[property.type] ?? property.type} property cannot be changed to ${label}`,
            onSelect: () => type !== property.type && onChangeType(type),
          })),
        },
      ],
    }),
  };

  const groupable = (GROUPABLE_PROPERTY_TYPES as readonly string[]).includes(property.type);

  const rows: MenuRow[] = [];

  if (!isTitle) rows.push(changeType);
  if (isTitle) {
    // Unique to the title column: it owns the row's page icon.
    rows.push({
      id: "show-page-icon",
      label: "Show page icon",
      kind: "toggle",
      checked: config.show_page_icon !== false,
      onSelect: () =>
        onPatchConfig({ show_page_icon: config.show_page_icon === false }),
    });
  }

  const queryRows: MenuRow[] = [
    {
      id: "filter",
      icon: <Filter size={14} />,
      label: "Filter",
      disabled: !onFilter,
      disabledReason: "Filtering is not available yet",
      onSelect: onFilter,
    },
    {
      id: "sort",
      icon: <ArrowUpDown size={14} />,
      label: "Sort",
      submenu: () => ({
        sections: [
          {
            rows: [
              {
                id: "asc",
                label: labels.asc,
                onSelect: () => onSetSorts([{ property: property.key, direction: "asc" }]),
              },
              {
                id: "desc",
                label: labels.desc,
                onSelect: () => onSetSorts([{ property: property.key, direction: "desc" }]),
              },
            ],
          },
        ],
      }),
    },
    {
      id: "group",
      icon: <Rows3 size={14} />,
      label: "Group",
      disabled: !groupable,
      // Notion groups by any type; we support three until the grouping engine
      // lands (plan Phase 0c). Disabled WITH a reason beats a missing row.
      disabledReason: "This property type cannot be grouped by yet",
      onSelect: () =>
        onPatchConfig({
          group_by: {
            property_key: property.key,
            ...(property.type === "status" ? { mode: "option" } : {}),
          },
        }),
    },
    {
      id: "calculate",
      icon: <Sigma size={14} />,
      label: "Calculate",
      submenu: () => calculatePanel(args),
    },
    {
      id: "freeze",
      icon: <Pin size={14} />,
      label: "Freeze",
      disabled: true,
      disabledReason: "Freezing columns is not available yet",
    },
  ];

  if (!isTitle) {
    queryRows.push({
      id: "hide",
      icon: <Eye size={14} />,
      label: "Hide",
      onSelect: () => onPatchConfig(patchHidden(config, property.key, true)),
    });
  }

  queryRows.push({
    id: "wrap",
    icon: <ArrowRightToLine size={14} />,
    label: wrapped ? "Unwrap content" : "Wrap content",
    onSelect: () => onPatchConfig(patchWrapped(config, property.key, !wrapped)),
  });

  const structuralRows: MenuRow[] = [
    {
      id: "insert-left",
      icon: <ArrowLeftToLine size={14} />,
      label: "Insert left",
      onSelect: () => onInsert("left"),
    },
    {
      id: "insert-right",
      icon: <ArrowRightToLine size={14} />,
      label: "Insert right",
      onSelect: () => onInsert("right"),
    },
  ];

  if (!isTitle) {
    structuralRows.push(
      {
        id: "duplicate",
        icon: <Copy size={14} />,
        label: "Duplicate property",
        // A relation's config carries a minted relation_id and a side; a
        // client-side copy would produce a property every filter on it 400s.
        disabled: property.type === "relation",
        disabledReason: "A relation property cannot be duplicated",
        onSelect: onDuplicate,
      },
      {
        id: "delete",
        icon: <Trash2 size={14} />,
        label: "Delete property",
        danger: true,
        onSelect: onDelete,
      }
    );
  }

  void properties;

  return {
    header: renameHeader,
    sections: [{ rows }, { rows: queryRows }, { rows: structuralRows }].filter(
      (s) => s.rows.length > 0
    ),
  };
}

/** The editable name field at the top of the menu, with the type icon and the
 * "Add property description" affordance. */
export function ColumnRenameHeader({
  property,
  onRename,
  onDescribe,
}: {
  property: PropertyResponse;
  onRename: (name: string) => void;
  onDescribe: (description: string) => void;
}) {
  const [name, setName] = useState(property.name);
  const [describing, setDescribing] = useState(false);
  const [description, setDescription] = useState(property.description ?? "");
  const { showToast } = useToast();

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <span className="flex w-menu-icon items-center justify-center text-menu-disabled">
          {propertyTypeIcon(property.type)}
        </span>
        <input
          aria-label="Property name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== property.name && onRename(name)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
            // The text field owns these keys, not the menu. Arrows move the
            // caret; Tab moves to the ⓘ beside the field (captured
            // behaviour). Without stopping Tab, MenuList closes the whole
            // menu before the input's blur can commit the rename — the edit
            // is silently lost.
            if (e.key.startsWith("Arrow") || e.key === "Tab") e.stopPropagation();
          }}
          // Flat at rest, filled only on hover/focus — Notion's reads as the
          // property's NAME, not as a form input sitting in a menu.
          className="h-menu-row min-w-0 flex-1 rounded bg-transparent px-2 outline-none hover:bg-menu-field focus:bg-menu-field"
        />
        <button
          type="button"
          aria-label="Add property description"
          title="Add property description"
          onClick={() => setDescribing((d) => !d)}
          className="flex h-5 w-5 items-center justify-center rounded text-menu-disabled hover:bg-menu-hover"
        >
          ⓘ
        </button>
      </div>
      {describing && (
        <input
          autoFocus
          aria-label="Property description"
          placeholder="Add a description…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            if (description !== (property.description ?? "")) {
              onDescribe(description);
              showToast("Description saved", "info");
            }
          }}
          onKeyDown={(e) => {
            if (e.key.startsWith("Arrow") || e.key === "Tab") e.stopPropagation();
          }}
          className="h-menu-row w-full rounded bg-menu-field px-2 outline-none"
        />
      )}
    </div>
  );
}
