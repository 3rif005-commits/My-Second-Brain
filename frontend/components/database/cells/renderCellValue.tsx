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
  RelatedRow,
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
import { RelationCell } from "./RelationCell";
import { FormulaCell } from "./FormulaCell";

/** Milestone 7's relation cell needs data `CellProps<V>` (value/editable/
 * onChange) has no room for — its value never travels through `onChange`
 * at all (see RelationCell.tsx). Passed as an optional 5th argument so
 * every other caller (Board/Gallery/List/Feed views, all of which predate
 * relations) keeps working unchanged: a "relation"-typed column rendered
 * without this argument falls back to `GenericCell` — the same read-only
 * "—" placeholder those views already showed for relation columns before
 * this task, not a crash (task-22-report.md: relation cells with a real
 * picker are TableView-only in this task's scope). */
export interface RelationCellHandlers {
  links: RelatedRow[] | undefined;
  onEnsureLoaded: () => void;
  onLinksChange: (rows: RelatedRow[]) => void | Promise<void>;
}

export function renderCellValue(
  property: PropertyResponse,
  value: PropertyValue | undefined,
  editable: boolean,
  onChange: (value: PropertyValue | null) => void,
  relation?: RelationCellHandlers
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
    case "relation":
      if (!relation) return <GenericCell value={value as UnknownValue | undefined} />;
      return (
        <RelationCell
          property={property}
          editable={editable}
          links={relation.links}
          onEnsureLoaded={relation.onEnsureLoaded}
          onLinksChange={relation.onLinksChange}
        />
      );
    case "formula":
    case "rollup":
      // Milestone 8 (task-28-brief.md §4): always read-only, regardless of
      // `editable` — there is exactly one legal writer of a computed value
      // (services/db/recompute.py), so `editable`/`onChange` are simply not
      // meaningful here, unlike every CellProps<V>-based cell above.
      return <FormulaCell property={property} value={value} />;
    default:
      return <GenericCell value={value as UnknownValue | undefined} />;
  }
}
