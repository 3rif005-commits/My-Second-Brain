import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BoardView, resolveDropValue } from "./BoardView";
import type { DatabaseRow, Group, PropertyResponse } from "@/lib/database/types";

function prop(overrides: Partial<PropertyResponse>): PropertyResponse {
  return {
    id: overrides.key ?? "id",
    data_source_id: "ds-1",
    user_id: "user-1",
    key: "key",
    name: "Name",
    type: "rich_text",
    config: {},
    description: null,
    storage: "jsonb",
    column_name: null,
    result_type: null,
    is_volatile: false,
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const TITLE_PROP = prop({ key: "title", name: "Title", type: "title", position: 0 });
const STATUS_PROP = prop({ key: "status", name: "Status", type: "status", position: 1 });
const TAGS_PROP = prop({ key: "tags", name: "Tags", type: "multi_select", position: 1 });

function row(id: string, title: string, extra: DatabaseRow["properties"] = {}): DatabaseRow {
  return { id, properties: { title: { type: "title", title }, ...extra } };
}

describe("resolveDropValue (pure drag-drop logic, no dnd-kit simulation needed)", () => {
  const groups: Group[] = [
    {
      key: "todo",
      label: "To do",
      row_count: 1,
      rows: [row("row-1", "Task 1", { status: { type: "status", status: "todo" } })],
      subgroups: null,
    },
    { key: "done", label: "Done", row_count: 0, rows: [], subgroups: null },
  ];

  it("single-valued (status) group: dropping into a different column sets that value", () => {
    const result = resolveDropValue({ rowId: "row-1", sourceGroupKey: "todo" }, "done", STATUS_PROP, groups);
    expect(result).toEqual({ type: "status", status: "done" });
  });

  it("dropping into the same column it came from is a no-op", () => {
    const result = resolveDropValue({ rowId: "row-1", sourceGroupKey: "todo" }, "todo", STATUS_PROP, groups);
    expect(result).toBeUndefined();
  });

  it("dropping into the No value column clears a single-valued property", () => {
    const result = resolveDropValue(
      { rowId: "row-1", sourceGroupKey: "todo" },
      "__no_value__",
      STATUS_PROP,
      groups
    );
    expect(result).toBeNull();
  });

  it("multi_select: dropping into a new column ADDS the tag, preserving existing tags", () => {
    const msGroups: Group[] = [
      {
        key: "urgent",
        label: "Urgent",
        row_count: 1,
        rows: [row("row-1", "Task 1", { tags: { type: "multi_select", multi_select: ["urgent"] } })],
        subgroups: null,
      },
      { key: "backlog", label: "Backlog", row_count: 0, rows: [], subgroups: null },
    ];
    const result = resolveDropValue(
      { rowId: "row-1", sourceGroupKey: "urgent" },
      "backlog",
      TAGS_PROP,
      msGroups
    );
    expect(result).toEqual({ type: "multi_select", multi_select: ["urgent", "backlog"] });
  });

  it("multi_select: dropping onto a column whose tag the card already has is a no-op (no duplicate)", () => {
    // A card with tags ["urgent", "backlog"] appears in both columns; dropping
    // the instance shown under "urgent" onto "backlog" must not duplicate "backlog".
    const msGroups: Group[] = [
      {
        key: "urgent",
        label: "Urgent",
        row_count: 1,
        rows: [
          row("row-1", "Task 1", { tags: { type: "multi_select", multi_select: ["urgent", "backlog"] } }),
        ],
        subgroups: null,
      },
      {
        key: "backlog",
        label: "Backlog",
        row_count: 1,
        rows: [
          row("row-1", "Task 1", { tags: { type: "multi_select", multi_select: ["urgent", "backlog"] } }),
        ],
        subgroups: null,
      },
    ];
    const result = resolveDropValue(
      { rowId: "row-1", sourceGroupKey: "urgent" },
      "backlog",
      TAGS_PROP,
      msGroups
    );
    expect(result).toBeUndefined();
  });

  it("multi_select: dropping into the No value column clears all tags", () => {
    const msGroups: Group[] = [
      {
        key: "urgent",
        label: "Urgent",
        row_count: 1,
        rows: [row("row-1", "Task 1", { tags: { type: "multi_select", multi_select: ["urgent"] } })],
        subgroups: null,
      },
    ];
    const result = resolveDropValue(
      { rowId: "row-1", sourceGroupKey: "urgent" },
      "__no_value__",
      TAGS_PROP,
      msGroups
    );
    expect(result).toEqual({ type: "multi_select", multi_select: [] });
  });
});

describe("BoardView", () => {
  const GROUPS: Group[] = [
    {
      key: "todo",
      label: "To do",
      row_count: 2,
      rows: [
        row("row-1", "First task", { status: { type: "status", status: "todo" } }),
        row("row-2", "Second task", { status: { type: "status", status: "todo" } }),
      ],
      subgroups: null,
    },
    {
      key: "done",
      label: "Done",
      row_count: 1,
      rows: [row("row-3", "Third task", { status: { type: "status", status: "done" } })],
      subgroups: null,
    },
  ];

  it("renders one column per group with the group's label (not key) and a row_count badge", () => {
    render(
      <BoardView
        properties={[TITLE_PROP, STATUS_PROP]}
        groups={GROUPS}
        groupPropertyKey="status"
        hideEmptyGroups={false}
        onToggleHideEmptyGroups={vi.fn()}
        editable={true}
        onCellChange={vi.fn()}
      />
    );

    expect(screen.getByText("To do")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders a card's title and other properties read-only when editable=false", () => {
    render(
      <BoardView
        properties={[TITLE_PROP, STATUS_PROP]}
        groups={GROUPS}
        groupPropertyKey="status"
        hideEmptyGroups={false}
        onToggleHideEmptyGroups={vi.fn()}
        editable={false}
        onCellChange={vi.fn()}
      />
    );

    expect(screen.getByText("First task")).toBeInTheDocument();
    expect(screen.getAllByText("todo")).toHaveLength(2);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows the 'no groupable property' placeholder when the view has no group_by configured", () => {
    render(
      <BoardView
        properties={[TITLE_PROP, STATUS_PROP]}
        groups={null}
        groupPropertyKey={null}
        hideEmptyGroups={false}
        onToggleHideEmptyGroups={vi.fn()}
        editable={true}
        onCellChange={vi.fn()}
      />
    );

    expect(
      screen.getByText(/no groupable property yet — add a Select, Status, or Multi-select property first/i)
    ).toBeInTheDocument();
  });

  it("toggling 'Hide empty groups' calls onToggleHideEmptyGroups with the new value", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <BoardView
        properties={[TITLE_PROP, STATUS_PROP]}
        groups={GROUPS}
        groupPropertyKey="status"
        hideEmptyGroups={false}
        onToggleHideEmptyGroups={onToggle}
        editable={true}
        onCellChange={vi.fn()}
      />
    );

    const checkbox = screen.getByRole("checkbox", { name: /hide empty groups/i });
    await user.click(checkbox);

    expect(onToggle).toHaveBeenCalledWith(true);
  });
});
