"use client";

// M11 (cell-editing.md): "Status — and why it could not be inferred from
// Select." Four differences from Select's own editor: options are GROUPED
// under To-do / In progress / Complete (with headers/dividers), there is NO
// create-on-type (options are managed on the property, not minted from a
// cell), each option renders as a coloured DOT + label rather than a filled
// chip, and the search placeholder drops Select's ellipsis ("Search for an
// option", not "Search for an option…").
import { useState } from "react";
import { MenuList, Popover } from "@/components/ui/primitives";
import type { MenuPanel } from "@/components/ui/primitives";
import type { StatusValue } from "@/lib/database/types";
import type { CellProps } from "./CellProps";
import { optionColorFor, type ConfiguredOption } from "./CellProps";
import { Tag } from "@/components/ui/Tag";
import { STATUS_GROUPS, type StatusGroup } from "../EditPropertyPanel";

type StatusOption = ConfiguredOption & { group?: StatusGroup };

export interface StatusCellProps extends CellProps<StatusValue> {
  options?: ConfiguredOption[];
}

/** Notion's status pill: radius 10px, a leading 8px dot in the option colour. */
function pill(name: string, options: ConfiguredOption[] | undefined) {
  return (
    <Tag status color={optionColorFor(name, options)}>
      {name}
    </Tag>
  );
}

export function StatusCell({ value, editable, onChange, options }: StatusCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Empty cells are blank in Notion — no dash, no placeholder.
  const content = value?.status ? pill(value.status, options) : <span className="block h-5" />;

  if (!editable) return content;

  function close() {
    setEditing(false);
    setDraft("");
  }

  function assign(name: string | null) {
    close();
    onChange(name ? { type: "status", status: name } : { type: "status", status: null });
  }

  const query = draft.trim().toLowerCase();
  const statusOptions = (options ?? []) as StatusOption[];
  const matches = statusOptions.filter((o) => !query || o.name.toLowerCase().includes(query));

  const panel: MenuPanel = {
    sections: [
      ...STATUS_GROUPS.map((group) => ({
        label: group,
        rows: matches
          .filter((o) => (o.group ?? "To-do") === group)
          .map((o) => ({
            id: o.id,
            label: o.name,
            labelNode: pill(o.name, options),
            checked: value?.status === o.name,
            onSelect: () => assign(o.name),
          })),
      })),
    ],
  };

  return (
    <Popover
      open={editing}
      onOpenChange={(next) => (next ? setEditing(true) : close())}
      label="Status"
      preventAutoFocus
      trigger={
        // Same stable-wrapper reasoning as SelectCell.tsx: the trigger
        // element must not change TYPE across the editing/not-editing
        // states, or Radix's non-modal `onInteractOutside` (its
        // `context.triggerRef.current?.contains(target)` check) can catch
        // the newly-mounted, newly-`autoFocus`ed input in a stale-ref
        // window and dismiss the popover before a keystroke lands.
        <div>
          {editing ? (
            <input
              type="text"
              autoFocus
              aria-label="Status"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Search for an option"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  close();
                }
              }}
              className="w-full px-1 -mx-1 rounded-md bg-surface-elevated shadow-menu text-sm outline-none"
            />
          ) : (
            <button type="button" className="w-full text-left rounded px-1 -mx-1">
              {content}
            </button>
          )}
        </div>
      }
    >
      <MenuList root={panel} nav="flyout" onClose={close} label="Select an option" />
    </Popover>
  );
}
