import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FeedView, sortFeedRows } from "./FeedView";
import type { DatabaseRow, PropertyResponse } from "@/lib/database/types";

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
const UPDATED_PROP = prop({ key: "updated_at", name: "Updated", type: "last_edited_time", position: 2 });

function row(id: string, title: string, extra: DatabaseRow["properties"] = {}): DatabaseRow {
  return { id, properties: { title: { type: "title", title }, ...extra } };
}

describe("sortFeedRows (pure sorting logic)", () => {
  it("sorts descending by the last_edited_time property when the view has one", () => {
    const rows: DatabaseRow[] = [
      row("older", "Older", { updated_at: { type: "last_edited_time", last_edited_time: "2026-01-01T00:00:00Z" } }),
      row("newer", "Newer", { updated_at: { type: "last_edited_time", last_edited_time: "2026-03-01T00:00:00Z" } }),
      row("middle", "Middle", { updated_at: { type: "last_edited_time", last_edited_time: "2026-02-01T00:00:00Z" } }),
    ];
    const sorted = sortFeedRows(rows, [TITLE_PROP, UPDATED_PROP]);
    expect(sorted.map((r) => r.id)).toEqual(["newer", "middle", "older"]);
  });

  it("leaves rows in their existing order when no last_edited_time property is configured", () => {
    const rows: DatabaseRow[] = [row("a", "A"), row("b", "B")];
    const sorted = sortFeedRows(rows, [TITLE_PROP, STATUS_PROP]);
    expect(sorted.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("FeedView", () => {
  it("renders cards newest-first", () => {
    const rows: DatabaseRow[] = [
      row("older", "Older post", {
        updated_at: { type: "last_edited_time", last_edited_time: "2026-01-01T00:00:00Z" },
      }),
      row("newer", "Newer post", {
        updated_at: { type: "last_edited_time", last_edited_time: "2026-03-01T00:00:00Z" },
      }),
    ];
    render(
      <FeedView
        properties={[TITLE_PROP, UPDATED_PROP]}
        rows={rows}
        editable={false}
        onCellChange={vi.fn()}
        config={{}}
        onConfigChange={vi.fn()}
      />
    );

    const titles = screen.getAllByText(/post$/).map((el) => el.textContent);
    expect(titles).toEqual(["Newer post", "Older post"]);
  });

  it("does not render any comment or view-count affordance", () => {
    render(
      <FeedView
        properties={[TITLE_PROP, STATUS_PROP]}
        rows={[row("row-1", "First", { status: { type: "status", status: "todo" } })]}
        editable={false}
        onCellChange={vi.fn()}
        config={{}}
        onConfigChange={vi.fn()}
      />
    );

    expect(screen.queryByText(/comment/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/view count/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^views$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /comment/i })).not.toBeInTheDocument();
  });

  it("toggling a property's visibility checkbox calls onConfigChange with it added to hidden_properties", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    render(
      <FeedView
        properties={[TITLE_PROP, STATUS_PROP]}
        rows={[row("row-1", "First", { status: { type: "status", status: "todo" } })]}
        editable={false}
        onCellChange={vi.fn()}
        config={{}}
        onConfigChange={onConfigChange}
      />
    );

    await user.click(screen.getByRole("checkbox", { name: "Status" }));
    expect(onConfigChange).toHaveBeenCalledWith({ hidden_properties: ["status"] });
  });

  it("renders 'No rows yet.' for an empty rows array", () => {
    render(
      <FeedView
        properties={[TITLE_PROP]}
        rows={[]}
        editable={false}
        onCellChange={vi.fn()}
        config={{}}
        onConfigChange={vi.fn()}
      />
    );
    expect(screen.getByText(/no rows yet/i)).toBeInTheDocument();
  });
});
