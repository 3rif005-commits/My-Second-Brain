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

  it("when creating a Calendar view with no date property on the database, shows the plain message and disables Create — does not auto-invent a property", async () => {
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
    await user.selectOptions(screen.getByLabelText(/view type/i), "calendar");

    expect(screen.getByText(/no date property yet — add a Date property first/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /^create$/i }));
    expect(onCreateView).not.toHaveBeenCalled();
  });

  it("creating a Calendar view with a date property available requires picking one, then passes it through", async () => {
    const user = userEvent.setup();
    const onCreateView = vi.fn().mockResolvedValue(undefined);
    render(
      <ViewTabs
        views={VIEWS}
        activeViewId="v1"
        onSelect={vi.fn()}
        properties={[prop({ key: "due", name: "Due", type: "date" })]}
        onCreateView={onCreateView}
      />
    );

    await user.click(screen.getByText("+ New view"));
    await user.selectOptions(screen.getByLabelText(/view type/i), "calendar");

    // No property picked yet -> Create stays disabled (can't silently fall
    // back to inventing/guessing one).
    expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/date property/i), "due");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(onCreateView).toHaveBeenCalledWith({
      name: "New view",
      type: "calendar",
      groupPropertyKey: undefined,
      datePropertyKey: "due",
    });
  });

  it("when creating a Timeline view with no date property on the database, shows the plain message and disables Create — does not auto-invent a property", async () => {
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
    await user.selectOptions(screen.getByLabelText(/view type/i), "timeline");

    expect(screen.getByText(/no date property yet — add a Date property first/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /^create$/i }));
    expect(onCreateView).not.toHaveBeenCalled();
  });

  it("creating a Timeline view with a date property available requires picking one, then passes it through", async () => {
    const user = userEvent.setup();
    const onCreateView = vi.fn().mockResolvedValue(undefined);
    render(
      <ViewTabs
        views={VIEWS}
        activeViewId="v1"
        onSelect={vi.fn()}
        properties={[prop({ key: "due", name: "Due", type: "date" })]}
        onCreateView={onCreateView}
      />
    );

    await user.click(screen.getByText("+ New view"));
    await user.selectOptions(screen.getByLabelText(/view type/i), "timeline");

    // No property picked yet -> Create stays disabled (can't silently fall
    // back to inventing/guessing one).
    expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/date property/i), "due");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(onCreateView).toHaveBeenCalledWith({
      name: "New view",
      type: "timeline",
      groupPropertyKey: undefined,
      datePropertyKey: "due",
    });
  });

  const CHART_PROPERTIES = [
    prop({ key: "status", name: "Status", type: "status" }),
    prop({ key: "amount", name: "Amount", type: "number" }),
  ];

  it("creating a Chart view: Create stays disabled until chart_type's required fields (x_axis here) are filled in", async () => {
    const user = userEvent.setup();
    const onCreateView = vi.fn();
    render(
      <ViewTabs views={VIEWS} activeViewId="v1" onSelect={vi.fn()} properties={CHART_PROPERTIES} onCreateView={onCreateView} />
    );

    await user.click(screen.getByText("+ New view"));
    await user.selectOptions(screen.getByLabelText(/view type/i), "chart");

    // Default chart_type is "column" (needs an x_axis) with y_axis
    // defaulting to aggregator "count" (no property needed) — Create stays
    // disabled until an x_axis property is picked.
    expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/x-axis property/i), "status");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(onCreateView).toHaveBeenCalledWith({
      name: "New view",
      type: "chart",
      groupPropertyKey: undefined,
      datePropertyKey: undefined,
      chartConfig: {
        chart_type: "column",
        y_axis: { aggregator: "count" },
        x_axis: { property_id: "status" },
        hide_empty_groups: false,
      },
    });
  });

  it("creating a 'Number' Chart view needs no x_axis, only a y_axis", async () => {
    const user = userEvent.setup();
    const onCreateView = vi.fn().mockResolvedValue(undefined);
    render(
      <ViewTabs views={VIEWS} activeViewId="v1" onSelect={vi.fn()} properties={CHART_PROPERTIES} onCreateView={onCreateView} />
    );

    await user.click(screen.getByText("+ New view"));
    await user.selectOptions(screen.getByLabelText(/view type/i), "chart");
    await user.selectOptions(screen.getByLabelText(/chart type/i), "number");

    // count aggregator + no x_axis required for "number" -> already valid.
    expect(screen.getByRole("button", { name: /^create$/i })).not.toBeDisabled();
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(onCreateView).toHaveBeenCalledWith({
      name: "New view",
      type: "chart",
      groupPropertyKey: undefined,
      datePropertyKey: undefined,
      chartConfig: { chart_type: "number", y_axis: { aggregator: "count" } },
    });
  });

  it("a non-'count' y_axis aggregator requires picking a y_axis property before Create is enabled", async () => {
    const user = userEvent.setup();
    const onCreateView = vi.fn().mockResolvedValue(undefined);
    render(
      <ViewTabs views={VIEWS} activeViewId="v1" onSelect={vi.fn()} properties={CHART_PROPERTIES} onCreateView={onCreateView} />
    );

    await user.click(screen.getByText("+ New view"));
    await user.selectOptions(screen.getByLabelText(/view type/i), "chart");
    await user.selectOptions(screen.getByLabelText(/chart type/i), "number");
    await user.selectOptions(screen.getByLabelText(/y-axis aggregator/i), "sum");

    expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/y-axis property/i), "amount");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(onCreateView).toHaveBeenCalledWith({
      name: "New view",
      type: "chart",
      groupPropertyKey: undefined,
      datePropertyKey: undefined,
      chartConfig: { chart_type: "number", y_axis: { aggregator: "sum", property_id: "amount" } },
    });
  });

  it("stack_by's picker does not appear when chart_type is 'donut'", async () => {
    const user = userEvent.setup();
    render(
      <ViewTabs views={VIEWS} activeViewId="v1" onSelect={vi.fn()} properties={CHART_PROPERTIES} onCreateView={vi.fn()} />
    );

    await user.click(screen.getByText("+ New view"));
    await user.selectOptions(screen.getByLabelText(/view type/i), "chart");
    await user.selectOptions(screen.getByLabelText(/chart type/i), "donut");

    expect(screen.queryByLabelText(/stack by/i)).not.toBeInTheDocument();
  });

  // Live-click-through regression: found by creating a Timeline, then a
  // Calendar, then a Chart view back to back in one running session (no page
  // reload in between) -- the third Create button stayed permanently
  // disabled. Root cause: resetForm() cleared every draft field but never
  // reset `submitting` back to false after a successful onCreateView call,
  // so `canSubmit`'s `!submitting` clause stayed false for the rest of the
  // component's lifetime. Pre-existing since Milestone 6 (Task 16,
  // fc906fb) -- every view type was affected, not just Chart; no prior test
  // exercised a second creation in the same render.
  it("Create is usable again after a successful creation -- a second view isn't permanently blocked by stale submitting state", async () => {
    const user = userEvent.setup();
    const onCreateView = vi.fn().mockResolvedValue(undefined);
    render(
      <ViewTabs views={VIEWS} activeViewId="v1" onSelect={vi.fn()} properties={[]} onCreateView={onCreateView} />
    );

    await user.click(screen.getByText("+ New view"));
    await user.type(screen.getByLabelText(/view name/i), "First");
    await user.click(screen.getByRole("button", { name: /^create$/i }));
    expect(onCreateView).toHaveBeenCalledTimes(1);

    await user.click(screen.getByText("+ New view"));
    expect(screen.getByRole("button", { name: /^create$/i })).not.toBeDisabled();
    await user.type(screen.getByLabelText(/view name/i), "Second");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(onCreateView).toHaveBeenCalledTimes(2);
    expect(onCreateView).toHaveBeenLastCalledWith({ name: "Second", type: "table", groupPropertyKey: undefined });
  });
});
