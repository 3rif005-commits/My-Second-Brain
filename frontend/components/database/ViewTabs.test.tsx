import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ViewTabs } from "./ViewTabs";
import type { PropertyResponse, ViewResponse } from "@/lib/database/types";

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

function view(overrides: Partial<ViewResponse>): ViewResponse {
  return {
    id: "v1",
    data_source_id: "ds-1",
    user_id: "user-1",
    name: "Table",
    icon: null,
    type: "table",
    config: {},
    filter: null,
    sorts: [],
    is_locked: false,
    position: 0,
    ...overrides,
  };
}

const VIEWS: ViewResponse[] = [view({ id: "v1", name: "Table" }), view({ id: "v2", name: "Board", type: "board" })];

describe("ViewTabs", () => {
  it("renders one tab per view and highlights the active one", () => {
    render(
      <ViewTabs
        views={VIEWS}
        activeViewId="v2"
        onSelect={vi.fn()}
        properties={[]}
        onCreateView={vi.fn()}
      />
    );
    expect(screen.getByText("Table")).toBeInTheDocument();
    expect(screen.getByText("Board")).toBeInTheDocument();
  });

  it("clicking a tab calls onSelect with that view's id", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ViewTabs views={VIEWS} activeViewId="v1" onSelect={onSelect} properties={[]} onCreateView={vi.fn()} />
    );
    await user.click(screen.getByText("Board"));
    expect(onSelect).toHaveBeenCalledWith("v2");
  });

  it("creating a Table view calls onCreateView with type=table and no groupPropertyKey", async () => {
    const user = userEvent.setup();
    const onCreateView = vi.fn().mockResolvedValue(undefined);
    render(
      <ViewTabs views={VIEWS} activeViewId="v1" onSelect={vi.fn()} properties={[]} onCreateView={onCreateView} />
    );

    await user.click(screen.getByText("+ New view"));
    await user.type(screen.getByLabelText(/view name/i), "My Table");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(onCreateView).toHaveBeenCalledWith({ name: "My Table", type: "table", groupPropertyKey: undefined });
  });

  it("when creating a Board view with no groupable property on the database, shows the plain message and disables Create — does not auto-invent a property", async () => {
    const user = userEvent.setup();
    const onCreateView = vi.fn();
    render(
      <ViewTabs
        views={VIEWS}
        activeViewId="v1"
        onSelect={vi.fn()}
        properties={[prop({ key: "notes", type: "rich_text" })]}
        onCreateView={onCreateView}
      />
    );

    await user.click(screen.getByText("+ New view"));
    await user.selectOptions(screen.getByLabelText(/view type/i), "board");

    expect(
      screen.getByText(/no groupable property yet — add a Select, Status, or Multi-select property first/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /^create$/i }));
    expect(onCreateView).not.toHaveBeenCalled();
  });

  it("creating a Board view with a groupable property available requires picking one, then passes it through", async () => {
    const user = userEvent.setup();
    const onCreateView = vi.fn().mockResolvedValue(undefined);
    render(
      <ViewTabs
        views={VIEWS}
        activeViewId="v1"
        onSelect={vi.fn()}
        properties={[prop({ key: "status", name: "Status", type: "status" })]}
        onCreateView={onCreateView}
      />
    );

    await user.click(screen.getByText("+ New view"));
    await user.selectOptions(screen.getByLabelText(/view type/i), "board");

    // No property picked yet -> Create stays disabled (can't silently fall
    // back to inventing/guessing one).
    expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/group by/i), "status");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(onCreateView).toHaveBeenCalledWith({
      name: "New view",
      type: "board",
      groupPropertyKey: "status",
    });
  });
});
