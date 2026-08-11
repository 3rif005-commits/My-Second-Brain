"use client";

// Dispatches to the right cell component by `property.type` — extracted out
// of TableView.tsx (task-16) so BoardView's cards can render the exact same
// read/write cell primitives instead of a second cell renderer (task-16-
// brief.md §3: "reuse whatever cell-rendering primitives TableView's cells
// already use for read-only display — do not build a second cell
// renderer"). Anything not in the 8 known types falls back to GenericCell,
// always read-only.
import type {
  CheckboxValue,
  DateValue,
  MultiSelectValue,
  NumberValue,
  PropertyResponse,
  PropertyValue,
  RichTextValue,
  SelectValue,
  StatusValue,
  TitleValue,
  UnknownValue,
} from "@/lib/database/types";
import { TitleCell } from "./TitleCell";
import { TextCell } from "./TextCell";
import { NumberCell } from "./NumberCell";
import { SelectCell } from "./SelectCell";
import { MultiSelectCell } from "./MultiSelectCell";
import { StatusCell } from "./StatusCell";
import { DateCell } from "./DateCell";
import { CheckboxCell } from "./CheckboxCell";
import { GenericCell } from "./GenericCell";

export function renderCellValue(
  property: PropertyResponse,
  value: PropertyValue | undefined,
  editable: boolean,
  onChange: (value: PropertyValue | null) => void
) {
  switch (property.type) {
    case "title":
      return (
        <TitleCell value={value as TitleValue | undefined} editable={editable} onChange={onChange} />
      );
    case "rich_text":
      return (
        <TextCell value={value as RichTextValue | undefined} editable={editable} onChange={onChange} />
      );
    case "number":
      return (
        <NumberCell value={value as NumberValue | undefined} editable={editable} onChange={onChange} />
      );
    case "select":
      return (
        <SelectCell value={value as SelectValue | undefined} editable={editable} onChange={onChange} />
      );
    case "multi_select":
      return (
        <MultiSelectCell
          value={value as MultiSelectValue | undefined}
          editable={editable}
          onChange={onChange}
        />
      );
    case "status":
      return (
        <StatusCell value={value as StatusValue | undefined} editable={editable} onChange={onChange} />
      );
    case "date":
      return <DateCell value={value as DateValue | undefined} editable={editable} onChange={onChange} />;
    case "checkbox":
      return (
        <CheckboxCell
          value={value as CheckboxValue | undefined}
          editable={editable}
          onChange={onChange}
        />
      );
    default:
      return <GenericCell value={value as UnknownValue | undefined} />;
  }
}
