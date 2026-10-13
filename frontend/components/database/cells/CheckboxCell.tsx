"use client";

import { Checkbox } from "@/components/ui/Checkbox";
import type { CheckboxValue } from "@/lib/database/types";
import type { CellProps } from "./CellProps";

export function CheckboxCell({ value, editable, onChange }: CellProps<CheckboxValue>) {
  const checked = value?.checkbox ?? false;
  return (
    // Notion's 16px checkbox: warm 1px border, solid accent with a white check when on.
    <Checkbox
      label="Checkbox"
      checked={checked}
      disabled={!editable}
      onChange={(next) => onChange({ type: "checkbox", checkbox: next })}
      className="mt-0.5"
    />
  );
}
