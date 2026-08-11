import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseRow, PropertyResponse } from "@/lib/database/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { ListView } from "./ListView";

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

function row(id: string, title: string, extra: DatabaseRow["properties"] = {}): DatabaseRow {
  return { id, properties: { title: { type: "title", title }, ...extra } };
}

describe("ListView", () => {
  it("renders the title on the left and every other visible property on the same row", () => {
    render(
      <ListView
        properties={[TITLE_PROP, STATUS_PROP]}
        rows={[row("row-1", "First task", { status: { type: "status", status: "todo" } })]}
        editable={false}
        onCellChange={vi.fn()}
      />
    );

    expect(screen.getByText("First task")).toBeInTheDocument();
    expect(screen.getByText("Status:")).toBeInTheDocument();
    expect(screen.getByText("todo")).toBeInTheDocument();
  });

  it("clicking the title navigates to the note's workspace route (row.id is the note id)", async () => {
    const user = userEvent.setup();
    render(
      <ListView
        properties={[TITLE_PROP]}
        rows={[row("row-1", "First task")]}
        editable={false}
        onCellChange={vi.fn()}
      />
    );

    await user.click(screen.getByText("First task"));
    expect(push).toHaveBeenCalledWith("/brain/workspace/row-1");
  });

  it("renders no grouping UI anywhere — List doesn't support group_by (research: UNRESOLVED, not implemented)", () => {
    render(
      <ListView
        properties={[TITLE_PROP, STATUS_PROP]}
        rows={[row("row-1", "First task", { status: { type: "status", status: "todo" } })]}
        editable={false}
        onCellChange={vi.fn()}
      />
    );

    expect(screen.queryByText(/hide empty groups/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/group by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^group/i)).not.toBeInTheDocument();
  });

  it("renders 'No rows yet.' for an empty rows array", () => {
    render(<ListView properties={[TITLE_PROP]} rows={[]} editable={false} onCellChange={vi.fn()} />);
    expect(screen.getByText(/no rows yet/i)).toBeInTheDocument();
  });
});
